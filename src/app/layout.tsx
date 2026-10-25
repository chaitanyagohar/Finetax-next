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
    default: "Finetax Manager",
    template: "%s · Finetax Manager",
  },
  description: "CA Firm Finetax Management System",
  robots: { index: false, follow: false }, // Internal system — never index
};

export const viewport: Viewport = {
  themeColor: "#10233f",
};

const DEFAULT_STAFF_MODULES = ["leads", "tasks", "time_tracking"];

type AccessRow = {
  org_id: string;
  org_name: string;
  role: string | null;
  is_reviewer: boolean | null;
  is_support_agent: boolean | null;
  module_access: unknown;
  designation: string | null;
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

  // Block deactivated accounts and people with no active firm
  if ((profile && profile.is_active === false) || !access?.org_id) {
    return (
      <html lang="en" className={inter.variable}>
        <body className="m-0 bg-background p-0 text-text-main antialiased">
          <div className="flex min-h-screen items-center justify-center p-6">
            <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-lg">
              <h1 className="text-lg font-bold text-navy">Account Deactivated</h1>
              <p className="mt-2 text-sm text-text-muted">
                Your access has been disabled, or you are not part of an active firm. Please contact your firm administrator.
              </p>
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
  };

  return (
    <html lang="en" className={inter.variable}>
      <body className="m-0 bg-background p-0 text-text-main antialiased">
        <AppShell user={sessionUser}>{children}</AppShell>
      </body>
    </html>
  );
}