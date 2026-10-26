/** Shared helpers for the support routes. SERVER ONLY. Support is a central Duesk service. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeHtml, sendFirmEmail } from "@/lib/email/mailer";

export type SupportContext = {
  name: string;
  role: string;
  isAdmin: boolean;
  isReviewer: boolean;
  modules: string[];
  pagePath: string;
  now: string;
};

/** The parts of the signed-in user (AuthContext) the support assistant needs. */
type Caller = { name: string; role: string; isAdmin: boolean; isReviewer: boolean; moduleAccess: string[] };

/** Snapshot of who asked, from their membership in the current firm. */
export function contextFor(caller: Caller, pagePath: string): SupportContext {
  return {
    name: caller.name || "Team member",
    role: caller.role || "staff",
    isAdmin: caller.isAdmin,
    isReviewer: caller.isReviewer,
    modules: caller.moduleAccess,
    pagePath: String(pagePath || "").slice(0, 200),
    now: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }),
  };
}

/** True if this person is on the Duesk support team. */
export async function isPlatformSupport(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
}

/** Only images the user uploaded into their own folder. */
export function sanitizeAttachments(raw: unknown, userId: string) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 3)
    .map((a: any) => ({ path: String(a?.path || ""), name: String(a?.name || "screenshot").slice(0, 120), type: String(a?.type || "image/jpeg") }))
    .filter((a) => a.path.startsWith(`${userId}/`) && !a.path.includes("..") && /\.(png|jpe?g|webp|gif)$/i.test(a.path));
}

/** Move a conversation to the human support queue and email the Duesk support team. */
export async function escalateTicket(
  admin: SupabaseClient,
  ticket: any,
  info: { summary: string; category?: string; priority?: string },
  origin: string
) {
  const now = new Date().toISOString();
  const { data: updated } = await admin
    .from("support_tickets")
    .update({
      status: "waiting",
      ai_summary: info.summary.slice(0, 1500),
      category: info.category || ticket.category || "other",
      priority: info.priority === "urgent" ? "urgent" : ticket.priority || "normal",
      escalated_at: ticket.escalated_at || now,
      updated_at: now,
    })
    .eq("id", ticket.id)
    .select("*")
    .single();

  const { data: message } = await admin
    .from("support_messages")
    .insert([
      {
        org_id: ticket.org_id,
        ticket_id: ticket.id,
        role: "system",
        body: "You're now connected to the support team. A person will reply in this chat, and you'll get a notification when they do.",
      },
    ])
    .select("*")
    .single();

  // Email the Duesk support team from the platform mailbox (best effort)
  try {
    const [{ data: cfg }, { data: staff }, { data: user }, { data: firm }] = await Promise.all([
      admin.from("platform_config").select("support_org_id").eq("id", true).maybeSingle(),
      admin.from("platform_admins").select("user_id"),
      admin.from("profiles").select("name").eq("id", ticket.user_id).maybeSingle(),
      admin.from("organizations").select("name").eq("id", ticket.org_id).maybeSingle(),
    ]);

    const senderOrg = cfg?.support_org_id as string | undefined;
    const staffIds = (staff || []).map((s: any) => s.user_id);
    const { data: agents } = staffIds.length
      ? await admin.from("profiles").select("email").in("id", staffIds)
      : { data: [] as any[] };

    if (senderOrg) {
      const link = `${origin}/support?ticket=${ticket.id}`;
      const who = `${user?.name || "A team member"}${firm?.name ? ` (${firm.name})` : ""}`;
      for (const a of agents || []) {
        if (!a.email) continue;
        await sendFirmEmail({
          orgId: senderOrg,
          to: a.email,
          subject: `Support request ${updated?.number || ticket.number} from ${who}${info.priority === "urgent" ? " [URGENT]" : ""}`,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6">
            <p><strong>${escapeHtml(who)}</strong> needs help.</p>
            <p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px">${escapeHtml(info.summary)}</p>
            <p><a href="${link}">Open the conversation</a></p></div>`,
          text: `${who} needs help: ${info.summary}\n\n${link}`,
        });
      }
    }
  } catch (e) {
    console.error("[support] support-team email failed:", e);
  }

  return { ticket: updated || ticket, message };
}