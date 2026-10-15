export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { localISODate } from "@/lib/format";
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Helper: Tax Calculation Engine
function computeTotals(items: any[], isInterState: boolean, gstRate: number) {
  const subtotal = items.reduce(
    (sum, it) => sum + Number(it.qty || 1) * Number(it.rate || 0),
    0
  );
  const taxRate = Number(gstRate || 0);
  let cgst = 0,
    sgst = 0,
    igst = 0;

  if (taxRate > 0) {
    if (isInterState) {
      igst = Number(((subtotal * taxRate) / 100).toFixed(2));
    } else {
      cgst = Number(((subtotal * taxRate) / 200).toFixed(2));
      sgst = Number(((subtotal * taxRate) / 200).toFixed(2));
    }
  }

  const total = Number((subtotal + cgst + sgst + igst).toFixed(2));
  return {
    subtotal: Number(subtotal.toFixed(2)),
    cgst,
    sgst,
    igst,
    total,
  };
}

// Validates line items: quantities must be positive, rates non-negative
function normalizeItems(items: unknown): any[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, "At least one line item is required");
  }
  if (items.length > 100) {
    throw new ApiError(400, "A quotation can have at most 100 line items.");
  }
  return items.map((it) => {
    if (!it || typeof it !== "object") {
      throw new ApiError(400, "Invalid line item.");
    }
    const qty = Number((it as any).qty || 1);
    const rate = Number((it as any).rate || 0);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) {
      throw new ApiError(400, "Each line item needs a valid quantity.");
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 10_000_000_000) {
      throw new ApiError(400, "Each line item needs a valid rate.");
    }
    return { ...(it as object), qty, rate };
  });
}

// GET: Fetch Quotations list with search & filters
export async function GET(request: NextRequest) {
  try {
    await requireModule("quotations", "leads");
    const supabase = await createClient();

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    const leadId = searchParams.get("leadId");
    const status = searchParams.get("status");
    const search = searchParams.get("search");

    let query = supabase
      .from("quotations")
      .select("*, clients(name, email, phone), leads(name, company, email, phone)")
      .order("date", { ascending: false });

    if (clientId && UUID_RE.test(clientId)) query = query.eq("client_id", clientId);
    if (leadId && UUID_RE.test(leadId)) query = query.eq("lead_id", leadId);
    if (status) query = query.eq("status", status.slice(0, 40));

    const { data: quotations, error } = await query;
    if (error) {
      console.error("[quotations] List error:", error.message);
      throw new ApiError(500, "Could not load quotations.");
    }

    let filtered = quotations || [];
    if (search) {
      const s = search.toLowerCase().slice(0, 100);
      filtered = filtered.filter((q: any) =>
        [q.quote_number, q.recipient_name, q.organisation, q.notes]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(s))
      );
    }

    return NextResponse.json(filtered);
  } catch (err) {
    return errorResponse(err);
  }
}

// POST: Create New Quotation
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireModule("quotations", "leads");

    const supabase = await createClient();

    let body: any;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Invalid request body.");
    }

    const { clientId, leadId, date, validUntil, items, isInterState, gstRate, notes, organisation } = body ?? {};

    if (!clientId && !leadId) {
      throw new ApiError(400, "A client or a lead is required");
    }
    if ((clientId && !UUID_RE.test(clientId)) || (leadId && !UUID_RE.test(leadId))) {
      throw new ApiError(400, "Invalid client or lead.");
    }
    if (date && !DATE_RE.test(String(date))) {
      throw new ApiError(400, "Invalid quotation date.");
    }
    if (validUntil && !DATE_RE.test(String(validUntil))) {
      throw new ApiError(400, "Invalid validity date.");
    }

    const cleanItems = normalizeItems(items);

    const rate = Number(gstRate || 0);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new ApiError(400, "Invalid GST rate.");
    }

    let recipientName = "";
    let recipientEmail = "";
    let recipientPhone = "";

    if (clientId) {
      const { data: client } = await supabase.from("clients").select("*").eq("id", clientId).single();
      if (!client) throw new ApiError(400, "Client not found");
      recipientName = client.name;
      recipientEmail = client.email || "";
      recipientPhone = client.phone || "";
    } else {
      const { data: lead } = await supabase.from("leads").select("*").eq("id", leadId).single();
      if (!lead) throw new ApiError(400, "Lead not found");
      recipientName = lead.company || lead.name;
      recipientEmail = lead.email || "";
      recipientPhone = lead.phone || "";
    }

    const totals = computeTotals(cleanItems, Boolean(isInterState), rate);
    const year = new Date().getFullYear();
    const prefix = `QUO/${year}/`;

    const basePayload = {
      client_id: clientId || null,
      lead_id: leadId || null,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      recipient_phone: recipientPhone,
      organisation: typeof organisation === "string" ? organisation.slice(0, 200) : "",
      date: date || localISODate(),
      valid_until: validUntil || null,
      items: cleanItems,
      is_inter_state: Boolean(isInterState),
      gst_rate: rate,
      subtotal: totals.subtotal,
      tax: totals.cgst + totals.sgst + totals.igst,
      total: totals.total,
      status: "Draft",
      notes: typeof notes === "string" ? notes.slice(0, 5000) : "",
      created_at: new Date().toISOString(),
    };

    // Allocate a sequential number + insert (retry on rare collision)
    const admin = getAdminClient();
    let quote: any = null;
    let payload: any = null;

    for (let attempt = 0; attempt < 3 && !quote; attempt++) {
      const quoteNumber = await allocateDocumentNumber(admin, {
        table: "quotations",
        column: "quote_number",
        prefix,
        pad: 3,
      });
      payload = { ...basePayload, quote_number: quoteNumber };

      const { data, error } = await supabase.from("quotations").insert([payload]).select().single();

      if (!error && data) {
        quote = data;
        break;
      }
      if (error?.code === "23505") continue;

      console.error("[quotations] Insert error:", error?.message);
      throw new ApiError(500, "Failed to create quotation.");
    }

    if (!quote) {
      throw new ApiError(500, "Could not allocate a unique quotation number. Please try again.");
    }

    // Generate and save the dynamic PDF link
    const dynamicPdfUrl = `${getSiteUrl(request)}/quotations/${quote.id}/pdf`;
    await supabase.from("quotations").update({ pdf_url: dynamicPdfUrl }).eq("id", quote.id);
    quote.pdf_url = dynamicPdfUrl;

    // Audit (server-side, records the acting user)
    await writeAuditLog({
      actor: caller,
      action: "CREATE_QUOTATION",
      entity: "QUOTATIONS",
      entity_id: quote.id,
      metadata: payload,
    });

    return NextResponse.json(quote);
  } catch (err) {
    return errorResponse(err);
  }
}