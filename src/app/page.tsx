"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  CheckSquare,
  Clock,
  AlertCircle,
  FileText,
  CheckCircle2,
  Users,
  IndianRupee,
  Receipt,
  ArrowRight,
  Plus,
  ShieldCheck,
  Calendar,
  X,
  MessageSquare,
  TrendingUp,
  UserPlus,
  RefreshCw,
  Briefcase,
  CalendarDays,
  Timer,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/supabase/fetchAll";
import { useCurrentUser } from "@/components/layout/UserContext";
import { compactINR, formatDate, formatINR, localISODate } from "@/lib/format";
import ImportantNotifications from "@/components/notifications/ImportantNotifications";
import AnnouncementsPanel from "@/components/notifications/AnnouncementsPanel";
import { hasFeature } from "@/lib/features";
import EscalationList from "@/components/tasks/EscalationList";
import { clientLabel } from "@/components/ui/ClientPicker";
import Link from "next/link";
import { HeroDecor } from "@/components/ui/Decor";

/* =========================================================
   CONSTANTS
   ========================================================= */

const STAGES = ["Assigned", "In Progress", "Submitted for Review", "Changes Required", "Approved"];

const STAGE_STYLES: Record<string, string> = {
  Assigned: "bg-slate-100 text-slate-700 border-slate-200",
  "In Progress": "bg-blue-50 text-blue-700 border-blue-200",
  "Submitted for Review": "bg-violet-50 text-violet-700 border-violet-200",
  "Changes Required": "bg-amber-50 text-amber-700 border-amber-200",
  Approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const STAGE_BARS: Record<string, string> = {
  Assigned: "bg-slate-400",
  "In Progress": "bg-blue-500",
  "Submitted for Review": "bg-violet-500",
  "Changes Required": "bg-amber-500",
  Approved: "bg-emerald-500",
};


type Tone = "navy" | "emerald" | "amber" | "rose" | "blue" | "violet";

const TONES: Record<Tone, { icon: string; value: string }> = {
  navy: { icon: "bg-navy/10 text-navy", value: "text-navy" },
  emerald: { icon: "bg-emerald-50 text-emerald-600", value: "text-emerald-700" },
  amber: { icon: "bg-amber-50 text-amber-600", value: "text-amber-700" },
  rose: { icon: "bg-rose-50 text-rose-600", value: "text-rose-600" },
  blue: { icon: "bg-blue-50 text-blue-600", value: "text-blue-700" },
  violet: { icon: "bg-violet-50 text-violet-600", value: "text-violet-700" },
};

/* =========================================================
   HELPERS
   ========================================================= */

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localISODate(new Date(y, m - 1, d + n));
}

function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO.slice(0, 10)) - Date.parse(fromISO.slice(0, 10))) / 86400000);
}

function isoOf(value: unknown): string {
  const v = String(value || "");
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "";
}

function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const offset = (date.getDay() + 6) % 7;
  return localISODate(new Date(y, m - 1, d - offset));
}

function fyStartYear(today: string): number {
  const [y, m] = today.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

function currentFYLabel(today: string): string {
  const start = fyStartYear(today);
  return `FY ${start}-${String(start + 1).slice(-2)}`;
}

/** Inclusive start / exclusive end (YYYY-MM-DD) for the selected period, or null for all time. */
function periodBounds(filter: string, today: string): [string, string] | null {
  const [y, m] = today.split("-").map(Number);
  if (filter === "month") return [localISODate(new Date(y, m - 1, 1)), localISODate(new Date(y, m, 1))];
  if (filter === "quarter") {
    const q = Math.floor((m - 1) / 3);
    return [localISODate(new Date(y, q * 3, 1)), localISODate(new Date(y, q * 3 + 3, 1))];
  }
  if (filter === "fy") {
    const s = fyStartYear(today);
    return [`${s}-04-01`, `${s + 1}-04-01`];
  }
  return null;
}

function invoiceDate(inv: any): string {
  return isoOf(inv.date || inv.issue_date || inv.created_at);
}

function invoiceBalance(inv: any): number {
  return Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0));
}

type FinanceTotals = {
  billed: number;
  billed_count: number;
  collected: number;
  payments_count: number;
  outstanding: number;
  outstanding_count: number;
  aging: { bucket: number; count: number; amount: number }[];
  trend: { month: string; billed: number; collected: number }[];
  has_activity: boolean;
};

type CrmTotals = {
  open_leads: number;
  lead_followups_due: number;
  won_leads: number;
  lost_leads: number;
  open_quotes: number;
  pipeline_value: number;
  active_clients: number;
  client_master: number;
  discussion_followups: number;
};

const AGING_BUCKETS = [
  { label: "Not yet due", bar: "bg-blue-500" },
  { label: "1–30 days overdue", bar: "bg-amber-400" },
  { label: "31–60 days overdue", bar: "bg-orange-500" },
  { label: "61–90 days overdue", bar: "bg-rose-500" },
  { label: "90+ days overdue", bar: "bg-rose-700" },
];

