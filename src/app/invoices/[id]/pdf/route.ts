export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { pdfFileName, renderInvoicePdf } from "@/lib/pdf/firmDocuments";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return new NextResponse("Invalid invoice link.", { status: 400 });

  const cookieStore = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL(`/login?redirect=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));
  }

  // Read with the user's own session, so database access rules apply
  const [{ data: invoice }, { data: firm }] = await Promise.all([
    supabase.from("invoices").select("*, clients!client_id(*)").eq("id", id).maybeSingle(),
    supabase.from("firm_settings").select("*").maybeSingle(),
  ]);
  if (!invoice) return new NextResponse("Invoice not found, or you don't have access to it.", { status: 404 });

  try {
    const pdf = await renderInvoicePdf(invoice, invoice.clients, firm);
    const download = request.nextUrl.searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${pdfFileName(invoice.invoice_number, "Invoice")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[invoice-pdf] render failed:", err);
    return new NextResponse("Could not generate the PDF. Please try again.", { status: 500 });
  }
}