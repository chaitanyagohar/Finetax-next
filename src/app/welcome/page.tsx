"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Building2, Loader2, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordInput from "@/components/ui/PasswordInput";

const inputClass =
  "w-full rounded-lg border border-border bg-surface py-2.5 pl-10 pr-3 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted";
const iconClass = "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted";

export default function WelcomePage() {
  const [supabase] = useState(() => createClient());
  const [state, setState] = useState<"loading" | "ready" | "nosession">("loading");
  const [email, setEmail] = useState("");
  const [needsFirm, setNeedsFirm] = useState(true);
  const [firmName, setFirmName] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return setState("nosession");
      setEmail(user.email || "");
      const meta = (user.user_metadata || {}) as Record<string, unknown>;
      setFirmName(String(meta.firm_name || ""));
      setName(String(meta.name || ""));
      const { data } = await supabase.rpc("my_signup_state");
      setNeedsFirm(!(data as { has_membership?: boolean } | null)?.has_membership);
      setState("ready");
    })();
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (needsFirm && firmName.trim().length < 2) return setError("Please enter your firm's name.");
    if (needsFirm && name.trim().length < 2) return setError("Please enter your name.");
    if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return setError("Password: 8 to 72 characters with at least one letter and one number.");
    }
    if (password !== confirm) return setError("The two passwords don't match.");

    setSaving(true);
    setError("");
    try {
      const { error: pwErr } = await supabase.auth.updateUser({ password });
      if (pwErr) {
        setError(/weak|pwned|leaked|characters/i.test(pwErr.message) ? "Please choose a stronger password." : "Could not save your password. Please try again.");
        return;
      }

      if (needsFirm) {
        const res = await fetch("/api/auth/complete-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ firmName, name }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(out.error || "Could not create your firm. Please try again.");
          return;
        }
      }

      window.location.href = "/";
    } catch {
      setError("A network error occurred. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (state === "loading") {
    return (
      <AuthLayout title="One moment...">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your account...
        </div>
      </AuthLayout>
    );
  }

  if (state === "nosession") {
    return (
      <AuthLayout title="Link expired" subtitle="Your confirmation link has expired or was already used.">
        <div className="space-y-3 text-sm">
          <Link href="/signup" className="block text-center font-semibold text-navy hover:underline">Sign up again</Link>
          <Link href="/login" className="block text-center font-semibold text-navy hover:underline">Sign in</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={needsFirm ? "Set up your firm" : "Choose your password"}
      subtitle={needsFirm ? `Email confirmed: ${email}. Your 14-day free trial starts now.` : `Email confirmed: ${email}.`}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm font-medium text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {needsFirm && (
          <>
            <div>
              <label htmlFor="firmName" className={labelClass}>Firm name</label>
              <div className="relative">
                <Building2 className={iconClass} />
                <input id="firmName" required maxLength={200} value={firmName} onChange={(e) => setFirmName(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div>
              <label htmlFor="name" className={labelClass}>Your name</label>
              <div className="relative">
                <User className={iconClass} />
                <input id="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
              </div>
            </div>
          </>
        )}

        <div>
          <label htmlFor="password" className={labelClass}>Password</label>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" required />
        </div>
        <div>
          <label htmlFor="confirm" className={labelClass}>Confirm password</label>
          <PasswordInput id="confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" required />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy p-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-70"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? "Setting up..." : needsFirm ? "Create my firm" : "Save password"}
        </button>

        <button type="button" onClick={signOut} className="block w-full text-center text-xs font-semibold text-text-muted hover:underline">
          Not you? Sign out
        </button>
      </form>
    </AuthLayout>
  );
}