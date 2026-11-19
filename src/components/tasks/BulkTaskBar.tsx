"use client";

import { useState } from "react";
import { CalendarClock, Flag, Loader2, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ui/Modal";

type Person = { id: string; name: string; is_active?: boolean; is_reviewer?: boolean; role?: string };

const select =
  "rounded-lg border border-white/15 bg-white/10 px-2 py-1.5 text-[11px] font-semibold text-white outline-none hover:bg-white/15 focus:ring-2 focus:ring-accent/40 [&>option]:text-text-main";

/** Change many tasks at once. Each row still goes through the same database checks as a single edit. */
export default function BulkTaskBar({
  ids,
  team,
  canDelete,
  onDone,
  onClear,
  showToast,
}: {
  ids: string[];
  team: Person[];
  canDelete: boolean;
  onDone: () => void;
  onClear: () => void;
  showToast: (type: "success" | "error", message: string) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = team.filter((p) => p.is_active !== false);
  const reviewers = active.filter((p) => p.role === "admin" || p.is_reviewer);
  const n = ids.length;

  async function apply(patch: Record<string, unknown>, done: string) {
    setBusy(true);
    const { error } = await supabase.from("tasks").update(patch).in("id", ids);
    setBusy(false);
    if (error) return showToast("error", error.message);
    showToast("success", done);
    onDone();
  }

  async function remove() {
    setBusy(true);
    const { error } = await supabase.from("tasks").delete().in("id", ids);
    setBusy(false);
    setConfirmDelete(false);
    if (error) return showToast("error", error.message);
    showToast("success", `${n} task${n === 1 ? "" : "s"} deleted.`);
    onDone();
  }

  return (
    <>
      <div
        role="toolbar"
        aria-label="Bulk actions"
        className="animate-pop-in fixed inset-x-3 bottom-4 z-40 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl bg-navy px-4 py-3 text-white shadow-2xl ring-1 ring-white/10 lg:left-64"
      >
        <span className="mr-1 text-xs font-semibold">
          {n} selected
        </span>
        <label className="inline-flex items-center gap-1">
          <UserRound className="h-3.5 w-3.5 text-white/60" />
          <select aria-label="Assign selected tasks to" className={select} value="" disabled={busy} onChange={(e) => e.target.value && apply({ assigned_to: e.target.value }, `${n} task${n === 1 ? "" : "s"} reassigned.`)}>
            <option value="">Assign to…</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3.5 w-3.5 text-white/60" />
          <select
            aria-label="Reviewer for selected tasks"
            className={select}
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && apply({ reviewer_id: e.target.value === "__none" ? null : e.target.value }, "Reviewer updated.")}
          >
            <option value="">Reviewer…</option>
            <option value="__none">No reviewer</option>
            {reviewers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1">
          <Flag className="h-3.5 w-3.5 text-white/60" />
          <select aria-label="Priority for selected tasks" className={select} value="" disabled={busy} onChange={(e) => e.target.value && apply({ priority: e.target.value }, "Priority updated.")}>
            <option value="">Priority…</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5 text-white/60" />
          <input
            type="date"
            aria-label="Internal deadline for selected tasks"
            disabled={busy}
            onChange={(e) => e.target.value && apply({ due_date: e.target.value }, "Internal deadline updated.")}
            className={`${select} [color-scheme:dark]`}
          />
        </label>
        <span className="ml-auto flex items-center gap-1">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {canDelete && (
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy} className="rounded-lg p-1.5 text-rose-300 hover:bg-white/10" aria-label="Delete selected tasks">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={onClear} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10" aria-label="Clear selection">
            <X className="h-4 w-4" />
          </button>
        </span>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${n} task${n === 1 ? "" : "s"}?`}
          message="Their time logs and discussion are deleted with them. This cannot be undone."
          confirmLabel="Delete"
          tone="danger"
          loading={busy}
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
