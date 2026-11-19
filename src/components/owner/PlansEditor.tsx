"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Gift, Inbox, Layers, Loader2, Save, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, Pill, btn, field } from "@/components/ui/kit";
import { FEATURES, FEATURE_LABEL } from "@/lib/features";
import { formatDate } from "@/lib/format";

type Plan = {
  id: string;
  name: string;
  sort: number;
  features: Record<string, boolean>;
  max_users: number | null;
  max_clients: number | null;
  max_storage_mb: number | null;
  audit_days: number | null;
  max_portal_clients: number | null;
};
type Firm = { id: string; name: string; slug: string; plan: string };
type Override = { feature: string; enabled: boolean; expires_at: string | null; note: string | null };
type Request = {
  id: string;
  org_id: string;
  feature: string | null;
  plan_wanted: string | null;
  message: string | null;
  status: string;
  created_at: string;
  organizations: { name: string; plan: string } | null;
  profiles: { name: string | null; email: string | null } | null;
};

const LIMITS: { key: keyof Plan; label: string; unit: string }[] = [
  { key: "max_users", label: "Users", unit: "" },
  { key: "max_clients", label: "Clients", unit: "" },
  { key: "max_storage_mb", label: "Document storage", unit: "MB" },
  { key: "audit_days", label: "Audit history", unit: "days" },
  { key: "max_portal_clients", label: "Portal clients", unit: "" },
];

