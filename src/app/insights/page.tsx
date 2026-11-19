"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeIndianRupee,
  Clock3,
  Gauge,
  Hourglass,
  LineChart,
  Loader2,
  Receipt,
  Save,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Card, EmptyState, Meter, PageHeader, Pill, Stat, btn, field } from "@/components/ui/kit";
import { compactINR, formatDate, formatINR, localISODate } from "@/lib/format";
import FeatureGate from "@/components/plan/FeatureGate";

type ClientRow = { client_id: string; client: string; revenue: number; collected: number; hours: number; cost: number; billable_value: number; margin: number };
type StaffRow = {
  user_id: string;
  name: string;
  hours: number;
  billable_hours: number;
  bill_rate: number;
  cost_rate: number;
  cost: number;
  billable_value: number;
  billed_value: number;
  available_hours: number;
};
type Profit = { clients: ClientRow[]; staff: StaffRow[]; working_days: number };
type Unbilled = {
  id: string;
  client_id: string;
  client_label: string;
  person: string;
  task_title: string | null;
  period: string | null;
  log_date: string;
  description: string;
  hours: number;
  bill_rate: number;
  value: number;
};
type Review = { reviewer_id: string; reviewer: string; waiting_now: number; oldest_waiting_hours: number | null; approved: number; avg_review_hours: number | null; returned_share: number | null };
type Member = { id: string; name: string; is_active: boolean; invite_pending: boolean };

type Tab = "profit" | "unbilled" | "review" | "rates";
const TABS: { key: Tab; label: string; icon: typeof LineChart }[] = [
  { key: "profit", label: "Profitability", icon: TrendingUp },
  { key: "unbilled", label: "Unbilled time", icon: Receipt },
  { key: "review", label: "Review flow", icon: ShieldCheck },
  { key: "rates", label: "Rates", icon: BadgeIndianRupee },
];

const PERIODS = [
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "fy", label: "This financial year" },
  { key: "90", label: "Last 90 days" },
];

function rangeFor(key: string): [string, string] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = localISODate(now);
  if (key === "month") return [localISODate(new Date(y, m, 1)), today];
  if (key === "quarter") {
    const fq = Math.floor(((m - 3 + 12) % 12) / 3);
    const startMonth = (3 + fq * 3) % 12;
    const startYear = startMonth > m ? y - 1 : y;
    return [localISODate(new Date(startYear, startMonth, 1)), today];
  }
  if (key === "fy") return [localISODate(new Date(m >= 3 ? y : y - 1, 3, 1)), today];
  return [localISODate(new Date(y, m, now.getDate() - 89)), today];
}

