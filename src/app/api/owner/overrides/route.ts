export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requirePlatformOwner, writeAuditLog } from "@/lib/api/guard";
import { FEATURES } from "@/lib/features";
import { UUID_RE } from "@/lib/validate";

const KEYS = new Set(FEATURES.map((f) => f.key));

export async function GET(request: NextRequest) {
  try {
    await requirePlatformOwner();
    const org = request.nextUrl.searchParams.get("org") || "";
    if (!UUID_RE.test(org)) throw new ApiError(400, "Invalid firm.");
    const { data } = await getAdminClient().from("org_feature_overrides").select("feature, enabled, expires_at, note, created_at").eq("org_id", org);
    return NextResponse.json({ overrides: data || [] });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Gives one firm a feature its plan lacks (or takes one away), optionally until a date. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requirePlatformOwner();
    const body = (await request.json().catch(() => null)) as { orgId?: unknown; feature?: unknown; enabled?: unknown; expiresAt?: unknown; note?: unknown } | null;
    const orgId = typeof body?.orgId === "string" ? body.orgId : "";
    const feature = typeof body?.feature === "string" ? body.feature : "";
    if (!UUID_RE.test(orgId) || !KEYS.has(feature) || typeof body?.enabled !== "boolean") throw new ApiError(400, "Invalid request.");
    let expires: string | null = null;
    if (typeof body?.expiresAt === "string" && body.expiresAt) {
      const t = Date.parse(body.expiresAt);
      if (!Number.isFinite(t) || t < Date.now()) throw new ApiError(400, "The end date must be in the future.");
      expires = new Date(t).toISOString();
    }
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 300) || null : null;
    const { error } = await getAdminClient()
      .from("org_feature_overrides")
      .upsert({ org_id: orgId, feature, enabled: body.enabled, expires_at: expires, note, created_by: caller.userId }, { onConflict: "org_id,feature" });
    if (error) throw new ApiError(400, error.message);
    await writeAuditLog({ actor: caller, action: "FEATURE_OVERRIDE", entity: "PLANS", entity_id: orgId, metadata: { feature, enabled: body.enabled, expires } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requirePlatformOwner();
    const body = (await request.json().catch(() => null)) as { orgId?: unknown; feature?: unknown } | null;
    const orgId = typeof body?.orgId === "string" ? body.orgId : "";
    const feature = typeof body?.feature === "string" ? body.feature : "";
    if (!UUID_RE.test(orgId) || !KEYS.has(feature)) throw new ApiError(400, "Invalid request.");
    await getAdminClient().from("org_feature_overrides").delete().eq("org_id", orgId).eq("feature", feature);
    await writeAuditLog({ actor: caller, action: "FEATURE_OVERRIDE_REMOVED", entity: "PLANS", entity_id: orgId, metadata: { feature } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
