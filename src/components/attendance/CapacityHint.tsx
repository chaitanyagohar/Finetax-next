"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { localISODate } from "@/lib/format";

type Row = { user_id: string; available_minutes: number; assigned_minutes: number; open_tasks: number };
let cache: { at: number; rows: Row[] } | null = null;

/** One line under an assignee picker: how loaded the person is over the next week. */
export default function CapacityHint({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Row[] | null>(cache && Date.now() - cache.at < 120000 ? cache.rows : null);

  useEffect(() => {
    if (rows) return;
    const to = new Date();
    to.setDate(to.getDate() + 7);
    createClient()
      .rpc("capacity_report", { p_to: localISODate(to), p_branch: null })
      .then(({ data, error }) => {
        const list = error ? [] : ((data || []) as Row[]);
        cache = { at: Date.now(), rows: list };
        setRows(list);
      });
  }, [rows]);

  const row = rows?.find((r) => r.user_id === userId);
  if (!userId || !row || row.available_minutes <= 0) return null;
  const load = row.assigned_minutes / row.available_minutes;
  const h = (m: number) => `${Math.round(m / 60)}h`;
  return (
    <p className={`mt-1 text-[11px] ${load > 1 ? "font-semibold text-rose-600" : load > 0.8 ? "text-amber-700" : "text-text-muted"}`}>
      Next 7 days: {h(row.assigned_minutes)} of work for {h(row.available_minutes)} available, {row.open_tasks} open tasks
      {load > 1 ? ". Already over capacity." : "."}
    </p>
  );
}
