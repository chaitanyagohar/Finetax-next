"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  CheckSquare,
  Clock,
  CornerDownLeft,
  FileText,
  Folder,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  Receipt,
  Search,
  Sun,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { REVIEWER_SUB_TABS, getVisibleSections, type SessionUser } from "./navConfig";
import { formatDate } from "@/lib/format";

type Item = { key: string; label: string; hint?: string; href: string; icon: LucideIcon; group: string };

// Escapes characters PostgREST treats specially inside or() filters
const term = (q: string) => q.replace(/[,()*%\\]/g, " ").trim();

/** Ctrl+K: actions, pages and records (clients, tasks, invoices, documents, email) in one search. */
export default function CommandPalette({ user, onClose }: { user: SessionUser; onClose: () => void }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState<Item[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const can = (module: string) => user.isAdmin || user.moduleAccess.includes(module);

  const actions = useMemo<Item[]>(() => {
    if (user.isPlatformHome) return [];
    const list: (Item & { show: boolean })[] = [
      { key: "a-day", label: "Open my day", href: "/my-day", icon: Sun, group: "Actions", show: true },
      { key: "a-task", label: "New task", href: "/tasks?new=1", icon: CheckSquare, group: "Actions", show: user.isAdmin },
      { key: "a-client", label: "New client", href: "/clients?new=1", icon: Users, group: "Actions", show: can("leads") },
      { key: "a-lead", label: "New enquiry", href: "/leads?new=1", icon: UserPlus, group: "Actions", show: can("leads") },
      { key: "a-quote", label: "New quotation", href: "/quotations?new=1", icon: FileText, group: "Actions", show: can("quotations") },
      { key: "a-inv", label: "New invoice", href: "/invoices?new=1", icon: Receipt, group: "Actions", show: can("invoices") },
      { key: "a-time", label: "Log time", href: "/time-tracking?new=1", icon: Clock, group: "Actions", show: can("time_tracking") },
      { key: "a-doc", label: "Upload documents", href: "/documents?new=1", icon: Upload, group: "Actions", show: can("documents") },
      { key: "a-disc", label: "Log a client discussion", href: "/client-discussions?new=1", icon: MessageSquare, group: "Actions", show: can("discussions") },
    ];
    return list.filter((a) => a.show);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const pages = useMemo<Item[]>(() => {
    const items: Item[] = getVisibleSections(user).flatMap((s) =>
      s.items.map((i) => ({ key: `p-${i.href}`, label: i.name, href: i.href, icon: i.icon, group: "Pages", hint: s.label })),
    );
    if (user.isReviewer && !user.isPlatformHome) {
      REVIEWER_SUB_TABS.forEach((t) => items.push({ key: `p-${t.href}`, label: t.name, href: t.href, icon: t.icon, group: "Pages", hint: "Review tasks" }));
    }
    return items;
  }, [user]);

  const q = query.trim().toLowerCase();

  // Records: searched in the database (each table's own access rules apply), debounced
  useEffect(() => {
    const text = term(query);
    if (text.length < 2 || user.isPlatformHome) {
      setRecords([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      const like = `%${text}%`;
      const jobs: Promise<Item[]>[] = [];
      if (can("leads") || can("tasks") || can("invoices")) {
        jobs.push(
          (async () => {
            const { data } = await supabase
              .from("clients")
              .select("id, name, organization_name, pan, gstin")
              .or(`name.ilike.${like},organization_name.ilike.${like},pan.ilike.${like},gstin.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
              .is("merged_into", null)
              .limit(6);
            return (data || []).map((c) => ({
              key: `c-${c.id}`,
              label: c.organization_name || c.name,
              hint: [c.organization_name ? c.name : "", c.gstin || c.pan || ""].filter(Boolean).join(" · "),
              href: `/clients?open=${c.id}`,
              icon: Users,
              group: "Clients",
            }));
          })(),
        );
      }
      if (can("tasks")) {
        jobs.push(
          (async () => {
            const { data } = await supabase.rpc("search_tasks", { p_query: text, p_open_only: false, p_limit: 6 });
            return ((data || []) as { id: string; title: string; period: string | null; client_label: string | null; stage: string }[]).map((t) => ({
              key: `t-${t.id}`,
              label: `${t.title}${t.period ? ` · ${t.period}` : ""}`,
              hint: [t.client_label, t.stage].filter(Boolean).join(" · "),
              href: `/tasks?task=${t.id}`,
              icon: CheckSquare,
              group: "Tasks",
            }));
          })(),
        );
      }
      if (can("invoices")) {
        jobs.push(
          (async () => {
            const { data } = await supabase
              .from("invoices")
              .select("id, invoice_number, buyer_name, organisation, total, date, status")
              .or(`invoice_number.ilike.${like},buyer_name.ilike.${like},organisation.ilike.${like}`)
              .order("date", { ascending: false })
              .limit(5);
            return (data || []).map((i) => ({
              key: `i-${i.id}`,
              label: i.invoice_number || "Draft invoice",
              hint: [i.buyer_name || i.organisation, i.status, formatDate(i.date, "")].filter(Boolean).join(" · "),
              href: `/invoices?open=${i.id}`,
              icon: Receipt,
              group: "Invoices",
            }));
          })(),
        );
      }
      if (can("documents")) {
        jobs.push(
          (async () => {
            const { data } = await supabase
              .from("documents")
              .select("id, title, file_name, category")
              .or(`title.ilike.${like},file_name.ilike.${like}`)
              .order("created_at", { ascending: false })
              .limit(5);
            return (data || []).map((d) => ({
              key: `d-${d.id}`,
              label: d.title || d.file_name,
              hint: d.category || undefined,
              href: `/documents?q=${encodeURIComponent(d.title || d.file_name || "")}`,
              icon: Folder,
              group: "Documents",
            }));
          })(),
        );
      }
      if (can("dashboard")) {
        jobs.push(
          (async () => {
            const { data } = await supabase
              .from("email_messages")
              .select("id, subject, from_address, received_at")
              .or(`subject.ilike.${like},from_address.ilike.${like}`)
              .order("received_at", { ascending: false })
              .limit(5);
            return (data || []).map((m) => ({
              key: `m-${m.id}`,
              label: m.subject || "(No subject)",
              hint: `${m.from_address} · ${formatDate(m.received_at, "")}`,
              href: `/inbox?open=${m.id}`,
              icon: Mail,
              group: "Email",
            }));
          })(),
        );
      }
      const settled = await Promise.allSettled(jobs);
      if (cancelled) return;
      setRecords(settled.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
      setSearching(false);
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, supabase, user]);

  const items = useMemo(() => {
    const match = (i: Item) => !q || `${i.label} ${i.hint || ""}`.toLowerCase().includes(q);
    const shownActions = actions.filter(match);
    const shownPages = pages.filter(match);
    return [...shownActions, ...records, ...shownPages.slice(0, q ? 8 : 20)];
  }, [actions, pages, records, q]);

  useEffect(() => {
    setActive(0);
  }, [query, records.length]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  function go(item?: Item) {
    if (!item) return;
    onClose();
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(0, items.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[active]);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  useEffect(() => {
    document.getElementById(`cmd-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[10vh] backdrop-blur-[2px] animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search and actions"
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          {searching ? <Loader2 className="h-4 w-4 animate-spin text-text-muted" /> : <Search className="h-4 w-4 text-text-muted" />}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search clients, tasks, invoices, documents, email… or type an action"
            aria-activedescendant={items[active] ? `cmd-${active}` : undefined}
            className="h-14 flex-1 bg-transparent text-sm outline-none placeholder:text-text-muted/80"
          />
          <kbd className="rounded border border-border bg-surface-alt px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">Esc</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2" role="listbox">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-text-muted">{searching ? "Searching…" : "Nothing found. Try a client name, GSTIN, invoice number or task."}</p>
          ) : (
            items.map((item, idx) => {
              const Icon = item.icon;
              const isActive = idx === active;
              const heading = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <div key={item.key}>
                  {heading && <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-text-muted first:pt-1">{heading}</p>}
                  <button
                    id={`cmd-${idx}`}
                    role="option"
                    aria-selected={isActive}
                    type="button"
                    onClick={() => go(item)}
                    onMouseMove={() => setActive(idx)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${isActive ? "bg-navy text-white" : "text-text-main"}`}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${isActive ? "bg-white/10" : "bg-surface-alt"}`}>
                      {item.group === "Actions" ? <Plus className={`h-3.5 w-3.5 ${isActive ? "text-white" : "text-accent"}`} /> : <Icon className={`h-3.5 w-3.5 ${isActive ? "text-white" : "text-text-muted"}`} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.label}</span>
                      {item.hint && <span className={`block truncate text-[11px] ${isActive ? "text-white/60" : "text-text-muted"}`}>{item.hint}</span>}
                    </span>
                    {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-white/70" />}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-border bg-surface-alt px-4 py-2 text-[10px] text-text-muted">
          <span>
            <kbd className="font-semibold">↑↓</kbd> move
          </span>
          <span>
            <kbd className="font-semibold">Enter</kbd> open
          </span>
          <span className="ml-auto">Ctrl K anywhere</span>
        </div>
      </div>
    </div>
  );
}
