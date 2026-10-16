"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Trash2,
  X,
  AlertCircle,
  RefreshCw,
  Clock,
  Activity,
  Lock,
  CheckCircle2,
  Loader2,
  LayoutGrid,
  List,
  CalendarClock,
  ShieldCheck,
  Play,
  Send,
  RotateCcw,
  Timer,
  CheckSquare,
  ListChecks,
  Edit2,
  GitMerge,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Task, Client, Profile, TaskStage, TaskCategory } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import ClientPicker, { clientLabel, sortByLabel } from "@/components/ui/ClientPicker";
import { formatDate, getInitials, localISODate } from "@/lib/format";

type TaskRow = Omit<Task, "category"> & Record<string, any>;
type ClientRow = Client & Record<string, any>;
type ProfileRow = Profile & Record<string, any>;
type TaskType = {
  id: string;
  name: string;
  category: string;
  default_recurrence: string;
  statutory_day: number | null;
  statutory_month_offset: number;
  internal_buffer_days: number;
  is_active: boolean;
};

const BASE_CATEGORIES: TaskCategory[] = ["GST", "Income Tax", "Audit", "ROC", "Other"];
const CATEGORIES: string[] = ["GST", "Income Tax", "TDS", "Audit", "ROC", "Accounting", "Payroll", ...BASE_CATEGORIES.filter((c) => c === "Other")];
const STAGES: TaskStage[] = ["Assigned", "In Progress", "Submitted for Review", "Changes Required", "Approved"];
const RECURRENCE_OPTIONS = ["None", "Weekly", "Monthly", "Quarterly", "Yearly"];
const PRIORITIES = ["Low", "Medium", "High"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STAGE_STYLES: Record<string, string> = {
  Assigned: "bg-slate-100 text-slate-700 border-slate-200",
  "In Progress": "bg-blue-50 text-blue-700 border-blue-200",
  "Submitted for Review": "bg-violet-50 text-violet-700 border-violet-200",
  "Changes Required": "bg-amber-50 text-amber-700 border-amber-200",
  Approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
};
const STAGE_DOTS: Record<string, string> = {
  Assigned: "bg-slate-400",
  "In Progress": "bg-blue-500",
  "Submitted for Review": "bg-violet-500",
  "Changes Required": "bg-amber-500",
  Approved: "bg-emerald-500",
};
const PRIORITY_DOTS: Record<string, string> = { High: "bg-rose-500", Medium: "bg-amber-400", Low: "bg-slate-300" };

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15 disabled:bg-surface-alt disabled:text-text-muted";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

/* ---------------- Helpers ---------------- */

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / 86400000);
}
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localISODate(new Date(y, m - 1, d + days));
}
function clampDate(y: number, monthIndex: number, day: number): string {
  const last = new Date(y, monthIndex + 1, 0).getDate();
  return localISODate(new Date(y, monthIndex, Math.min(day, last)));
}
function formatMinutes(mins: number): string {
  const m = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDate(localISODate(d))} ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function parsePeriodMonth(p: string): { y: number; m: number } | null {
  const mm = String(p || "").trim().match(/^([A-Za-z]{3}) (\d{4})$/);
  if (!mm) return null;
  const idx = MONTHS.findIndex((x) => x.toLowerCase() === mm[1].toLowerCase());
  return idx < 0 ? null : { y: Number(mm[2]), m: idx };
}
/** Statutory + internal deadline from a task type's rule. */
function deadlinesFor(t: TaskType, period: string, today: string): { statutory: string; internal: string } | null {
  if (!t.statutory_day) return null;
  const pm = parsePeriodMonth(period);
  let statutory: string;
  if (pm) {
    statutory = clampDate(pm.y, pm.m + (t.statutory_month_offset || 0), t.statutory_day);
  } else {
    const [y, m] = today.split("-").map(Number);
    statutory = clampDate(y, m - 1, t.statutory_day);
    if (statutory < today) statutory = clampDate(y, m, t.statutory_day);
  }
  let internal = addDays(statutory, -(t.internal_buffer_days ?? 3));
  if (internal < today && statutory >= today) internal = today;
  return { statutory, internal };
}
function ruleText(t: TaskType): string {
  if (!t.statutory_day) return "—";
  const off = t.statutory_month_offset || 0;
  const when = off === 0 ? "same month" : off === 1 ? "next month" : `${off} months later`;
  return `${ordinal(t.statutory_day)} of ${when}`;
}
function periodSuggestions(today: string): string[] {
  const [y, m] = today.split("-").map(Number);
  const months = [-2, -1, 0, 1].map((o) => {
    const d = new Date(y, m - 1 + o, 1);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  });
  const fy = m >= 4 ? y : y - 1;
  const fyLabel = (s: number) => `FY ${s}-${String((s + 1) % 100).padStart(2, "0")}`;
  const q = Math.floor(((m - 4 + 12) % 12) / 3) + 1;
  const prevQ = q === 1 ? `Q4 ${fyLabel(fy - 1)}` : `Q${q - 1} ${fyLabel(fy)}`;
  return [...months, `Q${q} ${fyLabel(fy)}`, prevQ, fyLabel(fy), fyLabel(fy - 1)];
}

/* ---------------- Page ---------------- */

