"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Library, ListChecks, Loader2, Save, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { btn, field } from "@/components/ui/kit";

type TaskType = {
  id: string;
  name: string;
  category: string;
  default_recurrence: string | null;
  applies_to: string | null;
  checklist: string[];
  is_active: boolean;
};

export const APPLIES_TO: { value: string; label: string }[] = [
  { value: "", label: "Chosen by hand" },
  { value: "gst_monthly", label: "GST, monthly filers" },
  { value: "gst_qrmp", label: "GST, QRMP filers" },
  { value: "gst_composition", label: "GST, composition" },
  { value: "gst_any", label: "Any GST registration" },
  { value: "tds", label: "Clients with a TAN" },
  { value: "company", label: "Companies" },
  { value: "llp", label: "LLPs" },
  { value: "individual", label: "Individuals, HUFs, proprietors" },
  { value: "audit_entity", label: "Companies and LLPs" },
  { value: "everyone", label: "Every client" },
];

type Tab = "rules" | "extend";

/** Admin tools: standard returns, who each return applies to, document checklists and due-date extensions. */
export default function ComplianceTools({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<Tab>("rules");
  const [types, setTypes] = useState<TaskType[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { applies_to: string; checklist: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const [extType, setExtType] = useState("");
  const [extPeriod, setExtPeriod] = useState("");
  const [extDate, setExtDate] = useState("");
  const [extNote, setExtNote] = useState("");
  const [periods, setPeriods] = useState<{ period: string; due: string; count: number }[]>([]);
  const [extending, setExtending] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("task_types")
      .select("id, name, category, default_recurrence, applies_to, checklist, is_active")
      .eq("is_active", true)
      .order("category")
      .order("name");
    const list = ((data || []) as TaskType[]).map((t) => ({ ...t, checklist: Array.isArray(t.checklist) ? t.checklist : [] }));
    setTypes(list);
    setDrafts(Object.fromEntries(list.map((t) => [t.id, { applies_to: t.applies_to || "", checklist: t.checklist.join("\n") }])));
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // Open periods for the chosen return, so the admin picks one rather than typing it
  useEffect(() => {
    if (!extType) return setPeriods([]);
    supabase
      .from("tasks")
      .select("period, official_due_date")
      .eq("task_type_id", extType)
      .neq("stage", "Approved")
      .then(({ data }) => {
        const map = new Map<string, { period: string; due: string; count: number }>();
        for (const t of data || []) {
          const key = t.period || "";
          const row = map.get(key) || { period: key, due: t.official_due_date || "", count: 0 };
          row.count += 1;
          map.set(key, row);
        }
        const list = [...map.values()].sort((a, b) => a.due.localeCompare(b.due));
        setPeriods(list);
        setExtPeriod(list[0]?.period ?? "");
      });
  }, [supabase, extType]);

  const dirty = useMemo(() => {
    const out = new Set<string>();
    for (const t of types || []) {
      const d = drafts[t.id];
      if (d && (d.applies_to !== (t.applies_to || "") || d.checklist.trim() !== t.checklist.join("\n").trim())) out.add(t.id);
    }
    return out;
  }, [types, drafts]);

  async function install() {
    setInstalling(true);
    const { data, error } = await supabase.rpc("install_compliance_library");
    setInstalling(false);
    if (error) return setNotice({ tone: "bad", text: error.message });
    setNotice({ tone: "good", text: Number(data) ? `${data} standard returns added to your task list.` : "Your task list already has every standard return." });
    await load();
    onChanged?.();
  }

  async function saveType(t: TaskType) {
    const d = drafts[t.id];
    const checklist = d.checklist
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 30);
    setSavingId(t.id);
    const { error } = await supabase.from("task_types").update({ applies_to: d.applies_to || null, checklist }).eq("id", t.id);
    setSavingId(null);
    if (error) return setNotice({ tone: "bad", text: error.message });
    setNotice({ tone: "good", text: `${t.name} saved. New tasks of this type start with its checklist.` });
    await load();
  }

  async function extend(e: React.FormEvent) {
    e.preventDefault();
    if (!extType || !extDate) return;
    setExtending(true);
    const { data, error } = await supabase.rpc("extend_statutory_due_date", {
      p_type: extType,
      p_period: extPeriod,
      p_new_date: extDate,
      p_note: extNote.trim() || null,
    });
    setExtending(false);
    if (error) return setNotice({ tone: "bad", text: error.message });
    setNotice({ tone: "good", text: `${data} open task${Number(data) === 1 ? "" : "s"} moved to the new due date. Internal deadlines moved by the same number of days.` });
    setExtNote("");
    onChanged?.();
  }

  return (
    <Modal title="Compliance setup" subtitle="Standard returns, who they apply to, document checklists and due-date extensions." onClose={onClose} maxWidth="max-w-4xl">
      <div className="mb-4 inline-flex rounded-lg border border-border bg-surface-alt p-1 text-xs font-semibold">
        {(
          [
            ["rules", "Returns and checklists", ListChecks],
            ["extend", "Due date extension", CalendarClock],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${tab === key ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {notice && (
        <p className={`mb-3 rounded-lg px-3 py-2 text-xs font-medium ${notice.tone === "good" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{notice.text}</p>
      )}

      {tab === "rules" ? (
        <div key="rules" className="animate-content-in space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-accent/20 bg-accent-soft/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Library className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
              <div>
                <p className="text-sm font-semibold text-text-main">Standard Indian returns</p>
                <p className="text-xs text-text-muted">
                  GSTR-1, GSTR-3B, QRMP, CMP-08, GSTR-9, TDS, ITR, AOC-4, MGT-7, DIR-3 KYC and LLP forms, with their deadlines and document checklists.
                  Returns you already have keep your own rules.
                </p>
              </div>
            </div>
            <button type="button" onClick={install} disabled={installing} className={btn.accent}>
              {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Add standard returns
            </button>
          </div>

          {types === null ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-16" />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {types.map((t) => {
                const d = drafts[t.id] || { applies_to: "", checklist: "" };
                return (
                  <li key={t.id} className="grid gap-3 p-3 md:grid-cols-[1fr_200px_1.3fr_auto] md:items-start">
                    <div>
                      <p className="text-sm font-medium text-text-main">{t.name}</p>
                      <p className="text-[11px] text-text-muted">
                        {t.category} · {t.default_recurrence || "One-time"}
                      </p>
                    </div>
                    <select
                      aria-label={`Who ${t.name} applies to`}
                      value={d.applies_to}
                      onChange={(e) => setDrafts({ ...drafts, [t.id]: { ...d, applies_to: e.target.value } })}
                      className={`${field.input} text-xs`}
                    >
                      {APPLIES_TO.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <textarea
                      aria-label={`Checklist for ${t.name}`}
                      rows={Math.min(5, Math.max(2, d.checklist.split("\n").length))}
                      placeholder="Documents or steps, one per line"
                      value={d.checklist}
                      onChange={(e) => setDrafts({ ...drafts, [t.id]: { ...d, checklist: e.target.value } })}
                      className={`${field.input} text-xs`}
                    />
                    <button type="button" onClick={() => saveType(t)} disabled={!dirty.has(t.id) || savingId === t.id} className={btn.secondary}>
                      {savingId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <form key="extend" onSubmit={extend} className="animate-content-in grid gap-4 sm:grid-cols-2">
          <p className="text-xs text-text-muted sm:col-span-2">
            When the government extends a due date, change it once here. Every open task for that return and period gets the new statutory date, and its
            internal deadline moves by the same number of days.
          </p>
          <div>
            <label className={field.label} htmlFor="ext-type">Return</label>
            <select id="ext-type" value={extType} onChange={(e) => setExtType(e.target.value)} className={field.input} required>
              <option value="">Choose…</option>
              {(types || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={field.label} htmlFor="ext-period">Period</label>
            <select id="ext-period" value={extPeriod} onChange={(e) => setExtPeriod(e.target.value)} className={field.input} disabled={!periods.length}>
              {periods.length === 0 && <option value="">No open tasks</option>}
              {periods.map((p) => (
                <option key={p.period} value={p.period}>
                  {(p.period || "No period") + ` · ${p.count} open`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={field.label} htmlFor="ext-date">New due date</label>
            <input id="ext-date" type="date" value={extDate} onChange={(e) => setExtDate(e.target.value)} className={field.input} required />
          </div>
          <div>
            <label className={field.label} htmlFor="ext-note">Notification or circular (optional)</label>
            <input id="ext-note" value={extNote} onChange={(e) => setExtNote(e.target.value)} placeholder="e.g. CBIC notification 12/2026" className={field.input} maxLength={200} />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={extending || !extType || !extDate || !periods.length} className={btn.primary}>
              {extending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />} Extend due date
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
