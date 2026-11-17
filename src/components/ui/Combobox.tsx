"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";

export interface ComboOption {
  id: string;
  label: string;
  detail?: string;
}

interface Props {
  value: string;
  onChange: (id: string) => void;
  /** Text on the closed control when something is chosen. */
  selectedLabel: string;
  /** Options for the current search text; the parent filters or fetches them. */
  options: ComboOption[];
  onQueryChange: (query: string) => void;
  loading?: boolean;
  disabled?: boolean;
  /** Shown on the closed control when nothing is chosen and there is no none option. */
  emptyLabel: string;
  /** When set, offers a first option that clears the choice (e.g. "All clients"). */
  noneLabel?: string;
  searchPlaceholder: string;
  noMatchText: (query: string) => string;
  /** Smaller control for filter bars. */
  compact?: boolean;
  className?: string;
}

/** Searchable single-choice dropdown with keyboard support. */
export default function Combobox({
  value,
  onChange,
  selectedLabel,
  options,
  onQueryChange,
  loading = false,
  disabled,
  emptyLabel,
  noneLabel,
  searchPlaceholder,
  noMatchText,
  compact = false,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items: (ComboOption & { none?: boolean })[] = noneLabel ? [{ id: "", label: noneLabel, none: true }, ...options] : options;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function changeQuery(q: string) {
    setQuery(q);
    setActive(0);
    onQueryChange(q);
  }

  function toggle() {
    if (!open) {
      changeQuery("");
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
    setOpen((o) => !o);
  }

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
      if (it) choose(it.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const hasSelection = !!value && !!selectedLabel;
  const shownLabel = hasSelection ? selectedLabel : !value && noneLabel ? noneLabel : emptyLabel;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface text-left shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15 disabled:bg-surface-alt disabled:text-text-muted ${
          compact ? "px-2.5 py-2 text-xs" : "px-3 py-2 text-sm"
        }`}
      >
        <span className={`min-w-0 truncate ${hasSelection ? "text-text-main" : "text-text-muted"}`}>{shownLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
      </button>

      {open && (
        <div className="absolute left-0 z-[80] mt-1 w-full min-w-[260px] overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="w-full rounded-md border border-border py-1.5 pl-7 pr-7 text-xs outline-none focus:border-navy"
            />
            {loading && <Loader2 className="absolute right-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-text-muted" />}
          </div>
          <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {items.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-text-muted">{loading ? "Searching…" : noMatchText(query)}</p>
            ) : (
              items.map((it, idx) => {
                const isSel = it.id === value;
                return (
                  <button
                    key={it.id || "__none"}
                    type="button"
                    data-idx={idx}
                    role="option"
                    aria-selected={isSel}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => choose(it.id)}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition ${idx === active ? "bg-navy/5" : ""}`}
                  >
                    <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${isSel ? "text-navy" : "text-transparent"}`} />
                    {it.none ? (
                      <span className="italic text-text-muted">{it.label}</span>
                    ) : (
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-text-main">{it.label}</span>
                        {it.detail && <span className="block truncate text-[10px] text-text-muted">{it.detail}</span>}
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
