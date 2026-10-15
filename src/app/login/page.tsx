"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Mail, AlertCircle, CheckCircle2 } from "lucide-react";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordInput from "@/components/ui/PasswordInput";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30000;

// Only allow same-site relative redirects (prevents open-redirect attacks)
function getSafeRedirect(): string {
  const params = new URLSearchParams(window.location.search);
  const target = params.get("redirect") || params.get("next");
  if (target && target.startsWith("/") && !target.startsWith("//") && !target.startsWith("/\\")) {
    return target;
  }
  return "/";
}

// Never show raw auth errors to the user
function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Incorrect email or password.";
  if (m.includes("email not confirmed")) return "Your email is not verified. Please contact your administrator.";
  if (m.includes("rate") || m.includes("too many")) return "Too many attempts. Please wait a few minutes and try again.";
  return "Unable to sign in. Please try again.";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState<number | null>(null);

  const supabase = createClient();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") === "success") {
      setNotice("Your password has been updated. Please sign in with your new password.");
    }
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    if (lockUntil && Date.now() < lockUntil) {
      const secs = Math.ceil((lockUntil - Date.now()) / 1000);
      setError(`Too many failed attempts. Please wait ${secs}s before trying again.`);
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError) {
        const attempts = failedAttempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          setLockUntil(Date.now() + LOCKOUT_MS);
          setFailedAttempts(0);
          setError(`Too many failed attempts. Please wait ${LOCKOUT_MS / 1000}s before trying again.`);
        } else {
          setFailedAttempts(attempts);
          setError(friendlyAuthError(authError.message));
        }
        setPassword("");
        setLoading(false);
      } else {
        // Force hard redirect so the server layout and proxy read the new cookie
        window.location.href = getSafeRedirect();
      }
    } catch {
      setError("A network error occurred. Please check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your Finetax workspace">
      <form onSubmit={handleLogin} className="space-y-5">
        {notice && (
          <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

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

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Password
            </label>
            <Link href="/forgot-password" className="text-xs font-semibold text-navy hover:underline">
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy p-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-70"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? "Authenticating..." : "Secure Sign In"}
        </button>
      </form>
    </AuthLayout>
  );
}