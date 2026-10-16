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
import { useCurrentUser } from "@/components/layout/UserContext";
import { compactINR, formatDate, formatINR, localISODate } from "@/lib/format";
import ImportantNotifications from "@/components/notifications/ImportantNotifications";
import AnnouncementsPanel from "@/components/notifications/AnnouncementsPanel";
import { clientLabel } from "@/components/ui/ClientPicker";
import Link from "next/link";

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

const CLOSED_LEAD_STATUSES = ["won", "lost", "converted", "closed"];
const OPEN_QUOTE_STATUSES = ["draft", "sent"];
const ISSUED_EXCLUDED = ["Draft", "Cancelled"];

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

function inPeriod(date: string, bounds: [string, string] | null): boolean {
  if (!bounds) return true;
  return !!date && date >= bounds[0] && date < bounds[1];
}

function invoiceDate(inv: any): string {
  return isoOf(inv.date || inv.issue_date || inv.created_at);
}

function invoiceBalance(inv: any): number {
  if (ISSUED_EXCLUDED.includes(inv.status || "Draft")) return 0;
  return Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid ?? inv.amountPaid ?? 0));
}

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
          <p className={`mt-1.5 truncate text-2xl font-bold tracking-tight ${t.value}`}>{value}</p>
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
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`flex flex-col rounded-xl border border-border bg-surface shadow-sm ${className}`}>
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
    <div className="space-y-6 animate-pulse">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <div className="h-5 w-56 rounded bg-border" />
        <div className="mt-2 h-3 w-80 rounded bg-border/70" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

  const [tasks, setTasks] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [discussions, setDiscussions] = useState<any[]>([]);
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
      // Shared data for everyone
      let taskQuery = supabase.from("tasks").select("*").order("due_date", { ascending: true });
      if (!isAdmin) taskQuery = taskQuery.or(`assigned_to.eq.${me},reviewer_id.eq.${me}`);

      const [taskRes, clientRes, teamRes, eventRes] = await Promise.all([
        taskQuery,
        supabase.from("clients").select("id, name, organization_name, status"),
        supabase.from("profiles").select("id, name, role, designation, is_active, is_reviewer").order("name", { ascending: true }),
        supabase.from("compliance_events").select("id, title, category, due_date").gte("due_date", today).lte("due_date", horizon),
      ]);

      if (taskRes.data) setTasks(taskRes.data);
      if (clientRes.data) setClients(clientRes.data);
      if (teamRes.data) setTeam(teamRes.data);
      setComplianceEvents(eventRes.data || []);

      if (isAdmin) {
        const [iRes, pRes, qRes, lRes, dRes] = await Promise.all([
          supabase
            .from("invoices")
            .select("id, invoice_number, client_id, organisation, total, amount_paid, status, date, issue_date, due_date, created_at")
            .order("created_at", { ascending: false }),
          supabase.from("invoice_payments").select("invoice_id, amount, paid_on"),
          supabase.from("quotations").select("*"),
          supabase.from("leads").select("*"),
          supabase.from("discussions").select("id, client_id, summary, date, follow_up_date, follow_up_completed"),
        ]);

        if (iRes.data) setInvoices(iRes.data);
        if (pRes.data) setPayments(pRes.data);
        if (qRes.data) setQuotations(qRes.data);
        if (lRes.data) setLeads(lRes.data);
        if (dRes.data) setDiscussions(dRes.data);
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
  const pendingTasks = myTasks.filter((t) => t.stage !== "Approved");
  const overdueTasks = pendingTasks.filter((t) => t.due_date && t.due_date < today);
  const completedTasks = myTasks.filter((t) => t.stage === "Approved");
  const changesRequired = pendingTasks.filter((t) => t.stage === "Changes Required");
  const reviewQueue = tasks.filter((t) => t.stage === "Submitted for Review" && (isAdmin || t.reviewer_id === me));
  const unassignedCount = tasks.filter((t) => t.stage !== "Approved" && !t.assigned_to).length;

  const weekAhead = addDaysISO(today, 7);
  const inNextWeek = (d?: string | null) => !!d && d.slice(0, 10) >= today && d.slice(0, 10) <= weekAhead;
  const dueThisWeek = pendingTasks
    .filter((t) => inNextWeek(t.due_date) || inNextWeek(t.official_due_date))
    .sort((a, b) => {
      const aMin = [a.due_date, a.official_due_date].filter(Boolean).sort()[0] || "9999";
      const bMin = [b.due_date, b.official_due_date].filter(Boolean).sort()[0] || "9999";
      return aMin.localeCompare(bMin);
    });

  const stageCounts = STAGES.map((stage) => ({
    stage,
    count: tasks.filter((t) => t.stage === stage).length,
  }));
  const totalTaskCount = Math.max(1, tasks.length);

  /* ---------------- Statutory deadline strip (next 14 days) ---------------- */

  const statutoryDays = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => addDaysISO(today, i));
    const openStatutory = tasks.filter((t) => t.stage !== "Approved" && t.official_due_date);
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

  const breachedStatutory = tasks.filter((t) => t.stage !== "Approved" && t.official_due_date && t.official_due_date < today).length;
  const selectedDayItems = selectedDay ? statutoryDays.find((d) => d.date === selectedDay)?.items || [] : [];

  /* ---------------- Financial calculations (admin) ---------------- */

  const bounds = periodBounds(dateFilter, today);
  const issuedInvoices = invoices.filter((i) => !ISSUED_EXCLUDED.includes(i.status || "Draft"));
  const periodInvoices = issuedInvoices.filter((i) => inPeriod(invoiceDate(i), bounds));
  const totalBilled = periodInvoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const periodPayments = payments.filter((p) => inPeriod(isoOf(p.paid_on), bounds));
  const totalCollected = periodPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const collectionRate = totalBilled > 0 ? Math.min(100, Math.round((totalCollected / totalBilled) * 100)) : 0;

  const outstandingInvoices = issuedInvoices.filter((i) => invoiceBalance(i) > 0.009);
  const totalOutstanding = outstandingInvoices.reduce((s, i) => s + invoiceBalance(i), 0);

  // Receivables aging by days past due (falls back to invoice date when no due date)
  const agingBuckets = [
    { label: "Not yet due", test: (d: number) => d <= 0, bar: "bg-blue-500" },
    { label: "1–30 days overdue", test: (d: number) => d >= 1 && d <= 30, bar: "bg-amber-400" },
    { label: "31–60 days overdue", test: (d: number) => d >= 31 && d <= 60, bar: "bg-orange-500" },
    { label: "61–90 days overdue", test: (d: number) => d >= 61 && d <= 90, bar: "bg-rose-500" },
    { label: "90+ days overdue", test: (d: number) => d > 90, bar: "bg-rose-700" },
  ].map((b) => {
    const items = outstandingInvoices.filter((i) => {
      const ref = isoOf(i.due_date) || invoiceDate(i);
      return b.test(ref ? daysBetween(ref, today) : 0);
    });
    return { ...b, count: items.length, amount: items.reduce((s, i) => s + invoiceBalance(i), 0) };
  });
  const overdueReceivables = agingBuckets.slice(1).reduce((s, b) => s + b.amount, 0);

  // 6-month trend: billed (issued invoices) vs collected (payments received)
  const [ty, tm] = today.split("-").map(Number);
  const trend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(ty, tm - 1 - 5 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return {
      key,
      label: d.toLocaleString("en-IN", { month: "short" }),
      billed: issuedInvoices.filter((inv) => invoiceDate(inv).slice(0, 7) === key).reduce((s, inv) => s + Number(inv.total || 0), 0),
      collected: payments.filter((p) => isoOf(p.paid_on).slice(0, 7) === key).reduce((s, p) => s + Number(p.amount || 0), 0),
    };
  });
  const maxTrend = Math.max(1, ...trend.map((m) => Math.max(m.billed, m.collected)));
  const barHeight = (v: number) => (v > 0 ? Math.max(3, (v / maxTrend) * 100) : 0);

  /* ---------------- CRM calculations (admin) ---------------- */

  const activeClients = clients.filter((c) => !c.status || String(c.status).toLowerCase() === "active");
  const openLeads = leads.filter((l) => !CLOSED_LEAD_STATUSES.includes(String(l.status || "").toLowerCase()));
  const leadFollowUpsDue = openLeads.filter((l) => {
    const f = isoOf(l.follow_up_date || l.followUpDate);
    return f && f <= today;
  });
  const wonLeads = leads.filter((l) => String(l.status || "").toLowerCase() === "won" || l.converted_client_id).length;
  const lostLeads = leads.filter((l) => String(l.status || "").toLowerCase() === "lost").length;
  const winRate = wonLeads + lostLeads > 0 ? Math.round((wonLeads / (wonLeads + lostLeads)) * 100) : 0;

  const openQuotes = quotations.filter((q) => {
    const s = String(q.status || "Draft").toLowerCase();
    const validUntil = isoOf(q.valid_until || q.validUntil);
    return OPEN_QUOTE_STATUSES.includes(s) && (!validUntil || validUntil >= today);
  });
  const pipelineValue = openQuotes.reduce((s, q) => s + Number(q.total || 0), 0);

  const discussionFollowUps = discussions.filter((d) => {
    const f = isoOf(d.follow_up_date);
    return f && f <= today && !d.follow_up_completed;
  });

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
      title="Statutory Deadlines · Next 14 Days"
      icon={CalendarDays}
      action={
        breachedStatutory > 0 ? (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">{breachedStatutory} already breached</span>
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
              <span className={`text-sm font-bold ${active ? "text-white" : isToday ? "text-navy" : "text-text-main"}`}>{date.getDate()}</span>
              <span
                className={`mt-0.5 min-w-[18px] rounded-full px-1 text-[9px] font-bold ${
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
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm lg:flex-row lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-text-main">
              {greeting()}, {currentUser?.name?.split(" ")[0] || "there"}
            </h2>
            {isAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                <ShieldCheck className="h-3 w-3" /> Admin
              </span>
            )}
            {!isAdmin && isReviewer && (
              <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                <ShieldCheck className="h-3 w-3" /> Reviewer
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            {" · "}
            {isAdmin
              ? "Finetax Dashboard: financials, pipeline, compliance and team capacity at a glance."
              : "Here is your active work schedule."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => loadDashboardData()}
            title={lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Refresh"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs font-medium text-text-muted transition hover:bg-surface-alt hover:text-text-main"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">
              {lastUpdated ? lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "Refresh"}
            </span>
          </button>

          {isAdmin && (
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs">
              <Calendar className="h-3.5 w-3.5 text-text-muted" />
              <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="bg-transparent text-xs font-medium focus:outline-none">
                <option value="all">All Time</option>
                <option value="month">This Month</option>
                <option value="quarter">This Quarter</option>
                <option value="fy">{fyLabel}</option>
              </select>
            </div>
          )}

          {isAdmin ? (
            <>
              <Link href="/quotations" className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-main shadow-sm transition hover:bg-surface-alt">
                <Plus className="h-3.5 w-3.5" /> Quote
              </Link>
              <Link href="/invoices" className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-main shadow-sm transition hover:bg-surface-alt">
                <Plus className="h-3.5 w-3.5" /> Invoice
              </Link>
              <Link href="/tasks" className="inline-flex items-center gap-1 rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light">
                <Plus className="h-3.5 w-3.5" /> Assign Task
              </Link>
            </>
          ) : (
            <>
              <Link href="/time-tracking" className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-main shadow-sm transition hover:bg-surface-alt">
                <Timer className="h-3.5 w-3.5" /> Log Time
              </Link>
              <Link href="/tasks" className="inline-flex items-center gap-1 rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light">
                My Tasks <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </div>
      </div>

      <AnnouncementsPanel isAdmin={isAdmin} />

      {isAdmin ? (
        /* ================= ADMIN EAGLE'S EYE VIEW ================= */
        <>
          {/* Primary KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label={`Billed · ${DATE_FILTER_LABELS[dateFilter]}`}
              value={compactINR(totalBilled)}
              icon={IndianRupee}
              tone="navy"
              href="/invoices"
              sub={`${periodInvoices.length} issued invoice${periodInvoices.length === 1 ? "" : "s"}`}
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
                    {periodPayments.length} payment{periodPayments.length === 1 ? "" : "s"} received · {collectionRate}% of billed
                  </span>
                </div>
              }
            />
            <KpiCard
              label="Receivables (Balance Due)"
              value={compactINR(totalOutstanding)}
              icon={Wallet}
              tone="amber"
              href="/invoices"
              sub={
                <span>
                  {outstandingInvoices.length} invoices
                  {overdueReceivables > 0 && <span className="font-semibold text-rose-600"> · {compactINR(overdueReceivables)} overdue</span>}
                </span>
              }
            />
            <KpiCard
              label="Firm Overdue Work"
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
              label="Open Leads"
              value={openLeads.length}
              icon={UserPlus}
              tone="blue"
              href="/leads"
              sub={
                <span>
                  {leadFollowUpsDue.length > 0 ? <span className="font-semibold text-amber-700">{leadFollowUpsDue.length} follow-ups due</span> : "No follow-ups due"}
                  {" · "}
                  {winRate}% win rate
                </span>
              }
            />
            <KpiCard
              label="Quotation Pipeline"
              value={compactINR(pipelineValue)}
              icon={FileText}
              tone="violet"
              href="/quotations"
              sub={`${openQuotes.length} live quote${openQuotes.length === 1 ? "" : "s"} awaiting decision`}
            />
            <KpiCard
              label="Active Clients"
              value={activeClients.length}
              icon={Users}
              tone="navy"
              href="/clients"
              sub={`${clients.filter((c) => c.status !== "Merged").length} in client master`}
            />
            <KpiCard
              label="Client Follow-ups"
              value={discussionFollowUps.length}
              icon={MessageSquare}
              tone={discussionFollowUps.length > 0 ? "amber" : "emerald"}
              href="/client-discussions"
              sub={discussionFollowUps.length > 0 ? "Due today or overdue" : "All discussion follow-ups clear"}
            />
          </div>

          {statutoryStrip}

          {/* Billing trend + Receivables aging */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Panel
              title="Billing vs Collections (Last 6 Months)"
              icon={TrendingUp}
              className="lg:col-span-2"
              action={
                <div className="flex items-center gap-3 text-[11px] text-text-muted">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-navy" /> Billed</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Collected</span>
                </div>
              }
            >
              {issuedInvoices.length === 0 && payments.length === 0 ? (
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

            <Panel title="Receivables Aging" icon={Receipt} action={<PanelLink href="/invoices" label="Invoices" />}>
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Total Balance Due</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-amber-700">{formatINR(totalOutstanding)}</p>
                <p className="text-[11px] text-text-muted">Across {outstandingInvoices.length} issued invoices</p>
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
            <Panel title={`Deadlines in the Next 7 Days (${dueThisWeek.length})`} icon={Clock} className="lg:col-span-2" flush action={<PanelLink href="/tasks" label="Manage Tasks" />}>
              {dueThisWeek.length === 0 ? (
                <EmptyState icon={CheckCircle2} text="No internal or statutory deadlines in the next 7 days." />
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Client</th>
                      <th>Internal Due</th>
                      <th>Statutory Due</th>
                      <th>Assigned To</th>
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

            <Panel title="Task Pipeline" icon={Briefcase} action={<PanelLink href="/reviewer-queue" label="Review Queue" />}>
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
                  <p className="text-[10px] font-semibold uppercase text-violet-700">Awaiting Review</p>
                  <p className="text-lg font-bold text-violet-700">{reviewQueue.length}</p>
                </div>
                <div className={`rounded-lg p-2.5 ${unassignedCount > 0 ? "bg-rose-50" : "bg-emerald-50"}`}>
                  <p className={`text-[10px] font-semibold uppercase ${unassignedCount > 0 ? "text-rose-600" : "text-emerald-700"}`}>Unassigned</p>
                  <p className={`text-lg font-bold ${unassignedCount > 0 ? "text-rose-600" : "text-emerald-700"}`}>{unassignedCount}</p>
                </div>
              </div>
            </Panel>
          </div>

          {/* Workload Capacity Monitor */}
          <Panel title="Staff Workload & Capacity Distribution" icon={Users} action={<PanelLink href="/team" label="Team" />}>
            {staffWorkload.length === 0 ? (
              <EmptyState icon={Users} text="No active team members found." />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {staffWorkload.map((staff) => (
                  <div key={staff.id} className="space-y-2 rounded-lg border border-border bg-surface-alt p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-[11px] font-bold text-white">
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
                        <p className="font-bold text-text-main">{staff.activeCount}</p>
                        <p className="text-[10px] text-text-muted">Active</p>
                      </div>
                      <div>
                        <p className={`font-bold ${staff.overdueCount > 0 ? "text-rose-600" : "text-emerald-600"}`}>{staff.overdueCount}</p>
                        <p className="text-[10px] text-text-muted">Overdue</p>
                      </div>
                      <div>
                        <p className="font-bold text-violet-700">{staff.reviewCount}</p>
                        <p className="text-[10px] text-text-muted">To Review</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Task stream + Invoice feed */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Panel title="Finetax-Wide Task Stream" icon={CheckSquare} className="lg:col-span-2" flush action={<PanelLink href="/tasks" label="Manage Tasks" />}>
              {pendingTasks.length === 0 ? (
                <EmptyState icon={CheckSquare} text="No active tasks in the firm workflow." />
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th>Due</th>
                      <th>Task</th>
                      <th>Client</th>
                      <th>Assigned To</th>
                      <th>Stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingTasks.slice(0, 8).map((t) => (
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

            <Panel title="Recent Invoices" icon={Receipt} action={<PanelLink href="/invoices" label="View All" />}>
              {periodInvoices.length === 0 ? (
                <EmptyState icon={Receipt} text="No issued invoices in this period." />
              ) : (
                <div className="space-y-2">
                  {[...periodInvoices]
                    .sort((a, b) => invoiceDate(b).localeCompare(invoiceDate(a)))
                    .slice(0, 6)
                    .map((inv) => {
                      const balance = invoiceBalance(inv);
                      return (
                        <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-alt p-2.5">
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-semibold text-navy">{inv.invoice_number}</p>
                            <p className="truncate text-[11px] text-text-muted">
                              {clientName(inv.client_id) || inv.organisation || "Client"} · {formatDate(invoiceDate(inv))}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-xs font-bold text-text-main">{formatINR(Number(inv.total || 0))}</p>
                            <span
                              className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
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

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="My Pending Tasks" value={pendingTasks.length} icon={CheckSquare} tone="navy" href="/tasks" />
            <KpiCard
              label="Overdue Deadlines"
              value={overdueTasks.length}
              icon={AlertCircle}
              tone="rose"
              onClick={() => setIsOverdueDrawerOpen(true)}
              sub={overdueTasks.length > 0 ? <span className="font-semibold text-rose-600">Click to view →</span> : "You're on schedule"}
            />
            <KpiCard
              label={isReviewer ? "Awaiting My Review" : "In Review"}
              value={isReviewer ? reviewQueue.length : myTasks.filter((t) => t.stage === "Submitted for Review").length}
              icon={ShieldCheck}
              tone="violet"
              href={isReviewer ? "/reviewer-queue" : undefined}
              sub={`${completedTasks.length} completed in total`}
            />
            <KpiCard label="Logged This Week" value={formatHours(weekHours)} icon={Timer} tone="emerald" href="/time-tracking" sub="Monday to today" />
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

          <Panel title="My Assigned Tasks" icon={CheckSquare} flush action={<PanelLink href="/tasks" label="Open Task Board" />}>
            {pendingTasks.length === 0 ? (
              <EmptyState icon={CheckCircle2} text="You have no active pending tasks assigned!" />
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th>Due Date</th>
                    <th>Statutory Due</th>
                    <th>Task</th>
                    <th>Category</th>
                    <th>Client</th>
                    <th>Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingTasks.map((t) => (
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
              <h3 className="flex items-center gap-2 text-sm font-bold text-rose-600">
                <AlertCircle className="h-4 w-4" />
                {isAdmin ? "Firm Overdue Compliance Items" : "My Overdue Tasks"} ({overdueTasks.length})
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
                <EmptyState icon={CheckCircle2} text="Great job! No overdue items." />
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
                            <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">{daysLate}d late</span>
                          </div>
                          <p className="text-[11px] text-text-muted">Client: {clientName(t.client_id) || "Internal"}</p>
                          <p className="text-[11px] text-text-muted">Assigned Staff: {teamName(t.assigned_to) || "Unassigned"}</p>
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
                              <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">Statutory breached</span>
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