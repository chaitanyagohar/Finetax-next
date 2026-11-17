export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, getSiteUrl, requireAdmin, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { cleanMemberInput, inviteExistingPerson, inviteNewPerson, sendInvitationNotice } from "@/lib/team/members";

type EmailStatus = { exists?: boolean; user_id?: string; confirmed?: boolean; has_membership?: boolean };

/**
 * Invite a team member by email. Someone who already has a Duesk login joins only after they
 * accept, and the reply is the same either way, so it never shows whether an email is registered.
 */
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
        .select("is_active, accepted_at")
        .eq("org_id", caller.orgId)
        .eq("user_id", status.user_id)
        .maybeSingle();
      if (existing && !existing.accepted_at) {
        throw new ApiError(409, "Your firm has already invited this person. Resend the invitation from the team list.");
      }
      if (existing) {
        throw new ApiError(409, existing.is_active ? "This person is already in your firm." : "This person is in your firm but deactivated. Reactivate them from the team list.");
      }
    }

    // A signup that was never confirmed and belongs to no firm: start fresh
    if (status.exists && !status.confirmed && !status.has_membership && status.user_id) {
      await admin.auth.admin.deleteUser(status.user_id);
      status.exists = false;
    }

    let userId = status.exists ? status.user_id : undefined;
    if (userId) {
      await inviteExistingPerson(admin, caller, input, userId);
      await sendInvitationNotice(caller, input.email, input.name, getSiteUrl(request));
    } else {
      userId = await inviteNewPerson(admin, caller, input);
    }
    await writeAuditLog({ actor: caller, action: "INVITE_MEMBER", entity: "MEMBERSHIPS", entity_id: userId, metadata: { email: input.email, role: input.role } });
    return NextResponse.json({ success: true, status: "invited" });
  } catch (err) {
    return errorResponse(err);
  }
}