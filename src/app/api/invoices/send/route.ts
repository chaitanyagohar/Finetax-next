export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireModule, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { EMAIL_RE, escapeHtml, sendFirmEmail } from "@/lib/email/mailer";
import { pdfFileName, renderInvoicePdf } from "@/lib/pdf/firmDocuments";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const inr = (n: unknown) => `Rs. ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso?: string | null) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");

export async function POST(request: NextRequest) {
  try {
    // 1. Security gates
    assertSameOrigin(request);
    const caller = await requireModule("invoices");

    if (!checkRateLimit(`send-email:${caller.userId}`, 30, 10 * 60 * 1000)) {
      throw new ApiError(429, "Too many emails sent in a short time. Please wait a few minutes.");
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Invalid request body.");
    }

    const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId : "";
    const recipientEmail = typeof body?.recipientEmail === "string" ? body.recipientEmail.trim().toLowerCase() : "";

    if (!invoiceId || !recipientEmail) throw new ApiError(400, "Invoice ID and recipient email are required.");
    if (!UUID_RE.test(invoiceId)) throw new ApiError(400, "Invalid invoice.");
    if (!EMAIL_RE.test(recipientEmail)) throw new ApiError(400, "Please enter a valid recipient email address.");

    // 2. Invoice & firm data
    const supabase = getAdminClient();
    const { data: invoice, error: invErr } = await supabase.from("invoices").select("*, clients!client_id(*)").eq("id", invoiceId).single();
    if (invErr || !invoice) throw new ApiError(404, "Invoice not found.");
    if (invoice.status === "Cancelled") throw new ApiError(400, "This invoice is cancelled and can't be emailed.");

    const { data: firm } = await supabase.from("firm_settings").select("*").eq("id", 1).maybeSingle();

    const client = invoice.clients;
    const clientName = client?.name || invoice.organisation || "Valued Client";
    const invNum = invoice.invoice_number || "Invoice";
    const firmName = firm?.firm_name || "Our firm";
    const balance = Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0));

    // 3. PDF (same design as the preview)
    const pdfBuffer = await renderInvoicePdf(invoice, client, firm);

    // 4. Email (all dynamic values escaped)
    const paymentLines = [
      balance > 0 ? `<strong>Amount payable:</strong> ${inr(balance)}${invoice.due_date ? ` by <strong>${dmy(invoice.due_date)}</strong>` : ""}` : "<strong>Status:</strong> Paid in full. Thank you!",
      balance > 0 && firm?.upi_id ? `<strong>UPI:</strong> ${escapeHtml(firm.upi_id)}` : "",
      balance > 0 && firm?.bank_account_no
        ? `<strong>Bank:</strong> ${escapeHtml(firm.bank_name || "")} · A/C ${escapeHtml(firm.bank_account_no)} · IFSC ${escapeHtml(firm.bank_ifsc || "")}`
        : "",
    ].filter(Boolean);

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;max-width:600px">
        <p>Dear <strong>${escapeHtml(clientName)}</strong>,</p>
        <p>Please find attached tax invoice <strong>${escapeHtml(invNum)}</strong>${invoice.date ? ` dated ${dmy(invoice.date)}` : ""} for <strong>${inr(invoice.total)}</strong>.</p>
        <p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px">${paymentLines.join("<br/>")}</p>
        ${balance > 0 ? "<p>Please mention the invoice number when you pay.</p>" : ""}
        <p>Best regards,<br/><strong>${escapeHtml(firmName)}</strong></p>
      </div>`;
    const textBody =
      `Dear ${clientName},\n\nPlease find attached tax invoice ${invNum} for ${inr(invoice.total)}.` +
      (balance > 0 ? `\nAmount payable: ${inr(balance)}${invoice.due_date ? ` by ${dmy(invoice.due_date)}` : ""}.` : "\nPaid in full. Thank you!") +
      `\n\nBest regards,\n${firmName}`;

    // 5. Send
    await sendFirmEmail({
      to: recipientEmail,
      subject: `Tax Invoice ${invNum} from ${firmName}`,
      html: htmlBody,
      text: textBody,
      attachments: [{ filename: pdfFileName(invNum, "Invoice"), content: pdfBuffer, contentType: "application/pdf" }],
    });

    // 6. Mark as emailed
    const { error: updateError } = await supabase.from("invoices").update({ email_sent_at: new Date().toISOString() }).eq("id", invoiceId);
    if (updateError) {
      console.error("Supabase Update Error:", updateError.message);
      throw new ApiError(500, "The email was sent, but the invoice status could not be updated.");
    }

    // 7. Audit trail
    await writeAuditLog({
      action: "SEND_INVOICE_EMAIL",
      entity: "INVOICES",
      entity_id: invoiceId,
      metadata: { recipientEmail, invoiceNumber: invNum, actor_name: caller.name, user_id: caller.userId },
    });

    return NextResponse.json({ success: true, message: "Invoice email sent successfully with PDF attachment!" });
  } catch (err) {
    return errorResponse(err);
  }
}