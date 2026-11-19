export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireModule, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { ensurePaymentLink, type InvoiceForLink } from "@/lib/payments/links";
import { UUID_RE } from "@/lib/validate";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireModule("invoices");
    if (!(await checkRateLimit(`pay-link:${caller.userId}`, 30, 10 * 60 * 1000))) {
      throw new ApiError(429, "Too many requests. Please wait a few minutes.");
    }
    const body = (await request.json().catch(() => null)) as { invoiceId?: unknown } | null;
    const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId : "";
    if (!UUID_RE.test(invoiceId)) throw new ApiError(400, "Invalid invoice.");

    const admin = getAdminClient();
    const { data: invoice } = await admin
      .from("invoices")
      .select("id, org_id, invoice_number, status, total, amount_paid, buyer_name, organisation, clients!client_id(name, email, phone)")
      .eq("id", invoiceId)
      .eq("org_id", caller.orgId)
      .maybeSingle();
    if (!invoice) throw new ApiError(404, "Invoice not found.");

    const url = await ensurePaymentLink(admin, invoice as InvoiceForLink, { createdBy: caller.userId, strict: true });
    await writeAuditLog({ actor: caller, action: "PAYMENT_LINK", entity: "INVOICES", entity_id: invoiceId, metadata: { invoiceNumber: invoice.invoice_number } });
    return NextResponse.json({ url });
  } catch (err) {
    return errorResponse(err);
  }
}