function formatHours(hours: number): string {
  const mins = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/* =========================================================
   SMALL UI COMPONENTS
   ========================================================= */

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "navy",
  onClick,
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon: ComponentType<{ className?: string }>;
  tone?: Tone;
  onClick?: () => void;
  href?: string;
}) {
  const t = TONES[tone];
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
          <p className={`mt-1.5 truncate text-2xl font-semibold tracking-tight ${t.value}`}>{value}</p>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${t.icon}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {sub && <div className="mt-2 text-[11px] text-text-muted">{sub}</div>}
    </>
  );

  const base = "block w-full rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition";
  const interactive = " hover:-translate-y-0.5 hover:border-navy/30 hover:shadow-md";

  if (href) return <Link href={href} className={base + interactive}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={base + interactive}>{inner}</button>;
  return <div className={base}>{inner}</div>;
}

function Panel({
  title,
  icon: Icon,
  action,
  children,
  className = "",
  flush = false,
  tour,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  tour?: string;
}) {
  return (
    <section data-tour={tour} className={`flex flex-col rounded-xl border border-border bg-surface shadow-sm ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-main">
          <Icon className="h-4 w-4 text-navy" />
          {title}
        </h3>
        {action}
      </header>
      <div className={flush ? "flex-1 overflow-x-auto" : "flex-1 p-4"}>{children}</div>
    </section>
  );
}

function PanelLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-navy hover:underline">
      {label} <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

function StageBadge({ stage }: { stage?: string }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
        STAGE_STYLES[stage || ""] || "border-navy/20 bg-navy/10 text-navy"
      }`}
    >
      {stage || "—"}
    </span>
  );
}

function EmptyState({ icon: Icon, text }: { icon: ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-alt">
        <Icon className="h-5 w-5 text-text-muted" />
      </div>
      <p className="text-xs text-text-muted">{text}</p>
    </div>
  );
}

