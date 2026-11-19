"use client";

import { useEffect, useState } from "react";
import { Check, Minus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FEATURES } from "@/lib/features";
import { RequestUpgrade } from "@/components/plan/FeatureGate";

type Plan = { id: string; name: string; features: Record<string, boolean> };
type Mine = { plan: string; features: Record<string, boolean>; limits: { storage_mb: number | null }; storage_used_mb: number };

/** Live feature list for every plan, as the Duesk owner has set it. */
export default function PlanFeatures() {
  const [supabase] = useState(() => createClient());
  const [plans, setPlans] = useState<Plan[]>([]);
  const [mine, setMine] = useState<Mine | null>(null);
  const [focus, setFocus] = useState("");

  useEffect(() => {
    setFocus(new URL(window.location.href).searchParams.get("feature") || "");
    Promise.all([supabase.from("plans").select("id, name, features").order("sort"), supabase.rpc("my_features")]).then(([p, m]) => {
      setPlans((p.data || []) as Plan[]);
      setMine((m.data as Mine) || null);
    });
  }, [supabase]);

  useEffect(() => {
    if (focus && plans.length) document.getElementById(`feature-${focus}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus, plans.length]);

  if (!plans.length || !mine) return <div className="skeleton h-64" />;
  const storageMax = mine.limits?.storage_mb;

  return (
    <div className="space-y-4">
      {storageMax !== null && storageMax !== undefined && (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm shadow-sm">
          <div className="flex items-baseline justify-between">
            <span className="font-medium text-text-main">Document storage</span>
            <span className="text-text-muted">
              {mine.storage_used_mb.toLocaleString("en-IN")} MB of {storageMax.toLocaleString("en-IN")} MB
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-alt">
            <div className="h-2 rounded-full bg-navy" style={{ width: `${Math.min(100, (mine.storage_used_mb / storageMax) * 100)}%` }} />
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="min-w-[240px]">What each plan includes</th>
              {plans.map((p) => (
                <th key={p.id} className="text-center">
                  {p.name}
                </th>
              ))}
              <th className="text-center">Your firm</th>
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f, i) => {
              const have = !!mine.features?.[f.key];
              return (
                <tr key={f.key} id={`feature-${f.key}`} className={focus === f.key ? "bg-accent-soft/60" : ""}>
                  <td>
                    {(i === 0 || FEATURES[i - 1].group !== f.group) && <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-accent">{f.group}</p>}
                    <p className="font-medium text-text-main">{f.label}</p>
                    <p className="text-[11px] text-text-muted">{f.hint}</p>
                    {focus === f.key && !have && (
                      <div className="mt-2">
                        <RequestUpgrade feature={f.key} compact />
                      </div>
                    )}
                  </td>
                  {plans.map((p) => (
                    <td key={p.id} className="text-center">
                      {p.features?.[f.key] ? <Check className="mx-auto h-4 w-4 text-emerald-600" /> : <Minus className="mx-auto h-4 w-4 text-text-muted/50" />}
                    </td>
                  ))}
                  <td className="text-center">
                    {have ? <Check className="mx-auto h-4 w-4 text-emerald-600" /> : <span className="text-[10px] font-semibold text-text-muted">Not included</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
