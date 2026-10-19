"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Edit2, Loader2, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { PROBLEMS } from "@/lib/help/troubleshooting";

export type KbDraft = { title?: string; phrases?: string; solution?: string };

const inputClass = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";
const EMPTY = { id: "", title: "", area: "General", phrases: "", keywords: "", pages: "", solution: "", admin_only: false, staff_note: "", escalate: false, is_active: true };

export default function KnowledgeBaseManager({ draft, onClose }: { draft: KbDraft | null; onClose: () => void }) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [form, setForm] = useState<typeof EMPTY | null>(draft ? { ...EMPTY, title: draft.title || "", phrases: draft.phrases || "", solution: draft.solution || "" } : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const [k, s] = await Promise.all([
      supabase.from("support_kb").select("*").order("updated_at", { ascending: false }),
      supabase.from("support_answer_stats").select("*"),
    ]);
    setRows(k.data || []);
    setStats(Object.fromEntries((s.data || []).map((r: any) => [r.answer_id, r])));
  }
  useEffect(() => {
    load();
  }, []);

  const needsWork = useMemo(
    () =>
      [...PROBLEMS.map((p) => ({ id: p.id, title: p.title })), ...rows.map((r) => ({ id: `kb:${r.id}`, title: r.title }))]
        .map((a) => ({ ...a, s: stats[a.id] }))
        .filter((a) => a.s && a.s.not_solved > 0)
        .sort((a, b) => b.s.not_solved - a.s.not_solved)
        .slice(0, 8),
    [rows, stats]
  );

  const list = (v: string) => v.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

  async function save() {
    if (!form) return;
    setError("");
    if (form.title.trim().length < 5) return setError("Write a clear title, as a user would describe the problem.");
    if (list(form.phrases).length === 0) return setError("Add at least one way people describe this problem.");
    if (form.solution.trim().length < 10) return setError("Write the solution steps.");
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      area: form.area.trim() || "General",
      phrases: list(form.phrases),
      keywords: list(form.keywords),
      pages: list(form.pages),
      solution: form.solution.trim(),
      admin_only: form.admin_only,
      staff_note: form.staff_note.trim() || null,
      escalate: form.escalate,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = form.id ? await supabase.from("support_kb").update(payload).eq("id", form.id) : await supabase.from("support_kb").insert([payload]);
    setSaving(false);
    if (err) return setError(err.message);
    setForm(null);
    load();
  }

  async function remove(id: string) {
    await supabase.from("support_kb").delete().eq("id", id);
    load();
  }

  return (
    <Modal title="Support knowledge base" subtitle={`${PROBLEMS.filter((p) => !p.hidden).length} built-in answers · ${rows.length} added by your team. New answers work within a minute.`} onClose={onClose} maxWidth="max-w-4xl">
      <div className="space-y-4 text-xs">
        {error && (
          <p className="flex items-center gap-1.5 font-medium text-rose-600">
            <AlertCircle className="h-4 w-4" /> {error}
          </p>
        )}

        {form ? (
          <div className="space-y-3 rounded-lg border border-border bg-surface-alt p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className={labelClass}>Problem (as a user would say it) *</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputClass} placeholder="e.g. GST portal login not working from the app" />
              </div>
              <div>
                <label className={labelClass}>Area</label>
                <input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} className={inputClass} placeholder="Tasks, Time, Invoices..." />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Ways people describe it (one per line) *</label>
                <textarea rows={4} value={form.phrases} onChange={(e) => setForm({ ...form, phrases: e.target.value })} className={inputClass} placeholder={"timer not starting\ntimer nahi chala"} />
              </div>
              <div className="space-y-3">
                <div>
                  <label className={labelClass}>Extra keywords (comma separated)</label>
                  <input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} className={inputClass} placeholder="timer, start, clock" />
                </div>
                <div>
                  <label className={labelClass}>Usually on pages (comma separated)</label>
                  <input value={form.pages} onChange={(e) => setForm({ ...form, pages: e.target.value })} className={inputClass} placeholder="/tasks, /time-tracking" />
                </div>
              </div>
            </div>
            <div>
              <label className={labelClass}>Solution * (numbered steps; **bold** for button names)</label>
              <textarea rows={7} value={form.solution} onChange={(e) => setForm({ ...form, solution: e.target.value })} className={inputClass} />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.admin_only} onChange={(e) => setForm({ ...form, admin_only: e.target.checked })} className="accent-navy" /> Fix needs an administrator
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.escalate} onChange={(e) => setForm({ ...form, escalate: e.target.checked })} className="accent-navy" /> Probably a fault (suggest a person)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="accent-navy" /> Active
              </label>
            </div>
            {form.admin_only && (
              <div>
                <label className={labelClass}>What staff should be told</label>
                <input value={form.staff_note} onChange={(e) => setForm({ ...form, staff_note: e.target.value })} className={inputClass} placeholder="Ask an administrator to..." />
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 font-bold text-white disabled:opacity-60">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save answer
              </button>
              <button type="button" onClick={() => setForm(null)} className="rounded-lg border border-border px-4 py-2 font-semibold">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setForm({ ...EMPTY })} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 font-semibold text-white">
            <Plus className="h-4 w-4" /> Add an answer
          </button>
        )}

        {needsWork.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="mb-1.5 font-bold text-amber-800">Answers that often don't solve the problem</p>
            {needsWork.map((a) => (
              <p key={a.id} className="text-amber-900">
                {a.title} · shown {a.s.shown}, solved {a.s.solved}, didn't work {a.s.not_solved}
              </p>
            ))}
            <p className="mt-1.5 text-[10px] text-amber-700">Built-in answers live in src/lib/help/troubleshooting.ts. Add a better answer here, or improve that file.</p>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th>Answer added by your team</th>
                <th>Area</th>
                <th className="text-right">Shown / Solved</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-5 text-center text-text-muted">
                    None yet. Use **Save as answer** on a conversation you've solved, or **Add an answer**.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const s = stats[`kb:${r.id}`];
                  return (
                    <tr key={r.id} className={r.is_active ? "" : "opacity-50"}>
                      <td className="font-semibold text-navy">{r.title}</td>
                      <td>{r.area}</td>
                      <td className="text-right">
                        {s?.shown || 0} / {s?.solved || 0}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setForm({
                              id: r.id,
                              title: r.title,
                              area: r.area,
                              phrases: (r.phrases || []).join("\n"),
                              keywords: (r.keywords || []).join(", "),
                              pages: (r.pages || []).join(", "),
                              solution: r.solution,
                              admin_only: r.admin_only,
                              staff_note: r.staff_note || "",
                              escalate: r.escalate,
                              is_active: r.is_active,
                            })
                          }
                          className="rounded-md p-1.5 text-navy hover:bg-surface-alt"
                          aria-label="Edit"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => remove(r.id)} className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50" aria-label="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}