function DueDate({ date, today }: { date?: string | null; today: string }) {
  if (!date) return <span className="text-text-muted">—</span>;
  const d = date.slice(0, 10);
  const overdue = d < today;
  const isToday = d === today;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap font-medium ${
        overdue ? "font-semibold text-rose-600" : isToday ? "font-semibold text-amber-600" : "text-text-main"
      }`}
    >
      {overdue && <AlertCircle className="h-3 w-3" />}
      {formatDate(d)}
    </span>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <div className="h-5 w-56 skeleton" />
        <div className="mt-2 h-3 w-80 skeleton" />
      </div>
      <div className="kpi-grid grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl border border-border bg-surface shadow-sm" />
        ))}
      </div>
      <div className="h-24 rounded-xl border border-border bg-surface shadow-sm" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="h-64 rounded-xl border border-border bg-surface shadow-sm lg:col-span-2" />
        <div className="h-64 rounded-xl border border-border bg-surface shadow-sm" />
      </div>
    </div>
  );
}

/* =========================================================
   PAGE
   ========================================================= */

export default function DashboardPage() {
  const currentUser = useCurrentUser();
  const me = currentUser?.id || "";
  const isAdmin = !!currentUser?.isAdmin;
  const isReviewer = !!currentUser?.isReviewer;
  const [supabase] = useState(() => createClient());

  // Open tasks only; finished work is counted in the database instead of downloaded.
  const [tasks, setTasks] = useState<any[]>([]);
  const [approvedCount, setApprovedCount] = useState(0);
  const [clients, setClients] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [finance, setFinance] = useState<FinanceTotals | null>(null);
  const [crm, setCrm] = useState<CrmTotals | null>(null);
  const [recentInvoices, setRecentInvoices] = useState<any[]>([]);
  const [complianceEvents, setComplianceEvents] = useState<any[]>([]);
  const [weekHours, setWeekHours] = useState(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Filters & State
  const [dateFilter, setDateFilter] = useState("all"); // 'month', 'quarter', 'fy', 'all'
  const [selectedOverdueTask, setSelectedOverdueTask] = useState<any | null>(null);
  const [isOverdueDrawerOpen, setIsOverdueDrawerOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const reloadTimer = useRef<number | null>(null);
  // Realtime reloads run from a listener set up once, so they read the period from here.
  const dateFilterRef = useRef(dateFilter);
  const today = localISODate();
  const fyLabel = currentFYLabel(today);

  const DATE_FILTER_LABELS: Record<string, string> = {
    all: "All Time",
    month: "This Month",
    quarter: "This Quarter",
    fy: fyLabel,
  };

  useEffect(() => {
    loadDashboardData(true);

    // Real-time updates, grouped so bursts of changes trigger one refresh
    const scheduleReload = () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => loadDashboardData(), 800);
    };

    const taskSub = supabase.channel("realtime-tasks").on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, scheduleReload).subscribe();
    const invSub = supabase.channel("realtime-invoices").on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, scheduleReload).subscribe();
    const paySub = supabase
      .channel("realtime-payments")
      .on("postgres_changes", { event: "*", schema: "public", table: "invoice_payments" }, scheduleReload)
      .subscribe();

    return () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      supabase.removeChannel(taskSub);
      supabase.removeChannel(invSub);
      supabase.removeChannel(paySub);
    };
  }, []);

  function changeDateFilter(next: string) {
    setDateFilter(next);
    dateFilterRef.current = next;
    loadFinance(next);
  }

  async function loadFinance(filter: string) {
    const bounds = periodBounds(filter, localISODate());
    let recentQuery = supabase
      .from("invoices")
      .select("id, invoice_number, client_id, organisation, total, amount_paid, status, date, issue_date, created_at")
      .not("status", "in", "(Draft,Cancelled)");
    if (bounds) recentQuery = recentQuery.gte("date", bounds[0]).lt("date", bounds[1]);
    const [totalsRes, recentRes] = await Promise.all([
      supabase.rpc("dashboard_finance", { p_from: bounds?.[0] ?? null, p_to: bounds?.[1] ?? null }),
      recentQuery.order("date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(6),
    ]);
    if (!totalsRes.error && totalsRes.data) setFinance(totalsRes.data as FinanceTotals);
    if (!recentRes.error) setRecentInvoices(recentRes.data || []);
  }

  // Close drawer with Escape key
  useEffect(() => {
    if (!isOverdueDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOverdueDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOverdueDrawerOpen]);

  async function loadDashboardData(isInitial = false) {
    if (!me) {
      setLoading(false);
      return;
    }
    if (isInitial) setLoading(true);
    else setRefreshing(true);

    const horizon = addDaysISO(today, 13);

    try {
      const scoped = <Q extends { or: (filter: string) => Q }>(q: Q) => (isAdmin ? q : q.or(`assigned_to.eq.${me},reviewer_id.eq.${me}`));
      const approvedQuery = supabase.from("tasks").select("id", { count: "exact", head: true }).eq("stage", "Approved");

      const [taskRes, approvedRes, clientRes, teamRes, eventRes] = await Promise.all([
        fetchAll((from, to) =>
          scoped(supabase.from("tasks").select("*").neq("stage", "Approved"))
            .order("due_date", { ascending: true })
            .order("id")
            .range(from, to)
        ),
        isAdmin ? approvedQuery : approvedQuery.eq("assigned_to", me),
        fetchAll((from, to) => supabase.from("clients").select("id, name, organization_name").order("id").range(from, to)),
        supabase.from("profiles").select("id, name, role, designation, is_active, is_reviewer").order("name", { ascending: true }),
        supabase.from("compliance_events").select("id, title, category, due_date").gte("due_date", today).lte("due_date", horizon),
      ]);

      if (!taskRes.error) setTasks(taskRes.data);
      if (!approvedRes.error) setApprovedCount(approvedRes.count || 0);
      if (!clientRes.error) setClients(clientRes.data);
      if (teamRes.data) setTeam(teamRes.data);
      setComplianceEvents(eventRes.data || []);

      if (isAdmin) {
        const [, crmRes] = await Promise.all([loadFinance(dateFilterRef.current), supabase.rpc("dashboard_crm")]);
        if (!crmRes.error && crmRes.data) setCrm(crmRes.data as CrmTotals);
      } else {
        const { data: logs } = await supabase
          .from("time_logs")
          .select("hours")
          .eq("user_id", me)
          .gte("log_date", mondayOf(today))
          .lte("log_date", today);
        setWeekHours((logs || []).reduce((s: number, l: any) => s + Number(l.hours || 0), 0));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLastUpdated(new Date());
    }
  }

  const clientName = useMemo(() => {
    const map: Record<string, string> = {};
    clients.forEach((c) => (map[c.id] = clientLabel(c)));
    return (id?: string) => (id ? map[id] || "" : "");
  }, [clients]);

  const teamName = useMemo(() => {
    const map: Record<string, string> = {};
    team.forEach((t) => (map[t.id] = t.name));
    return (id?: string) => (id ? map[id] || "" : "");
  }, [team]);

  /* ---------------- Task calculations ---------------- */

  const myTasks = isAdmin ? tasks : tasks.filter((t) => t.assigned_to === me);
  const overdueTasks = myTasks.filter((t) => t.due_date && t.due_date < today);
  const changesRequired = myTasks.filter((t) => t.stage === "Changes Required");
  const reviewQueue = tasks.filter((t) => t.stage === "Submitted for Review" && (isAdmin || t.reviewer_id === me));
  const unassignedCount = tasks.filter((t) => !t.assigned_to).length;

  const weekAhead = addDaysISO(today, 7);
  const inNextWeek = (d?: string | null) => !!d && d.slice(0, 10) >= today && d.slice(0, 10) <= weekAhead;
  const dueThisWeek = myTasks
    .filter((t) => inNextWeek(t.due_date) || inNextWeek(t.official_due_date))
    .sort((a, b) => {
      const aMin = [a.due_date, a.official_due_date].filter(Boolean).sort()[0] || "9999";
      const bMin = [b.due_date, b.official_due_date].filter(Boolean).sort()[0] || "9999";
      return aMin.localeCompare(bMin);
    });

  const stageCounts = STAGES.map((stage) => ({
    stage,
    count: stage === "Approved" ? approvedCount : tasks.filter((t) => t.stage === stage).length,
  }));
  const totalTaskCount = Math.max(1, tasks.length + approvedCount);

  /* ---------------- Statutory deadline strip (next 14 days) ---------------- */

  const statutoryDays = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => addDaysISO(today, i));
    const openStatutory = tasks.filter((t) => t.official_due_date);
    return days.map((d) => {
      const taskItems = openStatutory
        .filter((t) => String(t.official_due_date).slice(0, 10) === d)
        .map((t) => ({ id: `t-${t.id}`, title: t.title, sub: clientName(t.client_id) || "Internal", kind: "task" as const, stage: t.stage }));
      const eventItems = complianceEvents
        .filter((e) => String(e.due_date).slice(0, 10) === d)
        .map((e) => ({ id: `e-${e.id}`, title: e.title, sub: e.category || "Compliance", kind: "event" as const, stage: "" }));
      return { date: d, items: [...taskItems, ...eventItems] };
    });
  }, [tasks, complianceEvents, today, clientName]);

  const breachedStatutory = tasks.filter((t) => t.official_due_date && t.official_due_date < today).length;
  const selectedDayItems = selectedDay ? statutoryDays.find((d) => d.date === selectedDay)?.items || [] : [];

  /* ---------------- Financial and CRM totals (admin, worked out in the database) ---------------- */

  const totalBilled = Number(finance?.billed || 0);
  const totalCollected = Number(finance?.collected || 0);
  // Payments received in the period compared with the amount billed in it. Clearing older dues can push this past 100%, so the bar is capped.
  const collectionRate = totalBilled > 0 ? Math.min(100, Math.round((totalCollected / totalBilled) * 100)) : 0;
  const totalOutstanding = Number(finance?.outstanding || 0);
  const agingBuckets = AGING_BUCKETS.map((b, i) => {
    const row = finance?.aging?.find((a) => a.bucket === i);
    return { ...b, count: Number(row?.count || 0), amount: Number(row?.amount || 0) };
  });
  const overdueReceivables = agingBuckets.slice(1).reduce((s, b) => s + b.amount, 0);

  const trend = (finance?.trend || []).map((m) => {
    const [y, mo] = m.month.split("-").map(Number);
    return {
      key: m.month,
      label: new Date(y, mo - 1, 1).toLocaleString("en-IN", { month: "short" }),
      billed: Number(m.billed || 0),
      collected: Number(m.collected || 0),
    };
  });
  const maxTrend = Math.max(1, ...trend.map((m) => Math.max(m.billed, m.collected)));
  const barHeight = (v: number) => (v > 0 ? Math.max(3, (v / maxTrend) * 100) : 0);

  const wonLeads = Number(crm?.won_leads || 0);
  const lostLeads = Number(crm?.lost_leads || 0);
  const winRate = wonLeads + lostLeads > 0 ? Math.round((wonLeads / (wonLeads + lostLeads)) * 100) : 0;
  const discussionFollowUps = Number(crm?.discussion_followups || 0);

  /* ---------------- Workload Map per Staff (admin) ---------------- */

  const staffWorkload = team
    .filter((member) => member.is_active !== false)
    .map((member) => {
      const memberTasks = tasks.filter((t) => t.assigned_to === member.id && t.stage !== "Approved");
      return {
        id: member.id,
        name: member.name || "Unnamed",
        role: member.role,
        designation: member.designation,
        isReviewer: member.role === "admin" || !!member.is_reviewer,
        activeCount: memberTasks.length,
        overdueCount: memberTasks.filter((t) => t.due_date && t.due_date < today).length,
        reviewCount: tasks.filter((t) => t.reviewer_id === member.id && t.stage === "Submitted for Review").length,
      };
    })
    .sort((a, b) => b.activeCount - a.activeCount);
  const maxLoad = Math.max(1, ...staffWorkload.map((s) => s.activeCount));

  if (loading) {
    return <DashboardSkeleton />;
  }

  /* ---------------- Shared: statutory strip ---------------- */

  const statutoryStrip = (
    <Panel
      title="Statutory deadlines · next 14 days"
      tour="dash-compliance"
      icon={CalendarDays}
      action={
        breachedStatutory > 0 ? (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">{breachedStatutory} already breached</span>
        ) : (
          <PanelLink href="/calendar" label="Calendar" />
        )
      }
    >
      <div className="grid grid-cols-7 gap-1.5 lg:grid-cols-14">
        {statutoryDays.map((d) => {
          const count = d.items.length;
          const isToday = d.date === today;
          const active = selectedDay === d.date;
          const date = new Date(d.date + "T00:00:00");
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => setSelectedDay(active ? null : d.date)}
              className={`flex flex-col items-center rounded-lg border px-1 py-2 text-center transition ${
                active
                  ? "border-navy bg-navy text-white"
                  : count > 0
                  ? "border-amber-300 bg-amber-50 hover:border-amber-400"
                  : "border-border hover:bg-surface-alt"
              }`}
            >
              <span className={`text-[9px] font-semibold uppercase ${active ? "text-white/80" : "text-text-muted"}`}>
                {date.toLocaleDateString("en-IN", { weekday: "short" })}
              </span>
              <span className={`text-sm font-semibold ${active ? "text-white" : isToday ? "text-navy" : "text-text-main"}`}>{date.getDate()}</span>
              <span
                className={`mt-0.5 min-w-[18px] rounded-full px-1 text-[9px] font-semibold ${
                  count === 0 ? (active ? "text-white/60" : "text-text-muted") : active ? "bg-white text-navy" : "bg-amber-500 text-white"
                }`}
              >
                {count || "·"}
              </span>
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-xs font-semibold text-text-main">
            {formatDate(selectedDay)} · {selectedDayItems.length} item{selectedDayItems.length === 1 ? "" : "s"}
          </p>
          {selectedDayItems.length === 0 ? (
            <p className="text-[11px] italic text-text-muted">No statutory deadlines on this day.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {selectedDayItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-navy">{item.title}</p>
                    <p className="truncate text-[10px] text-text-muted">{item.sub}</p>
                  </div>
                  {item.kind === "task" ? (
                    <StageBadge stage={item.stage} />
                  ) : (
                    <span className="rounded-full border border-border bg-surface-alt px-2 py-0.5 text-[10px] font-semibold text-text-muted">Calendar</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );

  return (
    <div className="space-y-6">
      <ImportantNotifications />
      {/* ================= HEADER ================= */}
      <div className="relative flex flex-col items-start justify-between gap-5 overflow-hidden rounded-2xl bg-navy p-5 text-white shadow-sm sm:p-7 xl:flex-row xl:items-end">
        <HeroDecor dark />
        <div className="relative min-w-0 xl:flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {greeting()}, {currentUser?.name?.split(" ")[0] || "there"}
            </h2>
            {isAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#ffb59f]">
                <ShieldCheck className="h-3 w-3" /> Admin
              </span>
            )}
            {!isAdmin && isReviewer && (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                <ShieldCheck className="h-3 w-3" /> Reviewer
              </span>
            )}
          </div>
          <p className="mt-2 hidden text-sm text-white/65 sm:block">
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            {" · "}
            {isAdmin
              ? "Firm dashboard: financials, pipeline, compliance and team capacity at a glance."
              : "Here is your active work schedule."}
          </p>
        </div>

        <div className="relative flex w-full flex-wrap items-center gap-2 xl:w-auto xl:shrink-0 xl:justify-end">
          <button
            type="button"
            onClick={() => loadDashboardData()}
            title={lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Refresh"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">
              {lastUpdated ? lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "Refresh"}
            </span>
          </button>

          {isAdmin && (
            <div className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-2 text-xs text-white">
              <Calendar className="h-3.5 w-3.5 text-white/60" />
              <select value={dateFilter} onChange={(e) => changeDateFilter(e.target.value)} className="bg-transparent text-xs font-medium focus:outline-none [&>option]:text-text-main">
                <option value="all">All time</option>
                <option value="month">This month</option>
                <option value="quarter">This quarter</option>
                <option value="fy">{fyLabel}</option>
              </select>
            </div>
          )}

          {isAdmin ? (
            <>
              <Link href="/quotations?new=1" className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10">
                <Plus className="h-3.5 w-3.5" /> Quote
              </Link>
              <Link href="/invoices?new=1" className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10">
                <Plus className="h-3.5 w-3.5" /> Invoice
              </Link>
              <Link href="/tasks?new=1" className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-95">
                <Plus className="h-3.5 w-3.5" /> Assign task
              </Link>
            </>
          ) : (
            <>
              <Link href="/time-tracking?new=1" className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10">
                <Timer className="h-3.5 w-3.5" /> Log time
              </Link>
              <Link href="/my-day" className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-95">
                My day <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </div>
      </div>

      <AnnouncementsPanel isAdmin={isAdmin} />
      {isAdmin && hasFeature(currentUser, "escalation_levels") && <EscalationList />}

      {isAdmin ? (
        /* ================= ADMIN EAGLE'S EYE VIEW ================= */
        <>
          {/* Primary KPIs */}
          <div data-tour="dash-kpis" className="kpi-grid grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <KpiCard
              label={`Billed · ${DATE_FILTER_LABELS[dateFilter]}`}
              value={compactINR(totalBilled)}
              icon={IndianRupee}
              tone="navy"
              href="/invoices"
              sub={`${finance?.billed_count || 0} issued invoice${finance?.billed_count === 1 ? "" : "s"}`}
            />
            <KpiCard
              label={`Collected · ${DATE_FILTER_LABELS[dateFilter]}`}
              value={compactINR(totalCollected)}
              icon={CheckCircle2}
              tone="emerald"
              href="/invoices"
              sub={
                <div className="space-y-1.5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${collectionRate}%` }} />
                  </div>
                  <span className="font-medium text-emerald-700">
                    {finance?.payments_count || 0} payment{finance?.payments_count === 1 ? "" : "s"} received · {collectionRate}% of the amount billed in this period
                  </span>
                </div>
              }
            />
            <KpiCard
              label="Receivables (balance due)"
              value={compactINR(totalOutstanding)}
              icon={Wallet}
              tone="amber"
              href="/invoices"
              sub={
                <span>
                  {finance?.outstanding_count || 0} invoices
                  {overdueReceivables > 0 && <span className="font-semibold text-rose-600"> · {compactINR(overdueReceivables)} overdue</span>}
                </span>
              }
            />
            <KpiCard
              label="Firm overdue work"
              value={overdueTasks.length}
              icon={AlertCircle}
              tone="rose"
              onClick={() => setIsOverdueDrawerOpen(true)}
              sub={<span className="font-semibold text-rose-600">Click to inspect overdue files →</span>}
            />
          </div>

          {/* Secondary KPIs */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <KpiCard
              label="Open leads"
              value={crm?.open_leads || 0}
              icon={UserPlus}
              tone="blue"
              href="/leads"
              sub={
                <span>
                  {crm?.lead_followups_due ? <span className="font-semibold text-amber-700">{crm.lead_followups_due} follow-up{crm.lead_followups_due === 1 ? "" : "s"} due</span> : "No follow-ups due"}
                  {" · "}
                  {winRate}% win rate
                </span>
              }
            />
            <KpiCard
              label="Quotation pipeline"
              value={compactINR(Number(crm?.pipeline_value || 0))}
              icon={FileText}
              tone="violet"
              href="/quotations"
              sub={`${crm?.open_quotes || 0} live quote${crm?.open_quotes === 1 ? "" : "s"} awaiting decision`}
            />
            <KpiCard
              label="Active clients"
              value={crm?.active_clients || 0}
              icon={Users}
              tone="navy"
              href="/clients"
              sub={`${crm?.client_master || 0} in client master`}
            />
            <KpiCard
              label="Client follow-ups"
              value={discussionFollowUps}
              icon={MessageSquare}
              tone={discussionFollowUps > 0 ? "amber" : "emerald"}
              href="/client-discussions"
              sub={discussionFollowUps > 0 ? "Due today or overdue" : "All discussion follow-ups clear"}
            />
          </div>

          {statutoryStrip}

          {/* Billing trend + Receivables aging */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Panel
              title="Billing vs collections (last 6 months)"
              icon={TrendingUp}
              className="lg:col-span-2"
              action={
                <div className="flex items-center gap-3 text-[11px] text-text-muted">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-navy" /> Billed</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Collected</span>
                </div>
              }
            >
              {!finance?.has_activity ? (
                <EmptyState icon={TrendingUp} text="No issued invoices yet. The trend appears once invoices are issued." />
              ) : (
                <div className="flex h-52 items-end gap-2 sm:gap-4">
                  {trend.map((m) => (
                    <div key={m.key} className="flex h-full flex-1 flex-col items-center gap-2">
                      <span className="text-[10px] font-semibold text-text-main">{m.billed > 0 ? compactINR(m.billed) : ""}</span>
                      <div className="flex w-full flex-1 items-end justify-center gap-1 border-b border-border">
                        <div className="w-1/3 max-w-[22px] rounded-t bg-navy transition-all" style={{ height: `${barHeight(m.billed)}%` }} title={`Billed: ${formatINR(m.billed)}`} />
                        <div
                          className="w-1/3 max-w-[22px] rounded-t bg-emerald-500 transition-all"
                          style={{ height: `${barHeight(m.collected)}%` }}
                          title={`Collected: ${formatINR(m.collected)}`}
                        />
                      </div>
                      <span className="text-[11px] font-medium text-text-muted">{m.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Receivables aging" icon={Receipt} action={<PanelLink href="/invoices" label="Invoices" />}>
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Total balance due</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-amber-700">{formatINR(totalOutstanding)}</p>
                <p className="text-[11px] text-text-muted">Across {finance?.outstanding_count || 0} issued invoices</p>
              </div>
              <div className="space-y-3">
                {agingBuckets.map((b) => (
                  <div key={b.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-text-main">{b.label}</span>
                      <span className="text-text-muted">
                        <span className="font-semibold text-text-main">{formatINR(b.amount)}</span> · {b.count}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
                      <div className={`h-full rounded-full ${b.bar}`} style={{ width: `${totalOutstanding > 0 ? (b.amount / totalOutstanding) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* Upcoming deadlines + Stage pipeline */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Panel title={`Deadlines in the Next 7 Days (${dueThisWeek.length})`} icon={Clock} className="lg:col-span-2" flush action={<PanelLink href="/tasks" label="Manage tasks" />}>
              {dueThisWeek.length === 0 ? (
                <EmptyState icon={CheckCircle2} text="No internal or statutory deadlines in the next 7 days." />
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Client</th>
                      <th>Internal due</th>
                      <th>Statutory due</th>
                      <th>Assigned to</th>
                      <th>Stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dueThisWeek.slice(0, 8).map((t) => (
                      <tr key={t.id} className="transition hover:bg-surface-alt">
                        <td className="max-w-[220px] truncate font-semibold text-navy">{t.title}</td>
                        <td className="max-w-[160px] truncate">{clientName(t.client_id) || t.organisation || "Internal"}</td>
                        <td><DueDate date={t.due_date} today={today} /></td>
                        <td><DueDate date={t.official_due_date} today={today} /></td>
                        <td>{teamName(t.assigned_to) || <span className="font-semibold text-rose-500">Unassigned</span>}</td>
                        <td><StageBadge stage={t.stage} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Task pipeline" icon={Briefcase} action={<PanelLink href="/reviewer-queue" label="Review queue" />}>
              <div className="space-y-3">
                {stageCounts.map((s) => (
                  <div key={s.stage} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-text-main">{s.stage}</span>
                      <span className="font-semibold text-text-main">{s.count}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
                      <div className={`h-full rounded-full ${STAGE_BARS[s.stage]}`} style={{ width: `${(s.count / totalTaskCount) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-4 text-xs">
                <div className="rounded-lg bg-violet-50 p-2.5">
                  <p className="text-[10px] font-semibold uppercase text-violet-700">Awaiting review</p>
                  <p className="text-lg font-semibold text-violet-700">{reviewQueue.length}</p>
                </div>
                <div className={`rounded-lg p-2.5 ${unassignedCount > 0 ? "bg-rose-50" : "bg-emerald-50"}`}>
                  <p className={`text-[10px] font-semibold uppercase ${unassignedCount > 0 ? "text-rose-600" : "text-emerald-700"}`}>Unassigned</p>
                  <p className={`text-lg font-semibold ${unassignedCount > 0 ? "text-rose-600" : "text-emerald-700"}`}>{unassignedCount}</p>
                </div>
              </div>
            </Panel>
          </div>

          {/* Workload Capacity Monitor */}
          <Panel title="Staff workload & capacity distribution" icon={Users} action={<PanelLink href="/team" label="Team" />}>
            {staffWorkload.length === 0 ? (
              <EmptyState icon={Users} text="No active team members found." />
            ) : (
              <div data-tour="dash-capacity" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {staffWorkload.map((staff) => (
                  <div key={staff.id} className="space-y-2 rounded-lg border border-border bg-surface-alt p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-[11px] font-semibold text-white">
                        {staff.name.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-navy">{staff.name}</p>
                        <p className="truncate text-[10px] uppercase tracking-wide text-text-muted">
                          {staff.designation || staff.role}
                          {staff.isReviewer && " · Reviewer"}
                        </p>
                      </div>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div className={`h-full rounded-full ${staff.overdueCount > 0 ? "bg-rose-500" : "bg-navy"}`} style={{ width: `${(staff.activeCount / maxLoad) * 100}%` }} />
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-center">
                      <div>
                        <p className="font-semibold text-text-main">{staff.activeCount}</p>
                        <p className="text-[10px] text-text-muted">Active</p>
                      </div>
                      <div>
                        <p className={`font-semibold ${staff.overdueCount > 0 ? "text-rose-600" : "text-emerald-600"}`}>{staff.overdueCount}</p>
                        <p className="text-[10px] text-text-muted">Overdue</p>
                      </div>
                      <div>
                        <p className="font-semibold text-violet-700">{staff.reviewCount}</p>
                        <p className="text-[10px] text-text-muted">To review</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Task stream + Invoice feed */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Panel title="Firm-wide task stream" tour="dash-stream" icon={CheckSquare} className="lg:col-span-2" flush action={<PanelLink href="/tasks" label="Manage tasks" />}>
              {myTasks.length === 0 ? (
                <EmptyState icon={CheckSquare} text="No active tasks in the firm workflow." />
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th>Due</th>
                      <th>Task</th>
                      <th>Client</th>
                      <th>Assigned to</th>
                      <th>Stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myTasks.slice(0, 8).map((t) => (
                      <tr key={t.id} className="transition hover:bg-surface-alt">
                        <td><DueDate date={t.due_date} today={today} /></td>
                        <td className="max-w-[240px] truncate font-semibold text-navy">{t.title}</td>
                        <td className="max-w-[160px] truncate">{clientName(t.client_id) || "Internal"}</td>
                        <td>{teamName(t.assigned_to) || <span className="font-semibold text-rose-500">Unassigned</span>}</td>
                        <td><StageBadge stage={t.stage} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Recent invoices" icon={Receipt} action={<PanelLink href="/invoices" label="View all" />}>
              {recentInvoices.length === 0 ? (
                <EmptyState icon={Receipt} text="No issued invoices in this period." />
              ) : (
                <div className="space-y-2">
                  {recentInvoices.map((inv) => {
                      const balance = invoiceBalance(inv);
                      return (
                        <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-alt p-2.5">
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-semibold text-navy">{inv.invoice_number || "Draft"}</p>
                            <p className="truncate text-[11px] text-text-muted">
                              {clientName(inv.client_id) || inv.organisation || "Client"} · {formatDate(invoiceDate(inv))}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-xs font-semibold text-text-main">{formatINR(Number(inv.total || 0))}</p>
                            <span
                              className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                                inv.status === "Paid"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : inv.status === "Partially Paid"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-blue-100 text-blue-700"
                              }`}
                            >
                              {inv.status === "Paid" ? "Paid" : `${formatINR(balance)} due`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </Panel>
          </div>
        </>
      ) : (
        /* ================= STAFF PERSONAL DASHBOARD VIEW ================= */
        <>
          {isReviewer && reviewQueue.length > 0 && (
            <Link
              href="/reviewer-queue"
              className="flex items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm transition hover:border-violet-300"
            >
              <span className="flex items-center gap-2 font-semibold text-violet-800">
                <ShieldCheck className="h-4 w-4" />
                {reviewQueue.length} task{reviewQueue.length === 1 ? " is" : "s are"} waiting for your review
              </span>
              <span className="flex items-center gap-1 text-xs font-semibold text-violet-700">
                Open Review Queue <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          )}

          <div data-tour="dash-kpis" className="kpi-grid grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="My pending tasks" value={myTasks.length} icon={CheckSquare} tone="navy" href="/tasks" />
            <KpiCard
              label="Overdue deadlines"
              value={overdueTasks.length}
              icon={AlertCircle}
              tone="rose"
              onClick={() => setIsOverdueDrawerOpen(true)}
              sub={overdueTasks.length > 0 ? <span className="font-semibold text-rose-600">Click to view →</span> : "You're on schedule"}
            />
            <KpiCard
              label={isReviewer ? "Awaiting my review" : "In review"}
              value={isReviewer ? reviewQueue.length : myTasks.filter((t) => t.stage === "Submitted for Review").length}
              icon={ShieldCheck}
              tone="violet"
              href={isReviewer ? "/reviewer-queue" : undefined}
              sub={`${approvedCount} completed in total`}
            />
            <KpiCard label="Logged this week" value={formatHours(weekHours)} icon={Timer} tone="emerald" href="/time-tracking" sub="Monday to today" />
          </div>

          {statutoryStrip}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Panel title={`Due This Week (${dueThisWeek.length})`} icon={Clock}>
              {dueThisWeek.length === 0 ? (
                <EmptyState icon={CheckCircle2} text="Nothing due in the next 7 days." />
              ) : (
                <div className="space-y-2">
                  {dueThisWeek.slice(0, 6).map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-alt p-2.5 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-navy">{t.title}</p>
                        <p className="truncate text-[11px] text-text-muted">{clientName(t.client_id) || "Internal"}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <DueDate date={t.due_date} today={today} />
                        {t.official_due_date && <p className="text-[10px] text-text-muted">Statutory: {formatDate(t.official_due_date)}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={`Changes Required (${changesRequired.length})`} icon={AlertCircle}>
              {changesRequired.length === 0 ? (
                <EmptyState icon={CheckCircle2} text="No tasks have been sent back for changes." />
              ) : (
                <div className="space-y-2">
                  {changesRequired.slice(0, 6).map((t) => (
                    <div key={t.id} className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-semibold text-navy">{t.title}</p>
                        <DueDate date={t.due_date} today={today} />
                      </div>
                      {t.review_comments && (
                        <p className="line-clamp-2 text-[11px] text-amber-800">
                          <MessageSquare className="mr-1 inline h-3 w-3" />
                          {t.review_comments}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Panel title="My assigned tasks" tour="dash-stream" icon={CheckSquare} flush action={<PanelLink href="/tasks" label="Open task board" />}>
            {myTasks.length === 0 ? (
              <EmptyState icon={CheckCircle2} text="No open tasks assigned to you." />
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th>Due date</th>
                    <th>Statutory due</th>
                    <th>Task</th>
                    <th>Category</th>
                    <th>Client</th>
                    <th>Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {myTasks.map((t) => (
                    <tr key={t.id} className="transition hover:bg-surface-alt">
                      <td><DueDate date={t.due_date} today={today} /></td>
                      <td><DueDate date={t.official_due_date} today={today} /></td>
                      <td className="max-w-[240px] truncate font-semibold text-navy">{t.title}</td>
                      <td>{t.category || "—"}</td>
                      <td className="max-w-[160px] truncate">{clientName(t.client_id) || "Internal"}</td>
                      <td><StageBadge stage={t.stage} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}

      {/* ================= Actionable Overdue Task Drawer ================= */}
      {isOverdueDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[1px] animate-fade-in" onClick={() => setIsOverdueDrawerOpen(false)}>
          <div className="flex h-full w-full max-w-md flex-col bg-surface text-xs shadow-2xl animate-slide-in-right" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-rose-600">
                <AlertCircle className="h-4 w-4" />
                {isAdmin ? "Firm overdue compliance items" : "My overdue tasks"} ({overdueTasks.length})
              </h3>
              <button
                type="button"
                onClick={() => setIsOverdueDrawerOpen(false)}
                className="rounded-md p-1 text-text-muted transition hover:bg-surface-alt hover:text-text-main"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {overdueTasks.length === 0 ? (
                <EmptyState icon={CheckCircle2} text="No overdue items." />
              ) : (
                <div className="space-y-2">
                  {overdueTasks.map((t) => {
                    const daysLate = daysBetween(t.due_date, today);
                    const statutoryBreached = t.official_due_date && t.official_due_date < today;
                    const isOpen = selectedOverdueTask?.id === t.id;
                    return (
                      <div
                        key={t.id}
                        className={`rounded-lg border p-3 transition ${isOpen ? "border-rose-300 bg-rose-50/50" : "border-border bg-surface-alt hover:border-rose-200"}`}
                      >
                        <button type="button" onClick={() => setSelectedOverdueTask(isOpen ? null : t)} className="w-full space-y-1 text-left">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-navy">{t.title}</span>
                            <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">{daysLate}d late</span>
                          </div>
                          <p className="text-[11px] text-text-muted">Client: {clientName(t.client_id) || "Internal"}</p>
                          <p className="text-[11px] text-text-muted">Assigned staff: {teamName(t.assigned_to) || "Unassigned"}</p>
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <span className="text-[11px] text-text-muted">
                              Internal: <span className="font-semibold text-rose-600">{formatDate(t.due_date)}</span>
                            </span>
                            {t.official_due_date && (
                              <span className="text-[11px] text-text-muted">
                                Statutory:{" "}
                                <span className={`font-semibold ${statutoryBreached ? "text-rose-600" : "text-text-main"}`}>{formatDate(t.official_due_date)}</span>
                              </span>
                            )}
                            {statutoryBreached && (
                              <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">Statutory breached</span>
                            )}
                          </div>
                        </button>

                        {isOpen && (
                          <div className="mt-3 space-y-2 border-t border-rose-200 pt-3">
                            <div className="flex flex-wrap gap-2">
                              <StageBadge stage={t.stage} />
                              {t.priority && (
                                <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold text-text-main">{t.priority} priority</span>
                              )}
                              {t.category && (
                                <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold text-text-main">{t.category}</span>
                              )}
                            </div>
                            {t.notes && <p className="text-[11px] text-text-main">{t.notes}</p>}
                            {t.review_comments && (
                              <p className="rounded bg-amber-50 p-2 text-[11px] text-amber-800">
                                <MessageSquare className="mr-1 inline h-3 w-3" />
                                {t.review_comments}
                              </p>
                            )}
                          </div>
                        )}

                        <div className="flex justify-end pt-2">
                          <Link href="/tasks" className="text-[11px] font-semibold text-navy underline">
                            Open Task Board →
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}