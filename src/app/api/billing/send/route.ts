export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireAdmin, writeAuditLog } from "@/lib/api/guard";
import { issueAndEmailInvoice } from "@/lib/billing/invoiceMailer";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Approve a subscription bill: issue it and email the PDF to the client. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId : "";
    if (!UUID_RE.test(invoiceId)) throw new ApiError(400, "Invalid invoice.");

    const result = await issueAndEmailInvoice(getAdminClient(), invoiceId);
    await writeAuditLog({ actor: caller, action: "ISSUE_SUBSCRIPTION_BILL", entity: "INVOICES", entity_id: invoiceId, metadata: result });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}