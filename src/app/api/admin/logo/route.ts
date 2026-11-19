export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireAdmin, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { readImage, removeImage, storeImage } from "@/lib/branding/images";

/** The firm logo, shown in the sidebar, on PDFs, in emails and in the client portal. Admins only. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    if (!(await checkRateLimit(`logo:${caller.orgId}`, 20, 60 * 60 * 1000))) throw new ApiError(429, "Too many changes. Please wait a little.");
    const image = await readImage(request);
    const admin = getAdminClient();
    const { data: firm } = await admin.from("firm_settings").select("logo_url").eq("org_id", caller.orgId).maybeSingle();
    const url = await storeImage(admin, "logos", caller.orgId, image, firm?.logo_url || null);
    const { error } = await admin.from("firm_settings").update({ logo_url: url }).eq("org_id", caller.orgId);
    if (error) throw new ApiError(500, "The logo could not be saved.");
    await writeAuditLog({ actor: caller, action: "UPDATE_LOGO", entity: "SETTINGS" });
    return NextResponse.json({ url });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    const admin = getAdminClient();
    const { data: firm } = await admin.from("firm_settings").select("logo_url").eq("org_id", caller.orgId).maybeSingle();
    await removeImage(admin, "logos", caller.orgId, firm?.logo_url || null);
    await admin.from("firm_settings").update({ logo_url: null }).eq("org_id", caller.orgId);
    await writeAuditLog({ actor: caller, action: "REMOVE_LOGO", entity: "SETTINGS" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** The firm's brand colour, used in the client portal and on PDFs. */
export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    const body = (await request.json().catch(() => null)) as { brandColor?: unknown } | null;
    const color = typeof body?.brandColor === "string" ? body.brandColor.trim() : "";
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new ApiError(400, "Use a colour like #0f172a.");
    const { error } = await getAdminClient().from("firm_settings").update({ brand_color: color || null }).eq("org_id", caller.orgId);
    if (error) throw new ApiError(500, "Could not save the colour.");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
