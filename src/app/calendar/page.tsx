"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Plus,
  Filter,
  X,
  CheckSquare,
  Clock,
  ArrowRight,
  Edit2,
  Trash2,
  Loader2,
  CheckCircle2,
  List,
  LayoutGrid,
  Users,
  Search,
  RefreshCw,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { clientLabel, sortByLabel } from "@/components/ui/ClientPicker";
import { useTaskCategories } from "@/components/tasks/TaskCategories";
import { formatDate, localISODate } from "@/lib/format";

const CATEGORIES = ["GST", "Income Tax", "TDS", "ROC", "Audit", "Accounting", "Payroll", "Other"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const STAGE_STYLES: Record<string, string> = {
  Assigned: "bg-slate-100 text-slate-700 border-slate-200",
  "In Progress": "bg-blue-50 text-blue-700 border-blue-200",
  "Submitted for Review": "bg-violet-50 text-violet-700 border-violet-200",
  "Changes Required": "bg-amber-50 text-amber-700 border-amber-200",
  Approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

type DayItem =
  | { kind: "event"; id: string; title: string; category: string; data: any }
  | { kind: "statutory"; id: string; title: string; category: string; data: any }
  | { kind: "internal"; id: string; title: string; category: string; data: any };

/* ---------------- Helpers ---------------- */

function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return localISODate(new Date(target.getFullYear(), target.getMonth(), Math.min(d, lastDay)));
}
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localISODate(new Date(y, m - 1, d + days));
}
function longDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${d.toLocaleDateString("en-IN", { weekday: "long" })}, ${formatDate(iso)}`;
}

/* ---------------- Page ---------------- */

export default function ComplianceCalendarPage() {
  const currentUser = useCurrentUser();
  const me = currentUser?.id || "";
  const isAdmin = !!currentUser?.isAdmin;
  const [supabase] = useState(() => createClient());
  // Editable categories (replaces the fixed list inside this page)
  const { activeNames: CATEGORIES } = useTaskCategories();

  const today = localISODate();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [statutoryEvents, setStatutoryEvents] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [viewType, setViewType] = useState<"all" | "statutory" | "tasks">("all");
  const [scope, setScope] = useState<"mine" | "all">(isAdmin ? "all" : "mine");
  const [layout, setLayout] = useState<"month" | "list">("month");

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Day Agenda Drawer
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(null);

  // Event modal
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("GST");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [repeat, setRepeat] = useState<"none" | "monthly" | "quarterly">("none");
  const [repeatCount, setRepeatCount] = useState(12);
  const [eventSaving, setEventSaving] = useState(false);
  const [eventError, setEventError] = useState("");
  const [deleteEvent, setDeleteEvent] = useState<any | null>(null);

  // Generate client tasks modal
  const [genEvent, setGenEvent] = useState<any | null>(null);
  const [genClients, setGenClients] = useState<Set<string>>(new Set());
  const [genSearch, setGenSearch] = useState("");
  const [genTitle, setGenTitle] = useState("");
  const [genBuffer, setGenBuffer] = useState(3);
  const [genAssignMode, setGenAssignMode] = useState<"rm" | "fixed">("rm");
  const [genAssignee, setGenAssignee] = useState("");
  const [genReviewer, setGenReviewer] = useState("");
  const [genPriority, setGenPriority] = useState("Medium");
  const [genSaving, setGenSaving] = useState(false);
  const [genError, setGenError] = useState("");

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthStartISO = localISODate(new Date(year, month, 1));
  const monthEndISO = localISODate(new Date(year, month + 1, 0));

  useEffect(() => {
    loadReference();
  }, []);

  useEffect(() => {
    loadCalendarData();
  }, [monthStartISO, scope]);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 5000);
  }

  async function loadReference() {
    const [cRes, pRes] = await Promise.all([
      supabase.from("clients").select("id, name, organization_name, pan, gstin, phone, status, assigned_to").order("name", { ascending: true }),
      supabase.from("profiles").select("id, name, role, is_active, is_reviewer").order("name", { ascending: true }),
    ]);
    setClients(cRes.data || []);
    setTeam(pRes.data || []);
  }

  async function loadCalendarData() {
    setLoading(true);
    const range = `and(due_date.gte.${monthStartISO},due_date.lte.${monthEndISO}),and(official_due_date.gte.${monthStartISO},official_due_date.lte.${monthEndISO})`;
    let taskQuery = supabase
      .from("tasks")
      .select("id, title, category, client_id, assigned_to, reviewer_id, stage, due_date, official_due_date, recurrence, priority")
      .or(range);
    if (scope === "mine") taskQuery = taskQuery.or(`assigned_to.eq.${me},reviewer_id.eq.${me}`);

    const [eRes, tRes] = await Promise.all([
      supabase.from("compliance_events").select("*").gte("due_date", monthStartISO).lte("due_date", monthEndISO).order("due_date", { ascending: true }),
      taskQuery,
    ]);

    if (eRes.error || tRes.error) showToast("error", "Could not load the calendar. Please refresh the page.");
    setStatutoryEvents(eRes.data || []);
    setTasks(tRes.data || []);
    setLoading(false);
  }

  const clientName = (id?: string) => clientLabel(clients.find((c) => c.id === id));
  const teamName = (id?: string) => team.find((t) => t.id === id)?.name || "";
  const activeTeam = team.filter((t) => t.is_active !== false);
  const reviewers = activeTeam.filter((t) => t.role === "admin" || t.role === "reviewer" || t.is_reviewer);

  /* ---------------- Build day buckets ---------------- */

  const dayMap = useMemo(() => {
    const map: Record<string, DayItem[]> = {};
    const push = (date: string | null | undefined, item: DayItem) => {
      if (!date) return;
      const key = String(date).slice(0, 10);
      (map[key] = map[key] || []).push(item);
    };
    const catOk = (c?: string) => categoryFilter === "all" || (c || "Other") === categoryFilter;

    if (viewType !== "tasks") {
      statutoryEvents.filter((e) => catOk(e.category)).forEach((e) => push(e.due_date, { kind: "event", id: `e-${e.id}`, title: e.title, category: e.category, data: e }));
      tasks
        .filter((t) => catOk(t.category) && t.official_due_date)
        .forEach((t) => push(t.official_due_date, { kind: "statutory", id: `s-${t.id}`, title: t.title, category: t.category, data: t }));
    }
    if (viewType !== "statutory") {
      tasks.filter((t) => catOk(t.category) && t.due_date).forEach((t) => push(t.due_date, { kind: "internal", id: `i-${t.id}`, title: t.title, category: t.category, data: t }));
    }
    return map;
  }, [statutoryEvents, tasks, categoryFilter, viewType]);

  const monthStats = useMemo(() => {
    const open = tasks.filter((t) => t.stage !== "Approved");
    return {
      events: statutoryEvents.length,
      statutoryOpen: open.filter((t) => t.official_due_date && t.official_due_date >= monthStartISO && t.official_due_date <= monthEndISO).length,
      overdue: open.filter((t) => t.due_date && t.due_date < today && t.due_date >= monthStartISO).length,
      done: tasks.filter((t) => t.stage === "Approved").length,
    };
  }, [tasks, statutoryEvents, today, monthStartISO, monthEndISO]);

  const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  /* ---------------- Event CRUD (admin) ---------------- */

  function openEventModal(ev?: any, presetDate?: string) {
    setEventError("");
    setRepeat("none");
    setRepeatCount(12);
    if (ev) {
      setEditingEvent(ev);
      setTitle(ev.title || "");
      setCategory(ev.category || "GST");
      setDueDate(String(ev.due_date).slice(0, 10));
      setDescription(ev.description || "");
    } else {
      setEditingEvent(null);
      setTitle("");
      setCategory("GST");
      setDueDate(presetDate || today);
      setDescription("");
    }
    setEventModalOpen(true);
  }

  async function saveEvent(e: React.FormEvent) {
    e.preventDefault();
    if (eventSaving) return;
    setEventError("");
    if (!title.trim()) return setEventError("Title is required.");
    if (!dueDate) return setEventError("Due date is required.");

    setEventSaving(true);
    try {
      if (editingEvent) {
        const { error } = await supabase
          .from("compliance_events")
          .update({ title: title.trim(), category, due_date: dueDate, description: description.trim() })
          .eq("id", editingEvent.id);
        if (error) throw error;
        logAuditEvent("UPDATE_COMPLIANCE_EVENT", "COMPLIANCE_EVENTS", editingEvent.id, { title: title.trim(), due_date: dueDate });
        showToast("success", "Statutory deadline updated.");
      } else {
        const step = repeat === "monthly" ? 1 : repeat === "quarterly" ? 3 : 0;
        const count = step ? Math.min(36, Math.max(1, repeatCount)) : 1;
        const rows = Array.from({ length: count }, (_, i) => ({
          title: title.trim(),
          category,
          due_date: step ? addMonthsClamped(dueDate, i * step) : dueDate,
          description: description.trim(),
        }));
        const { error } = await supabase.from("compliance_events").insert(rows);
        if (error) throw error;
        logAuditEvent("CREATE_COMPLIANCE_EVENT", "COMPLIANCE_EVENTS", undefined, { title: title.trim(), first_due: dueDate, occurrences: count });
        showToast("success", count > 1 ? `${count} statutory deadlines added.` : "Statutory deadline added.");
      }
      setEventModalOpen(false);
      loadCalendarData();
    } catch (err: any) {
      setEventError(err?.message || "Could not save the deadline.");
    } finally {
      setEventSaving(false);
    }
  }

  async function confirmDeleteEvent() {
    if (!deleteEvent) return;
    const { error } = await supabase.from("compliance_events").delete().eq("id", deleteEvent.id);
    if (error) {
      setDeleteEvent(null);
      return showToast("error", error.message);
    }
    logAuditEvent("DELETE_COMPLIANCE_EVENT", "COMPLIANCE_EVENTS", deleteEvent.id, { title: deleteEvent.title });
    setDeleteEvent(null);
    showToast("success", "Statutory deadline removed.");
    loadCalendarData();
  }

  /* ---------------- Generate client tasks from an event (admin) ---------------- */

  function openGenerate(ev: any) {
    setGenEvent(ev);
    setGenTitle(ev.title);
    setGenClients(new Set());
    setGenSearch("");
    setGenBuffer(3);
    setGenAssignMode("rm");
    setGenAssignee("");
    setGenReviewer("");
    setGenPriority("Medium");
    setGenError("");
  }

  const activeClients = sortByLabel(clients.filter((c) => c.status !== "Inactive" && c.status !== "Merged"));
  const genVisibleClients = activeClients.filter(
    (c) => !genSearch || `${clientLabel(c)} ${c.gstin || ""} ${c.pan || ""}`.toLowerCase().includes(genSearch.toLowerCase())
  );

  function toggleGenClient(id: string) {
    setGenClients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generateTasks() {
    if (!genEvent || genSaving) return;
    setGenError("");
    if (genClients.size === 0) return setGenError("Select at least one client.");
    if (!genTitle.trim()) return setGenError("Task title is required.");
    if (genAssignMode === "fixed" && !genAssignee) return setGenError("Choose who the tasks are assigned to.");

    const statutory = String(genEvent.due_date).slice(0, 10);
    const internal = addDays(statutory, -Math.max(0, genBuffer));

    setGenSaving(true);
    try {
      // Skip clients that already have this task for this statutory date
      const { data: existing } = await supabase
        .from("tasks")
        .select("client_id")
        .eq("official_due_date", statutory)
        .eq("title", genTitle.trim())
        .in("client_id", Array.from(genClients));
      const already = new Set((existing || []).map((t: any) => t.client_id));

      let reviewerCleared = 0;
      const rows = Array.from(genClients)
        .filter((id) => !already.has(id))
        .map((id) => {
          const client = clients.find((c) => c.id === id);
          const assignee = genAssignMode === "rm" ? client?.assigned_to || null : genAssignee;
          let reviewer: string | null = genReviewer || null;
          if (reviewer && reviewer === assignee) {
            reviewer = null; // maker-checker: reviewer must differ from assignee
            reviewerCleared++;
          }
          return {
            title: genTitle.trim(),
            client_id: id,
            category: genEvent.category || "Other",
            due_date: internal,
            official_due_date: statutory,
            assigned_to: assignee,
            reviewer_id: reviewer,
            priority: genPriority,
            stage: "Assigned",
            recurrence: "None",
            notes: genEvent.description || "",
          };
        });

      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await supabase.from("tasks").insert(rows.slice(i, i + 100));
        if (error) throw new Error(`Created ${i} tasks, then stopped: ${error.message}`);
      }

      logAuditEvent("GENERATE_TASKS_FROM_EVENT", "COMPLIANCE_EVENTS", genEvent.id, {
        title: genTitle.trim(),
        created: rows.length,
        skipped: already.size,
        statutory_date: statutory,
      });

      const unassigned = rows.filter((r) => !r.assigned_to).length;
      showToast(
        "success",
        `${rows.length} task${rows.length === 1 ? "" : "s"} created${already.size ? `, ${already.size} skipped (already existed)` : ""}.${
          unassigned ? ` ${unassigned} have no relationship manager and are unassigned.` : ""
        }${reviewerCleared ? ` Reviewer left blank on ${reviewerCleared} (same person as assignee).` : ""}`
      );
      setGenEvent(null);
      loadCalendarData();
    } catch (err: any) {
      setGenError(err?.message || "Could not create the tasks.");
    } finally {
      setGenSaving(false);
    }
  }

  /* ---------------- Render helpers ---------------- */

  function chipClass(item: DayItem): string {
    if (item.kind === "event") return "border-rose-200 bg-rose-50 text-rose-800 font-semibold";
    const t = item.data;
    if (t.stage === "Approved") return "border-emerald-200 bg-emerald-50 text-emerald-700 line-through opacity-70";
    const date = item.kind === "statutory" ? t.official_due_date : t.due_date;
    if (date < today) return "border-rose-300 bg-rose-100 text-rose-700 font-semibold";
    if (item.kind === "statutory") return "border-amber-200 bg-amber-50 text-amber-800";
    return "border-blue-200 bg-blue-50 text-navy";
  }

  function chipPrefix(item: DayItem): string {
    if (item.kind === "event") return "📌";
    if (item.kind === "statutory") return "⚑";
    return "✓";
  }

  const selectedItems = selectedDayDate ? dayMap[selectedDayDate] || [] : [];
  const dayEvents = selectedItems.filter((i) => i.kind === "event");
  const dayStatutory = selectedItems.filter((i) => i.kind === "statutory");
  const dayInternal = selectedItems.filter((i) => i.kind === "internal");

  function TaskRow({ item }: { item: DayItem }) {
    const t = item.data;
    return (
      <div className="space-y-1 rounded-lg border border-border bg-surface p-3">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-semibold text-navy">{t.title}</span>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STAGE_STYLES[t.stage] || STAGE_STYLES.Assigned}`}>{t.stage}</span>
        </div>
        <p className="text-[11px] text-text-muted">
          {clientName(t.client_id) || "Internal"} · {teamName(t.assigned_to) || "Unassigned"}
        </p>
        <p className="text-[10px] text-text-muted">
          Internal {t.due_date ? formatDate(t.due_date) : "—"} · Statutory {t.official_due_date ? formatDate(t.official_due_date) : "—"}
          {t.recurrence && t.recurrence !== "None" && <span className="ml-1 font-semibold text-accent">↻ {t.recurrence}</span>}
        </p>
      </div>
    );
  }

  const listDays = Object.keys(dayMap).sort();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm lg:flex-row lg:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <CalendarIcon className="h-5 w-5 text-navy" /> Compliance & Workload Calendar
          </h2>
          <p className="mt-1 text-xs text-text-muted">Statutory due dates, task deadlines and team workload in one view.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs">
            <Filter className="h-3.5 w-3.5 text-text-muted" />
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="bg-transparent font-medium focus:outline-none">
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <select value={viewType} onChange={(e) => setViewType(e.target.value as any)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-semibold text-navy">
            <option value="all">All items</option>
            <option value="statutory">Statutory only</option>
            <option value="tasks">Internal deadlines only</option>
          </select>
          <div className="flex rounded-lg border border-border bg-surface-alt p-0.5 text-xs font-semibold">
            {(["mine", "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`rounded-md px-2.5 py-1 transition ${scope === s ? "bg-surface text-navy shadow-sm" : "text-text-muted"}`}
              >
                {s === "mine" ? "My tasks" : "All tasks"}
              </button>
            ))}
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => openEventModal()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light"
            >
              <Plus className="h-3.5 w-3.5" /> Add Statutory Deadline
            </button>
          )}
        </div>
      </div>

      {/* Month bar + stats */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setCursor(new Date(year, month - 1, 1))} className="rounded-lg border border-border p-1.5 text-navy transition hover:bg-surface-alt" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h3 className="min-w-[150px] text-center text-base font-bold text-navy">
            {MONTH_NAMES[month]} {year}
          </h3>
          <button type="button" onClick={() => setCursor(new Date(year, month + 1, 1))} className="rounded-lg border border-border p-1.5 text-navy transition hover:bg-surface-alt" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const n = new Date();
              setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
            }}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-navy transition hover:bg-surface-alt"
          >
            Today
          </button>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-text-muted" />}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-semibold text-rose-700">📌 {monthStats.events} statutory events</span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">⚑ {monthStats.statutoryOpen} open statutory deadlines</span>
          {monthStats.overdue > 0 && <span className="rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">{monthStats.overdue} overdue</span>}
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">{monthStats.done} completed</span>
          <div className="flex rounded-lg border border-border bg-surface-alt p-0.5 font-semibold">
            <button type="button" onClick={() => setLayout("month")} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${layout === "month" ? "bg-surface text-navy shadow-sm" : "text-text-muted"}`}>
              <LayoutGrid className="h-3.5 w-3.5" /> Month
            </button>
            <button type="button" onClick={() => setLayout("list")} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${layout === "list" ? "bg-surface text-navy shadow-sm" : "text-text-muted"}`}>
              <List className="h-3.5 w-3.5" /> List
            </button>
          </div>
        </div>
      </div>

      {layout === "month" ? (
        /* Month grid */
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-7 border-b border-border bg-surface-alt py-2 text-center text-[11px] font-bold uppercase tracking-wide text-text-muted">
              {WEEKDAYS.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 text-xs">
              {Array.from({ length: leadingBlanks }).map((_, i) => (
                <div key={`blank-${i}`} className="min-h-[112px] border-b border-r border-border bg-surface-alt/40" />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const dateStr = localISODate(new Date(year, month, i + 1));
                const items = dayMap[dateStr] || [];
                const isToday = dateStr === today;
                const visible = items.slice(0, 3);
                const hidden = items.length - visible.length;
                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => setSelectedDayDate(dateStr)}
                    className={`min-h-[112px] space-y-1 border-b border-r border-border p-1.5 text-left align-top transition ${isToday ? "bg-navy/5" : "hover:bg-surface-alt"}`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${isToday ? "bg-navy text-white" : "text-text-main"}`}>{i + 1}</span>
                      {items.length > 0 && <span className="rounded-full bg-surface-alt px-1.5 text-[9px] font-bold text-text-muted">{items.length}</span>}
                    </div>
                    {visible.map((item) => (
                      <div key={item.id} className={`truncate rounded border px-1 py-0.5 text-[10px] ${chipClass(item)}`} title={item.title}>
                        {chipPrefix(item)} {item.title}
                      </div>
                    ))}
                    {hidden > 0 && <div className="rounded bg-navy/10 py-0.5 text-center text-[9px] font-bold text-navy">+{hidden} more</div>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* List view */
        <div className="space-y-3">
          {listDays.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-10 text-center text-xs text-text-muted shadow-sm">Nothing scheduled this month.</div>
          ) : (
            listDays.map((d) => (
              <div key={d} className="rounded-xl border border-border bg-surface shadow-sm">
                <button type="button" onClick={() => setSelectedDayDate(d)} className="flex w-full items-center justify-between border-b border-border px-4 py-2.5 text-left">
                  <span className={`text-sm font-semibold ${d === today ? "text-navy" : d < today ? "text-text-muted" : "text-text-main"}`}>{longDate(d)}</span>
                  <span className="text-[11px] text-text-muted">{dayMap[d].length} item{dayMap[d].length === 1 ? "" : "s"}</span>
                </button>
                <div className="flex flex-wrap gap-1.5 p-3">
                  {dayMap[d].map((item) => (
                    <span key={item.id} className={`rounded border px-2 py-1 text-[11px] ${chipClass(item)}`}>
                      {chipPrefix(item)} {item.title}
                      {item.kind !== "event" && item.data.client_id && <span className="ml-1 opacity-70">· {clientName(item.data.client_id)}</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px] text-text-muted">
        <span>📌 Statutory event</span>
        <span>⚑ Task statutory deadline</span>
        <span>✓ Task internal deadline</span>
        <span className="text-rose-600">Red = overdue</span>
        <span className="text-emerald-700">Struck through = completed</span>
      </div>

      {/* ================= Day Agenda Drawer ================= */}
      {selectedDayDate && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 animate-fade-in" onClick={() => setSelectedDayDate(null)}>
          <div className="flex h-full w-full max-w-md flex-col bg-surface text-xs shadow-2xl animate-slide-in-right" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="flex items-center gap-2 text-base font-bold text-navy">
                  <Clock className="h-4 w-4" /> {longDate(selectedDayDate)}
                </h3>
                <p className="text-[11px] text-text-muted">{selectedItems.length} item{selectedItems.length === 1 ? "" : "s"} on this day</p>
              </div>
              <button type="button" onClick={() => setSelectedDayDate(null)} className="rounded-md p-1 text-text-muted transition hover:bg-surface-alt" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600">Statutory Events ({dayEvents.length})</span>
                  {isAdmin && (
                    <button type="button" onClick={() => openEventModal(undefined, selectedDayDate)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy hover:underline">
                      <Plus className="h-3 w-3" /> Add
                    </button>
                  )}
                </div>
                {dayEvents.length === 0 ? (
                  <p className="text-[11px] italic text-text-muted">No statutory events.</p>
                ) : (
                  dayEvents.map((item) => (
                    <div key={item.id} className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold">📌 {item.title}</p>
                        <span className="rounded bg-rose-200 px-1.5 py-0.5 text-[9px] font-bold uppercase">{item.category}</span>
                      </div>
                      {item.data.description && <p className="text-[11px]">{item.data.description}</p>}
                      {isAdmin && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={() => openGenerate(item.data)}
                            className="inline-flex items-center gap-1 rounded-md bg-navy px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-navy-light"
                          >
                            <Users className="h-3 w-3" /> Create client tasks
                          </button>
                          <button type="button" onClick={() => openEventModal(item.data)} className="inline-flex items-center gap-1 rounded-md border border-rose-300 px-2 py-1 text-[10px] font-semibold transition hover:bg-rose-100">
                            <Edit2 className="h-3 w-3" /> Edit
                          </button>
                          <button type="button" onClick={() => setDeleteEvent(item.data)} className="inline-flex items-center gap-1 rounded-md border border-rose-300 px-2 py-1 text-[10px] font-semibold transition hover:bg-rose-100">
                            <Trash2 className="h-3 w-3" /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Statutory Deadlines on Tasks ({dayStatutory.length})</span>
                {dayStatutory.length === 0 ? <p className="text-[11px] italic text-text-muted">None.</p> : dayStatutory.map((item) => <TaskRow key={item.id} item={item} />)}
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-navy">Internal Deadlines ({dayInternal.length})</span>
                {dayInternal.length === 0 ? <p className="text-[11px] italic text-text-muted">None.</p> : dayInternal.map((item) => <TaskRow key={item.id} item={item} />)}
              </div>
            </div>

            <div className="border-t border-border p-4">
              <Link href="/tasks" className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-navy py-2 text-xs font-bold text-white transition hover:bg-navy-light">
                <CheckSquare className="h-4 w-4" /> Open Task Board <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ================= Add / Edit Statutory Event ================= */}
      {eventModalOpen && (
        <Modal
          title={editingEvent ? "Edit Statutory Deadline" : "Add Statutory Deadline"}
          onClose={() => !eventSaving && setEventModalOpen(false)}
          maxWidth="max-w-md"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEventModalOpen(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Cancel
              </button>
              <button
                type="submit"
                form="event-form"
                disabled={eventSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
              >
                {eventSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
              </button>
            </div>
          }
        >
          <form id="event-form" onSubmit={saveEvent} className="space-y-4 text-xs">
            {eventError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 font-medium text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{eventError}</span>
              </div>
            )}
            <div>
              <label className={labelClass}>Title *</label>
              <input required value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="e.g. GSTR-3B (monthly)" maxLength={150} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Due Date *</label>
                <input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} placeholder="Filing instructions, applicable entities..." />
            </div>
            {!editingEvent && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-alt p-3">
                <div>
                  <label className={labelClass}>Repeat</label>
                  <select value={repeat} onChange={(e) => setRepeat(e.target.value as any)} className={inputClass}>
                    <option value="none">Does not repeat</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
                {repeat !== "none" && (
                  <div>
                    <label className={labelClass}>Occurrences</label>
                    <input type="number" min={2} max={36} value={repeatCount} onChange={(e) => setRepeatCount(Number(e.target.value))} className={inputClass} />
                  </div>
                )}
                {repeat !== "none" && (
                  <p className="col-span-2 flex items-center gap-1 text-[10px] text-text-muted">
                    <RefreshCw className="h-3 w-3" /> Creates {Math.min(36, Math.max(1, repeatCount))} dated entries. Month-end dates are adjusted automatically.
                  </p>
                )}
              </div>
            )}
          </form>
        </Modal>
      )}

      {/* ================= Create Client Tasks from Event ================= */}
      {genEvent && (
        <Modal
          title="Create client tasks"
          subtitle={`From "${genEvent.title}" · statutory due ${formatDate(String(genEvent.due_date).slice(0, 10))}`}
          onClose={() => !genSaving && setGenEvent(null)}
          maxWidth="max-w-2xl"
          footer={
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-text-muted">{genClients.size} client{genClients.size === 1 ? "" : "s"} selected</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setGenEvent(null)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={generateTasks}
                  disabled={genSaving || genClients.size === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
                >
                  {genSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create {genClients.size || ""} Tasks
                </button>
              </div>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            {genError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 font-medium text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{genError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelClass}>Task Title</label>
                <input value={genTitle} onChange={(e) => setGenTitle(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Internal Deadline</label>
                <select value={genBuffer} onChange={(e) => setGenBuffer(Number(e.target.value))} className={inputClass}>
                  {[0, 1, 2, 3, 5, 7, 10].map((d) => (
                    <option key={d} value={d}>
                      {d === 0 ? "Same day as statutory" : `${d} day${d === 1 ? "" : "s"} before`} ({formatDate(addDays(String(genEvent.due_date).slice(0, 10), -d))})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Priority</label>
                <select value={genPriority} onChange={(e) => setGenPriority(e.target.value)} className={inputClass}>
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Assign To</label>
                <select value={genAssignMode === "rm" ? "__rm" : genAssignee} onChange={(e) => {
                  if (e.target.value === "__rm") setGenAssignMode("rm");
                  else {
                    setGenAssignMode("fixed");
                    setGenAssignee(e.target.value);
                  }
                }} className={inputClass}>
                  <option value="__rm">Each client's relationship manager</option>
                  {activeTeam.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Reviewer</label>
                <select value={genReviewer} onChange={(e) => setGenReviewer(e.target.value)} className={inputClass}>
                  <option value="">— No reviewer —</option>
                  {reviewers.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                  <input value={genSearch} onChange={(e) => setGenSearch(e.target.value)} placeholder="Search clients..." className={`${inputClass} pl-8 py-1.5 text-xs`} />
                </div>
                <button type="button" onClick={() => setGenClients(new Set(activeClients.filter((c) => c.gstin).map((c) => c.id)))} className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-navy transition hover:bg-surface-alt">
                  All GST-registered
                </button>
                <button type="button" onClick={() => setGenClients(new Set(genVisibleClients.map((c) => c.id)))} className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-navy transition hover:bg-surface-alt">
                  Select shown
                </button>
                <button type="button" onClick={() => setGenClients(new Set())} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-text-muted transition hover:bg-surface-alt">
                  Clear
                </button>
              </div>
              <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {genVisibleClients.length === 0 ? (
                  <p className="p-4 text-center text-text-muted">No clients match.</p>
                ) : (
                  genVisibleClients.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 transition hover:bg-surface-alt">
                      <input type="checkbox" checked={genClients.has(c.id)} onChange={() => toggleGenClient(c.id)} className="h-4 w-4 accent-navy" />
                      <span className="flex-1 font-medium text-text-main">{clientLabel(c)}</span>
                      {c.gstin && <span className="font-mono text-[10px] text-text-muted">{c.gstin}</span>}
                      <span className="text-[10px] text-text-muted">{teamName(c.assigned_to) || "No RM"}</span>
                    </label>
                  ))
                )}
              </div>
              <p className="flex items-center gap-1 text-[10px] text-text-muted">
                <CheckCircle2 className="h-3 w-3" /> Clients that already have "{genTitle}" for this statutory date are skipped automatically.
              </p>
            </div>
          </div>
        </Modal>
      )}

      {deleteEvent && (
        <ConfirmDialog
          title="Delete this statutory deadline?"
          message={`"${deleteEvent.title}" on ${formatDate(String(deleteEvent.due_date).slice(0, 10))} will be removed from the calendar. Tasks already created from it are not affected.`}
          confirmLabel="Delete deadline"
          tone="danger"
          onConfirm={confirmDeleteEvent}
          onCancel={() => setDeleteEvent(null)}
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