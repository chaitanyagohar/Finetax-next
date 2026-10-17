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
  ClipboardList,
  CheckCircle2,
  CalendarClock,
  ArrowRightLeft,
  Megaphone,
  CheckCheck,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getInitials, localISODate } from "@/lib/format";
import { getPageTitle, getVisibleSections, REVIEWER_SUB_TABS, type SessionUser } from "./navConfig";
import { useLogout } from "./useLogout";
import WorkSession from "@/components/time/WorkSession";

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

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  priority: string;
  created_at: string;
  read_at: string | null;
}

const TYPE_LOOK: Record<string, { icon: LucideIcon; style: string }> = {
  task_assigned: { icon: ClipboardList, style: "bg-navy/10 text-navy" },
  task_reviewer: { icon: ShieldCheck, style: "bg-violet-50 text-violet-600" },
  task_submitted: { icon: ShieldCheck, style: "bg-violet-50 text-violet-600" },
  task_changes: { icon: RotateCcw, style: "bg-amber-50 text-amber-600" },
  task_approved: { icon: CheckCircle2, style: "bg-emerald-50 text-emerald-600" },
  task_deadline: { icon: CalendarClock, style: "bg-rose-50 text-rose-600" },
  task_reassigned: { icon: ArrowRightLeft, style: "bg-slate-100 text-slate-600" },
  announcement: { icon: Megaphone, style: "bg-emerald-50 text-emerald-600" },
  transfer_request: { icon: ArrowRightLeft, style: "bg-amber-50 text-amber-600" },
  transfer_declined: { icon: ArrowRightLeft, style: "bg-rose-50 text-rose-600" },
  task_handover: { icon: ClipboardList, style: "bg-blue-50 text-blue-600" },
  queue_changed: { icon: ClipboardList, style: "bg-violet-50 text-violet-600" },
  task_not_started: { icon: CalendarClock, style: "bg-amber-50 text-amber-600" },
  task_due_soon: { icon: CalendarClock, style: "bg-amber-50 text-amber-600" },
  task_overdue: { icon: AlertCircle, style: "bg-rose-50 text-rose-600" },
  statutory_risk: { icon: AlertCircle, style: "bg-rose-100 text-rose-700" },
  review_waiting: { icon: ShieldCheck, style: "bg-violet-50 text-violet-600" },
  timer_auto_stopped: { icon: Bell, style: "bg-slate-100 text-slate-600" },
  billing_ready: { icon: ClipboardList, style: "bg-amber-50 text-amber-600" },
  proposal_accepted: { icon: CheckCircle2, style: "bg-emerald-50 text-emerald-600" },
  proposal_declined: { icon: AlertCircle, style: "bg-rose-50 text-rose-600" },
  tasks_unassigned: { icon: AlertCircle, style: "bg-amber-50 text-amber-600" },
};

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return "yesterday";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function Topbar({ user, onMenuClick }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, loggingOut } = useLogout();
  const [supabase] = useState(() => createClient());

  const [openMenu, setOpenMenu] = useState<"notifications" | "user" | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<NotificationRow | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFetchRef = useRef(0);
  const toastTimer = useRef<number | null>(null);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const roleLabel = user.isAdmin ? "Administrator" : user.isReviewer ? "Staff + Reviewer" : "Execution Staff";

  /* ---------- Action-item counts (count-only queries, throttled to 60s) ---------- */
  const loadCounts = useCallback(
    async (force = false) => {
      const now = Date.now();
      if (!force && now - lastFetchRef.current < 60000) return;
      lastFetchRef.current = now;
      const today = localISODate();

      try {
        let overdueQ = supabase.from("tasks").select("id", { count: "exact", head: true }).neq("stage", "Approved").lt("due_date", today);
        let changesQ = supabase.from("tasks").select("id", { count: "exact", head: true }).eq("stage", "Changes Required");
        if (!user.isAdmin) {
          overdueQ = overdueQ.eq("assigned_to", user.id);
          changesQ = changesQ.eq("assigned_to", user.id);
        }
        const reviewQ = user.isReviewer
          ? (() => {
              let q = supabase.from("tasks").select("id", { count: "exact", head: true }).eq("stage", "Submitted for Review");
              if (!user.isAdmin) q = q.eq("reviewer_id", user.id);
              return q;
            })()
          : null;

        const [o, c, r] = await Promise.all([overdueQ, changesQ, reviewQ ?? Promise.resolve({ count: 0 })]);
        setCounts({ overdue: o.count || 0, changes: c.count || 0, review: r.count || 0 });
      } catch (error) {
        console.error("Notification count error:", error);
      }
    },
    [supabase, user.id, user.isAdmin, user.isReviewer]
  );

  /* ---------- Notifications feed ---------- */
  const loadNotifications = useCallback(async () => {
    const [listRes, countRes] = await Promise.all([
      supabase
        .from("notifications")
        .select("id, type, title, body, link, priority, created_at, read_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
    ]);
    setNotifications((listRes.data || []) as NotificationRow[]);
    setUnread(countRes.count || 0);
  }, [supabase, user.id]);

  useEffect(() => {
    loadCounts(true);
    loadNotifications();
    const onFocus = () => {
      loadCounts();
      loadNotifications();
    };
    window.addEventListener("focus", onFocus);

    const channel = supabase
      .channel(`notif-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, (payload) => {
        if (payload.eventType === "INSERT") {
          const n = payload.new as NotificationRow;
          setNotifications((list) => [n, ...list.filter((x) => x.id !== n.id)].slice(0, 30));
          setUnread((u) => u + 1);
          // On the dashboard, important items appear as popups instead
          if (!(pathRef.current === "/" && n.priority === "important")) {
            setToast(n);
            if (toastTimer.current) window.clearTimeout(toastTimer.current);
            toastTimer.current = window.setTimeout(() => setToast(null), 6000);
          }
          loadCounts(true);
        } else if (payload.eventType === "UPDATE") {
          const n = payload.new as NotificationRow;
          setNotifications((list) => list.map((x) => (x.id === n.id ? { ...x, read_at: n.read_at } : x)));
          supabase
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .is("read_at", null)
            .then(({ count }) => setUnread(count || 0));
        }
      })
      .subscribe();

    return () => {
      window.removeEventListener("focus", onFocus);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      supabase.removeChannel(channel);
    };
  }, [loadCounts, loadNotifications, supabase, user.id]);

  // Refresh (throttled) and close menus on navigation
  useEffect(() => {
    setOpenMenu(null);
    loadCounts();
  }, [pathname, loadCounts]);

  async function openNotification(n: NotificationRow) {
    setOpenMenu(null);
    setToast(null);
    if (!n.read_at) {
      const now = new Date().toISOString();
      setNotifications((list) => list.map((x) => (x.id === n.id ? { ...x, read_at: now } : x)));
      setUnread((u) => Math.max(0, u - 1));
      await supabase.from("notifications").update({ read_at: now }).eq("id", n.id);
    }
    if (n.link) router.push(n.link);
  }

  async function markAllRead() {
    const now = new Date().toISOString();
    setNotifications((list) => list.map((x) => ({ ...x, read_at: x.read_at || now })));
    setUnread(0);
    await supabase.from("notifications").update({ read_at: now }).eq("user_id", user.id).is("read_at", null);
  }

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
    const items: PaletteItem[] = getVisibleSections(user).flatMap((s) => s.items.map((i) => ({ name: i.name, href: i.href, icon: i.icon, group: s.label })));
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

  /* ---------- Action items ---------- */
  const actionItems = [
    { key: "overdue", label: user.isAdmin ? "Overdue (firm)" : "Overdue", count: counts?.overdue || 0, href: "/tasks", icon: AlertCircle, style: "bg-rose-50 text-rose-600" },
    { key: "changes", label: "Changes required", count: counts?.changes || 0, href: "/tasks", icon: RotateCcw, style: "bg-amber-50 text-amber-600" },
    ...(user.isReviewer
      ? [{ key: "review", label: "To review", count: counts?.review || 0, href: "/reviewer-queue?tab=pending", icon: ShieldCheck, style: "bg-violet-50 text-violet-600" }]
      : []),
  ];

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
            <kbd className="hidden rounded border border-border bg-surface px-1.5 py-0.5 font-sans text-[10px] font-semibold md:inline">Ctrl K</kbd>
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
              aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
              aria-expanded={openMenu === "notifications"}
            >
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>

            {openMenu === "notifications" && (
              <div className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-xl animate-scale-in">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-text-main">Notifications</p>
                    <p className="text-[11px] text-text-muted">{unread > 0 ? `${unread} unread` : "You're all caught up"}</p>
                  </div>
                  {unread > 0 && (
                    <button type="button" onClick={markAllRead} className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy hover:underline">
                      <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                    </button>
                  )}
                </div>

                {/* Action items */}
                <div className="flex gap-1.5 border-b border-border px-3 py-2">
                  {actionItems.map((a) => {
                    const Icon = a.icon;
                    return (
                      <Link
                        key={a.key}
                        href={a.href}
                        className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition hover:opacity-80 ${a.style}`}
                        title={a.label}
                      >
                        <Icon className="h-3 w-3" />
                        <span className="truncate">{a.label}</span>
                        <span className="font-bold">{a.count}</span>
                      </Link>
                    );
                  })}
                </div>

                {/* Feed */}
                <div className="max-h-96 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="px-4 py-8 text-center text-xs text-text-muted">No notifications yet.</p>
                  ) : (
                    notifications.map((n) => {
                      const look = TYPE_LOOK[n.type] || { icon: Bell, style: "bg-surface-alt text-text-muted" };
                      const Icon = look.icon;
                      return (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => openNotification(n)}
                          className={`flex w-full items-start gap-3 border-b border-border/60 px-4 py-2.5 text-left text-xs transition last:border-0 hover:bg-surface-alt ${
                            n.read_at ? "" : "bg-navy/[0.03]"
                          }`}
                        >
                          <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${look.style}`}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate ${n.read_at ? "font-medium text-text-main" : "font-bold text-navy"}`}>{n.title}</span>
                            {n.body && <span className="line-clamp-2 block text-[11px] text-text-muted">{n.body}</span>}
                            <span className="mt-0.5 block text-[10px] text-text-muted">{timeAgo(n.created_at)}</span>
                          </span>
                          {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-navy" />}
                        </button>
                      );
                    })
                  )}
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
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{getInitials(user.name)}</div>
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
                    <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-accent">{user.designation || roleLabel}</p>
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

      <WorkSession userId={user.id} />

      {/* New-notification toast */}
      {toast && (
        <div className="fixed right-4 top-16 z-[70] w-80 max-w-[calc(100vw-2rem)] animate-scale-in">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3 shadow-xl">
            {(() => {
              const look = TYPE_LOOK[toast.type] || { icon: Bell, style: "bg-surface-alt text-text-muted" };
              const Icon = look.icon;
              return (
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${look.style}`}>
                  <Icon className="h-4 w-4" />
                </span>
              );
            })()}
            <button type="button" onClick={() => openNotification(toast)} className="min-w-0 flex-1 text-left text-xs">
              <span className="block truncate font-bold text-navy">{toast.title}</span>
              {toast.body && <span className="line-clamp-2 block text-[11px] text-text-muted">{toast.body}</span>}
            </button>
            <button type="button" onClick={() => setToast(null)} className="text-text-muted hover:text-text-main" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Quick navigation palette */}
      {paletteOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[12vh] animate-fade-in" onClick={() => setPaletteOpen(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-2xl animate-scale-in" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Quick navigation">
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
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? "bg-navy text-white" : "text-text-main"}`}
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