"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Siren } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, Pill } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";

type Row = { task_id: string; title: string; client: string | null; assignee: string | null; due_date: string | null; official_due_date: string | null; stage: string; reason: string; days_late: number };

/** Partners' list: work past the escalation levels, most urgent first. */
export default function EscalationList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    createClient()
      .rpc("escalation_list")
      .then(({ data, error }) => setRows(error ? [] : ((data || []) as Row[])));
  }, []);

  useEffect(() => {
    if (rows?.length && new URLSearchParams(window.location.search).get("escalations")) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [rows]);

  if (!rows || rows.length === 0) return null;
  return (
    <div ref={ref} id="escalations">
      <Card title={`Needs a partner (${rows.length})`} icon={Siren} bodyClassName="p-0">
        <ul className="max-h-80 divide-y divide-border overflow-y-auto text-xs">
          {rows.map((r) => (
            <li key={r.task_id}>
              <Link href={`/tasks?task=${r.task_id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-alt">
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-text-main">{r.title}</span>
                  <span className="text-text-muted">
                    {r.client || "No client"} · with {r.assignee || "nobody"} · {r.stage}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <Pill tone={r.reason === "Overdue" ? "warn" : "bad"}>{r.reason}</Pill>
                  <span className="mt-0.5 block text-[10px] text-text-muted">
                    {r.official_due_date ? `Statutory ${formatDate(r.official_due_date)}` : r.days_late ? `${r.days_late} days late` : formatDate(r.due_date)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
