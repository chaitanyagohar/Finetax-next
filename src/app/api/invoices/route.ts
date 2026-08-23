export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { logAuditEvent } from "@/lib/audit";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } }
  );

  const payload = await request.json();

  if (!payload.client_id || !payload.items || !payload.items.length) {
    return NextResponse.json({ error: "Client and at least one line item are required" }, { status: 400 });
  }

  const year = new Date().getFullYear();
  
  // FIX 1: Safely generate the invoice number. 
  let nextSeq = Math.floor(100 + Math.random() * 900); 
  
  const { count, error: countError } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true });
    
  if (!countError && count !== null) {
    nextSeq = count + 1;
  }

  const invoiceNumber = `INV/${year}/${String(nextSeq).padStart(3, "0")}`;

  const finalPayload = {
    ...payload,
    invoice_number: invoiceNumber,
  };

  const { data: invoice, error } = await supabase.from("invoices").insert([finalPayload]).select().single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // --- NEW CODE: GENERATE AND SAVE THE DYNAMIC PDF LINK ---
  // Grab the base URL (e.g., http://localhost:3000 or your live production domain)
  const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  
  // Construct the absolute link to your dynamic PDF page
  const dynamicPdfUrl = `${baseUrl}/invoices/${invoice.id}/pdf`;

  // Update the database row to include this URL so the Inbox can find it
  await supabase.from("invoices").update({ pdf_url: dynamicPdfUrl }).eq("id", invoice.id);
  
  // Attach it to the response object just in case the frontend needs it
  invoice.pdf_url = dynamicPdfUrl;
  // --------------------------------------------------------

  // Safely log the audit event without breaking the main flow
  try {
    await logAuditEvent("CREATE_INVOICE", "INVOICES", invoice.id, { invoiceNumber });
  } catch (e) {
    console.error("Audit log failed, but invoice was created.");
  }

  return NextResponse.json(invoice);
}