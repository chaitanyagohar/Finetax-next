/** Proof that a firm owns a mailbox address, by a code Duesk emails to it. SERVER ONLY. */
import { createHmac, randomInt, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/guard";
import { escapeHtml, sendFirmEmail } from "@/lib/email/mailer";

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;

type Account = { id: string; org_id: string; email_address: string };

function codeHash(accountId: string, code: string): string {
  const secret = process.env.PUBLIC_LINK_SECRET;
  if (!secret || secret.length < 32) throw new Error("PUBLIC_LINK_SECRET is missing or shorter than 32 characters.");
  return createHmac("sha256", secret).update(`mailbox-owner:${accountId}:${code}`).digest("hex");
}

/**
 * Emails a six-digit code to the mailbox address. It is sent from Duesk's own mailbox, never
 * through the mail server the firm typed in, so only someone who can read the address sees it.
 */
export async function sendOwnershipCode(admin: SupabaseClient, account: Account, firmName: string): Promise<void> {
  const { data: config } = await admin.from("platform_config").select("support_org_id").eq("id", true).maybeSingle();
  const senderOrg = config?.support_org_id as string | undefined;
  if (!senderOrg) throw new ApiError(503, "Duesk cannot send confirmation codes at the moment. Contact Duesk support.");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error } = await admin.from("email_account_codes").upsert({
    account_id: account.id,
    org_id: account.org_id,
    code_hash: codeHash(account.id, code),
    expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
    attempts: 0,
    sent_at: new Date().toISOString(),
  });
  if (error) throw new ApiError(500, "Could not create a confirmation code. Try again.");

  try {
    await sendFirmEmail({
      kind: "mailbox_code",
      orgId: senderOrg,
      to: account.email_address,
      subject: `${code} is your Duesk mailbox confirmation code`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;max-width:600px">
        <p><strong>${escapeHtml(firmName)}</strong> is connecting this email address to Duesk.</p>
        <p>Confirmation code: <strong style="font-size:20px;letter-spacing:3px">${code}</strong></p>
        <p>It is valid for ${CODE_TTL_MINUTES} minutes. If your firm did not ask for this, ignore this email and do not share the code.</p></div>`,
      text: `${firmName} is connecting this email address to Duesk.\n\nConfirmation code: ${code}\n\nIt is valid for ${CODE_TTL_MINUTES} minutes. If your firm did not ask for this, ignore this email and do not share the code.`,
      record: false,
    });
  } catch (e) {
    console.error("[ownership] code email failed:", e);
    await admin.from("email_account_codes").delete().eq("account_id", account.id);
    throw new ApiError(502, "Duesk could not send the confirmation code. Try again, or contact Duesk support.");
  }
}

/** Checks the code and, when it matches, records the firm as the address's confirmed owner. */
export async function confirmOwnershipCode(admin: SupabaseClient, account: Account, code: string): Promise<void> {
  const { data: pending } = await admin
    .from("email_account_codes")
    .select("code_hash, expires_at, attempts")
    .eq("account_id", account.id)
    .maybeSingle();

  if (!pending || new Date(pending.expires_at).getTime() < Date.now()) {
    throw new ApiError(400, "This code has expired. Send a new one.");
  }
  if (pending.attempts >= MAX_ATTEMPTS) {
    throw new ApiError(429, "Too many wrong codes. Send a new one.");
  }

  const expected = Buffer.from(pending.code_hash);
  const given = Buffer.from(codeHash(account.id, code));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    await admin.from("email_account_codes").update({ attempts: pending.attempts + 1 }).eq("account_id", account.id);
    throw new ApiError(400, "That code is not correct. Check the email and try again.");
  }

  const { error } = await admin
    .from("email_accounts")
    .update({ ownership_confirmed_at: new Date().toISOString() })
    .eq("id", account.id)
    .eq("org_id", account.org_id);
  if (error) {
    // The unique index allows one confirmed owner per address
    if (error.code === "23505") throw new ApiError(409, "This address is already confirmed by another firm on Duesk. Contact Duesk support.");
    throw new ApiError(500, "Could not confirm this mailbox. Try again.");
  }
  await admin.from("email_account_codes").delete().eq("account_id", account.id);
}
