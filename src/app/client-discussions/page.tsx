"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Trash2,
  X,
  MessageSquare,
  CheckCircle,
  Clock,
  Phone,
  Users,
  Mail,
  MessageCircle,
  Video,
  MapPin,
  CalendarClock,
  AlertCircle,
  Loader2,
  CheckCircle2,
  History,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Client } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import ClientPicker, { clientLabel } from "@/components/ui/ClientPicker";
import { formatDate, getInitials, localISODate } from "@/lib/format";

type ClientRow = Client & Record<string, any>;

const MODES: { value: string; icon: LucideIcon }[] = [
  { value: "Call", icon: Phone },
  { value: "Meeting", icon: Users },
  { value: "Email", icon: Mail },
  { value: "WhatsApp", icon: MessageCircle },
  { value: "Video Call", icon: Video },
  { value: "Office Visit", icon: MapPin },
];
const MODE_ICON: Record<string, LucideIcon> = Object.fromEntries(MODES.map((m) => [m.value, m.icon]));

const VIEWS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending Follow-ups" },
  { key: "overdue", label: "Overdue" },
  { key: "done", label: "Done" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

/* ---------------- Helpers (read new columns, fall back to legacy ones) ---------------- */

function followUpOf(d: any): string {
  const v = String(d.follow_up_date || d.followUpDate || "");
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "";
}
function isDone(d: any): boolean {
  return Boolean(d.follow_up_completed ?? d.followUpDone ?? false);
}
function clientIdOf(d: any): string {
  return d.client_id || d.clientId || "";
}

/* ---------------- Page ---------------- */

export default function ClientDiscussionsPage() {
  const currentUser = useCurrentUser();
  const me = currentUser?.id || "";
  const isAdmin = !!currentUser?.isAdmin;
  const [supabase] = useState(() => createClient());

  const [discussions, setDiscussions] = useState<any[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [team, setTeam] = useState<{ id: string; name: string; is_active?: boolean }[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewKey>("all");
  const [selectedClientFilter, setSelectedClientFilter] = useState("");
  const [handlerFilter, setHandlerFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Form State
  const [clientId, setClientId] = useState("");
  const [date, setDate] = useState(localISODate());
  const [mode, setMode] = useState("Call");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [handledBy, setHandledBy] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpDone, setFollowUpDone] = useState(false);

  const today = localISODate();
  const monthStart = today.slice(0, 8) + "01";

  useEffect(() => {
    loadData();
  }, []);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4500);
  }

  async function loadData(showSpinner = true) {
    if (showSpinner) setLoading(true);
    const [dRes, cRes, pRes] = await Promise.all([
      supabase.from("discussions").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name, organization_name, status, phone, email").order("name", { ascending: true }),
      supabase.from("profiles").select("id, name, is_active").order("name", { ascending: true }),
    ]);

    if (dRes.error) {
      console.error("Fetch Discussions Error:", dRes.error);
      showToast("error", "Could not load discussions. Please refresh the page.");
    } else if (dRes.data) {
      setDiscussions(dRes.data);
    }
    if (cRes.data) setClients(cRes.data as ClientRow[]);
    if (pRes.data) setTeam(pRes.data as any[]);
    setLoading(false);
  }

  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [String(c.id), c])), [clients]);
  const teamName = (id?: string) => team.find((t) => String(t.id) === String(id))?.name || "";
  const handlerOf = (d: any) => teamName(d.handled_by) || d.staff || "";
  const canDelete = (d: any) => isAdmin || (!!d?.created_by && d.created_by === me);

  /* ---------------- Analytics & filtering ---------------- */

  const stats = useMemo(() => {
    const pending = discussions.filter((d) => followUpOf(d) && !isDone(d));
    return {
      thisMonth: discussions.filter((d) => String(d.date || "") >= monthStart).length,
      dueToday: pending.filter((d) => followUpOf(d) === today).length,
      overdue: pending.filter((d) => followUpOf(d) < today).length,
      upcoming: pending.filter((d) => followUpOf(d) > today).length,
      completedThisMonth: discussions.filter(
        (d) => isDone(d) && String(d.follow_up_completed_at || d.date || "").slice(0, 10) >= monthStart
      ).length,
    };
  }, [discussions, today, monthStart]);

  const viewCounts: Record<ViewKey, number> = {
    all: discussions.length,
    pending: discussions.filter((d) => followUpOf(d) && !isDone(d)).length,
    overdue: stats.overdue,
    done: discussions.filter((d) => followUpOf(d) && isDone(d)).length,
  };

  const filteredDiscussions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return discussions.filter((d) => {
      const fu = followUpOf(d);
      if (view === "pending" && !(fu && !isDone(d))) return false;
      if (view === "overdue" && !(fu && !isDone(d) && fu < today)) return false;
      if (view === "done" && !(fu && isDone(d))) return false;
      if (selectedClientFilter && clientIdOf(d) !== selectedClientFilter) return false;
      if (handlerFilter === "mine" && d.handled_by !== me) return false;
      if (handlerFilter && handlerFilter !== "mine" && String(d.handled_by) !== handlerFilter) return false;
      if (modeFilter && (d.mode || "Call") !== modeFilter) return false;
      if (!q) return true;
      return [d.summary, d.notes, handlerOf(d), clientById[clientIdOf(d)]?.name, clientById[clientIdOf(d)]?.organization_name]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q));
    });
  }, [discussions, search, view, selectedClientFilter, handlerFilter, modeFilter, clientById, today, me, team]);

  // Pending follow-ups sort by due date first; everything else newest first
  const sortedDiscussions = useMemo(() => {
    if (view === "pending" || view === "overdue") {
      return [...filteredDiscussions].sort((a, b) => followUpOf(a).localeCompare(followUpOf(b)));
    }
    return filteredDiscussions;
  }, [filteredDiscussions, view]);

  const hasFilters = !!(search || selectedClientFilter || handlerFilter || modeFilter || view !== "all");

  function clearFilters() {
    setSearch("");
    setSelectedClientFilter("");
    setHandlerFilter("");
    setModeFilter("");
    setView("all");
  }

  /* ---------------- Modal ---------------- */

  function openModal(item?: any) {
    setFormError("");
    if (item) {
      setEditingItem(item);
      setClientId(clientIdOf(item));
      setDate(String(item.date || today).slice(0, 10));
      setMode(item.mode || "Call");
      setSummary(item.summary || "");
      setNotes(item.notes || "");
      setHandledBy(item.handled_by || "");
      setFollowUpDate(followUpOf(item));
      setFollowUpDone(isDone(item));
    } else {
      setEditingItem(null);
      resetForm();
    }
    setIsModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setIsModalOpen(false);
    setEditingItem(null);
    resetForm();
  }

  function resetForm() {
    setClientId(selectedClientFilter || "");
    setDate(today);
    setMode("Call");
    setSummary("");
    setNotes("");
    setHandledBy(me);
    setFollowUpDate("");
    setFollowUpDone(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setFormError("");

    if (!clientId) return setFormError("Please select a client.");
    if (!summary.trim()) return setFormError("Summary is required.");
    if (date > today) return setFormError("The discussion date cannot be in the future.");
    if (followUpDate && followUpDate < date) return setFormError("The follow-up date cannot be before the discussion date.");

    const payload = {
      client_id: clientId,
      date,
      mode,
      summary: summary.trim(),
      notes: notes.trim(),
      handled_by: handledBy || null,
      follow_up_date: followUpDate || null,
      follow_up_completed: followUpDate ? followUpDone : false,
    };

    setSaving(true);
    try {
      if (editingItem) {
        const { error } = await supabase.from("discussions").update(payload).eq("id", editingItem.id);
        if (error) throw error;
        logAuditEvent("UPDATE_DISCUSSION", "DISCUSSIONS", editingItem.id, { client: clientById[clientId]?.name, followUpDone: payload.follow_up_completed });
        showToast("success", "Discussion updated.");
      } else {
        const { data, error } = await supabase.from("discussions").insert([payload]).select().single();
        if (error || !data) throw error || new Error("Could not log the discussion.");
        logAuditEvent("CREATE_DISCUSSION", "DISCUSSIONS", data.id, { client: clientById[clientId]?.name, mode });
        showToast("success", followUpDate ? `Discussion logged. Follow-up set for ${formatDate(followUpDate)}.` : "Discussion logged.");
      }

      setIsModalOpen(false);
      setEditingItem(null);
      resetForm();
      loadData(false);
    } catch (err: any) {
      setFormError(err?.message || "Could not save this discussion.");
    } finally {
      setSaving(false);
    }
  }

  async function markFollowUpDone(d: any, e?: React.MouseEvent) {
    e?.stopPropagation();
    setMarkingId(d.id);
    const { error } = await supabase.from("discussions").update({ follow_up_completed: true }).eq("id", d.id);
    setMarkingId(null);
    if (error) return showToast("error", error.message);
    logAuditEvent("COMPLETE_FOLLOW_UP", "DISCUSSIONS", d.id, { client: clientById[clientIdOf(d)]?.name });
    showToast("success", "Follow-up marked as done.");
    loadData(false);
  }

  async function handleDelete() {
    if (!editingItem) return;
    setActionBusy(true);
    const { error } = await supabase.from("discussions").delete().eq("id", editingItem.id);
    setActionBusy(false);
    setConfirmDelete(false);
    if (error) return showToast("error", "Could not delete this entry. Only its author or an administrator can delete it.");
    logAuditEvent("DELETE_DISCUSSION", "DISCUSSIONS", editingItem.id, { summary: editingItem.summary });
    showToast("success", "Discussion deleted.");
    setIsModalOpen(false);
    setEditingItem(null);
    loadData(false);
  }

  /* ---------------- Client history (inside the form) ---------------- */

  const clientHistory = useMemo(() => {
    if (!clientId) return [];
    return discussions.filter((d) => clientIdOf(d) === clientId && d.id !== editingItem?.id).slice(0, 5);
  }, [clientId, discussions, editingItem]);

  /* ---------------- Render ---------------- */

  function followUpBadge(d: any) {
    const fu = followUpOf(d);
    if (!fu) return <span className="text-text-muted">—</span>;
    if (isDone(d)) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          <CheckCircle className="h-3 w-3" /> Done
        </span>
      );
    }
    const overdue = fu < today;
    const dueToday = fu === today;
    return (
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
          overdue
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : dueToday
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-blue-200 bg-blue-50 text-blue-700"
        }`}
      >
        {overdue ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
        {dueToday ? "Today" : formatDate(fu)}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <MessageSquare className="h-5 w-5 text-navy" /> Client Discussions
          </h2>
          <p className="mt-1 text-xs text-text-muted">Every call, meeting and message with clients, with follow-ups that never slip.</p>
        </div>
        <button
          type="button"
          onClick={() => openModal()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light sm:w-auto"
        >
          <Plus className="h-4 w-4" /> Log Discussion
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">This Month</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-navy">{stats.thisMonth}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy/10 text-navy">
              <MessageSquare className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">Client interactions logged</p>
        </div>

        <button
          type="button"
          onClick={() => setView("pending")}
          className="rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition hover:border-navy/30 hover:shadow-md"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Due Today</p>
              <p className={`mt-1.5 text-2xl font-bold tracking-tight ${stats.dueToday ? "text-amber-700" : "text-text-main"}`}>{stats.dueToday}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <CalendarClock className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">{stats.upcoming} more scheduled later</p>
        </button>

        <button
          type="button"
          onClick={() => setView("overdue")}
          className="rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition hover:border-navy/30 hover:shadow-md"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Overdue Follow-ups</p>
              <p className={`mt-1.5 text-2xl font-bold tracking-tight ${stats.overdue ? "text-rose-600" : "text-emerald-700"}`}>{stats.overdue}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
              <AlertCircle className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">{stats.overdue ? "Click to view and clear them" : "All caught up"}</p>
        </button>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Completed</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-emerald-700">{stats.completedThisMonth}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">Follow-ups closed this month</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-alt p-0.5 text-xs font-semibold">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setView(v.key)}
                  className={`rounded-md px-2.5 py-1.5 transition ${view === v.key ? "bg-surface text-navy shadow-sm" : "text-text-muted hover:text-text-main"}`}
                >
                  {v.label}
                  <span className="ml-1 text-[10px] font-medium text-text-muted">{viewCounts[v.key]}</span>
                </button>
              ))}
            </div>
            <div className="relative w-full lg:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Search summary, notes, client..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
              />
            </div>
            <span className="text-[11px] text-text-muted lg:ml-auto">
              Showing {sortedDiscussions.length} of {discussions.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={selectedClientFilter}
              onChange={(e) => setSelectedClientFilter(e.target.value)}
              className="max-w-[200px] rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy"
            >
              <option value="">All clients</option>
                            {[...clients]
                .filter((c) => c.status !== "Merged")
                .sort((a, b) => clientLabel(a).localeCompare(clientLabel(b)))
                .map((c) => (
                  <option key={c.id} value={c.id}>{clientLabel(c)}</option>
                ))}
            </select>
            <select value={handlerFilter} onChange={(e) => setHandlerFilter(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
              <option value="">Everyone</option>
              <option value="mine">Handled by me</option>
              {team
                .filter((t) => t.is_active !== false)
                .map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
            </select>
            <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
              <option value="">All modes</option>
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.value}</option>
              ))}
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
            <Loader2 className="h-4 w-4 animate-spin" /> Loading client discussions...
          </div>
        ) : sortedDiscussions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <MessageSquare className="h-6 w-6 text-text-muted" />
            <p className="text-xs text-text-muted">{discussions.length === 0 ? "No discussions logged yet." : "No discussions match this view."}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Discussion</th>
                  <th>Handled By</th>
                  <th>Follow-up</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedDiscussions.map((d) => {
                  const c = clientById[clientIdOf(d)];
                  const ModeIcon = MODE_ICON[d.mode || "Call"] || MessageSquare;
                  const handler = handlerOf(d);
                  const pending = followUpOf(d) && !isDone(d);
                  return (
                    <tr key={d.id} className="cursor-pointer transition hover:bg-surface-alt" onClick={() => openModal(d)}>
                      <td className="whitespace-nowrap font-medium text-text-main">{formatDate(d.date)}</td>
                      <td>
                        <p className="font-semibold text-navy">{c?.organization_name || c?.name || "—"}</p>
                        {c?.organization_name && <p className="text-[10px] text-text-muted">{c.name}</p>}
                      </td>
                      <td className="max-w-md">
                        <div className="flex items-start gap-1.5">
                          <ModeIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" aria-label={d.mode || "Call"} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-text-main">{d.summary}</p>
                            {d.notes && <p className="truncate text-[10px] text-text-muted">{d.notes}</p>}
                          </div>
                        </div>
                      </td>
                      <td>
                        {handler ? (
                          <span className="flex items-center gap-1.5 whitespace-nowrap">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy/10 text-[9px] font-bold text-navy">{getInitials(handler)}</span>
                            {handler}
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td>{followUpBadge(d)}</td>
                      <td className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                        {pending && (
                          <button
                            type="button"
                            onClick={(e) => markFollowUpDone(d, e)}
                            disabled={markingId === d.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                          >
                            {markingId === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                            Mark done
                          </button>
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

      {/* ================= Log / Edit Discussion ================= */}
      {isModalOpen && (
        <Modal
          title={editingItem ? "Edit Discussion" : "Log Discussion"}
          subtitle={
            editingItem
              ? `Logged ${editingItem.created_at ? formatDate(editingItem.created_at) : formatDate(editingItem.date)}${
                  editingItem.created_by ? ` by ${teamName(editingItem.created_by) || "a team member"}` : ""
                }`
              : "Record what was discussed and set a follow-up if needed."
          }
          onClose={closeModal}
          maxWidth={clientId ? "max-w-4xl" : "max-w-xl"}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {editingItem && canDelete(editingItem) && (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                )}
              </div>
              <div className="flex gap-2 sm:ml-auto">
                <button type="button" onClick={closeModal} className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt sm:flex-none">
                  Cancel
                </button>
                <button
                  type="submit"
                  form="discussion-form"
                  disabled={saving}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-60 sm:flex-none"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save
                </button>
              </div>
            </div>
          }
        >
          <div className={`grid grid-cols-1 gap-6 ${clientId ? "lg:grid-cols-5" : ""}`}>
            <form id="discussion-form" onSubmit={handleSubmit} className={`space-y-4 ${clientId ? "lg:col-span-3" : ""}`}>
              {formError && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs font-medium text-danger">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Client *</label>
                  <ClientPicker clients={clients as any} value={clientId} onChange={setClientId} />
                </div>
                <div>
                  <label className={labelClass}>Date *</label>
                  <input type="date" required max={today} value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
                </div>
              </div>

              <div>
                <label className={labelClass}>Mode of Contact</label>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {MODES.map((m) => {
                    const Icon = m.icon;
                    const active = mode === m.value;
                    return (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => setMode(m.value)}
                        className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-[10px] font-semibold transition ${
                          active ? "border-navy bg-navy/5 text-navy" : "border-border text-text-muted hover:bg-surface-alt"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {m.value}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className={labelClass}>Summary *</label>
                <input
                  type="text"
                  required
                  maxLength={200}
                  placeholder="What was discussed, in one line"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Notes / Details</label>
                <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="Decisions, documents requested, amounts quoted..." />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Handled By</label>
                  <select value={handledBy} onChange={(e) => setHandledBy(e.target.value)} className={inputClass}>
                    <option value="">— Select team member —</option>
                    {team
                      .filter((t) => t.is_active !== false || String(t.id) === String(handledBy))
                      .map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                  </select>
                  {editingItem && !editingItem.handled_by && editingItem.staff && (
                    <p className="mt-1 text-[10px] text-text-muted">Previously recorded as "{editingItem.staff}"</p>
                  )}
                </div>
                <div>
                  <label className={labelClass}>Follow-up Date</label>
                  <input
                    type="date"
                    min={date || undefined}
                    value={followUpDate}
                    onChange={(e) => {
                      setFollowUpDate(e.target.value);
                      if (!e.target.value) setFollowUpDone(false);
                    }}
                    className={inputClass}
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {[
                      { label: "+1 day", days: 1 },
                      { label: "+3 days", days: 3 },
                      { label: "+1 week", days: 7 },
                    ].map((q) => (
                      <button
                        key={q.label}
                        type="button"
                        onClick={() => {
                          const base = new Date();
                          base.setDate(base.getDate() + q.days);
                          setFollowUpDate(localISODate(base));
                        }}
                        className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold text-text-muted transition hover:bg-surface-alt"
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {followUpDate && (
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-alt p-2.5 text-xs font-medium text-text-main">
                  <input type="checkbox" checked={followUpDone} onChange={(e) => setFollowUpDone(e.target.checked)} className="h-4 w-4 accent-navy" />
                  Follow-up completed
                  {editingItem?.follow_up_completed_at && followUpDone && (
                    <span className="text-[10px] text-text-muted">on {formatDate(editingItem.follow_up_completed_at)}</span>
                  )}
                </label>
              )}
            </form>

            {/* Client history */}
            {clientId && (
              <div className="space-y-3 lg:col-span-2 lg:border-l lg:border-border lg:pl-6">
                <h4 className="flex items-center gap-1.5 text-xs font-bold text-text-main">
                  <History className="h-4 w-4 text-navy" /> Recent with {clientById[clientId]?.name || "this client"}
                </h4>
                {clientById[clientId]?.phone && (
                  <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
                    <Phone className="h-3 w-3" /> {clientById[clientId].phone}
                  </p>
                )}
                {clientHistory.length === 0 ? (
                  <p className="text-[11px] italic text-text-muted">No earlier discussions with this client.</p>
                ) : (
                  <div className="space-y-2">
                    {clientHistory.map((h) => {
                      const Icon = MODE_ICON[h.mode || "Call"] || MessageSquare;
                      return (
                        <div key={h.id} className="rounded-lg border border-border p-2.5 text-[11px]">
                          <div className="flex items-center justify-between gap-2 text-text-muted">
                            <span className="flex items-center gap-1">
                              <Icon className="h-3 w-3" /> {formatDate(h.date)}
                            </span>
                            <span>{handlerOf(h) || "—"}</span>
                          </div>
                          <p className="mt-1 font-medium text-text-main">{h.summary}</p>
                          {followUpOf(h) && <div className="mt-1">{followUpBadge(h)}</div>}
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

      {confirmDelete && editingItem && (
        <ConfirmDialog
          title="Delete this discussion?"
          message="This entry will be permanently removed. The deletion is recorded in the audit log."
          confirmLabel="Delete entry"
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