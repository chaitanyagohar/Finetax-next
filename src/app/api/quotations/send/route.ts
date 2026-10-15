export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import QuotationTemplate from "./QuotationTemplate";
import {
  ApiError,
  assertSameOrigin,
  errorResponse,
  getAdminClient,
  requireModule,
  writeAuditLog,
} from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { EMAIL_RE, escapeHtml, sendFirmEmail } from "@/lib/email/mailer";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    if (!quotationId || !recipientEmail) {
      throw new ApiError(400, "Quotation ID and recipient email are required.");
    }
    if (!UUID_RE.test(quotationId)) {
      throw new ApiError(400, "Invalid quotation.");
    }
    if (!EMAIL_RE.test(recipientEmail)) {
      throw new ApiError(400, "Please enter a valid recipient email address.");
    }

    // 2. Fetch Quotation & Firm Data
    const supabase = getAdminClient();

    const { data: quotation, error: quoteErr } = await supabase
      .from("quotations")
      .select("*, clients!client_id(name, email, address, gstin, pan)")
      .eq("id", quotationId)
      .single();

    if (quoteErr || !quotation) {
      throw new ApiError(404, "Quotation not found.");
    }

    const { data: firm } = await supabase.from("firm_settings").select("*").eq("id", 1).single();

    const clientData = quotation.clients;
    const clientName = clientData?.name
      ? String(clientData.name)
      : quotation?.recipient_name
      ? String(quotation.recipient_name)
      : quotation?.organisation
      ? String(quotation.organisation)
      : "Valued Client";

    const quoteNum = quotation.quote_number || quotation.quotation_number || "QTN-000";
    const firmName = firm?.firm_name || "Finetax";

    // 3. Generate the PDF on the server
    const pdfBuffer = await renderToBuffer(
      React.createElement(QuotationTemplate, {
        quotation,
        client: clientData,
        firm,
      }) as any
    );

    // 4. Draft Email (all dynamic values escaped)
    const emailSubject = `Quotation ${quoteNum} from ${firmName}`;
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #1e293b; padding: 24px;">
        <p>Dear <strong>${escapeHtml(clientName)}</strong>,</p>
        <p>Please find attached your formal quotation <strong>${escapeHtml(quoteNum)}</strong> for proposed services.</p>
        <p>You can securely view, download, or print the full document from the PDF attachment below.</p>
        <br/>
        <p>Best regards,<br/><strong>${escapeHtml(firmName)}</strong></p>
      </div>
    `;
    const textBody =
      `Dear ${clientName},\n\n` +
      `Please find attached your formal quotation ${quoteNum} for proposed services.\n\n` +
      `Best regards,\n${firmName}`;

    // 5. Send directly via the shared mailer (no internal HTTP hop)
    await sendFirmEmail({
      to: recipientEmail,
      subject: emailSubject,
      html: htmlBody,
      text: textBody,
      attachments: [
        {
          filename: `${quoteNum.replace(/\//g, "-")}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    // 6. Update DB Status
    const { error: updateError } = await supabase
      .from("quotations")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("id", quotationId);

    if (updateError) {
      console.error("Supabase Update Error:", updateError.message);
      throw new ApiError(500, "The email was sent, but the quotation status could not be updated.");
    }

    // 7. Audit trail
    await writeAuditLog({
      action: "SEND_QUOTATION_EMAIL",
      entity: "QUOTATIONS",
      entity_id: quotationId,
      metadata: {
        recipientEmail,
        quotationNumber: quoteNum,
        actor_name: caller.name,
        user_id: caller.userId,
      },
    });

    return NextResponse.json({ success: true, message: "Quotation email sent successfully with PDF attachment!" });
  } catch (err) {
    return errorResponse(err);
  }
}