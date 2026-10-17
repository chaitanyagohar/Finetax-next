"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, ArrowRightLeft, CheckCircle2, Clock, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { formatDate, localISODate } from "@/lib/format";

type Person = { id: string; name: string; is_active?: boolean };

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

function when(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(localISODate(d))} ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}

/* ---------------- Request / direct transfer dialog ---------------- */

export function TransferDialog({
  mode,
  task,
  team,
  onClose,
  onDone,
}: {
  mode: "request" | "direct";
  task: Record<string, any>;
  team: Person[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [handover, setHandover] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const options = team.filter((p) => p.is_active !== false && p.id !== task.assigned_to && p.id !== task.reviewer_id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError("");
    if (mode === "direct" && !to) return setError("Choose who the task should go to.");
    if (reason.trim().length < 3) return setError("Please give a reason.");
    if (mode === "request" && handover.trim().length < 10) return setError("Write handover notes so the next person knows exactly where things stand.");

    setSaving(true);
    const { error: err } =
      mode === "request"
        ? await supabase.rpc("request_task_transfer", { p_task: task.id, p_to: to || null, p_reason: reason.trim(), p_handover: handover.trim() })
        : await supabase.rpc("transfer_task", { p_task: task.id, p_to: to, p_reason: reason.trim(), p_handover: handover.trim() });
    setSaving(false);
    if (err) return setError(err.message);

    const toName = team.find((p) => p.id === to)?.name;
    onDone(mode === "request" ? "Transfer requested. You'll be notified of the decision." : `Task transferred to ${toName}.`);
  }

  return (
    <Modal
      title={mode === "request" ? "Request a transfer" : "Transfer this task"}
      subtitle={`${task.title}${task.period ? ` · ${task.period}` : ""}`}
      onClose={() => !saving && onClose()}
      maxWidth="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
            Cancel
          </button>
          <button
            type="submit"
            form="transfer-form"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
            {mode === "request" ? "Send request" : "Transfer now"}
          </button>
        </div>
      }
    >
      <form id="transfer-form" onSubmit={submit} className="space-y-3 text-xs">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-2.5 font-medium text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div>
          <label className={labelClass}>{mode === "request" ? "Suggest who should take it (optional)" : "Transfer to *"}</label>
          <select value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
            <option value="">{mode === "request" ? "— Let the approver decide —" : "— Choose a person —"}</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {task.reviewer_id && <p className="mt-1 text-[10px] text-text-muted">The task's reviewer isn't listed (maker-checker rule).</p>}
        </div>
        <div>
          <label className={labelClass}>Reason *</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            className={inputClass}
            placeholder={mode === "request" ? "e.g. On leave next week / workload / needs audit expertise" : "e.g. Workload balancing"}
          />
        </div>
        <div>
          <label className={labelClass}>Handover notes {mode === "request" ? "*" : "(recommended)"}</label>
          <textarea
            rows={5}
            value={handover}
            onChange={(e) => setHandover(e.target.value)}
            maxLength={2000}
            className={inputClass}
            placeholder="What's done, what's pending, documents received or awaited, login/portal status, client contact notes..."
          />
        </div>
        <p className="text-[10px] text-text-muted">Time already logged stays with the original person. The transfer and notes are kept permanently on the task.</p>
      </form>
    </Modal>
  );
}

/* ---------------- Transfer history + pending decision (inside the task) ---------------- */

export function TransferHistory({
  taskId,
  team,
  me,
  canManage,
  reviewerId,
  onChanged,
}: {
  taskId: string;
  team: Person[];
  me: string;
  canManage: boolean;
  reviewerId?: string | null;
  onChanged: (closeTask: boolean) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const nameOf = (id?: string | null) => team.find((p) => p.id === id)?.name || "—";

  useEffect(() => {
    load();
  }, [taskId]);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("task_transfers").select("*").eq("task_id", taskId).order("created_at", { ascending: false });
    const list = data || [];
    setRows(list);
    const pending = list.find((r: any) => r.status === "pending");
    setChoice(pending?.to_user || "");
    setLoading(false);
  }

  const pending = rows.find((r) => r.status === "pending");
  const history = rows.filter((r) => r.status !== "pending");
  const options = team.filter((p) => p.is_active !== false && p.id !== pending?.from_user && p.id !== reviewerId);

  async function decide(approve: boolean) {
    if (!pending || busy) return;
    setError("");
    if (approve && !choice) return setError("Choose who the task should go to.");
    setBusy(true);
    const { error: err } = await supabase.rpc("decide_task_transfer", {
      p_transfer: pending.id,
      p_approve: approve,
      p_to: approve ? choice : null,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    onChanged(approve);
    if (!approve) load();
  }

  async function withdraw() {
    if (!pending || busy) return;
    setBusy(true);
    const { error: err } = await supabase.rpc("cancel_task_transfer", { p_transfer: pending.id });
    setBusy(false);
    if (err) return setError(err.message);
    load();
    onChanged(false);
  }

  if (loading || rows.length === 0) return null;

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h4 className="flex items-center gap-1.5 text-xs font-bold text-text-main">
        <ArrowRightLeft className="h-4 w-4 text-navy" /> Transfers
      </h4>

      {pending && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
          <p className="font-semibold text-amber-800">
            <Clock className="mr-1 inline h-3.5 w-3.5" />
            {nameOf(pending.requested_by)} requested a transfer{pending.to_user ? ` to ${nameOf(pending.to_user)}` : ""} · {when(pending.created_at)}
          </p>
          <p className="text-amber-900">
            <span className="font-semibold">Reason:</span> {pending.reason}
          </p>
          <p className="whitespace-pre-wrap rounded bg-surface p-2 text-text-main">
            <span className="font-semibold">Handover:</span> {pending.handover_notes}
          </p>
          {error && <p className="font-medium text-rose-700">{error}</p>}

          {canManage && (
            <div className="space-y-2 border-t border-amber-200 pt-2">
              <div className="flex flex-wrap gap-2">
                <select value={choice} onChange={(e) => setChoice(e.target.value)} className="min-w-[180px] flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-navy">
                  <option value="">— Give it to —</option>
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note (optional)"
                  maxLength={300}
                  className="min-w-[160px] flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-navy"
                />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => decide(false)} disabled={busy} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[11px] font-semibold transition hover:bg-surface-alt disabled:opacity-60">
                  Decline
                </button>
                <button
                  type="button"
                  onClick={() => decide(true)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Approve transfer
                </button>
              </div>
            </div>
          )}
          {!canManage && pending.requested_by === me && (
            <button type="button" onClick={withdraw} disabled={busy} className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 underline">
              <X className="h-3 w-3" /> Withdraw request
            </button>
          )}
        </div>
      )}

      {history.map((r) => (
        <div key={r.id} className="rounded-lg border border-border p-2.5 text-[11px]">
          <p className="flex flex-wrap items-center gap-1 font-semibold text-text-main">
            {nameOf(r.from_user)} <ArrowRight className="h-3 w-3" /> {r.to_user ? nameOf(r.to_user) : "—"}
            <span
              className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                r.status === "approved" || r.status === "completed"
                  ? "bg-emerald-50 text-emerald-700"
                  : r.status === "declined"
                  ? "bg-rose-50 text-rose-700"
                  : "bg-surface-alt text-text-muted"
              }`}
            >
              {r.kind === "direct" ? "Direct" : r.status}
            </span>
          </p>
          <p className="text-text-muted">
            {when(r.decided_at || r.created_at)}
            {r.decided_by ? ` · by ${nameOf(r.decided_by)}` : ""}
          </p>
          <p className="mt-1 text-text-main">
            <span className="font-semibold">Reason:</span> {r.reason}
          </p>
          {r.handover_notes && <p className="mt-1 whitespace-pre-wrap rounded bg-surface-alt p-1.5 text-text-main">{r.handover_notes}</p>}
          {r.decision_note && <p className="mt-1 italic text-text-muted">Note: {r.decision_note}</p>}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Banner: requests waiting for my decision ---------------- */

export function TransferRequestsBanner({
  me,
  isAdmin,
  team,
  refreshKey,
  onOpenTask,
}: {
  me: string;
  isAdmin: boolean;
  team: Person[];
  refreshKey: number;
  onOpenTask: (taskId: string) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const nameOf = (id?: string | null) => team.find((p) => p.id === id)?.name || "—";

  useEffect(() => {
    if (!me) return;
    supabase
      .from("task_transfers")
      .select("id, task_id, from_user, to_user, requested_by, reason, created_at, tasks(title, period, reviewer_id, assigned_by)")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        const mine = (data || []).filter((r: any) => {
          const t = Array.isArray(r.tasks) ? r.tasks[0] : r.tasks;
          return isAdmin || t?.reviewer_id === me || t?.assigned_by === me;
        });
        setRows(mine);
      });
  }, [me, isAdmin, refreshKey]);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 shadow-sm">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-amber-800">
          <ArrowRightLeft className="h-4 w-4" />
          {rows.length} transfer request{rows.length === 1 ? "" : "s"} waiting for your decision
        </span>
        <span className="text-xs font-semibold text-amber-700">{open ? "Hide" : "Review"}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-amber-200 p-3">
          {rows.map((r) => {
            const t = Array.isArray(r.tasks) ? r.tasks[0] : r.tasks;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpenTask(r.task_id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-amber-200 bg-surface px-3 py-2 text-left text-xs transition hover:border-amber-400"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-navy">
                    {t?.title}
                    {t?.period ? ` · ${t.period}` : ""}
                  </span>
                  <span className="block truncate text-[11px] text-text-muted">
                    {nameOf(r.requested_by)}
                    {r.to_user ? ` → ${nameOf(r.to_user)}` : ""} · {r.reason}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-semibold text-amber-700">Open →</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}