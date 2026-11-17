export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireAdmin } from "@/lib/api/guard";
import { proposalUrl } from "@/lib/publicLinks";
import { UUID_RE } from "@/lib/validate";


export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.proposalId === "string" ? body.proposalId : "";
    if (!UUID_RE.test(id)) throw new ApiError(400, "Invalid proposal.");

    const admin = getAdminClient();
    const { data: p } = await admin
      .from("proposals")
      .select("id, status")
      .eq("id", id)
      .eq("org_id", caller.orgId)
      .maybeSingle();
    if (!p) throw new ApiError(404, "Proposal not found.");
    if (!["Draft", "Sent", "Viewed"].includes(p.status)) throw new ApiError(400, `This proposal is ${p.status.toLowerCase()}.`);

    if (p.status === "Draft") {
      await admin
        .from("proposals")
        .update({ status: "Sent", sent_at: new Date().toISOString() })
        .eq("id", id)
        .eq("org_id", caller.orgId);
    }
    return NextResponse.json({ success: true, url: proposalUrl(id) });
  } catch (err) {
    return errorResponse(err);
  }
}