"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import PlanFeatures from "@/components/plan/PlanFeatures";

type PlanInfo = {
  plan: string;
  plan_name: string;
  max_users: number | null;
  max_clients: number | null;
  status: string;
  trial_ends_at: string | null;
  grace_ends_at: string | null;
  users: number;
  clients: number;
};

const PLANS = [
  { id: "starter", name: "Starter", for: "A solo CA or small practice", users: "Up to 3", clients: "Up to 200 active", price: "Free", support: "Email support", onboarding: "Self-serve" },
  { id: "professional", name: "Professional", for: "Growing firms", users: "Up to 15", clients: "Unlimited", price: "Paid", support: "Priority support", onboarding: "A guided setup call" },
  { id: "firm", name: "Firm", for: "Larger and multi-branch firms", users: "Unlimited", clients: "Unlimited", price: "Paid", support: "A dedicated contact", onboarding: "We move your data for you" },
];

function Meter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const over = max !== null && used > max;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-text-main">{label}</span>
        <span className={over ? "font-semibold text-rose-600" : "text-text-muted"}>
          {used} {max === null ? "(unlimited)" : `of ${max}`}
        </span>
      </div>
      {max !== null && (
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-alt">
          <div className={`h-2 rounded-full transition-all duration-700 ${over ? "bg-rose-500" : pct > 80 ? "bg-amber-500" : "bg-navy"}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
    </div>
  );
}

export default function PlanPage() {
  const [supabase] = useState(() => createClient());
  const [info, setInfo] = useState<PlanInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const contact = process.env.NEXT_PUBLIC_DUESK_CONTACT_EMAIL;

  useEffect(() => {
    supabase.rpc("my_plan").then(({ data }) => {
      setInfo((data as PlanInfo) || null);
      setLoading(false);
    });
  }, [supabase]);

  if (loading || !info) {
    return (
      <div className="flex items-center gap-2 p-10 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your plan...
      </div>
    );
  }

  const onTrial = info.status === "trial";
  const overUsers = info.max_users !== null && info.users > info.max_users;
  const overClients = info.max_clients !== null && info.clients > info.max_clients;
  const upgradeHref = contact
    ? `mailto:${contact}?subject=${encodeURIComponent("Plan change for my firm")}`
    : "/help";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight text-text-main">Your plan</h2>
        <p className="mt-1 text-sm text-text-muted">
          {onTrial && info.trial_ends_at
            ? `You're on a free trial of Professional until ${formatDate(info.trial_ends_at)}. After that your firm moves to the free Starter plan unless you upgrade.`
            : `Your firm is on the ${info.plan_name} plan.`}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-5 rounded-xl border border-border bg-surface p-5 shadow-sm">
          <p className="text-sm font-semibold text-text-main">{onTrial ? "Professional (trial)" : info.plan_name}</p>
          <Meter label="Active users" used={info.users} max={info.max_users} />
          <Meter label="Active clients" used={info.clients} max={info.max_clients} />
          {(overUsers || overClients) && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              {overUsers && (
                <p>
                  You have more users than this plan allows.
                  {info.grace_ends_at ? ` Choose who keeps access by ${formatDate(info.grace_ends_at)}; after that, access is limited automatically (admins first, then the most recently active people).` : ""}{" "}
                  <Link href="/team" className="font-semibold underline">
                    Manage team
                  </Link>
                </p>
              )}
              {overClients && <p className={overUsers ? "mt-2" : ""}>You can&apos;t add new clients until you&apos;re under the limit. Marking old clients inactive frees up space.</p>}
            </div>
          )}
          <a href={upgradeHref} className="inline-flex w-full items-center justify-center rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-light">
            Talk to us about upgrading
          </a>
          <p className="text-xs text-text-muted">Plan changes are handled by the Duesk team for now, usually the same day.</p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm lg:col-span-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 font-medium text-text-muted" />
                {PLANS.map((p) => (
                  <th key={p.id} className={`px-4 py-3 ${info.plan === p.id && !onTrial ? "text-navy" : "text-text-main"}`}>
                    <span className="block font-semibold">{p.name}</span>
                    <span className="block text-xs font-normal text-text-muted">{p.for}</span>
                    {info.plan === p.id && !onTrial && (
                      <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-navy">
                        <Check className="h-3.5 w-3.5" /> Current plan
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Price", "price"],
                  ["Users", "users"],
                  ["Active clients", "clients"],
                  ["Support", "support"],
                  ["Getting started", "onboarding"],
                ] as const
              ).map(([label, key]) => (
                <tr key={key} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-text-muted">{label}</td>
                  {PLANS.map((p) => (
                    <td key={p.id} className="px-4 py-3 text-text-main">
                      {p[key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PlanFeatures />
    </div>
  );
}