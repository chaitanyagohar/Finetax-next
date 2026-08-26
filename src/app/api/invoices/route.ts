export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { logAuditEvent } from "@/lib/audit";

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const payload = await request.json();

    if (!payload.client_id || !payload.items || !payload.items.length) {
      return NextResponse.json(
        { error: "Client and at least one line item are required" }, 
        { status: 400 }
      );
    }

    // --- 1. FETCH FIRM SETTINGS FOR CUSTOM PREFIX ---
    const { data: settings } = await supabase
      .from("firm_settings")
      .select("invoice_prefix")
      .eq("id", 1)
      .single();

    // Fallback to current year if settings table is empty
    const prefix = settings?.invoice_prefix || `INV-${new Date().getFullYear()}-`;

    // --- 2. CALCULATE NEXT SEQUENCE ---
    const { count, error: countError } = await supabase
      .from("invoices")
      .select("*", { count: "exact", head: true });
      
    let nextSeq = 1;
    if (!countError && count !== null) {
      nextSeq = count + 1;
    }

    // Combine custom prefix with a 4-digit sequence (e.g., INV-2026-0001)
    const invoiceNumber = `${prefix}${String(nextSeq).padStart(4, "0")}`;

    const finalPayload = {
      ...payload,
      invoice_number: invoiceNumber,
    };

    // --- 3. INSERT THE INVOICE ---
    const { data: invoice, error: insertError } = await supabase
      .from("invoices")
      .insert([finalPayload])
      .select()
      .single();

    if (insertError || !invoice) {
      return NextResponse.json({ error: insertError?.message || "Failed to create invoice" }, { status: 500 });
    }

    // --- 4. GENERATE AND SAVE THE DYNAMIC PDF LINK ---
    const { origin } = new URL(request.url);
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || origin;
    
    const dynamicPdfUrl = `${baseUrl}/invoices/${invoice.id}/pdf`;

    const { error: updateError } = await supabase
      .from("invoices")
      .update({ pdf_url: dynamicPdfUrl })
      .eq("id", invoice.id);
      
    if (updateError) {
      console.error("Failed to update PDF URL:", updateError.message);
    }
    
    invoice.pdf_url = dynamicPdfUrl;

    // --- 5. LOG AUDIT EVENT ---
    try {
      await logAuditEvent("CREATE_INVOICE", "INVOICES", invoice.id, { invoiceNumber });
    } catch (e) {
      console.error("Audit log failed, but invoice was created.");
    }

    return NextResponse.json(invoice);

  } catch (error: any) {
    console.error("Invoice generation error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}