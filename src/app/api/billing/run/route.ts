export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, errorResponse, getAdminClient, requireAdmin, writeAuditLog } from "@/lib/api/guard";
import { issueAndEmailInvoice, sendPaymentReminders } from "@/lib/billing/invoiceMailer";

async function runBilling() {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("generate_subscription_bills", { p_run_date: null });
  if (error) throw new Error(error.message);

  const created: { invoice_id: string; auto_send: boolean }[] = (data as any)?.created || [];
  const results: string[] = [];
  for (const c of created.filter((x) => x.auto_send)) {
    try {
      const r = await issueAndEmailInvoice(admin, c.invoice_id);
      results.push(r.message);
    } catch (e: any) {
      results.push(`Auto-send failed: ${e?.message || e}`);
    }
  }
  const reminders = await sendPaymentReminders(admin);
  return { bills_created: created.length, drafts: (data as any)?.drafts || 0, auto_sent: results, reminders_sent: reminders };
}

/** Daily scheduled job (Vercel Cron sends the CRON_SECRET). */
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

/** "Run billing now" button (administrators). */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    const result = await runBilling();
    await writeAuditLog({ actor: caller, action: "RUN_SUBSCRIPTION_BILLING", entity: "INVOICES", entity_id: null, metadata: result });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}