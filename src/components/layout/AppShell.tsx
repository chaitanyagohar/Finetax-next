"use client";

import { Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import NavigationProgress from "./NavigationProgress";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { UserProvider } from "./UserContext";
import type { SessionUser } from "./navConfig";

// Full-screen pages that must not show the sidebar / topbar
const BARE_PATHS = ["/reset-password", "/engagement"];

export default function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer whenever the route changes
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (BARE_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return <UserProvider value={user}>{children}</UserProvider>;
  }

  return (
    <UserProvider value={user}>
      <div className="flex h-screen w-screen overflow-hidden bg-background">
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        <Suspense fallback={<div className="hidden h-screen w-64 shrink-0 bg-navy lg:block" />}>
          <Sidebar user={user} mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        </Suspense>

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar user={user} onMenuClick={() => setMobileNavOpen(true)} />
          <main className="flex-1 overflow-y-auto">
            {/* Extra bottom space so the floating Help and tour buttons never cover the last row */}
            {/* Keyed by page, so each page fades in when you arrive */}
            <div key={pathname} className="mx-auto w-full max-w-[1600px] animate-page-in p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8 lg:pb-24">
              {children}
            </div>
          </main>
        </div>
      </div>
    </UserProvider>
  );
}