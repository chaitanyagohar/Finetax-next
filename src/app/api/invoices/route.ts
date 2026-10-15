export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ApiError,
  assertSameOrigin,
  errorResponse,
  getSiteUrl,
  requireModule,
  writeAuditLog,
} from "@/lib/api/guard";

// Fields the browser must never set directly
const PROTECTED_FIELDS = ["id", "invoice_number", "pdf_url", "email_sent_at", "created_at", "createdAt", "updated_at"];

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

    // 1. Insert — the database assigns the next serial invoice number in the same transaction
    const { data: invoice, error } = await supabase.from("invoices").insert([payload]).select().single();

    if (error || !invoice) {
      console.error("[invoices] Insert error:", error?.message);
      throw new ApiError(400, error?.message || "Failed to create invoice");
    }

    // 2. Save the PDF link
    const dynamicPdfUrl = `${getSiteUrl(request)}/invoices/${invoice.id}/pdf`;

    const { error: updateError } = await supabase
      .from("invoices")
      .update({ pdf_url: dynamicPdfUrl })
      .eq("id", invoice.id);

    if (updateError) {
      console.error("Failed to update PDF URL:", updateError.message);
    }

    invoice.pdf_url = dynamicPdfUrl;

    // 3. Audit trail
    await writeAuditLog({
      actor: caller,
      action: "CREATE_INVOICE",
      entity: "INVOICES",
      entity_id: invoice.id,
      metadata: { invoiceNumber: invoice.invoice_number },
    });

    return NextResponse.json(invoice);
  } catch (err) {
    return errorResponse(err);
  }
}