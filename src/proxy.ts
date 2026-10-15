import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Pages anyone may open without being signed in
const PUBLIC_PATHS = ["/login", "/forgot-password", "/auth/confirm"];

// Routes that only administrators may open (enforced server-side)
const ADMIN_ONLY_PATHS = ["/team", "/packages", "/audit-page", "/settings"];

// Set by /auth/confirm after a verified password-reset link
const RECOVERY_COOKIE = "ft_pw_recovery";

function matchesPath(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(base + "/");
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  // Redirect while preserving any refreshed session cookies
  function redirectTo(url: URL) {
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  // IMPORTANT: getUser() validates the token with Supabase Auth and refreshes the session
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isLoginPage = pathname.startsWith("/login");
  const isPublic = PUBLIC_PATHS.some((base) => matchesPath(pathname, base));

  // SECURITY RULE 1: Not logged in? Go to login page (and come back afterwards).
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") {
      url.searchParams.set("redirect", pathname + search);
    }
    return redirectTo(url);
  }

  // SECURITY RULE 2: Already logged in? Go to dashboard.
  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return redirectTo(url);
  }

  // SECURITY RULE 3: /reset-password only works right after a verified reset link
  if (user && matchesPath(pathname, "/reset-password")) {
    if (request.cookies.get(RECOVERY_COOKIE)?.value !== user.id) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return redirectTo(url);
    }
  }

  // SECURITY RULE 4: Admin-only areas are blocked for non-admins on the server.
  if (user && ADMIN_ONLY_PATHS.some((base) => matchesPath(pathname, base))) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "admin" || profile.is_active === false) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return redirectTo(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};