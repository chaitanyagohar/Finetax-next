export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { createClient } from "@/lib/supabase/server";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 44);
}

/** Step 2 of signup: a confirmed new login creates its firm (14-day trial) and becomes its admin. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !user.email) throw new ApiError(401, "Your session has ended. Please open the link from your email again.");
    if (!user.email_confirmed_at) throw new ApiError(403, "Please confirm your email first.");

    // One attempt at a time per person (prevents double-clicks creating two firms)
    if (!(await checkRateLimit(`signup-firm:${user.id}`, 1, 30 * 1000))) {
      throw new ApiError(429, "Your firm is being set up. Please wait a moment.");
    }

    const body = await request.json().catch(() => ({}));
    const firmName = String(body?.firmName || "").trim().replace(/\s+/g, " ").slice(0, 200);
    const name = String(body?.name || "").trim().replace(/\s+/g, " ").slice(0, 120);
    if (firmName.length < 2) throw new ApiError(400, "Please enter your firm's name.");
    if (name.length < 2) throw new ApiError(400, "Please enter your name.");

    const admin = getAdminClient();

    const { count } = await admin.from("memberships").select("org_id", { count: "exact", head: true }).eq("user_id", user.id);
    if ((count || 0) > 0) throw new ApiError(400, "Your account already belongs to a firm. Please sign in.");

    // Unique short name for the firm
    const base = slugify(firmName).padEnd(3, "0");
    let slug = base;
    for (let i = 0; i < 6; i++) {
      const { data: taken } = await admin.from("organizations").select("id").eq("slug", slug).maybeSingle();
      if (!taken && slug !== "oddlambda") break;
      slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
    }

    const phone = String((user.user_metadata as Record<string, unknown>)?.phone || "").slice(0, 20) || null;
    const { error: profErr } = await admin.from("profiles").upsert({
      id: user.id,
      name,
      email: user.email.toLowerCase(),
      phone,
      role: "admin",
      is_active: true,
    });
    if (profErr) {
      console.error("[signup] profile error:", profErr.message);
      throw new ApiError(400, "Could not create your profile. Please try again.");
    }

    const { data: orgId, error: rpcErr } = await admin.rpc("platform_create_firm", {
      p_name: firmName,
      p_slug: slug,
      p_admin: user.id,
      p_status: "trial",
      p_trial_days: 14,
      p_copy_lists: true,
      p_created_by: user.id,
    });
    if (rpcErr || !orgId) {
      console.error("[signup] create firm failed:", rpcErr?.message);
      throw new ApiError(400, "Could not create your firm. Please try again, or contact Duesk support.");
    }

    await admin.from("user_active_org").upsert({ user_id: user.id, org_id: orgId as string });

    await writeAuditLog({
      orgId: orgId as string,
      action: "FIRM_SIGNUP",
      entity: "ORGANIZATIONS",
      entity_id: orgId as string,
      metadata: { firmName, slug, email: user.email, actor_name: name },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}