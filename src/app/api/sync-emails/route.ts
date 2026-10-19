export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireUser } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { MailboxConnectError, syncMailbox } from "@/lib/email/syncMailbox";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await requireUser();

    const body = await request.json().catch(() => ({}));
    const accountId = typeof body?.accountId === "string" ? body.accountId : "";
    if (!UUID_RE.test(accountId)) throw new ApiError(400, "Invalid account.");

    // One manual sync per account every 20 seconds
    if (!checkRateLimit(`sync:${accountId}`, 1, 20000)) {
      return NextResponse.json({ success: true, count: 0, skipped: true });
    }

    const admin = getAdminClient();
    const { data: account } = await admin.from("email_accounts").select("*").eq("id", accountId).single();
    if (!account) throw new ApiError(400, "Account not found.");
    if (account.is_active === false) throw new ApiError(400, "This email account is disabled.");

    try {
      const result = await syncMailbox(admin, account);
      return NextResponse.json({ success: true, ...result });
    } catch (e: any) {
      if (e instanceof MailboxConnectError) throw new ApiError(502, e.message);
      throw new ApiError(500, e?.message || "Sync failed.");
    }
  } catch (err) {
    return errorResponse(err);
  }
}