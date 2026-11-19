"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";

type Update = { id: string; title: string; body: string; link: string | null; published_at: string };
const SEEN_KEY = "duesk:whats-new-seen";

/** Product updates from Duesk, with a dot until the person has looked. */
export default function WhatsNew() {
  const [supabase] = useState(() => createClient());
  const [updates, setUpdates] = useState<Update[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string>("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setSeen(window.localStorage.getItem(SEEN_KEY) || "");
    } catch {
      setSeen("");
    }
    supabase
      .from("platform_updates")
      .select("id, title, body, link, published_at")
      .order("published_at", { ascending: false })
      .limit(8)
      .then(({ data }) => setUpdates((data || []) as Update[]));
  }, [supabase]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!updates.length) return null;
  const fresh = updates.some((u) => u.published_at > seen);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && updates[0]) {
      setSeen(updates[0].published_at);
      try {
        window.localStorage.setItem(SEEN_KEY, updates[0].published_at);
      } catch {
        // Storage blocked: the dot simply comes back next visit
      }
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={fresh ? "What's new (unread)" : "What's new"}
        className="relative rounded-md p-1.5 text-text-muted transition hover:bg-surface-alt hover:text-text-main"
      >
        <Sparkles className="h-5 w-5" />
        {fresh && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-surface" />}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 origin-top-right animate-pop-in overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <p className="border-b border-border px-4 py-3 text-xs font-semibold text-text-main">What&apos;s new in Duesk</p>
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {updates.map((u) => (
              <li key={u.id} className="px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-accent">{formatDate(u.published_at)}</p>
                <p className="mt-0.5 text-sm font-semibold text-text-main">{u.title}</p>
                <p className="mt-0.5 whitespace-pre-line text-xs text-text-muted">{u.body}</p>
                {u.link && (
                  <Link href={u.link} onClick={() => setOpen(false)} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                    Take a look <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
