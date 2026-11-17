"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, MousePointerClick, X } from "lucide-react";
import type { TourStep } from "@/lib/onboarding/tours";
import DueskLogo from "./DueskLogo";
import Stamp from "./Stamp";

type Rect = { top: number; left: number; width: number; height: number };
type Side = "right" | "bottom" | "top" | "center";

const PAD = 8;
const CARD_W = 360;

function findTarget(selector?: string): HTMLElement | null {
  if (!selector) return null;
  let list: HTMLElement[] = [];
  try {
    list = Array.from(document.querySelectorAll<HTMLElement>(selector));
  } catch {
    return null;
  }
  return (
    list.find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }) || null
  );
}

/**
 * Spotlight tour. The page dims, the highlighted element stays bright, and a card explains it.
 * Steps with `tryIt` let the person click the highlighted control; the tour moves on by itself.
 */
export default function TourRunner({ steps, onClose }: { steps: TourStep[]; onClose: (completed: boolean) => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  const [tried, setTried] = useState(false);
  const [view, setView] = useState({ w: 1280, h: 800 });
  const step = steps[index];
  const isLast = index === steps.length - 1;

  useEffect(() => {
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Find the element, scroll to it and measure it
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    setReady(false);
    setTried(false);

    function measure(el: HTMLElement) {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    }

    function locate() {
      if (cancelled) return;
      const el = findTarget(step?.target);
      if (el) {
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        window.setTimeout(() => {
          if (cancelled) return;
          measure(el);
          setReady(true);
        }, 380);
      } else if (step?.target && tries < 15) {
        tries += 1;
        window.setTimeout(locate, 100);
      } else {
        setRect(null);
        setReady(true);
      }
    }

    function onMove() {
      const el = findTarget(step?.target);
      if (el) measure(el);
    }

    locate();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [step]);

  // "Try it" steps: wait for the person to click the highlighted control
  useEffect(() => {
    if (!ready || !step?.tryIt) return;
    const el = findTarget(step.target);
    if (!el) return;
    let timer: number | undefined;
    const onClick = () => {
      setTried(true);
      timer = window.setTimeout(() => (isLast ? onClose(true) : setIndex((i) => i + 1)), 700);
    };
    el.addEventListener("click", onClick, { once: true });
    return () => {
      el.removeEventListener("click", onClick);
      if (timer) window.clearTimeout(timer);
    };
  }, [ready, step, isLast, onClose]);

  // Keyboard: arrows to move, Esc to leave
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose(false);
      if (e.key === "ArrowRight") {
        if (isLast) onClose(true);
        else setIndex((i) => i + 1);
      }
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLast, onClose]);

  if (!step) return null;

  const target = ready && rect ? rect : null;
  const spot = target || { top: view.h / 2, left: view.w / 2, width: 0, height: 0 };
  const canClickThrough = !!target && !!step.tryIt;

  let side: Side = "center";
  let cardStyle: React.CSSProperties = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  if (target) {
    const clampTop = (t: number) => Math.min(Math.max(t, 16), view.h - 320);
    const clampLeft = (l: number) => Math.min(Math.max(l, 16), view.w - CARD_W - 16);
    if (target.width <= 320 && target.left + target.width + CARD_W + 36 < view.w) {
      side = "right";
      cardStyle = { top: clampTop(target.top + target.height / 2 - 60), left: target.left + target.width + 16, transform: "none" };
    } else if (view.h - (target.top + target.height) > 290) {
      side = "bottom";
      cardStyle = { top: target.top + target.height + 14, left: clampLeft(target.left), transform: "none" };
    } else {
      side = "top";
      cardStyle = { top: clampTop(target.top - 300), left: clampLeft(target.left), transform: "none" };
    }
  }
  const enter = side === "right" ? "ob-from-left" : side === "bottom" ? "ob-from-top" : side === "top" ? "ob-from-bottom" : "ob-fade";

  // Transparent panels around the highlighted element block clicks on the rest of the page
  const blockers: React.CSSProperties[] = [
    { top: 0, left: 0, right: 0, height: spot.top },
    { top: spot.top + spot.height, left: 0, right: 0, bottom: 0 },
    { top: spot.top, left: 0, width: spot.left, height: spot.height },
    { top: spot.top, left: spot.left + spot.width, right: 0, height: spot.height },
  ];
  if (!canClickThrough) blockers.push({ top: spot.top, left: spot.left, width: spot.width, height: spot.height });

  return (
    <div className="ob-fade pointer-events-none fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={step.title}>
      <div
        className="ob-spot absolute rounded-lg"
        style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height, boxShadow: "0 0 0 9999px rgba(16, 35, 63, 0.62)" }}
      />
      {target && (
        <div
          className="ob-spot absolute rounded-lg border-2 border-white"
          style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
        />
      )}
      {blockers.map((b, i) => (
        <div key={i} className="pointer-events-auto absolute" style={b} />
      ))}

      <div className="ob-move pointer-events-auto absolute w-[360px] max-w-[calc(100vw-32px)]" style={cardStyle}>
        <div key={index} className={`${enter} rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl`}>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
            <span className="flex items-center gap-2 text-xs text-slate-500">
              <DueskLogo size={18} wordmark={false} />
              {index + 1} of {steps.length}
            </span>
            <button type="button" onClick={() => onClose(false)} className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close tour">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-5 pb-5 pt-4">
            <p className="text-lg font-bold leading-snug text-navy">{step.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{step.body}</p>
            {step.points && (
              <ul className="mt-3 space-y-1.5">
                {step.points.map((p) => (
                  <li key={p} className="flex gap-2 text-sm text-slate-800">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-navy" />
                    {p}
                  </li>
                ))}
              </ul>
            )}

            {step.tryIt && target && (
              <p
                key={tried ? "done" : "try"}
                className={`ob-pop mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
                  tried ? "bg-emerald-50 text-[var(--ob-ok)]" : "bg-[var(--ob-stamp)]/[0.07] text-[var(--ob-stamp)]"
                }`}
              >
                <MousePointerClick className={`h-4 w-4 shrink-0 ${tried ? "" : "ob-hint"}`} />
                {tried ? "That's it." : step.tryIt}
              </p>
            )}

            {isLast && (
              <div className="mt-4 flex justify-end">
                <Stamp title="Tour" subtitle="complete" size="sm" />
              </div>
            )}

            <div className="mt-5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1" aria-hidden="true">
                {steps.map((_, i) => (
                  <span key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? "w-5 bg-navy" : i < index ? "w-1.5 bg-navy/40" : "w-1.5 bg-slate-200"}`} />
                ))}
              </div>
              <div className="flex gap-2">
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => setIndex((i) => i - 1)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:border-slate-400"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (isLast ? onClose(true) : setIndex((i) => i + 1))}
                  className={`group inline-flex items-center gap-1 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
                    step.tryIt && target && !tried ? "border border-slate-300 text-slate-600 hover:border-slate-400" : "bg-navy text-white hover:bg-navy-light"
                  }`}
                >
                  {isLast ? "Finish" : step.tryIt && target && !tried ? "Skip" : "Next"}
                  {!isLast && <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}