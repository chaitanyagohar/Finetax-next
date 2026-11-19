export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requirePlatformOwner, writeAuditLog } from "@/lib/api/guard";
import { FEATURES } from "@/lib/features";

const KEYS = new Set(FEATURES.map((f) => f.key));
const LIMITS = ["max_users", "max_clients", "max_storage_mb", "audit_days", "max_portal_clients"] as const;

/** Changes one plan's switches and limits; every firm on that plan follows at once. */
export async function PUT(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requirePlatformOwner();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const id = typeof body?.id === "string" ? body.id : "";
    const admin = getAdminClient();
    const { data: plan } = await admin.from("plans").select("id, name, features").eq("id", id).maybeSingle();
    if (!plan) throw new ApiError(404, "Unknown plan.");

    const patch: Record<string, unknown> = {};
    if (body?.features && typeof body.features === "object") {
      const features: Record<string, boolean> = { ...(plan.features as Record<string, boolean>) };
      for (const [k, v] of Object.entries(body.features as Record<string, unknown>)) {
        if (KEYS.has(k) && typeof v === "boolean") features[k] = v;
      }
      patch.features = features;
    }
    for (const key of LIMITS) {
      if (body && key in body) {
        const v = body[key];
        if (v === null || v === "") patch[key] = null;
        else {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new ApiError(400, `${key.replace(/_/g, " ")} must be a whole number, or empty for unlimited.`);
          patch[key] = n;
        }
      }
    }
    if (typeof body?.price_note === "string") patch.price_note = body.price_note.trim().slice(0, 120) || null;
    if (!Object.keys(patch).length) throw new ApiError(400, "Nothing to change.");

    const { error } = await admin.from("plans").update(patch).eq("id", id);
    if (error) throw new ApiError(400, error.message);
    await writeAuditLog({ actor: caller, action: "UPDATE_PLAN", entity: "PLANS", metadata: { plan: id, ...patch } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
