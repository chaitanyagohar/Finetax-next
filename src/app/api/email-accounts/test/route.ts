export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { ImapFlow } from "imapflow";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireAdmin } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { createSmtpTransport, getAccountPassword, imapSettingsFor } from "@/lib/email/mailer";
import { assertPublicMailHost } from "@/lib/email/mailHost";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();

    if (!(await checkRateLimit(`email-test:${caller.userId}`, 10, 10 * 60 * 1000))) {
          throw new ApiError(429, "Too many connection tests. Please wait a few minutes.");
    }

    const body = await request.json().catch(() => ({}));
    const accountId = typeof body?.accountId === "string" ? body.accountId : "";
    if (!UUID_RE.test(accountId)) throw new ApiError(400, "Invalid account.");

    const admin = getAdminClient();
    const { data: account } = await admin
      .from("email_accounts")
      .select("*")
      .eq("id", accountId)
      .eq("org_id", caller.orgId)
      .maybeSingle();
    if (!account) throw new ApiError(404, "Account not found.");

    await assertPublicMailHost(account.smtp_host || "smtp.gmail.com", Number(account.smtp_port) || 587, "smtp");
    const imapTarget = imapSettingsFor(account);
    await assertPublicMailHost(imapTarget.host, imapTarget.port, "imap");

    const password = await getAccountPassword(admin, account);
    const result = { smtp: { ok: false, message: "" }, imap: { ok: false, message: "" } };

    // Sending (SMTP)
    try {
      await createSmtpTransport(account, password).verify();
      result.smtp = { ok: true, message: `Connected to ${account.smtp_host || "smtp.gmail.com"}` };
    } catch (e: any) {
      const auth = e?.code === "EAUTH" || e?.responseCode === 535;
      result.smtp = { ok: false, message: auth ? "Login rejected: check the password / app password." : "Could not connect to the SMTP server." };
    }

    // Receiving (IMAP)
    const imap = imapSettingsFor(account);
    await assertPublicMailHost(imap.host, imap.port, "imap");
    const client = new ImapFlow({
      host: imap.host,
      port: imap.port,
      secure: true,
      auth: { user: imap.user, pass: password },
      logger: false,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
    });
    try {
      await client.connect();
      result.imap = { ok: true, message: `Connected to ${imap.host}` };
    } catch {
      result.imap = { ok: false, message: `Could not sign in to ${imap.host}. Check the password and that IMAP is enabled.` };
    } finally {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }

    // A successful login proves this firm owns the mailbox (used by the incoming-email webhook)
    if ((result.smtp.ok || result.imap.ok) && !account.verified_at) {
      await admin.from("email_accounts").update({ verified_at: new Date().toISOString() }).eq("id", account.id);
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}