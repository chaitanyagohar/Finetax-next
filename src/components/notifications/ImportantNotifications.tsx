"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, BellRing, CheckCircle2, ClipboardList, Clock, Loader2, Megaphone, Play, RotateCcw, ShieldCheck, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";

type Item = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  entity: string | null;
  entity_id: string | null;
  priority: string;
  created_at: string;
};

const LOOK: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  task_assigned: { icon: ClipboardList, tone: "bg-navy text-white", label: "New assignment" },
  task_submitted: { icon: ShieldCheck, tone: "bg-violet-600 text-white", label: "Review requested" },
  task_changes: { icon: RotateCcw, tone: "bg-amber-500 text-white", label: "Changes requested" },
  announcement: { icon: Megaphone, tone: "bg-emerald-600 text-white", label: "Announcement" },
  task_not_started: { icon: Clock, tone: "bg-amber-500 text-white", label: "Not started yet" },
  task_due_soon: { icon: Clock, tone: "bg-amber-600 text-white", label: "Deadline approaching" },
  task_overdue: { icon: AlertCircle, tone: "bg-rose-600 text-white", label: "Overdue" },
  statutory_risk: { icon: AlertCircle, tone: "bg-rose-700 text-white", label: "Statutory deadline" },
  transfer_request: { icon: BellRing, tone: "bg-navy text-white", label: "Transfer request" },
  tasks_unassigned: { icon: AlertCircle, tone: "bg-amber-600 text-white", label: "Unassigned tasks" },
};

/** "Remind me later" choices. */
function LaterMenu({ onSnooze, onHide }: { onSnooze: (until: Date, label: string) => void; onHide: () => void }) {
  const [open, setOpen] = useState(false);
  const inHours = (h: number) => new Date(Date.now() + h * 3600 * 1000);
  const tomorrow10 = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d;
  };
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-muted transition hover:bg-surface-alt">
        Remind me later ▾
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-1 w-44 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          {[
            { label: "In 1 hour", at: () => inHours(1) },
            { label: "In 3 hours", at: () => inHours(3) },
            { label: "Tomorrow 10 AM", at: tomorrow10 },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => {
                setOpen(false);
                onSnooze(o.at(), o.label);
              }}
              className="block w-full px-3 py-2 text-left text-xs transition hover:bg-surface-alt"
            >
              {o.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onHide();
            }}
            className="block w-full border-t border-border px-3 py-2 text-left text-xs text-text-muted transition hover:bg-surface-alt"
          >
            Just hide it
          </button>
        </div>
      )}
    </div>
  );
}

