import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { logAuditEvent } from "@/lib/audit";

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

// GET: Fetch Quotations list with search & filters
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } }
  );

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId");
  const leadId = searchParams.get("leadId");
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  let query = supabase
    .from("quotations")
    .select("*, clients(name, email, phone), leads(name, company, email, phone)")
    .order("date", { ascending: false });

  if (clientId) query = query.eq("client_id", clientId);
  if (leadId) query = query.eq("lead_id", leadId);
  if (status) query = query.eq("status", status);

  const { data: quotations, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let filtered = quotations || [];
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter((q) =>
      [q.quote_number, q.recipient_name, q.organisation, q.notes]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(s))
    );
  }

  return NextResponse.json(filtered);
}

// POST: Create New Quotation
// POST: Create New Quotation
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } }
  );

  const body = await request.json();
  const { clientId, leadId, date, validUntil, items, isInterState, gstRate, notes, organisation } = body;

  if (!clientId && !leadId) {
    return NextResponse.json({ error: "A client or a lead is required" }, { status: 400 });
  }
  if (!items || !items.length) {
    return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
  }

  let recipientName = "";
  let recipientEmail = "";
  let recipientPhone = "";

  if (clientId) {
    const { data: client } = await supabase.from("clients").select("*").eq("id", clientId).single();
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 400 });
    recipientName = client.name;
    recipientEmail = client.email || "";
    recipientPhone = client.phone || "";
  } else {
    const { data: lead } = await supabase.from("leads").select("*").eq("id", leadId).single();
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 400 });
    recipientName = lead.company || lead.name;
    recipientEmail = lead.email || "";
    recipientPhone = lead.phone || "";
  }

  const totals = computeTotals(items, Boolean(isInterState), Number(gstRate || 0));
  const year = new Date().getFullYear();
  const quoteNumber = `QUO/${year}/${Math.floor(100 + Math.random() * 900)}`;

  const payload = {
    quote_number: quoteNumber,
    client_id: clientId || null,
    lead_id: leadId || null,
    recipient_name: recipientName,
    recipient_email: recipientEmail,
    recipient_phone: recipientPhone,
    organisation: organisation || "",
    date: date || new Date().toISOString().slice(0, 10),
    valid_until: validUntil || null,
    items,
    is_inter_state: Boolean(isInterState),
    gst_rate: Number(gstRate || 0),
    subtotal: totals.subtotal,
    tax: totals.cgst + totals.sgst + totals.igst,
    total: totals.total,
    status: "Draft",
    notes: notes || "",
    created_at: new Date().toISOString(),
  };

  const { data: quote, error } = await supabase.from("quotations").insert([payload]).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // --- NEW CODE: GENERATE AND SAVE THE DYNAMIC PDF LINK ---
  const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const dynamicPdfUrl = `${baseUrl}/quotations/${quote.id}/pdf`;

  await supabase.from("quotations").update({ pdf_url: dynamicPdfUrl }).eq("id", quote.id);
  quote.pdf_url = dynamicPdfUrl;
  // --------------------------------------------------------

  await logAuditEvent("CREATE_QUOTATION", "QUOTATIONS", quote.id, payload);
  return NextResponse.json(quote);
}