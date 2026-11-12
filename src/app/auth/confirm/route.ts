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

function failRedirect(request: NextRequest, type: string | null) {
  const url = request.nextUrl.clone();
  url.pathname = type === "invite" ? "/signup" : "/forgot-password";
  url.search = "?error=link_invalid";
  return NextResponse.redirect(url, 303);
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // some browsers omit it on same-site form posts
  try {
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Step 1: the link in the email only opens a "Continue" page. Nothing is used up yet,
 * so email security scanners that open links automatically can't spend the one-time token.
 */
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type)) return failRedirect(request, type);

  const url = request.nextUrl.clone();
  url.pathname = "/auth/confirm/continue"; // keeps the same query string
  return NextResponse.redirect(url);
}

/** Step 2: the person clicked Continue. Verify the one-time token and sign them in. */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const tokenHash = String(form?.get("token_hash") || "");
  const type = String(form?.get("type") || "") as EmailOtpType;
  const next = form?.get("next") ? String(form.get("next")) : null;

  // Only our own Continue page may submit this (stops another site signing you into a different account)
  if (!isSameOrigin(request)) return failRedirect(request, type);
  if (!tokenHash || !ALLOWED_TYPES.includes(type)) return failRedirect(request, type);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) return failRedirect(request, type);

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
  } else if (type === "invite") {
    // New signups (and later, invited staff) choose their password on /welcome
    target.pathname = "/welcome";
  } else {
    target.pathname = safeNext(next);
  }

  return NextResponse.redirect(target, 303);
}