"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Megaphone, Send, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, btn, field } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";

type Update = { id: string; title: string; body: string; link: string | null; published_at: string };

/** The owner writes the "What's new" notes every Duesk user sees. */
export default function UpdatesComposer() {
  const [supabase] = useState(() => createClient());
  const [list, setList] = useState<Update[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("platform_updates").select("id, title, body, link, published_at").order("published_at", { ascending: false }).limit(20);
    setList((data || []) as Update[]);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: err } = await supabase.from("platform_updates").insert({ title: title.trim(), body: body.trim(), link: link.trim() || null });
    setBusy(false);
    if (err) return setError(err.message);
    setTitle("");
    setBody("");
    setLink("");
    load();
  }

  async function remove(id: string) {
    await supabase.from("platform_updates").delete().eq("id", id);
    load();
  }

  return (
    <Card title="What's new, for every user" icon={Megaphone}>
      <form onSubmit={publish} className="grid gap-3 md:grid-cols-[1fr_1.6fr]">
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="Title, e.g. Online payments are here" className={field.input} />
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link (optional), e.g. /settings" className={field.input} />
        </div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} required rows={3} placeholder="What changed and why it helps." className={field.input} />
        {error && <p className="text-xs text-rose-600 md:col-span-2">{error}</p>}
        <div className="md:col-span-2">
          <button type="submit" disabled={busy} className={btn.primary}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Publish
          </button>
        </div>
      </form>
      {list.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {list.map((u) => (
            <li key={u.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
              <span>
                <span className="font-semibold text-text-main">{u.title}</span>
                <span className="text-text-muted"> · {formatDate(u.published_at)}</span>
                <span className="block text-text-muted">{u.body}</span>
              </span>
              <button type="button" onClick={() => remove(u.id)} className="rounded-md p-1 text-text-muted hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete ${u.title}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
