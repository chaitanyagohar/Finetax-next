"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ClipboardList, Loader2, Minus, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Meter } from "@/components/ui/kit";

export type ChecklistItem = {
  id: string;
  task_id: string;
  label: string;
  kind: "document" | "step";
  status: "pending" | "received" | "not_needed";
  sort_order: number;
};

export function checklistProgress(items: Pick<ChecklistItem, "status">[]) {
  const needed = items.filter((i) => i.status !== "not_needed").length;
  const done = items.filter((i) => i.status === "received").length;
  return { needed, done, pending: needed - done };
}

/** Documents and steps for one task. Anyone who can see the task can tick items off. */
export default function TaskChecklist({ taskId, readOnly = false, onChange }: { taskId: string; readOnly?: boolean; onChange?: (pending: number) => void }) {
  const [supabase] = useState(() => createClient());
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("task_checklist_items")
      .select("id, task_id, label, kind, status, sort_order")
      .eq("task_id", taskId)
      .order("sort_order")
      .order("created_at");
    if (err) setError(err.message);
    setItems((data || []) as ChecklistItem[]);
  }, [supabase, taskId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (items) onChange?.(checklistProgress(items).pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  async function setStatus(item: ChecklistItem, status: ChecklistItem["status"]) {
    setBusyId(item.id);
    setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, status } : i)) || prev);
    const { error: err } = await supabase.from("task_checklist_items").update({ status }).eq("id", item.id);
    setBusyId(null);
    if (err) {
      setError(err.message);
      load();
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    setBusyId("new");
    const { error: err } = await supabase
      .from("task_checklist_items")
      .insert({ task_id: taskId, label, sort_order: (items?.length || 0) + 1 });
    setBusyId(null);
    if (err) return setError(err.message);
    setNewLabel("");
    load();
  }

  async function remove(item: ChecklistItem) {
    setBusyId(item.id);
    const { error: err } = await supabase.from("task_checklist_items").delete().eq("id", item.id);
    setBusyId(null);
    if (err) return setError(err.message);
    setItems((prev) => prev?.filter((i) => i.id !== item.id) || prev);
  }

  if (items === null) return <div className="skeleton h-16" />;
  const p = checklistProgress(items);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-text-main">
          <ClipboardList className="h-4 w-4 text-text-muted" /> Checklist
          {p.needed > 0 && (
            <span className={`text-[11px] font-medium ${p.pending ? "text-amber-700" : "text-emerald-700"}`}>
              {p.pending ? `${p.done} of ${p.needed} received` : "Everything received"}
            </span>
          )}
        </p>
        {p.needed > 0 && (
          <div className="w-24">
            <Meter value={p.needed ? p.done / p.needed : 0} tone={p.pending ? "warn" : "good"} />
          </div>
        )}
      </div>

      {items.length > 0 && (
        <ul className="list-in divide-y divide-border overflow-hidden rounded-lg border border-border">
          {items.map((item) => (
            <li key={item.id} className="group flex items-center gap-2 px-3 py-2 text-xs">
              <button
                type="button"
                disabled={readOnly || busyId === item.id}
                onClick={() => setStatus(item, item.status === "received" ? "pending" : "received")}
                aria-label={item.status === "received" ? `Mark ${item.label} as pending` : `Mark ${item.label} as received`}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                  item.status === "received" ? "border-emerald-500 bg-emerald-500 text-white" : "border-border bg-surface hover:border-accent"
                }`}
              >
                {item.status === "received" && <Check className="h-3.5 w-3.5" />}
              </button>
              <span className={`flex-1 ${item.status === "not_needed" ? "text-text-muted line-through" : item.status === "received" ? "text-text-muted" : "text-text-main"}`}>
                {item.label}
              </span>
              {!readOnly && (
                <span className="flex gap-1 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => setStatus(item, item.status === "not_needed" ? "pending" : "not_needed")}
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-text-muted hover:bg-surface-alt"
                    title={item.status === "not_needed" ? "Needed after all" : "Not needed for this task"}
                  >
                    {item.status === "not_needed" ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                  </button>
                  <button type="button" onClick={() => remove(item)} className="rounded p-0.5 text-text-muted hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${item.label}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <form onSubmit={add} className="flex gap-2">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            maxLength={200}
            placeholder={items.length ? "Add another document or step" : "Add documents to collect or steps to follow"}
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
          <button type="submit" disabled={!newLabel.trim() || busyId === "new"} className="rounded-lg border border-border px-3 text-xs font-semibold hover:bg-surface-alt disabled:opacity-50">
            {busyId === "new" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
          </button>
        </form>
      )}
      {error && <p className="text-[11px] font-medium text-rose-600">{error}</p>}
    </div>
  );
}
