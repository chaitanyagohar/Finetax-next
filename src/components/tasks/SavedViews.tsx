"use client";

import { useEffect, useState } from "react";
import { Bookmark, BookmarkPlus, X } from "lucide-react";

export type ViewFilters = Record<string, string>;
type SavedView = { name: string; filters: ViewFilters };

const keyFor = (userId: string) => `duesk:task-views:${userId}`;

function read(userId: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((v) => v && typeof v.name === "string" && v.filters).slice(0, 12) : [];
  } catch {
    return [];
  }
}

function write(userId: string, list: SavedView[]) {
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(list));
  } catch {
    // Private browsing or full storage: views last for this visit only
  }
}

/** Named filter sets, kept in this browser for this person. */
export default function SavedViews({ userId, current, onApply }: { userId: string; current: ViewFilters; onApply: (filters: ViewFilters) => void }) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    setViews(read(userId));
  }, [userId]);

  function save(e: React.FormEvent) {
    e.preventDefault();
    const clean = name.trim().slice(0, 40);
    if (!clean) return;
    const next = [...views.filter((v) => v.name.toLowerCase() !== clean.toLowerCase()), { name: clean, filters: current }].slice(-12);
    setViews(next);
    write(userId, next);
    setName("");
    setNaming(false);
  }

  function remove(viewName: string) {
    const next = views.filter((v) => v.name !== viewName);
    setViews(next);
    write(userId, next);
  }

  const isCurrent = (v: SavedView) => Object.keys({ ...v.filters, ...current }).every((k) => (v.filters[k] || "") === (current[k] || ""));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {views.map((v) => (
        <span
          key={v.name}
          className={`group inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
            isCurrent(v) ? "border-accent/40 bg-accent-soft text-accent" : "border-border bg-surface text-text-muted hover:text-text-main"
          }`}
        >
          <button type="button" onClick={() => onApply(v.filters)} className="inline-flex items-center gap-1">
            <Bookmark className="h-3 w-3" /> {v.name}
          </button>
          <button type="button" onClick={() => remove(v.name)} aria-label={`Remove view ${v.name}`} className="rounded-full opacity-60 hover:opacity-100">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {naming ? (
        <form onSubmit={save} className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => !name.trim() && setNaming(false)}
            placeholder="Name this view"
            maxLength={40}
            className="w-36 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] outline-none focus:border-accent"
          />
        </form>
      ) : (
        <button type="button" onClick={() => setNaming(true)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-text-muted hover:bg-surface-alt hover:text-text-main">
          <BookmarkPlus className="h-3.5 w-3.5" /> Save view
        </button>
      )}
    </div>
  );
}
