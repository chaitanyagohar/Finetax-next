"use client";

import { useState } from "react";
import { ArrowRight, Loader2, Mail, ShieldCheck } from "lucide-react";
import { AuthArt } from "@/components/ui/Decor";

export default function PortalLoginPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/portal/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "Something went wrong. Please try again.");
    setSent(json.message);
  }

  return (
    <main className="flex min-h-screen">
      <section className="relative hidden w-1/2 overflow-hidden bg-navy p-12 text-white lg:flex lg:flex-col">
        <AuthArt />
        <div className="relative mt-auto max-w-md space-y-3 pb-10">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">Your CA firm, one tap away.</h1>
          <p className="text-sm text-white/70">Send documents from your phone, follow your returns as they are filed, and pay invoices online.</p>
        </div>
      </section>
      <section className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm animate-page-in">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Client portal</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text-main">Sign in</h2>
          <p className="mt-1 text-sm text-text-muted">We&apos;ll email you a link. No password to remember.</p>

          {sent ? (
            <div role="status" className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              <p className="flex items-center gap-2 font-semibold">
                <Mail className="h-4 w-4" /> Check your inbox
              </p>
              <p className="mt-1 text-emerald-700">{sent}</p>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-4">
              <div>
                <label htmlFor="portal-email" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  Email address
                </label>
                <input
                  id="portal-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm shadow-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                />
              </div>
              {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
              <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Email me a sign-in link
              </button>
            </form>
          )}
          <p className="mt-8 flex items-center gap-1.5 text-[11px] text-text-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Only the email address your CA firm registered can sign in.
          </p>
        </div>
      </section>
    </main>
  );
}
