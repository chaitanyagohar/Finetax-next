"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AlertCircle, Check, Circle, Loader2 } from "lucide-react";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordInput from "@/components/ui/PasswordInput";
import { validatePassword } from "@/lib/password";

function friendlyUpdateError(message: string, code?: string): string {
  const m = message.toLowerCase();
  if (code === "same_password" || m.includes("different from the old")) {
    return "Your new password must be different from your current one.";
  }
  if (code === "weak_password" || m.includes("weak")) {
    return "That password is too weak. Please choose a stronger one.";
  }
  return "Could not update your password. Please request a new reset link.";
}

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(!!data.user);
      setChecking(false);
    });
  }, []);

  const rules = [
    { label: "At least 8 characters", ok: password.length >= 8 },
    { label: "Contains a letter", ok: /[A-Za-z]/.test(password) },
    { label: "Contains a number", ok: /[0-9]/.test(password) },
    { label: "Both passwords match", ok: password.length > 0 && password === confirm },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    const problem = validatePassword(password);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setLoading(true);
    setError("");

    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(friendlyUpdateError(updateError.message, (updateError as any).code));
      setLoading(false);
      return;
    }

    // Sign out everywhere so any old sessions stop working
    try {
      await supabase.auth.signOut({ scope: "global" });
    } catch {
      // ignore — redirect below clears the browser state anyway
    }
    window.location.href = "/login?reset=success";
  }

  if (checking) {
    return (
      <AuthLayout title="Set a new password">
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
        </div>
      </AuthLayout>
    );
  }

  if (!hasSession) {
    return (
      <AuthLayout title="Link expired" subtitle="This password reset link is invalid or has already been used.">
        <Link
          href="/forgot-password"
          className="flex w-full items-center justify-center rounded-lg bg-navy p-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-light"
        >
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set a new password" subtitle="Choose a strong password you haven't used before.">
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm font-medium text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <PasswordInput
          label="New Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showStrength
          autoFocus
          required
        />

        <PasswordInput
          label="Confirm New Password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          required
        />

        <ul className="space-y-1.5 rounded-lg border border-border bg-surface-alt p-3">
          {rules.map((rule) => (
            <li key={rule.label} className={`flex items-center gap-2 text-xs ${rule.ok ? "text-emerald-700" : "text-text-muted"}`}>
              {rule.ok ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
              {rule.label}
            </li>
          ))}
        </ul>

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy p-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-70"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? "Updating..." : "Update password"}
        </button>
      </form>
    </AuthLayout>
  );
}