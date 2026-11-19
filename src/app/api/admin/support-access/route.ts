export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, getSiteUrl, requireAdmin } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { escapeHtml, sendFirmEmail } from "@/lib/email/mailer";
import { createClient } from "@/lib/supabase/server";

const HOURS = [24, 72, 168];

/** A firm admin lets Duesk support see the firm's setup for a while; the Duesk owner is told by email too. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    if (!(await checkRateLimit(`support-access:${caller.orgId}`, 5, 60 * 60 * 1000))) throw new ApiError(429, "Please wait a little before trying again.");
    const body = (await request.json().catch(() => ({}))) as { hours?: unknown; reason?: unknown };
    const hours = Number(body.hours);
    if (!HOURS.includes(hours)) throw new ApiError(400, "Choose 24 hours, 3 days or 7 days.");
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    const expires = new Date(Date.now() + hours * 3600_000);

    // Insert as the admin, so the firm's own rules apply
    const supabase = await createClient();
    const { error } = await supabase.from("support_access_grants").insert({ expires_at: expires.toISOString(), reason: reason || null });
    if (error) throw new ApiError(400, error.message);

    // Best effort: email the Duesk owner from the Duesk mailbox
    let emailed = false;
    try {
      const admin = getAdminClient();
      const [{ data: cfg }, { data: owners }] = await Promise.all([
        admin.from("platform_config").select("support_org_id").eq("id", true).maybeSingle(),
        admin.from("platform_admins").select("user_id").eq("role", "owner"),
      ]);
      const ids = (owners || []).map((o: { user_id: string }) => o.user_id);
      const { data: people } = ids.length ? await admin.from("profiles").select("email").in("id", ids) : { data: [] as { email: string | null }[] };
      const to = (people || []).map((p: { email: string | null }) => p.email).filter((e): e is string => !!e);
      if (cfg?.support_org_id && to.length) {
        const until = expires.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
        const link = `${getSiteUrl(request)}/owner?support=${caller.orgId}`;
        await sendFirmEmail({
          kind: "support",
          orgId: cfg.support_org_id,
          to,
          subject: `${caller.orgName} gave Duesk support access`,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6">
            <p><strong>${escapeHtml(caller.name)}</strong> of <strong>${escapeHtml(caller.orgName)}</strong> allowed support access until ${escapeHtml(until)}.</p>
            ${reason ? `<p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px">${escapeHtml(reason)}</p>` : ""}
            <p><a href="${link}">Open the support view</a></p></div>`,
          text: `${caller.name} of ${caller.orgName} allowed support access until ${until}.${reason ? ` Reason: ${reason}` : ""}\n\n${link}`,
        });
        emailed = true;
      }
    } catch (e) {
      console.error("[support-access] owner email failed:", e);
    }
    return NextResponse.json({ ok: true, emailed });
  } catch (err) {
    return errorResponse(err);
  }
}
