"use client";

import { Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
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
        <Suspense fallback={<div className="hidden h-screen w-64 shrink-0 bg-navy lg:block" />}>
          <Sidebar user={user} mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        </Suspense>

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar user={user} onMenuClick={() => setMobileNavOpen(true)} />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">{children}</div>
          </main>
        </div>
      </div>
    </UserProvider>
  );
}