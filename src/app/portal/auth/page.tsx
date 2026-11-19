"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";

/** The page a sign-in link opens. Signing in needs a click, so link scanners in mail apps can't use the link up. */
export default function PortalAuthPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = new URL(window.location.href).searchParams.get("t") || "";
    setToken(t);
    // Keep the one-time link out of the browser history
    window.history.replaceState(null, "", "/portal/auth");
  }, []);

  async function go() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/portal/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      return setError(json.error || "This link can't be used. Ask for a new one.");
    }
    router.replace("/portal");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm animate-page-in rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">Client portal</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-text-main">Welcome back</h1>
        <p className="mt-1 text-sm text-text-muted">Continue to see your documents, filings and invoices.</p>
        {error ? (
          <>
            <p className="mt-6 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>
            <Link href="/portal/login" className="mt-4 inline-flex text-sm font-semibold text-accent hover:underline">
              Get a new sign-in link
            </Link>
          </>
        ) : (
          <button
            type="button"
            onClick={go}
            disabled={busy || !token}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Continue
          </button>
        )}
      </div>
    </main>
  );
}
