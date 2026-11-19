export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, getSiteUrl, requireAdmin, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { cleanMemberInput, inviteNewPerson, sendInvitationNotice } from "@/lib/team/members";
import { UUID_RE } from "@/lib/validate";

const ACTIONS = ["update", "deactivate", "reactivate", "resend_invite", "cancel_invite"];

/** Change a member's role, modules and status in the caller's firm only. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    if (!(await checkRateLimit(`member-update:${caller.userId}`, 60, 15 * 60 * 1000))) {
      throw new ApiError(429, "Too many changes in a short time. Wait a few minutes.");
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "");
    const userId = String(body?.userId || "");
    if (!ACTIONS.includes(action)) throw new ApiError(400, "Unknown action.");
    if (!UUID_RE.test(userId)) throw new ApiError(400, "Invalid team member.");

    const admin = getAdminClient();
    const { data: member } = await admin
      .from("memberships")
      .select("user_id, role, is_active, is_reviewer, module_access, designation, accepted_at, invited_name")
      .eq("org_id", caller.orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!member) throw new ApiError(404, "This person isn't in your firm.");

    const self = userId === caller.userId;
    // Invited with an existing Duesk login and not yet accepted: the login is not this firm's to change
    const awaitingAcceptance = !member.accepted_at;
    const activeAdmins = async () => {
      const { count } = await admin
        .from("memberships")
        .select("user_id", { count: "exact", head: true })
        .eq("org_id", caller.orgId)
        .eq("role", "admin")
        .eq("is_active", true);
      return count || 0;
    };
    const otherFirms = async () => {
      const { count } = await admin
        .from("memberships")
        .select("org_id", { count: "exact", head: true })
        .eq("user_id", userId)
        .neq("org_id", caller.orgId)
        .not("accepted_at", "is", null);
      return count || 0;
    };

    if (action === "update") {
      const input = cleanMemberInput(body, false);
      if (self && member.role === "admin" && input.role !== "admin") throw new ApiError(400, "You can't remove your own admin access.");
      if (member.role === "admin" && input.role !== "admin" && member.is_active && (await activeAdmins()) <= 1) {
        throw new ApiError(400, "Your firm needs at least one active administrator.");
      }

      const { error } = await admin
        .from("memberships")
        .update({
          role: input.role,
          is_reviewer: input.is_reviewer,
          module_access: input.module_access,
          designation: input.designation,
          ...(awaitingAcceptance ? { invited_name: input.name } : {}),
        })
        .eq("org_id", caller.orgId)
        .eq("user_id", userId);
      if (error) throw new ApiError(500, "Could not save the changes.");

      // Branch and custom role (a role then sets the sections and reviewer right)
      const place: Record<string, string | null> = {};
      for (const key of ["branch_id", "role_id"] as const) {
        if (body && key in body) {
          const v = (body as Record<string, unknown>)[key];
          if (v === null || v === "") place[key] = null;
          else if (typeof v === "string" && UUID_RE.test(v)) {
            const { data: owned } = await admin.from(key === "branch_id" ? "branches" : "roles").select("id").eq("id", v).eq("org_id", caller.orgId).maybeSingle();
            if (!owned) throw new ApiError(400, "That branch or role isn't in your firm.");
            place[key] = v;
          }
        }
      }
      if (Object.keys(place).length) {
        const { error: placeErr } = await admin.from("memberships").update(place).eq("org_id", caller.orgId).eq("user_id", userId);
        if (placeErr) throw new ApiError(400, placeErr.message);
      }

      if (awaitingAcceptance) {
        await writeAuditLog({ actor: caller, action: "UPDATE_MEMBER", entity: "MEMBERSHIPS", entity_id: userId, metadata: { role: input.role, modules: input.module_access, reviewer: input.is_reviewer } });
        return NextResponse.json({ success: true, message: `${input.name}'s invitation updated.` });
      }

      // Name and phone belong to the login, which may also be used in another firm
      const shared = (await otherFirms()) > 0;
      if (!shared) await admin.from("profiles").update({ name: input.name, phone: input.phone, designation: input.designation }).eq("id", userId);

      await writeAuditLog({ actor: caller, action: "UPDATE_MEMBER", entity: "MEMBERSHIPS", entity_id: userId, metadata: { role: input.role, modules: input.module_access, reviewer: input.is_reviewer } });
      return NextResponse.json({
        success: true,
        message: `${input.name} updated.${shared ? " Their name and phone weren't changed because they also work with another firm." : ""}`,
      });
    }

    if (action === "deactivate" || action === "reactivate") {
      if (self) throw new ApiError(400, "You can't change your own access.");
      if (awaitingAcceptance) throw new ApiError(400, "This person hasn't accepted the invitation yet. Cancel the invitation instead.");
      if (action === "deactivate" && member.role === "admin" && member.is_active && (await activeAdmins()) <= 1) {
        throw new ApiError(400, "Your firm needs at least one active administrator.");
      }
      if (action === "reactivate" && !member.is_active) {
        const { data: limitMsg } = await admin.rpc("plan_limit_message", { p_org: caller.orgId, p_kind: "user" });
        if (limitMsg) throw new ApiError(402, String(limitMsg));
      }
      const { error } = await admin
        .from("memberships")
        .update({ is_active: action === "reactivate" })
        .eq("org_id", caller.orgId)
        .eq("user_id", userId);
      if (error) throw new ApiError(500, "Could not change their access.");
      await writeAuditLog({ actor: caller, action: action === "deactivate" ? "DEACTIVATE_MEMBER" : "REACTIVATE_MEMBER", entity: "MEMBERSHIPS", entity_id: userId });
      return NextResponse.json({
        success: true,
        message: action === "deactivate" ? "Access removed. Their work and history stay in your firm." : "Access restored.",
      });
    }

    // Pending invitations: resend or cancel
    const { data: authData } = await admin.auth.admin.getUserById(userId);

    if (awaitingAcceptance) {
      const email = String(authData?.user?.email || "").toLowerCase();
      if (action === "cancel_invite") {
        await admin.from("memberships").delete().eq("org_id", caller.orgId).eq("user_id", userId).is("accepted_at", null);
        await writeAuditLog({ actor: caller, action: "CANCEL_INVITE", entity: "MEMBERSHIPS", entity_id: userId, metadata: { email } });
        return NextResponse.json({ success: true, message: "Invitation cancelled." });
      }
      await sendInvitationNotice(caller, email, member.invited_name || "there", getSiteUrl(request));
      await writeAuditLog({ actor: caller, action: "RESEND_INVITE", entity: "MEMBERSHIPS", entity_id: userId, metadata: { email } });
      return NextResponse.json({ success: true, message: "Invitation sent again." });
    }

    if (authData?.user?.email_confirmed_at) throw new ApiError(400, "This person has already accepted the invitation.");

    const shared = (await otherFirms()) > 0;
    if (action === "resend_invite" && shared) {
      throw new ApiError(409, "This person also has a pending invitation from another firm, so it can't be resent from here.");
    }

    const { data: profile } = await admin.from("profiles").select("name, email, phone, designation").eq("id", userId).maybeSingle();
    await admin.from("memberships").delete().eq("org_id", caller.orgId).eq("user_id", userId);
    if (!shared) {
      await admin.from("profiles").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId);
    }

    if (action === "cancel_invite") {
      await writeAuditLog({ actor: caller, action: "CANCEL_INVITE", entity: "MEMBERSHIPS", entity_id: userId, metadata: { email: profile?.email } });
      return NextResponse.json({ success: true, message: "Invitation cancelled." });
    }

    await inviteNewPerson(admin, caller, {
      name: profile?.name || "Team member",
      email: String(profile?.email || authData?.user?.email || "").toLowerCase(),
      phone: profile?.phone || null,
      designation: member.designation || profile?.designation || null,
      role: member.role,
      is_reviewer: member.is_reviewer,
      module_access: Array.isArray(member.module_access) ? (member.module_access as string[]) : [],
    });
    await writeAuditLog({ actor: caller, action: "RESEND_INVITE", entity: "MEMBERSHIPS", entity_id: userId, metadata: { email: profile?.email } });
    return NextResponse.json({ success: true, message: "Invitation sent again." });
  } catch (err) {
    return errorResponse(err);
  }
}