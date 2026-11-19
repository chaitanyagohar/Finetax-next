export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireAdmin, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { checkKeys } from "@/lib/payments/razorpay";

const KEY_ID_RE = /^rzp_(test|live)_[A-Za-z0-9]{8,32}$/;

/** Saves the firm's Razorpay keys after checking them with Razorpay. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    if (!(await checkRateLimit(`gateway:${caller.orgId}`, 10, 10 * 60 * 1000))) {
      throw new ApiError(429, "Too many attempts. Please wait a few minutes.");
    }

    const body = (await request.json().catch(() => null)) as { keyId?: unknown; keySecret?: unknown; webhookSecret?: unknown } | null;
    const keyId = typeof body?.keyId === "string" ? body.keyId.trim() : "";
    const keySecret = typeof body?.keySecret === "string" ? body.keySecret.trim() : "";
    const webhookSecret = typeof body?.webhookSecret === "string" ? body.webhookSecret.trim() : "";
    if (!KEY_ID_RE.test(keyId)) throw new ApiError(400, "The key ID starts with rzp_live_ or rzp_test_.");
    if (webhookSecret && (webhookSecret.length < 8 || webhookSecret.length > 200)) {
      throw new ApiError(400, "The webhook secret should be 8 to 200 characters.");
    }

    const admin = getAdminClient();
    const { data: existing } = await admin.from("payment_gateways").select("key_id").eq("org_id", caller.orgId).maybeSingle();
    if (!keySecret && (!existing || existing.key_id !== keyId)) throw new ApiError(400, "Enter the key secret.");

    // Keys are checked with Razorpay only when a new secret is given
    if (keySecret) await checkKeys(keyId, keySecret);

    const row = {
      org_id: caller.orgId,
      key_id: keyId,
      is_active: true,
      ...(keySecret ? { key_secret: keySecret } : {}),
      ...(webhookSecret ? { webhook_secret: webhookSecret } : {}),
    };
    const { error } = existing
      ? await admin.from("payment_gateways").update(row).eq("org_id", caller.orgId)
      : await admin.from("payment_gateways").insert({ ...row, connected_by: caller.userId });
    if (error) throw new ApiError(400, error.message);

    await writeAuditLog({
      actor: caller,
      action: existing ? "UPDATE_PAYMENT_GATEWAY" : "CONNECT_PAYMENT_GATEWAY",
      entity: "SETTINGS",
      metadata: { provider: "razorpay", mode: keyId.startsWith("rzp_live_") ? "live" : "test", webhook: !!webhookSecret },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Turns online payment off and forgets the keys. Links already sent stop being created anew. */
export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    const { error } = await getAdminClient().from("payment_gateways").delete().eq("org_id", caller.orgId);
    if (error) throw new ApiError(400, error.message);
    await writeAuditLog({ actor: caller, action: "DISCONNECT_PAYMENT_GATEWAY", entity: "SETTINGS", metadata: { provider: "razorpay" } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
