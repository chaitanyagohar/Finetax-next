export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireModule, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { EMAIL_RE, escapeHtml, sendFirmEmail } from "@/lib/email/mailer";
import { pdfFileName, renderQuotationPdf } from "@/lib/pdf/firmDocuments";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const inr = (n: unknown) => `Rs. ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso?: string | null) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");

export async function POST(request: NextRequest) {
  try {
    // 1. Security gates
    assertSameOrigin(request);
    const caller = await requireModule("quotations", "leads");

    if (!checkRateLimit(`send-email:${caller.userId}`, 30, 10 * 60 * 1000)) {
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
    const { data: quotation, error: quoteErr } = await supabase.from("quotations").select("*, clients!client_id(*)").eq("id", quotationId).single();
    if (quoteErr || !quotation) throw new ApiError(404, "Quotation not found.");

    const { data: firm } = await supabase.from("firm_settings").select("*").eq("id", 1).maybeSingle();

    const client = quotation.clients;
    const clientName = client?.name || quotation.recipient_name || quotation.organisation || "Valued Client";
    const quoteNum = quotation.quote_number || quotation.quotation_number || "Quotation";
    const firmName = firm?.firm_name || "Our firm";
    const validUntil = quotation.valid_until || quotation.validUntil;

    // 3. PDF (same design as the preview)
    const pdfBuffer = await renderQuotationPdf(quotation, client, firm);

    // 4. Email (all dynamic values escaped)
    const htmlBody = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;max-width:600px">
        <p>Dear <strong>${escapeHtml(clientName)}</strong>,</p>
        <p>Thank you for your enquiry. Please find attached our quotation <strong>${escapeHtml(quoteNum)}</strong> for <strong>${inr(quotation.total)}</strong> (including GST).</p>
        ${validUntil ? `<p>This quotation is valid until <strong>${dmy(validUntil)}</strong>.</p>` : ""}
        <p>Please reply to this email if you have any questions or would like to go ahead.</p>
        <p>Best regards,<br/><strong>${escapeHtml(firmName)}</strong></p>
      </div>`;
    const textBody =
      `Dear ${clientName},\n\nPlease find attached our quotation ${quoteNum} for ${inr(quotation.total)} (including GST).` +
      (validUntil ? `\nValid until ${dmy(validUntil)}.` : "") +
      `\n\nBest regards,\n${firmName}`;

    // 5. Send
    await sendFirmEmail({
      to: recipientEmail,
      subject: `Quotation ${quoteNum} from ${firmName}`,
      html: htmlBody,
      text: textBody,
      attachments: [{ filename: pdfFileName(quoteNum, "Quotation"), content: pdfBuffer, contentType: "application/pdf" }],
    });

    // 6. Mark as emailed
    const { error: updateError } = await supabase.from("quotations").update({ email_sent_at: new Date().toISOString() }).eq("id", quotationId);
    if (updateError) {
      console.error("Supabase Update Error:", updateError.message);
      throw new ApiError(500, "The email was sent, but the quotation status could not be updated.");
    }

    // 7. Audit trail
    await writeAuditLog({
      action: "SEND_QUOTATION_EMAIL",
      entity: "QUOTATIONS",
      entity_id: quotationId,
      metadata: { recipientEmail, quotationNumber: quoteNum, actor_name: caller.name, user_id: caller.userId },
    });

    return NextResponse.json({ success: true, message: "Quotation email sent successfully with PDF attachment!" });
  } catch (err) {
    return errorResponse(err);
  }
}