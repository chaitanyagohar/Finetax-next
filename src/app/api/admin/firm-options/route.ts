export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireAdmin, writeAuditLog } from "@/lib/api/guard";
import { createClient } from "@/lib/supabase/server";

const NUMBERS: Record<string, [number, number]> = {
  away_quiet_minutes: [5, 120],
  declared_approval_minutes: [0, 600],
  late_grace_minutes: [0, 120],
};

/** Small firm options that don't need the full settings form: attendance rules and the two-step rule. */
export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new ApiError(400, "Invalid request.");

    const patch: Record<string, number | boolean> = {};
    for (const [key, [min, max]] of Object.entries(NUMBERS)) {
      if (key in body) {
        const n = Number(body[key]);
        if (!Number.isInteger(n) || n < min || n > max) throw new ApiError(400, `Choose a whole number from ${min} to ${max}.`);
        patch[key] = n;
      }
    }
    if ("require_mfa_admins" in body) {
      const on = body.require_mfa_admins === true;
      if (on) {
        // Only an administrator who already uses it, in a verified session, can switch it on (so nobody locks the firm out)
        const supabase = await createClient();
        const { data: s } = await supabase.rpc("my_security");
        const sec = s as { has_mfa?: boolean; session_verified?: boolean } | null;
        if (!sec?.has_mfa || !sec.session_verified) throw new ApiError(400, "Turn on two-step sign-in for yourself first, then sign in with your code.");
      }
      patch.require_mfa_admins = on;
    }
    if (Object.keys(patch).length === 0) throw new ApiError(400, "Nothing to save.");

    const { error } = await getAdminClient().from("firm_settings").update(patch).eq("org_id", caller.orgId);
    if (error) throw new ApiError(500, "Could not save.");
    await writeAuditLog({ actor: caller, action: "firm_options_changed", entity: "SETTINGS", metadata: patch });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
