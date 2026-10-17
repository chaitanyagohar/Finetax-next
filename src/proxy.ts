import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Pages anyone may open without being signed in
const PUBLIC_PATHS = ["/login", "/forgot-password", "/auth/confirm", "/engagement"];

// Routes that only administrators may open
const ADMIN_ONLY_PATHS = ["/team", "/packages", "/audit-page", "/settings", "/proposals"];

// Routes that need a specific module (same as the sidebar)
const MODULE_PATHS: { base: string; module: string }[] = [
  { base: "/clients", module: "leads" },
  { base: "/leads", module: "leads" },
  { base: "/quotations", module: "quotations" },
  { base: "/client-discussions", module: "discussions" },
  { base: "/tasks", module: "tasks" },
  { base: "/calendar", module: "calendar" },
  { base: "/time-tracking", module: "time_tracking" },
  { base: "/documents", module: "documents" },
  { base: "/invoices", module: "invoices" },
  { base: "/inbox", module: "dashboard" },
];

// Routes for reviewers and administrators
const REVIEWER_PATHS = ["/reviewer-queue"];

// Same default as the root layout, for people with no modules saved
const DEFAULT_STAFF_MODULES = ["leads", "tasks", "time_tracking"];

// Set by /auth/confirm after a verified password-reset link
const RECOVERY_COOKIE = "ft_pw_recovery";

function matchesPath(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(base + "/");
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
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
  });

  // Redirect while preserving any refreshed session cookies
  function redirectTo(url: URL) {
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  function toDashboard() {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return redirectTo(url);
  }

  // IMPORTANT: getUser() validates the token with Supabase Auth and refreshes the session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isLoginPage = pathname.startsWith("/login");
  const isPublic = PUBLIC_PATHS.some((base) => matchesPath(pathname, base));

  // RULE 1: Not logged in? Go to the login page (and come back afterwards).
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("redirect", pathname + search);
    return redirectTo(url);
  }

  // RULE 2: Already logged in? Skip the login page.
  if (user && isLoginPage) return toDashboard();

  // RULE 3: /reset-password only works right after a verified reset link
  if (user && matchesPath(pathname, "/reset-password")) {
    if (request.cookies.get(RECOVERY_COOKIE)?.value !== user.id) return toDashboard();
  }

  // RULE 4: Admin-only, reviewer-only and module pages are checked on the server
  if (user) {
    const adminPath = ADMIN_ONLY_PATHS.some((base) => matchesPath(pathname, base));
    const reviewerPath = REVIEWER_PATHS.some((base) => matchesPath(pathname, base));
    const modulePath = MODULE_PATHS.find((m) => matchesPath(pathname, m.base));

    if (adminPath || reviewerPath || modulePath) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_active, is_reviewer, module_access")
        .eq("id", user.id)
        .single();

      const active = !!profile && profile.is_active !== false;
      const isAdmin = active && profile!.role === "admin";
      let allowed = false;

      if (adminPath) {
        allowed = isAdmin;
      } else if (reviewerPath) {
        allowed = isAdmin || (active && (profile!.role === "reviewer" || !!profile!.is_reviewer));
      } else if (modulePath) {
        const modules: string[] = Array.isArray(profile?.module_access) ? profile!.module_access : DEFAULT_STAFF_MODULES;
        allowed = isAdmin || (active && modules.includes(modulePath.module));
      }

      if (!allowed) return toDashboard();
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};