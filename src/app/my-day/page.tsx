"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileClock,
  Hourglass,
  Loader2,
  Play,
  Send,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Card, EmptyState, Meter, Pill, Stat, btn } from "@/components/ui/kit";
import { checklistProgress } from "@/components/tasks/TaskChecklist";
import { formatDate, localISODate } from "@/lib/format";

type Row = {
  id: string;
  title: string;
  period: string | null;
  stage: string;
  due_date: string | null;
  official_due_date: string | null;
  assigned_to: string | null;
  reviewer_id: string | null;
  estimated_minutes: number | null;
  time_spent_minutes: number | null;
  clients: { name: string | null; organization_name: string | null } | null;
};

const SELECT =
  "id, title, period, stage, due_date, official_due_date, assigned_to, reviewer_id, estimated_minutes, time_spent_minutes, clients!client_id(name, organization_name)";

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return localISODate(new Date(y, m - 1, d + n));
}

function clientOf(t: Row) {
  return t.clients?.organization_name || t.clients?.name || "Internal";
}

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function dueLabel(due: string | null, today: string) {
  if (!due) return { text: "No date", tone: "default" as const };
  if (due < today) {
    const days = Math.round((Date.parse(today) - Date.parse(due)) / 86400000);
    return { text: `${days}d overdue`, tone: "bad" as const };
  }
  if (due === today) return { text: "Today", tone: "accent" as const };
  if (due === addDays(today, 1)) return { text: "Tomorrow", tone: "warn" as const };
  return { text: formatDate(due), tone: "default" as const };
}

type RowProps = {
  t: Row;
  today: string;
  progress?: { done: number; needed: number };
  busy: boolean;
  onMove?: (t: Row, stage: "In Progress" | "Submitted for Review") => void;
};

function TaskRow({ t, today, progress: p, busy, onMove }: RowProps) {
  const due = dueLabel(t.due_date, today);
  const canStart = t.stage === "Assigned" || t.stage === "Changes Required";
  const canSubmit = t.stage === "In Progress";
  return (
    <li className="group flex items-center gap-3 px-4 py-3 transition hover:bg-surface-alt/70">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          t.stage === "Changes Required" ? "bg-rose-500" : t.stage === "In Progress" ? "bg-sky-500" : t.stage === "Submitted for Review" ? "bg-violet-500" : "bg-amber-400"
        }`}
        title={t.stage}
      />
      <Link href={`/tasks?task=${t.id}`} className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-main group-hover:text-accent">{t.title}</span>
        <span className="block truncate text-[11px] text-text-muted">
          {clientOf(t)}
          {t.period ? ` · ${t.period}` : ""}
          {t.stage === "Changes Required" ? " · changes requested" : ""}
        </span>
        {p && p.needed > 0 && (
          <span className="mt-1.5 flex max-w-[220px] items-center gap-2">
            <Meter value={p.done / p.needed} tone={p.done === p.needed ? "good" : "warn"} />
            <span className="shrink-0 text-[10px] text-text-muted">
              {p.done}/{p.needed}
            </span>
          </span>
        )}
      </Link>
      <Pill tone={due.tone}>{due.text}</Pill>
      {onMove && (canStart || canSubmit) && (
        <button
          type="button"
          onClick={() => onMove(t, canStart ? "In Progress" : "Submitted for Review")}
          disabled={busy}
          className={`${canStart ? btn.secondary : btn.primary} shrink-0 px-2.5 py-1.5 text-[11px]`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : canStart ? <Play className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{canStart ? "Start" : "Submit"}</span>
        </button>
      )}
    </li>
  );
}

function Group({ title, tone, icon: Icon, children, count }: { title: string; tone: string; icon: typeof Sun; children: React.ReactNode; count: number }) {
  if (!count) return null;
  return (
    <div>
      <p className={`flex items-center gap-1.5 px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>
        <Icon className="h-3.5 w-3.5" /> {title} <span className="text-text-muted">· {count}</span>
      </p>
      <ul className="list-in divide-y divide-border">{children}</ul>
    </div>
  );
}

