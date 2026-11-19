"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Lock, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/layout/UserContext";
import { FEATURE_LABEL, FEATURES, hasFeature } from "@/lib/features";
import { btn } from "@/components/ui/kit";

/** Lets an administrator ask Duesk for a feature; the owner is notified. */
export function RequestUpgrade({ feature, compact = false }: { feature: string; compact?: boolean }) {
  const user = useCurrentUser();
  const [supabase] = useState(() => createClient());
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState("");

  if (!user?.isAdmin) return <p className="text-xs text-text-muted">Ask your firm administrator about upgrading.</p>;

  async function send() {
    setState("busy");
    setError("");
    const { error: err } = await supabase.from("upgrade_requests").insert({ feature, message: `Requested from the ${FEATURE_LABEL[feature] || feature} screen.` });
    if (err) {
      setState("idle");
      return setError(err.message);
    }
    setState("sent");
  }

  if (state === "sent")
    return (
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="h-4 w-4" /> Request sent. Duesk will get in touch.
      </p>
    );
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={send} disabled={state === "busy"} className={compact ? btn.secondary : btn.accent}>
        {state === "busy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Request this feature
      </button>
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </span>
  );
}

/** Shows children when the firm's plan includes the feature, otherwise a locked panel. */
export default function FeatureGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const user = useCurrentUser();
  if (hasFeature(user, feature)) return <>{children}</>;
  const info = FEATURES.find((f) => f.key === feature);
  return (
    <div className="animate-page-in mx-auto max-w-xl rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Lock className="h-5 w-5" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-text-main">{info?.label || "This feature"} is not in your plan</h2>
      <p className="mt-1 text-sm text-text-muted">{info?.hint}</p>
      <div className="mt-6 flex flex-col items-center gap-3">
        <RequestUpgrade feature={feature} />
        <Link href="/plan" className="text-xs font-semibold text-text-muted hover:text-text-main">
          Compare plans
        </Link>
      </div>
    </div>
  );
}

/** A small lock badge for a button or option the plan doesn't include. */
export function LockedHint({ feature }: { feature: string }) {
  return (
    <Link href={`/plan?feature=${feature}`} className="inline-flex items-center gap-1 rounded-full bg-surface-alt px-2 py-0.5 text-[10px] font-semibold text-text-muted hover:text-accent">
      <Lock className="h-3 w-3" /> {FEATURE_LABEL[feature] || "Upgrade"}
    </Link>
  );
}
