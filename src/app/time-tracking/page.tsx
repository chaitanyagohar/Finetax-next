"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Clock,
  Play,
  Square,
  Calendar,
  User,
  CheckCircle2,
  Trash2,
  X,
  Edit2,
  Lock,
  Loader2,
  AlertCircle,
  Download,
  TrendingUp,
  Users,
  Timer,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import ClientPicker, { clientLabel, sortByLabel } from "@/components/ui/ClientPicker";
import AttendancePanel from "@/components/time/AttendancePanel";
import { formatDate, getInitials, localISODate } from "@/lib/format";

const LOCK_DAYS = 7; // must match v_lock_days in the database rule

type Period = "today" | "week" | "month" | "lastMonth" | "custom";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15 disabled:bg-surface-alt disabled:text-text-muted";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

/* ---------------- Helpers ---------------- */

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localISODate(new Date(y, m - 1, d + days));
}
function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = (date.getDay() + 6) % 7; // Monday = 0
  return localISODate(new Date(y, m - 1, d - day));
}
function periodRange(period: Period, today: string, customFrom: string, customTo: string): [string, string] {
  const [y, m] = today.split("-").map(Number);
  switch (period) {
    case "today":
      return [today, today];
    case "week": {
      const start = mondayOf(today);
      return [start, addDays(start, 6)];
    }
    case "month":
      return [localISODate(new Date(y, m - 1, 1)), localISODate(new Date(y, m, 0))];
    case "lastMonth":
      return [localISODate(new Date(y, m - 2, 1)), localISODate(new Date(y, m - 1, 0))];
    default:
      return [customFrom || today, customTo || today];
  }
}
function formatHours(hours: number): string {
  const mins = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}
