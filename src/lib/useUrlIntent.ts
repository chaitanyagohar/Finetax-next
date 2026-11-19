"use client";

import { useEffect, useRef } from "react";

/**
 * Acts once on links like /invoices?new=1 or /clients?open=<id> (from Ctrl+K and notifications),
 * after the page has loaded its data, then removes the parameter so a refresh doesn't repeat it.
 */
export function useUrlIntent(ready: boolean, handlers: { onNew?: () => void; onOpen?: (id: string) => void }) {
  const done = useRef(false);
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!ready || done.current || typeof window === "undefined") return;
    done.current = true;
    const url = new URL(window.location.href);
    const isNew = url.searchParams.get("new") === "1";
    const openId = url.searchParams.get("open");
    if (!isNew && !openId) return;
    if (isNew) latest.current.onNew?.();
    else if (openId && /^[0-9a-f-]{36}$/i.test(openId)) latest.current.onOpen?.(openId);
    url.searchParams.delete("new");
    url.searchParams.delete("open");
    window.history.replaceState(window.history.state, "", url.pathname + (url.search || "") + url.hash);
  }, [ready]);
}
