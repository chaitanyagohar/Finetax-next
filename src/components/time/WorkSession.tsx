"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ClipboardCheck, Coffee, Loader2, Pause, Play, Plus, Square, Timer, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { localISODate } from "@/lib/format";

const IDLE_MS = 10 * 60 * 1000; // 10 minutes without activity pauses the timer
const HEARTBEAT_MS = 2 * 60 * 1000; // presence every 2 minutes
const REVIEW_AFTER_MINUTES = 18 * 60 + 30; // "Your day" prompt from 6:30 PM

function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function minutesText(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h}h ${r}m` : `${h}h`;
}
function elapsedOf(timer: any, nowMs: number): number {
  if (!timer) return 0;
  const end = timer.paused_at ? new Date(timer.paused_at).getTime() : nowMs;
  return (end - new Date(timer.started_at).getTime()) / 1000 - Number(timer.paused_seconds || 0);
}

/** Global work-session manager: presence, the timer bar, idle detection and the end-of-day review. */
export default function WorkSession({ userId }: { userId: string }) {
  const [supabase] = useState(() => createClient());
  const [timer, setTimer] = useState<any | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [idlePrompt, setIdlePrompt] = useState<{ since: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const lastActivity = useRef(Date.now());
  const timerRef = useRef<any | null>(null);
  const idlePausedRef = useRef(false);
  const firstLoad = useRef(true);
  timerRef.current = timer;

  const loadTimer = useCallback(async () => {
    const { data } = await supabase.from("time_timers").select("*").eq("user_id", userId).maybeSingle();
    setTimer(data || null);
    return data || null;
  }, [supabase, userId]);

  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 4000);
  }

  /* ---------- Initial load: catch timers left running while the browser was closed ---------- */
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const t = await loadTimer();
      if (firstLoad.current && t && !t.paused_at && t.last_seen_at && Date.now() - new Date(t.last_seen_at).getTime() > IDLE_MS) {
        await supabase.rpc("pause_timer", { p_since: t.last_seen_at });
        idlePausedRef.current = true;
        setIdlePrompt({ since: t.last_seen_at });
        loadTimer();
      }
      firstLoad.current = false;
    })();
    supabase.rpc("presence_heartbeat", { p_active: true });

    const channel = supabase
      .channel(`timer-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "time_timers" }, () => loadTimer())
      .subscribe();

    const onOpenReview = () => setReviewOpen(true);
    window.addEventListener("finetax:open-day-review", onOpenReview);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("finetax:open-day-review", onOpenReview);
    };
  }, [userId]);

  /* ---------- Activity tracking ---------- */
  useEffect(() => {
    let lastMark = 0;
    const mark = () => {
      const t = Date.now();
      if (t - lastMark < 5000) return;
      lastMark = t;
      lastActivity.current = t;
      const current = timerRef.current;
      if (idlePausedRef.current && current?.paused_at) {
        setIdlePrompt((p) => p || { since: current.paused_at });
      }
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, mark, { passive: true }));
    const onVisible = () => document.visibilityState === "visible" && mark();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, mark));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  /* ---------- Heartbeat + idle check ---------- */
  useEffect(() => {
    if (!userId) return;
    const beat = window.setInterval(() => {
      const active = document.visibilityState === "visible" && Date.now() - lastActivity.current < HEARTBEAT_MS + 30000;
      supabase.rpc("presence_heartbeat", { p_active: active });
    }, HEARTBEAT_MS);

    const idleCheck = window.setInterval(async () => {
      const current = timerRef.current;
      if (!current || current.paused_at) return;
      if (Date.now() - lastActivity.current > IDLE_MS) {
        await supabase.rpc("pause_timer", { p_since: new Date(lastActivity.current).toISOString() });
        idlePausedRef.current = true;
        loadTimer();
      }
    }, 30000);

    return () => {
      window.clearInterval(beat);
      window.clearInterval(idleCheck);
    };
  }, [userId, loadTimer]);

  /* ---------- Clock tick ---------- */
  useEffect(() => {
    if (!timer) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timer]);

  /* ---------- End-of-day prompt ---------- */
  useEffect(() => {
    if (!userId) return;
    const check = async () => {
      const d = new Date();
      const today = localISODate(d);
      if (d.getHours() * 60 + d.getMinutes() < REVIEW_AFTER_MINUTES) return;
      if (window.localStorage.getItem(`finetax:day-review:${userId}:${today}`)) return;
      const [{ data: day }, { count }] = await Promise.all([
        supabase.from("user_activity_days").select("confirmed_at").eq("user_id", userId).eq("day", today).maybeSingle(),
        supabase.from("time_logs").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("log_date", today),
      ]);
      if (day?.confirmed_at) return;
      if ((count || 0) === 0 && !timerRef.current) return;
      window.localStorage.setItem(`finetax:day-review:${userId}:${today}`, "shown");
      setReviewOpen(true);
    };
    const first = window.setTimeout(check, 15000);
    const id = window.setInterval(check, 10 * 60 * 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [userId]);

  /* ---------- Actions ---------- */
  async function run(fn: () => PromiseLike<{ error: any }>, okText?: string) {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      flash(error.message);
      return false;
    }
    if (okText) flash(okText);
    await loadTimer();
    return true;
  }

  const pause = () => {
    idlePausedRef.current = false;
    return run(() => supabase.rpc("pause_timer", { p_since: null }), "Paused. Break time won't be counted.");
  };
  const resume = () => run(() => supabase.rpc("resume_timer", { p_keep_away_time: false }));
  const stop = () => run(() => supabase.rpc("stop_time_timer", { p_billable: true }), "Time saved to your timesheet.");

  async function answerIdle(choice: "keep" | "discard" | "stop") {
    idlePausedRef.current = false;
    setIdlePrompt(null);
    if (choice === "stop") await run(() => supabase.rpc("stop_time_timer", { p_billable: true }), "Timer stopped when you went away. Time saved.");
    else await run(() => supabase.rpc("resume_timer", { p_keep_away_time: choice === "keep" }), choice === "keep" ? "Away time kept." : "Away time discarded.");
  }

  const elapsed = elapsedOf(timer, now);
  const paused = !!timer?.paused_at;
  const awayMinutes = idlePrompt ? (Date.now() - new Date(idlePrompt.since).getTime()) / 60000 : 0;

  return (
    <>
      {/* Timer bar */}
      {timer && (
        <div className="fixed bottom-4 left-4 z-[65] max-w-[calc(100vw-2rem)] animate-scale-in lg:left-[17rem]">
          <div className={`flex items-center gap-3 rounded-xl border px-3 py-2 shadow-xl ${paused ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-surface"}`}>
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${paused ? "bg-amber-500" : "bg-emerald-600"} text-white`}>
              {paused ? <Coffee className="h-4 w-4" /> : <Timer className="h-4 w-4 animate-pulse" />}
            </span>
            <div className="min-w-0 text-xs">
              <p className="max-w-[220px] truncate font-semibold text-text-main">
                {timer.task_id ? (
                  <Link href={`/tasks?task=${timer.task_id}`} className="hover:underline">
                    {timer.description}
                  </Link>
                ) : (
                  timer.description
                )}
              </p>
              <p className={`font-mono text-[11px] font-bold ${paused ? "text-amber-700" : "text-emerald-700"}`}>
                {clock(elapsed)} {paused && <span className="font-sans font-semibold">· paused</span>}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
              ) : paused ? (
                <button type="button" onClick={resume} className="rounded-lg p-1.5 text-emerald-700 transition hover:bg-emerald-100" title="Resume">
                  <Play className="h-4 w-4" />
                </button>
              ) : (
                <button type="button" onClick={pause} className="rounded-lg p-1.5 text-amber-700 transition hover:bg-amber-100" title="Pause (break)">
                  <Pause className="h-4 w-4" />
                </button>
              )}
              <button type="button" onClick={stop} disabled={busy} className="rounded-lg p-1.5 text-rose-600 transition hover:bg-rose-50" title="Stop & save">
                <Square className="h-4 w-4" />
              </button>
            </div>
          </div>
          {message && <p className="mt-1 rounded-lg bg-surface px-2 py-1 text-[11px] font-semibold text-text-main shadow">{message}</p>}
        </div>
      )}
      {!timer && message && (
        <div className="fixed bottom-4 left-4 z-[65] rounded-lg bg-surface px-3 py-2 text-xs font-semibold text-text-main shadow-xl lg:left-[17rem]">{message}</div>
      )}

      {/* Idle question */}
      {idlePrompt && timer && (
        <Modal title="Welcome back" subtitle={`Your timer paused because there was no activity for ${minutesText(awayMinutes)}.`} onClose={() => answerIdle("discard")} maxWidth="max-w-md">
          <div className="space-y-3 text-sm">
            <p className="text-text-main">
              You were away since{" "}
              <strong>{new Date(idlePrompt.since).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</strong> while working on{" "}
              <strong>{timer.description}</strong>. Were you still working on it?
            </p>
            <div className="grid gap-2">
              <button type="button" onClick={() => answerIdle("keep")} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-left text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100">
                Yes, keep this time (I was working offline: a call, reading, a visit)
              </button>
              <button type="button" onClick={() => answerIdle("discard")} className="rounded-lg border border-border px-3 py-2 text-left text-xs font-semibold text-text-main transition hover:bg-surface-alt">
                No, discard the away time and continue the timer
              </button>
              <button type="button" onClick={() => answerIdle("stop")} className="rounded-lg border border-border px-3 py-2 text-left text-xs font-semibold text-text-main transition hover:bg-surface-alt">
                Stop the timer at the moment I went away
              </button>
            </div>
          </div>
        </Modal>
      )}

      {reviewOpen && <DayReview userId={userId} timer={timer} onStopTimer={stop} onClose={() => setReviewOpen(false)} />}
    </>
  );
}

/* =========================================================
   END-OF-DAY REVIEW
   ========================================================= */

function DayReview({ userId, timer, onStopTimer, onClose }: { userId: string; timer: any | null; onStopTimer: () => Promise<boolean>; onClose: () => void }) {
  const [supabase] = useState(() => createClient());
  const today = localISODate();
  const [rows, setRows] = useState<any[]>([]);
  const [edits, setEdits] = useState<Record<string, { h: string; m: string; desc: string; billable: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [newH, setNewH] = useState("");
  const [newM, setNewM] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("time_logs")
      .select("id, description, hours, is_billable, source, needs_review, edited_at, task_id, started_at, ended_at, created_at")
      .eq("user_id", userId)
      .eq("log_date", today)
      .order("created_at", { ascending: true });
    const list = data || [];
    setRows(list);
    const map: Record<string, { h: string; m: string; desc: string; billable: boolean }> = {};
    list.forEach((r: any) => {
      const mins = Math.round(Number(r.hours) * 60);
      map[r.id] = { h: String(Math.floor(mins / 60)), m: String(mins % 60), desc: r.description, billable: r.is_billable !== false };
    });
    setEdits(map);
    setLoading(false);
  }

  function changed(r: any): boolean {
    const e = edits[r.id];
    if (!e) return false;
    const mins = Math.round(Number(e.h || 0) * 60 + Number(e.m || 0));
    return mins !== Math.round(Number(r.hours) * 60) || e.desc.trim() !== r.description || e.billable !== (r.is_billable !== false);
  }

  async function saveRow(r: any) {
    const e = edits[r.id];
    const mins = Math.round(Number(e.h || 0) * 60 + Number(e.m || 0));
    if (mins < 1 || mins > 24 * 60) return setError("Each entry must be between 1 minute and 24 hours.");
    if (!e.desc.trim()) return setError("Each entry needs a description.");
    setSavingId(r.id);
    setError("");
    const { error: err } = await supabase
      .from("time_logs")
      .update({ hours: Math.round((mins / 60) * 100) / 100, description: e.desc.trim(), is_billable: e.billable, needs_review: false })
      .eq("id", r.id);
    setSavingId(null);
    if (err) return setError(err.message);
    load();
  }

  async function deleteRow(r: any) {
    setSavingId(r.id);
    const { error: err } = await supabase.from("time_logs").delete().eq("id", r.id);
    setSavingId(null);
    if (err) return setError(err.message);
    load();
  }

  async function addRow(e: React.FormEvent) {
    e.preventDefault();
    const mins = Math.round(Number(newH || 0) * 60 + Number(newM || 0));
    if (!newDesc.trim() || mins < 1) return setError("Describe the work and enter the time spent.");
    setSavingId("new");
    setError("");
    const { error: err } = await supabase
      .from("time_logs")
      .insert([{ user_id: userId, description: newDesc.trim(), hours: Math.round((mins / 60) * 100) / 100, log_date: today, is_billable: true }]);
    setSavingId(null);
    if (err) return setError(err.message);
    setNewDesc("");
    setNewH("");
    setNewM("");
    load();
  }

  async function confirmDay() {
    setConfirming(true);
    const { error: err } = await supabase.rpc("confirm_my_day", { p_day: today });
    setConfirming(false);
    if (err) return setError(err.message);
    onClose();
  }

  const totalMinutes = rows.reduce((s, r) => s + Math.round(Number(r.hours) * 60), 0);

  return (
    <Modal
      title="Your day"
      subtitle={`${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long" })} · check your time, then confirm`}
      onClose={onClose}
      maxWidth="max-w-3xl"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs font-semibold text-text-main">
            Total today: <span className="text-navy">{minutesText(totalMinutes)}</span>
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
              Later
            </button>
            <button
              type="button"
              onClick={confirmDay}
              disabled={confirming || !!timer}
              title={timer ? "Stop the running timer first" : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />} Confirm my day
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3 text-xs">
        {timer && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2.5">
            <span className="font-semibold text-emerald-800">A timer is still running: {timer.description}</span>
            <button
              type="button"
              onClick={async () => {
                if (await onStopTimer()) load();
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 font-bold text-white transition hover:bg-emerald-700"
            >
              <Square className="h-3 w-3" /> Stop & include
            </button>
          </div>
        )}
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-2.5 font-medium text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading today's entries...
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-text-muted">Nothing logged today yet. Add anything you worked on below.</p>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => {
              const e = edits[r.id];
              if (!e) return null;
              return (
                <div key={r.id} className={`grid grid-cols-12 items-center gap-2 rounded-lg border p-2 ${r.needs_review ? "border-amber-300 bg-amber-50/60" : "border-border"}`}>
                  <div className="col-span-12 sm:col-span-6">
                    <input
                      value={e.desc}
                      onChange={(ev) => setEdits({ ...edits, [r.id]: { ...e, desc: ev.target.value } })}
                      maxLength={300}
                      className="w-full rounded-md border border-border px-2 py-1 outline-none focus:border-navy"
                    />
                    <p className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-text-muted">
                      <span className="rounded bg-surface-alt px-1 font-semibold uppercase">{r.source === "auto" ? "Auto" : r.source === "timer" ? "Timer" : "Manual"}</span>
                      {r.started_at && r.ended_at && (
                        <span>
                          {new Date(r.started_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}–
                          {new Date(r.ended_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                      {r.needs_review && <span className="font-semibold text-amber-700">Please check this entry</span>}
                    </p>
                  </div>
                  <div className="col-span-5 flex gap-1 sm:col-span-3">
                    <input type="number" min={0} max={24} value={e.h} onChange={(ev) => setEdits({ ...edits, [r.id]: { ...e, h: ev.target.value } })} className="w-full rounded-md border border-border px-2 py-1 outline-none focus:border-navy" aria-label="Hours" />
                    <input type="number" min={0} max={59} value={e.m} onChange={(ev) => setEdits({ ...edits, [r.id]: { ...e, m: ev.target.value } })} className="w-full rounded-md border border-border px-2 py-1 outline-none focus:border-navy" aria-label="Minutes" />
                  </div>
                  <label className="col-span-3 flex items-center gap-1 text-[10px] text-text-muted sm:col-span-1">
                    <input type="checkbox" checked={e.billable} onChange={(ev) => setEdits({ ...edits, [r.id]: { ...e, billable: ev.target.checked } })} className="accent-navy" /> Bill
                  </label>
                  <div className="col-span-4 flex justify-end gap-1 sm:col-span-2">
                    {(changed(r) || r.needs_review) && (
                      <button type="button" onClick={() => saveRow(r)} disabled={savingId === r.id} className="rounded-md bg-navy px-2 py-1 text-[10px] font-bold text-white disabled:opacity-60">
                        {savingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : r.needs_review && !changed(r) ? "OK" : "Save"}
                      </button>
                    )}
                    <button type="button" onClick={() => deleteRow(r)} disabled={savingId === r.id} className="rounded-md p-1 text-rose-600 hover:bg-rose-50" aria-label="Delete entry">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <form onSubmit={addRow} className="grid grid-cols-12 items-center gap-2 rounded-lg border border-dashed border-border p-2">
          <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Add missed work, e.g. Client call about notice" maxLength={300} className="col-span-12 rounded-md border border-border px-2 py-1 outline-none focus:border-navy sm:col-span-6" />
          <input type="number" min={0} max={24} placeholder="h" value={newH} onChange={(e) => setNewH(e.target.value)} className="col-span-4 rounded-md border border-border px-2 py-1 outline-none focus:border-navy sm:col-span-2" />
          <input type="number" min={0} max={59} placeholder="m" value={newM} onChange={(e) => setNewM(e.target.value)} className="col-span-4 rounded-md border border-border px-2 py-1 outline-none focus:border-navy sm:col-span-2" />
          <button type="submit" disabled={savingId === "new"} className="col-span-4 inline-flex items-center justify-center gap-1 rounded-md bg-surface-alt px-2 py-1 font-semibold text-navy transition hover:bg-border sm:col-span-2">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </form>

        <p className="flex items-center gap-1 text-[10px] text-text-muted">
          <CheckCircle2 className="h-3 w-3" /> Confirming tells your administrator today's timesheet is accurate. You can still correct entries for the next 7 days.
        </p>
      </div>
    </Modal>
  );
}