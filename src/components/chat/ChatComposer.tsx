"use client";

import { useMemo, useRef, useState } from "react";
import { FileText, Loader2, Paperclip, Send, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CHAT_FILE_TYPES, fileSize, type ChatAttachment, type ChatPerson } from "@/lib/chat";

const MAX_BYTES = 10 * 1024 * 1024;

export default function ChatComposer({
  people,
  me,
  placeholder,
  disabled,
  ensureChannel,
  onSend,
}: {
  people: ChatPerson[];
  me: string;
  placeholder: string;
  disabled?: boolean;
  ensureChannel: () => Promise<string | null>;
  onSend: (body: string, mentions: string[], attachments: ChatAttachment[]) => Promise<boolean>;
}) {
  const [supabase] = useState(() => createClient());
  const [text, setText] = useState("");
  const [mentioned, setMentioned] = useState<Record<string, string>>({}); // name → id
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [files, setFiles] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return people.filter((p) => p.id !== me && p.is_active !== false && p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, people, me]);

  function onChange(v: string) {
    setText(v);
    const caret = ref.current?.selectionStart ?? v.length;
    const match = v.slice(0, caret).match(/(?:^|\s)@([\p{L}\p{N}.]*)$/u);
    setQuery(match ? match[1] : null);
    setHighlight(0);
  }

  function pick(p: ChatPerson) {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([\p{L}\p{N}.]*)$/u, `@${p.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setMentioned((m) => ({ ...m, [p.name]: p.id }));
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  async function addFiles(list: FileList) {
    setError("");
    const chosen = Array.from(list).slice(0, 5 - files.length);
    if (!chosen.length) return;
    const cid = await ensureChannel();
    if (!cid) return setError("Could not start this conversation.");
    setUploading(true);
    try {
      for (const f of chosen) {
        if (f.size > MAX_BYTES) throw new Error(`${f.name} is larger than 10 MB.`);
        const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(-80);
        const path = `${cid}/${crypto.randomUUID()}-${safe}`;
        const { error: upErr } = await supabase.storage.from("chat-attachments").upload(path, f, { contentType: f.type || "application/octet-stream" });
        if (upErr) throw upErr;
        setFiles((cur) => [...cur, { path, name: f.name, size: f.size, type: f.type || "application/octet-stream" }]);
      }
    } catch (e: any) {
      setError(e?.message || "Upload failed. That file type may not be allowed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit() {
    const body = text.trim();
    if ((!body && !files.length) || sending || uploading) return;
    const ids = Object.entries(mentioned)
      .filter(([name]) => body.includes(`@${name}`))
      .map(([, id]) => id);
    setSending(true);
    setError("");
    const ok = await onSend(body, ids, files);
    setSending(false);
    if (ok) {
      setText("");
      setFiles([]);
      setMentioned({});
      setQuery(null);
    }
  }

  return (
    <div className="relative border-t border-border bg-surface p-2.5">
      {suggestions.length > 0 && (
        <ul className="absolute bottom-full left-3 mb-1 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-xl" role="listbox">
          {suggestions.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                className={`block w-full px-3 py-2 text-left text-xs ${i === highlight ? "bg-navy/10 text-navy" : "hover:bg-surface-alt"}`}
              >
                @{p.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <span key={f.path} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-alt px-2 py-1 text-[11px]">
              <FileText className="h-3.5 w-3.5 text-navy" />
              <span className="max-w-[140px] truncate">{f.name}</span>
              <span className="text-text-muted">{fileSize(f.size)}</span>
              <button type="button" onClick={() => setFiles((cur) => cur.filter((x) => x.path !== f.path))} aria-label={`Remove ${f.name}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || uploading || files.length >= 5}
          className="rounded-lg p-2 text-text-muted transition hover:bg-surface-alt disabled:opacity-40"
          aria-label="Attach files"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
        </button>
        <input ref={fileRef} type="file" multiple accept={CHAT_FILE_TYPES} className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <textarea
          ref={ref}
          value={text}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (suggestions.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => (h + 1) % suggestions.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pick(suggestions[highlight]);
                return;
              }
              if (e.key === "Escape") {
                setQuery(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder={placeholder}
          className="max-h-40 min-h-[40px] flex-1 resize-none rounded-xl border border-border px-3 py-2 text-[13px] outline-none focus:border-navy focus:ring-2 focus:ring-navy/15 disabled:bg-surface-alt"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || sending || uploading || (!text.trim() && !files.length)}
          className="rounded-xl bg-navy p-2.5 text-white transition hover:bg-navy-light disabled:opacity-40"
          aria-label="Send"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}