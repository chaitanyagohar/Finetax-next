export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, errorResponse, getAdminClient } from "@/lib/api/guard";
import { pdfFileName, renderInvoicePdf } from "@/lib/pdf/firmDocuments";
import { requirePortal } from "@/lib/portal/guard";
import { UUID_RE } from "@/lib/validate";
import { sellerFor } from "@/lib/pdf/seller";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const s = await requirePortal();
    const { id } = await params;
    if (!UUID_RE.test(id)) throw new ApiError(404, "Not found.");
    const admin = getAdminClient();
    const { data: invoice } = await admin
      .from("invoices")
      .select("*, clients!client_id(*)")
      .eq("id", id)
      .eq("org_id", s.orgId)
      .eq("client_id", s.clientId)
      .not("status", "in", "(Draft,Cancelled)")
      .maybeSingle();
    if (!invoice) throw new ApiError(404, "Invoice not found.");
    const { data: firm } = await admin.from("firm_settings").select("*").eq("org_id", s.orgId).maybeSingle();
    const pdf = await renderInvoicePdf(invoice, invoice.clients, await sellerFor(invoice, firm));
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdfFileName(invoice.invoice_number, "Invoice")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