export default function TasksPage() {
  const currentUser = useCurrentUser();
  const me = currentUser?.id || "";
  const isAdmin = !!currentUser?.isAdmin;
  const isReviewerUser = !!currentUser?.isReviewer;
  const [supabase] = useState(() => createClient());

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [team, setTeam] = useState<ProfileRow[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [loading, setLoading] = useState(true);

  // View & Filters
  const [view, setView] = useState<"list" | "board">("list");
  const [scope, setScope] = useState<"mine" | "review" | "all">(isAdmin ? "all" : "mine");
  const [search, setSearch] = useState("");
  const [filterStage, setFilterStage] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterRecurring, setFilterRecurring] = useState("");
  const [filterStaff, setFilterStaff] = useState("");
  const [filterDue, setFilterDue] = useState("");

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [taskTimeline, setTaskTimeline] = useState<any[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  // Form State
  const [taskTypeId, setTaskTypeId] = useState("");
  const [title, setTitle] = useState("");
  const [period, setPeriod] = useState("");
  const [clientId, setClientId] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [category, setCategory] = useState<string>("Other");
  const [dueDate, setDueDate] = useState("");
  const [officialDueDate, setOfficialDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [stage, setStage] = useState<TaskStage>("Assigned");
  const [recurrence, setRecurrence] = useState("None");
  const [notes, setNotes] = useState("");
  const [reviewComments, setReviewComments] = useState("");
  const [notifyClient, setNotifyClient] = useState(true);

  // Time logs
  const [timeLogs, setTimeLogs] = useState<any[]>([]);
  const [logHours, setLogHours] = useState("");
  const [logMinutes, setLogMinutes] = useState("");
  const [logDate, setLogDate] = useState(localISODate());
  const [logDesc, setLogDesc] = useState("");
  const [logBillable, setLogBillable] = useState(true);
  const [logSaving, setLogSaving] = useState(false);

  // Task list manager (admin)
  const [typesOpen, setTypesOpen] = useState(false);
  const [typeEditingId, setTypeEditingId] = useState<string | null>(null);
  const [tName, setTName] = useState("");
  const [tCategory, setTCategory] = useState("GST");
  const [tRecurrence, setTRecurrence] = useState("Monthly");
  const [tDay, setTDay] = useState("");
  const [tOffset, setTOffset] = useState(1);
  const [tBuffer, setTBuffer] = useState(3);
  const [typeSaving, setTypeSaving] = useState(false);
  const [typeError, setTypeError] = useState("");
  const [typeSearch, setTypeSearch] = useState("");
  const [showInactiveTypes, setShowInactiveTypes] = useState(false);
  const [mergeFrom, setMergeFrom] = useState<TaskType | null>(null);
  const [mergeInto, setMergeInto] = useState("");

  const today = localISODate();
  const periodOptions = useMemo(() => periodSuggestions(today), [today]);

  useEffect(() => {
    loadData();
  }, []);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4500);
  }

  async function loadTaskTypes() {
    const { data } = await supabase.from("task_types").select("*").order("category", { ascending: true }).order("name", { ascending: true });
    setTaskTypes((data || []) as TaskType[]);
  }

  async function loadData(showSpinner = true) {
    if (!me) return;
    if (showSpinner) setLoading(true);

    let query = supabase.from("tasks").select("*").order("due_date", { ascending: true });
    if (!isAdmin) {
      query = query.or(`assigned_to.eq.${me},reviewer_id.eq.${me}`);
    }

    const [tRes, cRes, pRes] = await Promise.all([
      query,
      supabase.from("clients").select("id, name, email, phone, pan, gstin, organization_name, status").order("name", { ascending: true }),
      supabase.from("profiles").select("id, name, email, role, is_active, is_reviewer").order("name", { ascending: true }),
      loadTaskTypes(),
    ]);

    if (tRes.error) showToast("error", "Could not load tasks. Please refresh the page.");
    if (tRes.data) setTasks(tRes.data as TaskRow[]);
    if (cRes.data) setClients(cRes.data as ClientRow[]);
    if (pRes.data) setTeam(pRes.data as ProfileRow[]);
    setLoading(false);
  }

  async function loadTaskTimeline(taskId: string) {
    setLoadingTimeline(true);
    const [logsRes, timeRes] = await Promise.all([
      supabase.from("audit_logs").select("*").eq("entity", "TASKS").eq("entity_id", taskId).order("timestamp", { ascending: false }),
      supabase.from("time_logs").select("*").eq("task_id", taskId).order("log_date", { ascending: false }),
    ]);
    setTaskTimeline(logsRes.data || []);
    setTimeLogs(timeRes.data || []);
    setLoadingTimeline(false);
  }

  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [String(c.id), c])), [clients]);
  const teamById = useMemo(() => Object.fromEntries(team.map((t) => [String(t.id), t])), [team]);
  const typeById = useMemo(() => Object.fromEntries(taskTypes.map((t) => [t.id, t])), [taskTypes]);
  const nameOf = (id?: string) => (id ? teamById[String(id)]?.name || "" : "");
  const activeTeam = team.filter((t) => t.is_active !== false);
  const reviewers = team.filter((t) => t.is_active !== false && (t.role === "admin" || t.role === "reviewer" || t.is_reviewer));
  const titleOf = (t: TaskRow) => `${t.title}${t.period ? ` · ${t.period}` : ""}`;

  const typeGroups = useMemo(() => {
    const groups: Record<string, TaskType[]> = {};
    taskTypes
      .filter((t) => t.is_active || t.id === taskTypeId)
      .forEach((t) => {
        (groups[t.category || "Other"] = groups[t.category || "Other"] || []).push(t);
      });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [taskTypes, taskTypeId]);

  const taskCountByType = useMemo(() => {
    const map: Record<string, number> = {};
    tasks.forEach((t) => {
      if (t.task_type_id) map[t.task_type_id] = (map[t.task_type_id] || 0) + 1;
    });
    return map;
  }, [tasks]);

  function dueInfo(date?: string, done?: boolean): { label: string; cls: string } {
    if (!date) return { label: "", cls: "text-text-muted" };
    if (done) return { label: "", cls: "text-text-muted" };
    const d = daysBetween(today, date);
    if (d < 0) return { label: `${-d}d overdue`, cls: "text-rose-600" };
    if (d === 0) return { label: "Due today", cls: "text-amber-600" };
    if (d <= 3) return { label: `${d}d left`, cls: "text-amber-600" };
    return { label: `${d}d left`, cls: "text-text-muted" };
  }

  /* ---------------- Analytics & filtering ---------------- */

  const scopedTasks = useMemo(() => {
    if (scope === "mine") return tasks.filter((t) => t.assigned_to === me);
    if (scope === "review") return tasks.filter((t) => t.reviewer_id === me || (isAdmin && t.stage === "Submitted for Review"));
    return tasks;
  }, [tasks, scope, me, isAdmin]);

  const stats = useMemo(() => {
    const open = scopedTasks.filter((t) => t.stage !== "Approved");
    const weekAhead = addDays(today, 7);
    return {
      open: open.length,
      overdue: open.filter((t) => t.due_date && t.due_date < today).length,
      statutoryWeek: open.filter((t) => t.official_due_date && t.official_due_date >= today && t.official_due_date <= weekAhead).length,
      statutoryBreached: open.filter((t) => t.official_due_date && t.official_due_date < today).length,
      awaitingReview: tasks.filter((t) => t.stage === "Submitted for Review" && (isAdmin || t.reviewer_id === me)).length,
      myActions: tasks.filter((t) => t.assigned_to === me && ["Assigned", "Changes Required"].includes(t.stage)).length,
    };
  }, [scopedTasks, tasks, today, me, isAdmin]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedTasks.filter((t) => {
      if (q) {
        const c = clientById[t.client_id];
        const hay = [t.title, t.period, t.notes, t.category, t.organisation, c?.name, c?.organization_name].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterStage && t.stage !== filterStage) return false;
      if (filterCategory && t.category !== filterCategory) return false;
      if (filterClient && t.client_id !== filterClient) return false;
      if (filterStaff && String(t.assigned_to) !== filterStaff) return false;
      if (filterRecurring === "recurring" && (!t.recurrence || t.recurrence === "None")) return false;
      if (filterRecurring === "onetime" && t.recurrence && t.recurrence !== "None") return false;
      if (filterDue === "overdue" && !(t.stage !== "Approved" && t.due_date && t.due_date < today)) return false;
      if (filterDue === "statutory" && !(t.stage !== "Approved" && t.official_due_date && daysBetween(today, t.official_due_date) <= 7)) return false;
      return true;
    });
  }, [scopedTasks, search, filterStage, filterCategory, filterClient, filterStaff, filterRecurring, filterDue, clientById, today]);

  const hasFilters = !!(search || filterStage || filterCategory || filterClient || filterStaff || filterRecurring || filterDue);

  function clearFilters() {
    setSearch("");
    setFilterStage("");
    setFilterCategory("");
    setFilterClient("");
    setFilterStaff("");
    setFilterRecurring("");
    setFilterDue("");
  }

  /* ---------------- Permissions for the open task ---------------- */

  const isTaskReviewer = !!editingTask && editingTask.reviewer_id === me;
  const isTaskAssignee = !!editingTask && editingTask.assigned_to === me;
  const canEditCoreDetails = editingTask ? isAdmin || isTaskReviewer : isAdmin;
  const canReview = isAdmin || isTaskReviewer;

  let availableStages: TaskStage[] = STAGES;
  if (editingTask && !canEditCoreDetails) {
    const current = editingTask.stage as TaskStage;
    if (current === "Assigned" || current === "Changes Required") availableStages = [current, "In Progress", "Submitted for Review"];
    else if (current === "In Progress") availableStages = ["In Progress", "Submitted for Review"];
    else availableStages = [current];
  }

  /* ---------------- Modal ---------------- */

  function openModal(task?: TaskRow) {
    setFormError("");
    setTaskTimeline([]);
    setTimeLogs([]);
    setLogHours("");
    setLogMinutes("");
    setLogDate(today);
    setLogDesc("");
    setLogBillable(true);
    if (task) {
      setEditingTask(task);
      setTaskTypeId(task.task_type_id || "");
      setTitle(task.title || "");
      setPeriod(task.period || "");
      setClientId(task.client_id || "");
      setOrganisation(task.organisation || clientById[task.client_id]?.organization_name || "");
      setCategory(task.category || "Other");
      setDueDate(task.due_date || "");
      setOfficialDueDate(task.official_due_date || "");
      setAssignedTo(task.assigned_to || "");
      setReviewerId(task.reviewer_id || "");
      setPriority(task.priority || "Medium");
      setStage((task.stage || "Assigned") as TaskStage);
      setRecurrence(task.recurrence || "None");
      setNotes(task.notes || "");
      setReviewComments(task.review_comments || "");
      setNotifyClient(true);
      loadTaskTimeline(task.id);
    } else {
      setEditingTask(null);
      resetForm();
    }
    setIsModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setIsModalOpen(false);
    setEditingTask(null);
    setTaskTimeline([]);
    setTimeLogs([]);
    resetForm();
  }

  function resetForm() {
    setTaskTypeId("");
    setTitle("");
    setPeriod("");
    setClientId("");
    setOrganisation("");
    setCategory("Other");
    setDueDate("");
    setOfficialDueDate("");
    setAssignedTo("");
    setReviewerId("");
    setPriority("Medium");
    setStage("Assigned");
    setRecurrence("None");
    setNotes("");
    setReviewComments("");
    setNotifyClient(true);
  }

  function applyTypeDefaults(t: TaskType, nextPeriod: string) {
    const d = deadlinesFor(t, nextPeriod, today);
    if (d) {
      setOfficialDueDate(d.statutory);
      setDueDate(d.internal);
    }
  }

  function handleTypeChange(id: string) {
    if (id === "__legacy") return;
    if (!id) {
      setTaskTypeId("");
      setTitle("");
      return;
    }
    const t = typeById[id];
    if (!t) return;
    setTaskTypeId(id);
    setTitle(t.name);
    if (!editingTask) {
      setCategory(t.category || "Other");
      setRecurrence(t.default_recurrence || "None");
      applyTypeDefaults(t, period);
    }
  }

  function handlePeriodChange(value: string) {
    setPeriod(value);
    const t = typeById[taskTypeId];
    if (!editingTask && t) applyTypeDefaults(t, value);
  }

  function handleClientChange(id: string) {
    setClientId(id);
    setOrganisation(clientById[id]?.organization_name || "");
  }

  // Helper to send emails (runs in parallel, failures don't block the save)
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

  async function saveTask(stageOverride?: TaskStage) {
    if (saving) return;
    setFormError("");

    const nextStage = stageOverride || stage;
    const cleanTitle = title.trim();
    const fullTitle = `${cleanTitle}${period.trim() ? ` · ${period.trim()}` : ""}`;

    if (!editingTask && !taskTypeId) return setFormError("Choose a task from the list.");
    if (!cleanTitle) return setFormError("Task title is required.");
    if (!dueDate) return setFormError("Please set the internal team deadline.");
    if (officialDueDate && dueDate > officialDueDate) return setFormError("The internal deadline must be on or before the statutory deadline.");
    if (reviewerId && reviewerId === assignedTo) return setFormError("The reviewer must be a different person from the assignee.");
    if (nextStage === "Changes Required" && !reviewComments.trim()) {
      return setFormError("Please write reviewer feedback before sending the task back for changes.");
    }

    const fullPayload = {
      task_type_id: taskTypeId || null,
      title: cleanTitle,
      period: period.trim() || null,
      client_id: clientId || null,
      organisation: organisation.trim(),
      category,
      due_date: dueDate,
      official_due_date: officialDueDate || null,
      assigned_to: assignedTo || null,
      reviewer_id: reviewerId || null,
      priority,
      stage: nextStage,
      recurrence,
      notes: notes.trim(),
      review_comments: reviewComments.trim(),
    };

    // Execution staff may only change the stage and their notes
    const payload = editingTask && !canEditCoreDetails ? { stage: nextStage, notes: notes.trim() } : fullPayload;

    const isNewTask = !editingTask;
    const isReassigned = !!editingTask && canEditCoreDetails && (assignedTo || null) !== (editingTask.assigned_to || null);
    const stageChangedTo = editingTask && nextStage !== editingTask.stage ? nextStage : null;

    setSaving(true);
    try {
      if (editingTask) {
        const { error } = await supabase.from("tasks").update(payload).eq("id", editingTask.id);
        if (error) throw error;

        const metadata: Record<string, any> = {};
        if (stageChangedTo) metadata.stage_changed_to = stageChangedTo;
        if (isReassigned) metadata.reassigned_to = nameOf(assignedTo) || "Unassigned";
        if (stageChangedTo === "Changes Required") metadata.feedback = reviewComments.trim().slice(0, 500);
        await logAuditEvent("UPDATE_TASK", "TASKS", editingTask.id, metadata);
      } else {
        const { data, error } = await supabase.from("tasks").insert([fullPayload]).select().single();
        if (error || !data) throw error || new Error("Could not create the task.");
        await logAuditEvent("CREATE_TASK", "TASKS", data.id, { title: fullTitle, stage: nextStage });
      }

      // --- WORKFLOW EMAIL ENGINE ---
      const assignee = teamById[String(assignedTo)];
      const reviewer = teamById[String(reviewerId)];
      const selectedClient = clientById[String(clientId)];
      const clientText = selectedClient ? clientLabel(selectedClient) : "Internal";
      const mails: Promise<boolean>[] = [];

      if ((isNewTask || isReassigned) && assignee?.email && assignedTo !== me) {
        mails.push(
          dispatchEmail(
            assignee.email,
            `New Task Assigned: ${fullTitle}`,
            `Hello ${assignee.name},\n\nYou have been assigned a new task: "${fullTitle}".\n\nClient: ${clientText}\nInternal deadline: ${formatDate(dueDate)}${officialDueDate ? `\nStatutory deadline: ${formatDate(officialDueDate)}` : ""}\nPriority: ${priority}\n\nPlease log into the portal, mark it as 'In Progress', and execute.`
          )
        );
      }
      if (isNewTask && notifyClient && selectedClient?.email) {
        mails.push(
          dispatchEmail(
            selectedClient.email,
            `Service Request Initiated: ${fullTitle}`,
            `Dear ${selectedClient.name},\n\nWe have initiated work on your request: "${fullTitle}". Our team will notify you upon completion.\n\nBest regards,\nFinetax Team`
          )
        );
      }
      if (stageChangedTo === "Submitted for Review" && reviewer?.email) {
        mails.push(
          dispatchEmail(
            reviewer.email,
            `Task Ready for Review: ${fullTitle}`,
            `Hello ${reviewer.name},\n\nThe task "${fullTitle}" (${clientText}) was submitted for review by ${assignee?.name || "staff"}.\n\nPlease review it in your queue.`
          )
        );
      } else if (stageChangedTo === "Changes Required" && assignee?.email) {
        mails.push(
          dispatchEmail(
            assignee.email,
            `Task Needs Correction: ${fullTitle}`,
            `Hello ${assignee.name},\n\nYour submitted task "${fullTitle}" requires corrections.\n\nReviewer feedback: ${reviewComments.trim()}\n\nPlease revise and resubmit.`
          )
        );
      } else if (stageChangedTo === "Approved" && notifyClient && selectedClient?.email) {
        mails.push(
          dispatchEmail(
            selectedClient.email,
            `Task Completed: ${fullTitle}`,
            `Dear ${selectedClient.name},\n\nWe are pleased to inform you that your task "${fullTitle}" has been completed and verified.\n\nBest regards,\nFinetax Team`
          )
        );
      }

      const sent = (await Promise.all(mails)).filter(Boolean).length;
      const nextNote = stageChangedTo === "Approved" && recurrence !== "None" ? " The next occurrence has been scheduled." : "";
      showToast(
        "success",
        `${isNewTask ? "Task created" : stageChangedTo ? `Task moved to ${stageChangedTo}` : "Task saved"}.${nextNote}${sent ? ` ${sent} notification${sent === 1 ? "" : "s"} sent.` : ""}`
      );

      setIsModalOpen(false);
      setEditingTask(null);
      resetForm();
      loadData(false);
    } catch (err: any) {
      setFormError(err?.message || "Could not save the task.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await saveTask();
  }

  async function handleDelete() {
    if (!editingTask) return;
    setActionBusy(true);
    const { error } = await supabase.from("tasks").delete().eq("id", editingTask.id);
    setActionBusy(false);
    setConfirmDelete(false);
    if (error) return showToast("error", "Could not delete this task. Only administrators can delete tasks.");
    logAuditEvent("DELETE_TASK", "TASKS", editingTask.id, { title: titleOf(editingTask) });
    showToast("success", "Task deleted.");
    setIsModalOpen(false);
    setEditingTask(null);
    loadData(false);
  }

  /* ---------------- Time logs ---------------- */

  const loggedMinutes = timeLogs.reduce((s, l) => s + Number(l.hours || 0) * 60, 0);

  async function addTimeLog(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTask || logSaving) return;
    const hours = Number(logHours || 0) + Number(logMinutes || 0) / 60;
    if (!(hours > 0) || hours > 24) return showToast("error", "Enter between 1 minute and 24 hours.");
    if (!logDesc.trim()) return showToast("error", "Please describe the work done.");
    if (logDate > today) return showToast("error", "Time cannot be logged for a future date.");

    setLogSaving(true);
    const { error } = await supabase.from("time_logs").insert([
      {
        user_id: me,
        task_id: editingTask.id,
        client_id: editingTask.client_id || null,
        description: logDesc.trim(),
        hours: Math.round(hours * 100) / 100,
        log_date: logDate,
        is_billable: logBillable,
      },
    ]);
    setLogSaving(false);
    if (error) return showToast("error", error.message);

    await logAuditEvent("UPDATE_TASK", "TASKS", editingTask.id, { time_logged: formatMinutes(hours * 60) });
    setLogHours("");
    setLogMinutes("");
    setLogDesc("");
    loadTaskTimeline(editingTask.id);
    loadData(false);
  }

  async function deleteTimeLog(log: any) {
    const { error } = await supabase.from("time_logs").delete().eq("id", log.id);
    if (error) return showToast("error", "Could not remove this entry.");
    if (editingTask) loadTaskTimeline(editingTask.id);
    loadData(false);
  }

  /* ---------------- Task list manager (admin) ---------------- */

  function resetTypeForm() {
    setTypeEditingId(null);
    setTName("");
    setTCategory("GST");
    setTRecurrence("Monthly");
    setTDay("");
    setTOffset(1);
    setTBuffer(3);
    setTypeError("");
  }

  function editType(t: TaskType) {
    setTypeEditingId(t.id);
    setTName(t.name);
    setTCategory(t.category || "Other");
    setTRecurrence(t.default_recurrence || "None");
    setTDay(t.statutory_day ? String(t.statutory_day) : "");
    setTOffset(t.statutory_month_offset ?? 0);
    setTBuffer(t.internal_buffer_days ?? 3);
    setTypeError("");
  }

  async function saveType(e: React.FormEvent) {
    e.preventDefault();
    if (typeSaving) return;
    setTypeError("");
    const day = tDay ? Number(tDay) : null;
    if (!tName.trim()) return setTypeError("Task name is required.");
    if (day !== null && !(day >= 1 && day <= 31)) return setTypeError("Statutory day must be between 1 and 31.");

    const payload = {
      name: tName.trim(),
      category: tCategory,
      default_recurrence: tRecurrence,
      statutory_day: day,
      statutory_month_offset: tOffset,
      internal_buffer_days: tBuffer,
    };

    setTypeSaving(true);
    const { error } = typeEditingId
      ? await supabase.from("task_types").update(payload).eq("id", typeEditingId)
      : await supabase.from("task_types").insert([payload]);
    setTypeSaving(false);

    if (error) {
      setTypeError(error.code === "23505" ? `"${payload.name}" is already in the list.` : error.message);
      return;
    }
    logAuditEvent(typeEditingId ? "UPDATE_TASK_TYPE" : "CREATE_TASK_TYPE", "TASK_TYPES", typeEditingId || undefined, { name: payload.name });
    showToast("success", typeEditingId ? `"${payload.name}" updated.` : `"${payload.name}" added to the task list.`);
    resetTypeForm();
    await loadTaskTypes();
    if (typeEditingId) loadData(false);
  }

  async function toggleTypeActive(t: TaskType) {
    const { error } = await supabase.from("task_types").update({ is_active: !t.is_active }).eq("id", t.id);
    if (error) return showToast("error", error.message);
    logAuditEvent(t.is_active ? "ARCHIVE_TASK_TYPE" : "RESTORE_TASK_TYPE", "TASK_TYPES", t.id, { name: t.name });
    loadTaskTypes();
  }

  async function confirmMergeTypes() {
    if (!mergeFrom || !mergeInto) return;
    setActionBusy(true);
    const { data, error } = await supabase.rpc("merge_task_types", { p_from: mergeFrom.id, p_into: mergeInto });
    setActionBusy(false);
    if (error) return showToast("error", error.message);
    logAuditEvent("MERGE_TASK_TYPES", "TASK_TYPES", mergeInto, { from: mergeFrom.name, into: typeById[mergeInto]?.name, tasks_moved: data });
    showToast("success", `"${mergeFrom.name}" merged into "${typeById[mergeInto]?.name}". ${data ?? 0} open task(s) updated.`);
    setMergeFrom(null);
    setMergeInto("");
    loadData(false);
  }

  const visibleTypes = taskTypes.filter(
    (t) => (showInactiveTypes || t.is_active) && (!typeSearch || `${t.name} ${t.category}`.toLowerCase().includes(typeSearch.toLowerCase()))
  );

  /* ---------------- Render helpers ---------------- */

  function ClientCell({ t }: { t: TaskRow }) {
    const c = clientById[t.client_id];
    const org = c?.organization_name || t.organisation;
    if (!c && !org) return <span className="text-text-muted">Internal</span>;
    return (
      <>
        <p className="font-medium text-text-main">{org || c?.name}</p>
        {org && c?.name && org !== c.name && <p className="text-[10px] text-text-muted">{c.name}</p>}
      </>
    );
  }

  function TaskCard({ t }: { t: TaskRow }) {
    const done = t.stage === "Approved";
    const internal = dueInfo(t.due_date, done);
    const statutory = dueInfo(t.official_due_date, done);
    const needsAction = t.assigned_to === me && ["Assigned", "Changes Required"].includes(t.stage);
    const c = clientById[t.client_id];
    return (
      <button
        type="button"
        onClick={() => openModal(t)}
        className={`w-full rounded-lg border bg-surface p-3 text-left shadow-sm transition hover:border-navy/30 hover:shadow-md ${
          needsAction ? "border-amber-300" : "border-border"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold leading-snug text-navy">
            {t.title}
            {t.period && <span className="ml-1 font-normal text-text-muted">· {t.period}</span>}
          </p>
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOTS[t.priority || "Medium"]}`} title={`${t.priority || "Medium"} priority`} />
        </div>
        <p className="mt-1 truncate text-[11px] text-text-muted">{c ? clientLabel(c) : t.organisation || "Internal"}</p>
        <div className="mt-2 space-y-0.5 text-[10px]">
          <p className={`font-semibold ${internal.cls}`}>
            Int: {t.due_date ? formatDate(t.due_date) : "—"}
            {internal.label && ` · ${internal.label}`}
          </p>
          <p className={t.official_due_date ? `font-semibold ${statutory.cls === "text-text-muted" ? "text-text-main" : statutory.cls}` : "text-text-muted"}>
            Stat: {t.official_due_date ? formatDate(t.official_due_date) : "—"}
            {t.official_due_date && statutory.label && ` · ${statutory.label}`}
          </p>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          {t.recurrence && t.recurrence !== "None" ? (
            <span className="flex items-center gap-1 text-[10px] text-text-muted">
              <RefreshCw className="h-3 w-3" /> {t.recurrence}
            </span>
          ) : (
            <span />
          )}
          {t.assigned_to && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-navy/10 text-[8px] font-bold text-navy" title={nameOf(t.assigned_to)}>
              {getInitials(nameOf(t.assigned_to))}
            </span>
          )}
        </div>
      </button>
    );
  }

  const clientFilterOptions = useMemo(() => sortByLabel(clients.filter((c) => c.status !== "Merged")), [clients]);
  const isLegacyTitle = !!editingTask && !taskTypeId && !!title;

  /* ---------------- Render ---------------- */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm lg:flex-row lg:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <CheckSquare className="h-5 w-5 text-navy" /> Tasks & Compliance
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Internal and statutory deadlines, maker-checker review and recurring compliance in one board.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          <div className="flex rounded-lg border border-border bg-surface-alt p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setView("list")}
              className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 transition ${view === "list" ? "bg-surface text-navy shadow-sm" : "text-text-muted"}`}
            >
              <List className="h-3.5 w-3.5" /> List
            </button>
            <button
              type="button"
              onClick={() => setView("board")}
              className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 transition ${view === "board" ? "bg-surface text-navy shadow-sm" : "text-text-muted"}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Board
            </button>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                resetTypeForm();
                setTypesOpen(true);
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt"
            >
              <ListChecks className="h-4 w-4 text-navy" /> Task List
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => openModal()}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light lg:flex-none"
            >
              <Plus className="h-4 w-4" /> Add Task
            </button>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Open Tasks</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-navy">{stats.open}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy/10 text-navy">
              <CheckSquare className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            {stats.myActions > 0 ? <span className="font-semibold text-amber-700">{stats.myActions} need your action</span> : "In the current view"}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setFilterDue(filterDue === "overdue" ? "" : "overdue")}
          className={`rounded-xl border bg-surface p-4 text-left shadow-sm transition hover:shadow-md ${filterDue === "overdue" ? "border-rose-300" : "border-border"}`}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Overdue (Internal)</p>
              <p className={`mt-1.5 text-2xl font-bold tracking-tight ${stats.overdue ? "text-rose-600" : "text-emerald-700"}`}>{stats.overdue}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
              <AlertCircle className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">Click to filter</p>
        </button>

        <button
          type="button"
          onClick={() => setFilterDue(filterDue === "statutory" ? "" : "statutory")}
          className={`rounded-xl border bg-surface p-4 text-left shadow-sm transition hover:shadow-md ${filterDue === "statutory" ? "border-amber-300" : "border-border"}`}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Statutory · 7 Days</p>
              <p className={`mt-1.5 text-2xl font-bold tracking-tight ${stats.statutoryWeek ? "text-amber-700" : "text-text-main"}`}>{stats.statutoryWeek}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <CalendarClock className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            {stats.statutoryBreached ? <span className="font-semibold text-rose-600">{stats.statutoryBreached} statutory deadline(s) breached</span> : "No breaches"}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setScope("review")}
          className="rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition hover:border-navy/30 hover:shadow-md"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Awaiting Review</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-violet-700">{stats.awaitingReview}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">{isAdmin || isReviewerUser ? "Click to open your review queue" : "Your submissions"}</p>
        </button>
      </div>

      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex rounded-lg border border-border bg-surface-alt p-0.5 text-xs font-semibold">
              {(
                [
                  { key: "mine", label: "My Work" },
                  { key: "review", label: "Review Queue" },
                  { key: "all", label: isAdmin ? "All Tasks" : "All Mine" },
                ] as const
              ).map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setScope(s.key)}
                  className={`rounded-md px-3 py-1.5 transition ${scope === s.key ? "bg-surface text-navy shadow-sm" : "text-text-muted hover:text-text-main"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="relative w-full lg:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Search task, period, organisation, client..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
              />
            </div>
            <span className="text-[11px] text-text-muted lg:ml-auto">
              Showing {filteredTasks.length} of {scopedTasks.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {view === "list" && (
              <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
                <option value="">All stages</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)} className="max-w-[240px] rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
              <option value="">All clients</option>
              {clientFilterOptions.map((c) => (
                <option key={c.id} value={c.id}>{clientLabel(c)}</option>
              ))}
            </select>
            {isAdmin && (
              <select value={filterStaff} onChange={(e) => setFilterStaff(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
                <option value="">All staff</option>
                {activeTeam.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            <select value={filterRecurring} onChange={(e) => setFilterRecurring(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
              <option value="">One-time & recurring</option>
              <option value="recurring">Recurring only</option>
              <option value="onetime">One-time only</option>
            </select>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-text-muted transition hover:bg-surface-alt hover:text-text-main"
              >
                <X className="h-3.5 w-3.5" /> Clear filters
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tasks...
          </div>
        ) : view === "board" ? (
          /* ---------- Board view ---------- */
          <div className="overflow-x-auto p-4">
            <div className="grid min-w-[1000px] grid-cols-5 gap-3">
              {STAGES.map((s) => {
                const col = filteredTasks.filter((t) => t.stage === s);
                const shown = s === "Approved" ? [...col].sort((a, b) => String(b.due_date).localeCompare(String(a.due_date))).slice(0, 20) : col;
                return (
                  <div key={s} className="flex flex-col rounded-lg bg-surface-alt p-2">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold text-text-main">
                        <span className={`h-2 w-2 rounded-full ${STAGE_DOTS[s]}`} /> {s}
                      </span>
                      <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-text-muted">{col.length}</span>
                    </div>
                    <div className="max-h-[65vh] space-y-2 overflow-y-auto">
                      {shown.length === 0 ? (
                        <p className="px-1 py-4 text-center text-[11px] text-text-muted">No tasks</p>
                      ) : (
                        shown.map((t) => <TaskCard key={t.id} t={t} />)
                      )}
                      {s === "Approved" && col.length > 20 && <p className="px-1 text-center text-[10px] text-text-muted">Showing latest 20</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <CheckSquare className="h-6 w-6 text-text-muted" />
            <p className="text-xs text-text-muted">{hasFilters ? "No tasks match these filters." : "No tasks in this view."}</p>
          </div>
        ) : (
          /* ---------- List view ---------- */
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Deadlines (Int / Statutory)</th>
                  <th>Task</th>
                  <th>Category</th>
                  <th>Organisation / Client</th>
                  <th>Assignee</th>
                  <th>Reviewer</th>
                  <th className="text-right">Time</th>
                  <th>Stage</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map((t) => {
                  const done = t.stage === "Approved";
                  const internal = dueInfo(t.due_date, done);
                  const statutory = dueInfo(t.official_due_date, done);
                  const needsAction = t.assigned_to === me && ["Assigned", "Changes Required"].includes(t.stage);
                  const needsReview = t.reviewer_id === me && t.stage === "Submitted for Review";
                  return (
                    <tr
                      key={t.id}
                      className={`cursor-pointer transition hover:bg-surface-alt ${needsAction || needsReview ? "bg-amber-50/40" : ""} ${done ? "opacity-70" : ""}`}
                      onClick={() => openModal(t)}
                    >
                      <td className="whitespace-nowrap">
                        <p className={`font-medium ${internal.cls === "text-rose-600" ? "font-semibold text-rose-600" : "text-text-main"}`}>
                          Int: {t.due_date ? formatDate(t.due_date) : "—"}
                          {internal.label && <span className={`ml-1 text-[10px] ${internal.cls}`}>({internal.label})</span>}
                        </p>
                        <p className={`mt-0.5 text-[10px] ${t.official_due_date ? "text-text-main" : "text-text-muted"}`}>
                          Stat: {t.official_due_date ? formatDate(t.official_due_date) : "—"}
                          {t.official_due_date && statutory.label && <span className={`ml-1 font-semibold ${statutory.cls}`}>({statutory.label})</span>}
                        </p>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOTS[t.priority || "Medium"]}`} title={`${t.priority || "Medium"} priority`} />
                          <span className="font-semibold text-navy">{t.title}</span>
                          {t.period && <span className="rounded bg-surface-alt px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">{t.period}</span>}
                          {t.recurrence && t.recurrence !== "None" && <RefreshCw className="h-3 w-3 shrink-0 text-text-muted" />}
                          {(needsAction || needsReview) && (
                            <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" title={needsReview ? "Awaiting your review" : "Action required"} />
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">{t.category || "—"}</td>
                      <td>
                        <ClientCell t={t} />
                      </td>
                      <td className="whitespace-nowrap">{nameOf(t.assigned_to) || <span className="font-semibold text-rose-500">Unassigned</span>}</td>
                      <td className="whitespace-nowrap">{nameOf(t.reviewer_id) || <span className="text-text-muted">—</span>}</td>
                      <td className="whitespace-nowrap text-right text-text-muted">{t.time_spent_minutes ? formatMinutes(t.time_spent_minutes) : "—"}</td>
                      <td>
                        <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STAGE_STYLES[t.stage] || STAGE_STYLES.Assigned}`}>
                          {t.stage}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ================= Task Modal ================= */}
      {isModalOpen && (
        <Modal
          title={editingTask ? titleOf(editingTask) : "Add Task"}
          subtitle={
            editingTask
              ? `${clientById[editingTask.client_id] ? clientLabel(clientById[editingTask.client_id]) : editingTask.organisation || "Internal"} · ${editingTask.category || "Other"}`
              : "Choose a task from the list. Deadlines fill in automatically where a rule is set."
          }
          onClose={closeModal}
          maxWidth="max-w-6xl"
          headerExtra={
            editingTask ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STAGE_STYLES[editingTask.stage] || STAGE_STYLES.Assigned}`}>
                  {editingTask.stage}
                </span>
                {!canEditCoreDetails && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-text-muted">
                    <Lock className="h-3 w-3" /> Details are managed by the reviewer
                  </span>
                )}
              </div>
            ) : null
          }
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {editingTask && isAdmin && (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                )}
                {editingTask && isTaskAssignee && ["Assigned", "Changes Required"].includes(editingTask.stage) && (
                  <button
                    type="button"
                    onClick={() => saveTask("In Progress")}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-60"
                  >
                    <Play className="h-3.5 w-3.5" /> Start Work
                  </button>
                )}
                {editingTask && isTaskAssignee && ["Assigned", "In Progress", "Changes Required"].includes(editingTask.stage) && (
                  <button
                    type="button"
                    onClick={() => saveTask("Submitted for Review")}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
                  >
                    <Send className="h-3.5 w-3.5" /> Submit for Review
                  </button>
                )}
                {editingTask && canReview && editingTask.stage === "Submitted for Review" && (
                  <>
                    <button
                      type="button"
                      onClick={() => saveTask("Changes Required")}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Request Changes
                    </button>
                    <button
                      type="button"
                      onClick={() => saveTask("Approved")}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                    </button>
                  </>
                )}
              </div>
              <div className="flex gap-2 sm:ml-auto">
                <button type="button" onClick={closeModal} className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt sm:flex-none">
                  Cancel
                </button>
                <button
                  type="submit"
                  form="task-form"
                  disabled={saving}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-60 sm:flex-none"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {editingTask ? "Save" : "Create Task"}
                </button>
              </div>
            </div>
          }
        >
          <div className={`grid grid-cols-1 gap-8 ${editingTask ? "lg:grid-cols-3" : ""}`}>
            {/* LEFT COLUMN: Form */}
            <div className={`space-y-4 ${editingTask ? "lg:col-span-2" : ""}`}>
              {formError && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs font-medium text-danger">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <form id="task-form" onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Task *</span>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => {
                            resetTypeForm();
                            setTypesOpen(true);
                          }}
                          className="text-[11px] font-semibold text-navy hover:underline"
                        >
                          Manage task list
                        </button>
                      )}
                    </div>
                    <select
                      disabled={!canEditCoreDetails}
                      value={taskTypeId || (isLegacyTitle ? "__legacy" : "")}
                      onChange={(e) => handleTypeChange(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">— Choose a task —</option>
                      {isLegacyTitle && <option value="__legacy">{title} (not in the task list)</option>}
                      {typeGroups.map(([cat, list]) => (
                        <optgroup key={cat} label={cat}>
                          {list.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                              {!t.is_active ? " (archived)" : ""}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {taskTypeId && typeById[taskTypeId]?.statutory_day ? (
                      <p className="mt-1 text-[10px] text-text-muted">
                        Statutory rule: {ruleText(typeById[taskTypeId])} · internal deadline {typeById[taskTypeId].internal_buffer_days} day(s) earlier
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className={labelClass}>Period</label>
                    <input
                      disabled={!canEditCoreDetails}
                      list="period-options"
                      value={period}
                      onChange={(e) => handlePeriodChange(e.target.value)}
                      className={inputClass}
                      placeholder="e.g. Sep 2026"
                      maxLength={40}
                    />
                    <datalist id="period-options">
                      {periodOptions.map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Client</label>
                    <ClientPicker clients={clients as any} value={clientId} onChange={handleClientChange} disabled={!canEditCoreDetails} noneLabel="Internal / No client" />
                  </div>
                  <div>
                    <label className={labelClass}>Organisation</label>
                    <input disabled={!canEditCoreDetails} type="text" placeholder="e.g. Acme Corp" value={organisation} onChange={(e) => setOrganisation(e.target.value)} className={inputClass} />
                  </div>

                  <div>
                    <label className={labelClass}>Category</label>
                    <select disabled={!canEditCoreDetails} value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
                      {(CATEGORIES.includes(category) ? CATEGORIES : [category, ...CATEGORIES]).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Recurrence</label>
                    <select disabled={!canEditCoreDetails} value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className={inputClass}>
                      {RECURRENCE_OPTIONS.map((r) => (
                        <option key={r} value={r}>{r === "None" ? "None (one-time task)" : r}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={`${labelClass} text-amber-700`}>Internal Team Deadline *</label>
                    <input
                      disabled={!canEditCoreDetails}
                      required
                      type="date"
                      value={dueDate}
                      max={officialDueDate || undefined}
                      onChange={(e) => setDueDate(e.target.value)}
                      className={`${inputClass} border-amber-300`}
                    />
                  </div>
                  <div>
                    <label className={`${labelClass} text-rose-700`}>Statutory Deadline</label>
                    <input
                      disabled={!canEditCoreDetails}
                      type="date"
                      value={officialDueDate}
                      min={dueDate || undefined}
                      onChange={(e) => setOfficialDueDate(e.target.value)}
                      className={`${inputClass} border-rose-300`}
                    />
                  </div>

                  <div>
                    <label className={`${labelClass} text-navy`}>Workflow Stage *</label>
                    <select value={stage} onChange={(e) => setStage(e.target.value as TaskStage)} className={`${inputClass} border-navy/30 bg-navy/5 font-semibold text-navy`}>
                      {availableStages.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Priority</label>
                    <select disabled={!canEditCoreDetails} value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
                      {PRIORITIES.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={labelClass}>Assign Execution To</label>
                    <select disabled={!canEditCoreDetails} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={inputClass}>
                      <option value="">— Unassigned —</option>
                      {team
                        .filter((t) => t.is_active !== false || String(t.id) === String(assignedTo))
                        .map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Assign Reviewer (Checker)</label>
                    <select disabled={!canEditCoreDetails} value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} className={inputClass}>
                      <option value="">— No Reviewer —</option>
                      {reviewers
                        .filter((t) => String(t.id) !== String(assignedTo) || String(t.id) === String(reviewerId))
                        .map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                  </div>
                </div>

                {recurrence !== "None" && (
                  <div className="flex items-center gap-2 rounded-lg border border-navy/20 bg-navy/5 p-2.5 text-xs text-navy">
                    <RefreshCw className="h-4 w-4 shrink-0" />
                    When this task is approved, the next {recurrence.toLowerCase()} occurrence is created automatically with both deadlines
                    {period ? " and the period" : ""} moved forward.
                  </div>
                )}

                <div>
                  <label className={labelClass}>Execution Notes</label>
                  <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="Work done, documents pending, ARN / acknowledgement numbers..." />
                </div>

                <div className="rounded-lg border border-border bg-surface-alt p-3">
                  <label className={`${labelClass} text-navy`}>Reviewer Feedback / Required Changes</label>
                  <textarea
                    rows={2}
                    value={reviewComments}
                    onChange={(e) => setReviewComments(e.target.value)}
                    disabled={!canReview}
                    className={inputClass}
                    placeholder={canReview ? "Required before sending the task back for changes..." : "Only the reviewer can write feedback."}
                  />
                </div>

                {(!editingTask || canReview) && clientById[clientId]?.email && (
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-text-main">
                    <input type="checkbox" checked={notifyClient} onChange={(e) => setNotifyClient(e.target.checked)} className="h-4 w-4 accent-navy" />
                    Email the client {editingTask ? "when this task is approved" : "that work has started"} ({clientById[clientId]?.email})
                  </label>
                )}
              </form>

              {/* Time log */}
              {editingTask && (
                <div className="space-y-3 border-t border-border pt-4">
                  <div className="flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-xs font-bold text-text-main">
                      <Timer className="h-4 w-4 text-navy" /> Time Logged
                    </h4>
                    <span className="text-xs font-semibold text-navy">{formatMinutes(loggedMinutes)} total</span>
                  </div>

                  {(isTaskAssignee || canReview) && (
                    <form onSubmit={addTimeLog} className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-alt p-2.5 sm:grid-cols-12">
                      <input type="number" min="0" max="24" placeholder="Hrs" value={logHours} onChange={(e) => setLogHours(e.target.value)} className={`${inputClass} sm:col-span-2`} />
                      <input type="number" min="0" max="59" placeholder="Min" value={logMinutes} onChange={(e) => setLogMinutes(e.target.value)} className={`${inputClass} sm:col-span-2`} />
                      <input type="date" max={today} value={logDate} onChange={(e) => setLogDate(e.target.value)} className={`${inputClass} col-span-2 sm:col-span-3`} />
                      <input type="text" placeholder="What was done?" value={logDesc} onChange={(e) => setLogDesc(e.target.value)} maxLength={300} className={`${inputClass} col-span-2 sm:col-span-5`} />
                      <label className="col-span-2 flex items-center gap-1.5 text-[11px] text-text-muted sm:col-span-6">
                        <input type="checkbox" checked={logBillable} onChange={(e) => setLogBillable(e.target.checked)} className="accent-navy" /> Billable
                      </label>
                      <button
                        type="submit"
                        disabled={logSaving}
                        className="col-span-2 inline-flex items-center justify-center gap-1 rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white transition hover:bg-navy-light disabled:opacity-60 sm:col-span-6"
                      >
                        {logSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />} Log Time
                      </button>
                    </form>
                  )}

                  {timeLogs.length === 0 ? (
                    <p className="text-[11px] italic text-text-muted">No time logged yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {timeLogs.map((l) => (
                        <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[11px]">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-text-main">{l.description}</p>
                            <p className="text-text-muted">
                              {nameOf(l.user_id) || "—"} · {formatDate(l.log_date)}
                              {l.is_billable === false ? " · non-billable" : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="font-semibold text-navy">{formatMinutes(Number(l.hours) * 60)}</span>
                            {(isAdmin || l.user_id === me) && (
                              <button type="button" onClick={() => deleteTimeLog(l)} className="rounded p-0.5 text-rose-600 hover:bg-rose-50" aria-label="Remove entry">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: Timeline */}
            {editingTask && (
              <div className="border-t border-border pt-6 lg:max-h-[70vh] lg:overflow-y-auto lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                <div className="sticky top-0 mb-4 flex items-center gap-2 border-b border-border bg-surface pb-2 text-xs font-bold text-navy">
                  <Activity className="h-4 w-4" /> Task Timeline
                </div>

                {loadingTimeline ? (
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading task history...
                  </div>
                ) : taskTimeline.length === 0 ? (
                  <div className="text-xs italic text-text-muted">No history recorded yet.</div>
                ) : (
                  <div className="space-y-4">
                    {taskTimeline.map((log: any) => {
                      const isCreate = log.action === "CREATE_TASK";
                      return (
                        <div key={log.id} className="relative border-l-2 border-border pb-1 pl-4">
                          <div className={`absolute -left-[5px] top-1 h-2 w-2 rounded-full ${isCreate ? "bg-emerald-500" : "bg-navy"}`} />
                          <div className="mb-0.5 flex items-start justify-between gap-2">
                            <span className="text-[11px] font-semibold text-text-main">
                              {isCreate ? "Task created" : String(log.action || "").replace(/_/g, " ").toLowerCase()}
                            </span>
                            <span className="whitespace-nowrap text-[10px] text-text-muted">{formatDateTime(log.timestamp)}</span>
                          </div>
                          <p className="text-[11px] text-text-muted">
                            by <span className="font-semibold">{log.metadata?.actor_name || "System"}</span>
                          </p>
                          {log.metadata?.stage_changed_to && (
                            <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STAGE_STYLES[log.metadata.stage_changed_to] || ""}`}>
                              → {log.metadata.stage_changed_to}
                            </span>
                          )}
                          {log.metadata?.reassigned_to && <p className="mt-1 text-[10px] text-text-muted">Reassigned to {log.metadata.reassigned_to}</p>}
                          {log.metadata?.feedback && <p className="mt-1 rounded bg-amber-50 p-1.5 text-[10px] text-amber-800">{log.metadata.feedback}</p>}
                          {log.metadata?.time_logged && (
                            <span className="mt-1 inline-block rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                              Logged {log.metadata.time_logged}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ================= Task List Manager (admin) ================= */}
      {typesOpen && (
        <Modal
          title="Task List"
          subtitle="Staff can only choose task titles from this list. Rules fill in deadlines automatically."
          onClose={() => !typeSaving && setTypesOpen(false)}
          maxWidth="max-w-5xl"
        >
          <div className="space-y-5 text-xs">
            <form onSubmit={saveType} className="space-y-3 rounded-lg border border-border bg-surface-alt p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-navy">{typeEditingId ? "Edit task" : "Add a task to the list"}</p>
              {typeError && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-2.5 font-medium text-danger">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{typeError}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                <div className="col-span-2 sm:col-span-2">
                  <label className={labelClass}>Task Name *</label>
                  <input value={tName} onChange={(e) => setTName(e.target.value)} className={inputClass} placeholder="e.g. GSTR-3B Return" maxLength={120} />
                </div>
                <div>
                  <label className={labelClass}>Category</label>
                  <select value={tCategory} onChange={(e) => setTCategory(e.target.value)} className={inputClass}>
                    {(CATEGORIES.includes(tCategory) ? CATEGORIES : [tCategory, ...CATEGORIES]).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Recurrence</label>
                  <select value={tRecurrence} onChange={(e) => setTRecurrence(e.target.value)} className={inputClass}>
                    {RECURRENCE_OPTIONS.map((r) => (
                      <option key={r} value={r}>{r === "None" ? "One-time" : r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Statutory Day</label>
                  <input type="number" min={1} max={31} value={tDay} onChange={(e) => setTDay(e.target.value)} className={inputClass} placeholder="None" />
                </div>
                <div>
                  <label className={labelClass}>Of Which Month</label>
                  <select value={tOffset} onChange={(e) => setTOffset(Number(e.target.value))} className={inputClass} disabled={!tDay}>
                    <option value={0}>Same month</option>
                    <option value={1}>Next month</option>
                    <option value={2}>2 months later</option>
                    <option value={3}>3 months later</option>
                    <option value={4}>4 months later</option>
                    <option value={6}>6 months later</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Internal Buffer</label>
                  <select value={tBuffer} onChange={(e) => setTBuffer(Number(e.target.value))} className={inputClass} disabled={!tDay}>
                    {[0, 1, 2, 3, 5, 7, 10, 15].map((d) => (
                      <option key={d} value={d}>{d === 0 ? "Same day" : `${d} day${d === 1 ? "" : "s"} before`}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-[10px] text-text-muted">
                Example: GSTR-3B for period "Sep 2026" with day 20 of the next month gives a statutory deadline of 20/10/2026. Leave the day empty for tasks without a fixed date.
              </p>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={typeSaving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
                >
                  {typeSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {typeEditingId ? "Save Changes" : "Add to List"}
                </button>
                {typeEditingId && (
                  <button type="button" onClick={resetTypeForm} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface">
                    Cancel edit
                  </button>
                )}
              </div>
            </form>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                <input value={typeSearch} onChange={(e) => setTypeSearch(e.target.value)} placeholder="Search the list..." className={`${inputClass} py-1.5 pl-8 text-xs`} />
              </div>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-muted">
                <input type="checkbox" checked={showInactiveTypes} onChange={(e) => setShowInactiveTypes(e.target.checked)} className="accent-navy" /> Show archived
              </label>
              <span className="ml-auto text-[11px] text-text-muted">{taskTypes.filter((t) => t.is_active).length} active tasks in the list</span>
            </div>

            <div className="max-h-[45vh] overflow-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Category</th>
                    <th>Recurrence</th>
                    <th>Statutory Rule</th>
                    <th className="text-right">Tasks</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTypes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-text-muted">No tasks match.</td>
                    </tr>
                  ) : (
                    visibleTypes.map((t) => (
                      <tr key={t.id} className={t.is_active ? "" : "opacity-60"}>
                        <td className="font-semibold text-navy">
                          {t.name}
                          {!t.is_active && <span className="ml-1 text-[10px] font-normal text-text-muted">(archived)</span>}
                        </td>
                        <td>{t.category}</td>
                        <td>{t.default_recurrence === "None" ? "One-time" : t.default_recurrence}</td>
                        <td className="whitespace-nowrap">
                          {ruleText(t)}
                          {t.statutory_day ? <span className="text-text-muted"> · −{t.internal_buffer_days}d internal</span> : null}
                        </td>
                        <td className="text-right">{taskCountByType[t.id] || 0}</td>
                        <td className="whitespace-nowrap text-right">
                          <div className="inline-flex gap-1">
                            <button type="button" onClick={() => editType(t)} className="rounded-md p-1.5 text-navy transition hover:bg-surface-alt" title="Edit">
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMergeFrom(t);
                                setMergeInto("");
                              }}
                              className="rounded-md p-1.5 text-violet-600 transition hover:bg-violet-50"
                              title="Merge into another task"
                            >
                              <GitMerge className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleTypeActive(t)}
                              className="rounded-md px-2 py-1 text-[10px] font-semibold text-text-muted transition hover:bg-surface-alt"
                            >
                              {t.is_active ? "Archive" : "Restore"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {mergeFrom && (
              <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
                <p className="font-semibold text-violet-800">
                  Merge "{mergeFrom.name}" into another task. Its open tasks move over and "{mergeFrom.name}" is archived.
                </p>
                <div className="flex flex-wrap gap-2">
                  <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className={`${inputClass} max-w-sm`}>
                    <option value="">— Choose the task to keep —</option>
                    {taskTypes
                      .filter((t) => t.is_active && t.id !== mergeFrom.id)
                      .map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={confirmMergeTypes}
                    disabled={!mergeInto || actionBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-violet-700 disabled:opacity-60"
                  >
                    {actionBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Merge
                  </button>
                  <button type="button" onClick={() => setMergeFrom(null)} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {confirmDelete && editingTask && (
        <ConfirmDialog
          title="Delete this task?"
          message={`"${titleOf(editingTask)}" will be permanently removed. Its history stays in the audit log.`}
          confirmLabel="Delete task"
          tone="danger"
          loading={actionBusy}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
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