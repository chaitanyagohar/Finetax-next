export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireModule, writeAuditLog } from "@/lib/api/guard";
import { UUID_RE } from "@/lib/validate";

/** Turns a contact's portal access off and signs them out everywhere. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireModule("leads");
    const body = (await request.json().catch(() => null)) as { portalUserId?: unknown } | null;
    const id = typeof body?.portalUserId === "string" ? body.portalUserId : "";
    if (!UUID_RE.test(id)) throw new ApiError(400, "Invalid request.");

    const admin = getAdminClient();
    const { data: user } = await admin.from("client_portal_users").select("id, email, client_id").eq("id", id).eq("org_id", caller.orgId).maybeSingle();
    if (!user) throw new ApiError(404, "Not found.");
    await admin.from("client_portal_users").update({ is_active: false }).eq("id", id);
    await admin.from("client_portal_tokens").delete().eq("portal_user_id", id);
    await writeAuditLog({ actor: caller, action: "PORTAL_REVOKE", entity: "CLIENTS", entity_id: user.client_id, metadata: { email: user.email } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
