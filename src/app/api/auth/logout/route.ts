import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // 1. Sign out from Supabase (clears session cookies on the server side)
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (error) {
    console.error("[logout] Sign-out error:", error);
  }

  // 2. Plain HTML form posts get a redirect; fetch() calls get a lightweight JSON reply
  const wantsHtml = (request.headers.get("accept") || "").includes("text/html");
  if (wantsHtml) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}