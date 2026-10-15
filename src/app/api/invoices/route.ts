export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ApiError,
  assertSameOrigin,
  errorResponse,
  getAdminClient,
  getSiteUrl,
  requireModule,
  writeAuditLog,
} from "@/lib/api/guard";
import { allocateDocumentNumber } from "@/lib/api/numbering";

// Fields the browser must never set directly
const PROTECTED_FIELDS = ["id", "invoice_number", "pdf_url", "email_sent_at", "created_at", "updated_at"];

export async function POST(request: NextRequest) {
  try {
    // 0. Security gates (invoices module, or quotations for quote → invoice conversion)
    assertSameOrigin(request);
    const caller = await requireModule("invoices", "quotations");

    const supabase = await createClient();

    let payload: any;
    try {
      payload = await request.json();
    } catch {
      throw new ApiError(400, "Invalid request body.");
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new ApiError(400, "Invalid request body.");
    }
    if (!payload.client_id || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw new ApiError(400, "Client and at least one line item are required");
    }
    if (payload.items.length > 100) {
      throw new ApiError(400, "An invoice can have at most 100 line items.");
    }

    for (const field of PROTECTED_FIELDS) {
      delete payload[field];
    }

    // --- 1. FETCH FIRM SETTINGS FOR CUSTOM PREFIX ---
    const { data: settings } = await supabase
      .from("firm_settings")
      .select("invoice_prefix")
      .eq("id", 1)
      .single();

    // Fallback to current year if settings table is empty
    const prefix = String(settings?.invoice_prefix || `INV-${new Date().getFullYear()}-`).trim();

    // --- 2. ALLOCATE NUMBER + INSERT (atomic counter, retry on rare collision) ---
    const admin = getAdminClient();
    let invoice: any = null;
    let invoiceNumber = "";

    for (let attempt = 0; attempt < 3 && !invoice; attempt++) {
      invoiceNumber = await allocateDocumentNumber(admin, {
        table: "invoices",
        column: "invoice_number",
        prefix,
        pad: 4,
      });

      const { data, error } = await supabase
        .from("invoices")
        .insert([{ ...payload, invoice_number: invoiceNumber }])
        .select()
        .single();

      if (!error && data) {
        invoice = data;
        break;
      }
      if (error?.code === "23505") continue; // Duplicate number: allocate the next one

      console.error("[invoices] Insert error:", error?.message);
      throw new ApiError(500, "Failed to create invoice");
    }

    if (!invoice) {
      throw new ApiError(500, "Could not allocate a unique invoice number. Please try again.");
    }

    // --- 3. GENERATE AND SAVE THE DYNAMIC PDF LINK ---
    const dynamicPdfUrl = `${getSiteUrl(request)}/invoices/${invoice.id}/pdf`;

    const { error: updateError } = await supabase
      .from("invoices")
      .update({ pdf_url: dynamicPdfUrl })
      .eq("id", invoice.id);

    if (updateError) {
      console.error("Failed to update PDF URL:", updateError.message);
    }

    invoice.pdf_url = dynamicPdfUrl;

    // --- 4. LOG AUDIT EVENT (server-side, records the acting user) ---
    await writeAuditLog({
      actor: caller,
      action: "CREATE_INVOICE",
      entity: "INVOICES",
      entity_id: invoice.id,
      metadata: { invoiceNumber },
    });

    return NextResponse.json(invoice);
  } catch (err) {
    return errorResponse(err);
  }
}