"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Combobox, { type ComboOption } from "@/components/ui/Combobox";
import { formatDate } from "@/lib/format";

export interface PickedTask {
  id: string;
  title: string;
  period: string | null;
  stage: string;
  due_date: string | null;
  official_due_date: string | null;
  client_id: string | null;
  client_label: string | null;
  assigned_to: string | null;
}

interface Props {
  value: string;
  onChange: (id: string, task: PickedTask | null) => void;
  /** Only tasks of this client. */
  clientId?: string;
  /** Leave out approved tasks (default). */
  openOnly?: boolean;
  /** Only tasks the user is assigned to or reviews; administrators see all. */
  mineOnly?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}

const SEARCH_DELAY_MS = 250;

export function taskLabel(t: Pick<PickedTask, "title" | "period">): string {
  return t.period ? `${t.title} · ${t.period}` : t.title;
}

function taskDetail(t: PickedTask): string {
  return [
    t.client_label || "Internal",
    t.due_date ? `Due ${formatDate(t.due_date)}` : null,
    t.stage === "Assigned" ? null : t.stage,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Searchable task choice. Searches on the server by title, period, category and client, so no task is missing from the list. */
export default function TaskPicker({ value, onChange, clientId, openOnly = true, mineOnly = false, noneLabel, disabled, compact, className }: Props) {
  const [supabase] = useState(() => createClient());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedTask[]>([]);
  const [resultsKey, setResultsKey] = useState("");
  const [picked, setPicked] = useState<PickedTask | null>(null);
  const [fetched, setFetched] = useState<PickedTask | null>(null);

  const searchKey = JSON.stringify([query, clientId || null, openOnly, mineOnly]);
  const loading = resultsKey !== searchKey;

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.rpc("search_tasks", {
        p_query: query,
        p_client: clientId || null,
        p_open_only: openOnly,
        p_mine_only: mineOnly,
        p_limit: 30,
      });
      if (cancelled) return;
      setResults((data as PickedTask[]) || []);
      setResultsKey(searchKey);
    }, query ? SEARCH_DELAY_MS : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [supabase, query, clientId, openOnly, mineOnly, searchKey]);

  const selected = value ? [picked, fetched, ...results].find((t) => t?.id === value) || null : null;

  // The chosen task may not be among the current results, e.g. when editing a saved entry
  useEffect(() => {
    if (!value || selected) return;
    let cancelled = false;
    supabase
      .from("tasks")
      .select("id, title, period, stage, due_date, official_due_date, client_id, assigned_to, organisation, clients!client_id(name, organization_name)")
      .eq("id", value)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const client = Array.isArray(data.clients) ? data.clients[0] : data.clients;
        setFetched({
          id: data.id,
          title: data.title,
          period: data.period,
          stage: data.stage,
          due_date: data.due_date,
          official_due_date: data.official_due_date,
          client_id: data.client_id,
          client_label: client?.organization_name?.trim() || client?.name || data.organisation || null,
          assigned_to: data.assigned_to,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, value, selected]);

  const options: ComboOption[] = useMemo(() => results.map((t) => ({ id: t.id, label: taskLabel(t), detail: taskDetail(t) })), [results]);

  function choose(id: string) {
    const task = results.find((t) => t.id === id) || null;
    setPicked(task);
    onChange(id, task);
  }

  return (
    <Combobox
      value={value}
      onChange={choose}
      selectedLabel={selected ? taskLabel(selected) : value ? "Loading task…" : ""}
      options={options}
      onQueryChange={setQuery}
      loading={loading}
      disabled={disabled}
      emptyLabel="— Select task —"
      noneLabel={noneLabel}
      searchPlaceholder="Type task, client or period, e.g. 3B Sharma Oct"
      noMatchText={(q) => (q ? `No ${openOnly ? "open " : ""}tasks match "${q}".` : `No ${openOnly ? "open " : ""}tasks found.`)}
      compact={compact}
      className={className}
    />
  );
}
