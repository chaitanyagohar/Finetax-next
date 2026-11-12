"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Check, Compass, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { SessionUser } from "@/components/layout/navConfig";
import { TOURS, type TourStep } from "@/lib/onboarding/tours";
import TourRunner from "./TourRunner";
import DueskLogo from "./DueskLogo";
import Stamp from "./Stamp";

type OnboardingData = {
  setup_completed: boolean;
  onboarding: { tours_seen?: Record<string, string>; checklist_hidden?: boolean };
  progress: Record<string, boolean>;
};

type Item = { key: string; title: string; text: string; href?: string; tour?: string; module?: string; adminOnly?: boolean };

const ITEMS: Item[] = [
  { key: "setup", title: "Set up your firm profile", text: "Letterhead, GSTIN, numbering and bank details.", href: "/setup", adminOnly: true },
  { key: "welcome", title: "Take the 2-minute tour", text: "See where everything lives.", tour: "welcome" },
  { key: "team", title: "Add a team member", text: "Choose exactly which modules they can use.", href: "/team", adminOnly: true },
  { key: "mailbox", title: "Connect your firm mailbox", text: "Send invoices from your own address.", href: "/inbox", adminOnly: true },
  { key: "client", title: "Add your first client", text: "PAN and GSTIN are checked as you type.", href: "/clients", module: "leads" },
  { key: "package", title: "Create a retainer package", text: "Services plus a fee, ready to send.", href: "/packages", adminOnly: true },
  { key: "proposal", title: "Send an engagement letter", text: "Clients accept online; work and billing start.", href: "/packages?tab=proposals", adminOnly: true },
  { key: "task", title: "Create a task", text: "With an internal and a statutory due date.", href: "/tasks", module: "tasks" },
  { key: "time", title: "Track time on a task", text: "Start work on a task and the timer runs itself.", href: "/time-tracking", module: "time_tracking" },
  { key: "invoice", title: "Issue your first invoice", text: "GST-correct, with a UPI QR code.", href: "/invoices", module: "invoices" },
];

const HIDDEN_PATHS = ["/setup", "/welcome", "/reset-password"];

function Ring({ value }: { value: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 -rotate-90" aria-hidden="true">
      <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value)}
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
}

