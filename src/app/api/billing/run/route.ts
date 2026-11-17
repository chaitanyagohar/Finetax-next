export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireAdmin, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { issueAndEmailInvoice, sendPaymentReminders } from "@/lib/billing/invoiceMailer";
import { istDate } from "@/lib/format";

const SEND_BUDGET_MS = 40_000; // stop starting new emails after this; the rest go next run
const REMINDER_BUDGET_MS = 50_000;


/**
 * 1. Creates due subscription bills (one firm for the button, every firm for the daily job).
 * 2. Issues and emails every waiting draft of an auto-send subscription, including any left over
 *    from an earlier run that ran out of time.
 * 3. Sends payment reminders.
 */
async function runBilling(onlyOrgId?: string) {
  const admin = getAdminClient();
  const started = Date.now();

  const { data, error } = await admin.rpc("generate_subscription_bills", {
    p_run_date: null,
    p_org: onlyOrgId ?? null,
  });
  if (error) throw new Error(error.message);
  const created: { invoice_id: string; auto_send: boolean }[] = (data as any)?.created || [];

  // Every draft bill of an auto-send subscription, oldest first
  let subsQuery = admin.from("client_packages").select("id").eq("auto_send", true);
  if (onlyOrgId) subsQuery = subsQuery.eq("org_id", onlyOrgId);
  const { data: subs } = await subsQuery;
  const subIds = (subs || []).map((s: any) => s.id as string);

  let pending: { id: string }[] = [];
  if (subIds.length) {
    let invQuery = admin
      .from("invoices")
      .select("id")
      .eq("status", "Draft")
      .in("client_package_id", subIds)
      .lte("date", istDate())
      .order("date", { ascending: true })
      .limit(100);
    if (onlyOrgId) invQuery = invQuery.eq("org_id", onlyOrgId);
    const { data: inv } = await invQuery;
    pending = (inv || []) as { id: string }[];
  }

  const sent: string[] = [];
  let deferred = 0;
  for (let i = 0; i < pending.length; i++) {
    if (Date.now() - started > SEND_BUDGET_MS) {
      deferred = pending.length - i;
      break;
    }
    try {
      const r = await issueAndEmailInvoice(admin, pending[i].id);
      sent.push(r.message);
    } catch (e: any) {
      sent.push(`Auto-send failed: ${e?.message || e}`);
    }
  }

  let reminders: Awaited<ReturnType<typeof sendPaymentReminders>> | null = null;
  if (Date.now() - started < REMINDER_BUDGET_MS) {
    reminders = await sendPaymentReminders(admin, onlyOrgId);
  }

  return {
    bills_created: created.length,
    drafts: created.filter((c) => !c.auto_send).length,
    auto_sent: sent,
    deferred_to_next_run: deferred,
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

/** "Run billing now" button (administrators): their own firm only. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    if (!(await checkRateLimit(`billing-run:${caller.orgId}`, 3, 60 * 60 * 1000))) {
      throw new ApiError(429, "Billing can be run at most 3 times an hour. The daily run happens automatically at 9:00.");
    }
    const result = await runBilling(caller.orgId);
    await writeAuditLog({ actor: caller, action: "RUN_SUBSCRIPTION_BILLING", entity: "INVOICES", entity_id: null, metadata: result });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}