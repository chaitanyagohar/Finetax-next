export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireUser } from "@/lib/api/guard";
import { isPlatformSupport } from "@/lib/help/supportServer";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["ai", "waiting", "open", "resolved", "closed"];

/** Duesk support team actions on any firm's ticket: reply, note, status, priority, assignment. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireUser();
    if (!caller.isPlatformAdmin) throw new ApiError(403, "Only the Duesk support team can do this.");

    const admin = getAdminClient();

    const body = await request.json().catch(() => ({}));
    const ticketId = String(body?.ticketId || "");
    if (!UUID_RE.test(ticketId)) throw new ApiError(400, "Invalid conversation.");
    const { data: ticket } = await admin.from("support_tickets").select("*").eq("id", ticketId).maybeSingle();
    if (!ticket) throw new ApiError(404, "Conversation not found.");

    const now = new Date().toISOString();
    const messages: any[] = [];
    const patch: Record<string, unknown> = { updated_at: now };

    switch (body?.action) {
      case "reply":
      case "note": {
        const text = String(body?.text || "").trim().slice(0, 6000);
        if (!text) throw new ApiError(400, "Write a message first.");
        const { data } = await admin
          .from("support_messages")
          .insert([
            {
              org_id: ticket.org_id, // the message belongs to the user's firm conversation
              ticket_id: ticketId,
              sender_id: caller.userId,
              role: body.action === "reply" ? "agent" : "note",
              body: text,
            },
          ])
          .select("*")
          .single();
        if (data) messages.push(data);
        if (body.action === "reply") {
          if (["ai", "waiting", "resolved", "closed"].includes(ticket.status)) patch.status = "open";
          if (!ticket.assigned_to) patch.assigned_to = caller.userId;
          if (!ticket.escalated_at) patch.escalated_at = now;
        }
        break;
      }
      case "status": {
        if (!STATUSES.includes(body?.status)) throw new ApiError(400, "Invalid status.");
        patch.status = body.status;
        patch.resolved_at = body.status === "resolved" || body.status === "closed" ? now : null;
        break;
      }
      case "priority":
        patch.priority = body?.priority === "urgent" ? "urgent" : "normal";
        break;
      case "assign": {
        const to = body?.assignee ? String(body.assignee) : null;
        if (to && (!UUID_RE.test(to) || !(await isPlatformSupport(admin, to)))) {
          throw new ApiError(400, "That person isn't on the Duesk support team.");
        }
        patch.assigned_to = to;
        break;
      }
      default:
        throw new ApiError(400, "Unknown action.");
    }

    const { data: updated } = await admin.from("support_tickets").update(patch).eq("id", ticketId).select("*").single();
    return NextResponse.json({ success: true, ticket: updated, messages });
  } catch (err) {
    return errorResponse(err);
  }
}