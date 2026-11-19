export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { SESSION_DAYS, hashToken, newToken, sessionCookie } from "@/lib/portal/session";

/**
 * Exchanges a one-time sign-in link for a session. This is a POST from the page the link opens,
 * so an email scanner that merely visits the link doesn't use it up.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    if (!(await checkRateLimit(`portal-session:${ip}`, 20, 15 * 60 * 1000))) throw new ApiError(429, "Too many attempts. Please wait a few minutes.");

    const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    if (token.length < 30 || token.length > 100) throw new ApiError(400, "This sign-in link is not valid.");

    const admin = getAdminClient();
    const now = new Date().toISOString();
    // Marking it used in the same statement means a link can never be used twice
    const { data: used } = await admin
      .from("client_portal_tokens")
      .update({ used_at: now })
      .eq("token_hash", hashToken(token))
      .eq("purpose", "login")
      .is("used_at", null)
      .gt("expires_at", now)
      .select("portal_user_id")
      .maybeSingle();
    if (!used) throw new ApiError(400, "This sign-in link has expired or was already used. Ask for a new one.");

    const { data: user } = await admin.from("client_portal_users").select("id, is_active").eq("id", used.portal_user_id).maybeSingle();
    if (!user?.is_active) throw new ApiError(403, "Portal access for this email has been turned off. Please contact your CA firm.");

    const session = newToken();
    const { error } = await admin.from("client_portal_tokens").insert({
      portal_user_id: user.id,
      purpose: "session",
      token_hash: session.hash,
      expires_at: new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString(),
    });
    if (error) throw new ApiError(500, "Could not sign you in. Please try again.");
    await admin.from("client_portal_users").update({ last_login_at: now }).eq("id", user.id);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookie(session.token));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
