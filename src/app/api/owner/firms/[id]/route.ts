export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requirePlatformOwner, writeAuditLog } from "@/lib/api/guard";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["trial", "active", "suspended", "cancelled"];

/** Change a firm's status or plan. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const caller = await requirePlatformOwner();
    const { id } = await params;
    if (!UUID_RE.test(id)) throw new ApiError(400, "Invalid firm.");

    const body = await request.json().catch(() => ({}));
    const admin = getAdminClient();

    const { data: firm } = await admin.from("organizations").select("id, name, slug, status, plan").eq("id", id).maybeSingle();
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