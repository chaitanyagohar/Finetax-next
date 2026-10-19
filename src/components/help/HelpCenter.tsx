"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  AlertCircle,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronRight,
  Headphones,
  ImagePlus,
  Inbox,
  LifeBuoy,
  Loader2,
  MessageSquarePlus,
  Plus,
  Search,
  Send,
  Star,
  ThumbsUp,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/layout/UserContext";
import { HELP_ARTICLES } from "@/lib/help/articles";
import RichText from "./RichText";

type Msg = { id: string; ticket_id: string; sender_id: string | null; role: string; body: string; attachments: any[]; created_at: string; meta?: any };
type Ticket = { id: string; number: string; subject: string; status: string; kind: string; rating: number | null; updated_at: string; escalated_at: string | null };
type Pending = { path: string; name: string; type: string; preview: string };
type Tab = "chat" | "guides" | "requests" | "feedback";

const SUGGESTIONS = [
  "My timer didn't start when I clicked Start Work",
  "A page is missing from my menu",
  "How do I correct time I logged yesterday?",
  "How do I hand a task to a colleague?",
  "A client didn't receive the invoice email",
];

const STATUS_INFO: Record<string, { label: string; tone: string }> = {
  ai: { label: "Assistant · instant answers", tone: "bg-violet-50 text-violet-700" },
  waiting: { label: "Waiting for the support team", tone: "bg-amber-50 text-amber-700" },
  open: { label: "Support team is on it", tone: "bg-blue-50 text-blue-700" },
  resolved: { label: "Resolved", tone: "bg-emerald-50 text-emerald-700" },
  closed: { label: "Closed", tone: "bg-surface-alt text-text-muted" },
};

async function resizeImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read the image."));
      el.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read the image."))), "image/jpeg", 0.85)
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function AttachmentImage({ path }: { path: string }) {
  const [supabase] = useState(() => createClient());
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage
      .from("support-attachments")
      .createSignedUrl(path, 3600)
      .then(({ data }) => setUrl(data?.signedUrl || null));
  }, [path]);
  if (!url) return <div className="h-24 w-32 animate-pulse rounded-lg bg-surface-alt" />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Attachment" className="max-h-40 rounded-lg border border-border object-contain" />
    </a>
  );
}

