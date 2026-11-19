"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Card, PageHeader, Pill, btn, field } from "@/components/ui/kit";

type Factor = { id: string; friendly_name?: string; status: string; created_at: string };
type Security = { has_mfa: boolean; session_verified: boolean; firm_requires_for_admins: boolean };

/** Two-step sign-in for the signed-in person, and the firm-wide rule for administrators. */
export default function SecurityPage() {
  const user = useCurrentUser();
  const [supabase] = useState(() => createClient());
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [sec, setSec] = useState<Security | null>(null);
  const [enrol, setEnrol] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [required, setRequired] = useState(false);

  const load = useCallback(async () => {
    const [{ data: f }, { data: s }] = await Promise.all([supabase.auth.mfa.listFactors(), supabase.rpc("my_security")]);
    setFactors(((f?.totp || []) as Factor[]).filter((x) => x.status === "verified"));
    setSec(s as Security);
  }, [supabase]);

  useEffect(() => {
    setRequired(new URLSearchParams(window.location.search).get("required") === "1");
    load();
  }, [load]);

  async function start() {
    setError("");
    setBusy(true);
    // Clear any half-finished set-up from before
    const { data: f } = await supabase.auth.mfa.listFactors();
    for (const x of f?.all || []) if (x.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: x.id });
    const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Duesk ${new Date().toLocaleDateString("en-IN")}` });
    setBusy(false);
    if (err || !data) return setError(err?.message || "Could not start. Try again.");
    setEnrol({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!enrol) return;
    setError("");
    setBusy(true);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrol.id, code: code.replace(/\s/g, "") });
    setBusy(false);
    if (err) return setError("That code didn't match. Check the time on your phone and use the newest code.");
    setEnrol(null);
    setCode("");
    setNotice("Two-step sign-in is on. Next time you sign in, Duesk asks for a code from your app.");
    if (required) window.location.replace("/");
    else load();
  }

  async function remove(f: Factor) {
    setError("");
    setBusy(true);
    const { error: err } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    setBusy(false);
    if (err) return setError(err.message.toLowerCase().includes("aal2") ? "Sign out and sign in again with your code, then remove it." : err.message);
    setNotice("Two-step sign-in removed.");
    load();
  }

  async function setFirmRule(on: boolean) {
    setError("");
    const res = await fetch("/api/admin/firm-options", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ require_mfa_admins: on }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setError(json.error || "Could not save.");
    setNotice(on ? "Administrators now need two-step sign-in." : "Two-step sign-in is now optional for administrators.");
    load();
  }

  const on = (factors?.length || 0) > 0;

  return (
    <div className="space-y-6">
      <PageHeader icon={ShieldCheck} title="Sign-in security" subtitle="Two-step sign-in asks for a code from your phone after your password, so a stolen password alone can't open your firm's data." />

      {required && !on && (
        <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800">
          <AlertCircle className="h-4 w-4" /> Your firm requires two-step sign-in for administrators. Set it up to continue.
        </p>
      )}
      {notice && <p className="rounded-lg bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-700">{notice}</p>}
      {error && <p className="rounded-lg bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-700">{error}</p>}

      <Card title="Two-step sign-in" icon={Smartphone} action={factors && (on ? <Pill tone="good">On</Pill> : <Pill tone="warn">Off</Pill>)}>
        {factors === null ? (
          <div className="skeleton h-16" />
        ) : enrol ? (
          <form onSubmit={confirm} className="grid gap-6 text-xs sm:grid-cols-[12rem_1fr]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrol.qr} alt="QR code to scan with your authenticator app" className="h-48 w-48 rounded-lg border border-border bg-white p-2" />
            <div className="space-y-3">
              <ol className="list-decimal space-y-1 pl-4 text-text-main">
                <li>Open Google Authenticator, Microsoft Authenticator or a similar app on your phone.</li>
                <li>Scan this code. If you can&apos;t scan, type this key: <span className="break-all font-mono font-semibold">{enrol.secret}</span></li>
                <li>Type the 6-digit code the app shows.</li>
              </ol>
              <div>
                <label className={field.label}>Code</label>
                <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, ""))} className={`${field.input} max-w-40 font-mono text-lg tracking-widest`} required />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={busy || code.replace(/\s/g, "").length !== 6} className={btn.primary}>
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Turn on
                </button>
                <button type="button" onClick={() => setEnrol(null)} className={btn.secondary}>
                  Cancel
                </button>
              </div>
            </div>
          </form>
        ) : on ? (
          <ul className="divide-y divide-border text-xs">
            {factors.map((f) => (
              <li key={f.id} className="flex items-center justify-between py-2">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" /> {f.friendly_name || "Authenticator app"}
                  <span className="text-text-muted">· added {new Date(f.created_at).toLocaleDateString("en-IN")}</span>
                </span>
                <button type="button" disabled={busy || (sec?.firm_requires_for_admins && !!user?.isAdmin)} onClick={() => remove(f)} className={btn.ghost}>
                  <ShieldOff className="h-3.5 w-3.5" /> Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-start gap-3 text-xs sm:flex-row sm:items-center sm:justify-between">
            <p className="text-text-muted">Takes a minute. You need an authenticator app on your phone; it works without internet.</p>
            <button type="button" onClick={start} disabled={busy} className={btn.primary}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Set up two-step sign-in
            </button>
          </div>
        )}
      </Card>

      {user?.isAdmin && !user.isPlatformHome && sec && (
        <Card title="For your firm">
          <label className="flex items-start gap-3 text-xs">
            <input type="checkbox" checked={sec.firm_requires_for_admins} disabled={!on || !sec.session_verified} onChange={(e) => setFirmRule(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
            <span>
              <span className="block font-semibold text-text-main">Require two-step sign-in for administrators</span>
              <span className="text-text-muted">
                Each administrator is asked to set it up the next time they open Duesk, before anything else.
                {!on && " Turn it on for yourself first."}
              </span>
            </span>
          </label>
        </Card>
      )}
    </div>
  );
}
