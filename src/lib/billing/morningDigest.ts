/** The 9:00 morning email to each firm's administrators. SERVER ONLY. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeHtml, sendFirmEmail } from "@/lib/email/mailer";
import { formatDate, rupees } from "@/lib/format";

type Digest = {
  collected_yesterday: number;
  payments_yesterday: number;
  receivables: number;
  statutory_today: number;
  statutory_week: number;
  overdue: number;
  awaiting_review: number;
  new_leads: number;
  due_week: { title: string; period: string | null; date: string; client: string | null }[];
};

function tile(label: string, value: string, tone = "#0f172a") {
  return `<td style="padding:12px 14px;border:1px solid #e7e5e1;border-radius:10px;background:#ffffff;width:25%">
    <div style="font-size:11px;color:#78716c;text-transform:uppercase;letter-spacing:.04em">${label}</div>
    <div style="font-size:20px;font-weight:600;color:${tone};margin-top:4px">${value}</div></td>`;
}

function render(firmName: string, d: Digest, siteUrl: string, logo: string | null): string {
  const rows = d.due_week
    .map(
      (t) => `<tr><td style="padding:6px 0;border-bottom:1px solid #f0eeea">${escapeHtml(t.title)}${t.period ? ` · ${escapeHtml(t.period)}` : ""}<br/>
        <span style="color:#78716c;font-size:12px">${escapeHtml(t.client || "Internal")}</span></td>
        <td style="padding:6px 0;border-bottom:1px solid #f0eeea;text-align:right;white-space:nowrap">${formatDate(t.date)}</td></tr>`,
    )
    .join("");
  return `<div style="font-family:Arial,sans-serif;background:#f7f5f2;padding:24px">
  <div style="max-width:620px;margin:0 auto">
    ${logo ? `<img src="${escapeHtml(logo)}" alt="" width="40" height="40" style="border-radius:8px;background:#ffffff;object-fit:contain;margin-bottom:8px" />` : ""}
    <p style="font-size:12px;color:#78716c;margin:0">${escapeHtml(firmName)} · morning summary</p>
    <h1 style="font-size:20px;color:#0f172a;margin:6px 0 18px">Good morning. Here is where the firm stands.</h1>
    <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 -8px"><tr>
      ${tile("Collected yesterday", rupees(d.collected_yesterday), "#047857")}
      ${tile("Receivables", rupees(d.receivables))}
      ${tile("Overdue tasks", String(d.overdue), d.overdue ? "#e11d48" : "#0f172a")}
      ${tile("Awaiting review", String(d.awaiting_review))}
    </tr></table>
    <div style="background:#ffffff;border:1px solid #e7e5e1;border-radius:12px;padding:16px 18px;margin-top:16px">
      <p style="margin:0 0 8px;font-size:14px;color:#0f172a"><strong>Statutory deadlines this week:</strong> ${d.statutory_week}${
        d.statutory_today ? ` <span style="color:#f2613f">(${d.statutory_today} today)</span>` : ""
      }</p>
      ${rows ? `<table role="presentation" style="width:100%;font-size:13px;color:#1c1917;border-collapse:collapse">${rows}</table>` : `<p style="color:#78716c;font-size:13px;margin:0">Nothing due in the next 7 days.</p>`}
    </div>
    ${d.new_leads ? `<p style="font-size:13px;color:#1c1917;margin:14px 0 0">${d.new_leads} new enquir${d.new_leads === 1 ? "y" : "ies"} came in yesterday.</p>` : ""}
    <p style="margin:20px 0 0"><a href="${escapeHtml(siteUrl)}/" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px;font-size:13px">Open Duesk</a></p>
    <p style="font-size:11px;color:#a8a29e;margin-top:18px">Sent to the firm's administrators. Turn it off in Firm settings → Workflow.</p>
  </div></div>`;
}

/** One email per firm that has it on and a connected mailbox. Returns how many were sent. */
export async function sendMorningDigests(admin: SupabaseClient, siteUrl: string, budgetEndsAt: number): Promise<number> {
  const { data: firms } = await admin
    .from("organizations")
    .select("id, name, status, firm_settings(firm_name, morning_digest, logo_url)")
    .in("status", ["trial", "active"])
    .neq("slug", "oddlambda");

  let sent = 0;
  for (const firm of firms || []) {
    if (Date.now() > budgetEndsAt) break;
    const settings = (Array.isArray(firm.firm_settings) ? firm.firm_settings[0] : firm.firm_settings) as {
      firm_name?: string;
      morning_digest?: boolean;
      logo_url?: string | null;
    } | null;
    if (settings?.morning_digest === false) continue;
    const { data: allowed } = await admin.rpc("org_has_feature", { p_org: firm.id, p_feature: "morning_digest" });
    if (!allowed) continue;

    const [{ data: digest }, { data: adminIds }] = await Promise.all([
      admin.rpc("firm_daily_digest", { p_org: firm.id }),
      admin.rpc("org_admin_ids", { p_org: firm.id }),
    ]);
    const d = digest as Digest | null;
    if (!d) continue;
    const quiet = !d.collected_yesterday && !d.statutory_week && !d.overdue && !d.awaiting_review && !d.new_leads;
    if (quiet) continue;

    const ids = ((adminIds || []) as unknown[]).map((x) => (typeof x === "string" ? x : (x as Record<string, string>).org_admin_ids)).filter(Boolean);
    if (!ids.length) continue;
    const { data: people } = await admin.from("profiles").select("email").in("id", ids).eq("is_active", true);
    const to = (people || []).map((p) => p.email).filter(Boolean).slice(0, 20).join(", ");
    if (!to) continue;

    const firmName = settings?.firm_name || firm.name;
    try {
      await sendFirmEmail({
        kind: "morning_email",
        orgId: firm.id,
        to,
        subject: `${firmName}: ${d.statutory_week} deadline${d.statutory_week === 1 ? "" : "s"} this week${d.collected_yesterday ? `, ${rupees(d.collected_yesterday)} collected yesterday` : ""}`,
        html: render(firmName, d, siteUrl, settings?.logo_url || null),
        text: `Collected yesterday ${rupees(d.collected_yesterday)}. Receivables ${rupees(d.receivables)}. Overdue tasks ${d.overdue}. Awaiting review ${d.awaiting_review}. Statutory deadlines this week ${d.statutory_week}.`,
      });
      sent++;
    } catch (e) {
      // Usually no mailbox connected yet; the firm simply doesn't get the email
      console.warn("[digest] not sent for", firm.id, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}