export default function MyDayPage() {
  const user = useCurrentUser();
  const [supabase] = useState(() => createClient());
  const [mine, setMine] = useState<Row[] | null>(null);
  const [toReview, setToReview] = useState<Row[]>([]);
  const [pendingByTask, setPendingByTask] = useState<Record<string, { done: number; needed: number }>>({});
  const [loggedToday, setLoggedToday] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [now] = useState(() => new Date());
  const today = localISODate(now);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const [a, r, logs] = await Promise.all([
      supabase.from("tasks").select(SELECT).eq("assigned_to", user.id).neq("stage", "Approved").order("due_date", { ascending: true, nullsFirst: false }).limit(300),
      supabase.from("tasks").select(SELECT).eq("reviewer_id", user.id).eq("stage", "Submitted for Review").order("due_date").limit(100),
      supabase.from("time_logs").select("hours").eq("user_id", user.id).eq("log_date", today),
    ]);
    const rows = (a.data || []) as unknown as Row[];
    setMine(rows);
    setToReview(((r.data || []) as unknown as Row[]).filter((t) => t.assigned_to !== user.id));
    setLoggedToday((logs.data || []).reduce((s, l) => s + Number(l.hours || 0), 0));

    const ids = rows.map((t) => t.id);
    if (ids.length) {
      const { data: items } = await supabase.from("task_checklist_items").select("task_id, status").in("task_id", ids);
      const grouped: Record<string, { status: "pending" | "received" | "not_needed" }[]> = {};
      for (const it of (items || []) as { task_id: string; status: "pending" | "received" | "not_needed" }[]) {
        (grouped[it.task_id] ||= []).push(it);
      }
      setPendingByTask(Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, checklistProgress(v)])));
    } else {
      setPendingByTask({});
    }
  }, [supabase, user?.id, today]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const list = mine || [];
    const week = addDays(today, 7);
    const waiting = list.filter((t) => {
      const p = pendingByTask[t.id];
      return p && p.needed > p.done && t.stage !== "Submitted for Review";
    });
    const waitingIds = new Set(waiting.map((t) => t.id));
    const active = list.filter((t) => !waitingIds.has(t.id) && t.stage !== "Submitted for Review");
    return {
      overdue: active.filter((t) => t.due_date && t.due_date < today),
      today: active.filter((t) => t.due_date === today),
      week: active.filter((t) => t.due_date && t.due_date > today && t.due_date <= week),
      later: active.filter((t) => !t.due_date || t.due_date > week),
      waiting,
      submitted: list.filter((t) => t.stage === "Submitted for Review"),
    };
  }, [mine, pendingByTask, today]);

  async function move(t: Row, stage: "In Progress" | "Submitted for Review") {
    setBusyId(t.id);
    setNotice(null);
    const { error } = await supabase.from("tasks").update({ stage }).eq("id", t.id);
    setBusyId(null);
    if (error) return setNotice({ tone: "bad", text: error.message });
    setNotice({
      tone: "good",
      text: stage === "In Progress" ? `Started ${t.title}. Your timer is running.` : `${t.title} sent for review.`,
    });
    load();
  }

  const rowsOf = (rows: Row[], actions = true) =>
    rows.map((t) => (
      <TaskRow key={t.id} t={t} today={today} progress={pendingByTask[t.id]} busy={busyId === t.id} onMove={actions ? move : undefined} />
    ));

  const firstName = (user?.name || "").split(" ")[0] || "there";
  const focusCount = groups.overdue.length + groups.today.length;
  const loading = mine === null;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-navy p-6 text-white shadow-sm sm:p-8">
        <div className="pointer-events-none absolute inset-0 sidebar-glow opacity-90" aria-hidden />
        <svg className="decor-spin pointer-events-none absolute -right-16 -top-16 h-64 w-64 opacity-40" viewBox="0 0 200 200" fill="none" aria-hidden>
          <circle cx="100" cy="100" r="60" stroke="#f2613f" strokeOpacity=".6" />
          <circle cx="100" cy="100" r="85" stroke="#f2613f" strokeOpacity=".3" strokeDasharray="3 8" />
          <circle cx="160" cy="100" r="5" fill="#f2613f" />
        </svg>
        <div className="relative">
          <p className="text-xs font-medium text-white/60">
            {now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {greeting(now.getHours())}, {firstName}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-white/70">
            {loading
              ? "Getting your day ready…"
              : focusCount
                ? `${focusCount} task${focusCount === 1 ? " needs" : "s need"} your attention today${groups.overdue.length ? `, ${groups.overdue.length} of them overdue` : ""}.`
                : "Nothing is due today. A good day to get ahead on this week's work."}
          </p>
        </div>
      </div>

      <div aria-busy={loading} className="kpi-grid grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Due today" value={groups.today.length} icon={Sun} tone="accent" />
        <Stat label="Overdue" value={groups.overdue.length} icon={AlertTriangle} tone={groups.overdue.length ? "bad" : "default"} />
        <Stat label="Waiting on client" value={groups.waiting.length} icon={Hourglass} tone="warn" hint="Documents still to come" />
        <Stat
          label="Logged today"
          value={`${Math.floor(loggedToday)}h ${Math.round((loggedToday % 1) * 60)}m`}
          icon={Clock3}
          tone="info"
          href="/time-tracking"
        />
      </div>

      {notice && (
        <p role="status" className={`rounded-lg px-4 py-2.5 text-xs font-medium ${notice.tone === "good" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {notice.text}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card
          title="Your work"
          icon={CalendarDays}
          bodyClassName="pb-2"
          action={
            <Link href="/tasks" className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-muted hover:text-accent">
              All tasks <ArrowRight className="h-3 w-3" />
            </Link>
          }
        >
          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-12" />
              ))}
            </div>
          ) : (mine || []).length === 0 ? (
            <EmptyState title="Your list is clear" hint="New tasks assigned to you will appear here, sorted by when they're due." />
          ) : (
            <>
              <Group title="Overdue" count={groups.overdue.length} tone="text-rose-600" icon={AlertTriangle}>
                {rowsOf(groups.overdue)}
              </Group>
              <Group title="Today" count={groups.today.length} tone="text-accent" icon={Sun}>
                {rowsOf(groups.today)}
              </Group>
              <Group title="Next 7 days" count={groups.week.length} tone="text-text-main" icon={CalendarDays}>
                {rowsOf(groups.week)}
              </Group>
              <Group title="Later" count={groups.later.length} tone="text-text-muted" icon={Clock3}>
                {rowsOf(groups.later)}
              </Group>
            </>
          )}
        </Card>

        <div className="space-y-6">
          {toReview.length > 0 && (
            <Card title="Waiting for your review" icon={ShieldCheck} bodyClassName="">
              <ul className="divide-y divide-border">
                {rowsOf(toReview, false)}
              </ul>
              <div className="border-t border-border px-4 py-2.5">
                <Link href="/reviewer-queue" className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
                  Open review queue <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </Card>
          )}

          <Card title="Waiting on client" icon={FileClock} bodyClassName="">
            {groups.waiting.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-text-muted">No task is held up by missing documents.</p>
            ) : (
              <ul className="divide-y divide-border">
                {rowsOf(groups.waiting, false)}
              </ul>
            )}
          </Card>

          {groups.submitted.length > 0 && (
            <Card title="Sent for review" icon={CheckCircle2} bodyClassName="">
              <ul className="divide-y divide-border">
                {rowsOf(groups.submitted, false)}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
