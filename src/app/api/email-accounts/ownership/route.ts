export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireAdmin, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { confirmOwnershipCode, sendOwnershipCode } from "@/lib/email/ownership";
import { UUID_RE } from "@/lib/validate";

const CODE_RE = /^[0-9]{6}$/;

/** Confirm that the caller's firm owns a mailbox: "send" emails a code to it, "confirm" checks the code. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();

    const body = await request.json().catch(() => ({}));
    const accountId = typeof body?.accountId === "string" ? body.accountId : "";
    const action = body?.action === "confirm" ? "confirm" : "send";
    if (!UUID_RE.test(accountId)) throw new ApiError(400, "Invalid account.");

    const admin = getAdminClient();
    const { data: account } = await admin
      .from("email_accounts")
      .select("id, org_id, email_address, ownership_confirmed_at")
      .eq("id", accountId)
      .eq("org_id", caller.orgId)
      .maybeSingle();
    if (!account) throw new ApiError(404, "Account not found.");
    if (account.ownership_confirmed_at) return NextResponse.json({ success: true, confirmed: true });

    if (action === "send") {
      if (!(await checkRateLimit(`mailbox-code:${account.id}`, 3, 60 * 60 * 1000))) {
        throw new ApiError(429, "Too many codes sent to this address. Try again in an hour.");
      }
      await sendOwnershipCode(admin, account, caller.orgName);
      return NextResponse.json({ success: true, confirmed: false });
    }

    if (!(await checkRateLimit(`mailbox-confirm:${caller.userId}`, 20, 60 * 60 * 1000))) {
      throw new ApiError(429, "Too many attempts. Try again in an hour.");
    }
    const code = String(body?.code || "").trim();
    if (!CODE_RE.test(code)) throw new ApiError(400, "Enter the six-digit code from the email.");

    await confirmOwnershipCode(admin, account, code);
    await writeAuditLog({
      actor: caller,
      action: "CONFIRM_MAILBOX_OWNERSHIP",
      entity: "EMAIL_ACCOUNTS",
      entity_id: account.id,
      metadata: { email: account.email_address },
    });
    return NextResponse.json({ success: true, confirmed: true });
  } catch (err) {
    return errorResponse(err);
  }
}
