export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, getSiteUrl, requireModule, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { escapeHtml, sendFirmEmail } from "@/lib/email/mailer";
import { createLoginLink } from "@/lib/portal/session";
import { EMAIL_RE, UUID_RE } from "@/lib/validate";
import { requireOrgFeature } from "@/lib/api/features";

/** Gives a client contact portal access and returns a 7-day sign-in link (also emailed when possible). */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireModule("leads");
    if (!(await checkRateLimit(`portal-invite:${caller.userId}`, 30, 60 * 60 * 1000))) {
      throw new ApiError(429, "Too many invitations in a short time. Please wait a little.");
    }
    const body = (await request.json().catch(() => null)) as { clientId?: unknown; email?: unknown; name?: unknown; send?: unknown } | null;
    const clientId = typeof body?.clientId === "string" ? body.clientId : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!UUID_RE.test(clientId)) throw new ApiError(400, "Invalid client.");
    if (!EMAIL_RE.test(email) || email.length > 200) throw new ApiError(400, "Enter a valid email address.");

    const admin = getAdminClient();
    await requireOrgFeature(admin, caller.orgId, "client_portal");
    const { data: client } = await admin
      .from("clients")
      .select("id, name, organization_name, merged_into")
      .eq("id", clientId)
      .eq("org_id", caller.orgId)
      .maybeSingle();
    if (!client || client.merged_into) throw new ApiError(404, "Client not found.");

    const { data: existing } = await admin.from("client_portal_users").select("id").eq("client_id", clientId).eq("email", email).maybeSingle();
    let portalUserId = existing?.id as string | undefined;

    // The plan may cap how many clients have portal access
    const { data: limits } = await admin.from("organizations").select("plans!inner(max_portal_clients)").eq("id", caller.orgId).maybeSingle();
    const cap = (Array.isArray(limits?.plans) ? limits?.plans[0] : limits?.plans)?.max_portal_clients as number | null | undefined;
    if (cap !== null && cap !== undefined) {
      const { data: rows } = await admin.from("client_portal_users").select("client_id").eq("org_id", caller.orgId).eq("is_active", true);
      const clientsWithAccess = new Set((rows || []).map((r) => r.client_id));
      if (!clientsWithAccess.has(clientId) && clientsWithAccess.size >= cap) {
        throw new ApiError(403, `Your plan includes the portal for ${cap} clients, and all are in use. Turn off a client's access or ask for a bigger plan.`);
      }
    }
    if (portalUserId) {
      await admin.from("client_portal_users").update({ is_active: true, ...(name ? { name } : {}) }).eq("id", portalUserId);
    } else {
      const { data: created, error } = await admin
        .from("client_portal_users")
        .insert({ org_id: caller.orgId, client_id: clientId, email, name: name || null, invited_by: caller.userId })
        .select("id")
        .single();
      if (error || !created) throw new ApiError(400, error?.message || "Could not give access.");
      portalUserId = created.id;
    }

    const url = await createLoginLink(admin, portalUserId!, getSiteUrl(request), 7 * 24 * 60);
    let emailed = false;
    if (body?.send !== false) {
      const { data: firm } = await admin.from("firm_settings").select("firm_name").eq("org_id", caller.orgId).maybeSingle();
      const firmName = firm?.firm_name || caller.orgName;
      try {
        await sendFirmEmail({
          kind: "portal_invite",
          orgId: caller.orgId,
          to: email,
          subject: `${firmName} has opened a client portal for you`,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c1917;line-height:1.6;max-width:540px">
            <p>Hello${name ? ` ${escapeHtml(name)}` : ""},</p>
            <p><strong>${escapeHtml(firmName)}</strong> now shares your work with you online, for <strong>${escapeHtml(client.organization_name || client.name)}</strong>:</p>
            <ul style="padding-left:18px;color:#44403c">
              <li>upload the documents they ask for, straight from your phone</li>
              <li>see the status of your returns and filings</li>
              <li>download invoices and pay online</li>
            </ul>
            <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">Open your portal</a></p>
            <p style="color:#78716c;font-size:12px">This link works once within 7 days. Afterwards, sign in with this email address at ${escapeHtml(getSiteUrl(request))}/portal/login.</p></div>`,
          text: `${firmName} has opened a client portal for you. Open it here (once, within 7 days): ${url}`,
        });
        emailed = true;
      } catch (e) {
        console.warn("[portal] invite not emailed:", e instanceof Error ? e.message : e);
      }
    }

    await writeAuditLog({ actor: caller, action: "PORTAL_INVITE", entity: "CLIENTS", entity_id: clientId, metadata: { email, emailed } });
    return NextResponse.json({ url, emailed });
  } catch (err) {
    return errorResponse(err);
  }
}