/** Getting started checklist, first-visit tour prompts and the guided tours. Mounted once in the root layout. */
export default function OnboardingLayer({ user }: { user: SessionUser }) {
  const pathname = usePathname() || "/";
  const [supabase] = useState(() => createClient());
  const [data, setData] = useState<OnboardingData | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<{ key: string; steps: TourStep[] } | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const doneBefore = useRef<Set<string> | null>(null);
  const autoStarted = useRef(false);

  const hiddenHere = user.isPlatformHome || HIDDEN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  const can = useCallback(
    (s: { module?: string; adminOnly?: boolean; reviewerOnly?: boolean }) => {
      if (s.adminOnly && !user.isAdmin) return false;
      if (s.reviewerOnly && !user.isReviewer) return false;
      if (s.module && !user.isAdmin && !user.moduleAccess.includes(s.module)) return false;
      return true;
    },
    [user]
  );

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc("my_onboarding");
    if (!error && d) setData(d as OnboardingData);
  }, [supabase]);

  useEffect(() => {
    if (!hiddenHere) load();
  }, [load, pathname, hiddenHere]);

  const seen = useMemo(() => data?.onboarding?.tours_seen || {}, [data]);
  const items = useMemo(() => ITEMS.filter(can), [can]);
  const isDone = useCallback(
    (it: Item) => (it.key === "setup" ? !!data?.setup_completed : it.key === "welcome" ? !!seen.welcome : !!data?.progress?.[it.key]),
    [data, seen]
  );

  const startTour = useCallback(
    (key: string) => {
      const tour = TOURS[key];
      if (!tour) return;
      const steps = tour.steps.filter(can);
      if (steps.length === 0) return;
      setOpen(false);
      setPrompt(null);
      setActive({ key, steps });
    },
    [can]
  );

  const saveOnboarding = useCallback(
    async (patch: OnboardingData["onboarding"]) => {
      setData((d) => (d ? { ...d, onboarding: { ...d.onboarding, ...patch } } : d));
      await supabase.rpc("mark_onboarding", { p_patch: patch });
    },
    [supabase]
  );

  const markSeen = useCallback(
    (key: string) => saveOnboarding({ tours_seen: { ...seen, [key]: new Date().toISOString() } }),
    [saveOnboarding, seen]
  );

  // A small "Done" stamp when a checklist step is completed
  useEffect(() => {
    if (!data) return;
    const now = new Set(items.filter(isDone).map((i) => i.key));
    const before = doneBefore.current;
    if (before) {
      const fresh = items.find((i) => now.has(i.key) && !before.has(i.key) && i.key !== "welcome");
      if (fresh) {
        setCelebrate(fresh.title);
        window.setTimeout(() => setCelebrate(null), 4000);
      }
    }
    doneBefore.current = now;
  }, [data, items, isDone]);

  // ?tour=... links, the automatic welcome tour, and first-visit prompts
  useEffect(() => {
    if (!data || active || hiddenHere) return;

    const params = new URLSearchParams(window.location.search);
    const requested = params.get("tour");
    if (requested && TOURS[requested]) {
      params.delete("tour");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
      startTour(requested);
      return;
    }

    if (!autoStarted.current && pathname === "/" && !seen.welcome && (data.setup_completed || !user.isAdmin)) {
      const t = window.setTimeout(() => {
        autoStarted.current = true;
        startTour("welcome");
      }, 900);
      return () => window.clearTimeout(t);
    }

    const pageTour = TOURS[pathname];
    setPrompt(seen.welcome && pageTour && !seen[pathname] && pageTour.steps.some(can) ? pathname : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pathname]);

  if (hiddenHere || !data) return null;

  const total = items.length;
  const doneCount = items.filter(isDone).length;
  const allDone = doneCount === total;
  const nextUp = items.find((i) => !isDone(i));
  const checklistHidden = !!data.onboarding?.checklist_hidden;
  const pageTour = TOURS[pathname] && TOURS[pathname].steps.some(can) ? pathname : null;

  return (
    <>
      {active && (
        <TourRunner
          steps={active.steps}
          onClose={() => {
            const key = active.key;
            setActive(null);
            markSeen(key);
          }}
        />
      )}

      {celebrate && (
        <div className="ob-from-top fixed left-1/2 top-5 z-[85] -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-5 shadow-xl">
            <Stamp title="Done" size="sm" />
            <span className="text-sm font-semibold text-slate-900">{celebrate}</span>
          </div>
        </div>
      )}

      {!active && prompt && !open && (
        <div className="ob-panel-in fixed bottom-20 left-4 z-[70] w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
          <p className="flex items-center gap-2 text-sm font-semibold text-navy">
            <Compass className="h-4 w-4" /> New to {TOURS[prompt].title}?
          </p>
          <p className="mt-1 text-sm text-slate-600">A one-minute tour of what this page can do. Some steps let you try things as you go.</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => startTour(prompt)}
              className="group inline-flex items-center gap-1 rounded-lg bg-navy px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-navy-light"
            >
              Show me <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                markSeen(prompt);
                setPrompt(null);
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:border-slate-400"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {!active && (
        <div className="fixed bottom-4 left-4 z-[70]">
          {open && (
            <div className="ob-panel-in mb-3 w-[22rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
                <div>
                  <DueskLogo size={22} />
                  <p className="mt-2 text-sm font-semibold text-slate-900">Getting started</p>
                  <p className="text-xs text-slate-500">{allDone ? "All done." : `${doneCount} of ${total} done`}</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mx-4 h-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-1 rounded-full bg-navy transition-all duration-700 ease-out" style={{ width: `${(doneCount / total) * 100}%` }} />
              </div>

              <ul className="mt-2 max-h-[50vh] overflow-y-auto">
                {items.map((it, i) => {
                  const done = isDone(it);
                  const isNext = !done && nextUp?.key === it.key;
                  const content = (
                    <div className="group flex items-start gap-3 px-4 py-2.5">
                      {done ? (
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--ob-ok)] text-white">
                          <Check className="h-3 w-3" />
                        </span>
                      ) : (
                        <span className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 ${isNext ? "border-[var(--ob-stamp)]" : "border-slate-300"}`} />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm ${done ? "text-slate-400 line-through" : isNext ? "font-semibold text-slate-900" : "text-slate-800"}`}>{it.title}</p>
                        {isNext && <p className="text-xs text-slate-500">{it.text}</p>}
                      </div>
                      {!done && <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-navy" />}
                    </div>
                  );
                  return (
                    <li key={it.key} className="ob-rise transition hover:bg-slate-50" style={{ animationDelay: `${i * 0.03}s` }}>
                      {it.tour ? (
                        <button type="button" className="block w-full text-left" onClick={() => startTour(it.tour!)}>
                          {content}
                        </button>
                      ) : (
                        <Link href={it.href || "/"} onClick={() => setOpen(false)} className="block">
                          {content}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>

              <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5">
                {pageTour ? (
                  <button type="button" onClick={() => startTour(pageTour)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy hover:underline">
                    <Compass className="h-4 w-4" /> Tour this page
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={() => saveOnboarding({ checklist_hidden: !checklistHidden })}
                  className="text-xs text-slate-500 transition hover:text-slate-800"
                >
                  {checklistHidden ? "Show progress button" : "Minimise"}
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={`flex items-center gap-2 rounded-full bg-navy text-white shadow-lg transition hover:bg-navy-light ${
              checklistHidden ? "h-11 w-11 justify-center" : "py-2 pl-2 pr-4"
            }`}
            aria-label="Getting started"
          >
            {checklistHidden ? (
              <Compass className="h-5 w-5" />
            ) : (
              <>
                <Ring value={doneCount / total} />
                <span className="text-sm font-semibold">Getting started {doneCount}/{total}</span>
              </>
            )}
          </button>
        </div>
      )}
    </>
  );
}