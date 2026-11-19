/**
 * Payment links for invoices. SERVER ONLY.
 * One open link per invoice and amount: asking again returns the same link, and a link for an
 * old balance is cancelled when the balance changes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/guard";
import { cancelPaymentLink, createPaymentLink, gatewayKeys } from "@/lib/payments/razorpay";

type ClientBits = { name?: string | null; email?: string | null; phone?: string | null };

export interface InvoiceForLink {
  id: string;
  org_id: string;
  invoice_number: string | null;
  status: string | null;
  total: number | string | null;
  amount_paid: number | string | null;
  buyer_name?: string | null;
  organisation?: string | null;
  clients?: ClientBits | ClientBits[] | null;
}

export function balanceOf(inv: Pick<InvoiceForLink, "total" | "amount_paid">): number {
  return Math.max(0, Math.round((Number(inv.total || 0) - Number(inv.amount_paid || 0)) * 100) / 100);
}

/**
 * Returns the open payment link for the invoice's balance, creating one if needed.
 * Returns null when the firm has not connected Razorpay or nothing is due.
 */
export async function ensurePaymentLink(
  admin: SupabaseClient,
  invoice: InvoiceForLink,
  opts: { createdBy?: string | null; strict?: boolean } = {},
): Promise<string | null> {
  const fail = (status: number, message: string) => {
    if (opts.strict) throw new ApiError(status, message);
    return null;
  };

  if (!invoice.status || invoice.status === "Draft" || invoice.status === "Cancelled") {
    return fail(400, "Issue the invoice before creating a payment link.");
  }
  const balance = balanceOf(invoice);
  if (balance <= 0) return fail(400, "Nothing is due on this invoice.");

  const keys = await gatewayKeys(admin, invoice.org_id);
  if (!keys || !keys.isActive) return fail(400, "Connect Razorpay in Settings → Payments first.");

  const { data: open } = await admin
    .from("invoice_payment_links")
    .select("id, provider_link_id, short_url, amount")
    .eq("invoice_id", invoice.id)
    .eq("org_id", invoice.org_id)
    .eq("status", "created")
    .order("created_at", { ascending: false });

  const current = (open || []).find((l) => Math.abs(Number(l.amount) - balance) < 0.005);
  for (const stale of (open || []).filter((l) => l !== current)) {
    await cancelPaymentLink(keys, stale.provider_link_id);
    await admin.from("invoice_payment_links").update({ status: "cancelled" }).eq("id", stale.id);
  }
  if (current) return current.short_url;

  const client: ClientBits = (Array.isArray(invoice.clients) ? invoice.clients[0] : invoice.clients) || {};
  const phone = String(client.phone || "").replace(/\D/g, "").slice(-10);
  const link = await createPaymentLink(keys, {
    amountPaise: Math.round(balance * 100),
    description: `Invoice ${invoice.invoice_number || ""}`.trim(),
    reference: `${invoice.invoice_number || "INV"}-${Date.now().toString(36)}`,
    notes: { invoice_id: invoice.id, org_id: invoice.org_id },
    customer: {
      name: (invoice.buyer_name || invoice.organisation || client.name || "").slice(0, 100) || undefined,
      email: client.email || undefined,
      contact: phone.length === 10 ? phone : undefined,
    },
  });

  const { error } = await admin.from("invoice_payment_links").insert({
    org_id: invoice.org_id,
    invoice_id: invoice.id,
    provider_link_id: link.id,
    short_url: link.short_url,
    amount: balance,
    created_by: opts.createdBy ?? null,
  });
  if (error) console.error("[payments] could not store link:", error.message);
  return link.short_url;
}
