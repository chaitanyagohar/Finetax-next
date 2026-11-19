"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AuthLayout from "@/components/auth/AuthLayout";

function safeRedirect(): string {
  const target = new URLSearchParams(window.location.search).get("redirect");
  if (!target) return "/";
  try {
    const url = new URL(target, window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search : "/";
  } catch {
    return "/";
  }
}

/** Second step after the password: the 6-digit code from the authenticator app. */
export default function VerifyPage() {
  const [supabase] = useState(() => createClient());
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const f = data?.totp?.find((x) => x.status === "verified");
      if (f) setFactorId(f.id);
      else window.location.replace("/");
    });
  }, [supabase]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || busy) return;
    setError("");
    setBusy(true);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
    setBusy(false);
    if (err) {
      setCode("");
      return setError(err.message.toLowerCase().includes("rate") ? "Too many tries. Wait a minute and try again." : "That code didn't match. Use the newest code in your app.");
    }
    window.location.replace(safeRedirect());
  }

  async function signOut() {
    await supabase.auth.signOut();
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.replace("/login");
  }

  return (
    <AuthLayout title="Enter your code" subtitle="Open your authenticator app and type the 6-digit code for Duesk.">
      <form onSubmit={submit} className="space-y-5">
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, ""))}
          className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-accent"
          aria-label="6-digit code"
          required
        />
        {error && (
          <p role="alert" className="flex items-center gap-2 text-sm font-medium text-rose-600">
            <AlertCircle className="h-4 w-4" /> {error}
          </p>
        )}
        <button type="submit" disabled={busy || !factorId || code.replace(/\s/g, "").length !== 6} className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy px-4 py-3 text-sm font-semibold text-white transition hover:bg-navy-light disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Verify
        </button>
        <p className="text-center text-xs text-text-muted">
          Lost your phone? Ask your firm&apos;s administrator to reset two-step sign-in.{" "}
          <button type="button" onClick={signOut} className="font-semibold text-navy hover:underline">
            Sign out
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}
