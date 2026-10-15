"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Search,
  User,
  Menu,
  AlertCircle,
  ShieldCheck,
  RotateCcw,
  LogOut,
  Loader2,
  CornerDownLeft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getInitials, localISODate } from "@/lib/format";
import { getPageTitle, getVisibleSections, REVIEWER_SUB_TABS, type SessionUser } from "./navConfig";
import { useLogout } from "./useLogout";

interface TopbarProps {
  user: SessionUser;
  onMenuClick: () => void;
}

interface Counts {
  overdue: number;
  changes: number;
  review: number;
}

interface PaletteItem {
  name: string;
  href: string;
  icon: LucideIcon;
  group: string;
}

export default function Topbar({ user, onMenuClick }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, loggingOut } = useLogout();

  const [openMenu, setOpenMenu] = useState<"notifications" | "user" | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFetchRef = useRef(0);

  const roleLabel = user.isAdmin ? "Administrator" : user.isReviewer ? "Staff + Reviewer" : "Execution Staff";

  /* ---------- Notification counts (count-only queries, throttled to 60s) ---------- */
  const loadCounts = useCallback(
    async (force = false) => {
      const now = Date.now();
      if (!force && now - lastFetchRef.current < 60000) return;
      lastFetchRef.current = now;

      const supabase = createClient();
      const today = localISODate();

      try {
        let overdueQ = supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .neq("stage", "Approved")
          .lt("due_date", today);

        let changesQ = supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("stage", "Changes Required");

        if (!user.isAdmin) {
          overdueQ = overdueQ.eq("assigned_to", user.id);
          changesQ = changesQ.eq("assigned_to", user.id);
        }

        const reviewQ = user.isReviewer
          ? (() => {
              let q = supabase
                .from("tasks")
                .select("id", { count: "exact", head: true })
                .eq("stage", "Submitted for Review");
              if (!user.isAdmin) q = q.eq("reviewer_id", user.id);
              return q;
            })()
          : null;

        const [o, c, r] = await Promise.all([overdueQ, changesQ, reviewQ ?? Promise.resolve({ count: 0 })]);

        setCounts({
          overdue: o.count || 0,
          changes: c.count || 0,
          review: r.count || 0,
        });
      } catch (error) {
        console.error("Notification count error:", error);
      }
    },
    [user.id, user.isAdmin, user.isReviewer]
  );

  useEffect(() => {
    loadCounts(true);
    const onFocus = () => loadCounts();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadCounts]);

  // Refresh (throttled) and close menus on navigation
  useEffect(() => {
    setOpenMenu(null);
    loadCounts();
  }, [pathname, loadCounts]);

  /* ---------- Close dropdowns on outside click / Escape ---------- */
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  /* ---------- Quick navigation palette (Ctrl/Cmd + K) ---------- */
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = getVisibleSections(user).flatMap((s) =>
      s.items.map((i) => ({ name: i.name, href: i.href, icon: i.icon, group: s.label }))
    );
    if (user.isReviewer) {
      REVIEWER_SUB_TABS.forEach((t) => items.push({ name: t.name, href: t.href, icon: t.icon, group: "Review Tasks" }));
    }
    return items;
  }, [user]);

  const q = query.trim().toLowerCase();
  const filteredItems = q ? paletteItems.filter((i) => `${i.name} ${i.group}`.toLowerCase().includes(q)) : paletteItems;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setActiveIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [paletteOpen]);

  function goTo(href: string) {
    setPaletteOpen(false);
    router.push(href);
  }

  function onPaletteKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, filteredItems.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filteredItems[activeIndex];
      if (item) goTo(item.href);
    } else if (e.key === "Escape") {
      setPaletteOpen(false);
    }
  }

  /* ---------- Notification items ---------- */
  const notificationItems = [
    {
      key: "overdue",
      label: user.isAdmin ? "Overdue tasks across the firm" : "Your overdue tasks",
      count: counts?.overdue || 0,
      href: "/tasks",
      icon: AlertCircle,
      style: "bg-rose-50 text-rose-600",
    },
    {
      key: "changes",
      label: user.isAdmin ? "Tasks sent back for changes" : "Your tasks needing changes",
      count: counts?.changes || 0,
      href: "/tasks",
      icon: RotateCcw,
      style: "bg-amber-50 text-amber-600",
    },
    ...(user.isReviewer
      ? [
          {
            key: "review",
            label: user.isAdmin ? "Tasks awaiting review" : "Tasks awaiting your review",
            count: counts?.review || 0,
            href: "/reviewer-queue?tab=pending",
            icon: ShieldCheck,
            style: "bg-violet-50 text-violet-600",
          },
        ]
      : []),
  ];
  const totalAlerts = notificationItems.reduce((sum, n) => sum + n.count, 0);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6">
        {/* Left: menu + page title */}
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="rounded-md p-1.5 text-text-muted transition hover:bg-surface-alt hover:text-text-main lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h2 className="truncate text-sm font-semibold text-text-main">{getPageTitle(pathname)}</h2>
        </div>

        {/* Right: search, notifications, user */}
        <div className="flex items-center gap-2" ref={menuRef}>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-alt px-2.5 py-1.5 text-xs text-text-muted transition hover:border-navy/30 hover:text-text-main"
            aria-label="Quick navigation"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Jump to...</span>
            <kbd className="hidden rounded border border-border bg-surface px-1.5 py-0.5 font-sans text-[10px] font-semibold md:inline">
              Ctrl K
            </kbd>
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setOpenMenu(openMenu === "notifications" ? null : "notifications");
                loadCounts(true);
              }}
              className="relative rounded-md p-1.5 text-text-muted transition hover:bg-surface-alt hover:text-text-main"
              aria-label={`Notifications${totalAlerts > 0 ? ` (${totalAlerts})` : ""}`}
              aria-expanded={openMenu === "notifications"}
            >
              <Bell className="h-5 w-5" />
              {totalAlerts > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
                  {totalAlerts > 9 ? "9+" : totalAlerts}
                </span>
              )}
            </button>

            {openMenu === "notifications" && (
              <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-xl animate-scale-in">
                <div className="border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold text-text-main">Action Items</p>
                  <p className="text-[11px] text-text-muted">
                    {totalAlerts > 0 ? `${totalAlerts} item${totalAlerts === 1 ? "" : "s"} need attention` : "You're all caught up"}
                  </p>
                </div>
                <div className="p-2">
                  {notificationItems.map((n) => {
                    const Icon = n.icon;
                    return (
                      <Link
                        key={n.key}
                        href={n.href}
                        className="flex items-center gap-3 rounded-lg px-2 py-2 text-xs transition hover:bg-surface-alt"
                      >
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${n.style}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="flex-1 font-medium text-text-main">{n.label}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            n.count > 0 ? "bg-navy text-white" : "bg-surface-alt text-text-muted"
                          }`}
                        >
                          {n.count}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="h-6 w-px bg-border" />

          {/* User menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu(openMenu === "user" ? null : "user")}
              className="flex items-center gap-2 rounded-lg p-1 transition hover:bg-surface-alt"
              aria-expanded={openMenu === "user"}
              aria-label="Account menu"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">
                {getInitials(user.name)}
              </div>
              <div className="hidden text-left text-xs sm:block">
                <p className="max-w-[140px] truncate font-semibold leading-tight text-text-main">{user.name}</p>
                <p className="leading-tight text-text-muted">{roleLabel}</p>
              </div>
            </button>

            {openMenu === "user" && (
              <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-xl animate-scale-in">
                <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-alt text-text-muted">
                    <User className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 text-xs">
                    <p className="truncate font-semibold text-text-main">{user.name}</p>
                    <p className="truncate text-text-muted">{user.email}</p>
                    <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-accent">
                      {user.designation || roleLabel}
                    </p>
                  </div>
                </div>
                <div className="p-2">
                  <button
                    type="button"
                    onClick={logout}
                    disabled={loggingOut}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-danger transition hover:bg-rose-50 disabled:opacity-50"
                  >
                    {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                    {loggingOut ? "Signing out..." : "Sign out"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Quick navigation palette */}
      {paletteOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[12vh] animate-fade-in"
          onClick={() => setPaletteOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-scale-in"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Quick navigation"
          >
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="h-4 w-4 text-text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onPaletteKeyDown}
                placeholder="Jump to a module..."
                className="h-12 flex-1 bg-transparent text-sm outline-none"
              />
              <kbd className="rounded border border-border bg-surface-alt px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">Esc</kbd>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {filteredItems.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-text-muted">No matching modules.</p>
              ) : (
                filteredItems.map((item, idx) => {
                  const Icon = item.icon;
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onClick={() => goTo(item.href)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                        isActive ? "bg-navy text-white" : "text-text-main"
                      }`}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-white" : "text-text-muted"}`} />
                      <span className="flex-1 truncate font-medium">{item.name}</span>
                      <span className={`text-[10px] ${isActive ? "text-white/70" : "text-text-muted"}`}>{item.group}</span>
                      {isActive && <CornerDownLeft className="h-3.5 w-3.5 text-white/70" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}