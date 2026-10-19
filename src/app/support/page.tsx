"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Bot, Headphones, Loader2, Lock, Search, Send, Sparkles, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/layout/UserContext";
import { MessageBubble } from "@/components/help/HelpCenter";
import KnowledgeBaseManager, { type KbDraft } from "@/components/help/KnowledgeBaseManager";

type Filter = "waiting" | "open" | "ai" | "resolved" | "feedback" | "all";

const FILTERS: [Filter, string][] = [
  ["waiting", "Waiting"],
  ["open", "Open"],
  ["ai", "Self-served"],
  ["resolved", "Resolved"],
  ["feedback", "Feedback"],
  ["all", "All"],
];
const STATUS_TONE: Record<string, string> = {
  ai: "bg-violet-50 text-violet-700",
  waiting: "bg-amber-100 text-amber-800",
  open: "bg-blue-50 text-blue-700",
  resolved: "bg-emerald-50 text-emerald-700",
  closed: "bg-surface-alt text-text-muted",
};

function matches(t: any, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "feedback") return t.kind === "feedback" && !["resolved", "closed"].includes(t.status);
  if (f === "resolved") return ["resolved", "closed"].includes(t.status);
  return t.kind === "help" && t.status === f;
}
function ago(iso?: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export default function SupportInboxPage() {
  const user = useCurrentUser();
  const me = user?.id || "";
  const [supabase] = useState(() => createClient());

  const [filter, setFilter] = useState<Filter>("waiting");
  const [search, setSearch] = useState("");
  const [tickets, setTickets] = useState<any[]>([]);
  const [people, setPeople] = useState<Record<string, any>>({});
  const [selected, setSelected] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [reply, setReply] = useState("");
  const [asNote, setAsNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [kb, setKb] = useState<{ draft: KbDraft | null } | null>(null);
  const selectedRef = useRef<any | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  selectedRef.current = selected;

  const names = useMemo(() => Object.fromEntries(Object.values(people).map((p: any) => [p.id, p.name])), [people]);
  const agents = Object.values(people).filter((p: any) => p.is_support_agent);

  const loadTickets = useCallback(async () => {
    const { data } = await supabase.from("support_tickets").select("*").order("last_message_at", { ascending: false }).limit(300);
    setTickets(data || []);
    setLoading(false);
    const sel = selectedRef.current;
    if (sel) {
      const fresh = (data || []).find((t: any) => t.id === sel.id);
      if (fresh) setSelected(fresh);
    }
  }, [supabase]);

  async function openTicket(id: string) {
    const [{ data: t }, { data: msgs }] = await Promise.all([
      supabase.from("support_tickets").select("*").eq("id", id).maybeSingle(),
      supabase.from("support_messages").select("*").eq("ticket_id", id).order("created_at", { ascending: true }),
    ]);
    if (t) setSelected(t);
    setMessages(msgs || []);
    setReply("");
    setAsNote(false);
    setError("");
  }

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, name, email, role, is_support_agent")
      .then(({ data }) => setPeople(Object.fromEntries((data || []).map((p: any) => [p.id, p]))));
    loadTickets();
    const id = new URLSearchParams(window.location.search).get("ticket");
    if (id) openTicket(id);

    let timer: number | undefined;
    const channel = supabase
      .channel("support-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(loadTickets, 400);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages" }, (p: any) => {
        if (selectedRef.current && p.new.ticket_id === selectedRef.current.id) {
          setMessages((list) => (list.some((m) => m.id === p.new.id) ? list : [...list, p.new]));
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const visible = tickets.filter(
    (t) =>
      matches(t, filter) &&
      (!search || `${t.number} ${t.subject} ${names[t.user_id] || ""} ${t.ai_summary || ""}`.toLowerCase().includes(search.toLowerCase()))
  );

  async function act(action: string, payload: Record<string, unknown> = {}) {
    if (!selected) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/support/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: selected.id, action, ...payload }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(out.error || "Action failed.");
    if (out.ticket) setSelected(out.ticket);
    if (out.messages?.length) setMessages((list) => [...list, ...out.messages.filter((m: any) => !list.some((x) => x.id === m.id))]);
    loadTickets();
  }

  async function sendReply() {
    const text = reply.trim();
    if (!text) return;
    await act(asNote ? "note" : "reply", { text });
    setReply("");
  }

  const requester = selected ? people[selected.user_id] : null;
  const ctx = selected?.context || {};

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <Headphones className="h-5 w-5 text-navy" /> Support Inbox
          </h2>
          <p className="mt-1 text-xs text-text-muted">Requests the assistant handed over, conversations it solved, and feedback from your team.</p>
          <button type="button" onClick={() => setKb({ draft: null })} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-navy transition hover:bg-surface-alt">
            Knowledge base
          </button>
          {kb && <KnowledgeBaseManager draft={kb.draft} onClose={() => setKb(null)} />}
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-alt p-0.5 text-xs font-semibold">
          {FILTERS.map(([k, l]) => {
            const count = tickets.filter((t) => matches(t, k)).length;
            return (
              <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1.5 transition ${filter === k ? "bg-surface text-navy shadow-sm" : "text-text-muted"}`}>
                {l} {k !== "all" && count > 0 && <span className={`ml-0.5 rounded-full px-1.5 text-[10px] ${k === "waiting" ? "bg-amber-500 text-white" : "bg-border"}`}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid min-h-[70vh] grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        {/* List */}
        <div className="flex flex-col rounded-xl border border-border bg-surface shadow-sm">
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number, subject, person" className="w-full rounded-lg border border-border py-1.5 pl-8 pr-2 text-xs outline-none focus:border-navy" />
          </div>
          <div className="max-h-[70vh] flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-xs text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : visible.length === 0 ? (
              <p className="p-6 text-center text-xs text-text-muted">Nothing here.</p>
            ) : (
              visible.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openTicket(t.id)}
                  className={`block w-full border-b border-border px-3 py-2.5 text-left transition hover:bg-surface-alt ${selected?.id === t.id ? "bg-navy/5" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-text-main">{names[t.user_id] || "User"}</span>
                    <span className="shrink-0 text-[10px] text-text-muted">{ago(t.last_message_at)}</span>
                  </div>
                  <p className="truncate text-[11px] text-text-main">{t.subject}</p>
                  <div className="mt-1 flex items-center gap-1">
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${STATUS_TONE[t.status] || ""}`}>{t.kind === "feedback" ? "Feedback" : t.status === "ai" ? "AI" : t.status}</span>
                    {t.priority === "urgent" && <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-700">Urgent</span>}
                    <span className="text-[9px] text-text-muted">{t.number}</span>
                    {t.rating ? (
                      <span className="ml-auto flex items-center text-[9px] text-amber-600">
                        <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                        {t.rating}
                      </span>
                    ) : null}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Conversation */}
        <div className="flex flex-col rounded-xl border border-border bg-surface shadow-sm">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-10 text-xs text-text-muted">Choose a conversation.</div>
          ) : (
            <>
              <div className="space-y-2 border-b border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-text-main">
                      {selected.number} · {selected.subject}
                    </p>
                    <p className="text-[11px] text-text-muted">
                      {requester?.name || "User"} ({requester?.role || "staff"}) · {requester?.email || ""} · on {selected.page_path || "unknown page"} · started {ago(selected.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        const firstUser = messages.find((m) => m.role === "user");
                        const lastAgent = [...messages].reverse().find((m) => m.role === "agent");
                        setKb({ draft: { title: selected.subject, phrases: firstUser?.body || selected.subject, solution: lastAgent?.body || "" } });
                      }}
                      className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 font-semibold text-emerald-700"
                      title="Turn your reply into an automatic answer for next time"
                    >
                      Save as answer
                    </button>
                    <select value={selected.status} onChange={(e) => act("status", { status: e.target.value })} disabled={busy} className="rounded-lg border border-border px-2 py-1 outline-none">
                      <option value="ai">AI</option>
                      <option value="waiting">Waiting</option>
                      <option value="open">Open</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                    <select value={selected.priority} onChange={(e) => act("priority", { priority: e.target.value })} disabled={busy} className="rounded-lg border border-border px-2 py-1 outline-none">
                      <option value="normal">Normal</option>
                      <option value="urgent">Urgent</option>
                    </select>
                    <select value={selected.assigned_to || ""} onChange={(e) => act("assign", { assignee: e.target.value || null })} disabled={busy} className="rounded-lg border border-border px-2 py-1 outline-none">
                      <option value="">Unassigned</option>
                      {agents.map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {a.id === me ? `${a.name} (you)` : a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {selected.ai_summary && (
                  <div className="flex gap-2 rounded-lg border border-violet-100 bg-violet-50/60 p-2.5 text-[11px] text-text-main">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" />
                    <span>
                      <span className="font-semibold">Summary:</span> {selected.ai_summary}
                    </span>
                  </div>
                )}
                <p className="text-[10px] text-text-muted">
                  Modules: {ctx.isAdmin ? "all (admin)" : (ctx.modules || []).join(", ") || "—"} · Category: {selected.category || "—"}
                  {selected.rating ? ` · Rated ${selected.rating}/5${selected.rating_comment ? `: "${selected.rating_comment}"` : ""}` : ""}
                  {selected.user_agent ? ` · ${String(selected.user_agent).slice(0, 80)}` : ""}
                </p>
              </div>

              <div className="max-h-[52vh] flex-1 space-y-3 overflow-y-auto p-4">
                {messages.map((m) => (
                  <MessageBubble key={m.id} m={m} names={names} agentView />
                ))}
                <div ref={bottomRef} />
              </div>

              {error && (
                <p className="mx-4 mb-2 flex items-center gap-1 text-[11px] font-medium text-rose-600">
                  <AlertCircle className="h-3.5 w-3.5" /> {error}
                </p>
              )}

              <div className="border-t border-border p-3">
                <div className="mb-2 flex gap-1 text-[11px] font-semibold">
                  <button type="button" onClick={() => setAsNote(false)} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${!asNote ? "bg-navy text-white" : "text-text-muted hover:bg-surface-alt"}`}>
                    <Send className="h-3 w-3" /> Reply to user
                  </button>
                  <button type="button" onClick={() => setAsNote(true)} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${asNote ? "bg-amber-500 text-white" : "text-text-muted hover:bg-surface-alt"}`}>
                    <Lock className="h-3 w-3" /> Internal note
                  </button>
                  {selected.status === "ai" && (
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-normal text-violet-700">
                      <Bot className="h-3 w-3" /> The assistant is handling this. Replying takes over.
                    </span>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        sendReply();
                      }
                    }}
                    rows={3}
                    placeholder={asNote ? "Only support agents see notes" : "Write your reply (Ctrl + Enter to send)"}
                    className={`flex-1 resize-none rounded-xl border px-3 py-2 text-[13px] outline-none focus:ring-2 ${asNote ? "border-amber-300 bg-amber-50/40 focus:ring-amber-200" : "border-border focus:border-navy focus:ring-navy/15"}`}
                  />
                  <button type="button" onClick={sendReply} disabled={busy || !reply.trim()} className="rounded-xl bg-navy px-4 py-2.5 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-40">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : asNote ? "Add note" : "Send"}
                  </button>
                </div>
                {selected.status !== "resolved" && (
                  <button type="button" onClick={() => act("status", { status: "resolved" })} disabled={busy} className="mt-2 text-[11px] font-semibold text-emerald-700 underline">
                    Mark as resolved
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}