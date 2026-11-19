import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./onboarding.css";
import AppShell from "@/components/layout/AppShell";
import OnboardingLayer from "@/components/onboarding/OnboardingLayer";
import PlanBanner from "@/components/billing/PlanBanner";
import PendingInvitations from "@/components/team/PendingInvitations";
import SignOutButton from "@/components/layout/SignOutButton";
import type { SessionUser } from "@/components/layout/navConfig";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

// Served from the repo so builds and pages never depend on fonts.googleapis.com.
const geist = localFont({
  src: "../fonts/geist-variable.woff2",
  weight: "100 900",
  variable: "--font-geist",
  display: "swap",
});

const geistMono = localFont({
  src: "../fonts/geist-mono-variable.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Duesk",
    template: "%s · Duesk",
  },
  description: "Practice management for CA firms · Duesk by Oddlambda",
  robots: { index: false, follow: false }, // Internal system — never index
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

const DEFAULT_STAFF_MODULES = ["leads", "tasks", "time_tracking"];

type AccessRow = {
  org_id: string;
  org_name: string;
  org_slug?: string | null;
  role: string | null;
  is_reviewer: boolean | null;
  is_support_agent: boolean | null;
  module_access: unknown;
  designation: string | null;
  is_platform_owner?: boolean | null;
  org_status?: string | null;
  trial_ends_at?: string | null;
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Client portal pages, and the two-step code page (nothing of the firm opens before it): no staff shell
  const path = (await headers()).get("x-pathname") || "";
  if (path.startsWith("/portal") || path === "/verify" || path.startsWith("/verify/")) {
    return (
      <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
        <body className="m-0 bg-background p-0 text-text-main antialiased">{children}</body>
      </html>
    );
  }

  const supabase = await createClient();

  // getUser() validates the session with Supabase Auth (safe for authorization)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If no user is logged in, ONLY render the login page children
  if (!user) {
    return (
      <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
        <body className="m-0 bg-background p-0 text-text-main antialiased">{children}</body>
      </html>
    );
  }

  // Profile (name/email) + access in the current firm, fetched once on the server
  const [{ data: profile }, { data: accessData }] = await Promise.all([
    supabase.from("profiles").select("name, email, designation, is_active, avatar_url").eq("id", user.id).maybeSingle(),
    supabase.rpc("my_access"),
  ]);
  const access = accessData as AccessRow | null;

  // Block deactivated accounts and people whose firm is not active (trial ended, suspended, closed)
  if ((profile && profile.is_active === false) || !access?.org_id) {
    // A brand-new signup has no firm yet: show /welcome without the app shell (the proxy sends them there)
    if (profile?.is_active !== false) {
      const { data: signupState } = await supabase.rpc("my_signup_state");
      if (!(signupState as { has_membership?: boolean } | null)?.has_membership) {
        return (
          <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
            <body className="m-0 bg-background p-0 text-text-main antialiased">
              {children}
              <PendingInvitations />
            </body>
          </html>
        );
      }
    }
    const { data: blockedData } =
      profile?.is_active === false ? { data: null } : await supabase.rpc("my_blocked_firm");
    const blocked = blockedData as { org_name: string; status: string; trial_ends_at: string | null; is_admin: boolean } | null;
    const contact = process.env.NEXT_PUBLIC_DUESK_CONTACT_EMAIL;
    const nextStep = blocked?.is_admin
      ? `To continue, please contact Duesk${contact ? ` at ${contact}` : ""}. Your firm's data is kept safe.`
      : "Please ask your firm administrator to contact Duesk. Your firm's data is kept safe.";
    const screen =
      blocked?.status === "expired"
        ? // Trials move to the free Starter plan; "expired" is only set by Duesk by hand (B-07)
          { title: "Firm account expired", text: `Access for ${blocked.org_name} has expired. ${nextStep}` }
        : blocked?.status === "suspended"
          ? { title: "Firm account paused", text: `Access for ${blocked.org_name} has been paused. ${nextStep}` }
          : blocked?.status === "cancelled"
            ? { title: "Firm account closed", text: `The Duesk account for ${blocked.org_name} has been closed. ${nextStep}` }
            : {
                title: "Account deactivated",
                text: "Your access has been disabled, or you are not part of an active firm. Please contact your firm administrator.",
              };

    return (
      <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
        <body className="m-0 bg-background p-0 text-text-main antialiased">
          <div className="flex min-h-screen items-center justify-center p-6">
            <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-lg">
              <h1 className="text-lg font-semibold text-navy">{screen.title}</h1>
              <p className="mt-2 text-sm text-text-muted">{screen.text}</p>
              <div className="mt-6 flex justify-center">
                <SignOutButton />
              </div>
            </div>
          </div>
          {profile?.is_active !== false && <PendingInvitations />}
        </body>
      </html>
    );
  }

  const [{ data: planData }, { data: brand }, { data: perms }] = await Promise.all([
    supabase.rpc("my_features"),
    supabase.from("firm_settings").select("logo_url").maybeSingle(),
    supabase.rpc("my_permissions"),
  ]);
  const plan = planData as { plan?: string; plan_name?: string; features?: Record<string, boolean> } | null;

  const role: string = access.role || "staff";
  const isAdmin = role === "admin";

  // Only pass the minimum required fields to the browser
  const sessionUser: SessionUser = {
    id: user.id,
    name: profile?.name || user.email?.split("@")[0] || "Staff Member",
    email: profile?.email || user.email || "",
    role,
    designation: access.designation ?? profile?.designation ?? null,
    isAdmin,
    isReviewer: isAdmin || role === "reviewer" || !!access.is_reviewer,
    isSupportAgent: !!access.is_support_agent,
    moduleAccess: Array.isArray(access.module_access) ? (access.module_access as string[]) : DEFAULT_STAFF_MODULES,
    orgId: access.org_id,
    orgName: access.org_name,
    isPlatformOwner: !!access.is_platform_owner,
    isPlatformHome: access.org_slug === "oddlambda",
    features: plan?.features || {},
    plan: plan?.plan,
    planName: plan?.plan_name,
    avatarUrl: profile?.avatar_url || null,
    firmLogoUrl: brand?.logo_url || null,
    permissions: Array.isArray(perms) ? (perms as string[]) : [],
  };

  // Trial reminder for firm administrators (last 7 days of the trial)
  let trialNotice: string | null = null;
  if (isAdmin && access.org_status === "trial" && access.trial_ends_at) {
    const end = new Date(access.trial_ends_at);
    const daysLeft = Math.ceil((end.getTime() - Date.now()) / 86400000);
    const fmt = (d: Date) => d.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" }); // DD/MM/YYYY
    if (daysLeft <= 0) {
      trialNotice = "Your free trial has ended. Your firm moves to the free Starter plan (3 users, 200 active clients) tonight. See Plan to upgrade.";
    } else if (daysLeft <= 7) {
      trialNotice = `Your free trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (${fmt(end)}). After that your firm moves to the free Starter plan (3 users, 200 active clients) unless you upgrade.`;
    }
  }

  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="m-0 bg-background p-0 text-text-main antialiased">
        <AppShell user={sessionUser}>{children}</AppShell>
        <OnboardingLayer user={sessionUser} />
        <PlanBanner user={sessionUser} />
        <PendingInvitations />
        {trialNotice && (
          <div
            role="status"
            className="fixed bottom-4 left-1/2 z-[60] w-[min(92vw,640px)] -translate-x-1/2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-center text-xs font-semibold text-amber-900 shadow-lg"
          >
            {trialNotice}
          </div>
        )}
      </body>
    </html>
  );
}