function formatTimerDisplay(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

/* ---------------- Page ---------------- */

export default function TimeTrackingPage() {
  const currentUser = useCurrentUser();
  const me = currentUser?.id || "";
  const isAdmin = !!currentUser?.isAdmin;
  const [supabase] = useState(() => createClient());

  const [logs, setLogs] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterBillable, setFilterBillable] = useState("");
  const [period, setPeriod] = useState<Period>("week");
  const [customFrom, setCustomFrom] = useState(addDays(localISODate(), -30));
  const [customTo, setCustomTo] = useState(localISODate());

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Timer State (server-side)
  const [myTimer, setMyTimer] = useState<any | null>(null);
  const [activeTimers, setActiveTimers] = useState<any[]>([]);
  const [now, setNow] = useState(Date.now());
  const [timerDescription, setTimerDescription] = useState("");
  const [timerClientId, setTimerClientId] = useState("");
  const [timerTaskId, setTimerTaskId] = useState("");
  const [timerBillable, setTimerBillable] = useState(true);
  const [timerBusy, setTimerBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [logDate, setLogDate] = useState(localISODate());
  const [isBillable, setIsBillable] = useState(true);

  const today = localISODate();
  const lockDate = addDays(today, -LOCK_DAYS);
  const [rangeFrom, rangeTo] = periodRange(period, today, customFrom, customTo);

  useEffect(() => {
    loadReferenceData();
    loadTimers();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [rangeFrom, rangeTo]);

  // Re-render the running clock every second (elapsed is computed from the server start time)
  useEffect(() => {
    if (!myTimer && activeTimers.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [myTimer, activeTimers.length]);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4500);
  }

  async function loadReferenceData() {
    const [cRes, tRes, pRes] = await Promise.all([
      supabase.from("clients").select("id, name, organization_name, pan, gstin, phone, status").order("name", { ascending: true }),
      supabase.from("tasks").select("id, title, client_id, stage, assigned_to, reviewer_id").order("title", { ascending: true }),
      supabase.from("profiles").select("id, name, is_active").order("name", { ascending: true }),
    ]);
    if (cRes.data) setClients(cRes.data);
    if (tRes.data) setTasks(tRes.data);
    if (pRes.data) setTeam(pRes.data);
  }

  async function loadLogs(showSpinner = true) {
    if (showSpinner) setLoading(true);
    let query = supabase
      .from("time_logs")
      .select("*")
      .gte("log_date", rangeFrom)
      .lte("log_date", rangeTo)
      .order("log_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (!isAdmin) query = query.eq("user_id", me);

    const { data, error } = await query;
    if (error) showToast("error", "Could not load time logs. Please refresh the page.");
    setLogs(data || []);
    setLoading(false);
  }

  async function loadTimers() {
    const { data } = await supabase.from("time_timers").select("*");
    const rows = data || [];
    setActiveTimers(rows);
    const mine = rows.find((t: any) => t.user_id === me) || null;
    setMyTimer(mine);
    if (mine) {
      setTimerDescription(mine.description || "");
      setTimerClientId(mine.client_id || "");
      setTimerTaskId(mine.task_id || "");
    }
  }

  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [String(c.id), c])), [clients]);
  const taskById = useMemo(() => Object.fromEntries(tasks.map((t) => [String(t.id), t])), [tasks]);
  const nameOf = (id?: string) => team.find((t) => String(t.id) === String(id))?.name || "";

  // Open tasks the user can log against
  const taskOptions = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.stage !== "Approved" && (isAdmin || t.assigned_to === me || t.reviewer_id === me)
      ),
    [tasks, isAdmin, me]
  );

  /* ---------------- Timer ---------------- */

  const elapsedSeconds = myTimer
    ? ((myTimer.paused_at ? new Date(myTimer.paused_at).getTime() : now) - new Date(myTimer.started_at).getTime()) / 1000 - Number(myTimer.paused_seconds || 0)
    : 0;

  function handleTimerTask(id: string) {
    setTimerTaskId(id);
    const t = taskById[id];
    if (t?.client_id) setTimerClientId(t.client_id);
    if (t && !timerDescription.trim()) setTimerDescription(t.title);
  }

  async function handleStartTimer() {
    if (!timerDescription.trim()) return showToast("error", "Please describe what you are working on.");
    if (!timerClientId && !timerTaskId) return showToast("error", "Please select a client or a task.");
    setTimerBusy(true);
    const { error } = await supabase.from("time_timers").insert([
      {
        user_id: me,
        description: timerDescription.trim(),
        client_id: timerClientId || null,
        task_id: timerTaskId || null,
      },
    ]);
    setTimerBusy(false);
    if (error) {
      showToast("error", error.code === "23505" ? "You already have a timer running." : error.message);
      loadTimers();
      return;
    }
    setNow(Date.now());
    loadTimers();
  }

  async function handleStopTimer() {
    setTimerBusy(true);
    const { data, error } = await supabase.rpc("stop_time_timer", { p_billable: timerBillable });
    setTimerBusy(false);
    if (error) return showToast("error", error.message);

    if (data) {
      logAuditEvent("CREATE_TIME_LOG", "TIME_LOGS", data as string, {
        source: "timer",
        duration: formatTimerDisplay(elapsedSeconds),
      });
      showToast("success", `Saved ${formatHours(elapsedSeconds / 3600)} to your timesheet.`);
    } else {
      showToast("success", "Timer stopped. Under a minute, so nothing was saved.");
    }
    setMyTimer(null);
    setTimerDescription("");
    setTimerClientId("");
    setTimerTaskId("");
    loadTimers();
    loadLogs(false);
  }

  async function handleDiscardTimer() {
    setTimerBusy(true);
    const { error } = await supabase.from("time_timers").delete().eq("user_id", me);
    setTimerBusy(false);
    setConfirmDiscard(false);
    if (error) return showToast("error", error.message);
    setMyTimer(null);
    setTimerDescription("");
    setTimerClientId("");
    setTimerTaskId("");
    showToast("success", "Timer discarded.");
    loadTimers();
  }

  /* ---------------- Manual entry / edit ---------------- */

  function canModify(log: any): boolean {
    if (isAdmin) return true;
    return log.user_id === me && String(log.log_date) >= lockDate;
  }

  function openModal(log?: any) {
    setFormError("");
    if (log) {
      setEditingLog(log);
      setDescription(log.description || "");
      setClientId(log.client_id || "");
      setTaskId(log.task_id || "");
      const totalMins = Math.round(Number(log.hours || 0) * 60);
      setHours(String(Math.floor(totalMins / 60)));
      setMinutes(String(totalMins % 60));
      setLogDate(String(log.log_date).slice(0, 10));
      setIsBillable(log.is_billable !== false);
    } else {
      setEditingLog(null);
      setDescription("");
      setClientId("");
      setTaskId("");
      setHours("");
      setMinutes("");
      setLogDate(today);
      setIsBillable(true);
    }
    setIsModalOpen(true);
  }

  function handleTaskChange(id: string) {
    setTaskId(id);
    const t = taskById[id];
    if (t?.client_id) setClientId(t.client_id);
    if (t && !description.trim()) setDescription(t.title);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setFormError("");

    const total = Number(hours || 0) + Number(minutes || 0) / 60;
    if (!description.trim()) return setFormError("Please describe the work done.");
    if (!(total > 0) || total > 24) return setFormError("Enter between 1 minute and 24 hours.");
    if (logDate > today) return setFormError("Time cannot be logged for a future date.");
    if (!isAdmin && logDate < lockDate) return setFormError(`Entries older than ${LOCK_DAYS} days are locked. Please ask an administrator.`);

    const payload = {
      client_id: clientId || null,
      task_id: taskId || null,
      description: description.trim(),
      hours: Math.round(total * 100) / 100,
      log_date: logDate,
      is_billable: isBillable,
    };

    setSaving(true);
    try {
      if (editingLog) {
        const { error } = await supabase.from("time_logs").update(payload).eq("id", editingLog.id);
        if (error) throw error;
        logAuditEvent("UPDATE_TIME_LOG", "TIME_LOGS", editingLog.id, payload);
        showToast("success", "Time entry updated.");
      } else {
        const { data, error } = await supabase
          .from("time_logs")
          .insert([{ ...payload, user_id: me }])
          .select()
          .single();
        if (error || !data) throw error || new Error("Could not save the entry.");
        logAuditEvent("CREATE_TIME_LOG", "TIME_LOGS", data.id, { ...payload, source: "manual" });
        showToast("success", `${formatHours(payload.hours)} logged for ${formatDate(logDate)}.`);
      }
      setIsModalOpen(false);
      setEditingLog(null);
      loadLogs(false);
    } catch (err: any) {
      setFormError(err?.message || "Could not save the entry.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setActionBusy(true);
    const { error } = await supabase.from("time_logs").delete().eq("id", deleteTarget.id);
    setActionBusy(false);
    if (error) {
      setDeleteTarget(null);
      return showToast("error", error.message);
    }
    logAuditEvent("DELETE_TIME_LOG", "TIME_LOGS", deleteTarget.id, {
      hours: deleteTarget.hours,
      log_date: deleteTarget.log_date,
    });
    setDeleteTarget(null);
    showToast("success", "Time entry deleted.");
    loadLogs(false);
  }

  /* ---------------- Filtering & analytics ---------------- */

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (filterUser && l.user_id !== filterUser) return false;
      if (filterClient && l.client_id !== filterClient) return false;
      if (filterBillable === "billable" && l.is_billable === false) return false;
      if (filterBillable === "non" && l.is_billable !== false) return false;
      if (!q) return true;
      return [l.description, nameOf(l.user_id), clientById[l.client_id]?.name, taskById[l.task_id]?.title]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q));
    });
  }, [logs, search, filterUser, filterClient, filterBillable, clientById, taskById, team]);

  const stats = useMemo(() => {
    const total = filteredLogs.reduce((s, l) => s + Number(l.hours || 0), 0);
    const billable = filteredLogs.filter((l) => l.is_billable !== false).reduce((s, l) => s + Number(l.hours || 0), 0);
    const days = new Set(filteredLogs.map((l) => `${l.user_id}|${l.log_date}`)).size;
    return {
      total,
      billable,
      ratio: total > 0 ? Math.round((billable / total) * 100) : 0,
      avgPerDay: days > 0 ? total / days : 0,
      entries: filteredLogs.length,
    };
  }, [filteredLogs]);

  const byClient = useMemo(() => {
    const map: Record<string, { name: string; hours: number; billable: number }> = {};
    filteredLogs.forEach((l) => {
      const key = l.client_id || "internal";
      if (!map[key]) map[key] = { name: clientLabel(clientById[l.client_id]) || "Internal / No client", hours: 0, billable: 0 };
      map[key].hours += Number(l.hours || 0);
      if (l.is_billable !== false) map[key].billable += Number(l.hours || 0);
    });
    return Object.values(map).sort((a, b) => b.hours - a.hours).slice(0, 6);
  }, [filteredLogs, clientById]);

  const byPerson = useMemo(() => {
    const map: Record<string, { id: string; hours: number; billable: number }> = {};
    filteredLogs.forEach((l) => {
      if (!map[l.user_id]) map[l.user_id] = { id: l.user_id, hours: 0, billable: 0 };
      map[l.user_id].hours += Number(l.hours || 0);
      if (l.is_billable !== false) map[l.user_id].billable += Number(l.hours || 0);
    });
    return Object.values(map).sort((a, b) => b.hours - a.hours);
  }, [filteredLogs]);

  // Weekly timesheet grid (only for the "This Week" period)
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(mondayOf(today), i)), [today]);
  const weekGrid = useMemo(() => {
    if (period !== "week") return [];
    const people = isAdmin ? Array.from(new Set(filteredLogs.map((l) => l.user_id))) : [me];
    return people.map((pid) => {
      const perDay = weekDays.map((d) =>
        filteredLogs.filter((l) => l.user_id === pid && String(l.log_date).slice(0, 10) === d).reduce((s, l) => s + Number(l.hours || 0), 0)
      );
      return { id: pid, perDay, total: perDay.reduce((a, b) => a + b, 0) };
    });
  }, [period, filteredLogs, weekDays, isAdmin, me]);

  const maxClientHours = Math.max(1, ...byClient.map((c) => c.hours));
  const maxPersonHours = Math.max(1, ...byPerson.map((p) => p.hours));

  function exportCSV() {
    const headers = ["Date", "Staff", "Client", "Task", "Description", "Hours", "Billable"];
    const lines = filteredLogs.map((l) =>
      [
        formatDate(l.log_date),
        nameOf(l.user_id),
        clientLabel(clientById[l.client_id]),
        taskById[l.task_id]?.title || "",
        l.description,
        Number(l.hours || 0).toFixed(2),
        l.is_billable === false ? "No" : "Yes",
      ]
        .map(csvCell)
        .join(",")
    );
    const blob = new Blob(["\uFEFF" + [headers.map(csvCell).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `finetax_timesheet_${rangeFrom}_to_${rangeTo}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const otherActiveTimers = activeTimers.filter((t) => t.user_id !== me);

  /* ---------------- Render ---------------- */

  return (
    <div className="space-y-6">
      {/* Live Work Timer */}
      <div className={`rounded-xl border p-5 shadow-sm ${myTimer ? "border-emerald-300 bg-emerald-50/40" : "border-border bg-surface"}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${myTimer ? "bg-emerald-600 text-white" : "bg-navy/10 text-navy"}`}>
              <Clock className={`h-5 w-5 ${myTimer ? "animate-pulse" : ""}`} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-main">{myTimer ? "Timer running" : "Live Work Timer"}</h3>
              <p className="text-[11px] text-text-muted">
                {myTimer
                  ? `Started ${new Date(myTimer.started_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}. Keeps running even if you close this page.`
                  : "Track time as you work. The timer runs on the server, so it survives refreshes and closed tabs."}
              </p>
            </div>
          </div>

          <div className="font-mono text-2xl font-bold tracking-tight text-navy">{formatTimerDisplay(elapsedSeconds)}</div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-12">
          <input
            type="text"
            placeholder="What are you working on?"
            value={timerDescription}
            onChange={(e) => setTimerDescription(e.target.value)}
            disabled={!!myTimer}
            maxLength={300}
            className={`${inputClass} md:col-span-4`}
          />
          <select value={timerTaskId} onChange={(e) => handleTimerTask(e.target.value)} disabled={!!myTimer} className={`${inputClass} md:col-span-3`}>
            <option value="">— Task (optional) —</option>
            {taskOptions.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
          <ClientPicker clients={clients as any} value={timerClientId} onChange={setTimerClientId} disabled={!!myTimer} noneLabel="No client" className="md:col-span-3" />
          {!myTimer ? (
            <button
              type="button"
              onClick={handleStartTimer}
              disabled={timerBusy}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60 md:col-span-2"
            >
              {timerBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start
            </button>
          ) : (
            <div className="flex gap-2 md:col-span-2">
              <button
                type="button"
                onClick={handleStopTimer}
                disabled={timerBusy}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-60"
              >
                {timerBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} Stop & Save
              </button>
              <button
                type="button"
                onClick={() => setConfirmDiscard(true)}
                disabled={timerBusy}
                className="rounded-lg border border-border px-2 text-text-muted transition hover:bg-surface-alt"
                title="Discard timer"
                aria-label="Discard timer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        {myTimer && (
          <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-text-muted">
            <input type="checkbox" checked={timerBillable} onChange={(e) => setTimerBillable(e.target.checked)} className="accent-navy" />
            Save as billable work
          </label>
        )}

        {isAdmin && otherActiveTimers.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-text-main">
              <Timer className="h-3.5 w-3.5 text-emerald-600" /> Clocked in right now
            </p>
            <div className="flex flex-wrap gap-2">
              {otherActiveTimers.map((t) => (
                <span key={t.user_id} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  <span className="font-semibold text-emerald-800">{nameOf(t.user_id) || "Staff"}</span>
                  <span className="text-emerald-700">
                    {formatTimerDisplay((now - new Date(t.started_at).getTime()) / 1000)} · {t.description}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Period + actions */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-alt p-0.5 text-xs font-semibold">
          {(
            [
              { key: "today", label: "Today" },
              { key: "week", label: "This Week" },
              { key: "month", label: "This Month" },
              { key: "lastMonth", label: "Last Month" },
              { key: "custom", label: "Custom" },
            ] as { key: Period; label: string }[]
          ).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={`rounded-md px-2.5 py-1.5 transition ${period === p.key ? "bg-surface text-navy shadow-sm" : "text-text-muted hover:text-text-main"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex items-center gap-2 text-xs">
            <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className={`${inputClass} w-auto py-1.5`} />
            <span className="text-text-muted">to</span>
            <input type="date" value={customTo} min={customFrom} max={today} onChange={(e) => setCustomTo(e.target.value)} className={`${inputClass} w-auto py-1.5`} />
          </div>
        )}
        <span className="flex items-center gap-1 text-[11px] text-text-muted">
          <Calendar className="h-3.5 w-3.5" /> {formatDate(rangeFrom)} – {formatDate(rangeTo)}
        </span>
        <div className="flex gap-2 lg:ml-auto">
          <button
            type="button"
            onClick={exportCSV}
            disabled={filteredLogs.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt disabled:opacity-50"
          >
            <Download className="h-4 w-4 text-navy" /> Export
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("finetax:open-day-review"))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Review my day
          </button>
          <button
            type="button"
            onClick={() => openModal()}
            className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light"
          >
            <Plus className="h-4 w-4" /> Manual Entry
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          { label: "Total Hours", value: formatHours(stats.total), sub: `${stats.entries} entries`, icon: Clock, style: "bg-navy/10 text-navy", valueClass: "text-navy" },
          { label: "Billable Hours", value: formatHours(stats.billable), sub: `${formatHours(stats.total - stats.billable)} non-billable`, icon: CheckCircle2, style: "bg-emerald-50 text-emerald-600", valueClass: "text-emerald-700" },
          { label: "Billable Ratio", value: `${stats.ratio}%`, sub: "Of all logged time", icon: TrendingUp, style: "bg-violet-50 text-violet-600", valueClass: "text-violet-700" },
          { label: "Avg per Working Day", value: formatHours(stats.avgPerDay), sub: "Per person per day logged", icon: User, style: "bg-amber-50 text-amber-600", valueClass: "text-amber-700" },
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

      {/* Weekly timesheet grid */}
      {period === "week" && weekGrid.length > 0 && (
        <div className="rounded-xl border border-border bg-surface shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-text-main">
              <Calendar className="h-4 w-4 text-navy" /> Weekly Timesheet
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Team Member</th>
                  {weekDays.map((d) => (
                    <th key={d} className={`text-center ${d === today ? "text-navy" : ""}`}>
                      {new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" })}
                      <span className="block text-[10px] font-normal normal-case">{formatDate(d).slice(0, 5)}</span>
                    </th>
                  ))}
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {weekGrid.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap font-semibold text-navy">{nameOf(row.id) || "—"}</td>
                    {row.perDay.map((h, i) => (
                      <td
                        key={i}
                        className={`text-center ${h === 0 ? "text-text-muted" : h > 10 ? "font-semibold text-rose-600" : "font-medium text-text-main"} ${
                          weekDays[i] === today ? "bg-navy/5" : ""
                        }`}
                      >
                        {h ? formatHours(h) : "—"}
                      </td>
                    ))}
                    <td className="whitespace-nowrap text-right font-bold text-navy">{formatHours(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isAdmin && <AttendancePanel from={rangeFrom} to={rangeTo} team={team} />}

      {/* Breakdown panels */}
      {filteredLogs.length > 0 && (
        <div className={`grid grid-cols-1 gap-6 ${isAdmin ? "lg:grid-cols-2" : ""}`}>
          <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-text-main">
              <TrendingUp className="h-3.5 w-3.5 text-navy" /> Hours by Client
            </p>
            <div className="space-y-2.5">
              {byClient.map((c) => (
                <div key={c.name}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="truncate font-medium text-text-main">{c.name}</span>
                    <span className="shrink-0 text-text-muted">
                      <span className="font-semibold text-text-main">{formatHours(c.hours)}</span> · {formatHours(c.billable)} billable
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
                    <div className="h-full rounded-full bg-navy" style={{ width: `${(c.hours / maxClientHours) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {isAdmin && (
            <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-text-main">
                <Users className="h-3.5 w-3.5 text-navy" /> Hours by Team Member
              </p>
              <div className="space-y-2.5">
                {byPerson.map((p) => (
                  <button key={p.id} type="button" onClick={() => setFilterUser(filterUser === p.id ? "" : p.id)} className="block w-full text-left">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className={`flex items-center gap-1.5 font-medium ${filterUser === p.id ? "text-navy" : "text-text-main"}`}>
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-navy/10 text-[8px] font-bold text-navy">{getInitials(nameOf(p.id))}</span>
                        {nameOf(p.id) || "—"}
                      </span>
                      <span className="text-text-muted">
                        <span className="font-semibold text-text-main">{formatHours(p.hours)}</span> · {p.hours > 0 ? Math.round((p.billable / p.hours) * 100) : 0}% billable
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(p.hours / maxPersonHours) * 100}%` }} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Log sheet */}
      <div className="rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-col gap-2 border-b border-border p-4 lg:flex-row lg:items-center">
          <div className="relative w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search description, client, task..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
                <option value="">All team members</option>
                {team.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
            <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)} className="max-w-[180px] rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
              <option value="">All clients</option>
              {sortByLabel(clients.filter((c) => c.status !== "Merged")).map((c) => (
                <option key={c.id} value={c.id}>{clientLabel(c)}</option>
              ))}
            </select>
            <select value={filterBillable} onChange={(e) => setFilterBillable(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
              <option value="">Billable & non-billable</option>
              <option value="billable">Billable only</option>
              <option value="non">Non-billable only</option>
            </select>
          </div>
          {!isAdmin && (
            <span className="flex items-center gap-1 text-[10px] text-text-muted lg:ml-auto">
              <Lock className="h-3 w-3" /> Entries older than {LOCK_DAYS} days are locked
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading office log sheet...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Clock className="h-6 w-6 text-text-muted" />
            <p className="text-xs text-text-muted">No time logged in this period.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Date</th>
                  {isAdmin && <th>Staff Member</th>}
                  <th>Client</th>
                  <th>Task / Description</th>
                  <th className="text-right">Time</th>
                  <th>Billable</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const editable = canModify(log);
                  return (
                    <tr key={log.id} className="transition hover:bg-surface-alt">
                      <td className="whitespace-nowrap font-medium">{formatDate(log.log_date)}</td>
                      {isAdmin && <td className="whitespace-nowrap font-semibold text-navy">{nameOf(log.user_id) || "Staff"}</td>}
                      <td>{clientLabel(clientById[log.client_id]) || <span className="text-text-muted">Internal</span>}</td>
                      <td className="max-w-md">
                        <p className="font-medium text-text-main">
                          {log.description}
                          {log.source && log.source !== "manual" && (
                            <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-700">{log.source === "auto" ? "Auto" : "Timer"}</span>
                          )}
                          {log.edited_at && <span className="ml-1 rounded bg-surface-alt px-1.5 py-0.5 text-[9px] font-bold uppercase text-text-muted">Edited</span>}
                          {log.needs_review && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700">Check</span>}
                        </p>
                        {taskById[log.task_id]?.title && <p className="text-[10px] text-text-muted">Task: {taskById[log.task_id].title}</p>}
                      </td>
                      <td className="whitespace-nowrap text-right font-bold text-text-main">{formatHours(Number(log.hours))}</td>
                      <td>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            log.is_billable !== false ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-surface-alt text-text-muted"
                          }`}
                        >
                          {log.is_billable !== false ? "Billable" : "Non-billable"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-right">
                        {editable ? (
                          <div className="inline-flex gap-1">
                            <button type="button" onClick={() => openModal(log)} className="rounded-md p-1.5 text-navy transition hover:bg-surface-alt" title="Edit entry" aria-label="Edit entry">
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={() => setDeleteTarget(log)} className="rounded-md p-1.5 text-rose-600 transition hover:bg-rose-50" title="Delete entry" aria-label="Delete entry">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <Lock className="ml-auto h-3.5 w-3.5 text-text-muted" aria-label="Locked" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ================= Manual Entry / Edit ================= */}
      {isModalOpen && (
        <Modal
          title={editingLog ? "Edit Time Entry" : "Manual Time Entry"}
          subtitle={isAdmin ? "Administrators can correct entries of any date." : `You can log time for the last ${LOCK_DAYS} days.`}
          onClose={() => !saving && setIsModalOpen(false)}
          maxWidth="max-w-md"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsModalOpen(false)} disabled={saving} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Cancel
              </button>
              <button
                type="submit"
                form="time-form"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingLog ? "Save Changes" : "Save Entry"}
              </button>
            </div>
          }
        >
          <form id="time-form" onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs font-medium text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label className={labelClass}>Task</label>
              <select value={taskId} onChange={(e) => handleTaskChange(e.target.value)} className={inputClass}>
                <option value="">— Optional —</option>
                {(taskId && !taskOptions.some((t) => t.id === taskId) && taskById[taskId] ? [taskById[taskId], ...taskOptions] : taskOptions).map((t: any) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Client</label>
              <ClientPicker clients={clients as any} value={clientId} onChange={setClientId} noneLabel="Internal / No client" />
            </div>

            <div>
              <label className={labelClass}>Description *</label>
              <textarea required rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} placeholder="Summarise work completed..." />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Hours</label>
                <input type="number" min="0" max="24" step="1" value={hours} onChange={(e) => setHours(e.target.value)} className={inputClass} placeholder="0" />
              </div>
              <div>
                <label className={labelClass}>Minutes</label>
                <input type="number" min="0" max="59" step="5" value={minutes} onChange={(e) => setMinutes(e.target.value)} className={inputClass} placeholder="0" />
              </div>
              <div>
                <label className={labelClass}>Date</label>
                <input
                  type="date"
                  required
                  max={today}
                  min={isAdmin ? undefined : lockDate}
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-text-main">
              <input type="checkbox" checked={isBillable} onChange={(e) => setIsBillable(e.target.checked)} className="h-4 w-4 accent-navy" />
              Billable work
            </label>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this time entry?"
          message={`${formatHours(Number(deleteTarget.hours))} on ${formatDate(deleteTarget.log_date)}: "${deleteTarget.description}"`}
          confirmLabel="Delete entry"
          tone="danger"
          loading={actionBusy}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard the running timer?"
          message={`${formatTimerDisplay(elapsedSeconds)} of tracked time will be thrown away and not saved.`}
          confirmLabel="Discard timer"
          tone="danger"
          loading={timerBusy}
          onConfirm={handleDiscardTimer}
          onCancel={() => setConfirmDiscard(false)}
        />
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