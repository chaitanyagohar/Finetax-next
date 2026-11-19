export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireUser } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { readImage, removeImage, storeImage } from "@/lib/branding/images";

/** Sets the signed-in person's own profile photo. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireUser();
    if (!(await checkRateLimit(`avatar:${caller.userId}`, 20, 60 * 60 * 1000))) throw new ApiError(429, "Too many changes. Please wait a little.");
    const image = await readImage(request);
    const admin = getAdminClient();
    const { data: profile } = await admin.from("profiles").select("avatar_url").eq("id", caller.userId).maybeSingle();
    const url = await storeImage(admin, "avatars", caller.userId, image, profile?.avatar_url || null);
    const { error } = await admin.from("profiles").update({ avatar_url: url }).eq("id", caller.userId);
    if (error) throw new ApiError(500, "The photo could not be saved.");
    return NextResponse.json({ url });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireUser();
    const admin = getAdminClient();
    const { data: profile } = await admin.from("profiles").select("avatar_url").eq("id", caller.userId).maybeSingle();
    await removeImage(admin, "avatars", caller.userId, profile?.avatar_url || null);
    await admin.from("profiles").update({ avatar_url: null }).eq("id", caller.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
