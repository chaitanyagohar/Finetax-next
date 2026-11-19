export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient } from "@/lib/api/guard";
import { ensurePaymentLink, type InvoiceForLink } from "@/lib/payments/links";
import { requirePortal } from "@/lib/portal/guard";
import { UUID_RE } from "@/lib/validate";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const s = await requirePortal();
    const { id } = await params;
    if (!UUID_RE.test(id)) throw new ApiError(404, "Not found.");
    const admin = getAdminClient();
    const { data: invoice } = await admin
      .from("invoices")
      .select("id, org_id, invoice_number, status, total, amount_paid, buyer_name, organisation, clients!client_id(name, email, phone)")
      .eq("id", id)
      .eq("org_id", s.orgId)
      .eq("client_id", s.clientId)
      .maybeSingle();
    if (!invoice) throw new ApiError(404, "Invoice not found.");
    const url = await ensurePaymentLink(admin, invoice as InvoiceForLink, { strict: true });
    return NextResponse.json({ url });
  } catch (err) {
    return errorResponse(err);
  }
}
