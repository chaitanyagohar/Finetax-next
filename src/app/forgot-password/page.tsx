"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";
import AuthLayout from "@/components/auth/AuthLayout";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_MS = 60000;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [coolingDown, setCoolingDown] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "link_invalid") {
      setError("That reset link is invalid or has expired. Please request a new one.");
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || coolingDown) return;

    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
      });

      if (resetError && /rate|too many|security purposes/i.test(resetError.message)) {
        setError("Too many requests. Please wait a minute and try again.");
      } else {
        if (resetError) console.error("Reset request error:", resetError.message);
        // Same response whether or not the account exists (prevents email discovery)
        setSent(true);
        setCoolingDown(true);
        setTimeout(() => setCoolingDown(false), RESEND_COOLDOWN_MS);
      }
    } catch {
      setError("A network error occurred. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title={sent ? "Check your email" : "Forgot your password?"}
      subtitle={sent ? undefined : "Enter your official email and we'll send you a secure reset link."}
    >
      {sent ? (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold">If an account exists for {email.trim().toLowerCase()}, a reset link is on its way.</p>
              <p className="text-emerald-700">The link can only be used once and expires shortly. Check your spam folder if you don't see it.</p>
            </div>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm font-medium text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || coolingDown}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface p-2.5 text-sm font-semibold text-text-main shadow-sm transition hover:bg-surface-alt disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {coolingDown ? "You can resend in a minute" : "Send the link again"}
          </button>

          <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm font-semibold text-navy hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm font-medium text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
              Official Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface py-2.5 pl-10 pr-3 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
                placeholder="name@firm.com"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy p-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-70"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Sending..." : "Send reset link"}
          </button>

          <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm font-semibold text-navy hover:underline">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}