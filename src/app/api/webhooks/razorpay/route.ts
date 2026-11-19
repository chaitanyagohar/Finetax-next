export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient, writeAuditLog } from "@/lib/api/guard";
import { gatewayKeys, paymentMode, validSignature } from "@/lib/payments/razorpay";
import { istDate } from "@/lib/format";
import { UUID_RE } from "@/lib/validate";

const MAX_BYTES = 256 * 1024;

type LinkEvent = {
  event?: string;
  payload?: {
    payment_link?: { entity?: { id?: string; notes?: Record<string, string> } };
    payment?: { entity?: { id?: string; amount?: number; method?: string; created_at?: number } };
  };
};

/**
 * Razorpay calls this when a payment link is paid, cancelled or expired.
 * Each firm sets its own URL: /api/webhooks/razorpay?firm=<firm id> (shown in Settings → Payments).
 * The firm's webhook secret signs every call; anything unsigned is refused.
 */
export async function POST(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("firm") || "";
  if (!UUID_RE.test(orgId)) return NextResponse.json({ error: "Unknown firm." }, { status: 404 });

  const raw = await request.text();
  if (!raw || raw.length > MAX_BYTES) return NextResponse.json({ error: "Bad payload." }, { status: 400 });

  const admin = getAdminClient();
  const keys = await gatewayKeys(admin, orgId).catch(() => null);
  if (!keys?.webhookSecret) return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });

  const signature = request.headers.get("x-razorpay-signature") || "";
  if (!validSignature(raw, signature, keys.webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let body: LinkEvent;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad payload." }, { status: 400 });
  }

  const linkId = body.payload?.payment_link?.entity?.id || "";
  const stamp = () => admin.from("payment_gateways").update({ last_event_at: new Date().toISOString(), last_error: null }).eq("org_id", orgId);

  if (!linkId) {
    await stamp();
    return NextResponse.json({ ok: true });
  }

  const { data: link } = await admin
    .from("invoice_payment_links")
    .select("id, invoice_id, status")
    .eq("provider_link_id", linkId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!link) {
    // Not one of ours (another app on the same Razorpay account)
    await stamp();
    return NextResponse.json({ ok: true });
  }

  if (body.event === "payment_link.cancelled" || body.event === "payment_link.expired") {
    await admin.from("invoice_payment_links").update({ status: body.event.endsWith("cancelled") ? "cancelled" : "expired" }).eq("id", link.id);
    await stamp();
    return NextResponse.json({ ok: true });
  }

  if (body.event !== "payment_link.paid") {
    await stamp();
    return NextResponse.json({ ok: true });
  }

  const payment = body.payload?.payment?.entity;
  const paymentId = payment?.id || "";
  const amount = Math.round(Number(payment?.amount || 0)) / 100;
  if (!paymentId || !(amount > 0)) return NextResponse.json({ error: "Bad payload." }, { status: 400 });

  // Razorpay retries deliveries; a payment already recorded is acknowledged and left alone
  const { data: already } = await admin.from("invoice_payments").select("id").eq("gateway_payment_id", paymentId).maybeSingle();
  if (already) return NextResponse.json({ ok: true });

  await admin.from("invoice_payment_links").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", link.id);

  const paidOn = payment?.created_at ? istDate(new Date(payment.created_at * 1000)) : istDate();
  const { error } = await admin.from("invoice_payments").insert({
    invoice_id: link.invoice_id,
    org_id: orgId,
    amount,
    paid_on: paidOn,
    mode: paymentMode(payment?.method),
    reference: paymentId,
    gateway_payment_id: paymentId,
    notes: "Recorded automatically from Razorpay.",
  });

  if (error) {
    // 23505: recorded by a delivery that arrived at the same moment; anything else is kept for the firm to see
    if (error.code !== "23505") {
      console.error("[razorpay] could not record payment:", error.message);
      await admin
        .from("payment_gateways")
        .update({ last_event_at: new Date().toISOString(), last_error: `Payment ${paymentId} of ₹${amount} could not be recorded: ${error.message}`.slice(0, 500) })
        .eq("org_id", orgId);
    }
    return NextResponse.json({ ok: true });
  }

  await stamp();
  await writeAuditLog({
    orgId,
    action: "ONLINE_PAYMENT",
    entity: "INVOICES",
    entity_id: link.invoice_id,
    metadata: { amount, paymentId, mode: paymentMode(payment?.method) },
  });
  return NextResponse.json({ ok: true });
}
