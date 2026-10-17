"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, ListOrdered, Loader2, Play, RotateCcw, Save, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { formatDate, localISODate } from "@/lib/format";

type QTask = Record<string, any>;

const PRIORITY_W: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
const PRIORITY_DOTS: Record<string, string> = { High: "bg-rose-500", Medium: "bg-amber-400", Low: "bg-slate-300" };
const STAGE_STYLES: Record<string, string> = {
  Assigned: "bg-slate-100 text-slate-700 border-slate-200",
  "In Progress": "bg-blue-50 text-blue-700 border-blue-200",
  "Submitted for Review": "bg-violet-50 text-violet-700 border-violet-200",
  "Changes Required": "bg-amber-50 text-amber-700 border-amber-200",
};

function earliestDeadline(t: QTask): string {
  return [t.official_due_date, t.due_date].filter(Boolean).sort()[0] || "9999-12-31";
}

/** Same order as the database: new (unplaced) tasks first by deadline, then the saved order. */
export function orderQueue(list: QTask[]): QTask[] {
  return [...list].sort((a, b) => {
    const ar = a.queue_rank != null;
    const br = b.queue_rank != null;
    if (ar !== br) return ar ? 1 : -1;
    if (ar && br && a.queue_rank !== b.queue_rank) return a.queue_rank - b.queue_rank;
    const d = earliestDeadline(a).localeCompare(earliestDeadline(b));
    if (d !== 0) return d;
    const p = (PRIORITY_W[a.priority] ?? 1) - (PRIORITY_W[b.priority] ?? 1);
    if (p !== 0) return p;
    return String(a.due_date || "9999").localeCompare(String(b.due_date || "9999"));
  });
}

