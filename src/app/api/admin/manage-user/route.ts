export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  ApiError,
  assertSameOrigin,
  errorResponse,
  getAdminClient,
  getSiteUrl,
  requireAdmin,
  writeAuditLog,
} from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { validatePassword } from "@/lib/password";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIONS = ["set_password", "send_reset_link", "update_email", "delete_user"];

/** Re-authenticates the admin with their own password before any sensitive change. */
async function verifyCallerPassword(email: string | null, password: unknown) {
  if (!email || typeof password !== "string" || !password) {
    throw new ApiError(401, "Please confirm your own password to continue.");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new ApiError(500, "Server is not configured correctly.");
  }

  const verifier = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await verifier.auth.signInWithPassword({ email, password });
  if (error) {
    throw new ApiError(401, "Your password is incorrect.");
  }

  // Discard the temporary verification session
  try {
    await verifier.auth.signOut({ scope: "local" });
  } catch {
    // ignore
  }
}

export async function POST(request: NextRequest) {
  try {
    // 0. Security gates
    assertSameOrigin(request);
    const caller = await requireAdmin();

    if (!checkRateLimit(`manage-user:${caller.userId}`, 10, 15 * 60 * 1000)) {
      throw new ApiError(429, "Too many attempts. Please wait 15 minutes and try again.");
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Invalid request body.");
    }

    const action = typeof body?.action === "string" ? body.action : "";
    if (!ACTIONS.includes(action)) {
      throw new ApiError(400, "Unknown action.");
    }

    const userId = typeof body?.userId === "string" ? body.userId : "";
    if (!UUID_RE.test(userId)) {
      throw new ApiError(400, "Invalid user.");
    }

    // 1. Admin must confirm their own password
    await verifyCallerPassword(caller.email, body?.adminPassword);

    const admin = getAdminClient();

    // 1b. The person must belong to the admin's firm
    const { data: memberships } = await admin.from("memberships").select("org_id, role, is_active").eq("user_id", userId);
    const myFirmMembership = (memberships || []).find((m: any) => m.org_id === caller.orgId);
    if (!myFirmMembership) {
      throw new ApiError(404, "User not found.");
    }
    const inOtherFirms = (memberships || []).some((m: any) => m.org_id !== caller.orgId);
    if (inOtherFirms && action !== "send_reset_link") {
      throw new ApiError(403, "This person also belongs to another firm, so their login can only be changed by Duesk support.");
    }

    // 2. Load the target user
    const { data: targetData, error: targetErr } = await admin.auth.admin.getUserById(userId);
    const target = targetData?.user;
    if (targetErr || !target) {
      throw new ApiError(404, "User not found.");
    }

    const { data: profile } = await admin.from("profiles").select("name, role").eq("id", userId).maybeSingle();
    const targetLabel = profile?.name || target.email || userId;

    // 3a. Set a new password directly
    if (action === "set_password") {
      const problem = validatePassword(body?.newPassword);
      if (problem) throw new ApiError(400, problem);

      const { error } = await admin.auth.admin.updateUserById(userId, { password: body.newPassword });
      if (error) {
        console.error("[manage-user] set_password error:", error.message);
        throw new ApiError(
          400,
          error.message?.toLowerCase().includes("weak")
            ? "That password is too weak. Please choose a stronger one."
            : "Could not update the password."
        );
      }

      await writeAuditLog({
        actor: caller,
        action: "user_password_reset",
        entity: "profiles",
        entity_id: userId,
        metadata: { target: targetLabel, method: "admin_set" },
      });

      return NextResponse.json({ success: true, message: `Password updated for ${targetLabel}.` });
    }

    // 3b. Email the user a secure reset link
    if (action === "send_reset_link") {
      if (!target.email) {
        throw new ApiError(400, "This user has no login email.");
      }

      const { error } = await admin.auth.resetPasswordForEmail(target.email, {
        redirectTo: `${getSiteUrl(request)}/auth/confirm?next=/reset-password`,
      });

      if (error) {
        console.error("[manage-user] send_reset_link error:", error.message);
        throw new ApiError(502, "Could not send the reset email. Please check the email (SMTP) settings in Supabase.");
      }

      await writeAuditLog({
        actor: caller,
        action: "user_password_reset",
        entity: "profiles",
        entity_id: userId,
        metadata: { target: targetLabel, method: "email_link", sent_to: target.email },
      });

      return NextResponse.json({ success: true, message: `Password reset link sent to ${target.email}.` });
    }

    // 3c. Permanently delete the login and profile
    if (action === "delete_user") {
      if (userId === caller.userId) {
        throw new ApiError(400, "You can't delete your own account.");
      }

      if (myFirmMembership.role === "admin") {
        const { count } = await admin
          .from("memberships")
          .select("user_id", { count: "exact", head: true })
          .eq("org_id", caller.orgId)
          .eq("role", "admin")
          .eq("is_active", true);
        if ((count || 0) <= 1) {
          throw new ApiError(400, "You can't delete the last active administrator.");
        }
      }

      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) {
        console.error("[manage-user] delete_user error:", error.message);
        throw new ApiError(
          409,
          "This person has linked records (tasks, time logs or history), so they can't be deleted. Deactivate their account instead to keep the records intact."
        );
      }

      await writeAuditLog({
        actor: caller,
        action: "user_deleted",
        entity: "profiles",
        entity_id: userId,
        metadata: { target: targetLabel, email: target.email },
      });

      return NextResponse.json({ success: true, message: `${targetLabel} has been permanently removed.` });
    }

    // 3d. Change the login email (keeps Auth and the Team page in sync)
    const newEmail = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(newEmail) || newEmail.length > 254) {
      throw new ApiError(400, "Please enter a valid email address.");
    }

    const oldEmail = (target.email || "").toLowerCase();

    if (newEmail !== oldEmail) {
      const { error: emailErr } = await admin.auth.admin.updateUserById(userId, {
        email: newEmail,
        email_confirm: true,
      });

      if (emailErr) {
        console.error("[manage-user] update_email error:", emailErr.message);
        const taken = /already|registered|exists/i.test(emailErr.message);
        throw new ApiError(400, taken ? "Another account already uses this email address." : "Could not update the login email.");
      }
    }

    const { error: profErr } = await admin.from("profiles").update({ email: newEmail }).eq("id", userId);
    if (profErr) {
      console.error("[manage-user] profile email sync error:", profErr.message);
    }

    await writeAuditLog({
      actor: caller,
      action: "user_email_changed",
      entity: "profiles",
      entity_id: userId,
      metadata: { target: targetLabel, from: oldEmail, to: newEmail },
    });

    return NextResponse.json({ success: true, message: `Login email for ${targetLabel} is now ${newEmail}.` });
  } catch (err) {
    return errorResponse(err);
  }
}