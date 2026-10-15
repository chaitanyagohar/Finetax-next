export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const RECOVERY_COOKIE = "ft_pw_recovery";

const ALLOWED_TYPES: EmailOtpType[] = ["recovery", "invite", "email", "email_change"];

function safeNext(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) return value;
  return "/";
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const failUrl = request.nextUrl.clone();
  failUrl.pathname = "/forgot-password";
  failUrl.search = "?error=link_invalid";

  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type)) {
    return NextResponse.redirect(failUrl);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error || !data.user) {
    return NextResponse.redirect(failUrl);
  }

  const target = request.nextUrl.clone();
  target.search = "";

  if (type === "recovery") {
    // Short-lived marker: only a freshly verified recovery link may open /reset-password
    const cookieStore = await cookies();
    cookieStore.set(RECOVERY_COOKIE, data.user.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 15 * 60,
    });
    target.pathname = "/reset-password";
  } else {
    target.pathname = safeNext(searchParams.get("next"));
  }

  return NextResponse.redirect(target);
}