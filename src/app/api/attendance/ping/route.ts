export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, errorResponse, getAdminClient, requireUser } from "@/lib/api/guard";

function clientIp(request: NextRequest) {
  const raw = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "";
  return raw.replace(/^::ffff:/, "");
}

/** The address this browser reaches us from, so an admin can add their office. */
export async function GET(request: NextRequest) {
  try {
    const caller = await requireUser();
    if (!caller.isAdmin) return NextResponse.json({ ip: "" });
    return NextResponse.json({ ip: clientIp(request) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Marks today as in office or remote. The address itself is never stored. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireUser();
    const ip = clientIp(request);
    if (!ip) return NextResponse.json({ in_office: false });
    const { data, error } = await getAdminClient().rpc("mark_office_presence", { p_user: caller.userId, p_org: caller.orgId, p_ip: ip });
    if (error) return NextResponse.json({ in_office: false });
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}
