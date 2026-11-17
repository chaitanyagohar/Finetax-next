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
// Only the fields the Invoices page sends; anything else in the request is ignored (S-17).
const ALLOWED_FIELDS = ["client_id", "organisation", "date", "issue_date", "due_date", "gst_rate", "notes", "items", "place_of_supply"];

export async function POST(request: NextRequest) {
  try {
    // 0. Security gates. Quotations become invoices through convert_quotation_to_invoice, not this route.
    assertSameOrigin(request);
    const caller = await requireModule("invoices");

    const supabase = await createClient();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Invalid request body.");
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiError(400, "Invalid request body.");
    }
    const raw = body as Record<string, unknown>;
    const payload: Record<string, unknown> = {};
    for (const field of ALLOWED_FIELDS) {
      if (field in raw) payload[field] = raw[field];
    }
    if (!payload.client_id || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw new ApiError(400, "Client and at least one line item are required");
    }
    if (payload.items.length > 100) {
      throw new ApiError(400, "An invoice can have at most 100 line items.");
    }

    // 1. Insert as a draft. The database works out the totals; the number is assigned on issue.
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
      metadata: { total: invoice.total, status: invoice.status },
    });

    return NextResponse.json(invoice);
  } catch (err) {
    return errorResponse(err);
  }
}