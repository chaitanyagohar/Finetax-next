import type { Metadata } from "next";
import AuthLayout from "@/components/auth/AuthLayout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Continue", robots: { index: false, follow: false } };

const LABELS: Record<string, { title: string; text: string; button: string }> = {
  invite: { title: "Confirm your email", text: "Click below to confirm your email and set up your account.", button: "Confirm and continue" },
  recovery: { title: "Reset your password", text: "Click below to choose a new password.", button: "Continue" },
  email_change: { title: "Confirm your new email", text: "Click below to confirm your new email address.", button: "Confirm email" },
  email: { title: "Confirm your email", text: "Click below to confirm your email address.", button: "Confirm email" },
};

export default async function ConfirmContinuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";
  const tokenHash = one(sp.token_hash);
  const type = one(sp.type);
  const next = one(sp.next);
  const label = LABELS[type] || LABELS.email;

  return (
    <AuthLayout title={label.title} subtitle={label.text}>
      <form method="post" action="/auth/confirm" className="space-y-4">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        {next && <input type="hidden" name="next" value={next} />}
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy p-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-light"
        >
          {label.button}
        </button>
        <p className="text-center text-xs text-text-muted">
          This extra click stops email security scanners from using your one-time link before you do.
        </p>
      </form>
    </AuthLayout>
  );
}