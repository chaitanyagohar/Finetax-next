export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, getSiteUrl, requireAdmin, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { escapeHtml, sendFirmEmail } from "@/lib/email/mailer";
import { cleanMemberInput, inviteNewPerson } from "@/lib/team/members";

type EmailStatus = { exists?: boolean; user_id?: string; confirmed?: boolean; has_membership?: boolean };

/** Invite a team member by email. People who already use Duesk are added straight away. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    if (!(await checkRateLimit(`invite:${caller.orgId}`, 30, 60 * 60 * 1000))) {
      throw new ApiError(429, "Too many invitations in an hour. Try again later.");
    }

    const body = await request.json().catch(() => ({}));
    const input = cleanMemberInput(body);
    const admin = getAdminClient();

    const { data: limitMsg } = await admin.rpc("plan_limit_message", { p_org: caller.orgId, p_kind: "user" });
    if (limitMsg) throw new ApiError(402, String(limitMsg));

    const { data: statusData, error: statusErr } = await admin.rpc("auth_email_status", { p_email: input.email });
    if (statusErr) {
      console.error("[invite] status check failed:", statusErr.message);
      throw new ApiError(500, "Could not check this email. Try again.");
    }
    const status = (statusData || {}) as EmailStatus;

    if (status.exists && status.user_id) {
      const { data: existing } = await admin
        .from("memberships")
        .select("is_active")
        .eq("org_id", caller.orgId)
        .eq("user_id", status.user_id)
        .maybeSingle();
      if (existing) {
        throw new ApiError(409, existing.is_active ? "This person is already in your firm." : "This person is in your firm but deactivated. Reactivate them from the team list.");
      }
    }

    // A signup that was never confirmed and belongs to no firm: start fresh
    if (status.exists && !status.confirmed && !status.has_membership && status.user_id) {
      await admin.auth.admin.deleteUser(status.user_id);
      status.exists = false;
    }

    if (status.exists && !status.confirmed) {
      throw new ApiError(409, "This person has a pending invitation from another firm on Duesk. Ask them to accept it, then invite them again.");
    }

    // Already has a Duesk login: add them to this firm directly
    if (status.exists && status.user_id) {
      const { error: memErr } = await admin.from("memberships").insert({
        org_id: caller.orgId,
        user_id: status.user_id,
        role: input.role,
        is_reviewer: input.is_reviewer,
        is_support_agent: false,
        module_access: input.module_access,
        designation: input.designation,
        is_active: true,
        invited_by: caller.userId,
      });
      if (memErr) {
        console.error("[invite] membership error:", memErr.message);
        throw new ApiError(500, "Could not add this person to your firm. Try again.");
      }

      const site = getSiteUrl(request);
      try {
        await sendFirmEmail({
          orgId: caller.orgId,
          to: input.email,
          subject: `You've been added to ${caller.orgName} on Duesk`,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;max-width:600px">
            <p>Hi ${escapeHtml(input.name)},</p>
            <p>${escapeHtml(caller.name)} has added you to <strong>${escapeHtml(caller.orgName)}</strong> on Duesk.</p>
            <p>Sign in with your existing Duesk login, then choose the firm from your account menu (top right).</p>
            <p><a href="${site}/login">Sign in to Duesk</a></p></div>`,
          text: `${caller.name} has added you to ${caller.orgName} on Duesk. Sign in at ${site}/login and choose the firm from your account menu.`,
        });
      } catch (e) {
        console.error("[invite] notice email failed:", e); // the firm's mailbox may not be connected yet
      }

      await writeAuditLog({ actor: caller, action: "ADD_EXISTING_MEMBER", entity: "MEMBERSHIPS", entity_id: status.user_id, metadata: { email: input.email, role: input.role } });
      return NextResponse.json({ success: true, status: "added" });
    }

    const userId = await inviteNewPerson(admin, caller, input);
    await writeAuditLog({ actor: caller, action: "INVITE_MEMBER", entity: "MEMBERSHIPS", entity_id: userId, metadata: { email: input.email, role: input.role } });
    return NextResponse.json({ success: true, status: "invited" });
  } catch (err) {
    return errorResponse(err);
  }
}