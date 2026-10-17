export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { pdfFileName, renderInvoicePdf, renderQuotationPdf } from "@/lib/pdf/firmDocuments";
import {
  ApiError,
  assertSameOrigin,
  errorResponse,
  getAdminClient,
  requireUser,
  writeAuditLog,
} from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { MAX_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_BYTES, sendFirmEmail, type MailAttachment } from "@/lib/email/mailer";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SYSTEM_ITEMS = 5;

function idsFrom(formData: FormData, key: string): string[] {
  return Array.from(new Set(formData.getAll(key).map(String).filter((id) => UUID_RE.test(id)))).slice(0, MAX_SYSTEM_ITEMS);
}

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
    const invoiceIds = idsFrom(formData, "invoiceIds");
    const quotationIds = idsFrom(formData, "quotationIds");
    const documentIds = idsFrom(formData, "documentIds");

    if (!to || !subject || !body) {
      throw new ApiError(400, "Missing required fields");
    }

    // Module access for system documents
    const has = (m: string) => caller.isAdmin || caller.moduleAccess.includes(m);
    if (invoiceIds.length && !has("invoices")) throw new ApiError(403, "You do not have access to invoices.");
    if (quotationIds.length && !(has("quotations") || has("leads"))) throw new ApiError(403, "You do not have access to quotations.");
    if (documentIds.length && !has("documents")) throw new ApiError(403, "You do not have access to the document vault.");

    if (files.length + invoiceIds.length + quotationIds.length + documentIds.length > MAX_ATTACHMENTS) {
      throw new ApiError(400, `You can attach up to ${MAX_ATTACHMENTS} files.`);
    }
    let totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new ApiError(400, "Attachments exceed the 20 MB limit.");
    }

    const attachments: MailAttachment[] = await Promise.all(
      files.map(async (file) => ({
        filename: file.name,
        content: Buffer.from(await file.arrayBuffer()),
        contentType: file.type || undefined,
      }))
    );

    if (invoiceIds.length || quotationIds.length || documentIds.length) {
      const admin = getAdminClient();

      // 1. Render system invoices / quotations as real PDF attachments
      if (invoiceIds.length || quotationIds.length) {
        const { data: firm } = await admin.from("firm_settings").select("*").eq("id", 1).single();

        for (const id of invoiceIds) {
          const { data: invoice } = await admin.from("invoices").select("*, clients!client_id(*)").eq("id", id).single();
          if (!invoice) throw new ApiError(404, "One of the selected invoices was not found.");
          const pdf = await renderInvoicePdf(invoice, invoice.clients, firm);
          attachments.push({ filename: pdfFileName(invoice.invoice_number, "Invoice"), content: pdf, contentType: "application/pdf" });
        }

        for (const id of quotationIds) {
          const { data: quotation } = await admin.from("quotations").select("*, clients!client_id(*)").eq("id", id).single();
          if (!quotation) throw new ApiError(404, "One of the selected quotations was not found.");
          const pdf = await renderQuotationPdf(quotation, quotation.clients, firm);
          attachments.push({ filename: pdfFileName(quotation.quote_number || quotation.quotation_number, "Quotation"), content: pdf, contentType: "application/pdf" });
        }
      }

      // 2. Attach the real files from the private document vault
      for (const id of documentIds) {
        const { data: doc } = await admin.from("documents").select("title, file_name, storage_path, bucket, mime_type").eq("id", id).single();
        if (!doc?.storage_path) throw new ApiError(404, "One of the selected documents has no stored file.");
        const { data: blob, error: dlErr } = await admin.storage.from(doc.bucket || "firm-documents").download(doc.storage_path);
        if (dlErr || !blob) throw new ApiError(404, `Could not read "${doc.title}" from the vault.`);
        const content = Buffer.from(await blob.arrayBuffer());
        totalBytes += content.length;
        if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new ApiError(400, "Attachments exceed the 20 MB limit. Share a link instead.");
        attachments.push({ filename: doc.file_name || doc.title, content, contentType: doc.mime_type || undefined });
      }
    }

    // 3. Dispatch via the shared mailer
    const result = await sendFirmEmail({
      to,
      subject,
      html: body.replace(/\n/g, "<br/>"),
      text: body,
      attachments,
      accountId,
    });

    // 4. Audit trail
    await writeAuditLog({
      actor: caller,
      entity: "email_messages",
      entity_id: null,
      action: "email_sent",
      metadata: {
        account_id: result.accountId,
        to: result.recipients,
        subject,
        attachment_count: attachments.length,
        invoice_ids: invoiceIds,
        quotation_ids: quotationIds,
        document_ids: documentIds,
      },
    });

    return NextResponse.json({ success: true, message: "Email sent!" });
  } catch (err) {
    return errorResponse(err);
  }
}