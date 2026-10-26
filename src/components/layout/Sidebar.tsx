"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LogOut, Shield, ChevronDown, ChevronRight, X, Loader2 } from "lucide-react";
import {
  getVisibleSections,
  isPathActive,
  REVIEWER_SUB_TABS,
  roleLabelFor,
  type NavSection,
  type SessionUser,
} from "./navConfig";
import { useLogout } from "./useLogout";
import { getInitials } from "@/lib/format";

interface SidebarProps {
  user: SessionUser;
  mobileOpen: boolean;
  onClose: () => void;
}

/** First letter of the firm name, ignoring a leading "M/S". */
function firmInitial(name: string): string {
  const clean = String(name || "").replace(/^m\/s\.?\s*/i, "").trim();
  const ch = clean.match(/[A-Za-z0-9]/)?.[0];
  return (ch || "D").toUpperCase();
}

export default function Sidebar({ user, mobileOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { logout, loggingOut } = useLogout();
  const [isReviewerOpen, setIsReviewerOpen] = useState(true);

  const platform = !!user.isPlatformHome;
  const sections = getVisibleSections(user);
  const mainSections = sections.filter((s) => s.label !== "Administration");
  const adminSection = sections.find((s) => s.label === "Administration");

  const activeReviewTab = pathname === "/reviewer-queue" ? searchParams.get("tab") || "pending" : null;
  const roleLabel = roleLabelFor(user);
  const homeHref = platform ? (user.isPlatformOwner ? "/owner" : "/support") : "/";

  function renderLinks(section: NavSection) {
    return section.items.map((item) => {
      const Icon = item.icon;
      const isActive = isPathActive(pathname, item.href);
      return (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive ? "page" : undefined}
          className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition ${
            isActive ? (platform ? "bg-violet-600 text-white shadow-sm" : "bg-accent text-white shadow-sm") : "text-muted hover:bg-white/10 hover:text-white"
          }`}
        >
          <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-white" : "text-white/50 group-hover:text-white"}`} />
          <span className="truncate">{item.name === "Owner Console" && platform ? "Firms" : item.name}</span>
        </Link>
      );
    });
  }

  function renderSection(section: NavSection) {
    return (
      <div key={section.label}>
        <p className="px-3 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-widest text-white/40">{section.label}</p>
        <div className="space-y-0.5">{renderLinks(section)}</div>
      </div>
    );
  }

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 animate-fade-in lg:hidden" onClick={onClose} aria-hidden="true" />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col text-white transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${
          platform ? "bg-violet-950" : "bg-navy"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Brand header */}
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-4">
          <Link href={homeHref} className="flex min-w-0 items-center gap-2.5">
            {platform ? (
              <>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500 text-sm font-black text-white shadow-sm">D</div>
                <div className="min-w-0">
                  <h1 className="truncate text-base font-bold leading-tight tracking-tight text-white">Duesk</h1>
                  <p className="truncate text-[11px] font-medium text-violet-200">{user.isPlatformOwner ? "Owner Console" : "Support Desk"}</p>
                </div>
              </>
            ) : (
              <>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white shadow-sm">
                  {firmInitial(user.orgName)}
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-sm font-bold leading-tight tracking-tight text-white" title={user.orgName}>
                    {user.orgName || "Your firm"}
                  </h1>
                  <p className="truncate text-[11px] font-medium text-muted">Duesk by Oddlambda</p>
                </div>
              </>
            )}
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted transition hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Main navigation">
          {platform ? (
            // Duesk console: one plain list, no section headings
            <div className="space-y-0.5 pt-4">{sections.map((s) => renderLinks(s))}</div>
          ) : (
            <>
              {mainSections.map(renderSection)}

              {/* Review hub (admins, reviewers) */}
              {user.isReviewer && (
                <div className="pt-4">
                  <button
                    type="button"
                    onClick={() => setIsReviewerOpen(!isReviewerOpen)}
                    aria-expanded={isReviewerOpen}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-accent transition hover:text-white"
                  >
                    <span className="flex items-center gap-2">
                      <Shield className="h-3.5 w-3.5" /> Review Tasks
                    </span>
                    {isReviewerOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>

                  {isReviewerOpen && (
                    <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-accent/30 pl-3">
                      {REVIEWER_SUB_TABS.map((sub) => {
                        const SubIcon = sub.icon;
                        const isSubActive = activeReviewTab === sub.tab;
                        return (
                          <Link
                            key={sub.href}
                            href={sub.href}
                            aria-current={isSubActive ? "page" : undefined}
                            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition ${
                              isSubActive ? "bg-white/15 font-semibold text-white" : "text-muted hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            <SubIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
                            <span className="truncate">{sub.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {adminSection && renderSection(adminSection)}
            </>
          )}
        </nav>

        {/* Profile footer */}
        <div className={`border-t border-white/10 p-3 ${platform ? "bg-black/20" : "bg-navy-dark/40"}`}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">{getInitials(user.name)}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{user.name}</p>
              <p className={`truncate text-[11px] ${platform ? "text-violet-200" : "text-muted"}`}>{roleLabel}</p>
            </div>
            <button
              type="button"
              onClick={logout}
              disabled={loggingOut}
              className="rounded-md p-1.5 text-muted transition hover:bg-white/10 hover:text-white disabled:opacity-50"
              title="Log out"
              aria-label="Log out"
            >
              {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}