/** Popups for important, not-yet-dismissed notifications. Mounted on the dashboard. */
export default function ImportantNotifications() {
  const user = useCurrentUser();
  const me = user?.id || "";
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!me) return;
    load();
    const channel = supabase
      .channel(`popups-${me}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${me}` }, (payload) => {
        const n = payload.new as Item;
        if (n.priority === "important") setItems((list) => (list.some((x) => x.id === n.id) ? list : [...list, n]));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [me]);

  async function load() {
    const { data } = await supabase
      .from("notifications")
      .select("id, type, title, body, link, entity, entity_id, priority, created_at")
      .eq("user_id", me)
      .eq("priority", "important")
      .is("read_at", null)
      .is("popup_dismissed_at", null)
      .order("created_at", { ascending: true })
      .limit(50);
    setItems((data || []) as Item[]);
  }

  async function dismiss(ids: string[], markRead: boolean) {
    const now = new Date().toISOString();
    await supabase
      .from("notifications")
      .update(markRead ? { read_at: now, popup_dismissed_at: now } : { popup_dismissed_at: now })
      .in("id", ids);
    setItems((list) => list.filter((x) => !ids.includes(x.id)));
    setError("");
  }

  async function snooze(n: Item, until: Date) {
    setBusy(n.id);
    const { error: err } = await supabase.rpc("snooze_notification", { p_id: n.id, p_until: until.toISOString() });
    setBusy(null);
    if (err) return setError(err.message);
    setItems((list) => list.filter((x) => x.id !== n.id));
    setError("");
  }

  async function startNow(n: Item) {
    if (!n.entity_id) return;
    setBusy(n.id);
    setError("");
    const { error: err } = await supabase.from("tasks").update({ stage: "In Progress" }).eq("id", n.entity_id);
    setBusy(null);
    if (err) return setError(err.message);
    logAuditEvent("UPDATE_TASK", "TASKS", n.entity_id, { stage_changed_to: "In Progress", via: "assignment_popup" });
    dismiss([n.id], true);
  }

  async function acknowledge(n: Item) {
    if (!n.entity_id) return;
    setBusy(n.id);
    const { error: err } = await supabase.from("announcement_acks").insert([{ announcement_id: n.entity_id, user_id: me }]);
    setBusy(null);
    if (err && err.code !== "23505") return setError(err.message);
    dismiss([n.id], true);
  }

  function open(n: Item) {
    dismiss([n.id], true);
    if (n.link) router.push(n.link);
  }

  if (items.length === 0) return null;

  const assignments = items.filter((i) => i.type === "task_assigned");
  const summaryMode = assignments.length > 3;
  const current = summaryMode ? null : items[0];

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px] animate-fade-in">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl animate-scale-in">
        {summaryMode ? (
          <>
            <div className="flex items-center gap-3 bg-navy px-5 py-4 text-white">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
                <BellRing className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">New assignments</p>
                <p className="text-base font-bold">{assignments.length} tasks were assigned to you</p>
              </div>
            </div>
            <div className="max-h-60 space-y-1.5 overflow-y-auto p-4">
              {assignments.slice(0, 8).map((a) => (
                <div key={a.id} className="rounded-lg border border-border px-3 py-2 text-xs">
                  <p className="truncate font-semibold text-navy">{a.title.replace(/^New task: |^Task assigned to you: /, "")}</p>
                  {a.body && <p className="truncate text-[11px] text-text-muted">{a.body}</p>}
                </div>
              ))}
              {assignments.length > 8 && <p className="text-center text-[11px] text-text-muted">+{assignments.length - 8} more</p>}
            </div>
            <div className="flex gap-2 border-t border-border p-4">
              <button
                type="button"
                onClick={() => dismiss(assignments.map((a) => a.id), false)}
                className="flex-1 rounded-lg border border-border py-2 text-xs font-semibold transition hover:bg-surface-alt"
              >
                Later
              </button>
              <button
                type="button"
                onClick={() => {
                  dismiss(assignments.map((a) => a.id), true);
                  router.push("/tasks");
                }}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-navy py-2 text-xs font-bold text-white transition hover:bg-navy-light"
              >
                View my tasks <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        ) : current ? (
          (() => {
            const look = LOOK[current.type] || { icon: BellRing, tone: "bg-navy text-white", label: "Important" };
            const Icon = look.icon;
            const isAck = current.type === "announcement";
            return (
              <>
                <div className={`flex items-center gap-3 px-5 py-4 ${look.tone}`}>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{look.label}</p>
                    <p className="text-base font-bold leading-snug">{current.title.replace(/^New task: |^Task assigned to you: |^Ready for your review: |^Changes requested: /, "")}</p>
                  </div>
                  {items.length > 1 && <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold">1 of {items.length}</span>}
                </div>
                <div className="space-y-3 p-5 text-sm">
                  {current.body && <p className="whitespace-pre-wrap text-text-main">{current.body}</p>}
                  <p className="flex items-center gap-1 text-[11px] text-text-muted">
                    <Clock className="h-3 w-3" />
                    {new Date(current.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                  {error && (
                    <p className="flex items-start gap-1.5 rounded-lg bg-rose-50 p-2 text-xs font-medium text-rose-700">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-border p-4">
                  <LaterMenu onSnooze={(until) => snooze(current, until)} onHide={() => dismiss([current.id], false)} />
                  {["task_assigned", "task_not_started", "task_due_soon"].includes(current.type) && (
                    <>
                      <button
                        type="button"
                        onClick={() => open(current)}
                        className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-navy transition hover:bg-surface-alt"
                      >
                        Open task
                      </button>
                      <button
                        type="button"
                        onClick={() => startNow(current)}
                        disabled={busy === current.id}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {busy === current.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start now
                      </button>
                    </>
                  )}
                  {(current.type === "task_submitted" || current.type === "task_changes") && (
                    <button
                      type="button"
                      onClick={() => open(current)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-xs font-bold text-white transition hover:bg-navy-light"
                    >
                      {current.type === "task_submitted" ? "Review now" : "Open task"} <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {isAck && (
                    <button
                      type="button"
                      onClick={() => acknowledge(current)}
                      disabled={busy === current.id}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {busy === current.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} I've read this
                    </button>
                  )}
                  {!["task_assigned", "task_not_started", "task_due_soon", "task_submitted", "task_changes", "announcement"].includes(current.type) && (
                    <button
                      type="button"
                      onClick={() => open(current)}
                      className="flex-1 rounded-lg bg-navy px-3 py-2 text-xs font-bold text-white transition hover:bg-navy-light"
                    >
                      Got it
                    </button>
                  )}
                </div>
              </>
            );
          })()
        ) : null}
        <button type="button" onClick={() => dismiss(items.map((i) => i.id), false)} className="sr-only">
          <X /> Dismiss all
        </button>
      </div>
    </div>
  );
}