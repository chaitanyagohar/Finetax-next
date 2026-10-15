"use client";

import { useState, useEffect } from "react";
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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
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

const CLOSED_LEAD_STATUSES = ["converted", "lost", "closed", "rejected", "dropped", "not interested"];
const CLOSED_QUOTE_STATUSES = ["approved", "accepted", "converted", "invoiced", "rejected", "declined", "expired", "cancelled"];

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

// Local (IST) date as YYYY-MM-DD — avoids the UTC off-by-one before 5:30 AM
function localISODate(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysISO(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return localISODate(new Date(y, m - 1, d + n));
}

function daysBetween(fromISO: string, toISO: string) {
  return Math.round((Date.parse(toISO.slice(0, 10)) - Date.parse(fromISO.slice(0, 10))) / 86400000);
}

// Strict DD/MM/YYYY
function formatDate(value?: string | null) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

function formatINR(n: number) {
  return "₹" + Math.round(n || 0).toLocaleString("en-IN");
}

function compactINR(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return formatINR(n);
}

function currentFYLabel() {
  const now = new Date();
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `FY ${start}-${String(start + 1).slice(-2)}`;
}

function isPaid(inv: any) {
  return (inv.status || "").toLowerCase() === "paid";
}

function sumTotal(items: any[]) {
  return items.reduce((sum, i) => sum + Number(i.total || 0), 0);
}

function byDueDate(a: any, b: any) {
  return (a.due_date || "9999").localeCompare(b.due_date || "9999");
}

function greeting() {
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
        STAGE_STYLES[stage || ""] || "bg-navy/10 text-navy border-navy/20"
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
  const overdue = date < today;
  const isToday = date.slice(0, 10) === today;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap font-medium ${
        overdue ? "font-semibold text-rose-600" : isToday ? "font-semibold text-amber-600" : "text-text-main"
      }`}
    >
      {overdue && <AlertCircle className="h-3 w-3" />}
      {formatDate(date)}
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
  const [profile, setProfile] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [discussions, setDiscussions] = useState<any[]>([]);
  const [reviewQueue, setReviewQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Filters & State
  const [dateFilter, setDateFilter] = useState("all"); // 'month', 'quarter', 'fy', 'all'
  const [selectedOverdueTask, setSelectedOverdueTask] = useState<any | null>(null);
  const [isOverdueDrawerOpen, setIsOverdueDrawerOpen] = useState(false);

  const [supabase] = useState(() => createClient());
  const today = localISODate();
  const fyLabel = currentFYLabel();

  const DATE_FILTER_LABELS: Record<string, string> = {
    all: "All Time",
    month: "This Month",
    quarter: "This Quarter",
    fy: fyLabel,
  };

  useEffect(() => {
    loadDashboardData(true);

    // Real-time Supabase Data Subscriptions (silent refresh — no full-screen loader)
    const taskSub = supabase.channel("realtime-tasks").on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadDashboardData()).subscribe();
    const invSub = supabase.channel("realtime-invoices").on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, () => loadDashboardData()).subscribe();

    return () => {
      supabase.removeChannel(taskSub);
      supabase.removeChannel(invSub);
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
    if (isInitial) setLoading(true);
    else setRefreshing(true);

    try {
      // 1. Fetch current user profile with secure fallback
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userProfile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      const currentProfile = userProfile || { name: "User", role: "staff", id: user.id };
      setProfile(currentProfile);

      // 2. Fetch Tasks (Staff sees assigned tasks, Admin/Reviewer sees broad scope)
      let taskQuery = supabase
        .from("tasks")
        .select("*, clients(name), profiles!tasks_assigned_to_fkey(name)");

      if (currentProfile.role === "staff") {
        taskQuery = taskQuery.eq("assigned_to", currentProfile.id);
      }

      const { data: taskData } = await taskQuery.order("due_date", { ascending: true });
      if (taskData) setTasks(taskData);

      // 3. Review queue (Admins see all submissions, Reviewers see items assigned to them)
      if (currentProfile.role === "admin" || currentProfile.is_reviewer) {
        let reviewQuery = supabase
          .from("tasks")
          .select("*, clients(name), profiles!tasks_assigned_to_fkey(name)")
          .eq("stage", "Submitted for Review");

        if (currentProfile.role !== "admin") {
          reviewQuery = reviewQuery.eq("reviewer_id", currentProfile.id);
        }

        const { data: reviewData } = await reviewQuery.order("due_date", { ascending: true });
        setReviewQueue(reviewData || []);
      }

      // 4. Admin Eagle's Eye Data Stream
      if (currentProfile.role === "admin") {
        const [
          { data: cData },
          { data: iData },
          { data: qData },
          { data: pData },
          { data: lData },
          { data: dData },
        ] = await Promise.all([
          supabase.from("clients").select("*"),
          supabase.from("invoices").select("*, clients(name)"),
          supabase.from("quotations").select("*"),
          supabase.from("profiles").select("*"),
          supabase.from("leads").select("*"),
          supabase.from("discussions").select("*, clients(name)"),
        ]);

        if (cData) setClients(cData);
        if (iData) setInvoices(iData);
        if (qData) setQuotations(qData);
        if (pData) setTeam(pData);
        if (lData) setLeads(lData);
        if (dData) setDiscussions(dData);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLastUpdated(new Date());
    }
  }

  // Filter Financials by Date Range
  function filterByDate(items: any[], dateField: string) {
    if (dateFilter === "all") return items;
    const now = new Date();
    return items.filter((item) => {
      if (!item[dateField]) return false;
      const d = new Date(item[dateField]);
      if (dateFilter === "month") {
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }
      if (dateFilter === "quarter") {
        const currentQuarter = Math.floor(now.getMonth() / 3);
        const itemQuarter = Math.floor(d.getMonth() / 3);
        return itemQuarter === currentQuarter && d.getFullYear() === now.getFullYear();
      }
      if (dateFilter === "fy") {
        // FY runs 1 April to 31 March
        const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const fyStart = new Date(startYear, 3, 1);
        const fyEnd = new Date(startYear + 1, 3, 1);
        return d >= fyStart && d < fyEnd;
      }
      return true;
    });
  }

  if (loading) {
    return <DashboardSkeleton />;
  }

  const isAdmin = profile?.role === "admin";
  const isReviewer = !!profile?.is_reviewer;
  const periodLabel = DATE_FILTER_LABELS[dateFilter];

  /* ---------------- Task calculations ---------------- */
  const pendingTasks = tasks.filter((t) => t.stage !== "Approved").sort(byDueDate);
  const overdueTasks = pendingTasks.filter((t) => t.due_date && t.due_date < today);
  const completedTasks = tasks.filter((t) => t.stage === "Approved");
  const changesRequired = pendingTasks.filter((t) => t.stage === "Changes Required");
  const inReview = tasks.filter((t) => t.stage === "Submitted for Review");
  const unassignedCount = pendingTasks.filter((t) => !t.assigned_to).length;

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

  /* ---------------- Financial calculations ---------------- */
  const filteredInvoices = filterByDate(invoices, "date");
  const totalRevenue = sumTotal(filteredInvoices);
  const paidInvoices = filteredInvoices.filter(isPaid);
  const totalCollected = sumTotal(paidInvoices);
  const unpaidInvoices = filteredInvoices.filter((inv) => !isPaid(inv));
  const totalUnpaid = sumTotal(unpaidInvoices);
  const collectionRate = totalRevenue > 0 ? Math.round((totalCollected / totalRevenue) * 100) : 0;

  // Receivables aging is always all-time (it's a balance, not a period figure)
  const allUnpaid = invoices.filter((inv) => !isPaid(inv));
  const allUnpaidTotal = sumTotal(allUnpaid);
  const agingBuckets = [
    { label: "0–30 days", min: 0, max: 30, bar: "bg-emerald-500" },
    { label: "31–60 days", min: 31, max: 60, bar: "bg-amber-400" },
    { label: "61–90 days", min: 61, max: 90, bar: "bg-orange-500" },
    { label: "90+ days", min: 91, max: Infinity, bar: "bg-rose-500" },
  ].map((b) => {
    const items = allUnpaid.filter((inv) => {
      const age = inv.date ? daysBetween(inv.date, today) : 0;
      return age >= b.min && age <= b.max;
    });
    return { ...b, count: items.length, amount: sumTotal(items) };
  });

  // 6-month billing trend
  const now = new Date();
  const trend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const monthInvoices = invoices.filter((inv) => (inv.date || "").slice(0, 7) === key);
    return {
      key,
      label: d.toLocaleString("en-IN", { month: "short" }),
      billed: sumTotal(monthInvoices),
      collected: sumTotal(monthInvoices.filter(isPaid)),
    };
  });
  const maxTrend = Math.max(1, ...trend.map((m) => m.billed));
  const barHeight = (v: number) => (v > 0 ? Math.max(3, (v / maxTrend) * 100) : 0);

  /* ---------------- CRM calculations ---------------- */
  const activeClients = clients.filter((c) => !c.status || String(c.status).toLowerCase() === "active");
  const openLeads = leads.filter((l) => !CLOSED_LEAD_STATUSES.includes(String(l.status || "").toLowerCase()));
  const leadFollowUpsDue = openLeads.filter((l) => l.follow_up_date && l.follow_up_date.slice(0, 10) <= today);
  const convertedLeads = leads.filter((l) => String(l.status || "").toLowerCase() === "converted" || l.converted_client_id);
  const conversionRate = leads.length > 0 ? Math.round((convertedLeads.length / leads.length) * 100) : 0;

  const openQuotes = quotations.filter((q) => !CLOSED_QUOTE_STATUSES.includes(String(q.status || "").toLowerCase()));
  const pipelineValue = sumTotal(openQuotes);

  const discussionFollowUps = discussions.filter(
    (d) => !d.follow_up_completed && d.follow_up_date && d.follow_up_date.slice(0, 10) <= today
  );

  /* ---------------- Workload Map per Staff (Admin view) ---------------- */
  const staffWorkload = team
    .filter((member) => member.is_active !== false)
    .map((member) => {
      const memberTasks = tasks.filter((t) => t.assigned_to === member.id && t.stage !== "Approved");
      const memberOverdue = memberTasks.filter((t) => t.due_date && t.due_date < today);
      const memberReviews = tasks.filter((t) => t.reviewer_id === member.id && t.stage === "Submitted for Review");
      return {
        id: member.id,
        name: member.name || member.email || "Unnamed",
        role: member.role,
        designation: member.designation,
        isReviewer: !!member.is_reviewer,
        activeCount: memberTasks.length,
        overdueCount: memberOverdue.length,
        reviewCount: memberReviews.length,
      };
    })
    .sort((a, b) => b.activeCount - a.activeCount);
  const maxLoad = Math.max(1, ...staffWorkload.map((s) => s.activeCount));

  return (
    <div className="space-y-6">
      {/* ================= HEADER ================= */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm lg:flex-row lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-text-main">
              {greeting()}, {profile?.name?.split(" ")[0] || "there"}
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
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="bg-transparent text-xs font-medium focus:outline-none"
              >
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
            <Link href="/tasks" className="inline-flex items-center gap-1 rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light">
              View Work Schedule <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>

      {isAdmin ? (
        /* ================= ADMIN EAGLE'S EYE VIEW ================= */
        <>
          {/* Primary KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label={`Billed · ${periodLabel}`}
              value={compactINR(totalRevenue)}
              icon={IndianRupee}
              tone="navy"
              href="/invoices"
              sub={`${filteredInvoices.length} invoice${filteredInvoices.length === 1 ? "" : "s"} raised`}
            />
            <KpiCard
              label={`Collected · ${periodLabel}`}
              value={compactINR(totalCollected)}
              icon={CheckCircle2}
              tone="emerald"
              href="/invoices"
              sub={
                <div className="space-y-1.5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${collectionRate}%` }} />
                  </div>
                  <span className="font-medium text-emerald-700">{collectionRate}% collection rate</span>
                </div>
              }
            />
            <KpiCard
              label="Unpaid Receivables"
              value={compactINR(totalUnpaid)}
              icon={Receipt}
              tone="amber"
              href="/invoices"
              sub={<span className="font-medium text-amber-700">{unpaidInvoices.length} invoices pending payment</span>}
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
                  {leadFollowUpsDue.length > 0 ? (
                    <span className="font-semibold text-amber-700">{leadFollowUpsDue.length} follow-ups due</span>
                  ) : (
                    "No follow-ups due"
                  )}
                  {" · "}
                  {conversionRate}% converted
                </span>
              }
            />
            <KpiCard
              label="Quotation Pipeline"
              value={compactINR(pipelineValue)}
              icon={FileText}
              tone="violet"
              href="/quotations"
              sub={`${openQuotes.length} open quote${openQuotes.length === 1 ? "" : "s"} awaiting decision`}
            />
            <KpiCard
              label="Active Clients"
              value={activeClients.length}
              icon={Users}
              tone="navy"
              href="/clients"
              sub={`${clients.length} total in client master`}
            />
            <KpiCard
              label="Client Follow-ups"
              value={discussionFollowUps.length}
              icon={MessageSquare}
              tone={discussionFollowUps.length > 0 ? "amber" : "emerald"}
              href="/client-discussions"
              sub={discussionFollowUps.length > 0 ? "Discussion follow-ups due or missed" : "All discussion follow-ups clear"}
            />
          </div>

          {/* Billing trend + Receivables aging */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Panel
              title="Billing Trend (Last 6 Months)"
              icon={TrendingUp}
              className="lg:col-span-2"
              action={
                <div className="flex items-center gap-3 text-[11px] text-text-muted">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-navy" /> Billed</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Collected</span>
                </div>
              }
            >
              {invoices.length === 0 ? (
                <EmptyState icon={TrendingUp} text="No invoices yet. The trend will appear once invoices are raised." />
              ) : (
                <div className="flex h-52 items-end gap-2 sm:gap-4">
                  {trend.map((m) => (
                    <div key={m.key} className="flex h-full flex-1 flex-col items-center gap-2">
                      <span className="text-[10px] font-semibold text-text-main">{m.billed > 0 ? compactINR(m.billed) : ""}</span>
                      <div className="flex w-full flex-1 items-end justify-center gap-1 border-b border-border">
                        <div
                          className="w-1/3 max-w-[22px] rounded-t bg-navy transition-all"
                          style={{ height: `${barHeight(m.billed)}%` }}
                          title={`Billed: ${formatINR(m.billed)}`}
                        />
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
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Total Outstanding (All Time)</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-amber-700">{formatINR(allUnpaidTotal)}</p>
                <p className="text-[11px] text-text-muted">{allUnpaid.length} unpaid invoices</p>
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
                      <div
                        className={`h-full rounded-full ${b.bar}`}
                        style={{ width: `${allUnpaidTotal > 0 ? (b.amount / allUnpaidTotal) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* Upcoming deadlines + Stage pipeline */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Panel
              title={`Deadlines in the Next 7 Days (${dueThisWeek.length})`}
              icon={Clock}
              className="lg:col-span-2"
              flush
              action={<PanelLink href="/tasks" label="Manage Tasks" />}
            >
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
                        <td className="max-w-[160px] truncate">{t.clients?.name || t.organisation || "Internal"}</td>
                        <td><DueDate date={t.due_date} today={today} /></td>
                        <td><DueDate date={t.official_due_date} today={today} /></td>
                        <td>{t.profiles?.name || <span className="font-semibold text-rose-500">Unassigned</span>}</td>
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
                      <div
                        className={`h-full rounded-full ${staff.overdueCount > 0 ? "bg-rose-500" : "bg-navy"}`}
                        style={{ width: `${(staff.activeCount / maxLoad) * 100}%` }}
                      />
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
            <Panel
              title="Finetax-Wide Task Stream"
              icon={CheckSquare}
              className="lg:col-span-2"
              flush
              action={<PanelLink href="/tasks" label="Manage Tasks" />}
            >
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
                        <td className="max-w-[160px] truncate">{t.clients?.name || "Internal"}</td>
                        <td>{t.profiles?.name || <span className="font-semibold text-rose-500">Unassigned</span>}</td>
                        <td><StageBadge stage={t.stage} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Recent Invoices" icon={Receipt} action={<PanelLink href="/invoices" label="View All" />}>
              {filteredInvoices.length === 0 ? (
                <EmptyState icon={Receipt} text="No invoices found for this range." />
              ) : (
                <div className="space-y-2">
                  {[...filteredInvoices]
                    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
                    .slice(0, 6)
                    .map((inv) => (
                      <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-alt p-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-navy">{inv.invoice_number}</p>
                          <p className="truncate text-[11px] text-text-muted">
                            {inv.clients?.name || inv.organisation || "Client"} · {formatDate(inv.date)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs font-bold text-text-main">{formatINR(Number(inv.total || 0))}</p>
                          <span
                            className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                              isPaid(inv) ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {inv.status || "Unpaid"}
                          </span>
                        </div>
                      </div>
                    ))}
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
            <KpiCard label="In Review" value={inReview.length} icon={ShieldCheck} tone="violet" />
            <KpiCard label="Completed" value={completedTasks.length} icon={CheckCircle2} tone="emerald" />
          </div>

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
                        <p className="truncate text-[11px] text-text-muted">{t.clients?.name || "Internal"}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <DueDate date={t.due_date} today={today} />
                        {t.official_due_date && (
                          <p className="text-[10px] text-text-muted">Statutory: {formatDate(t.official_due_date)}</p>
                        )}
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

          <Panel title="My Assigned Tasks" icon={CheckSquare} flush action={<PanelLink href="/tasks" label="View Work Schedule" />}>
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
                      <td className="max-w-[160px] truncate">{t.clients?.name || "Internal"}</td>
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
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[1px] animate-fade-in"
          onClick={() => setIsOverdueDrawerOpen(false)}
        >
          <div
            className="flex h-full w-full max-w-md flex-col bg-surface text-xs shadow-2xl animate-slide-in-right"
            onClick={(e) => e.stopPropagation()}
          >
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
                        className={`rounded-lg border p-3 transition ${
                          isOpen ? "border-rose-300 bg-rose-50/50" : "border-border bg-surface-alt hover:border-rose-200"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedOverdueTask(isOpen ? null : t)}
                          className="w-full space-y-1 text-left"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-navy">{t.title}</span>
                            <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                              {daysLate}d late
                            </span>
                          </div>
                          <p className="text-[11px] text-text-muted">Client: {t.clients?.name || "Internal"}</p>
                          <p className="text-[11px] text-text-muted">Assigned Staff: {t.profiles?.name || "Unassigned"}</p>
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <span className="text-[11px] text-text-muted">
                              Internal: <span className="font-semibold text-rose-600">{formatDate(t.due_date)}</span>
                            </span>
                            {t.official_due_date && (
                              <span className="text-[11px] text-text-muted">
                                Statutory:{" "}
                                <span className={`font-semibold ${statutoryBreached ? "text-rose-600" : "text-text-main"}`}>
                                  {formatDate(t.official_due_date)}
                                </span>
                              </span>
                            )}
                            {statutoryBreached && (
                              <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                                Statutory breached
                              </span>
                            )}
                          </div>
                        </button>

                        {isOpen && (
                          <div className="mt-3 space-y-2 border-t border-rose-200 pt-3">
                            <div className="flex flex-wrap gap-2">
                              <StageBadge stage={t.stage} />
                              {t.priority && (
                                <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold text-text-main">
                                  {t.priority} priority
                                </span>
                              )}
                              {t.category && (
                                <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold text-text-main">
                                  {t.category}
                                </span>
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