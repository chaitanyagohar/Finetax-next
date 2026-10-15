export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import {
  ApiError,
  assertSameOrigin,
  errorResponse,
  requireUser,
  writeAuditLog,
} from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { MAX_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_BYTES, sendFirmEmail } from "@/lib/email/mailer";

export async function POST(request: NextRequest) {
  try {
    // 0. Security gates
    assertSameOrigin(request);
    const caller = await requireUser();

    if (!checkRateLimit(`send-email:${caller.userId}`, 30, 10 * 60 * 1000)) {
      throw new ApiError(429, "Too many emails sent in a short time. Please wait a few minutes.");
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new ApiError(400, "Invalid request.");
    }

    const to = String(formData.get("to") || "").trim();
    const subject = String(formData.get("subject") || "").trim();
    const body = String(formData.get("body") || "");
    const accountId = (formData.get("accountId") as string | null) || null;
    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

    if (!to || !subject || !body) {
      throw new ApiError(400, "Missing required fields");
    }

    // Check sizes before reading files into memory
    if (files.length > MAX_ATTACHMENTS) {
      throw new ApiError(400, `You can attach up to ${MAX_ATTACHMENTS} files.`);
    }
    if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new ApiError(400, "Attachments exceed the 20 MB limit.");
    }

    const attachments = await Promise.all(
      files.map(async (file) => ({
        filename: file.name,
        content: Buffer.from(await file.arrayBuffer()),
        contentType: file.type || undefined,
      }))
    );

    // 1. Dispatch via the shared mailer
    const result = await sendFirmEmail({
      to,
      subject,
      html: body.replace(/\n/g, "<br/>"),
      text: body,
      attachments,
      accountId,
    });

    // 2. Audit trail
    await writeAuditLog({
      entity: "email_messages",
      entity_id: null,
      action: "email_sent",
      metadata: {
        sent_by: caller.userId,
        sent_by_email: caller.email,
        account_id: result.accountId,
        to: result.recipients,
        subject,
        attachment_count: attachments.length,
      },
    });

    return NextResponse.json({ success: true, message: "Email sent!" });
  } catch (err) {
    return errorResponse(err);
  }
}