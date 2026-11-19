/**
 * Razorpay, called with each firm's own keys (stored in Vault, migration 050).
 * SERVER ONLY. Talks to the Razorpay REST API directly, so there is no extra package.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/guard";

const API = "https://api.razorpay.com/v1";

export interface GatewayKeys {
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
  isActive: boolean;
}

export async function gatewayKeys(admin: SupabaseClient, orgId: string): Promise<GatewayKeys | null> {
  const { data, error } = await admin.rpc("get_payment_gateway_secrets", { p_org: orgId });
  if (error) {
    console.error("[razorpay] key lookup failed:", error.message);
    throw new ApiError(500, "Could not load the payment settings.");
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.key_id || !row?.key_secret) return null;
  return { keyId: row.key_id, keySecret: row.key_secret, webhookSecret: row.webhook_secret || null, isActive: !!row.is_active };
}

async function call<T>(keys: Pick<GatewayKeys, "keyId" | "keySecret">, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: init?.method || "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString("base64")}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(502, "Razorpay could not be reached. Please try again.");
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } } & T;
  if (res.status === 401) throw new ApiError(400, "Razorpay rejected these keys. Check the key ID and key secret.");
  if (!res.ok) throw new ApiError(502, `Razorpay: ${json?.error?.description || `error ${res.status}`}`);
  return json;
}

/** A cheap authenticated call, used to check keys before saving them. */
export async function checkKeys(keyId: string, keySecret: string): Promise<void> {
  await call({ keyId, keySecret }, "/payment_links?count=1");
}

export interface CreatedLink {
  id: string;
  short_url: string;
  status: string;
}

export async function createPaymentLink(
  keys: GatewayKeys,
  p: { amountPaise: number; description: string; reference: string; notes: Record<string, string>; customer: { name?: string; email?: string; contact?: string }; callbackUrl?: string },
): Promise<CreatedLink> {
  const customer = Object.fromEntries(Object.entries(p.customer).filter(([, v]) => !!v));
  return call<CreatedLink>(keys, "/payment_links", {
    method: "POST",
    body: {
      amount: p.amountPaise,
      currency: "INR",
      accept_partial: false,
      description: p.description.slice(0, 2048),
      reference_id: p.reference.slice(0, 40),
      ...(Object.keys(customer).length ? { customer } : {}),
      // The firm sends its own emails and reminders
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: p.notes,
      ...(p.callbackUrl ? { callback_url: p.callbackUrl, callback_method: "get" } : {}),
    },
  });
}

export async function cancelPaymentLink(keys: GatewayKeys, linkId: string): Promise<void> {
  try {
    await call(keys, `/payment_links/${encodeURIComponent(linkId)}/cancel`, { method: "POST" });
  } catch (e) {
    // A link that was already paid, cancelled or expired cannot be cancelled again; that is fine
    console.warn("[razorpay] cancel failed:", e instanceof Error ? e.message : e);
  }
}

export function validSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const METHOD_LABEL: Record<string, string> = {
  upi: "UPI",
  card: "Card",
  netbanking: "Net banking",
  wallet: "Wallet",
  emi: "EMI",
  bank_transfer: "Bank transfer",
};

export function paymentMode(method: unknown): string {
  return `Razorpay (${METHOD_LABEL[String(method)] || "online"})`;
}