/** Owner console: what each plan includes, extras for one firm, and requests from firms. */
export default function PlansEditor({ firms }: { firms: Firm[] }) {
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<"plans" | "extras" | "requests">("plans");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [draft, setDraft] = useState<Record<string, Plan>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [firmId, setFirmId] = useState("");
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [extra, setExtra] = useState({ feature: FEATURES[0].key, enabled: true, expiresAt: "", note: "" });
  const [requests, setRequests] = useState<Request[]>([]);

  const loadPlans = useCallback(async () => {
    const { data } = await supabase.from("plans").select("id, name, sort, features, max_users, max_clients, max_storage_mb, audit_days, max_portal_clients").order("sort");
    const list = (data || []) as Plan[];
    setPlans(list);
    setDraft(Object.fromEntries(list.map((p) => [p.id, { ...p, features: { ...p.features } }])));
  }, [supabase]);

  const loadRequests = useCallback(async () => {
    const res = await fetch("/api/owner/upgrade-requests", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    setRequests(json.requests || []);
  }, []);

  useEffect(() => {
    loadPlans();
    loadRequests();
  }, [loadPlans, loadRequests]);

  const loadOverrides = useCallback(async (org: string) => {
    if (!org) return setOverrides([]);
    const res = await fetch(`/api/owner/overrides?org=${org}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    setOverrides(json.overrides || []);
  }, []);

  useEffect(() => {
    loadOverrides(firmId);
  }, [firmId, loadOverrides]);

  const changed = useMemo(() => new Set(plans.filter((p) => JSON.stringify(p) !== JSON.stringify(draft[p.id])).map((p) => p.id)), [plans, draft]);
  const open = requests.filter((r) => r.status === "open");

  function flip(planId: string, key: string) {
    setDraft((d) => ({ ...d, [planId]: { ...d[planId], features: { ...d[planId].features, [key]: !d[planId].features[key] } } }));
  }

  async function savePlan(id: string) {
    setSaving(id);
    const d = draft[id];
    const res = await fetch("/api/owner/plans", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, features: d.features, ...Object.fromEntries(LIMITS.map((l) => [l.key, d[l.key]])) }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(null);
    if (!res.ok) return setNotice({ tone: "bad", text: json.error || "Could not save." });
    setNotice({ tone: "good", text: `${d.name} saved. Firms on it see the change the next time they open a page.` });
    loadPlans();
  }

  async function addExtra(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/owner/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: firmId, ...extra }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setNotice({ tone: "bad", text: json.error || "Could not save." });
    setNotice({ tone: "good", text: "Saved for this firm." });
    loadOverrides(firmId);
  }

  async function removeExtra(feature: string) {
    await fetch("/api/owner/overrides", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId: firmId, feature }) });
    loadOverrides(firmId);
  }

  async function setRequest(id: string, status: string) {
    await fetch("/api/owner/upgrade-requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    loadRequests();
  }

  const firmOptions = firms.filter((f) => f.slug !== "oddlambda");

  return (
    <Card
      title="Plans"
      icon={Layers}
      bodyClassName="p-0"
      action={
        <div className="inline-flex rounded-lg border border-border bg-surface-alt p-0.5 text-[11px] font-semibold">
          {(
            [
              ["plans", "What each plan includes"],
              ["extras", "Extras for one firm"],
              ["requests", `Requests${open.length ? ` (${open.length})` : ""}`],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-md px-2.5 py-1 ${tab === k ? "bg-surface text-text-main shadow-sm" : "text-text-muted"}`}>
              {label}
            </button>
          ))}
        </div>
      }
    >
      {notice && <p className={`mx-4 mt-3 rounded-lg px-3 py-2 text-xs font-medium ${notice.tone === "good" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{notice.text}</p>}

      <div key={tab} className="animate-content-in">
        {tab === "plans" && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="min-w-[220px]">Feature</th>
                  {plans.map((p) => (
                    <th key={p.id} className="text-center">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LIMITS.map((l) => (
                  <tr key={l.key}>
                    <td className="font-medium text-text-main">
                      {l.label} {l.unit && <span className="text-text-muted">({l.unit})</span>}
                    </td>
                    {plans.map((p) => (
                      <td key={p.id} className="text-center">
                        <input
                          aria-label={`${l.label} on ${p.name}`}
                          inputMode="numeric"
                          placeholder="Unlimited"
                          value={draft[p.id]?.[l.key] === null || draft[p.id]?.[l.key] === undefined ? "" : String(draft[p.id][l.key])}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [p.id]: { ...d[p.id], [l.key]: e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")) } }))
                          }
                          className={`${field.input} mx-auto w-28 py-1 text-center text-xs`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                {FEATURES.map((f, i) => (
                  <tr key={f.key}>
                    <td>
                      {(i === 0 || FEATURES[i - 1].group !== f.group) && <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-accent">{f.group}</p>}
                      <p className="font-medium text-text-main">{f.label}</p>
                      <p className="text-[10px] text-text-muted">{f.hint}</p>
                    </td>
                    {plans.map((p) => {
                      const on = !!draft[p.id]?.features?.[f.key];
                      return (
                        <td key={p.id} className="text-center">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={on}
                            aria-label={`${f.label} on ${p.name}`}
                            onClick={() => flip(p.id, f.key)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${on ? "bg-accent" : "bg-border"}`}
                          >
                            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${on ? "translate-x-4" : "translate-x-0.5"}`} />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td />
                  {plans.map((p) => (
                    <td key={p.id} className="text-center">
                      <button type="button" onClick={() => savePlan(p.id)} disabled={!changed.has(p.id) || saving === p.id} className={btn.primary}>
                        {saving === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save {p.name}
                      </button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {tab === "extras" && (
          <div className="space-y-4 p-4 text-xs">
            <select aria-label="Firm" value={firmId} onChange={(e) => setFirmId(e.target.value)} className={`${field.input} max-w-sm`}>
              <option value="">Choose a firm…</option>
              {firmOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.plan})
                </option>
              ))}
            </select>
            {firmId && (
              <>
                <form onSubmit={addExtra} className="grid gap-2 sm:grid-cols-[1.4fr_auto_1fr_1.4fr_auto] sm:items-end">
                  <select aria-label="Feature" value={extra.feature} onChange={(e) => setExtra({ ...extra, feature: e.target.value })} className={field.input}>
                    {FEATURES.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Give or take away" value={extra.enabled ? "on" : "off"} onChange={(e) => setExtra({ ...extra, enabled: e.target.value === "on" })} className={field.input}>
                    <option value="on">Give</option>
                    <option value="off">Take away</option>
                  </select>
                  <input aria-label="Until" type="date" value={extra.expiresAt} onChange={(e) => setExtra({ ...extra, expiresAt: e.target.value })} className={field.input} />
                  <input aria-label="Note" value={extra.note} onChange={(e) => setExtra({ ...extra, note: e.target.value })} placeholder="Note, e.g. paid add-on" className={field.input} />
                  <button type="submit" className={btn.primary}>
                    <Gift className="h-3.5 w-3.5" /> Save
                  </button>
                </form>
                {overrides.length === 0 ? (
                  <p className="text-text-muted">This firm has exactly what its plan includes.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {overrides.map((o) => (
                      <li key={o.feature} className="flex items-center gap-3 px-3 py-2">
                        <Pill tone={o.enabled ? "good" : "bad"}>{o.enabled ? "Given" : "Taken away"}</Pill>
                        <span className="flex-1 font-medium text-text-main">{FEATURE_LABEL[o.feature] || o.feature}</span>
                        <span className="text-text-muted">{o.expires_at ? `until ${formatDate(o.expires_at)}` : "no end date"}</span>
                        {o.note && <span className="text-text-muted">· {o.note}</span>}
                        <button type="button" onClick={() => removeExtra(o.feature)} className="rounded p-1 text-text-muted hover:bg-rose-50 hover:text-rose-600" aria-label="Remove">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-text-muted">To extend a trial or change the plan itself, use the firm&apos;s row in the list above.</p>
              </>
            )}
          </div>
        )}

        {tab === "requests" && (
          <div className="p-4 text-xs">
            {requests.length === 0 ? (
              <p className="flex items-center gap-2 text-text-muted">
                <Inbox className="h-4 w-4" /> No requests yet. Firms ask from any locked feature.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {requests.map((r) => (
                  <li key={r.id} className={`flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center ${r.status === "open" ? "" : "opacity-60"}`}>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-text-main">{r.organizations?.name}</span>
                      <span className="text-text-muted"> ({r.organizations?.plan})</span> wants{" "}
                      <span className="font-semibold text-accent">{r.feature ? FEATURE_LABEL[r.feature] || r.feature : r.plan_wanted}</span>
                      <span className="block text-[11px] text-text-muted">
                        {r.profiles?.name || r.profiles?.email} · {formatDate(r.created_at)}
                        {r.message ? ` · ${r.message}` : ""}
                      </span>
                    </span>
                    {r.status === "open" ? (
                      <span className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setFirmId(r.org_id);
                            if (r.feature) setExtra({ ...extra, feature: r.feature, enabled: true });
                            setTab("extras");
                          }}
                          className={btn.secondary}
                        >
                          <Gift className="h-3.5 w-3.5" /> Give it
                        </button>
                        <button type="button" onClick={() => setRequest(r.id, "done")} className={btn.ghost}>
                          <Check className="h-3.5 w-3.5" /> Done
                        </button>
                        <button type="button" onClick={() => setRequest(r.id, "declined")} className={btn.ghost}>
                          Decline
                        </button>
                      </span>
                    ) : (
                      <Pill tone={r.status === "done" ? "good" : "default"}>{r.status === "done" ? "Done" : "Declined"}</Pill>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
