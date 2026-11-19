export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, errorResponse, getAdminClient } from "@/lib/api/guard";
import { PORTAL_COOKIE, hashToken } from "@/lib/portal/session";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const token = request.cookies.get(PORTAL_COOKIE)?.value;
    if (token) await getAdminClient().from("client_portal_tokens").delete().eq("token_hash", hashToken(token)).eq("purpose", "session");
    const res = NextResponse.json({ ok: true });
    res.cookies.set({ name: PORTAL_COOKIE, value: "", path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