const hrs = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("en-IN")} h`;

function InsightsPage() {
  const user = useCurrentUser();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<Tab>("profit");
  const [period, setPeriod] = useState("quarter");
  const [profit, setProfit] = useState<Profit | null>(null);
  const [unbilled, setUnbilled] = useState<Unbilled[] | null>(null);
  const [review, setReview] = useState<Review[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [rates, setRates] = useState<Record<string, { bill: string; cost: string }>>({});
  const [savingRates, setSavingRates] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<"task" | "summary">("task");
  const [invoicing, setInvoicing] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [from, to] = useMemo(() => rangeFor(period), [period]);

  const loadProfit = useCallback(async () => {
    setProfit(null);
    const [p, r] = await Promise.all([
      supabase.rpc("practice_profitability", { p_from: from, p_to: to }),
      supabase.rpc("review_flow", { p_from: from, p_to: to }),
    ]);
    if (p.error) setNotice({ tone: "bad", text: p.error.message });
    setProfit((p.data as Profit) || { clients: [], staff: [], working_days: 0 });
    setReview((r.data || []) as Review[]);
  }, [supabase, from, to]);

  const loadUnbilled = useCallback(async () => {
    const { data, error } = await supabase.rpc("unbilled_time");
    if (error) setNotice({ tone: "bad", text: error.message });
    setUnbilled((data || []) as Unbilled[]);
  }, [supabase]);

  const loadRates = useCallback(async () => {
    const [m, r] = await Promise.all([supabase.rpc("firm_members"), supabase.from("member_rates").select("user_id, bill_rate, cost_rate")]);
    const people = ((m.data || []) as Member[]).filter((x) => x.is_active && !x.invite_pending);
    setMembers(people);
    const byUser = new Map((r.data || []).map((x) => [x.user_id, x]));
    setRates(Object.fromEntries(people.map((p) => [p.id, { bill: String(byUser.get(p.id)?.bill_rate ?? ""), cost: String(byUser.get(p.id)?.cost_rate ?? "") }])));
  }, [supabase]);

  useEffect(() => {
    if (user && !user.isAdmin && !user.permissions?.includes("see_profitability")) router.replace("/");
  }, [user, router]);

  useEffect(() => {
    loadProfit();
  }, [loadProfit]);

  useEffect(() => {
    loadUnbilled();
    loadRates();
  }, [loadUnbilled, loadRates]);

  const totals = useMemo(() => {
    const c = profit?.clients || [];
    const revenue = c.reduce((s, x) => s + Number(x.revenue), 0);
    const cost = (profit?.staff || []).reduce((s, x) => s + Number(x.cost), 0);
    const collected = c.reduce((s, x) => s + Number(x.collected), 0);
    const hours = (profit?.staff || []).reduce((s, x) => s + Number(x.hours), 0);
    const billable = (profit?.staff || []).reduce((s, x) => s + Number(x.billable_hours), 0);
    return { revenue, cost, collected, margin: revenue - cost, hours, billableShare: hours ? billable / hours : 0 };
  }, [profit]);

  const unbilledByClient = useMemo(() => {
    const map = new Map<string, { client_id: string; client: string; rows: Unbilled[]; hours: number; value: number }>();
    for (const r of unbilled || []) {
      const g = map.get(r.client_id) || { client_id: r.client_id, client: r.client_label, rows: [], hours: 0, value: 0 };
      g.rows.push(r);
      g.hours += Number(r.hours);
      g.value += Number(r.value);
      map.set(r.client_id, g);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [unbilled]);

  const noRates = members.length > 0 && Object.values(rates).every((r) => !Number(r.bill) && !Number(r.cost));

  async function saveRates() {
    setSavingRates(true);
    const rows = members.map((m) => ({
      user_id: m.id,
      bill_rate: Math.max(0, Number(rates[m.id]?.bill) || 0),
      cost_rate: Math.max(0, Number(rates[m.id]?.cost) || 0),
    }));
    const { error } = await supabase.from("member_rates").upsert(rows, { onConflict: "org_id,user_id" });
    setSavingRates(false);
    if (error) return setNotice({ tone: "bad", text: error.message });
    setNotice({ tone: "good", text: "Rates saved. Profitability and unbilled values now use them." });
    loadProfit();
    loadUnbilled();
  }

  async function invoiceClient(clientId: string, rows: Unbilled[]) {
    const ids = rows.filter((r) => picked.size === 0 || picked.has(r.id)).map((r) => r.id);
    if (!ids.length) return;
    setInvoicing(clientId);
    const { data, error } = await supabase.rpc("invoice_unbilled_time", { p_client: clientId, p_log_ids: ids, p_detail: detail });
    setInvoicing(null);
    if (error) return setNotice({ tone: "bad", text: error.message });
    router.push(`/invoices?open=${data}`);
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!user?.isAdmin && !user?.permissions?.includes("see_profitability")) return null;
  const isAdmin = !!user?.isAdmin;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LineChart}
        title="Practice insights"
        subtitle="Where the firm earns, where time goes, and what is waiting to be billed."
        actions={
          <select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)} className={`${field.input} w-auto py-1.5 text-xs`}>
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        }
      >
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface-alt p-1 text-xs font-semibold">
          {TABS.filter(({ key }) => isAdmin || key !== "rates").map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${tab === key ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"}`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
              {key === "unbilled" && unbilledByClient.length > 0 && <Pill tone="accent">{unbilledByClient.length}</Pill>}
            </button>
          ))}
        </div>
      </PageHeader>

      {notice && (
        <p role="status" className={`rounded-lg px-4 py-2.5 text-xs font-medium ${notice.tone === "good" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {notice.text}
        </p>
      )}

      {isAdmin && noRates && tab !== "rates" && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 sm:flex-row sm:items-center sm:justify-between">
          <span>Set each person&apos;s billing rate and cost per hour to see margins and the value of unbilled time.</span>
          <button type="button" onClick={() => setTab("rates")} className={btn.secondary}>
            Set rates
          </button>
        </div>
      )}

      <div key={tab} className="animate-content-in space-y-6">
        {tab === "profit" && (
          <>
            <div aria-busy={!profit} className="kpi-grid grid grid-cols-2 gap-4 xl:grid-cols-4">
              <Stat label="Invoiced (before GST)" value={compactINR(totals.revenue)} icon={Receipt} tone="info" hint={`${formatDate(from)} to ${formatDate(to)}`} />
              <Stat label="Collected" value={compactINR(totals.collected)} icon={BadgeIndianRupee} tone="good" />
              <Stat label="Cost of time" value={compactINR(totals.cost)} icon={Clock3} hint={`${hrs(totals.hours)} logged`} />
              <Stat
                label="Margin"
                value={compactINR(totals.margin)}
                icon={totals.margin >= 0 ? TrendingUp : TrendingDown}
                tone={totals.margin >= 0 ? "good" : "bad"}
                hint={`${Math.round(totals.billableShare * 100)}% of hours billable`}
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
              <Card title="Clients" icon={UsersRound} bodyClassName="">
                {!profit ? (
                  <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10" />)}</div>
                ) : profit.clients.length === 0 ? (
                  <EmptyState title="No activity in this period" hint="Invoices, payments or time logged against clients appear here." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th>Client</th>
                          <th className="text-right">Invoiced</th>
                          <th className="text-right">Hours</th>
                          <th className="text-right">Cost</th>
                          <th className="text-right">Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profit.clients.map((c) => {
                          const loss = Number(c.margin) < 0;
                          return (
                            <tr key={c.client_id}>
                              <td className="max-w-[220px] truncate font-medium text-text-main">{c.client}</td>
                              <td className="text-right tabular-nums">{formatINR(Number(c.revenue))}</td>
                              <td className="text-right tabular-nums text-text-muted">{hrs(Number(c.hours))}</td>
                              <td className="text-right tabular-nums text-text-muted">{formatINR(Number(c.cost))}</td>
                              <td className={`text-right font-semibold tabular-nums ${loss ? "text-rose-600" : "text-emerald-700"}`}>
                                {formatINR(Number(c.margin))}
                                {loss && Number(c.revenue) === 0 && <span className="block text-[10px] font-medium text-text-muted">not invoiced yet</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card title="People" icon={Gauge} bodyClassName="divide-y divide-border">
                {!profit ? (
                  <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12" />)}</div>
                ) : (
                  profit.staff.map((s) => {
                    const util = s.available_hours ? Number(s.billable_hours) / s.available_hours : 0;
                    return (
                      <div key={s.user_id} className="px-4 py-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium text-text-main">{s.name}</p>
                          <p className="text-[11px] tabular-nums text-text-muted">
                            {hrs(Number(s.hours))} · {hrs(Number(s.billable_hours))} billable
                          </p>
                        </div>
                        <div className="mt-2 flex items-center gap-3">
                          <Meter value={util} tone={util > 0.85 ? "bad" : util > 0.5 ? "good" : "warn"} />
                          <span className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums text-text-main">{Math.round(util * 100)}%</span>
                        </div>
                        <p className="mt-1 text-[10px] text-text-muted">
                          Billable value {formatINR(Number(s.billable_value))} · cost {formatINR(Number(s.cost))} · utilisation of {profit.working_days} working days
                        </p>
                      </div>
                    );
                  })
                )}
              </Card>
            </div>
          </>
        )}

        {tab === "unbilled" && (
          <Card
            title="Billable time not yet invoiced"
            icon={Receipt}
            bodyClassName=""
            action={
              <label className="flex items-center gap-2 text-[11px] text-text-muted">
                Invoice lines
                <select value={detail} onChange={(e) => setDetail(e.target.value as "task" | "summary")} className="rounded-md border border-border bg-surface px-2 py-1 text-[11px]">
                  <option value="task">One per task</option>
                  <option value="summary">One summary line</option>
                </select>
              </label>
            }
          >
            {unbilled === null ? (
              <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12" />)}</div>
            ) : unbilledByClient.length === 0 ? (
              <EmptyState title="Everything billable has been invoiced" hint="Time logged as billable against a client, from the last 12 months, shows here until it is invoiced." />
            ) : (
              <ul className="divide-y divide-border">
                {unbilledByClient.map((g) => {
                  const chosen = g.rows.filter((r) => picked.has(r.id));
                  const useRows = chosen.length ? chosen : g.rows;
                  const value = useRows.reduce((s, r) => s + Number(r.value), 0);
                  return (
                    <li key={g.client_id} className="p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-text-main">{g.client}</p>
                          <p className="text-[11px] text-text-muted">
                            {hrs(g.hours)} · {formatINR(g.value)} · oldest {formatDate(g.rows[0]?.log_date)}
                          </p>
                        </div>
                        <button type="button" hidden={!isAdmin} onClick={() => invoiceClient(g.client_id, g.rows)} disabled={invoicing === g.client_id} className={btn.primary}>
                          {invoicing === g.client_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
                          Draft invoice{chosen.length ? ` for ${chosen.length} entr${chosen.length === 1 ? "y" : "ies"}` : ""} · {formatINR(value)}
                        </button>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] font-semibold text-text-muted hover:text-text-main">
                          {g.rows.length} entr{g.rows.length === 1 ? "y" : "ies"}, tick some to invoice only those
                        </summary>
                        <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                          {g.rows.map((r) => (
                            <li key={r.id}>
                              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-xs hover:bg-surface-alt">
                                <input type="checkbox" checked={picked.has(r.id)} onChange={() => togglePick(r.id)} className="h-4 w-4 accent-[var(--color-accent)]" />
                                <span className="w-20 shrink-0 text-text-muted">{formatDate(r.log_date)}</span>
                                <span className="min-w-0 flex-1 truncate">
                                  <span className="font-medium text-text-main">{r.task_title ? `${r.task_title}${r.period ? ` · ${r.period}` : ""}` : r.description}</span>
                                  <span className="text-text-muted"> · {r.person}</span>
                                </span>
                                <span className="shrink-0 tabular-nums">{hrs(Number(r.hours))}</span>
                                <span className="w-20 shrink-0 text-right tabular-nums text-text-muted">{formatINR(Number(r.value))}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}

        {tab === "review" && (
          <Card title="Review flow" icon={Hourglass} bodyClassName="">
            {review === null ? (
              <div className="space-y-2 p-4">{[0, 1].map((i) => <div key={i} className="skeleton h-12" />)}</div>
            ) : review.length === 0 ? (
              <EmptyState title="Nothing waiting for review" hint="Reviewers with work in their queue, or work approved in this period, appear here." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th>Reviewer</th>
                      <th className="text-right">Waiting now</th>
                      <th className="text-right">Oldest waiting</th>
                      <th className="text-right">Approved</th>
                      <th className="text-right">Average wait</th>
                      <th className="text-right">Sent back at least once</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.map((r) => {
                      const oldDays = r.oldest_waiting_hours ? r.oldest_waiting_hours / 24 : 0;
                      return (
                        <tr key={r.reviewer_id}>
                          <td className="font-medium text-text-main">{r.reviewer}</td>
                          <td className="text-right tabular-nums">{r.waiting_now ? <Pill tone={r.waiting_now > 5 ? "bad" : "warn"}>{r.waiting_now}</Pill> : "0"}</td>
                          <td className={`text-right tabular-nums ${oldDays > 2 ? "font-semibold text-rose-600" : "text-text-muted"}`}>
                            {r.oldest_waiting_hours ? (oldDays >= 1 ? `${oldDays.toFixed(1)} days` : `${Math.round(r.oldest_waiting_hours)} h`) : "–"}
                          </td>
                          <td className="text-right tabular-nums">{r.approved}</td>
                          <td className="text-right tabular-nums text-text-muted">{r.avg_review_hours ? `${Math.round(r.avg_review_hours)} h` : "–"}</td>
                          <td className="text-right tabular-nums text-text-muted">{r.returned_share !== null ? `${Math.round(Number(r.returned_share) * 100)}%` : "–"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {tab === "rates" && (
          <Card
            title="Billing rate and cost per hour"
            icon={BadgeIndianRupee}
            bodyClassName=""
            action={
              <button type="button" onClick={saveRates} disabled={savingRates} className={btn.primary}>
                {savingRates ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save rates
              </button>
            }
          >
            <p className="border-b border-border px-4 py-3 text-xs text-text-muted">
              Billing rate is what an hour of this person&apos;s time is charged at. Cost per hour is what it costs the firm, roughly monthly salary divided by 200.
              Only administrators see these figures.
            </p>
            <ul className="divide-y divide-border">
              {members.map((m) => (
                <li key={m.id} className="grid grid-cols-[1fr_120px_120px] items-center gap-3 px-4 py-2.5">
                  <span className="truncate text-sm text-text-main">{m.name}</span>
                  <input
                    aria-label={`Billing rate for ${m.name}`}
                    inputMode="decimal"
                    placeholder="₹ / hour"
                    value={rates[m.id]?.bill ?? ""}
                    onChange={(e) => setRates({ ...rates, [m.id]: { ...rates[m.id], bill: e.target.value.replace(/[^\d.]/g, "") } })}
                    className={`${field.input} text-right text-xs`}
                  />
                  <input
                    aria-label={`Cost per hour for ${m.name}`}
                    inputMode="decimal"
                    placeholder="₹ / hour"
                    value={rates[m.id]?.cost ?? ""}
                    onChange={(e) => setRates({ ...rates, [m.id]: { ...rates[m.id], cost: e.target.value.replace(/[^\d.]/g, "") } })}
                    className={`${field.input} text-right text-xs`}
                  />
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-[1fr_120px_120px] gap-3 border-t border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              <span />
              <span className="text-right">Billing rate</span>
              <span className="text-right">Cost per hour</span>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function InsightsPageWithPlan() {
  return (
    <FeatureGate feature="insights">
      <InsightsPage />
    </FeatureGate>
  );
}
