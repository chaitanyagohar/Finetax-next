"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Megaphone, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal } from "@/components/ui/Modal";
import { formatDate, localISODate } from "@/lib/format";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

export default function AnnouncementsPanel({ isAdmin }: { isAdmin: boolean }) {
  const user = useCurrentUser();
  const me = user?.id || "";
  const [supabase] = useState(() => createClient());

  const [list, setList] = useState<any[]>([]);
  const [acks, setAcks] = useState<{ announcement_id: string; user_id: string }[]>([]);
  const [team, setTeam] = useState<{ id: string; name: string; is_active?: boolean }[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);
  const [requiresAck, setRequiresAck] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const today = localISODate();

  useEffect(() => {
    if (me) load();
  }, [me]);

  async function load() {
    const { data } = await supabase.from("announcements").select("*").order("created_at", { ascending: false }).limit(15);
    const live = (data || []).filter((a: any) => !a.expires_at || a.expires_at >= today).slice(0, 6);
    setList(live);
    const ids = live.map((a: any) => a.id);
    if (ids.length) {
      let q = supabase.from("announcement_acks").select("announcement_id, user_id").in("announcement_id", ids);
      if (!isAdmin) q = q.eq("user_id", me);
      const { data: ackRows } = await q;
      setAcks(ackRows || []);
    } else {
      setAcks([]);
    }
    if (isAdmin) {
      const { data: people } = await supabase.from("profiles").select("id, name, is_active").order("name", { ascending: true });
      setTeam(people || []);
    }
  }

  const activeTeam = useMemo(() => team.filter((t) => t.is_active !== false), [team]);
  const nameOf = (id?: string) => team.find((t) => t.id === id)?.name || "";

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError("");
    if (!title.trim()) return setError("Title is required.");
    if (expiresAt && expiresAt < today) return setError("'Show until' cannot be in the past.");
    setSaving(true);
    const { data, error: err } = await supabase
      .from("announcements")
      .insert([{ title: title.trim(), body: body.trim(), priority: important ? "important" : "normal", requires_ack: requiresAck, expires_at: expiresAt || null }])
      .select("id")
      .single();
    setSaving(false);
    if (err || !data) return setError(err?.message || "Could not post the announcement.");
    logAuditEvent("POST_ANNOUNCEMENT", "ANNOUNCEMENTS", data.id, { title: title.trim(), requires_ack: requiresAck });
    setComposeOpen(false);
    setTitle("");
    setBody("");
    setImportant(false);
    setRequiresAck(false);
    setExpiresAt("");
    load();
  }

  async function remove(a: any) {
    setBusy(a.id);
    const { error: err } = await supabase.from("announcements").delete().eq("id", a.id);
    setBusy(null);
    if (err) return;
    logAuditEvent("DELETE_ANNOUNCEMENT", "ANNOUNCEMENTS", a.id, { title: a.title });
    load();
  }

  async function acknowledge(a: any) {
    setBusy(a.id);
    const { error: err } = await supabase.from("announcement_acks").insert([{ announcement_id: a.id, user_id: me }]);
    if (!err || err.code === "23505") {
      const now = new Date().toISOString();
      await supabase.from("notifications").update({ read_at: now, popup_dismissed_at: now }).eq("entity_id", a.id).eq("user_id", me);
    }
    setBusy(null);
    load();
  }

  if (!isAdmin && list.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-surface shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-main">
          <Megaphone className="h-4 w-4 text-navy" /> Announcements
        </h3>
        {isAdmin && (
          <button
            type="button"
            onClick={() => {
              setError("");
              setComposeOpen(true);
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-navy px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-navy-light"
          >
            <Plus className="h-3.5 w-3.5" /> Post
          </button>
        )}
      </header>

      <div className="space-y-2 p-4">
        {list.length === 0 ? (
          <p className="text-center text-xs text-text-muted">No active announcements. Post one to inform the whole team.</p>
        ) : (
          list.map((a) => {
            const myAck = acks.some((k) => k.announcement_id === a.id && k.user_id === me);
            const ackedIds = new Set(acks.filter((k) => k.announcement_id === a.id).map((k) => k.user_id));
            const audience = activeTeam.filter((t) => t.id !== a.created_by);
            const pending = audience.filter((t) => !ackedIds.has(t.id));
            const isOpen = expanded === a.id;
            return (
              <div
                key={a.id}
                className={`rounded-lg border p-3 text-xs ${a.priority === "important" ? "border-amber-300 bg-amber-50/60" : "border-border bg-surface-alt"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-text-main">
                      {a.priority === "important" && <span className="mr-1 rounded bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">Important</span>}
                      {a.title}
                    </p>
                    {a.body && <p className="mt-1 whitespace-pre-wrap text-text-main">{a.body}</p>}
                    <p className="mt-1 text-[10px] text-text-muted">
                      {formatDate(a.created_at)}
                      {nameOf(a.created_by) ? ` · ${nameOf(a.created_by)}` : ""}
                      {a.expires_at ? ` · until ${formatDate(a.expires_at)}` : ""}
                    </p>
                  </div>
                  {isAdmin && (
                    <button type="button" onClick={() => remove(a)} disabled={busy === a.id} className="shrink-0 rounded-md p-1 text-rose-600 hover:bg-rose-50" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {a.requires_ack && !isAdmin && (
                  <div className="mt-2">
                    {myAck ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Acknowledged
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => acknowledge(a)}
                        disabled={busy === a.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {busy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} I've read this
                      </button>
                    )}
                  </div>
                )}

                {a.requires_ack && isAdmin && (
                  <div className="mt-2">
                    <button type="button" onClick={() => setExpanded(isOpen ? null : a.id)} className="flex items-center gap-1 text-[11px] font-semibold text-navy">
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {audience.length - pending.length} of {audience.length} acknowledged
                    </button>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${audience.length ? ((audience.length - pending.length) / audience.length) * 100 : 0}%` }} />
                    </div>
                    {isOpen && (
                      <p className="mt-1.5 text-[11px] text-text-muted">
                        {pending.length === 0 ? "Everyone has acknowledged." : `Waiting for: ${pending.map((p) => p.name).join(", ")}`}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {composeOpen && (
        <Modal
          title="Post an announcement"
          subtitle="Every active team member is notified immediately."
          onClose={() => !saving && setComposeOpen(false)}
          maxWidth="max-w-lg"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setComposeOpen(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Cancel
              </button>
              <button
                type="submit"
                form="announcement-form"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Post
              </button>
            </div>
          }
        >
          <form id="announcement-form" onSubmit={post} className="space-y-3 text-xs">
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-2.5 font-medium text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div>
              <label className={labelClass}>Title *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} className={inputClass} placeholder="e.g. Office closed on Monday" />
            </div>
            <div>
              <label className={labelClass}>Message</label>
              <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Show until (optional)</label>
              <input type="date" min={today} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputClass} />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-text-main">
              <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} className="h-4 w-4 accent-navy" />
              Important: show as a popup on everyone's dashboard
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-text-main">
              <input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} className="h-4 w-4 accent-navy" />
              Require each person to confirm "I've read this"
            </label>
          </form>
        </Modal>
      )}
    </section>
  );
}