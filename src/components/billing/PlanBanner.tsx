"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { SessionUser } from "@/components/layout/navConfig";
import { formatDate } from "@/lib/format";

type PlanInfo = { plan_name: string; max_users: number | null; max_clients: number | null; users: number; clients: number; grace_ends_at: string | null };

const HIDDEN = ["/setup", "/welcome", "/plan", "/reset-password"];

/** Tells firm admins when the firm is over its plan's limits. */
export default function PlanBanner({ user }: { user: SessionUser }) {
  const pathname = usePathname() || "/";
  const [supabase] = useState(() => createClient());
  const [info, setInfo] = useState<PlanInfo | null>(null);

  useEffect(() => {
    if (!user.isAdmin || user.isPlatformHome) return;
    supabase.rpc("my_plan").then(({ data }) => setInfo((data as PlanInfo) || null));
  }, [pathname, supabase, user.isAdmin, user.isPlatformHome]);

  if (!info || HIDDEN.some((p) => pathname.startsWith(p))) return null;
  const overUsers = info.max_users !== null && info.users > info.max_users;
  const overClients = info.max_clients !== null && info.clients > info.max_clients;
  if (!overUsers && !overClients) return null;

  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,720px)] -translate-x-1/2 items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 shadow-lg">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1">
        {overUsers && `Your firm has ${info.users} active users, but ${info.plan_name} allows ${info.max_users}. `}
        {overClients && `You have ${info.clients} active clients; ${info.plan_name} allows ${info.max_clients}, so new clients can't be added. `}
        {overUsers && info.grace_ends_at && `Choose who keeps access by ${formatDate(info.grace_ends_at)}, or it's limited automatically. `}
        <Link href="/team" className="font-semibold underline">
          Manage team
        </Link>
        {" or "}
        <Link href="/plan" className="font-semibold underline">
          see plans
        </Link>
        .
      </p>
    </div>
  );
}