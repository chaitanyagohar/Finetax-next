export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, errorResponse, getAdminClient, getSiteUrl, ApiError } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { escapeHtml, sendFirmEmail } from "@/lib/email/mailer";
import { createLoginLink } from "@/lib/portal/session";
import { EMAIL_RE } from "@/lib/validate";

const SAME_ANSWER = "If this email has access to a client portal, a sign-in link is on its way. It works for 20 minutes.";

/** Emails a sign-in link for every client this address may open. Always gives the same answer. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email) || email.length > 200) throw new ApiError(400, "Enter a valid email address.");

    const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const [byIp, byEmail] = await Promise.all([
      checkRateLimit(`portal-login-ip:${ip}`, 10, 15 * 60 * 1000),
      checkRateLimit(`portal-login:${email}`, 4, 15 * 60 * 1000),
    ]);
    if (!byIp || !byEmail) throw new ApiError(429, "Too many attempts. Please wait a few minutes and try again.");

    const admin = getAdminClient();
    const { data: users } = await admin
      .from("client_portal_users")
      .select("id, org_id, name, clients!inner(name, organization_name, merged_into), organizations!inner(status)")
      .eq("email", email)
      .eq("is_active", true)
      .limit(10);

    const site = getSiteUrl(request);
    for (const u of users || []) {
      const org = (Array.isArray(u.organizations) ? u.organizations[0] : u.organizations) as { status: string } | null;
      const client = (Array.isArray(u.clients) ? u.clients[0] : u.clients) as { name: string; organization_name: string | null; merged_into: string | null } | null;
      if (!org || !["trial", "active"].includes(org.status) || !client || client.merged_into) continue;
      const { data: allowed } = await admin.rpc("org_has_feature", { p_org: u.org_id, p_feature: "client_portal" });
      if (allowed !== true) continue;
      const link = await createLoginLink(admin, u.id, site, 20);
      const { data: firm } = await admin.from("firm_settings").select("firm_name").eq("org_id", u.org_id).maybeSingle();
      const firmName = firm?.firm_name || "Your CA firm";
      try {
        await sendFirmEmail({
          kind: "portal_sign_in",
          orgId: u.org_id,
          to: email,
          subject: `Your sign-in link for ${firmName}`,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c1917;line-height:1.6;max-width:520px">
            <p>Hello${u.name ? ` ${escapeHtml(u.name)}` : ""},</p>
            <p>Use this link to open the client portal of <strong>${escapeHtml(firmName)}</strong> for <strong>${escapeHtml(client.organization_name || client.name)}</strong>.</p>
            <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">Open the portal</a></p>
            <p style="color:#78716c;font-size:12px">The link works once, for 20 minutes. If you didn't ask for it, you can ignore this email.</p></div>`,
          text: `Open the client portal of ${firmName}: ${link}\nThe link works once, for 20 minutes.`,
        });
      } catch (e) {
        console.warn("[portal] sign-in email not sent:", e instanceof Error ? e.message : e);
      }
    }
    return NextResponse.json({ message: SAME_ANSWER });
  } catch (err) {
    return errorResponse(err);
  }
}
