"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin bar across the top while the next page loads. It starts when an in-app link is
 * clicked and finishes when the new address is shown.
 */
export default function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [startedFor, setStartedFor] = useState("");
  const here = `${pathname}?${searchParams.toString()}`;

  // The address changed while loading: finish the bar (adjusting state during render, not in an effect)
  if (state === "loading" && startedFor !== here) {
    setState("done");
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as HTMLElement | null)?.closest("a");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      const target = `${url.pathname}?${url.searchParams.toString()}`;
      const current = `${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`;
      if (target === current) return;
      setStartedFor(current);
      setState("loading");
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (state !== "done") return;
    const t = window.setTimeout(() => setState("idle"), 300);
    return () => window.clearTimeout(t);
  }, [state]);

  if (state === "idle") return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5">
      <div
        className={`h-full origin-left bg-accent ${state === "done" ? "scale-x-100 opacity-0 transition-all duration-300" : ""}`}
        style={state === "loading" ? { animation: "progress 8s cubic-bezier(0.1, 0.7, 0.2, 1) forwards" } : undefined}
      />
    </div>
  );
}
