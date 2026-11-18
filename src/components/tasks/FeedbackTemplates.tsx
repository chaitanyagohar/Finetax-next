"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, Check, Edit2, Loader2, Plus, Settings2, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { Modal } from "@/components/ui/Modal";

export type TemplateBox = "feedback" | "notes";

export type FeedbackTemplate = {
  id: string;
  body: string;
  used_for: "both" | TemplateBox;
  task_type_id: string | null;
  sort_order: number;
};

const USED_FOR_LABELS: Record<FeedbackTemplate["used_for"], string> = {
  both: "Feedback and execution notes",
  feedback: "Reviewer feedback only",
  notes: "Execution notes only",
};

const MAX_BODY = 300;

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

/** The firm's templates, in the order administrators set. */
export function useFeedbackTemplates() {
  const [supabase] = useState(() => createClient());
  const [templates, setTemplates] = useState<FeedbackTemplate[]>([]);

  const fetchTemplates = useCallback(async () => {
    const { data } = await supabase
      .from("feedback_templates")
      .select("id, body, used_for, task_type_id, sort_order")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    return (data || []) as FeedbackTemplate[];
  }, [supabase]);

  const reload = useCallback(async () => setTemplates(await fetchTemplates()), [fetchTemplates]);

  useEffect(() => {
    let cancelled = false;
    fetchTemplates().then((rows) => {
      if (!cancelled) setTemplates(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchTemplates]);

  return { templates, reload };
}

function linesOf(text: string): string[] {
  return text.split("\n").map((l) => l.trim());
}

/**
 * One-click lines above a feedback or notes box. Templates for the task's own type come first,
 * then the general ones; templates tied to other task types are not shown.
 */
export function TemplateChips({
  templates,
  box,
  taskTypeId,
  value,
  onChange,
  disabled,
  onManage,
}: {
  templates: FeedbackTemplate[];
  box: TemplateBox;
  taskTypeId?: string | null;
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
  /** Shown to administrators: opens the template manager. */
  onManage?: () => void;
}) {
  const shown = useMemo(() => {
    const forBox = templates.filter((t) => t.used_for === "both" || t.used_for === box);
    const own = taskTypeId ? forBox.filter((t) => t.task_type_id === taskTypeId) : [];
    return [...own, ...forBox.filter((t) => !t.task_type_id)];
  }, [templates, box, taskTypeId]);

  if (shown.length === 0 && !onManage) return null;
  const used = new Set(linesOf(value));

  function add(body: string) {
    if (used.has(body.trim())) return;
    const current = value.replace(/\s+$/, "");
    onChange(current ? `${current}\n${body}` : body);
  }

  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1">
      {shown.map((t) => {
        const isUsed = used.has(t.body.trim());
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => add(t.body)}
            disabled={disabled || isUsed}
            title={isUsed ? "Already added" : "Add this line"}
            className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition disabled:cursor-default ${
              isUsed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-surface text-text-main hover:border-navy/40 hover:bg-navy/5"
            } ${disabled && !isUsed ? "opacity-50" : ""}`}
          >
            {isUsed ? <Check className="h-3 w-3 shrink-0" /> : <Plus className="h-3 w-3 shrink-0 text-text-muted" />}
            <span className="truncate">{t.body}</span>
          </button>
        );
      })}
      {onManage && (
        <button type="button" onClick={onManage} className="inline-flex items-center gap-1 px-1 text-[11px] font-semibold text-navy hover:underline">
          <Settings2 className="h-3 w-3" /> Manage templates
        </button>
      )}
    </div>
  );
}

type TaskTypeOption = { id: string; name: string; is_active: boolean };

/** Administrators add, edit, order and delete the firm's templates. */
export function FeedbackTemplatesManager({
  templates,
  onClose,
  onChanged,
}: {
  templates: FeedbackTemplate[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [taskTypes, setTaskTypes] = useState<TaskTypeOption[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [usedFor, setUsedFor] = useState<FeedbackTemplate["used_for"]>("both");
  const [taskTypeId, setTaskTypeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<FeedbackTemplate | null>(null);

  useEffect(() => {
    supabase
      .from("task_types")
      .select("id, name, is_active")
      .order("name", { ascending: true })
      .then(({ data }) => setTaskTypes((data || []) as TaskTypeOption[]));
  }, [supabase]);

  const typeName = useMemo(() => Object.fromEntries(taskTypes.map((t) => [t.id, t.name])), [taskTypes]);

  function resetForm() {
    setEditingId(null);
    setBody("");
    setUsedFor("both");
    setTaskTypeId("");
    setError("");
  }

  function edit(t: FeedbackTemplate) {
    setEditingId(t.id);
    setBody(t.body);
    setUsedFor(t.used_for);
    setTaskTypeId(t.task_type_id || "");
    setError("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const text = body.trim();
    if (!text) return setError("Write the line staff should be able to add.");
    if (text.length > MAX_BODY) return setError(`Keep it under ${MAX_BODY} characters.`);

    const payload = { body: text, used_for: usedFor, task_type_id: taskTypeId || null };
    setBusy(true);
    const nextOrder = templates.reduce((max, t) => Math.max(max, t.sort_order), 0) + 1;
    const { error: err } = editingId
      ? await supabase.from("feedback_templates").update(payload).eq("id", editingId)
      : await supabase.from("feedback_templates").insert([{ ...payload, sort_order: nextOrder }]);
    setBusy(false);
    if (err) return setError(err.message);
    logAuditEvent(editingId ? "UPDATE_FEEDBACK_TEMPLATE" : "CREATE_FEEDBACK_TEMPLATE", "FEEDBACK_TEMPLATES", editingId || undefined, { body: text });
    resetForm();
    onChanged();
  }

  async function move(index: number, to: number) {
    const a = templates[index];
    const b = templates[to];
    if (!a || !b || busy) return;
    setBusy(true);
    // Renumber the whole list so equal or missing positions can't make the swap a no-op
    const reordered = templates.map((t) => t.id);
    reordered[index] = b.id;
    reordered[to] = a.id;
    const results = await Promise.all(reordered.map((id, i) => supabase.from("feedback_templates").update({ sort_order: i + 1 }).eq("id", id)));
    setBusy(false);
    const failed = results.find((r) => r.error);
    if (failed?.error) setError(failed.error.message);
    onChanged();
  }

  async function remove(t: FeedbackTemplate) {
    setBusy(true);
    const { error: err } = await supabase.from("feedback_templates").delete().eq("id", t.id);
    setBusy(false);
    setConfirmDelete(null);
    if (err) return setError(err.message);
    logAuditEvent("DELETE_FEEDBACK_TEMPLATE", "FEEDBACK_TEMPLATES", t.id, { body: t.body });
    if (editingId === t.id) resetForm();
    onChanged();
  }

  return (
    <Modal
      title="Feedback templates"
      subtitle="Lines reviewers and staff can add with one click above the reviewer feedback and execution notes boxes. The text stays editable after adding."
      onClose={() => !busy && onClose()}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4 text-xs">
        <form onSubmit={save} className="space-y-3 rounded-lg border border-border bg-surface-alt p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-navy">{editingId ? "Edit template" : "Add a template"}</p>
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-2.5 font-medium text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div>
            <label className={labelClass}>Text *</label>
            <input value={body} onChange={(e) => setBody(e.target.value)} maxLength={MAX_BODY} className={inputClass} placeholder="e.g. Attach the payment challan." />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Show above</label>
              <select value={usedFor} onChange={(e) => setUsedFor(e.target.value as FeedbackTemplate["used_for"])} className={inputClass}>
                {Object.entries(USED_FOR_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Only for this task</label>
              <select value={taskTypeId} onChange={(e) => setTaskTypeId(e.target.value)} className={inputClass}>
                <option value="">All tasks</option>
                {taskTypes
                  .filter((t) => t.is_active || t.id === taskTypeId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
              <p className="mt-1 text-[10px] text-text-muted">A template tied to a task is shown first on that task and hidden on others.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white transition hover:bg-navy-light disabled:opacity-60">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingId ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {editingId ? "Save changes" : "Add template"}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface">
                Cancel
              </button>
            )}
          </div>
        </form>

        {templates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-text-muted">No templates yet. Add the lines your team types most often.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {templates.map((t, idx) => (
              <li key={t.id} className={`flex items-center gap-2 p-2.5 ${editingId === t.id ? "bg-navy/5" : ""}`}>
                <div className="flex shrink-0 flex-col">
                  <button type="button" onClick={() => move(idx, idx - 1)} disabled={idx === 0 || busy} className="text-text-muted hover:text-navy disabled:opacity-30" aria-label="Move up">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(idx, idx + 1)}
                    disabled={idx === templates.length - 1 || busy}
                    className="text-text-muted hover:text-navy disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-text-main">{t.body}</p>
                  <p className="text-[10px] text-text-muted">
                    {USED_FOR_LABELS[t.used_for]}
                    {t.task_type_id ? ` · only for ${typeName[t.task_type_id] || "a task in the list"}` : ""}
                  </p>
                </div>
                <button type="button" onClick={() => edit(t)} className="rounded-md p-1.5 text-navy transition hover:bg-surface-alt" title="Edit">
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                {confirmDelete?.id === t.id ? (
                  <span className="inline-flex items-center gap-1">
                    <button type="button" onClick={() => remove(t)} disabled={busy} className="rounded-md bg-danger px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-60">
                      Delete
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-md p-1 text-text-muted hover:bg-surface-alt" aria-label="Keep">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(t)} className="rounded-md p-1.5 text-danger transition hover:bg-danger/10" title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
