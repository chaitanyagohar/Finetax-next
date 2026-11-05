import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/layout/AppShell";
import SignOutButton from "@/components/layout/SignOutButton";
import type { SessionUser } from "@/components/layout/navConfig";
import { createClient } from "@/lib/supabase/server";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
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
  themeColor: "#10233f",
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
  const supabase = await createClient();

  // getUser() validates the session with Supabase Auth (safe for authorization)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If no user is logged in, ONLY render the login page children
  if (!user) {
    return (
      <html lang="en" className={inter.variable}>
        <body className="m-0 bg-background p-0 text-text-main antialiased">{children}</body>
      </html>
    );
  }

  // Profile (name/email) + access in the current firm, fetched once on the server
  const [{ data: profile }, { data: accessData }] = await Promise.all([
    supabase.from("profiles").select("name, email, designation, is_active").eq("id", user.id).maybeSingle(),
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
          <html lang="en" className={inter.variable}>
            <body className="m-0 bg-background p-0 text-text-main antialiased">{children}</body>
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
        ? { title: "Free trial has ended", text: `The free trial for ${blocked.org_name} has ended. ${nextStep}` }
        : blocked?.status === "suspended"
          ? { title: "Firm account paused", text: `Access for ${blocked.org_name} has been paused. ${nextStep}` }
          : blocked?.status === "cancelled"
            ? { title: "Firm account closed", text: `The Duesk account for ${blocked.org_name} has been closed. ${nextStep}` }
            : {
                title: "Account deactivated",
                text: "Your access has been disabled, or you are not part of an active firm. Please contact your firm administrator.",
              };

    return (
      <html lang="en" className={inter.variable}>
        <body className="m-0 bg-background p-0 text-text-main antialiased">
          <div className="flex min-h-screen items-center justify-center p-6">
            <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-lg">
              <h1 className="text-lg font-bold text-navy">{screen.title}</h1>
              <p className="mt-2 text-sm text-text-muted">{screen.text}</p>
              <div className="mt-6 flex justify-center">
                <SignOutButton />
              </div>
            </div>
          </div>
        </body>
      </html>
    );
  }

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
  };

  // Trial reminder for firm administrators (last 7 days + 7-day grace)
  let trialNotice: string | null = null;
  if (isAdmin && access.org_status === "trial" && access.trial_ends_at) {
    const end = new Date(access.trial_ends_at);
    const daysLeft = Math.ceil((end.getTime() - Date.now()) / 86400000);
    const fmt = (d: Date) => d.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" }); // DD/MM/YYYY
    if (daysLeft <= 0) {
      const lockOn = new Date(end.getTime() + 7 * 86400000);
      trialNotice = `Your free trial ended on ${fmt(end)}. Access will be paused on ${fmt(lockOn)}. Contact Duesk to continue.`;
    } else if (daysLeft <= 7) {
      trialNotice = `Your free trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (${fmt(end)}). Contact Duesk to continue.`;
    }
  }

  return (
    <html lang="en" className={inter.variable}>
      <body className="m-0 bg-background p-0 text-text-main antialiased">
        <AppShell user={sessionUser}>{children}</AppShell>
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