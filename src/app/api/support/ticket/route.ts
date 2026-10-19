export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireUser } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { escalateTicket } from "@/lib/help/supportServer";
import { buildSummary, loadProblems } from "@/lib/help/troubleshooter";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Actions a user can take on their own support conversation. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireUser();
    if (!checkRateLimit(`support-ticket:${caller.userId}`, 20, 10 * 60 * 1000)) {
      throw new ApiError(429, "Please wait a moment and try again.");
    }

    const body = await request.json().catch(() => ({}));
    const ticketId = String(body?.ticketId || "");
    if (!UUID_RE.test(ticketId)) throw new ApiError(400, "Invalid conversation.");

    const admin = getAdminClient();
    const { data: ticket } = await admin.from("support_tickets").select("*").eq("id", ticketId).maybeSingle();
    if (!ticket || ticket.user_id !== caller.userId) throw new ApiError(404, "Conversation not found.");
    const now = new Date().toISOString();

    switch (body?.action) {
      // "Talk to a person"
      case "escalate": {
        if (["waiting", "open"].includes(ticket.status)) {
          return NextResponse.json({ success: true, ticket, messages: [] });
        }
        const { data: history } = await admin
          .from("support_messages")
          .select("role, body")
          .eq("ticket_id", ticketId)
          .order("created_at", { ascending: true })
          .limit(80);
        const problems = await loadProblems(admin);
        const summary = buildSummary(ticket.subject, history || [], ticket.context?.flow, problems, ticket.page_path || "");
        const r = await escalateTicket(admin, ticket, { summary, category: ticket.category || "other" }, request.nextUrl.origin);
        return NextResponse.json({ success: true, ticket: r.ticket, messages: r.message ? [r.message] : [] });
      }

      // "That solved it"
      case "resolve": {
        const { data } = await admin
          .from("support_tickets")
          .update({ status: "resolved", resolved_at: now, updated_at: now })
          .eq("id", ticketId)
          .select("*")
          .single();
        return NextResponse.json({ success: true, ticket: data, messages: [] });
      }

      // Star rating after resolution
      case "rate": {
        const rating = Number(body?.rating);
        if (!(rating >= 1 && rating <= 5)) throw new ApiError(400, "Choose 1 to 5 stars.");
        const { data } = await admin
          .from("support_tickets")
          .update({
            rating,
            rating_comment: String(body?.comment || "").trim().slice(0, 1000) || null,
            updated_at: now,
          })
          .eq("id", ticketId)
          .select("*")
          .single();
        return NextResponse.json({ success: true, ticket: data, messages: [] });
      }

      default:
        throw new ApiError(400, "Unknown action.");
    }
  } catch (err) {
    return errorResponse(err);
  }
}