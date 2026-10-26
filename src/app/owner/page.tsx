"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Building2, CheckCircle2, Loader2, Plus, Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { formatDate } from "@/lib/format";

type Firm = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  created_at: string;
  trial_ends_at: string | null;
  members: number;
  active_members: number;
  admin_emails: string | null;
  clients: number;
  open_tasks: number;
  last_active: string | null;
  open_tickets: number;
};

const STATUS_TONE: Record<string, string> = {
  trial: "bg-violet-50 text-violet-700",
  active: "bg-emerald-50 text-emerald-700",
  suspended: "bg-amber-100 text-amber-800",
  cancelled: "bg-surface-alt text-text-muted",
};

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

const EMPTY_FORM = {
  firmName: "",
  slug: "",
  adminName: "",
  adminEmail: "",
  adminPassword: "",
  status: "trial",
  trialDays: 14,
  copyLists: true,
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export default function OwnerConsolePage() {
  const [firms, setFirms] = useState<Firm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/owner/firms", { cache: "no-store" });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) setError(out.error || "Could not load firms.");
    else setFirms(out.firms || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(
    () => ({
      total: firms.filter((f) => f.slug !== "oddlambda").length,
      active: firms.filter((f) => f.status === "active" && f.slug !== "oddlambda").length,
      trial: firms.filter((f) => f.status === "trial").length,
      suspended: firms.filter((f) => f.status === "suspended").length,
    }),
    [firms]
  );

  const visible = firms.filter((f) =>
    !search ? true : `${f.name} ${f.slug} ${f.admin_emails || ""}`.toLowerCase().includes(search.toLowerCase())
  );

  async function changeFirm(f: Firm, patch: { status?: string; plan?: string }) {
    if (patch.status === "suspended" && !window.confirm(`Suspend ${f.name}? Everyone in this firm will be locked out until you reactivate it.`)) return;
    if (patch.status === "cancelled" && !window.confirm(`Mark ${f.name} as cancelled? Everyone in this firm will be locked out.`)) return;
    setBusyId(f.id);
    setError("");
    const res = await fetch(`/api/owner/firms/${f.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const out = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) return setError(out.error || "Could not update the firm.");
    setNotice(`${f.name} updated.`);
    window.setTimeout(() => setNotice(""), 4000);
    load();
  }

  async function createFirm(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError("");
    const res = await fetch("/api/owner/firms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const out = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setFormError(out.error || "Could not create the firm.");
    setShowNew(false);
    setForm({ ...EMPTY_FORM });
    setSlugTouched(false);
    setNotice(out.message || "Firm created.");
    window.setTimeout(() => setNotice(""), 6000);
    load();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <Building2 className="h-5 w-5 text-navy" /> Owner Console
          </h2>
          <p className="mt-1 text-xs text-text-muted">Every firm on Duesk, with usage counts only. Firm client data is never shown here.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setForm({ ...EMPTY_FORM });
            setSlugTouched(false);
            setFormError("");
            setShowNew(true);
          }}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light sm:w-auto"
        >
          <Plus className="h-4 w-4" /> New firm
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          { label: "Firms", value: stats.total, tone: "text-navy" },
          { label: "Active", value: stats.active, tone: "text-emerald-700" },
          { label: "On trial", value: stats.trial, tone: "text-violet-700" },
          { label: "Suspended", value: stats.suspended, tone: "text-amber-700" },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{k.label}</p>
            <p className={`mt-1.5 text-2xl font-bold tracking-tight ${k.tone}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {notice}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Firms table */}
      <div className="rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex items-center gap-2 border-b border-border p-4">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search firm, short name, admin email"
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs shadow-sm outline-none focus:border-navy"
            />
          </div>
          <span className="ml-auto text-[11px] text-text-muted">{visible.length} shown</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading firms...
          </div>
        ) : visible.length === 0 ? (
          <p className="p-10 text-center text-xs text-text-muted">No firms found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Firm</th>
                  <th>Status</th>
                  <th>Plan</th>
                  <th className="text-right">Users</th>
                  <th className="text-right">Clients</th>
                  <th className="text-right">Open tasks</th>
                  <th className="text-right">Open tickets</th>
                  <th>Last active</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((f) => (
                  <tr key={f.id} className="transition hover:bg-surface-alt">
                    <td>
                      <p className="font-semibold text-navy">{f.name}</p>
                      <p className="text-[10px] text-text-muted">
                        {f.slug}
                        {f.admin_emails ? ` · ${f.admin_emails}` : ""}
                      </p>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={f.status}
                          disabled={busyId === f.id || f.slug === "oddlambda"}
                          onChange={(e) => changeFirm(f, { status: e.target.value })}
                          className={`rounded-full border-0 px-2 py-0.5 text-[10px] font-bold outline-none ${STATUS_TONE[f.status] || ""}`}
                        >
                          <option value="trial">Trial</option>
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                        {busyId === f.id && <Loader2 className="h-3 w-3 animate-spin text-text-muted" />}
                      </div>
                      {f.status === "trial" && f.trial_ends_at && (
                        <p className="mt-0.5 text-[10px] text-text-muted">Trial ends {formatDate(f.trial_ends_at)}</p>
                      )}
                    </td>
                    <td className="text-text-muted">{f.plan}</td>
                    <td className="text-right font-mono">
                      {f.active_members}
                      <span className="text-text-muted">/{f.members}</span>
                    </td>
                    <td className="text-right font-mono">{f.clients}</td>
                    <td className="text-right font-mono">{f.open_tasks}</td>
                    <td className={`text-right font-mono ${f.open_tickets > 0 ? "font-bold text-amber-700" : ""}`}>{f.open_tickets}</td>
                    <td className="whitespace-nowrap text-text-muted">{f.last_active ? formatDate(f.last_active) : "—"}</td>
                    <td className="whitespace-nowrap text-text-muted">{formatDate(f.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New firm */}
      {showNew && (
        <Modal
          title="Create a new firm"
          subtitle="Creates the firm, its settings, #general channel and its first administrator login"
          onClose={() => !saving && setShowNew(false)}
          maxWidth="max-w-lg"
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNew(false)}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="new-firm"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create firm
              </button>
            </div>
          }
        >
          <form id="new-firm" onSubmit={createFirm} className="space-y-4 text-xs">
            {formError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 font-medium text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label className={labelClass}>Firm name *</label>
              <input
                value={form.firmName}
                onChange={(e) => {
                  const firmName = e.target.value;
                  setForm((f) => ({ ...f, firmName, slug: slugTouched ? f.slug : slugify(firmName) }));
                }}
                className={inputClass}
                placeholder="e.g. Sharma & Associates"
                maxLength={200}
              />
            </div>

            <div>
              <label className={labelClass}>Short name *</label>
              <input
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setForm((f) => ({ ...f, slug: slugify(e.target.value) }));
                }}
                className={inputClass}
                placeholder="sharma-associates"
                maxLength={50}
              />
              <p className="mt-1 text-[10px] text-text-muted">Lowercase letters, numbers and hyphens. Must be unique.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Admin name *</label>
                <input value={form.adminName} onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))} className={inputClass} maxLength={120} />
              </div>
              <div>
                <label className={labelClass}>Admin email *</label>
                <input
                  type="email"
                  value={form.adminEmail}
                  onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
                  className={inputClass}
                  maxLength={254}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Admin password *</label>
              <input
                type="text"
                value={form.adminPassword}
                onChange={(e) => setForm((f) => ({ ...f, adminPassword: e.target.value }))}
                className={inputClass}
                placeholder="At least 8 characters, a letter and a number"
                autoComplete="new-password"
              />
              <p className="mt-1 text-[10px] text-text-muted">Share it with the admin securely. They can change it with "Forgot password".</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Start as</label>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className={inputClass}>
                  <option value="trial">Trial</option>
                  <option value="active">Active (paid)</option>
                </select>
              </div>
              {form.status === "trial" && (
                <div>
                  <label className={labelClass}>Trial days</label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={form.trialDays}
                    onChange={(e) => setForm((f) => ({ ...f, trialDays: Number(e.target.value) }))}
                    className={inputClass}
                  />
                </div>
              )}
            </div>

            <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-alt p-3">
              <input
                type="checkbox"
                checked={form.copyLists}
                onChange={(e) => setForm((f) => ({ ...f, copyLists: e.target.checked }))}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold text-text-main">Start with the standard Task List and categories</span>
                <span className="block text-[10px] text-text-muted">
                  Copies the compliance task types (GST, TDS, ITR…) and categories from the template firm. Only the list is copied, never any client data.
                </span>
              </span>
            </label>
          </form>
        </Modal>
      )}
    </div>
  );
}