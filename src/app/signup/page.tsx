"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Building2, CheckCircle2, Loader2, Mail, Phone, User } from "lucide-react";
import AuthLayout from "@/components/auth/AuthLayout";
import Turnstile from "@/components/auth/Turnstile";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const inputClass =
  "w-full rounded-lg border border-border bg-surface py-2.5 pl-10 pr-3 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted";
const iconClass = "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted";

export default function SignupPage() {
  const [form, setForm] = useState({ firmName: "", name: "", phone: "", email: "" });
  const [token, setToken] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "link_invalid") {
      setError("That link is invalid or has expired. Fill in the form again to get a new one.");
    }
  }, []);

  function update(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    const email = form.email.trim().toLowerCase();
    const phone = form.phone.replace(/[\s-]/g, "").replace(/^(\+91|0)/, "");
    if (form.firmName.trim().length < 2) return setError("Please enter your firm's name.");
    if (form.name.trim().length < 2) return setError("Please enter your name.");
    if (!/^[6-9]\d{9}$/.test(phone)) return setError("Please enter a valid 10-digit mobile number.");
    if (!EMAIL_RE.test(email)) return setError("Please enter a valid email address.");
    if (!token) return setError("Please complete the security check.");

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firmName: form.firmName, name: form.name, phone, email, turnstileToken: token }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(out.error || "Could not sign up. Please try again.");
        setToken("");
        setResetKey((k) => k + 1); // a security-check token can only be used once
        return;
      }
      setSentTo(email);
    } catch {
      setError("A network error occurred. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sentTo) {
    return (
      <AuthLayout title="Check your email">
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold">We've sent a confirmation link to {sentTo}.</p>
              <p className="text-emerald-700">
                Open it to choose your password and start your 14-day free trial. Check your spam folder if you don't see it in a few minutes.
              </p>
              <p className="text-emerald-700">Already have a Duesk account with this email? Sign in instead.</p>
            </div>
          </div>
          <Link href="/login" className="block text-center text-sm font-semibold text-navy hover:underline">
            Go to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your firm" subtitle="Start a 14-day free trial of Duesk. No card needed.">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm font-medium text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label htmlFor="firmName" className={labelClass}>Firm name</label>
          <div className="relative">
            <Building2 className={iconClass} />
            <input id="firmName" required maxLength={200} value={form.firmName} onChange={(e) => update("firmName", e.target.value)} className={inputClass} placeholder="e.g. Sharma & Associates" />
          </div>
        </div>

        <div>
          <label htmlFor="name" className={labelClass}>Your name</label>
          <div className="relative">
            <User className={iconClass} />
            <input id="name" required maxLength={120} autoComplete="name" value={form.name} onChange={(e) => update("name", e.target.value)} className={inputClass} placeholder="CA Rahul Sharma" />
          </div>
        </div>

        <div>
          <label htmlFor="phone" className={labelClass}>Mobile</label>
          <div className="relative">
            <Phone className={iconClass} />
            <input id="phone" required inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} className={inputClass} placeholder="98XXXXXXXX" />
          </div>
        </div>

        <div>
          <label htmlFor="email" className={labelClass}>Official email</label>
          <div className="relative">
            <Mail className={iconClass} />
            <input id="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => update("email", e.target.value)} className={inputClass} placeholder="name@firm.com" />
          </div>
        </div>

        <Turnstile onToken={setToken} resetKey={resetKey} />

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy p-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-70"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? "Sending..." : "Create my firm"}
        </button>

        <p className="text-center text-sm text-text-muted">
          Already using Duesk?{" "}
          <Link href="/login" className="font-semibold text-navy hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}