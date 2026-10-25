/**
 * Shared outbound email service. SERVER ONLY.
 * Used by /api/send-email, /api/invoices/send, /api/quotations/send and /api/sync-emails.
 */
import nodemailer from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, getAdminClient } from "@/lib/api/guard";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_RECIPIENTS = 20;
export const MAX_ATTACHMENTS = 10;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_SUBJECT_CHARS = 300;
const MAX_BODY_CHARS = 200_000;

const IMAP_HOSTS: Record<string, string> = {
  "smtp.gmail.com": "imap.gmail.com",
  "smtp.office365.com": "outlook.office365.com",
  "smtp-mail.outlook.com": "outlook.office365.com",
  "smtp.zoho.in": "imap.zoho.in",
  "smtp.zoho.com": "imap.zoho.com",
  "smtp.hostinger.com": "imap.hostinger.com",
  "smtp.titan.email": "imap.titan.email",
};

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendFirmEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: MailAttachment[];
  accountId?: string | null;
  /** The firm sending the email. Will become required once every caller passes it. */
  orgId?: string | null;
}

export interface SendFirmEmailResult {
  accountId: string;
  from: string;
  recipients: string[];
}

export function parseRecipients(raw: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(/[,;]/);
  return list.map((s) => String(s).trim()).filter(Boolean);
}

/** Escapes text before inserting it into an HTML email. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\r\n"\\/<>:|?*\x00-\x1f]/g, "_").trim().slice(0, 150);
  return cleaned || "attachment";
}

/** Decrypts the mailbox password from Supabase Vault (server only). */
export async function getAccountPassword(supabase: SupabaseClient, account: any): Promise<string> {
  if (account?.smtp_pass) return account.smtp_pass; // legacy fallback before encryption
  const { data, error } = await supabase.rpc("get_email_account_secret", { p_account_id: account.id });
  if (error) console.error("[mailer] secret lookup failed:", error.message);
  if (!data) {
    throw new ApiError(400, `No saved password for ${account.email_address}. Re-enter it under Inbox → Connected Accounts.`);
  }
  return data as string;
}

export function imapSettingsFor(account: any): { host: string; port: number; user: string } {
  const smtpHost = String(account.smtp_host || "smtp.gmail.com").toLowerCase();
  const host = account.imap_host || IMAP_HOSTS[smtpHost] || (smtpHost.startsWith("smtp.") ? smtpHost.replace(/^smtp\./, "imap.") : "imap.gmail.com");
  return {
    host,
    port: Number(account.imap_port) || 993,
    user: account.smtp_user || account.email_address,
  };
}

export function createSmtpTransport(account: any, password: string) {
  const port = Number(account.smtp_port) || 587;
  const secure = port === 465;
  return nodemailer.createTransport({
    host: account.smtp_host || "smtp.gmail.com",
    port,
    secure,
    requireTLS: !secure,
    auth: {
      user: account.smtp_user || account.email_address, // MUST match the From address
      pass: password,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: { minVersion: "TLSv1.2" },
  });
}

/** TRANSITIONAL: callers that don't pass orgId yet are treated as the original firm (Finetax). */
async function resolveOrgId(supabase: SupabaseClient, orgId?: string | null): Promise<string> {
  if (orgId) return orgId;
  const { data } = await supabase.from("platform_config").select("legacy_org_id").eq("id", true).maybeSingle();
  if (!data?.legacy_org_id) throw new ApiError(500, "Firm could not be identified for this email.");
  console.warn("[mailer] sendFirmEmail called without orgId; using the original firm.");
  return data.legacy_org_id as string;
}

export async function sendFirmEmail(input: SendFirmEmailInput): Promise<SendFirmEmailResult> {
  // 1. Validate
  const recipients = parseRecipients(input.to);
  if (recipients.length === 0 || recipients.length > MAX_RECIPIENTS || recipients.some((r) => !EMAIL_RE.test(r))) {
    throw new ApiError(400, `Please provide up to ${MAX_RECIPIENTS} valid recipient email addresses.`);
  }

  const subject = String(input.subject || "").replace(/[\r\n]+/g, " ").trim();
  if (!subject) throw new ApiError(400, "Subject is required.");
  if (subject.length > MAX_SUBJECT_CHARS) throw new ApiError(400, "Subject is too long.");

  if (!input.html) throw new ApiError(400, "Message body is required.");
  if (input.html.length > MAX_BODY_CHARS) throw new ApiError(400, "Message body is too long.");

  const attachments = input.attachments || [];
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new ApiError(400, `You can attach up to ${MAX_ATTACHMENTS} files.`);
  }
  const totalBytes = attachments.reduce((sum, a) => sum + a.content.length, 0);
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new ApiError(400, "Attachments exceed the 20 MB limit.");
  }

  const supabase = getAdminClient();
  const orgId = await resolveOrgId(supabase, input.orgId);

  // 2. Resolve the sending account: always one of THIS firm's mailboxes
  let accountId = input.accountId || null;
  if (!accountId) {
    const { data: defaultAccount } = await supabase
      .from("email_accounts")
      .select("id")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!defaultAccount) {
      throw new ApiError(400, "No connected email accounts found. Connect one under Inbox → Connected Accounts.");
    }
    accountId = defaultAccount.id;
  }

  const { data: account, error: accErr } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (accErr || !account) {
    throw new ApiError(400, "Invalid email account.");
  }
  if (account.is_active === false) {
    throw new ApiError(400, "This email account is disabled.");
  }

  // 3. Send over an encrypted connection with the decrypted password
  const password = await getAccountPassword(supabase, account);
  const transporter = createSmtpTransport(account, password);

  const displayName = String(account.display_name || "").replace(/["\r\n]/g, "").trim() || account.email_address;
  const fromString = `"${displayName}" <${account.email_address}>`;

  try {
    await transporter.sendMail({
      from: { name: displayName, address: account.email_address },
      to: recipients,
      subject,
      html: input.html,
      text: input.text,
      attachments: attachments.map((a) => ({
        filename: sanitizeFilename(a.filename),
        content: a.content,
        contentType: a.contentType,
      })),
    });
  } catch (smtpErr: any) {
    console.error("[mailer] SMTP error:", smtpErr?.message || smtpErr);
    const isAuthError = smtpErr?.code === "EAUTH" || smtpErr?.responseCode === 535;
    throw new ApiError(
      502,
      isAuthError
        ? "The email account login failed. Please check its password under Inbox → Connected Accounts."
        : "The email could not be sent. Please try again."
    );
  }

  // 4. Save to the Unified Inbox (failure here does not fail the send)
  try {
    const { error: dbError } = await supabase.from("email_messages").insert([
      {
        org_id: account.org_id,
        account_id: account.id,
        direction: "outbound",
        from_address: fromString,
        to_address: recipients.join(", "),
        subject,
        body_text: input.text ?? input.html,
        body_html: input.html,
        is_read: true,
      },
    ]);
    if (dbError) console.error("[mailer] DATABASE INSERT FAILED:", dbError.message);
  } catch (e) {
    console.error("[mailer] DATABASE FATAL ERROR:", e);
  }

  return { accountId: account.id, from: fromString, recipients };
}