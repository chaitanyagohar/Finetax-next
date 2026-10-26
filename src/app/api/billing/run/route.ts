export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, errorResponse, getAdminClient, requireAdmin, writeAuditLog } from "@/lib/api/guard";
import { issueAndEmailInvoice, sendPaymentReminders } from "@/lib/billing/invoiceMailer";

/**
 * Creates due subscription bills for every firm (the database does this firm by firm),
 * auto-sends the ones marked auto-send, then sends payment reminders.
 * onlyOrgId limits reminders and the returned summary to one firm (the admin button).
 */
async function runBilling(onlyOrgId?: string) {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("generate_subscription_bills", { p_run_date: null });
  if (error) throw new Error(error.message);

  const created: { invoice_id: string; auto_send: boolean }[] = (data as any)?.created || [];

  // Which firm each new bill belongs to
  const ids = created.map((c) => c.invoice_id);
  const { data: owners } = ids.length
    ? await admin.from("invoices").select("id, org_id").in("id", ids)
    : { data: [] as { id: string; org_id: string }[] };
  const orgOf = new Map((owners || []).map((o: any) => [o.id, o.org_id as string]));
  const mine = (invoiceId: string) => !onlyOrgId || orgOf.get(invoiceId) === onlyOrgId;

  // Auto-send every new auto-send bill (any firm), otherwise it would stay a draft
  const results: { invoiceId: string; message: string }[] = [];
  for (const c of created.filter((x) => x.auto_send)) {
    try {
      const r = await issueAndEmailInvoice(admin, c.invoice_id);
      results.push({ invoiceId: c.invoice_id, message: r.message });
    } catch (e: any) {
      results.push({ invoiceId: c.invoice_id, message: `Auto-send failed: ${e?.message || e}` });
    }
  }

  const reminders = await sendPaymentReminders(admin, onlyOrgId);

  return {
    bills_created: created.filter((c) => mine(c.invoice_id)).length,
    drafts: created.filter((c) => !c.auto_send && mine(c.invoice_id)).length,
    auto_sent: results.filter((r) => mine(r.invoiceId)).map((r) => r.message),
    reminders_sent: reminders,
  };
}

/** Daily scheduled job (Vercel Cron sends the CRON_SECRET): every firm. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ success: true, ...(await runBilling()) });
  } catch (e: any) {
    console.error("[billing] scheduled run failed:", e);
    return NextResponse.json({ error: "Billing run failed." }, { status: 500 });
  }
}

/** "Run billing now" button (administrators): results and reminders for their own firm only. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    const result = await runBilling(caller.orgId);
    await writeAuditLog({ actor: caller, action: "RUN_SUBSCRIPTION_BILLING", entity: "INVOICES", entity_id: null, metadata: result });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}