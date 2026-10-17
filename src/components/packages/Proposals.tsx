"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, FileSignature, Loader2, Mail, MessageCircle, Plus, Send, Trash2, X, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import ClientPicker, { clientLabel } from "@/components/ui/ClientPicker";
import { formatDate, formatINR, localISODate } from "@/lib/format";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";
const CYCLES = ["Monthly", "Quarterly", "Half-Yearly", "Yearly"];
const STATUS_STYLES: Record<string, string> = {
  Draft: "border-slate-200 bg-slate-100 text-slate-700",
  Sent: "border-blue-200 bg-blue-50 text-blue-700",
  Viewed: "border-violet-200 bg-violet-50 text-violet-700",
  Accepted: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Declined: "border-rose-200 bg-rose-50 text-rose-700",
  Withdrawn: "border-border bg-surface-alt text-text-muted",
  Expired: "border-amber-200 bg-amber-50 text-amber-700",
};

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localISODate(new Date(y, m - 1, d + n));
}
function waNumber(raw?: string | null): string | null {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/* =========================================================
   COMPOSER
   ========================================================= */

export function ProposalComposer({
  packages,
  clients,
  team,
  initialPackageId,
  onClose,
  onSaved,
}: {
  packages: any[];
  clients: any[];
  team: any[];
  initialPackageId?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [supabase] = useState(() => createClient());
  const today = localISODate();
  const active = packages.filter((p) => p.is_active !== false);
  const [packageId, setPackageId] = useState(initialPackageId || active[0]?.id || "");
  const pkg = packages.find((p) => p.id === packageId);
  const [clientId, setClientId] = useState("");
  const client = clients.find((c) => c.id === clientId);

  const [f, setF] = useState<any>({});
  const [saving, setSaving] = useState<null | "draft" | "send">(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!pkg) return;
    setF((prev: any) => ({
      start_date: prev.start_date || addDays(today, 1).slice(0, 8) + "01" > today ? today : today,
      price: pkg.price ?? 0,
      billing_cycle: pkg.billing_cycle || "Monthly",
      gst_rate: pkg.gst_rate ?? 18,
      bill_day: pkg.bill_day ?? 5,
      due_days: pkg.due_days ?? 5,
      late_fee_percent: pkg.late_fee_percent ?? 1.5,
      late_fee_min: pkg.late_fee_min ?? 100,
      prorate_first: pkg.prorate_first ?? true,
      auto_send: false,
      reviewer_id: "",
      scope_of_work: pkg.scope_of_work || "",
      exclusions: pkg.exclusions || "",
      client_responsibilities: pkg.client_responsibilities || "",
      special_terms: pkg.special_terms || "",
      valid_days: 15,
      cover_message: "",
      recipient_email: prev.recipient_email || "",
    }));
  }, [packageId]);

  useEffect(() => {
    if (client?.email) setF((prev: any) => ({ ...prev, recipient_email: client.email }));
  }, [clientId]);

  const set = (k: string, v: any) => setF((prev: any) => ({ ...prev, [k]: v }));
  const reviewers = team.filter((t) => t.is_active !== false && (t.role === "admin" || t.role === "reviewer" || t.is_reviewer));

  async function save(sendNow: boolean) {
    setError("");
    if (!pkg) return setError("Choose a package.");
    if (!clientId) return setError("Choose the client.");
    if (!f.start_date) return setError("Choose the start date.");
    if (!(Number(f.price) >= 0)) return setError("Enter a valid fee.");
    if (sendNow && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(f.recipient_email || ""))) return setError("Enter the client's email to send it.");

    setSaving(sendNow ? "send" : "draft");
    const { data, error: err } = await supabase
      .from("proposals")
      .insert([
        {
          client_id: clientId,
          package_id: packageId,
          start_date: f.start_date,
          price: Number(f.price),
          billing_cycle: f.billing_cycle,
          gst_rate: Number(f.gst_rate),
          bill_day: Number(f.bill_day),
          due_days: Number(f.due_days),
          late_fee_percent: Number(f.late_fee_percent),
          late_fee_min: Number(f.late_fee_min),
          prorate_first: !!f.prorate_first,
          auto_send: !!f.auto_send,
          reviewer_id: f.reviewer_id || null,
          scope_of_work: f.scope_of_work || null,
          exclusions: f.exclusions || null,
          client_responsibilities: f.client_responsibilities || null,
          special_terms: f.special_terms || null,
          recipient_email: f.recipient_email || null,
          cover_message: f.cover_message || null,
          expires_at: addDays(today, Number(f.valid_days || 15)),
        },
      ])
      .select("id, number")
      .single();
    if (err || !data) {
      setSaving(null);
      return setError(err?.message || "Could not create the proposal.");
    }
    logAuditEvent("CREATE_PROPOSAL", "PROPOSALS", data.id, { number: data.number, client: clientLabel(client), package: pkg.name });

    if (!sendNow) {
      setSaving(null);
      return onSaved(`Engagement letter ${data.number} saved as a draft.`);
    }
    const res = await fetch("/api/proposals/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: data.id, to: f.recipient_email, message: f.cover_message }),
    });
    const out = await res.json().catch(() => ({}));
    setSaving(null);
    if (!res.ok) return onSaved(`Saved ${data.number} as a draft, but sending failed: ${out.error || "unknown error"}`);
    onSaved(out.message || `Engagement letter ${data.number} sent.`);
  }

  return (
    <Modal
      title="New proposal / engagement letter"
      subtitle="Terms are copied from the package. Adjust anything for this client."
      onClose={() => !saving && onClose()}
      maxWidth="max-w-4xl"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={!!saving} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
            Cancel
          </button>
          <button type="button" onClick={() => save(false)} disabled={!!saving} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-navy transition hover:bg-surface-alt disabled:opacity-60">
            {saving === "draft" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save draft
          </button>
          <button type="button" onClick={() => save(true)} disabled={!!saving} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60">
            {saving === "send" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Save & email
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-2.5 font-medium text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Package *</label>
            <select value={packageId} onChange={(e) => setPackageId(e.target.value)} className={inputClass}>
              {active.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Client *</label>
            <ClientPicker clients={clients as any} value={clientId} onChange={setClientId} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className={labelClass}>Start date *</label>
            <input type="date" value={f.start_date || ""} onChange={(e) => set("start_date", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Fee (₹) *</label>
            <input type="number" min={0} value={f.price ?? ""} onChange={(e) => set("price", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Billing cycle</label>
            <select value={f.billing_cycle || "Monthly"} onChange={(e) => set("billing_cycle", e.target.value)} className={inputClass}>
              {CYCLES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>GST %</label>
            <input type="number" min={0} max={100} value={f.gst_rate ?? 18} onChange={(e) => set("gst_rate", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Bill on day</label>
            <input type="number" min={1} max={28} value={f.bill_day ?? 5} onChange={(e) => set("bill_day", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Due in (days)</label>
            <input type="number" min={0} max={90} value={f.due_days ?? 5} onChange={(e) => set("due_days", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Late fee % / month</label>
            <input type="number" min={0} max={10} step={0.25} value={f.late_fee_percent ?? 1.5} onChange={(e) => set("late_fee_percent", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Late fee minimum (₹)</label>
            <input type="number" min={0} value={f.late_fee_min ?? 100} onChange={(e) => set("late_fee_min", e.target.value)} className={inputClass} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-2.5">
            <input type="checkbox" checked={!!f.prorate_first} onChange={(e) => set("prorate_first", e.target.checked)} className="h-4 w-4 accent-navy" />
            Pro-rate the first period
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border p-2.5">
            <input type="checkbox" checked={!!f.auto_send} onChange={(e) => set("auto_send", e.target.checked)} className="h-4 w-4 accent-navy" />
            Send monthly bills automatically
          </label>
          <div>
            <select value={f.reviewer_id || ""} onChange={(e) => set("reviewer_id", e.target.value)} className={inputClass}>
              <option value="">Task reviewer: none</option>
              {reviewers.map((r) => (
                <option key={r.id} value={r.id}>Reviewer: {r.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              ["scope_of_work", "Scope of work (details)"],
              ["exclusions", "Exclusions"],
              ["client_responsibilities", "Client responsibilities"],
              ["special_terms", "Special terms for this client"],
            ] as [string, string][]
          ).map(([k, l]) => (
            <div key={k}>
              <label className={labelClass}>{l}</label>
              <textarea rows={3} value={f[k] || ""} onChange={(e) => set(k, e.target.value)} className={inputClass} />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Send to</label>
            <input type="email" value={f.recipient_email || ""} onChange={(e) => set("recipient_email", e.target.value)} className={inputClass} placeholder="client@example.com" />
          </div>
          <div>
            <label className={labelClass}>Valid for</label>
            <select value={f.valid_days ?? 15} onChange={(e) => set("valid_days", Number(e.target.value))} className={inputClass}>
              {[7, 15, 30, 45].map((d) => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Message (optional)</label>
            <input value={f.cover_message || ""} onChange={(e) => set("cover_message", e.target.value)} className={inputClass} placeholder="Personal note in the email" maxLength={600} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* =========================================================
   LIST + ACTIONS
   ========================================================= */

export default function ProposalsPanel({
  packages,
  clients,
  refreshKey,
  onNew,
  onChanged,
  showToast,
}: {
  packages: any[];
  clients: any[];
  refreshKey: number;
  onNew: () => void;
  onChanged: () => void;
  showToast: (type: "success" | "error", message: string) => void;
}) {
  const [supabase] = useState(() => createClient());
  const today = localISODate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("Open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [acceptFor, setAcceptFor] = useState<any | null>(null);
  const [accName, setAccName] = useState("");
  const [accDesig, setAccDesig] = useState("");
  const [accNote, setAccNote] = useState("");
  const [accError, setAccError] = useState("");
  const [confirm, setConfirm] = useState<null | { kind: "decline" | "withdraw" | "delete"; p: any }>(null);

  useEffect(() => {
    load();
  }, [refreshKey]);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("proposals").select("*").order("created_at", { ascending: false }).limit(300);
    setRows(data || []);
    setLoading(false);
  }

  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
  const pkgById = useMemo(() => Object.fromEntries(packages.map((p) => [p.id, p])), [packages]);
  const statusOf = (p: any) => (["Draft", "Sent", "Viewed"].includes(p.status) && p.expires_at && p.expires_at < today ? "Expired" : p.status);

  const tabs: Record<string, (p: any) => boolean> = {
    Open: (p) => ["Draft", "Sent", "Viewed"].includes(statusOf(p)),
    Accepted: (p) => p.status === "Accepted",
    Closed: (p) => ["Declined", "Withdrawn", "Expired"].includes(statusOf(p)),
    All: () => true,
  };
  const visible = rows.filter(tabs[tab]);

  async function send(p: any) {
    setBusyId(p.id);
    const res = await fetch("/api/proposals/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposalId: p.id }) });
    const out = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) return showToast("error", out.error || "Could not send.");
    showToast("success", out.message);
    load();
  }

  async function whatsapp(p: any) {
    const c = clientById[p.client_id];
    const n = waNumber(c?.phone);
    if (!n) return showToast("error", "This client has no valid mobile number.");
    const win = window.open("", "_blank");
    setBusyId(p.id);
    const res = await fetch("/api/proposals/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposalId: p.id }) });
    const out = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok || !out.url) {
      win?.close();
      return showToast("error", out.error || "Could not create the link.");
    }
    const pkg = pkgById[p.package_id];
    const text =
      `Dear ${c?.name || "Client"},\n\nThank you for considering us. Our engagement letter ${p.number} for *${pkg?.name || "professional services"}* ` +
      `is ${formatINR(Number(p.price))} per ${String(p.billing_cycle).toLowerCase().replace("ly", "")} + GST, starting ${formatDate(p.start_date)}.\n\n` +
      `Please review and accept it here:\n${out.url}\n\nRegards`;
    const wa = `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
    if (win) win.location.href = wa;
    else window.open(wa, "_blank", "noopener,noreferrer");
    load();
  }

  async function recordAcceptance() {
    if (!acceptFor) return;
    setAccError("");
    setBusyId(acceptFor.id);
    const { data, error } = await supabase.rpc("record_proposal_acceptance", { p_id: acceptFor.id, p_name: accName, p_designation: accDesig || null, p_note: accNote || null });
    setBusyId(null);
    if (error) return setAccError(error.message);
    const r = data as any;
    logAuditEvent("ACCEPT_PROPOSAL", "PROPOSALS", acceptFor.id, { number: acceptFor.number, accepted_by: accName, tasks: r?.tasks_created });
    showToast("success", `Accepted. Client onboarded with ${r?.tasks_created ?? 0} tasks${r?.unassigned ? ` (${r.unassigned} unassigned)` : ""}. Monthly billing is on.`);
    setAcceptFor(null);
    load();
    onChanged();
  }

  async function runConfirm() {
    if (!confirm) return;
    const { kind, p } = confirm;
    setBusyId(p.id);
    const { error } =
      kind === "delete" ? await supabase.from("proposals").delete().eq("id", p.id) : await supabase.from("proposals").update({ status: kind === "decline" ? "Declined" : "Withdrawn" }).eq("id", p.id);
    setBusyId(null);
    setConfirm(null);
    if (error) return showToast("error", error.message);
    logAuditEvent(kind === "delete" ? "DELETE_PROPOSAL" : kind === "decline" ? "DECLINE_PROPOSAL" : "WITHDRAW_PROPOSAL", "PROPOSALS", p.id, { number: p.number });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-lg border border-border bg-surface-alt p-0.5 text-xs font-semibold">
          {Object.keys(tabs).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 transition ${tab === t ? "bg-surface text-navy shadow-sm" : "text-text-muted"}`}>
              {t} <span className="text-[10px] font-medium text-text-muted">{rows.filter(tabs[t]).length}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={onNew} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white transition hover:bg-navy-light">
          <Plus className="h-4 w-4" /> New proposal
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading proposals...
          </div>
        ) : visible.length === 0 ? (
          <p className="p-8 text-center text-xs text-text-muted">No proposals here yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th>Number</th>
                <th>Client</th>
                <th>Package</th>
                <th className="text-right">Fee</th>
                <th>Start</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const st = statusOf(p);
                const open = ["Draft", "Sent", "Viewed", "Expired"].includes(st);
                return (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap font-mono font-semibold text-navy">{p.number}</td>
                    <td>{clientLabel(clientById[p.client_id]) || "—"}</td>
                    <td>{pkgById[p.package_id]?.name || "—"}</td>
                    <td className="whitespace-nowrap text-right font-semibold">
                      {formatINR(Number(p.price))} <span className="font-normal text-text-muted">/ {p.billing_cycle}</span>
                    </td>
                    <td className="whitespace-nowrap">{formatDate(p.start_date)}</td>
                    <td>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[st] || STATUS_STYLES.Draft}`}>{st}</span>
                      <p className="mt-0.5 text-[10px] text-text-muted">
                        {p.status === "Accepted"
                          ? `by ${p.accepted_name} · ${formatDate(p.accepted_at)}`
                          : p.sent_at
                          ? `Sent ${formatDate(p.sent_at)}`
                          : p.expires_at
                          ? `Valid till ${formatDate(p.expires_at)}`
                          : ""}
                      </p>
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <div className="inline-flex items-center gap-1">
                        {busyId === p.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />}
                        <a href={`/proposals/${p.id}/pdf`} target="_blank" rel="noopener noreferrer" className="rounded-md p-1.5 text-navy hover:bg-surface-alt" title="View / print letter">
                          <Eye className="h-3.5 w-3.5" />
                        </a>
                        {open && (
                          <>
                            <button type="button" onClick={() => send(p)} className="rounded-md p-1.5 text-navy hover:bg-surface-alt" title={p.sent_at ? "Resend email" : "Email letter"}>
                              <Mail className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={() => whatsapp(p)} className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50" title="Send on WhatsApp">
                              <MessageCircle className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAcceptFor(p);
                                setAccName(clientById[p.client_id]?.name || "");
                                setAccDesig("");
                                setAccNote("");
                                setAccError("");
                              }}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-700"
                              title="Record client acceptance and onboard"
                            >
                              <CheckCircle2 className="h-3 w-3" /> Accepted
                            </button>
                            <button type="button" onClick={() => setConfirm({ kind: p.status === "Draft" ? "delete" : "withdraw", p })} className="rounded-md p-1.5 text-text-muted hover:bg-surface-alt" title={p.status === "Draft" ? "Delete draft" : "Withdraw"}>
                              {p.status === "Draft" ? <Trash2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                            </button>
                            {p.status !== "Draft" && (
                              <button type="button" onClick={() => setConfirm({ kind: "decline", p })} className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50" title="Client declined">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {acceptFor && (
        <Modal
          title={`Record acceptance · ${acceptFor.number}`}
          subtitle="The client is onboarded immediately: subscription, package tasks and monthly billing."
          onClose={() => busyId !== acceptFor.id && setAcceptFor(null)}
          maxWidth="max-w-md"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAcceptFor(null)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Cancel
              </button>
              <button type="button" onClick={recordAcceptance} disabled={busyId === acceptFor.id} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60">
                {busyId === acceptFor.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSignature className="h-3.5 w-3.5" />} Confirm & onboard
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-xs">
            {accError && <p className="font-medium text-rose-600">{accError}</p>}
            <div>
              <label className={labelClass}>Accepted by (name) *</label>
              <input value={accName} onChange={(e) => setAccName(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Designation</label>
              <input value={accDesig} onChange={(e) => setAccDesig(e.target.value)} className={inputClass} placeholder="Director / Proprietor" />
            </div>
            <div>
              <label className={labelClass}>Note</label>
              <input value={accNote} onChange={(e) => setAccNote(e.target.value)} className={inputClass} placeholder="e.g. Signed copy received by email on 18/10" />
            </div>
            <p className="text-[11px] text-text-muted">Upload the signed copy to Documents for the client's records.</p>
          </div>
        </Modal>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "delete" ? "Delete this draft?" : confirm.kind === "decline" ? "Mark as declined by the client?" : "Withdraw this proposal?"}
          message={`${confirm.p.number} · ${clientLabel(clientById[confirm.p.client_id])}`}
          confirmLabel={confirm.kind === "delete" ? "Delete" : confirm.kind === "decline" ? "Mark declined" : "Withdraw"}
          tone="danger"
          loading={busyId === confirm.p.id}
          onConfirm={runConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}