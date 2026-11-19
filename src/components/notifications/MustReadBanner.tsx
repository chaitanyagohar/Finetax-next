"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Pin } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type MustRead = { id: string; title: string; body: string | null };

/** Must-read announcements stay pinned above every page until the person confirms them. */
export default function MustReadBanner({ userId }: { userId: string }) {
  const [supabase] = useState(() => createClient());
  const [items, setItems] = useState<MustRead[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("my_unread_must_reads");
    setItems((data || []) as MustRead[]);
  }, [supabase]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`must-read-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, userId, load]);

  const current = items[0];
  if (!current) return null;

  async function confirm() {
    setBusy(true);
    const { error } = await supabase.from("announcement_acks").insert([{ announcement_id: current.id, user_id: userId }]);
    if (!error || error.code === "23505") {
      const now = new Date().toISOString();
      await supabase.from("notifications").update({ read_at: now, popup_dismissed_at: now }).eq("entity_id", current.id).eq("user_id", userId);
    }
    setBusy(false);
    setOpen(false);
    load();
  }

  return (
    <div role="region" aria-label="Must-read announcement" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5">
        <Pin className="h-3.5 w-3.5 shrink-0" />
        <span className="font-semibold">Please read: {current.title}</span>
        {items.length > 1 && <span className="text-amber-700">and {items.length - 1} more</span>}
        <span className="ml-auto flex gap-2">
          {current.body && (
            <button type="button" onClick={() => setOpen(!open)} className="font-semibold underline-offset-2 hover:underline">
              {open ? "Hide" : "Read"}
            </button>
          )}
          <button type="button" onClick={confirm} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 font-semibold text-white hover:bg-amber-700 disabled:opacity-60">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} I&apos;ve read this
          </button>
        </span>
        {open && current.body && <p className="w-full whitespace-pre-wrap pb-1 text-amber-950">{current.body}</p>}
      </div>
    </div>
  );
}
