export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireModule, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { escapeHtml, sendFirmEmail } from "@/lib/email/mailer";
import { pdfFileName, renderQuotationPdf } from "@/lib/pdf/firmDocuments";
import { EMAIL_RE, UUID_RE } from "@/lib/validate";
import { formatDate, rupees } from "@/lib/format";



export async function POST(request: NextRequest) {
  try {
    // 1. Security gates
    assertSameOrigin(request);
    const caller = await requireModule("quotations", "leads");

    if (!(await checkRateLimit(`send-email:${caller.userId}`, 30, 10 * 60 * 1000))) {
      throw new ApiError(429, "Too many emails sent in a short time. Please wait a few minutes.");
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Invalid request body.");
    }

    const quotationId = typeof body?.quotationId === "string" ? body.quotationId : "";
    const recipientEmail = typeof body?.recipientEmail === "string" ? body.recipientEmail.trim().toLowerCase() : "";

    if (!quotationId || !recipientEmail) throw new ApiError(400, "Quotation ID and recipient email are required.");
    if (!UUID_RE.test(quotationId)) throw new ApiError(400, "Invalid quotation.");
    if (!EMAIL_RE.test(recipientEmail)) throw new ApiError(400, "Please enter a valid recipient email address.");

    // 2. Quotation & firm data
    const supabase = getAdminClient();
    const loadQuotation = () =>
      supabase.from("quotations").select("*, clients!client_id(*)").eq("id", quotationId).eq("org_id", caller.orgId).maybeSingle();

    let { data: quotation, error: quoteErr } = await loadQuotation();
    if (quoteErr || !quotation) throw new ApiError(404, "Quotation not found.");

    // 3. Mark a draft as Sent first, so the client never receives a PDF stamped DRAFT
    let justSent = false;
    if (quotation.status === "Draft") {
      const { error: sendErr } = await supabase
        .from("quotations")
        .update({ status: "Sent" })
        .eq("id", quotationId)
        .eq("org_id", caller.orgId);
      if (sendErr) throw new ApiError(400, sendErr.message || "Could not mark this quotation as sent.");
      ({ data: quotation, error: quoteErr } = await loadQuotation());
      if (quoteErr || !quotation) throw new ApiError(500, "The quotation was updated but could not be reloaded. Please try again.");
      justSent = true;
    }

    const { data: firm } = await supabase.from("firm_settings").select("*").eq("org_id", caller.orgId).maybeSingle();

    const client = quotation.clients;
    const clientName = client?.name || quotation.recipient_name || quotation.organisation || "Valued Client";
    const quoteNum = quotation.quote_number || quotation.quotation_number || "Quotation";
    const firmName = firm?.firm_name || "Our firm";
    const validUntil = quotation.valid_until || quotation.validUntil;
    const gstNote = Number(quotation.gst_rate || 0) > 0 ? " (including GST)" : "";

    // 4. PDF (same design as the preview)
    const pdfBuffer = await renderQuotationPdf(quotation, client, firm);

    // 5. Email (all dynamic values escaped)
    const htmlBody = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;max-width:600px">
        <p>Dear <strong>${escapeHtml(clientName)}</strong>,</p>
        <p>Thank you for your enquiry. Please find attached our quotation <strong>${escapeHtml(quoteNum)}</strong> for <strong>${rupees(quotation.total)}</strong>${gstNote}.</p>
        ${validUntil ? `<p>This quotation is valid until <strong>${formatDate(validUntil, "")}</strong>.</p>` : ""}
        <p>Please reply to this email if you have any questions or would like to go ahead.</p>
        <p>Best regards,<br/><strong>${escapeHtml(firmName)}</strong></p>
      </div>`;
    const textBody =
      `Dear ${clientName},\n\nPlease find attached our quotation ${quoteNum} for ${rupees(quotation.total)}${gstNote}.` +
      (validUntil ? `\nValid until ${formatDate(validUntil, "")}.` : "") +
      `\n\nBest regards,\n${firmName}`;

    // 6. Send
    try {
      await sendFirmEmail({
        kind: "quotation",
        orgId: caller.orgId,
        to: recipientEmail,
        subject: `Quotation ${quoteNum} from ${firmName}`,
        html: htmlBody,
        text: textBody,
        attachments: [{ filename: pdfFileName(quoteNum, "Quotation"), content: pdfBuffer, contentType: "application/pdf" }],
      });
    } catch (e: any) {
      if (justSent) {
        throw new ApiError(502, `Quotation ${quoteNum} is marked Sent, but the email could not be sent (${e?.message || "mail error"}). You can email it again.`);
      }
      throw e;
    }

    // 7. Mark as emailed
    const { error: updateError } = await supabase
      .from("quotations")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("id", quotationId)
      .eq("org_id", caller.orgId);
    if (updateError) {
      console.error("Supabase Update Error:", updateError.message);
      throw new ApiError(500, "The email was sent, but the quotation could not be marked as emailed.");
    }

    // 8. Audit trail
    await writeAuditLog({
      actor: caller,
      action: "SEND_QUOTATION_EMAIL",
      entity: "QUOTATIONS",
      entity_id: quotationId,
      metadata: { recipientEmail, quotationNumber: quoteNum, actor_name: caller.name, user_id: caller.userId },
    });

    return NextResponse.json({ success: true, message: "Quotation emailed with the PDF attached." });
  } catch (err) {
    return errorResponse(err);
  }
}