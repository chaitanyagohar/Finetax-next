"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check } from "lucide-react";

export type PickerClient = {
  id: string;
  name: string;
  organization_name?: string | null;
  pan?: string | null;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
};

/** "Kumar Traders Pvt Ltd — Ramesh Kumar" (organisation first). */
export function clientLabel(c?: Partial<PickerClient> | null): string {
  if (!c) return "";
  const org = String(c.organization_name || "").trim();
  const name = String(c.name || "").trim();
  if (org && name && org.toLowerCase() !== name.toLowerCase()) return `${org} — ${name}`;
  return org || name;
}

export function sortByLabel<T extends Partial<PickerClient>>(list: T[]): T[] {
  return [...list].sort((a, b) => clientLabel(a).localeCompare(clientLabel(b)));
}

interface Props {
  clients: PickerClient[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** When set, shows an option to clear the selection (e.g. "Internal / No client"). */
  noneLabel?: string;
  includeInactive?: boolean;
  className?: string;
}

export default function ClientPicker({
  clients,
  value,
  onChange,
  disabled,
  placeholder = "Type organisation, name, PAN, GSTIN or mobile…",
  noneLabel,
  includeInactive = false,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = clients.find((c) => String(c.id) === String(value));

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const pool = clients.filter(
      (c) => c.status !== "Merged" && (includeInactive || c.status !== "Inactive" || String(c.id) === String(value))
    );
    const matched = !q
      ? pool
      : pool.filter((c) => {
          const hay = [c.organization_name, c.name, c.pan, c.gstin, c.email].filter(Boolean).join(" ").toLowerCase();
          if (hay.includes(q)) return true;
          return digits.length >= 4 && String(c.phone || "").replace(/\D/g, "").includes(digits);
        });
    return sortByLabel(matched).slice(0, 60);
  }, [clients, query, includeInactive, value]);

  const items: any[] = noneLabel ? [{ id: "", none: true }, ...options] : options;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[active];
      if (it) choose(String(it.id));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15 disabled:bg-surface-alt disabled:text-text-muted"
      >
        <span className={`min-w-0 truncate ${selected ? "text-text-main" : "text-text-muted"}`}>
          {selected ? clientLabel(selected) : value === "" && noneLabel ? noneLabel : "— Select client —"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-[80] mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              className="w-full rounded-md border border-border py-1.5 pl-7 pr-2 text-xs outline-none focus:border-navy"
            />
          </div>
          <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {items.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-text-muted">No clients match "{query}".</p>
            ) : (
              items.map((c, idx) => {
                const isSel = String(c.id) === String(value);
                return (
                  <button
                    key={c.id || "__none"}
                    type="button"
                    data-idx={idx}
                    role="option"
                    aria-selected={isSel}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => choose(String(c.id))}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition ${idx === active ? "bg-navy/5" : ""}`}
                  >
                    <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${isSel ? "text-navy" : "text-transparent"}`} />
                    {c.none ? (
                      <span className="italic text-text-muted">{noneLabel}</span>
                    ) : (
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-text-main">{c.organization_name || c.name}</span>
                        <span className="block truncate text-[10px] text-text-muted">
                          {[c.organization_name ? c.name : null, c.gstin || c.pan, c.phone, c.status === "Inactive" ? "Inactive" : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}