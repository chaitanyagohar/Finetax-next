"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Edit2, Loader2, MessageCircle, PlayCircle, Printer, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { Modal } from "@/components/ui/Modal";
import { clientLabel } from "@/components/ui/ClientPicker";
import { formatDate, formatINR, localISODate } from "@/lib/format";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";
const CYCLE_MONTHS: Record<string, number> = { Monthly: 1, Quarterly: 3, "Half-Yearly": 6, Yearly: 12 };

/** Same rule as the database: bill on bill_day of the month after the period ends. */
function nextBill(sub: any): { start: string; end: string; bill: string } | null {
  if (!sub.next_period_start) return null;
  const [y, m, d] = String(sub.next_period_start).split("-").map(Number);
  const months = CYCLE_MONTHS[sub.billing_cycle] || 1;
  const end = new Date(y, m - 1 + months, 0);
  const bill = new Date(end.getFullYear(), end.getMonth() + 1, Number(sub.bill_day || 5));
  return { start: localISODate(new Date(y, m - 1, d)), end: localISODate(end), bill: localISODate(bill) };
}
function waNumber(raw?: string | null): string | null {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

export default function SubscriptionBilling({
  packages,
  clients,
  refreshKey,
  showToast,
}: {
  packages: any[];
  clients: any[];
  refreshKey: number;
  showToast: (type: "success" | "error", message: string) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [subs, setSubs] = useState<any[]>([]);
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);

  useEffect(() => {
    load();
  }, [refreshKey]);

  async function load() {
    setLoading(true);
    const [s, b] = await Promise.all([
      supabase.from("client_packages").select("*").eq("status", "Active").order("start_date", { ascending: false }),
      supabase
        .from("invoices")
        .select("id, invoice_number, client_id, total, amount_paid, status, date, due_date, billing_period_start, billing_period_end, email_sent_at, client_package_id")
        .not("client_package_id", "is", null)
        .order("date", { ascending: false })
        .limit(200),
    ]);
    setSubs(s.data || []);
    setBills(b.data || []);
    setLoading(false);
  }

  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
  const pkgById = useMemo(() => Object.fromEntries(packages.map((p) => [p.id, p])), [packages]);
  const drafts = bills.filter((b) => b.status === "Draft");
  const today = localISODate();

  async function runNow() {
    setRunning(true);
    const res = await fetch("/api/billing/run", { method: "POST" });
    const out = await res.json().catch(() => ({}));
    setRunning(false);
    if (!res.ok) return showToast("error", out.error || "Billing run failed.");
    showToast("success", `${out.bills_created} bill(s) created, ${out.drafts} waiting for approval, ${out.reminders_sent} reminder(s) sent.`);
    load();
  }

  async function approve(b: any) {
    setBusyId(b.id);
    const res = await fetch("/api/billing/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId: b.id }) });
    const out = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) return showToast("error", out.error || "Could not send.");
    showToast(out.sent ? "success" : "error", out.message);
    load();
  }

  async function toggle(sub: any, field: "billing_enabled" | "auto_send") {
    setBusyId(sub.id);
    const { error } = await supabase.from("client_packages").update({ [field]: !sub[field] }).eq("id", sub.id);
    setBusyId(null);
    if (error) return showToast("error", error.message);
    logAuditEvent("UPDATE_SUBSCRIPTION_BILLING", "CLIENT_PACKAGES", sub.id, { [field]: !sub[field] });
    load();
  }

  async function saveEdit() {
    if (!editing) return;
    setBusyId(editing.id);
    const payload = {
      price: Number(editing.price),
      gst_rate: Number(editing.gst_rate),
      bill_day: Number(editing.bill_day),
      due_days: Number(editing.due_days),
      late_fee_percent: Number(editing.late_fee_percent),
      late_fee_min: Number(editing.late_fee_min),
      next_period_start: editing.next_period_start,
    };
    const { error } = await supabase.from("client_packages").update(payload).eq("id", editing.id);
    setBusyId(null);
    if (error) return showToast("error", error.message);
    logAuditEvent("UPDATE_SUBSCRIPTION_BILLING", "CLIENT_PACKAGES", editing.id, payload);
    setEditing(null);
    showToast("success", "Billing settings saved.");
    load();
  }

  function whatsappReminder(b: any) {
    const c = clientById[b.client_id];
    const n = waNumber(c?.phone);
    if (!n) return showToast("error", "This client has no valid mobile number.");
    const bal = Math.max(0, Number(b.total || 0) - Number(b.amount_paid || 0));
    const text = `Dear ${c?.name || "Client"},\n\nInvoice ${b.invoice_number} for ${formatDate(b.billing_period_start)} to ${formatDate(b.billing_period_end)}: balance ${formatINR(bal)}, due ${formatDate(b.due_date)}.\nThe PDF has been emailed to you.\n\nPlease ignore if already paid. Thank you!`;
    window.open(`https://wa.me/${n}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface p-8 text-xs text-text-muted shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading billing...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-text-muted">
          Bills are created automatically every morning when a period's bill date arrives.{" "}
          {drafts.length > 0 ? <span className="font-semibold text-amber-700">{drafts.length} bill(s) waiting for your approval.</span> : "Nothing waiting for approval."}
        </p>
        <button type="button" onClick={runNow} disabled={running} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt disabled:opacity-60">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5 text-navy" />} Run billing now
        </button>
      </div>

      {/* Subscriptions */}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-text-main">Subscriptions</div>
        {subs.length === 0 ? (
          <p className="p-6 text-center text-xs text-text-muted">No active subscriptions.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th>Client</th>
                <th>Package</th>
                <th className="text-right">Fee</th>
                <th>Next period</th>
                <th>Next bill</th>
                <th>Billing</th>
                <th>Auto-send</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {subs.map((sub) => {
                const nb = nextBill(sub);
                return (
                  <tr key={sub.id}>
                    <td className="font-medium">{clientLabel(clientById[sub.client_id]) || "—"}</td>
                    <td>{pkgById[sub.package_id]?.name || "—"}</td>
                    <td className="whitespace-nowrap text-right font-semibold">
                      {formatINR(Number(sub.price || 0))} <span className="font-normal text-text-muted">/ {sub.billing_cycle}</span>
                    </td>
                    <td className="whitespace-nowrap">{nb ? `${formatDate(nb.start)} – ${formatDate(nb.end)}` : "—"}</td>
                    <td className={`whitespace-nowrap ${nb && nb.bill <= today && sub.billing_enabled ? "font-semibold text-amber-700" : ""}`}>{nb ? formatDate(nb.bill) : "—"}</td>
                    <td>
                      <button type="button" onClick={() => toggle(sub, "billing_enabled")} disabled={busyId === sub.id} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${sub.billing_enabled ? "bg-emerald-100 text-emerald-700" : "bg-surface-alt text-text-muted"}`}>
                        {sub.billing_enabled ? "On" : "Off"}
                      </button>
                    </td>
                    <td>
                      <button type="button" onClick={() => toggle(sub, "auto_send")} disabled={busyId === sub.id} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${sub.auto_send ? "bg-blue-100 text-blue-700" : "bg-surface-alt text-text-muted"}`}>
                        {sub.auto_send ? "Auto" : "Approve first"}
                      </button>
                    </td>
                    <td className="text-right">
                      <button type="button" onClick={() => setEditing({ ...sub })} className="rounded-md p-1.5 text-navy hover:bg-surface-alt" title="Billing settings">
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Bills */}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-text-main">Subscription bills</div>
        {bills.length === 0 ? (
          <p className="p-6 text-center text-xs text-text-muted">No subscription bills yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Client</th>
                <th>Period</th>
                <th>Due</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const bal = Math.max(0, Number(b.total || 0) - Number(b.amount_paid || 0));
                const overdue = ["Sent", "Partially Paid"].includes(b.status) && b.due_date < today && bal > 0;
                return (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap font-mono font-semibold text-navy">{b.invoice_number}</td>
                    <td>{clientLabel(clientById[b.client_id]) || "—"}</td>
                    <td className="whitespace-nowrap">
                      {formatDate(b.billing_period_start)} – {formatDate(b.billing_period_end)}
                    </td>
                    <td className={`whitespace-nowrap ${overdue ? "font-semibold text-rose-600" : ""}`}>{formatDate(b.due_date)}</td>
                    <td className="whitespace-nowrap text-right font-semibold">{formatINR(Number(b.total || 0))}</td>
                    <td>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${b.status === "Draft" ? "bg-amber-100 text-amber-700" : b.status === "Paid" ? "bg-emerald-100 text-emerald-700" : overdue ? "bg-rose-100 text-rose-700" : "bg-blue-100 text-blue-700"}`}>
                        {overdue ? "Overdue" : b.status}
                      </span>
                      {b.email_sent_at && <p className="mt-0.5 text-[10px] text-emerald-600">Emailed {formatDate(b.email_sent_at)}</p>}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <div className="inline-flex items-center gap-1">
                        <a href={`/invoices/${b.id}/pdf`} target="_blank" rel="noopener noreferrer" className="rounded-md p-1.5 text-navy hover:bg-surface-alt" title="View / print">
                          <Printer className="h-3.5 w-3.5" />
                        </a>
                        {b.status === "Draft" ? (
                          <button type="button" onClick={() => approve(b)} disabled={busyId === b.id} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                            {busyId === b.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Approve & send
                          </button>
                        ) : (
                          bal > 0 && (
                            <>
                              <button type="button" onClick={() => approve(b)} disabled={busyId === b.id} className="rounded-md p-1.5 text-navy hover:bg-surface-alt" title="Email again">
                                {busyId === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                              </button>
                              <button type="button" onClick={() => whatsappReminder(b)} className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50" title="WhatsApp reminder">
                                <MessageCircle className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="border-t border-border px-4 py-2 text-[10px] text-text-muted">To change a draft's line items before sending, open it from Invoices. Payments are recorded in Invoices as usual.</p>
      </div>

      {editing && (
        <Modal
          title="Billing settings"
          subtitle={`${clientLabel(clientById[editing.client_id])} · ${pkgById[editing.package_id]?.name || ""}`}
          onClose={() => setEditing(null)}
          maxWidth="max-w-lg"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Cancel
              </button>
              <button type="button" onClick={saveEdit} disabled={busyId === editing.id} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60">
                {busyId === editing.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-3 text-xs">
            {(
              [
                ["price", "Fee (₹)", 0, undefined],
                ["gst_rate", "GST %", 0, 100],
                ["bill_day", "Bill on day", 1, 28],
                ["due_days", "Due in (days)", 0, 90],
                ["late_fee_percent", "Late fee % / month", 0, 10],
                ["late_fee_min", "Late fee minimum (₹)", 0, undefined],
              ] as [string, string, number, number | undefined][]
            ).map(([k, l, min, max]) => (
              <div key={k}>
                <label className={labelClass}>{l}</label>
                <input type="number" min={min} max={max} step="any" value={editing[k] ?? ""} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} className={inputClass} />
              </div>
            ))}
            <div className="col-span-2">
              <label className={labelClass}>Next period starts</label>
              <input type="date" value={editing.next_period_start || ""} onChange={(e) => setEditing({ ...editing, next_period_start: e.target.value })} className={inputClass} />
              <p className="mt-1 text-[10px] text-text-muted">The next bill covers the period from this date. Change it only to skip or redo a period.</p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}