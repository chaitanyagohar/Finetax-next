export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireUser } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { contextFor, escalateTicket, loadProfile, sanitizeAttachments } from "@/lib/help/supportServer";
import { buildSummary, bumpStat, findProblem, loadProblems, present, rank, type Option } from "@/lib/help/troubleshooter";
import type { Problem } from "@/lib/help/troubleshooting";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOKS_LIKE_FAULT = /\b(error|failed|failure|exception|violat\w*|crash\w*|bug|500|404|wrong data|data missing|galat)\b/i;

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireUser();
    if (!checkRateLimit(`support-msg:${caller.userId}`, 40, 10 * 60 * 1000)) {
      throw new ApiError(429, "You're sending messages very quickly. Please wait a minute.");
    }

    const body = await request.json().catch(() => ({}));
    const text = String(body?.text || "").trim().slice(0, 4000);
    const choice = typeof body?.choice === "string" ? body.choice.slice(0, 120) : "";
    const attachments = sanitizeAttachments(body?.attachments, caller.userId);
    if (!text && attachments.length === 0) throw new ApiError(400, "Type a message or attach a screenshot.");
    const pagePath = String(body?.pagePath || "").slice(0, 200);

    const admin = getAdminClient();
    const profile = await loadProfile(admin, caller.userId);
    const now = new Date().toISOString();

    // Existing conversation (must be yours) or a new one
    let ticket: any;
    if (body?.ticketId) {
      if (!UUID_RE.test(String(body.ticketId))) throw new ApiError(400, "Invalid conversation.");
      const { data } = await admin.from("support_tickets").select("*").eq("id", body.ticketId).maybeSingle();
      if (!data || data.user_id !== caller.userId) throw new ApiError(404, "Conversation not found.");
      ticket = data;
    } else {
      const { data, error } = await admin
        .from("support_tickets")
        .insert([
          {
            user_id: caller.userId,
            kind: "help",
            subject: (text || "Screenshot").split("\n")[0].slice(0, 90),
            status: "ai",
            page_path: pagePath || null,
            user_agent: (request.headers.get("user-agent") || "").slice(0, 300),
            context: contextFor(profile, pagePath),
          },
        ])
        .select("*")
        .single();
      if (error || !data) throw new ApiError(500, "Could not start the conversation.");
      ticket = data;
    }

    const created: any[] = [];
    const { data: userMsg, error: msgErr } = await admin
      .from("support_messages")
      .insert([{ ticket_id: ticket.id, sender_id: caller.userId, role: "user", body: text, attachments }])
      .select("*")
      .single();
    if (msgErr || !userMsg) throw new ApiError(500, "Could not send the message.");
    created.push(userMsg);

    // Writing again on a resolved conversation reopens it
    if (ticket.status === "resolved" || ticket.status === "closed") {
      const { data } = await admin
        .from("support_tickets")
        .update({ status: ticket.escalated_at ? "open" : "ai", resolved_at: null, updated_at: now })
        .eq("id", ticket.id)
        .select("*")
        .single();
      ticket = data || ticket;
    }

    // The automatic assistant answers until a person takes over
    if (ticket.status === "ai") {
      const problems = await loadProblems(admin);
      const ctx = { isAdmin: profile?.role === "admin", pagePath: pagePath || ticket.page_path || "" };
      const flow: { misses: number; tried: string[]; alternatives: string[]; current: string | null } = {
        misses: 0,
        tried: [],
        alternatives: [],
        current: null,
        ...(ticket.context?.flow || {}),
      };

      let reply: { body: string; options: Option[] } | null = null;
      let escalate = false;
      let resolve = false;

      if (choice) {
        if (choice === "person") {
          escalate = true;
        } else if (choice.startsWith("solved:")) {
          await bumpStat(admin, choice.slice(7), "solved");
          resolve = true;
          reply = { body: "Great, glad that's sorted! If anything else comes up, just write here.", options: [] };
        } else if (choice.startsWith("notsolved:")) {
          const id = choice.slice(10);
          await bumpStat(admin, id, "not_solved");
          if (!flow.tried.includes(id)) flow.tried.push(id);
          const alternatives = flow.alternatives
            .filter((a) => !flow.tried.includes(a))
            .map((a) => findProblem(problems, a))
            .filter((p): p is Problem => !!p);
          reply = alternatives.length
            ? {
                body: "Sorry that didn't fix it. Could it be one of these instead?",
                options: [...alternatives.map((p) => ({ label: p.title, value: `p:${p.id}` })), { label: "None of these: talk to a person", value: "person" }],
              }
            : {
                body: "Sorry that didn't fix it. The quickest way forward is to let the support team look at it. They'll see everything you've written here.",
                options: [
                  { label: "Talk to a person", value: "person" },
                  { label: "Describe it differently", value: "retry" },
                ],
              };
        } else if (choice.startsWith("p:")) {
          const p = findProblem(problems, choice.slice(2));
          if (p) {
            reply = present(p, ctx);
            flow.current = p.id;
            await bumpStat(admin, p.id, "shown");
          }
        } else if (choice === "retry") {
          reply = {
            body: "Sure. Tell me **which page** you're on, **what you clicked**, and **what happened** (copy any error message exactly). A screenshot helps too.",
            options: [],
          };
        }
      } else {
        const ranked = rank(problems, text, ctx);
        const top = ranked[0];
        const second = ranked[1];

        if (top && top.score >= 4 && (!second || top.score >= 1.3 * second.score)) {
          reply = present(top.p, ctx);
          flow.current = top.p.id;
          flow.alternatives = ranked.slice(1, 4).map((r) => r.p.id);
          flow.misses = 0;
          await bumpStat(admin, top.p.id, "shown");
        } else if (top && top.score >= 1.8) {
          const shortlist = ranked.slice(0, 3);
          flow.alternatives = shortlist.map((r) => r.p.id);
          flow.misses = 0;
          reply = {
            body: "I found a few things that might match. Which is closest to your problem?",
            options: [
              ...shortlist.map((r) => ({ label: r.p.title, value: `p:${r.p.id}` })),
              { label: "None of these", value: "retry" },
              { label: "Talk to a person", value: "person" },
            ],
          };
        } else {
          flow.misses = (flow.misses || 0) + 1;
          reply =
            flow.misses >= 2 || LOOKS_LIKE_FAULT.test(text)
              ? {
                  body: "I couldn't find a ready answer for this. Errors and unusual behaviour are best checked by the support team. They'll see everything you've written here.",
                  options: [
                    { label: "Talk to a person", value: "person" },
                    { label: "Browse the guides", value: "guides" },
                  ],
                }
              : {
                  body: "I couldn't match that to a known problem yet. Could you add a little more detail: **which page** you're on, **what you clicked**, and **what happened**? Copy any error message exactly, or attach a screenshot.",
                  options: [
                    { label: "Talk to a person", value: "person" },
                    { label: "Browse the guides", value: "guides" },
                  ],
                };
        }
      }

      if (reply) {
        const { data: botMsg } = await admin
          .from("support_messages")
          .insert([{ ticket_id: ticket.id, role: "assistant", body: reply.body, meta: { options: reply.options } }])
          .select("*")
          .single();
        if (botMsg) created.push(botMsg);
      }

      const { data: saved } = await admin
        .from("support_tickets")
        .update({
          context: { ...(ticket.context || {}), flow },
          updated_at: now,
          ...(resolve ? { status: "resolved", resolved_at: now } : {}),
        })
        .eq("id", ticket.id)
        .select("*")
        .single();
      ticket = saved || ticket;

      if (escalate) {
        const { data: history } = await admin.from("support_messages").select("role, body").eq("ticket_id", ticket.id).order("created_at", { ascending: true }).limit(80);
        const summary = buildSummary(ticket.subject, history || [], flow, problems, ctx.pagePath);
        const r = await escalateTicket(admin, ticket, { summary, category: ticket.category || "other" }, request.nextUrl.origin);
        ticket = r.ticket;
        if (r.message) created.push(r.message);
      }
    }

    const { data: fresh } = await admin.from("support_tickets").select("*").eq("id", ticket.id).single();
    return NextResponse.json({ success: true, ticket: fresh || ticket, messages: created });
  } catch (err) {
    return errorResponse(err);
  }
}