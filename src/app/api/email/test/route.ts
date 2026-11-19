export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, requireAdmin } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { escapeHtml, sendFirmEmail } from "@/lib/email/mailer";

/** Sends a test email from the firm's mailbox (or Duesk's, for the owner) to the person asking. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    if (!caller.email) throw new ApiError(400, "Your login has no email address.");
    if (!(await checkRateLimit(`email-test:${caller.userId}`, 5, 60 * 60 * 1000))) throw new ApiError(429, "Five tests an hour. Please wait a little.");
    const at = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const result = await sendFirmEmail({
      kind: "test",
      orgId: caller.orgId,
      to: caller.email,
      subject: `Duesk test email from ${caller.orgName}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6">
        <p>This is a test from Duesk, sent at ${escapeHtml(at)}.</p>
        <p>If you can read this, email from <strong>${escapeHtml(caller.orgName)}</strong> is working.</p></div>`,
      text: `This is a test from Duesk, sent at ${at}. If you can read this, email from ${caller.orgName} is working.`,
    });
    return NextResponse.json({ ok: true, from: result.from, to: caller.email });
  } catch (err) {
    return errorResponse(err);
  }
}
