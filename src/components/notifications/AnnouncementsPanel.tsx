"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BellRing, CheckCircle2, ChevronDown, ChevronRight, Download, Loader2, Megaphone, Pin, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal } from "@/components/ui/Modal";
import { formatDate, localISODate } from "@/lib/format";
import { LockedHint } from "@/components/plan/FeatureGate";
import { hasFeature } from "@/lib/features";
import { downloadCsv } from "@/lib/csv";

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
  const [reminded, setReminded] = useState<Record<string, string>>({});

  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);
  const [requiresAck, setRequiresAck] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [mustRead, setMustRead] = useState(false);
  const [remindHours, setRemindHours] = useState("");
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState<Record<string, { user_id: string; name: string; email: string | null; branch: string | null; acked_at: string | null }[]>>({});
  const canMustRead = hasFeature(user, "must_acknowledge");
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
      supabase
        .from("branches")
        .select("id, name")
        .order("is_default", { ascending: false })
        .then(({ data: b }) => setBranches(b || []));
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
      .insert([
        {
          title: title.trim(),
          body: body.trim(),
          priority: important || mustRead ? "important" : "normal",
          requires_ack: requiresAck || mustRead,
          must_acknowledge: mustRead,
          remind_every_hours: (requiresAck || mustRead) && remindHours ? Number(remindHours) : null,
          branch_id: branchId || null,
          expires_at: expiresAt || null,
        },
      ])
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
    setMustRead(false);
    setRemindHours("");
    setBranchId("");
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

  async function loadStatus(id: string) {
    const { data } = await supabase.rpc("announcement_ack_status", { p_id: id });
    setStatus((m) => ({ ...m, [id]: data || [] }));
  }

  async function remindNow(a: any) {
    setBusy(a.id);
    const { data, error: err } = await supabase.rpc("remind_unacknowledged", { p_id: a.id });
    setBusy(null);
    setError("");
    setReminded((r) => ({ ...r, [a.id]: err ? err.message : data ? `Reminded ${data} ${data === 1 ? "person" : "people"}.` : "Everyone waiting was reminded within the last hour." }));
  }

  function exportStatus(a: any) {
    const rows = status[a.id] || [];
    downloadCsv(
      `read-${a.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`,
      ["Name", "Email", "Branch", "Read on"],
      rows.map((r) => [r.name, r.email, r.branch, r.acked_at ? new Date(r.acked_at).toLocaleString("en-IN") : "Not yet"]),
    );
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
    <section data-tour="dash-announcements" className="rounded-xl border border-border bg-surface shadow-sm">
      <header className={`flex items-center justify-between gap-3 px-4 py-3 ${list.length > 0 ? "border-b border-border" : ""}`}>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-main">
          <Megaphone className="h-4 w-4 text-navy" /> Announcements
          {list.length === 0 && <span className="text-xs font-normal text-text-muted">· none active</span>}
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

      {list.length > 0 && (
      <div className="space-y-2 p-4">
        {(
          list.map((a) => {
            const myAck = acks.some((k) => k.announcement_id === a.id && k.user_id === me);
            const ackedIds = new Set(acks.filter((k) => k.announcement_id === a.id).map((k) => k.user_id));
            const audience = status[a.id] ? status[a.id].map((r) => ({ id: r.user_id, name: r.name })) : activeTeam.filter((t) => t.id !== a.created_by);
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
                      {a.priority === "important" && <span className="mr-1 rounded bg-amber-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">Important</span>}
                      {a.must_acknowledge && <Pin className="mr-1 inline h-3 w-3 text-amber-600" aria-label="Pinned until read" />}
                      {a.title}
                      {a.branch_id && <span className="ml-1.5 rounded bg-surface px-1.5 py-0.5 text-[9px] font-semibold text-text-muted">{branches.find((b) => b.id === a.branch_id)?.name || "One branch"}</span>}
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
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {busy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} I&apos;ve read this
                      </button>
                    )}
                  </div>
                )}

                {a.requires_ack && isAdmin && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setExpanded(isOpen ? null : a.id);
                        if (!isOpen) loadStatus(a.id);
                      }}
                      className="flex items-center gap-1 text-[11px] font-semibold text-navy"
                    >
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {audience.length - pending.length} of {audience.length} acknowledged
                    </button>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${audience.length ? ((audience.length - pending.length) / audience.length) * 100 : 0}%` }} />
                    </div>
                    {isOpen && (
                      <div className="mt-2 space-y-2">
                        {status[a.id] ? (
                          <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface text-[11px]">
                            {status[a.id].map((r) => (
                              <li key={r.user_id} className="flex items-center justify-between px-2.5 py-1.5">
                                <span>
                                  {r.name} {r.branch && <span className="text-text-muted">· {r.branch}</span>}
                                </span>
                                {r.acked_at ? (
                                  <span className="text-emerald-700">{new Date(r.acked_at).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                                ) : (
                                  <span className="font-semibold text-amber-700">Not yet</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[11px] text-text-muted">{pending.length === 0 ? "Everyone has acknowledged." : `Waiting for: ${pending.map((p) => p.name).join(", ")}`}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          {pending.length > 0 && (
                            <button type="button" disabled={busy === a.id} onClick={() => remindNow(a)} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-semibold hover:bg-surface-alt">
                              <BellRing className="h-3 w-3" /> Remind those who haven&apos;t read
                            </button>
                          )}
                          {status[a.id] && (
                            <button type="button" onClick={() => exportStatus(a)} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-semibold hover:bg-surface-alt">
                              <Download className="h-3 w-3" /> Export
                            </button>
                          )}
                          {reminded[a.id] && <span className="text-[11px] text-emerald-700">{reminded[a.id]}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      )}

      {composeOpen && (
        <Modal
          title="Post an announcement"
          subtitle="Everyone it is meant for is notified straight away."
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
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white transition hover:bg-navy-light disabled:opacity-60"
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
              Important: show as a popup on everyone&apos;s dashboard
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-text-main">
              <input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} className="h-4 w-4 accent-navy" />
              Require each person to confirm &quot;I&apos;ve read this&quot;
            </label>
            <label className={`flex items-center gap-2 text-text-main ${canMustRead ? "cursor-pointer" : "opacity-60"}`}>
              <input type="checkbox" disabled={!canMustRead} checked={mustRead} onChange={(e) => setMustRead(e.target.checked)} className="h-4 w-4 accent-navy" />
              Must read: pinned at the top of every page until they confirm
              {!canMustRead && <LockedHint feature="must_acknowledge" />}
            </label>
            {(requiresAck || mustRead) && canMustRead && (
              <div>
                <label className={labelClass}>Remind those who haven&apos;t read</label>
                <select value={remindHours} onChange={(e) => setRemindHours(e.target.value)} className={inputClass}>
                  <option value="">Don&apos;t remind</option>
                  <option value="4">Every 4 hours</option>
                  <option value="24">Every day</option>
                  <option value="72">Every 3 days</option>
                </select>
              </div>
            )}
            {branches.length > 1 && (
              <div>
                <label className={labelClass}>Who sees it</label>
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputClass}>
                  <option value="">Everyone in the firm</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      Only {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </form>
        </Modal>
      )}
    </section>
  );
}