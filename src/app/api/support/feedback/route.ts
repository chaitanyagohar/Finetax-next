export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireUser } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { contextFor } from "@/lib/help/supportServer";

const TYPES: Record<string, string> = { idea: "Feature idea", bug: "Bug report", praise: "Praise", other: "Feedback" };

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireUser();
    if (!checkRateLimit(`support-feedback:${caller.userId}`, 10, 60 * 60 * 1000)) throw new ApiError(429, "Thanks! You've sent a lot of feedback recently. Please try again later.");

    const body = await request.json().catch(() => ({}));
    const type = TYPES[body?.type] ? String(body.type) : "other";
    const message = String(body?.message || "").trim().slice(0, 4000);
    if (message.length < 5) throw new ApiError(400, "Please write a little more so we understand.");
    const rating = Number(body?.rating);
    const pagePath = String(body?.pagePath || "").slice(0, 200);

    const admin = getAdminClient();

    const { data: ticket, error } = await admin
      .from("support_tickets")
      .insert([
        {
          org_id: caller.orgId,
          user_id: caller.userId,
          kind: "feedback",
          category: type === "idea" ? "feature_request" : type === "bug" ? "bug" : "other",
          subject: `${TYPES[type]}: ${message.split("\n")[0].slice(0, 80)}`,
          status: "waiting",
          page_path: pagePath || null,
          user_agent: (request.headers.get("user-agent") || "").slice(0, 300),
          context: contextFor(caller, pagePath),
          rating: rating >= 1 && rating <= 5 ? rating : null,
        },
      ])
      .select("*")
      .single();
    if (error || !ticket) throw new ApiError(500, "Could not send feedback.");

    await admin
      .from("support_messages")
      .insert([{ org_id: caller.orgId, ticket_id: ticket.id, sender_id: caller.userId, role: "user", body: message }]);
    return NextResponse.json({ success: true, number: ticket.number });
  } catch (err) {
    return errorResponse(err);
  }
}