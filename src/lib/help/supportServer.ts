/** Shared helpers for the support routes. SERVER ONLY. */
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

const DEFAULT_STAFF_MODULES = ["leads", "tasks", "time_tracking"];

export async function loadProfile(admin: SupabaseClient, userId: string) {
  const { data } = await admin.from("profiles").select("id, name, email, role, is_reviewer, is_active, is_support_agent, module_access").eq("id", userId).maybeSingle();
  return data;
}

export function contextFor(profile: any, pagePath: string): SupportContext {
  const role = profile?.role || "staff";
  return {
    name: profile?.name || "Team member",
    role,
    isAdmin: role === "admin",
    isReviewer: role === "admin" || role === "reviewer" || !!profile?.is_reviewer,
    modules: Array.isArray(profile?.module_access) ? profile.module_access : DEFAULT_STAFF_MODULES,
    pagePath: String(pagePath || "").slice(0, 200),
    now: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }),
  };
}

/** Only images the user uploaded into their own folder. */
export function sanitizeAttachments(raw: unknown, userId: string) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 3)
    .map((a: any) => ({ path: String(a?.path || ""), name: String(a?.name || "screenshot").slice(0, 120), type: String(a?.type || "image/jpeg") }))
    .filter((a) => a.path.startsWith(`${userId}/`) && !a.path.includes("..") && /\.(png|jpe?g|webp|gif)$/i.test(a.path));
}

/** Move a conversation to the human support queue and tell the user. */
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
        ticket_id: ticket.id,
        role: "system",
        body: "You're now connected to the support team. A person will reply in this chat, and you'll get a notification when they do.",
      },
    ])
    .select("*")
    .single();

  // Email support agents (best effort)
  try {
    const { data: agents } = await admin.from("profiles").select("email, name").eq("is_support_agent", true).or("is_active.is.null,is_active.eq.true");
    const { data: user } = await admin.from("profiles").select("name").eq("id", ticket.user_id).maybeSingle();
    const link = `${origin}/support?ticket=${ticket.id}`;
    for (const a of agents || []) {
      if (!a.email) continue;
      await sendFirmEmail({
        to: a.email,
        subject: `Support request ${updated?.number || ticket.number} from ${user?.name || "a team member"}${info.priority === "urgent" ? " [URGENT]" : ""}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6">
          <p><strong>${escapeHtml(user?.name || "A team member")}</strong> needs help.</p>
          <p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px">${escapeHtml(info.summary)}</p>
          <p><a href="${link}">Open the conversation</a></p></div>`,
        text: `${user?.name || "A team member"} needs help: ${info.summary}\n\n${link}`,
      });
    }
  } catch (e) {
    console.error("[support] agent email failed:", e);
  }

  return { ticket: updated || ticket, message };
}