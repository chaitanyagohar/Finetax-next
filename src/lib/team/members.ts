/** Shared helpers for inviting and updating firm members. SERVER ONLY. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, type AuthContext } from "@/lib/api/guard";
import { escapeHtml, sendFirmEmail } from "@/lib/email/mailer";
import { EMAIL_RE } from "@/lib/validate";

export const ROLES = ["staff", "reviewer", "admin"];
const MODULE_ID_RE = /^[a-z0-9_-]{1,40}$/i;

export type MemberInput = {
  name: string;
  email: string;
  phone: string | null;
  designation: string | null;
  role: string;
  is_reviewer: boolean;
  module_access: string[];
};

export function cleanMemberInput(body: any, requireEmail = true): MemberInput {
  const name = String(body?.name || "").trim().replace(/\s+/g, " ").slice(0, 120);
  const email = String(body?.email || "").trim().toLowerCase();
  if (name.length < 2) throw new ApiError(400, "Enter the person's full name.");
  if (requireEmail && (!EMAIL_RE.test(email) || email.length > 254)) throw new ApiError(400, "Enter a valid email address.");

  const role = ROLES.includes(body?.role) ? String(body.role) : "staff";
  const raw: unknown[] = Array.isArray(body?.module_access) ? body.module_access : [];
  const modules = Array.from(new Set(raw.filter((m): m is string => typeof m === "string" && MODULE_ID_RE.test(m)))).slice(0, 40);

  return {
    name,
    email,
    phone: String(body?.phone || "").trim().slice(0, 20) || null,
    designation: String(body?.designation || "").trim().slice(0, 80) || null,
    role,
    is_reviewer: role === "admin" || Boolean(body?.is_reviewer),
    module_access: modules,
  };
}

/** Invites someone with no Duesk login: Supabase emails them a link, then they join this firm. */
export async function inviteNewPerson(admin: SupabaseClient, caller: AuthContext, input: MemberInput): Promise<string> {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    data: {
      name: input.name,
      phone: input.phone,
      staff_invite: true,
      firm_name: caller.orgName,
      invited_by_name: caller.name,
    },
  });
  if (error || !data?.user) {
    console.error("[team] invite failed:", error?.message);
    if (/rate|limit/i.test(error?.message || "")) throw new ApiError(429, "Too many emails right now. Try again in a few minutes.");
    throw new ApiError(500, "Could not send the invitation email. Try again.");
  }
  const userId = data.user.id;

  const { error: profErr } = await admin.from("profiles").upsert({
    id: userId,
    name: input.name,
    email: input.email,
    phone: input.phone,
    designation: input.designation,
    role: input.role,
    is_active: true,
  });
  if (profErr) {
    console.error("[team] profile error:", profErr.message);
    await admin.auth.admin.deleteUser(userId);
    throw new ApiError(500, "Could not set up the invitation. Try again.");
  }

  const { error: memErr } = await admin.from("memberships").insert({
    org_id: caller.orgId,
    user_id: userId,
    role: input.role,
    is_reviewer: input.is_reviewer,
    is_support_agent: false,
    module_access: input.module_access,
    designation: input.designation,
    is_active: true,
    invited_by: caller.userId,
  });
  if (memErr) {
    console.error("[team] membership error:", memErr.message);
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
    throw new ApiError(500, "Could not add this person to your firm. Try again.");
  }

  await admin.from("user_active_org").upsert({ user_id: userId, org_id: caller.orgId });
  return userId;
}

/**
 * Invites someone who already has a Duesk login. They join only after accepting: until then
 * the membership is inactive and gives no access in either direction.
 */
export async function inviteExistingPerson(admin: SupabaseClient, caller: AuthContext, input: MemberInput, userId: string): Promise<void> {
  const { error } = await admin.from("memberships").insert({
    org_id: caller.orgId,
    user_id: userId,
    role: input.role,
    is_reviewer: input.is_reviewer,
    is_support_agent: false,
    module_access: input.module_access,
    designation: input.designation,
    is_active: false,
    accepted_at: null,
    invited_name: input.name,
    invited_by: caller.userId,
  });
  if (error) {
    console.error("[team] invitation error:", error.message);
    throw new ApiError(500, "Could not send the invitation. Try again.");
  }
}

/** Tells an invited Duesk user where to accept. Best effort: the firm's mailbox may not be connected yet. */
export async function sendInvitationNotice(caller: AuthContext, to: string, name: string, site: string): Promise<void> {
  try {
    await sendFirmEmail({
      kind: "invitation",
      orgId: caller.orgId,
      to,
      subject: `${caller.orgName} has invited you to join them on Duesk`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;max-width:600px">
        <p>Hi ${escapeHtml(name)},</p>
        <p>${escapeHtml(caller.name)} has invited you to join <strong>${escapeHtml(caller.orgName)}</strong> on Duesk.</p>
        <p>Sign in with your Duesk login to accept or decline. Nothing is shared with the firm until you accept.</p>
        <p><a href="${site}/login">Sign in to Duesk</a></p></div>`,
      text: `${caller.name} has invited you to join ${caller.orgName} on Duesk. Sign in at ${site}/login to accept or decline. Nothing is shared with the firm until you accept.`,
    });
  } catch (e) {
    console.error("[team] invitation notice failed:", e);
  }
}