export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requirePlatformOwner } from "@/lib/api/guard";

/** Makes the Duesk workspace's own mailbox the sender for platform emails (support, sign-up notices). */
export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requirePlatformOwner();
    const admin = getAdminClient();
    const { count } = await admin.from("email_accounts").select("id", { count: "exact", head: true }).eq("org_id", caller.orgId).eq("is_active", true);
    if (!count) throw new ApiError(400, "Connect a mailbox in the Duesk workspace's Inbox first.");
    const { error } = await admin.from("platform_config").upsert({ id: true, support_org_id: caller.orgId }, { onConflict: "id" });
    if (error) throw new ApiError(500, "Could not save.");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