export function MessageBubble({ m, names, agentView = false }: { m: Msg; names: Record<string, string>; agentView?: boolean }) {
  if (m.role === "system") {
    return <p className="mx-auto max-w-[90%] rounded-lg bg-surface-alt px-3 py-2 text-center text-[11px] text-text-muted">{m.body}</p>;
  }
  const mine = agentView ? m.role === "agent" || m.role === "note" : m.role === "user";
  const label =
    m.role === "assistant" ? "Assistant" : m.role === "agent" ? `Support${m.sender_id && names[m.sender_id] ? ` · ${names[m.sender_id]}` : ""}` : m.role === "note" ? "Internal note" : agentView ? names[m.sender_id || ""] || "User" : "You";
  const tone =
    m.role === "note"
      ? "border border-amber-200 bg-amber-50 text-amber-900"
      : mine
      ? "bg-navy text-white"
      : m.role === "assistant"
      ? "border border-violet-100 bg-violet-50/60 text-text-main"
      : "border border-border bg-surface text-text-main";

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] space-y-1.5 rounded-2xl px-3.5 py-2.5 text-[13px] shadow-sm ${tone}`}>
        <p className={`flex items-center gap-1 text-[10px] font-semibold ${mine && m.role !== "note" ? "text-white/70" : "text-text-muted"}`}>
          {m.role === "assistant" ? <Bot className="h-3 w-3" /> : m.role === "agent" ? <Headphones className="h-3 w-3" /> : null}
          {label} · {new Date(m.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
        </p>
        {Array.isArray(m.attachments) && m.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {m.attachments.map((a: any) => (
              <AttachmentImage key={a.path} path={a.path} />
            ))}
          </div>
        )}
        {m.body ? mine && m.role !== "note" ? <p className="whitespace-pre-wrap">{m.body}</p> : <RichText text={m.body} /> : null}
      </div>
    </div>
  );
}

export default function HelpCenter({ variant = "panel", onClose }: { variant?: "panel" | "page"; onClose?: () => void }) {
  const user = useCurrentUser();
  const me = user?.id || "";
  const isAdmin = !!user?.isAdmin;
  const [supabase] = useState(() => createClient());

  const [tab, setTab] = useState<Tab>("chat");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState("");

  // Guides
  const [query, setQuery] = useState("");
  const [openArticle, setOpenArticle] = useState<string | null>(null);

  // Feedback
  const [fbType, setFbType] = useState("idea");
  const [fbMessage, setFbMessage] = useState("");
  const [fbRating, setFbRating] = useState(0);
  const [fbDone, setFbDone] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addMessages = useCallback(
    (list: Msg[]) => {
      if (!list.length) return;
      setMessages((prev) => {
        const map = new Map(prev.map((m) => [m.id, m]));
        list.forEach((m) => map.set(m.id, m));
        return Array.from(map.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
      });
      const ids = Array.from(new Set(list.filter((m) => m.role === "agent" && m.sender_id).map((m) => m.sender_id as string)));
      if (ids.length) {
        supabase
          .from("profiles")
          .select("id, name")
          .in("id", ids)
          .then(({ data }) => data && setNames((n) => ({ ...n, ...Object.fromEntries(data.map((p: any) => [p.id, p.name])) })));
      }
    },
    [supabase]
  );

  async function openTicket(id: string) {
    setError("");
    const [{ data: t }, { data: msgs }] = await Promise.all([
      supabase.from("support_tickets").select("*").eq("id", id).maybeSingle(),
      supabase.from("support_messages").select("*").eq("ticket_id", id).order("created_at", { ascending: true }),
    ]);
    if (!t) return setError("That conversation wasn't found.");
    setTicket(t as Ticket);
    setMessages([]);
    addMessages((msgs || []) as Msg[]);
    setRating(0);
    setRatingComment("");
    setTab("chat");
  }

  // Open a conversation from a notification link (/help?ticket=...)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("ticket");
    if (id) openTicket(id);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  // Live updates for the open conversation
  useEffect(() => {
    if (!ticket?.id) return;
    const channel = supabase
      .channel(`support-${ticket.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages", filter: `ticket_id=eq.${ticket.id}` }, (p: any) =>
        addMessages([p.new as Msg])
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "support_tickets", filter: `id=eq.${ticket.id}` }, (p: any) =>
        setTicket((t) => (t ? { ...t, ...(p.new as Ticket) } : t))
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticket?.id]);

  useEffect(() => {
    if (tab !== "requests" || !me) return;
    supabase
      .from("support_tickets")
      .select("id, number, subject, status, kind, rating, updated_at, escalated_at")
      .eq("user_id", me)
      .order("updated_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setTickets((data || []) as Ticket[]));
  }, [tab, me]);

  function newConversation() {
    setTicket(null);
    setMessages([]);
    setInput("");
    setPending([]);
    setError("");
    setTab("chat");
  }

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, Math.max(0, 3 - pending.length));
    if (!list.length) return;
    setUploading(true);
    setError("");
    try {
      for (const f of list) {
        const blob = await resizeImage(f);
        const path = `${me}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage.from("support-attachments").upload(path, blob, { contentType: "image/jpeg" });
        if (upErr) throw upErr;
        setPending((p) => [...p, { path, name: f.name || "screenshot.jpg", type: "image/jpeg", preview: URL.createObjectURL(blob) }]);
      }
    } catch (e: any) {
      setError(e?.message || "Could not attach the image.");
    } finally {
      setUploading(false);
    }
  }

  async function send(textOverride?: string, choice?: string) {
    const text = (textOverride ?? input).trim();
    if ((!text && pending.length === 0) || sending || uploading) return;
    setSending(true);
    setError("");
    const atts = pending;
    const tempId = `tmp-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: tempId, ticket_id: ticket?.id || "", sender_id: me, role: "user", body: text, attachments: atts.map(({ path, name, type }) => ({ path, name, type })), created_at: new Date().toISOString() },
    ]);
    setInput("");
    setPending([]);

    const res = await fetch("/api/support/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketId: ticket?.id || null,
        text,
        choice: choice || null,
        attachments: atts.map(({ path, name, type }) => ({ path, name, type })),
        pagePath: window.location.pathname,
      }),
    });
    const out = await res.json().catch(() => ({}));
    setSending(false);
    setMessages((m) => m.filter((x) => x.id !== tempId));
    if (!res.ok) {
      setError(out.error || "Could not send. Please try again.");
      setInput(text);
      setPending(atts);
      return;
    }
    setTicket(out.ticket);
    addMessages(out.messages || []);
  }

  async function ticketAction(action: "escalate" | "resolve" | "rate", extra: Record<string, unknown> = {}) {
    if (!ticket) return;
    setSending(true);
    setError("");
    const res = await fetch("/api/support/ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: ticket.id, action, ...extra }),
    });
    const out = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) return setError(out.error || "Something went wrong.");
    if (out.ticket) setTicket(out.ticket);
    addMessages(out.messages || []);
  }

  async function sendFeedback(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSending(true);
    const res = await fetch("/api/support/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: fbType, message: fbMessage, rating: fbRating || null, pagePath: window.location.pathname }),
    });
    const out = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) return setError(out.error || "Could not send feedback.");
    setFbDone(out.number);
    setFbMessage("");
    setFbRating(0);
  }

  const articles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return HELP_ARTICLES.filter((a) => (isAdmin || !a.adminOnly) && (!q || `${a.title} ${a.keywords} ${a.body}`.toLowerCase().includes(q)));
  }, [query, isAdmin]);

  const last = messages[messages.length - 1];
  const quickOptions: { label: string; value: string }[] =
    ticket?.status === "ai" && last?.role === "assistant" && !sending ? last?.meta?.options || [] : [];
  const status = ticket ? STATUS_INFO[ticket.status] || STATUS_INFO.ai : null;
  const firstName = (user?.name || "").split(" ")[0];

  return (
    <div className={`flex h-full flex-col bg-surface ${variant === "page" ? "rounded-xl border border-border shadow-sm" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy text-white">
            <LifeBuoy className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-bold text-text-main">Help & Support</p>
            <p className="text-[10px] text-text-muted">Instant answers, and a real person when you need one</p>
          </div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-alt" aria-label="Close help">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border px-2 py-1.5 text-[11px] font-semibold">
        {(
          [
            ["chat", "Get help", MessageSquarePlus],
            ["guides", "Guides", BookOpen],
            ["requests", "My requests", Inbox],
            ["feedback", "Feedback", ThumbsUp],
          ] as [Tab, string, any][]
        ).map(([k, l, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setTab(k);
              setError("");
            }}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 transition ${tab === k ? "bg-navy/10 text-navy" : "text-text-muted hover:bg-surface-alt"}`}
          >
            <Icon className="h-3.5 w-3.5" /> {l}
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-3 mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 p-2 text-[11px] font-medium text-rose-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {/* ============ CHAT ============ */}
      {tab === "chat" && (
        <>
          {ticket && status && (
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${status.tone}`}>
                {ticket.number} · {status.label}
              </span>
              <div className="flex gap-1">
                {ticket.status === "ai" && (
                  <button type="button" onClick={() => ticketAction("escalate")} disabled={sending} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold text-navy hover:bg-surface-alt">
                    <Headphones className="h-3 w-3" /> Talk to a person
                  </button>
                )}
                <button type="button" onClick={newConversation} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-text-muted hover:bg-surface-alt">
                  <Plus className="h-3 w-3" /> New
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
            {!ticket && messages.length === 0 && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4 text-[13px] text-text-main">
                  <p className="font-semibold">Hi{firstName ? ` ${firstName}` : ""}! What can I help with?</p>
                  <p className="mt-1 text-text-muted">
                    Describe what you're trying to do or what went wrong. Adding a screenshot helps a lot. If I can't fix it, I'll connect you to the support team.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-border px-3 py-1.5 text-left text-[11px] text-text-main transition hover:border-navy/40 hover:bg-surface-alt">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} names={names} />
            ))}

            {sending && (
              <div className="flex items-center gap-2 text-[11px] text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {ticket?.status === "ai" || !ticket ? "Looking into it..." : "Sending..."}
              </div>
            )}

            {quickOptions.length > 0 && (
              <div className="flex flex-wrap gap-2 pl-1">
                {quickOptions.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => (o.value === "guides" ? setTab("guides") : send(o.label, o.value))}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-left text-[11px] font-semibold transition ${
                      o.value.startsWith("solved:")
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : o.value === "person"
                        ? "border-navy/30 text-navy hover:bg-navy/5"
                        : "border-border text-text-main hover:bg-surface-alt"
                    }`}
                  >
                    {o.value === "person" ? <Headphones className="h-3.5 w-3.5" /> : o.value.startsWith("solved:") ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                    {o.label}
                  </button>
                ))}
              </div>
            )}

            {ticket?.status === "resolved" && !ticket.rating && (
              <div className="space-y-2 rounded-xl border border-border p-3 text-[12px]">
                <p className="font-semibold text-text-main">How was the help you got?</p>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} stars`}>
                      <Star className={`h-5 w-5 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-border"}`} />
                    </button>
                  ))}
                </div>
                {rating > 0 && (
                  <>
                    <input value={ratingComment} onChange={(e) => setRatingComment(e.target.value)} placeholder="Anything we could do better? (optional)" className="w-full rounded-lg border border-border px-2 py-1.5 outline-none focus:border-navy" />
                    <button type="button" onClick={() => ticketAction("rate", { rating, comment: ratingComment })} className="rounded-lg bg-navy px-3 py-1.5 text-[11px] font-bold text-white">
                      Send rating
                    </button>
                  </>
                )}
              </div>
            )}
            {ticket?.status === "resolved" && ticket.rating ? <p className="text-center text-[11px] text-emerald-700">Thanks for your rating! Write below if you need anything else.</p> : null}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div className="border-t border-border p-3">
            {pending.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pending.map((p) => (
                  <div key={p.path} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.preview} alt="" className="h-14 w-14 rounded-lg border border-border object-cover" />
                    <button type="button" onClick={() => setPending((list) => list.filter((x) => x.path !== p.path))} className="absolute -right-1.5 -top-1.5 rounded-full bg-rose-600 p-0.5 text-white" aria-label="Remove">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || pending.length >= 3}
                className="rounded-lg p-2 text-text-muted transition hover:bg-surface-alt disabled:opacity-40"
                title="Attach a screenshot"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData.files || []);
                  if (files.length) {
                    e.preventDefault();
                    addFiles(files);
                  }
                }}
                rows={2}
                maxLength={4000}
                placeholder={ticket && ["waiting", "open"].includes(ticket.status) ? "Write to the support team..." : "Describe the problem (you can paste a screenshot)"}
                className="min-h-[44px] flex-1 resize-none rounded-xl border border-border px-3 py-2 text-[13px] outline-none focus:border-navy focus:ring-2 focus:ring-navy/15"
              />
              <button
                type="button"
                onClick={() => send()}
                disabled={sending || uploading || (!input.trim() && pending.length === 0)}
                className="rounded-xl bg-navy p-2.5 text-white transition hover:bg-navy-light disabled:opacity-40"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-[10px] text-text-muted">Never share passwords or OTPs here.</p>
          </div>
        </>
      )}

      {/* ============ GUIDES ============ */}
      {tab === "guides" && (
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search guides, e.g. timer, transfer, invoice" className="w-full rounded-lg border border-border py-2 pl-8 pr-3 text-[12px] outline-none focus:border-navy" />
          </div>
          {articles.length === 0 && <p className="py-6 text-center text-[12px] text-text-muted">No guide matches. Ask in Get help instead.</p>}
          {articles.map((a) => (
            <div key={a.id} className="rounded-lg border border-border">
              <button type="button" onClick={() => setOpenArticle(openArticle === a.id ? null : a.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left">
                <span>
                  <span className="block text-[12px] font-semibold text-text-main">{a.title}</span>
                  <span className="text-[10px] text-text-muted">
                    {a.area}
                    {a.adminOnly ? " · administrators" : ""}
                  </span>
                </span>
                <ChevronRight className={`h-4 w-4 shrink-0 text-text-muted transition ${openArticle === a.id ? "rotate-90" : ""}`} />
              </button>
              {openArticle === a.id && (
                <div className="space-y-3 border-t border-border px-3 py-3 text-[12px] text-text-main">
                  <RichText text={a.body} />
                  <button
                    type="button"
                    onClick={() => {
                      newConversation();
                      setInput(`I need help with: ${a.title}. `);
                    }}
                    className="text-[11px] font-semibold text-navy underline"
                  >
                    Still stuck? Ask the assistant
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ============ MY REQUESTS ============ */}
      {tab === "requests" && (
        <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
          {tickets.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-text-muted">No conversations yet.</p>
          ) : (
            tickets.map((t) => {
              const s = STATUS_INFO[t.status] || STATUS_INFO.ai;
              return (
                <button key={t.id} type="button" onClick={() => openTicket(t.id)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left transition hover:bg-surface-alt">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold text-text-main">{t.subject}</span>
                    <span className="text-[10px] text-text-muted">
                      {t.number} · {t.kind === "feedback" ? "Feedback" : "Help"} · {new Date(t.updated_at).toLocaleDateString("en-IN")}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${s.tone}`}>{t.status === "ai" ? "Assistant" : s.label.split(" ")[0]}</span>
                </button>
              );
            })
          )}
        </div>
      )}

      {/* ============ FEEDBACK ============ */}
      {tab === "feedback" && (
        <div className="flex-1 overflow-y-auto p-3">
          {fbDone ? (
            <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-[12px] text-emerald-800">
              <p className="font-semibold">Thank you! Your feedback ({fbDone}) has reached the team.</p>
              <button type="button" onClick={() => setFbDone("")} className="font-semibold underline">
                Send more feedback
              </button>
            </div>
          ) : (
            <form onSubmit={sendFeedback} className="space-y-3 text-[12px]">
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  ["idea", "💡 Idea / feature"],
                  ["bug", "🐞 Something's broken"],
                  ["praise", "👏 Something I like"],
                  ["other", "💬 Other"],
                ].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setFbType(k)} className={`rounded-lg border px-2 py-2 text-left font-semibold ${fbType === k ? "border-navy bg-navy/5 text-navy" : "border-border text-text-main"}`}>
                    {l}
                  </button>
                ))}
              </div>
              <textarea rows={6} value={fbMessage} onChange={(e) => setFbMessage(e.target.value)} maxLength={4000} placeholder="Tell us more: what would make your work easier?" className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-navy" />
              <div>
                <p className="mb-1 font-semibold text-text-muted">How do you like the app overall? (optional)</p>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" onClick={() => setFbRating(fbRating === n ? 0 : n)} aria-label={`${n} stars`}>
                      <Star className={`h-5 w-5 ${n <= fbRating ? "fill-amber-400 text-amber-400" : "text-border"}`} />
                    </button>
                  ))}
                </div>
              </div>
              <button type="submit" disabled={sending || fbMessage.trim().length < 5} className="w-full rounded-lg bg-navy py-2 font-bold text-white disabled:opacity-50">
                {sending ? "Sending..." : "Send feedback"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/** Floating Help button + slide-in panel, shown on every page. */
export function HelpLauncher() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  if (pathname.startsWith("/help") || pathname.startsWith("/support")) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[60] flex items-center gap-1.5 rounded-full bg-navy px-4 py-2.5 text-xs font-bold text-white shadow-xl transition hover:bg-navy-light"
          aria-label="Open help"
        >
          <LifeBuoy className="h-4 w-4" /> Help
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-[85] flex justify-end">
          <button type="button" className="absolute inset-0 bg-black/20" onClick={() => setOpen(false)} aria-label="Close help" />
          <div className="relative h-full w-full max-w-[440px] shadow-2xl animate-scale-in">
            <HelpCenter variant="panel" onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}