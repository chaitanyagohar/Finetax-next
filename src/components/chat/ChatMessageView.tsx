"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fileSize, timeLabel, type ChatAttachment, type ChatMessage } from "@/lib/chat";
import { getInitials } from "@/lib/format";

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Text with clickable links and highlighted @mentions. No HTML is ever injected. */
function Body({ text, mentionNames }: { text: string; mentionNames: string[] }) {
  const names = mentionNames.filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRe);
  const re = new RegExp(`(https?:\\/\\/[^\\s<]+)${names.length ? `|(@(?:${names.join("|")}))` : ""}`, "g");
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      out.push(
        <a key={i++} href={m[1]} target="_blank" rel="noopener noreferrer" className="break-all text-blue-600 underline">
          {m[1]}
        </a>
      );
    } else if (m[2]) {
      out.push(
        <span key={i++} className="rounded bg-navy/10 px-1 font-semibold text-navy">
          {m[2]}
        </span>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-main">{out}</p>;
}

function Attachment({ a }: { a: ChatAttachment }) {
  const [supabase] = useState(() => createClient());
  const [url, setUrl] = useState<string | null>(null);
  const isImage = a.type.startsWith("image/");

  useEffect(() => {
    if (!isImage) return;
    supabase.storage
      .from("chat-attachments")
      .createSignedUrl(a.path, 3600)
      .then(({ data }) => setUrl(data?.signedUrl || null));
  }, [a.path]);

  async function openFile() {
    const { data } = await supabase.storage.from("chat-attachments").createSignedUrl(a.path, 300, { download: a.name });
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  if (isImage) {
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={a.name} className="max-h-56 max-w-xs rounded-lg border border-border object-contain" />
      </a>
    ) : (
      <div className="h-32 w-48 animate-pulse rounded-lg bg-surface-alt" />
    );
  }
  return (
    <button type="button" onClick={openFile} className="flex max-w-xs items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:bg-surface-alt">
      <FileText className="h-5 w-5 shrink-0 text-navy" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-text-main">{a.name}</span>
        <span className="text-[10px] text-text-muted">{fileSize(a.size)}</span>
      </span>
    </button>
  );
}

export default function ChatMessageView({
  m,
  names,
  me,
  isAdmin,
  showHeader,
}: {
  m: ChatMessage;
  names: Record<string, string>;
  me: string;
  isAdmin: boolean;
  showHeader: boolean;
}) {
  const [supabase] = useState(() => createClient());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mine = m.sender_id === me;
  const sender = (m.sender_id && names[m.sender_id]) || "Former member";

  async function saveEdit() {
    setBusy(true);
    setError("");
    const { error: err } = await supabase.rpc("chat_edit_message", { p_id: m.id, p_body: draft });
    setBusy(false);
    if (err) return setError(err.message);
    setEditing(false);
  }

  async function remove() {
    if (!window.confirm("Delete this message?")) return;
    const { error: err } = await supabase.rpc("chat_delete_message", { p_id: m.id });
    if (err) setError(err.message);
  }

  return (
    <div className={`group relative flex gap-3 rounded-lg px-2 ${showHeader ? "pt-2" : ""} pb-0.5 hover:bg-surface-alt/60`}>
      <div className="w-8 shrink-0">
        {showHeader && (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy/10 text-[10px] font-bold text-navy">{getInitials(sender)}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {showHeader && (
          <p className="text-xs">
            <span className="font-bold text-text-main">{sender}</span>
            <span className="ml-2 text-[10px] text-text-muted">{timeLabel(m.created_at)}</span>
          </p>
        )}

        {m.deleted_at ? (
          <p className="text-xs italic text-text-muted">Message deleted</p>
        ) : editing ? (
          <div className="space-y-1.5 py-1">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              maxLength={4000}
              className="w-full rounded-lg border border-border px-2 py-1.5 text-[13px] outline-none focus:border-navy"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                }
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <div className="flex gap-2 text-[11px]">
              <button type="button" onClick={saveEdit} disabled={busy} className="rounded bg-navy px-2.5 py-1 font-semibold text-white">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="px-2 py-1 text-text-muted">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {m.body && <Body text={m.body} mentionNames={(m.mentions || []).map((id) => names[id]).filter(Boolean)} />}
            {m.attachments?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {m.attachments.map((a) => (
                  <Attachment key={a.path} a={a} />
                ))}
              </div>
            )}
            {m.edited_at && <span className="text-[10px] text-text-muted">(edited)</span>}
          </>
        )}
        {error && <p className="text-[11px] text-rose-600">{error}</p>}
      </div>

      {!m.deleted_at && !editing && (mine || isAdmin) && (
        <div className="absolute right-2 top-1 hidden gap-0.5 rounded-md border border-border bg-surface shadow-sm group-hover:flex">
          {mine && (
            <button type="button" onClick={() => { setDraft(m.body); setEditing(true); }} className="p-1.5 text-text-muted hover:text-navy" aria-label="Edit message">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" onClick={remove} className="p-1.5 text-text-muted hover:text-rose-600" aria-label="Delete message">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}