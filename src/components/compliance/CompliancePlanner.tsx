"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { btn, field } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";

type Suggestion = {
  task_type_id: string;
  name: string;
  category: string;
  recurrence: string | null;
  reason: string;
  already_set_up: boolean;
  next_period: string | null;
  next_due: string | null;
};

type Member = { id: string; name: string; role: string; is_reviewer: boolean; is_active: boolean; invite_pending: boolean };

/**
 * Sets up a client's recurring returns from their registrations (GSTIN, TAN, entity type).
 * Each chosen return gets its next due task; from then on it repeats like any recurring task.
 */
export default function CompliancePlanner({
  clientId,
  clientName,
  defaultAssignee,
  onClose,
  onDone,
}: {
  clientId: string;
  clientName: string;
  defaultAssignee?: string | null;
  onClose: () => void;
  onDone?: (created: number) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<Suggestion[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [assignee, setAssignee] = useState(defaultAssignee || "");
  const [reviewer, setReviewer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [libraryEmpty, setLibraryEmpty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, m, t] = await Promise.all([
        supabase.rpc("compliance_suggestions", { p_client: clientId }),
        supabase.rpc("firm_members"),
        supabase.from("task_types").select("id", { count: "exact", head: true }).not("applies_to", "is", null),
      ]);
      if (cancelled) return;
      if (s.error) setError(s.error.message);
      const list = (s.data || []) as Suggestion[];
      setRows(list);
      setPicked(new Set(list.filter((r) => !r.already_set_up).map((r) => r.task_type_id)));
      setMembers(((m.data || []) as Member[]).filter((x) => x.is_active && !x.invite_pending));
      setLibraryEmpty((t.count || 0) === 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, clientId]);

  const reviewers = useMemo(() => members.filter((m) => m.role === "admin" || m.is_reviewer), [members]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    setError("");
    if (!assignee) return setError("Choose who will do the work.");
    setBusy(true);
    const { data, error: err } = await supabase.rpc("apply_compliance_plan", {
      p_client: clientId,
      p_type_ids: [...picked],
      p_assignee: assignee,
      p_reviewer: reviewer || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    onDone?.(Number(data) || 0);
    onClose();
  }

  const fresh = (rows || []).filter((r) => !r.already_set_up);

  return (
    <Modal
      title={`Compliance plan for ${clientName}`}
      subtitle="Picked from the client's GSTIN, TAN and type. Each return is created for its next due period and then repeats by itself."
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-text-muted">{picked.size} selected</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btn.secondary}>
              Not now
            </button>
            <button type="button" onClick={apply} disabled={busy || picked.size === 0} className={btn.primary}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarCheck className="h-3.5 w-3.5" />} Create {picked.size || ""} recurring task
              {picked.size === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      }
    >
      {rows === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-text-muted">
          <Sparkles className="mx-auto mb-2 h-5 w-5 text-accent" />
          {libraryEmpty
            ? "Your task list has no standard returns yet. An administrator can add them from Tasks → Compliance setup."
            : "Nothing matches this client yet. Add their GSTIN, TAN or entity type to get suggestions."}
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {rows.map((r) => (
              <li key={r.task_type_id}>
                <label className={`flex items-center gap-3 px-3 py-2.5 ${r.already_set_up ? "opacity-60" : "cursor-pointer hover:bg-surface-alt"}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--color-accent)]"
                    disabled={r.already_set_up}
                    checked={picked.has(r.task_type_id)}
                    onChange={() => toggle(r.task_type_id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-text-main">{r.name}</span>
                    <span className="block text-[11px] text-text-muted">
                      {r.reason} · {r.recurrence || "One-time"}
                    </span>
                  </span>
                  <span className="text-right text-[11px] text-text-muted">
                    {r.already_set_up ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Already running
                      </span>
                    ) : r.next_due ? (
                      <>
                        <span className="block font-semibold text-text-main">{formatDate(r.next_due)}</span>
                        {r.next_period}
                      </>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {fresh.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={field.label} htmlFor="plan-assignee">Assign to</label>
                <select id="plan-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field.input}>
                  <option value="">Choose…</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={field.label} htmlFor="plan-reviewer">Reviewer</label>
                <select id="plan-reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} className={field.input}>
                  <option value="">No reviewer</option>
                  {reviewers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-xs font-medium text-rose-600">{error}</p>}
    </Modal>
  );
}
