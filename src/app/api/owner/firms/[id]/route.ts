export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requirePlatformOwner, writeAuditLog } from "@/lib/api/guard";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["trial", "active", "suspended", "cancelled", "expired"];

/** Change a firm's status or plan. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const caller = await requirePlatformOwner();
    const { id } = await params;
    if (!UUID_RE.test(id)) throw new ApiError(400, "Invalid firm.");

    const body = await request.json().catch(() => ({}));
    const admin = getAdminClient();

    const { data: firm } = await admin.from("organizations").select("id, name, slug, status, plan, trial_ends_at").eq("id", id).maybeSingle();
    if (!firm) throw new ApiError(404, "Firm not found.");

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body?.status !== undefined) {
      if (!STATUSES.includes(body.status)) throw new ApiError(400, "Invalid status.");
      if (firm.slug === "oddlambda" && body.status !== "active") {
        throw new ApiError(400, "The Oddlambda organisation can't be suspended: it holds the Duesk staff accounts.");
      }
      patch.status = body.status;
    }
    if (body?.plan !== undefined) {
      const plan = String(body.plan).trim().slice(0, 40);
      if (!plan) throw new ApiError(400, "Plan can't be empty.");
      patch.plan = plan;
    }
    if (body?.extendTrialDays !== undefined) {
      const days = Math.round(Number(body.extendTrialDays));
      if (!(days >= 1 && days <= 90)) throw new ApiError(400, "Extend by 1 to 90 days.");
      if (firm.slug === "oddlambda") throw new ApiError(400, "The Oddlambda organisation has no trial.");
      // Counts from today if the trial already ended, otherwise from the current end date
      const base = Math.max(Date.now(), firm.trial_ends_at ? Date.parse(firm.trial_ends_at) : 0);
      patch.trial_ends_at = new Date(base + days * 86400000).toISOString();
      patch.status = "trial";
    }

    const { error } = await admin.from("organizations").update(patch).eq("id", id);
    if (error) throw new ApiError(400, error.message);

    await writeAuditLog({
      actor: caller,
      action: "UPDATE_FIRM",
      entity: "ORGANIZATIONS",
      entity_id: id,
      metadata: { firm: firm.name, from: { status: firm.status, plan: firm.plan }, to: patch },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}