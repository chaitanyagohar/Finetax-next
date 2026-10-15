/**
 * Shared outbound email service. SERVER ONLY.
 * Used by /api/send-email, /api/invoices/send and /api/quotations/send.
 */
import nodemailer from "nodemailer";
import { ApiError, getAdminClient } from "@/lib/api/guard";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_RECIPIENTS = 20;
export const MAX_ATTACHMENTS = 10;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_SUBJECT_CHARS = 300;
const MAX_BODY_CHARS = 200_000;

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

  // 2. Resolve the sending account (fallback: first active inbox)
  let accountId = input.accountId || null;
  if (!accountId) {
    const { data: defaultAccount } = await supabase
      .from("email_accounts")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .single();
    if (!defaultAccount) {
      throw new ApiError(400, "No connected email accounts found.");
    }
    accountId = defaultAccount.id;
  }

  const { data: account, error: accErr } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", accountId)
    .single();

  if (accErr || !account) {
    throw new ApiError(400, "Invalid email credentials in database.");
  }
  if (account.is_active === false) {
    throw new ApiError(400, "This email account is disabled.");
  }

  // 3. Send over an encrypted connection
  const port = Number(account.smtp_port) || 587;
  const secure = port === 465;

  const transporter = nodemailer.createTransport({
    host: account.smtp_host || "smtp.gmail.com",
    port,
    secure,
    requireTLS: !secure,
    auth: {
      user: account.smtp_user || account.email_address, // MUST match the From address
      pass: account.smtp_pass,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: { minVersion: "TLSv1.2" },
  });

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
        ? "The email account login failed. Please check its SMTP settings."
        : "The email could not be sent. Please try again."
    );
  }

  // 4. Save to the Unified Inbox (failure here does not fail the send)
  try {
    const { error: dbError } = await supabase.from("email_messages").insert([
      {
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