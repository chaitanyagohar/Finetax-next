"use client";

import { useEffect, useState } from "react";
import { AlertCircle, BellRing, CheckCircle2, Loader2, PlayCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { Modal } from "@/components/ui/Modal";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

type Settings = {
  enabled: boolean;
  not_started_hours: number;
  due_soon_days: number;
  escalate_assigner: boolean;
  overdue_daily: boolean;
  statutory_alert_days: number;
  review_waiting_hours: number;
  work_start: string;
  work_end: string;
  skip_sundays: boolean;
};

export default function ReminderSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt"
      >
        <BellRing className="h-4 w-4 text-navy" /> Reminders
      </button>
      {open && <ReminderSettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ReminderSettingsModal({ onClose }: { onClose: () => void }) {
  const [supabase] = useState(() => createClient());
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    supabase
      .from("reminder_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setS({ ...data, work_start: String(data.work_start).slice(0, 5), work_end: String(data.work_end).slice(0, 5) } as Settings);
      });
  }, []);

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setS((prev) => (prev ? { ...prev, [k]: v } : prev));
  }

  async function save() {
    if (!s) return;
    setError("");
    if (s.work_start >= s.work_end) return setError("Working hours must end after they start.");
    setSaving(true);
    const { error: err } = await supabase
      .from("reminder_settings")
      .update({ ...s, updated_at: new Date().toISOString() })
      .eq("id", 1);
    setSaving(false);
    if (err) return setError(err.message);
    logAuditEvent("UPDATE_REMINDER_SETTINGS", "SETTINGS", undefined, s as any);
    setNotice("Reminder settings saved.");
    window.setTimeout(() => setNotice(""), 3000);
  }

  async function runNow() {
    setRunning(true);
    setError("");
    const { data, error: err } = await supabase.rpc("run_reminders_now");
    setRunning(false);
    if (err) return setError(err.message);
    const d = (data || {}) as any;
    setNotice(
      d.reminders === "outside working hours"
        ? "Checked: outside working hours, so only snoozed reminders were sent."
        : d.reminders === "disabled"
        ? "Checked: reminders are switched off."
        : `Checked: ${d.reminders_sent ?? 0} reminder(s) and ${d.snoozes ?? 0} snoozed popup(s) sent.`
    );
  }

  const Toggle = ({ k, label, hint }: { k: keyof Settings; label: string; hint?: string }) => (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2.5">
      <input type="checkbox" checked={!!s?.[k]} onChange={(e) => set(k, e.target.checked as any)} className="mt-0.5 h-4 w-4 accent-navy" />
      <span>
        <span className="block font-semibold text-text-main">{label}</span>
        {hint && <span className="block text-[11px] text-text-muted">{hint}</span>}
      </span>
    </label>
  );

  return (
    <Modal
      title="Reminders & Escalations"
      subtitle="Checked automatically every 15 minutes during working hours."
      onClose={() => !saving && onClose()}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={runNow}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt disabled:opacity-60"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5 text-navy" />} Run check now
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
              Close
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !s}
              className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
            </button>
          </div>
        </div>
      }
    >
      {!s ? (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading settings...
        </div>
      ) : (
        <div className="space-y-4 text-xs">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-2.5 font-medium text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <p className="flex items-center gap-1.5 rounded-lg bg-emerald-50 p-2.5 font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> {notice}
            </p>
          )}

          <Toggle k="enabled" label="Send task reminders" hint="Snoozed popups and night-time timer clean-up keep working even when this is off." />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>"Not started" reminder after</label>
              <select value={s.not_started_hours} onChange={(e) => set("not_started_hours", Number(e.target.value))} className={inputClass}>
                {[4, 8, 12, 24, 48, 72].map((h) => (
                  <option key={h} value={h}>{h} hours</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>"Deadline approaching" when within</label>
              <select value={s.due_soon_days} onChange={(e) => set("due_soon_days", Number(e.target.value))} className={inputClass}>
                {[0, 1, 2, 3, 5, 7].map((d) => (
                  <option key={d} value={d}>{d === 0 ? "Same day" : `${d} day${d === 1 ? "" : "s"}`} of the internal deadline</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Statutory alert to admins within</label>
              <select value={s.statutory_alert_days} onChange={(e) => set("statutory_alert_days", Number(e.target.value))} className={inputClass}>
                {[1, 2, 3, 5, 7, 10].map((d) => (
                  <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Remind reviewers after waiting</label>
              <select value={s.review_waiting_hours} onChange={(e) => set("review_waiting_hours", Number(e.target.value))} className={inputClass}>
                {[8, 12, 24, 48, 72].map((h) => (
                  <option key={h} value={h}>{h} hours</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Toggle k="escalate_assigner" label="Escalate to the assigner" hint="Tell whoever assigned it (or admins) once when work hasn't started or is overdue." />
            <Toggle k="overdue_daily" label="Daily overdue reminder" hint="Remind the assignee every working day until submitted." />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Working hours from</label>
              <input type="time" value={s.work_start} onChange={(e) => set("work_start", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Until</label>
              <input type="time" value={s.work_end} onChange={(e) => set("work_end", e.target.value)} className={inputClass} />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Toggle k="skip_sundays" label="No reminders on Sundays" />
            </div>
          </div>
          <p className="text-[11px] text-text-muted">
            Each reminder is sent at most once per day per person, so nobody gets flooded. "Run check now" doesn't notify you about your own tasks, so test with a staff login.
          </p>
        </div>
      )}
    </Modal>
  );
}