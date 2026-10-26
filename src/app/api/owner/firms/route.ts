export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requirePlatformOwner, writeAuditLog } from "@/lib/api/guard";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/** List every firm with usage counts (no client data). */
export async function GET() {
  try {
    await requirePlatformOwner();
    const { data, error } = await getAdminClient().rpc("platform_firm_overview");
    if (error) {
      console.error("[owner] overview failed:", error.message);
      throw new ApiError(500, "Could not load firms.");
    }
    return NextResponse.json({ firms: data || [] });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Create a new firm and its first administrator login. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requirePlatformOwner();
    const body = await request.json().catch(() => ({}));

    const firmName = String(body?.firmName || "").trim().slice(0, 200);
    const slug = String(body?.slug || "").trim().toLowerCase();
    const adminName = String(body?.adminName || "").trim().slice(0, 120);
    const adminEmail = String(body?.adminEmail || "").trim().toLowerCase();
    const adminPassword = String(body?.adminPassword || "");
    const status = body?.status === "active" ? "active" : "trial";
    const trialDays = Math.min(90, Math.max(1, Number(body?.trialDays) || 14));
    const copyLists = body?.copyLists !== false;

    if (firmName.length < 2) throw new ApiError(400, "Firm name is required.");
    if (!SLUG_RE.test(slug)) throw new ApiError(400, "Short name: 3 to 50 lowercase letters, numbers or hyphens.");
    if (!adminName) throw new ApiError(400, "Admin name is required.");
    if (!EMAIL_RE.test(adminEmail) || adminEmail.length > 254) throw new ApiError(400, "Enter a valid admin email.");
    if (adminPassword.length < 8 || adminPassword.length > 72 || !/[A-Za-z]/.test(adminPassword) || !/[0-9]/.test(adminPassword)) {
      throw new ApiError(400, "Password: 8 to 72 characters with at least one letter and one number.");
    }

    const admin = getAdminClient();

    const { data: taken } = await admin.from("organizations").select("id").eq("slug", slug).maybeSingle();
    if (taken) throw new ApiError(400, "That short name is already used by another firm.");

    // 1. Login for the firm's first administrator
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { name: adminName },
    });
    if (authErr || !authData?.user) {
      const exists = authErr?.message?.toLowerCase().includes("already");
      throw new ApiError(400, exists ? "This email already has a login. Use a different email for the firm admin." : "Could not create the admin login.");
    }
    const userId = authData.user.id;

    // 2. Profile
    const { error: profErr } = await admin.from("profiles").upsert({
      id: userId,
      name: adminName,
      email: adminEmail,
      role: "admin",
      is_active: true,
    });
    if (profErr) {
      await admin.auth.admin.deleteUser(userId);
      throw new ApiError(400, "Could not create the admin profile. Nothing was created.");
    }

    // 3. Firm, settings, #general, Task List and membership (one database transaction)
    const { data: orgId, error: rpcErr } = await admin.rpc("platform_create_firm", {
      p_name: firmName,
      p_slug: slug,
      p_admin: userId,
      p_status: status,
      p_trial_days: trialDays,
      p_copy_lists: copyLists,
      p_created_by: caller.userId,
    });
    if (rpcErr || !orgId) {
      console.error("[owner] create firm failed:", rpcErr?.message);
      await admin.from("profiles").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId);
      throw new ApiError(400, rpcErr?.message || "Could not create the firm. Nothing was created.");
    }

    await writeAuditLog({
      actor: caller,
      action: "CREATE_FIRM",
      entity: "ORGANIZATIONS",
      entity_id: orgId as string,
      metadata: { firmName, slug, adminEmail, status, copyLists },
    });

    return NextResponse.json({ success: true, orgId, message: `${firmName} created. ${adminEmail} can now sign in.` });
  } catch (err) {
    return errorResponse(err);
  }
}