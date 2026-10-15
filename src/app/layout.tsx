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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();

  // getUser() validates the session with Supabase Auth (safe for authorization)
  const { data: { user } } = await supabase.auth.getUser();

  // If no user is logged in, ONLY render the login page children
  if (!user) {
    return (
      <html lang="en" className={inter.variable}>
        <body className="m-0 bg-background p-0 text-text-main antialiased">{children}</body>
      </html>
    );
  }

  // Fetch profile once on the server and share it with the whole client shell
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // Block deactivated accounts
  if (profile && profile.is_active === false) {
    return (
      <html lang="en" className={inter.variable}>
        <body className="m-0 bg-background p-0 text-text-main antialiased">
          <div className="flex min-h-screen items-center justify-center p-6">
            <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-lg">
              <h1 className="text-lg font-bold text-navy">Account Deactivated</h1>
              <p className="mt-2 text-sm text-text-muted">
                Your access to Finetax Manager has been disabled. Please contact your firm administrator.
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

  const role: string = profile?.role || "staff";
  const isAdmin = role === "admin";

  // Only pass the minimum required fields to the browser
  const sessionUser: SessionUser = {
    id: user.id,
    name: profile?.name || user.email?.split("@")[0] || "Staff Member",
    email: profile?.email || user.email || "",
    role,
    designation: profile?.designation ?? null,
    isAdmin,
    isReviewer: isAdmin || role === "reviewer" || !!profile?.is_reviewer,
    moduleAccess: Array.isArray(profile?.module_access) ? profile.module_access : DEFAULT_STAFF_MODULES,
  };

  return (
    <html lang="en" className={inter.variable}>
      <body className="m-0 bg-background p-0 text-text-main antialiased">
        <AppShell user={sessionUser}>{children}</AppShell>
      </body>
    </html>
  );
}