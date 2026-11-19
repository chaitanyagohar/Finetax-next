export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requirePlatformOwner } from "@/lib/api/guard";
import { UUID_RE } from "@/lib/validate";

export async function GET() {
  try {
    await requirePlatformOwner();
    const { data } = await getAdminClient()
      .from("upgrade_requests")
      .select("id, org_id, feature, plan_wanted, message, status, created_at, organizations(name, plan), profiles:requested_by(name, email)")
      .order("created_at", { ascending: false })
      .limit(100);
    return NextResponse.json({ requests: data || [] });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requirePlatformOwner();
    const body = (await request.json().catch(() => null)) as { id?: unknown; status?: unknown } | null;
    const id = typeof body?.id === "string" ? body.id : "";
    const status = body?.status === "done" || body?.status === "declined" || body?.status === "open" ? body.status : "";
    if (!UUID_RE.test(id) || !status) throw new ApiError(400, "Invalid request.");
    const { error } = await getAdminClient()
      .from("upgrade_requests")
      .update({ status, handled_at: status === "open" ? null : new Date().toISOString(), handled_by: status === "open" ? null : caller.userId })
      .eq("id", id);
    if (error) throw new ApiError(400, error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