function fmtMin(mins: number): string {
  const m = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export default function WorkQueue({
  tasks,
  team,
  me,
  isAdmin,
  clientText,
  onOpen,
  onChanged,
  showToast,
}: {
  tasks: QTask[];
  team: { id: string; name: string; is_active?: boolean }[];
  me: string;
  isAdmin: boolean;
  clientText: (t: QTask) => string;
  onOpen: (t: QTask) => void;
  onChanged: () => void;
  showToast: (type: "success" | "error", message: string) => void;
}) {
  const [supabase] = useState(() => createClient());
  const today = localISODate();
  const activeTeam = team.filter((t) => t.is_active !== false);
  const [person, setPerson] = useState(me);

  const base = useMemo(() => orderQueue(tasks.filter((t) => t.assigned_to === person && t.stage !== "Approved")), [tasks, person]);
  const [order, setOrder] = useState<QTask[]>(base);
  const [dirty, setDirty] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);

  useEffect(() => {
    setOrder(base);
    setDirty(false);
  }, [base]);

  const canEdit = isAdmin;
  const hasRanks = base.some((t) => t.queue_rank != null);
  const openCountFor = (id: string) => tasks.filter((t) => t.assigned_to === id && t.stage !== "Approved").length;

  function moveTo(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    const { error } = await supabase.rpc("set_work_queue", { p_user: person, p_task_ids: order.map((t) => t.id) });
    setSaving(false);
    if (error) return showToast("error", error.message);
    logAuditEvent("SET_WORK_QUEUE", "TASKS", undefined, { person: team.find((t) => t.id === person)?.name, tasks: order.length });
    showToast("success", "Work order saved. They've been notified.");
    setDirty(false);
    onChanged();
  }

  async function reset() {
    setSaving(true);
    const { error } = await supabase.rpc("reset_work_queue", { p_user: person });
    setSaving(false);
    if (error) return showToast("error", error.message);
    showToast("success", "Order reset to automatic (deadline, then priority).");
    onChanged();
  }

  async function start(t: QTask) {
    setStartingId(t.id);
    const { error } = await supabase.from("tasks").update({ stage: "In Progress" }).eq("id", t.id);
    setStartingId(null);
    if (error) return showToast("error", error.message);
    logAuditEvent("UPDATE_TASK", "TASKS", t.id, { stage_changed_to: "In Progress", via: "work_queue" });
    onChanged();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-navy" />
          {canEdit ? (
            <select
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold shadow-sm outline-none focus:border-navy"
            >
              {activeTeam.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id === me ? `${t.name} (you)` : t.name} · {openCountFor(t.id)} open
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm font-semibold text-text-main">My Queue</span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${hasRanks ? "bg-violet-50 text-violet-700" : "bg-surface-alt text-text-muted"}`}>
            {hasRanks ? "Custom order" : "Automatic order"}
          </span>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            {dirty && (
              <button type="button" onClick={() => { setOrder(base); setDirty(false); }} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-surface-alt">
                Discard
              </button>
            )}
            {hasRanks && !dirty && (
              <button type="button" onClick={reset} disabled={saving} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-surface-alt disabled:opacity-60">
                <RotateCcw className="h-3.5 w-3.5" /> Reset to automatic
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1 rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save order
            </button>
          </div>
        )}
      </div>

      <p className="text-[11px] text-text-muted">
        {canEdit
          ? "Drag tasks (or use the arrows) into the order they should be done, then save. New tasks appear at the top until you place them."
          : "Work from the top. Your administrator sets this order; until they do, it follows the nearest deadline and priority."}
      </p>

      {order.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-text-muted">No open tasks in this queue.</div>
      ) : (
        <ol className="space-y-1.5">
          {order.map((t, idx) => {
            const isNew = hasRanks && t.queue_rank == null;
            const internalOver = t.due_date && t.due_date < today;
            const statOver = t.official_due_date && t.official_due_date < today;
            const logged = Number(t.time_spent_minutes || 0);
            const est = Number(t.estimated_minutes || 0);
            const over = est > 0 && logged > est;
            return (
              <li
                key={t.id}
                draggable={canEdit}
                onDragStart={() => setDragId(t.id)}
                onDragOver={(e) => {
                  if (!canEdit || !dragId || dragId === t.id) return;
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!dragId) return;
                  moveTo(order.findIndex((x) => x.id === dragId), idx);
                  setDragId(null);
                }}
                onDragEnd={() => setDragId(null)}
                className={`flex items-center gap-3 rounded-lg border bg-surface p-2.5 text-xs transition ${
                  dragId === t.id ? "opacity-50" : ""
                } ${idx === 0 ? "border-navy/40 shadow-sm" : "border-border"} ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
              >
                {canEdit && <GripVertical className="h-4 w-4 shrink-0 text-text-muted" />}
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${idx === 0 ? "bg-navy text-white" : "bg-surface-alt text-text-main"}`}>
                  {idx + 1}
                </span>
                <button type="button" onClick={() => onOpen(t)} className="min-w-0 flex-1 text-left">
                  <p className="flex items-center gap-1.5 truncate font-semibold text-navy">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOTS[t.priority || "Medium"]}`} />
                    <span className="truncate">
                      {t.title}
                      {t.period ? ` · ${t.period}` : ""}
                    </span>
                    {isNew && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                        <Sparkles className="h-2.5 w-2.5" /> New
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-text-muted">{clientText(t)}</p>
                  <p className="mt-0.5 text-[10px]">
                    <span className={internalOver ? "font-semibold text-rose-600" : "text-text-muted"}>Int {t.due_date ? formatDate(t.due_date) : "—"}</span>
                    <span className="text-text-muted"> · </span>
                    <span className={statOver ? "font-semibold text-rose-600" : t.official_due_date ? "text-text-main" : "text-text-muted"}>
                      Stat {t.official_due_date ? formatDate(t.official_due_date) : "—"}
                    </span>
                    {(est > 0 || logged > 0) && (
                      <span className={over ? "font-semibold text-rose-600" : "text-text-muted"}>
                        {" "}
                        · {fmtMin(logged)}
                        {est > 0 ? ` / ${fmtMin(est)}` : ""}
                      </span>
                    )}
                  </p>
                </button>
                <span className={`hidden shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:inline ${STAGE_STYLES[t.stage] || STAGE_STYLES.Assigned}`}>{t.stage}</span>
                {t.assigned_to === me && ["Assigned", "Changes Required"].includes(t.stage) && (
                  <button
                    type="button"
                    onClick={() => start(t)}
                    disabled={startingId === t.id}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {startingId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Start
                  </button>
                )}
                {canEdit && (
                  <div className="flex shrink-0 flex-col">
                    <button type="button" onClick={() => moveTo(idx, idx - 1)} disabled={idx === 0} className="text-text-muted hover:text-navy disabled:opacity-30" aria-label="Move up">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => moveTo(idx, idx + 1)} disabled={idx === order.length - 1} className="text-text-muted hover:text-navy disabled:opacity-30" aria-label="Move down">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}