"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, Edit2, Loader2, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { Modal } from "@/components/ui/Modal";

export type TaskCategory = { id: string; name: string; color: string; sort_order: number; is_active: boolean };

export const CATEGORY_COLORS: Record<string, { chip: string; dot: string }> = {
  slate: { chip: "border-slate-200 bg-slate-100 text-slate-700", dot: "bg-slate-400" },
  blue: { chip: "border-blue-200 bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  emerald: { chip: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  amber: { chip: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  rose: { chip: "border-rose-200 bg-rose-50 text-rose-700", dot: "bg-rose-500" },
  violet: { chip: "border-violet-200 bg-violet-50 text-violet-700", dot: "bg-violet-500" },
  cyan: { chip: "border-cyan-200 bg-cyan-50 text-cyan-700", dot: "bg-cyan-500" },
  orange: { chip: "border-orange-200 bg-orange-50 text-orange-700", dot: "bg-orange-500" },
  lime: { chip: "border-lime-200 bg-lime-50 text-lime-700", dot: "bg-lime-500" },
  pink: { chip: "border-pink-200 bg-pink-50 text-pink-700", dot: "bg-pink-500" },
};
const COLOR_KEYS = Object.keys(CATEGORY_COLORS);
const FALLBACK = ["GST", "Income Tax", "TDS", "ROC", "Audit", "Accounting", "Payroll", "Other"];

/** Loads the firm's category list. activeNames is what forms should offer. */
export function useTaskCategories() {
  const [supabase] = useState(() => createClient());
  const [categories, setCategories] = useState<TaskCategory[]>([]);

  const reload = useCallback(async () => {
    const { data } = await supabase.from("task_categories").select("*").order("sort_order", { ascending: true }).order("name", { ascending: true });
    setCategories((data || []) as TaskCategory[]);
  }, [supabase]);

  useEffect(() => {
    reload();
  }, [reload]);

  const activeNames = useMemo(() => {
    const names = categories.filter((c) => c.is_active).map((c) => c.name);
    return names.length ? names : FALLBACK;
  }, [categories]);

  const colorOf = useCallback(
    (name?: string | null) => CATEGORY_COLORS[categories.find((c) => c.name === name)?.color || "slate"] || CATEGORY_COLORS.slate,
    [categories]
  );

  return { categories, activeNames, colorOf, reload };
}

export function CategoryBadge({ name, colorOf }: { name?: string | null; colorOf: (n?: string | null) => { chip: string } }) {
  if (!name) return <span className="text-text-muted">—</span>;
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${colorOf(name).chip}`}>{name}</span>;
}

export function TaskCategoriesManager({
  categories,
  usageTasks,
  onClose,
  onChanged,
}: {
  categories: TaskCategory[];
  usageTasks: { category?: string | null }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [name, setName] = useState("");
  const [color, setColor] = useState("blue");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const usage = useMemo(() => {
    const map: Record<string, number> = {};
    usageTasks.forEach((t) => {
      if (t.category) map[t.category] = (map[t.category] || 0) + 1;
    });
    return map;
  }, [usageTasks]);

  const sorted = useMemo(() => [...categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)), [categories]);
  const visible = sorted.filter((c) => showArchived || c.is_active);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    const clean = name.trim();
    if (!clean) return setError("Enter a category name.");
    setBusy(true);
    const maxOrder = Math.max(0, ...categories.filter((c) => c.sort_order < 999).map((c) => c.sort_order));
    const { error: err } = await supabase.from("task_categories").insert([{ name: clean, color, sort_order: maxOrder + 10 }]);
    setBusy(false);
    if (err) return setError(err.code === "23505" ? `"${clean}" already exists.` : err.message);
    logAuditEvent("CREATE_TASK_CATEGORY", "TASK_CATEGORIES", undefined, { name: clean });
    setName("");
    flash(`"${clean}" added.`);
    onChanged();
  }

  async function saveRename(c: TaskCategory) {
    const clean = editName.trim();
    if (!clean || clean === c.name) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    setError("");
    const { data, error: err } = await supabase.rpc("rename_task_category", { p_id: c.id, p_new_name: clean });
    setBusy(false);
    if (err) return setError(err.message);
    logAuditEvent("RENAME_TASK_CATEGORY", "TASK_CATEGORIES", c.id, { from: c.name, to: clean, tasks_updated: data });
    setEditingId(null);
    flash(`Renamed to "${clean}". ${data ?? 0} task(s) updated.`);
    onChanged();
  }

  async function setColorFor(c: TaskCategory, col: string) {
    const { error: err } = await supabase.from("task_categories").update({ color: col }).eq("id", c.id);
    if (err) return setError(err.message);
    onChanged();
  }

  async function toggleActive(c: TaskCategory) {
    const { error: err } = await supabase.from("task_categories").update({ is_active: !c.is_active }).eq("id", c.id);
    if (err) return setError(err.message);
    logAuditEvent(c.is_active ? "ARCHIVE_TASK_CATEGORY" : "RESTORE_TASK_CATEGORY", "TASK_CATEGORIES", c.id, { name: c.name });
    onChanged();
  }

  async function move(c: TaskCategory, dir: -1 | 1) {
    const list = [...visible];
    const idx = list.findIndex((x) => x.id === c.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= list.length) return;
    [list[idx], list[target]] = [list[target], list[idx]];
    setBusy(true);
    const updates = list
      .map((row, i) => ({ row, order: (i + 1) * 10 }))
      .filter(({ row, order }) => row.sort_order !== order)
      .map(({ row, order }) => supabase.from("task_categories").update({ sort_order: order }).eq("id", row.id));
    const results = await Promise.all(updates);
    setBusy(false);
    const failed = results.find((r) => r.error);
    if (failed?.error) return setError(failed.error.message);
    onChanged();
  }

  return (
    <Modal title="Task Categories" subtitle="Used across tasks, the task list, packages and the calendar." onClose={() => !busy && onClose()} maxWidth="max-w-2xl">
      <div className="space-y-4 text-xs">
        <form onSubmit={add} className="space-y-2 rounded-lg border border-border bg-surface-alt p-3">
          <div className="flex flex-wrap gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category, e.g. FEMA / Valuation" maxLength={60} className="min-w-[200px] flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-navy" />
            <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase text-text-muted">Colour</span>
            {COLOR_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setColor(k)}
                className={`h-5 w-5 rounded-full ${CATEGORY_COLORS[k].dot} ${color === k ? "ring-2 ring-navy ring-offset-2" : ""}`}
                aria-label={k}
              />
            ))}
          </div>
        </form>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-2.5 font-medium text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && <p className="rounded-lg bg-emerald-50 p-2 font-semibold text-emerald-700">{notice}</p>}

        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-navy" /> Show archived
          </label>
          <span className="text-[11px] text-text-muted">Use the arrows to set the order shown in dropdowns.</span>
        </div>

        <div className="divide-y divide-border rounded-lg border border-border">
          {visible.map((c, i) => (
            <div key={c.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${c.is_active ? "" : "opacity-60"}`}>
              <div className="flex flex-col">
                <button type="button" onClick={() => move(c, -1)} disabled={busy || i === 0} className="text-text-muted hover:text-navy disabled:opacity-30" aria-label="Move up">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => move(c, 1)} disabled={busy || i === visible.length - 1} className="text-text-muted hover:text-navy disabled:opacity-30" aria-label="Move down">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>

              {editingId === c.id ? (
                <div className="flex flex-1 items-center gap-1.5">
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRename(c);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="flex-1 rounded-md border border-border px-2 py-1 text-sm outline-none focus:border-navy"
                    maxLength={60}
                  />
                  <button type="button" onClick={() => saveRename(c)} className="rounded-md p-1 text-emerald-600 hover:bg-emerald-50" aria-label="Save">
                    <Check className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className="rounded-md p-1 text-text-muted hover:bg-surface-alt" aria-label="Cancel">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${CATEGORY_COLORS[c.color]?.chip || CATEGORY_COLORS.slate.chip}`}>
                  {c.name}
                  {!c.is_active && " (archived)"}
                </span>
              )}

              <span className="text-[10px] text-text-muted">{usage[c.name] || 0} task(s)</span>

              <div className="ml-auto flex items-center gap-1">
                <div className="hidden items-center gap-1 sm:flex">
                  {COLOR_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setColorFor(c, k)}
                      className={`h-3.5 w-3.5 rounded-full ${CATEGORY_COLORS[k].dot} ${c.color === k ? "ring-2 ring-navy ring-offset-1" : "opacity-60 hover:opacity-100"}`}
                      aria-label={`Colour ${k}`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(c.id);
                    setEditName(c.name);
                  }}
                  className="rounded-md p-1.5 text-navy hover:bg-surface-alt"
                  title="Rename"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => toggleActive(c)} className="rounded-md p-1.5 text-text-muted hover:bg-surface-alt" title={c.is_active ? "Archive" : "Restore"}>
                  {c.is_active ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-text-muted">Renaming updates every task, task-list entry, package service and calendar event that uses the category. Archived categories stay on old tasks but can't be chosen for new ones.</p>
      </div>
    </Modal>
  );
}