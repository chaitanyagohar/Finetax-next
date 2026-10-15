"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Clock3,
  AlertTriangle,
  BarChart3,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  X,
  Search,
  FileText,
  Loader2,
  AlertCircle,
  RotateCcw,
  RefreshCw,
  Timer,
  Users,
  Hourglass,
  Target,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal } from "@/components/ui/Modal";
import { formatDate, getInitials, localISODate } from "@/lib/format";

const ANALYTICS_DAYS = 180;

const TABS = [
  { key: "pending", label: "Pending Approvals", icon: Clock3 },
  { key: "revisions", label: "Revision Requests", icon: AlertTriangle },
  { key: "analytics", label: "Quality Analytics", icon: BarChart3 },
] as const;

/* ---------------- Helpers ---------------- */

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / 86400000);
}
function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}
function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
function formatMinutes(mins: number): string {
  const m = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}
/** Stage a timeline entry moved the task to (supports both old and new log formats). */
function eventStage(log: any): string | null {
  return log?.metadata?.stage_changed_to || log?.metadata?.decision || null;
}
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDate(localISODate(d))} ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}

/* ---------------- Page ---------------- */

export default function ReviewerQueuePage() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab = TABS.some((t) => t.key === tabParam) ? (tabParam as (typeof TABS)[number]["key"]) : "pending";

  const currentUser = useCurrentUser();
  const me = currentUser?.id || "";
  const isAdmin = !!currentUser?.isAdmin;
  const [supabase] = useState(() => createClient());

  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [tasks, setTasks] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Inspection State
  const [inspectTask, setInspectTask] = useState<any | null>(null);
  const [reviewComments, setReviewComments] = useState("");
  const [notifyClient, setNotifyClient] = useState(true);
  const [deciding, setDeciding] = useState<null | "Approved" | "Changes Required">(null);
  const [decisionError, setDecisionError] = useState("");

  const today = localISODate();

  useEffect(() => {
    loadReviewData();
  }, [scope]);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 5000);
  }

  async function loadReviewData(showSpinner = true) {
    if (!me) return;
    if (showSpinner) setLoading(true);

    const since = new Date(Date.now() - ANALYTICS_DAYS * 86400000).toISOString();

    let openQuery = supabase.from("tasks").select("*").in("stage", ["Submitted for Review", "Changes Required"]).order("due_date", { ascending: true });
    let approvedQuery = supabase.from("tasks").select("*").eq("stage", "Approved").gte("created_at", since);
    if (!(isAdmin && scope === "all")) {
      openQuery = openQuery.eq("reviewer_id", me);
      approvedQuery = approvedQuery.eq("reviewer_id", me);
    }

    const [openRes, approvedRes, logRes, clientRes, teamRes] = await Promise.all([
      openQuery,
      approvedQuery,
      supabase.from("audit_logs").select("id, entity_id, action, metadata, timestamp").eq("entity", "TASKS").gte("timestamp", since).order("timestamp", { ascending: true }),
      supabase.from("clients").select("id, name, email"),
      supabase.from("profiles").select("id, name, email, is_active"),
    ]);

    if (openRes.error) showToast("error", "Could not load the review queue. Please refresh the page.");
    setTasks([...(openRes.data || []), ...(approvedRes.data || [])]);
    setLogs(logRes.data || []);
    setClients(clientRes.data || []);
    setTeam(teamRes.data || []);
    setLoading(false);
  }

  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [String(c.id), c])), [clients]);
  const personById = useMemo(() => Object.fromEntries(team.map((p) => [String(p.id), p])), [team]);
  const logsByTask = useMemo(() => {
    const map: Record<string, any[]> = {};
    logs.forEach((l) => {
      if (!l.entity_id) return;
      (map[l.entity_id] = map[l.entity_id] || []).push(l);
    });
    return map;
  }, [logs]);

  function lastStageEvent(taskId: string, stage: string): any | null {
    const list = logsByTask[taskId] || [];
    for (let i = list.length - 1; i >= 0; i--) {
      if (eventStage(list[i]) === stage) return list[i];
    }
    return null;
  }
  function returnCount(taskId: string): number {
    return (logsByTask[taskId] || []).filter((l) => eventStage(l) === "Changes Required").length;
  }
  function feedbackHistory(taskId: string): any[] {
    return (logsByTask[taskId] || []).filter((l) => eventStage(l) === "Changes Required" && (l.metadata?.feedback || l.metadata?.comments)).reverse();
  }

  /* ---------------- Lists ---------------- */

  const q = search.trim().toLowerCase();
  const matches = (t: any) =>
    !q ||
    [t.title, clientById[t.client_id]?.name, personById[t.assigned_to]?.name, t.category]
      .filter(Boolean)
      .some((f) => String(f).toLowerCase().includes(q));

  const pendingTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.stage === "Submitted for Review" && matches(t))
        .map((t) => ({ ...t, submittedAt: lastStageEvent(t.id, "Submitted for Review")?.timestamp || null }))
        .sort((a, b) => String(a.submittedAt || a.due_date || "").localeCompare(String(b.submittedAt || b.due_date || ""))),
    [tasks, logsByTask, search, clientById, personById]
  );

  const revisionTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.stage === "Changes Required" && matches(t))
        .map((t) => ({ ...t, returnedAt: lastStageEvent(t.id, "Changes Required")?.timestamp || null, rounds: returnCount(t.id) })),
    [tasks, logsByTask, search, clientById, personById]
  );

  /* ---------------- Quality analytics ---------------- */

  const analytics = useMemo(() => {
    const approved = tasks.filter((t) => t.stage === "Approved");
    const firstPass = approved.filter((t) => returnCount(t.id) === 0).length;
    const totalRounds = approved.reduce((s, t) => s + returnCount(t.id), 0);

    // Turnaround: each decision measured from the submission right before it
    const turnarounds: number[] = [];
    tasks.forEach((t) => {
      let lastSubmit: number | null = null;
      (logsByTask[t.id] || []).forEach((l) => {
        const s = eventStage(l);
        const ts = new Date(l.timestamp).getTime();
        if (s === "Submitted for Review") lastSubmit = ts;
        else if ((s === "Approved" || s === "Changes Required") && lastSubmit !== null) {
          turnarounds.push((ts - lastSubmit) / 3600000);
          lastSubmit = null;
        }
      });
    });

    const byPerson: Record<string, { id: string; approved: number; firstPass: number; rounds: number }> = {};
    approved.forEach((t) => {
      const key = t.assigned_to || "unassigned";
      if (!byPerson[key]) byPerson[key] = { id: key, approved: 0, firstPass: 0, rounds: 0 };
      const r = returnCount(t.id);
      byPerson[key].approved++;
      byPerson[key].rounds += r;
      if (r === 0) byPerson[key].firstPass++;
    });

    return {
      approved: approved.length,
      firstPassRate: approved.length ? Math.round((firstPass / approved.length) * 100) : 0,
      avgRounds: approved.length ? totalRounds / approved.length : 0,
      avgTurnaround: turnarounds.length ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length : 0,
      decisions: turnarounds.length,
      people: Object.values(byPerson).sort((a, b) => b.approved - a.approved),
    };
  }, [tasks, logsByTask]);

  const tabCounts: Record<string, number> = {
    pending: pendingTasks.length,
    revisions: revisionTasks.length,
    analytics: analytics.approved,
  };

  /* ---------------- Decisions ---------------- */

  function openInspect(t: any) {
    setInspectTask(t);
    setReviewComments(t.review_comments || "");
    setNotifyClient(true);
    setDecisionError("");
  }

  async function dispatchEmail(to: string, subject: string, body: string): Promise<boolean> {
    if (!to) return false;
    const formData = new FormData();
    formData.append("to", to);
    formData.append("subject", subject);
    formData.append("body", body);
    try {
      const res = await fetch("/api/send-email", { method: "POST", body: formData });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function handleDecision(newStage: "Approved" | "Changes Required") {
    if (!inspectTask || deciding) return;
    setDecisionError("");

    const feedback = reviewComments.trim();
    if (newStage === "Changes Required" && !feedback) {
      setDecisionError("Please write the feedback explaining what needs to change.");
      return;
    }

    setDeciding(newStage);
    const { error } = await supabase.from("tasks").update({ stage: newStage, review_comments: feedback }).eq("id", inspectTask.id);

    if (error) {
      setDeciding(null);
      setDecisionError(error.message);
      return;
    }

    await logAuditEvent("UPDATE_TASK", "TASKS", inspectTask.id, {
      stage_changed_to: newStage,
      ...(newStage === "Changes Required" ? { feedback: feedback.slice(0, 500) } : {}),
      via: "review_queue",
    });

    const assignee = personById[inspectTask.assigned_to];
    const client = clientById[inspectTask.client_id];
    const mails: Promise<boolean>[] = [];

    if (assignee?.email && inspectTask.assigned_to !== me) {
      mails.push(
        dispatchEmail(
          assignee.email,
          `[Task Review] ${inspectTask.title}: ${newStage}`,
          `Hello ${assignee.name},\n\nYour submitted task "${inspectTask.title}" has been ${
            newStage === "Approved" ? "approved" : "returned for changes"
          } by ${currentUser?.name || "your reviewer"}.\n\n${feedback ? `Feedback: ${feedback}\n\n` : ""}Please log into the Finetax Manager portal for details.`
        )
      );
    }
    if (newStage === "Approved" && notifyClient && client?.email) {
      mails.push(
        dispatchEmail(
          client.email,
          `Task Completed: ${inspectTask.title}`,
          `Dear ${client.name},\n\nWe are pleased to inform you that your task "${inspectTask.title}" has been completed and verified by our team.\n\nBest regards,\nFinetax Team`
        )
      );
    }

    const sent = (await Promise.all(mails)).filter(Boolean).length;
    const recurring = newStage === "Approved" && inspectTask.recurrence && inspectTask.recurrence !== "None";

    setDeciding(null);
    setInspectTask(null);
    setReviewComments("");
    showToast(
      "success",
      `${newStage === "Approved" ? "Approved and signed off" : "Returned for changes"}.${recurring ? ` The next ${String(inspectTask.recurrence).toLowerCase()} occurrence was created.` : ""}${
        sent ? ` ${sent} notification${sent === 1 ? "" : "s"} sent.` : ""
      }`
    );
    loadReviewData(false);
  }

  /* ---------------- Render helpers ---------------- */

  function deadlineBadge(date?: string, label = "Due") {
    if (!date) return null;
    const d = daysBetween(today, date);
    const cls = d < 0 ? "border-rose-200 bg-rose-50 text-rose-700" : d <= 3 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-border bg-surface-alt text-text-muted";
    const text = d < 0 ? `${-d}d overdue` : d === 0 ? "today" : `${d}d left`;
    return (
      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
        {label} {formatDate(date)} · {text}
      </span>
    );
  }

  const inspectHistory = inspectTask ? feedbackHistory(inspectTask.id) : [];
  const inspectClient = inspectTask ? clientById[inspectTask.client_id] : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm lg:flex-row lg:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
              <ShieldCheck className="h-5 w-5 text-navy" /> Reviewer Verification Hub
            </h2>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-700">
              {isAdmin && scope === "all" ? "Entire Firm" : "My Queue"}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">Verify submitted work, return it with clear feedback, and track quality over time.</p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          {isAdmin && (
            <div className="flex rounded-lg border border-border bg-surface-alt p-0.5 text-xs font-semibold">
              {(["mine", "all"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`rounded-md px-3 py-1.5 transition ${scope === s ? "bg-surface text-navy shadow-sm" : "text-text-muted hover:text-text-main"}`}
                >
                  {s === "mine" ? "My Queue" : "Entire Firm"}
                </button>
              ))}
            </div>
          )}
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search task, client, staff..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1 shadow-sm">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <Link
              key={t.key}
              href={`/reviewer-queue?tab=${t.key}`}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                active ? "bg-navy text-white shadow-sm" : "text-text-muted hover:bg-surface-alt hover:text-text-main"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              <span className={`rounded-full px-1.5 text-[10px] ${active ? "bg-white/20" : "bg-surface-alt"}`}>{tabCounts[t.key]}</span>
            </Link>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface p-10 text-xs text-text-muted shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading review queue...
        </div>
      ) : (
        <>
          {/* ---------- Pending Approvals ---------- */}
          {activeTab === "pending" &&
            (pendingTasks.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface p-10 text-center shadow-sm">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                <p className="text-sm font-semibold text-text-main">Queue clear</p>
                <p className="text-xs text-text-muted">No tasks are waiting for review.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {pendingTasks.map((t) => {
                  const waiting = t.submittedAt ? hoursSince(t.submittedAt) : 0;
                  const rounds = returnCount(t.id);
                  return (
                    <div key={t.id} className="flex flex-col rounded-xl border border-border bg-surface p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-navy/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-navy">{t.category || "Other"}</span>
                            {rounds > 0 && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Resubmission #{rounds}</span>
                            )}
                            {t.recurrence && t.recurrence !== "None" && <RefreshCw className="h-3 w-3 text-text-muted" />}
                          </div>
                          <h4 className="mt-1.5 text-sm font-bold text-navy">{t.title}</h4>
                        </div>
                        {t.submittedAt && (
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              waiting > 48 ? "bg-rose-100 text-rose-700" : waiting > 24 ? "bg-amber-100 text-amber-700" : "bg-surface-alt text-text-muted"
                            }`}
                          >
                            <Hourglass className="h-3 w-3" /> {formatDuration(waiting)}
                          </span>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {deadlineBadge(t.due_date, "Int")}
                        {deadlineBadge(t.official_due_date, "Stat")}
                      </div>

                      <div className="mt-3 flex-1 space-y-1 rounded-lg border border-border bg-surface-alt p-2.5 text-xs text-text-muted">
                        <p>
                          <strong className="text-text-main">Client:</strong> {clientById[t.client_id]?.name || "Internal"}
                        </p>
                        <p className="flex items-center gap-1.5">
                          <strong className="text-text-main">Executed by:</strong> {personById[t.assigned_to]?.name || "Unassigned"}
                          {t.time_spent_minutes > 0 && (
                            <span className="ml-auto inline-flex items-center gap-1 text-[10px]">
                              <Timer className="h-3 w-3" /> {formatMinutes(t.time_spent_minutes)}
                            </span>
                          )}
                        </p>
                        {t.notes && <p className="line-clamp-3"><strong className="text-text-main">Notes:</strong> {t.notes}</p>}
                      </div>

                      <button
                        type="button"
                        onClick={() => openInspect(t)}
                        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-navy py-2 text-xs font-bold text-white transition hover:bg-navy-light"
                      >
                        <ShieldCheck className="h-4 w-4" /> Inspect & Sign Off
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}

          {/* ---------- Revision Requests ---------- */}
          {activeTab === "revisions" &&
            (revisionTasks.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface p-10 text-center shadow-sm">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                <p className="text-xs text-text-muted">No tasks are currently out for revision.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th>Deadlines</th>
                      <th>Task</th>
                      <th>Client</th>
                      <th>Executed By</th>
                      <th>With Staff</th>
                      <th>Rounds</th>
                      <th>Required Changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revisionTasks.map((t) => (
                      <tr key={t.id} className="transition hover:bg-surface-alt">
                        <td>
                          <div className="flex flex-col gap-1">
                            {deadlineBadge(t.due_date, "Int")}
                            {deadlineBadge(t.official_due_date, "Stat")}
                          </div>
                        </td>
                        <td className="font-semibold text-navy">{t.title}</td>
                        <td>{clientById[t.client_id]?.name || "Internal"}</td>
                        <td className="whitespace-nowrap">{personById[t.assigned_to]?.name || "Unassigned"}</td>
                        <td className="whitespace-nowrap">{t.returnedAt ? formatDuration(hoursSince(t.returnedAt)) : "—"}</td>
                        <td>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${t.rounds > 1 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                            {t.rounds || 1}
                          </span>
                        </td>
                        <td className="max-w-sm italic text-rose-700">{t.review_comments || "No comment specified"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

          {/* ---------- Quality Analytics ---------- */}
          {activeTab === "analytics" && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                {[
                  { label: "Approved", value: String(analytics.approved), sub: `Last ${ANALYTICS_DAYS} days`, icon: CheckCircle2, style: "bg-emerald-50 text-emerald-600", valueClass: "text-emerald-700" },
                  { label: "First-Pass Approval", value: `${analytics.firstPassRate}%`, sub: "Approved without any return", icon: Target, style: "bg-navy/10 text-navy", valueClass: "text-navy" },
                  { label: "Avg Revision Rounds", value: analytics.avgRounds.toFixed(1), sub: "Returns per approved task", icon: RotateCcw, style: "bg-amber-50 text-amber-600", valueClass: "text-amber-700" },
                  { label: "Avg Review Turnaround", value: formatDuration(analytics.avgTurnaround), sub: `${analytics.decisions} decisions measured`, icon: Hourglass, style: "bg-violet-50 text-violet-600", valueClass: "text-violet-700" },
                ].map((k) => {
                  const Icon = k.icon;
                  return (
                    <div key={k.label} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{k.label}</p>
                          <p className={`mt-1.5 text-2xl font-bold tracking-tight ${k.valueClass}`}>{k.value}</p>
                        </div>
                        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${k.style}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-text-muted">{k.sub}</p>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-xl border border-border bg-surface shadow-sm">
                <div className="border-b border-border px-4 py-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-text-main">
                    <Users className="h-4 w-4 text-navy" /> Quality by Team Member
                  </h3>
                  <p className="text-[11px] text-text-muted">Based on tasks approved in the last {ANALYTICS_DAYS} days.</p>
                </div>
                {analytics.people.length === 0 ? (
                  <p className="p-8 text-center text-xs text-text-muted">No approved tasks in this period yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th>Team Member</th>
                          <th className="text-right">Approved</th>
                          <th className="text-right">First-Pass</th>
                          <th className="text-right">Total Returns</th>
                          <th>First-Pass Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.people.map((p) => {
                          const rate = p.approved ? Math.round((p.firstPass / p.approved) * 100) : 0;
                          const name = personById[p.id]?.name || "Unassigned";
                          return (
                            <tr key={p.id}>
                              <td>
                                <span className="flex items-center gap-2 font-semibold text-navy">
                                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy/10 text-[9px] font-bold text-navy">{getInitials(name)}</span>
                                  {name}
                                </span>
                              </td>
                              <td className="text-right font-semibold">{p.approved}</td>
                              <td className="text-right text-emerald-700">{p.firstPass}</td>
                              <td className={`text-right ${p.rounds ? "font-semibold text-amber-700" : "text-text-muted"}`}>{p.rounds}</td>
                              <td className="min-w-[160px]">
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-alt">
                                    <div
                                      className={`h-full rounded-full ${rate >= 80 ? "bg-emerald-500" : rate >= 50 ? "bg-amber-500" : "bg-rose-500"}`}
                                      style={{ width: `${rate}%` }}
                                    />
                                  </div>
                                  <span className="w-9 text-right font-semibold">{rate}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ================= Inspection ================= */}
      {inspectTask && (
        <Modal
          title={inspectTask.title}
          subtitle={`${clientById[inspectTask.client_id]?.name || "Internal"} · executed by ${personById[inspectTask.assigned_to]?.name || "staff"}`}
          onClose={() => !deciding && setInspectTask(null)}
          maxWidth="max-w-2xl"
          footer={
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleDecision("Changes Required")}
                disabled={!!deciding}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 py-2.5 text-xs font-bold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
              >
                {deciding === "Changes Required" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Request Changes
              </button>
              <button
                type="button"
                onClick={() => handleDecision("Approved")}
                disabled={!!deciding}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {deciding === "Approved" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Approve & Sign Off
              </button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            {decisionError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 font-medium text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{decisionError}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {deadlineBadge(inspectTask.due_date, "Internal")}
              {deadlineBadge(inspectTask.official_due_date, "Statutory")}
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-alt p-3 sm:grid-cols-4">
              <div>
                <p className="text-[10px] font-semibold uppercase text-text-muted">Category</p>
                <p className="font-semibold text-text-main">{inspectTask.category || "Other"}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-text-muted">Priority</p>
                <p className="font-semibold text-text-main">{inspectTask.priority || "Medium"}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-text-muted">Recurrence</p>
                <p className="font-semibold text-text-main">{inspectTask.recurrence && inspectTask.recurrence !== "None" ? inspectTask.recurrence : "One-time"}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-text-muted">Time Logged</p>
                <p className="font-semibold text-text-main">{inspectTask.time_spent_minutes ? formatMinutes(inspectTask.time_spent_minutes) : "—"}</p>
              </div>
            </div>

            <div>
              <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                <FileText className="h-3.5 w-3.5" /> Staff Execution Notes
              </p>
              <div className="whitespace-pre-wrap rounded-lg border border-border p-3 text-text-main">
                {inspectTask.notes || <span className="italic text-text-muted">No notes were added.</span>}
              </div>
            </div>

            {inspectHistory.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Previous Feedback Rounds</p>
                <div className="space-y-1.5">
                  {inspectHistory.map((h) => (
                    <div key={h.id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
                      <p className="text-[10px] text-amber-700">
                        {formatDateTime(h.timestamp)} · {h.metadata?.actor_name || "Reviewer"}
                      </p>
                      <p className="mt-0.5 text-amber-900">{h.metadata?.feedback || h.metadata?.comments}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                Review Feedback <span className="normal-case">(required when requesting changes)</span>
              </label>
              <textarea
                rows={4}
                value={reviewComments}
                onChange={(e) => setReviewComments(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
                placeholder="Be specific: what is wrong, where, and what the corrected output should be..."
              />
            </div>

            {inspectClient?.email && (
              <label className="flex cursor-pointer items-center gap-2 text-text-main">
                <input type="checkbox" checked={notifyClient} onChange={(e) => setNotifyClient(e.target.checked)} className="h-4 w-4 accent-navy" />
                On approval, email the client that the work is complete ({inspectClient.email})
              </label>
            )}

            {inspectTask.recurrence && inspectTask.recurrence !== "None" && (
              <p className="flex items-center gap-1.5 rounded-lg bg-navy/5 p-2.5 text-navy">
                <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                Approving creates the next {String(inspectTask.recurrence).toLowerCase()} occurrence automatically.
              </p>
            )}

            <Link href="/tasks" className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy hover:underline">
              Open in the task board <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </Modal>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-[70] flex max-w-sm items-start gap-2 rounded-lg border px-4 py-3 text-xs font-semibold shadow-lg animate-scale-in ${
            toast.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {toast.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}