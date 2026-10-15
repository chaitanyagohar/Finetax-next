"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Trash2,
  X,
  Send,
  Printer,
  Receipt,
  Mail,
  Loader2,
  CheckCircle2,
  AlertCircle,
  IndianRupee,
  Wallet,
  Ban,
  CalendarClock,
  MessageCircle,
  Lock,
  TrendingUp,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Client } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { compactINR, formatDate, formatINR, localISODate } from "@/lib/format";

interface LineItem {
  description: string;
  qty: number;
  rate: number;
}

type ClientRow = Client & Record<string, any>;

const STATUS_TABS = ["All", "Draft", "Sent", "Partially Paid", "Paid", "Overdue", "Cancelled"];
const PAYMENT_MODES = ["UPI", "Bank Transfer (NEFT/RTGS/IMPS)", "Cheque", "Cash", "Card", "Other"];

const STATUS_STYLES: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-700 border-slate-200",
  Sent: "bg-blue-50 text-blue-700 border-blue-200",
  "Partially Paid": "bg-amber-50 text-amber-700 border-amber-200",
  Paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Cancelled: "bg-rose-50 text-rose-700 border-rose-200",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15 disabled:bg-surface-alt disabled:text-text-muted";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

/* ---------------- Helpers ---------------- */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localISODate(new Date(y, m - 1, d + days));
}
function isoDate(value: unknown): string {
  const v = String(value || "");
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "";
}
function normalizeItems(raw: unknown): LineItem[] {
  if (!Array.isArray(raw) || raw.length === 0) return [{ description: "", qty: 1, rate: 0 }];
  return raw.map((it: any) => ({
    description: String(it?.description ?? it?.desc ?? ""),
    qty: Number(it?.qty ?? 1) || 1,
    rate: Number(it?.rate ?? it?.price ?? 0) || 0,
  }));
}
function statusOf(inv: any): string {
  const s = inv?.status || "Draft";
  return s === "Unpaid" ? "Sent" : s;
}
function paidOf(inv: any): number {
  return Number(inv?.amount_paid ?? inv?.amountPaid ?? 0) || 0;
}
function balanceOf(inv: any): number {
  if (statusOf(inv) === "Cancelled") return 0;
  return Math.max(0, round2(Number(inv?.total || 0) - paidOf(inv)));
}
function dueOf(inv: any): string {
  return isoDate(inv?.due_date || inv?.dueDate);
}
function issueOf(inv: any): string {
  return isoDate(inv?.date || inv?.issue_date || inv?.created_at);
}
/** Days from payment terms text, e.g. "Net 15" → 15, "Due on Receipt" → 0 */
function termDays(terms?: string): number {
  const match = String(terms || "").match(/(\d+)/);
  return match ? Math.min(365, parseInt(match[1], 10)) : 0;
}
function toWhatsAppNumber(raw: string): string | null {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = "91" + digits;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}
function fyStart(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/* ---------------- Page ---------------- */

export default function InvoicesPage() {
  const currentUser = useCurrentUser();
  const isAdmin = !!currentUser?.isAdmin;
  const [supabase] = useState(() => createClient());

  const [invoices, setInvoices] = useState<any[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [firmSettings, setFirmSettings] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState("All");
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "email" | "cancel" | "markSent" | "deletePayment"; invoice?: any; payment?: any }>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Editor
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [selectedClientId, setSelectedClientId] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(localISODate());
  const [dueDate, setDueDate] = useState("");
  const [isInterState, setIsInterState] = useState(false);
  const [gstAutoNote, setGstAutoNote] = useState("");
  const [gstRate, setGstRate] = useState<number>(18);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([{ description: "", qty: 1, rate: 0 }]);

  // Payments
  const [payments, setPayments] = useState<any[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(localISODate());
  const [payMode, setPayMode] = useState(PAYMENT_MODES[0]);
  const [payRef, setPayRef] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState("");

  const today = localISODate();

  useEffect(() => {
    loadData();
  }, []);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4500);
  }

  async function loadData(showSpinner = true) {
    if (showSpinner) setLoading(true);

    const [settingsRes, invRes, clientRes, teamRes] = await Promise.all([
      supabase
        .from("firm_settings")
        .select("firm_name, gstin, default_gst_rate, payment_terms, bank_name, bank_account_no, bank_ifsc, upi_id")
        .eq("id", 1)
        .maybeSingle(),
      supabase
        .from("invoices")
        .select("*, clients!client_id(name, email, phone, organization_name, gstin)")
        .order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name, email, phone, organization_name, gstin, status").order("name", { ascending: true }),
      supabase.from("profiles").select("id, name"),
    ]);

    if (settingsRes.data) setFirmSettings(settingsRes.data);
    if (invRes.error) {
      console.error("Fetch Invoices Error:", invRes.error);
      showToast("error", "Could not load invoices. Please refresh the page.");
    } else if (invRes.data) {
      setInvoices(invRes.data);
    }
    if (clientRes.data) setClients(clientRes.data as ClientRow[]);
    if (teamRes.data) setTeamNames(Object.fromEntries(teamRes.data.map((p: any) => [p.id, p.name])));

    setLoading(false);
  }

  async function loadPayments(invoiceId: string) {
    setLoadingPayments(true);
    const { data } = await supabase
      .from("invoice_payments")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("paid_on", { ascending: false });
    setPayments(data || []);
    setLoadingPayments(false);
  }

  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [String(c.id), c])), [clients]);
  const uniqueOrganizations = useMemo(
    () => Array.from(new Set(clients.map((c) => c.organization_name).filter(Boolean))),
    [clients]
  );

  const clientNameOf = (inv: any) => inv.clients?.name || clientById[inv.client_id]?.name || "—";
  const clientEmailOf = (inv: any) => inv.clients?.email || clientById[inv.client_id]?.email || "";
  const clientPhoneOf = (inv: any) => inv.clients?.phone || clientById[inv.client_id]?.phone || "";
  const isOverdue = (inv: any) => {
    const due = dueOf(inv);
    return ["Sent", "Partially Paid"].includes(statusOf(inv)) && !!due && due < today && balanceOf(inv) > 0;
  };

  /* ---------------- Analytics ---------------- */

  const stats = useMemo(() => {
    const fy = fyStart(today);
    const issued = invoices.filter((i) => !["Draft", "Cancelled"].includes(statusOf(i)));
    const fyIssued = issued.filter((i) => issueOf(i) >= fy);
    const overdue = invoices.filter(isOverdue);
    const outstanding = issued.filter((i) => balanceOf(i) > 0);
    const tabCounts: Record<string, number> = { All: invoices.length, Overdue: overdue.length };
    ["Draft", "Sent", "Partially Paid", "Paid", "Cancelled"].forEach((s) => {
      tabCounts[s] = invoices.filter((i) => statusOf(i) === s).length;
    });
    const billed = fyIssued.reduce((s, i) => s + Number(i.total || 0), 0);
    const collected = fyIssued.reduce((s, i) => s + paidOf(i), 0);
    return {
      billed,
      billedCount: fyIssued.length,
      collected,
      collectionRate: billed > 0 ? Math.round((collected / billed) * 100) : 0,
      outstanding: outstanding.reduce((s, i) => s + balanceOf(i), 0),
      outstandingCount: outstanding.length,
      overdueAmount: overdue.reduce((s, i) => s + balanceOf(i), 0),
      overdueCount: overdue.length,
      tabCounts,
    };
  }, [invoices, today]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((i) => {
      if (statusTab === "Overdue" && !isOverdue(i)) return false;
      if (!["All", "Overdue"].includes(statusTab) && statusOf(i) !== statusTab) return false;
      if (!q) return true;
      return [i.invoice_number, clientNameOf(i), i.organisation].filter(Boolean).some((f) => String(f).toLowerCase().includes(q));
    });
  }, [invoices, search, statusTab, clientById, today]);

  /* ---------------- Editor ---------------- */

  const isLocked = !!editingInvoice && statusOf(editingInvoice) !== "Draft";

  // Real-time preview (the database recalculates identically on save)
  const subtotal = round2(items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.rate) || 0), 0));
  const cgst = isInterState ? 0 : round2((subtotal * gstRate) / 200);
  const sgst = cgst;
  const igst = isInterState ? round2((subtotal * gstRate) / 100) : 0;
  const grandTotal = round2(subtotal + cgst + sgst + igst);

  function defaultNotes(): string {
    return `Payment Terms: ${firmSettings?.payment_terms || "Due on Receipt"}\n\nBank Details:\nBank: ${firmSettings?.bank_name || "N/A"}\nA/C: ${firmSettings?.bank_account_no || "N/A"}\nIFSC: ${firmSettings?.bank_ifsc || "N/A"}\nUPI: ${firmSettings?.upi_id || "N/A"}`;
  }

  function detectInterState(clientGstin?: string) {
    const firm = String(firmSettings?.gstin || "").trim();
    const client = String(clientGstin || "").trim();
    if (firm.length >= 2 && client.length >= 2) {
      const inter = firm.slice(0, 2) !== client.slice(0, 2);
      setIsInterState(inter);
      setGstAutoNote(inter ? "Auto-set to IGST: client is in a different state." : "Auto-set to CGST + SGST: client is in your state.");
    } else {
      setGstAutoNote("");
    }
  }

  function openModal(inv?: any) {
    setFormError("");
    setGstAutoNote("");
    if (inv) {
      setEditingInvoice(inv);
      setSelectedClientId(inv.client_id || "");
      setOrganisation(inv.organisation || inv.clients?.organization_name || "");
      setInvoiceDate(issueOf(inv) || today);
      setDueDate(dueOf(inv));
      setIsInterState(Boolean(inv.is_inter_state ?? inv.isInterState));
      setGstRate(Number(inv.gst_rate ?? inv.gstRate ?? 18));
      setNotes(inv.notes || "");
      setItems(normalizeItems(inv.items));
      loadPayments(inv.id);
    } else {
      setEditingInvoice(null);
      setPayments([]);
      setSelectedClientId("");
      setOrganisation("");
      setInvoiceDate(today);
      setDueDate(addDays(today, termDays(firmSettings?.payment_terms)));
      setIsInterState(false);
      setGstRate(Number(firmSettings?.default_gst_rate ?? 18));
      setNotes(defaultNotes());
      setItems([{ description: "", qty: 1, rate: 0 }]);
    }
    setIsModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setIsModalOpen(false);
    setEditingInvoice(null);
    setPayments([]);
  }

  function handleClientChange(id: string) {
    setSelectedClientId(id);
    const c = clientById[id];
    setOrganisation(c?.organization_name || "");
    detectInterState(c?.gstin);
  }

  function handleAddItem() {
    setItems([...items, { description: "", qty: 1, rate: 0 }]);
  }

  function handleRemoveItem(index: number) {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  }

  function handleItemChange(index: number, field: keyof LineItem, value: any) {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setFormError("");

    if (dueDate && dueDate < invoiceDate) return setFormError("The due date cannot be before the invoice date.");

    setSaving(true);
    try {
      // Issued invoices: only due date and notes can change
      if (isLocked && editingInvoice) {
        const { error } = await supabase
          .from("invoices")
          .update({ due_date: dueDate || null, notes: notes.trim() })
          .eq("id", editingInvoice.id);
        if (error) throw error;
        logAuditEvent("UPDATE_INVOICE", "INVOICES", editingInvoice.id, { fields: "due_date, notes" });
        showToast("success", `Invoice ${editingInvoice.invoice_number} updated.`);
        setIsModalOpen(false);
        loadData(false);
        return;
      }

      if (!selectedClientId) throw new Error("Please select a client.");
      const validItems = items
        .filter((it) => it.description.trim() !== "")
        .map((it) => ({ description: it.description.trim(), qty: Number(it.qty), rate: Number(it.rate) }));
      if (!validItems.length) throw new Error("Please add at least one line item.");
      if (validItems.some((it) => !(it.qty > 0) || it.rate < 0)) {
        throw new Error("Each line item needs a quantity above zero and a rate of zero or more.");
      }
      if (!(gstRate >= 0 && gstRate <= 100)) throw new Error("GST rate must be between 0 and 100.");

      // Totals and the invoice number are assigned by the database
      const payload = {
        client_id: selectedClientId,
        organisation: organisation.trim(),
        date: invoiceDate,
        issue_date: invoiceDate,
        due_date: dueDate || null,
        is_inter_state: isInterState,
        gst_rate: gstRate,
        notes: notes.trim(),
        items: validItems,
      };

      if (editingInvoice) {
        const { error } = await supabase.from("invoices").update(payload).eq("id", editingInvoice.id);
        if (error) throw error;
        logAuditEvent("UPDATE_INVOICE", "INVOICES", editingInvoice.id, { total: grandTotal });
        showToast("success", `Draft ${editingInvoice.invoice_number} saved.`);
      } else {
        const res = await fetch("/api/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not create the invoice.");
        showToast("success", `Invoice ${data.invoice_number} created as a draft.`);
      }

      setIsModalOpen(false);
      setEditingInvoice(null);
      loadData(false);
    } catch (err: any) {
      setFormError(err?.message || "Could not save the invoice.");
    } finally {
      setSaving(false);
    }
  }

  /* ---------------- Status actions ---------------- */

  async function markAsSent() {
    const inv = confirm?.invoice;
    if (!inv) return;
    setActionBusy(true);
    const { error } = await supabase.from("invoices").update({ status: "Sent" }).eq("id", inv.id);
    setActionBusy(false);
    setConfirm(null);
    if (error) return showToast("error", error.message);
    logAuditEvent("ISSUE_INVOICE", "INVOICES", inv.id, { invoiceNumber: inv.invoice_number });
    showToast("success", `Invoice ${inv.invoice_number} issued and locked.`);
    setIsModalOpen(false);
    loadData(false);
  }

  async function cancelInvoice() {
    const inv = confirm?.invoice;
    if (!inv) return;
    setActionBusy(true);
    const { error } = await supabase.from("invoices").update({ status: "Cancelled" }).eq("id", inv.id);
    setActionBusy(false);
    setConfirm(null);
    if (error) return showToast("error", error.message);
    logAuditEvent("CANCEL_INVOICE", "INVOICES", inv.id, { invoiceNumber: inv.invoice_number });
    showToast("success", `Invoice ${inv.invoice_number} cancelled. Its number stays reserved.`);
    setIsModalOpen(false);
    loadData(false);
  }

  function requestEmail(inv: any, e?: React.MouseEvent) {
    e?.stopPropagation();
    if (statusOf(inv) === "Cancelled") return showToast("error", "Cancelled invoices cannot be emailed.");
    if (!EMAIL_RE.test(clientEmailOf(inv))) return showToast("error", "This client has no valid email address. Add one on the Clients page.");
    setConfirm({ kind: "email", invoice: inv });
  }

  async function sendInvoiceEmail() {
    const inv = confirm?.invoice;
    if (!inv) return;
    const recipientEmail = clientEmailOf(inv);
    setConfirm(null);
    setSendingId(inv.id);

    try {
      const res = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: inv.id, recipientEmail }),
      });

      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await res.json() : {};
      if (!res.ok) throw new Error((data as any).error || `Server returned status ${res.status}.`);

      // Emailing a draft issues it
      if (statusOf(inv) === "Draft") {
        await supabase.from("invoices").update({ status: "Sent" }).eq("id", inv.id);
      }

      showToast("success", `Invoice ${inv.invoice_number} emailed to ${recipientEmail}.`);
      loadData(false);
    } catch (err: any) {
      console.error("Send Email Error:", err);
      showToast("error", "Failed to send the invoice email: " + (err?.message || "Unknown error"));
    } finally {
      setSendingId(null);
    }
  }

  function sendWhatsAppReminder(inv: any) {
    const number = toWhatsAppNumber(clientPhoneOf(inv));
    if (!number) return showToast("error", "This client has no valid mobile number.");
    const due = dueOf(inv);
    const text =
      `Dear ${clientNameOf(inv)},\n\n` +
      `This is a gentle reminder that invoice ${inv.invoice_number} has a balance of ${formatINR(balanceOf(inv))}` +
      `${due ? ` (due ${formatDate(due)})` : ""}.\n\n` +
      `${firmSettings?.upi_id ? `UPI: ${firmSettings.upi_id}\n` : ""}` +
      `${firmSettings?.bank_account_no ? `A/C: ${firmSettings.bank_account_no} · IFSC: ${firmSettings.bank_ifsc || ""}\n` : ""}` +
      `\nPlease ignore if already paid.\n\nRegards,\n${firmSettings?.firm_name || "Finetax"}`;
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  /* ---------------- Payments ---------------- */

  function openPayment(inv: any, e?: React.MouseEvent) {
    e?.stopPropagation();
    setPaymentTarget(inv);
    setPayAmount(String(balanceOf(inv) || ""));
    setPayDate(today);
    setPayMode(PAYMENT_MODES[0]);
    setPayRef("");
    setPayNotes("");
    setPayError("");
  }

  async function savePayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paymentTarget || paySaving) return;
    setPayError("");

    const amount = round2(Number(payAmount));
    if (!(amount > 0)) return setPayError("Enter an amount greater than zero.");
    if (amount > balanceOf(paymentTarget) + 0.01) return setPayError(`The balance due is ${formatINR(balanceOf(paymentTarget))}.`);
    if (!payDate || payDate > today) return setPayError("Payment date cannot be in the future.");

    setPaySaving(true);
    const { error } = await supabase.from("invoice_payments").insert([
      {
        invoice_id: paymentTarget.id,
        amount,
        paid_on: payDate,
        mode: payMode,
        reference: payRef.trim() || null,
        notes: payNotes.trim() || null,
      },
    ]);
    setPaySaving(false);

    if (error) return setPayError(error.message);

    logAuditEvent("RECORD_PAYMENT", "INVOICES", paymentTarget.id, {
      invoiceNumber: paymentTarget.invoice_number,
      amount,
      mode: payMode,
      reference: payRef.trim(),
    });
    showToast("success", `${formatINR(amount)} recorded against ${paymentTarget.invoice_number}.`);
    const invoiceId = paymentTarget.id;
    setPaymentTarget(null);
    await loadData(false);
    if (editingInvoice?.id === invoiceId) {
      loadPayments(invoiceId);
      setIsModalOpen(false);
    }
  }

  async function deletePayment() {
    const p = confirm?.payment;
    if (!p) return;
    setActionBusy(true);
    const { error } = await supabase.from("invoice_payments").delete().eq("id", p.id);
    setActionBusy(false);
    setConfirm(null);
    if (error) return showToast("error", "Could not delete this payment. Only administrators can remove payments.");
    logAuditEvent("DELETE_PAYMENT", "INVOICES", p.invoice_id, { amount: p.amount, paid_on: p.paid_on });
    showToast("success", "Payment entry removed.");
    loadPayments(p.invoice_id);
    loadData(false);
    setIsModalOpen(false);
  }

  /* ---------------- Render ---------------- */

  const editingStatus = editingInvoice ? statusOf(editingInvoice) : "Draft";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <Receipt className="h-5 w-5 text-navy" /> Invoices & Billing
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Serial GST invoices, a full payments ledger, and receivables tracking.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openModal()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light sm:w-auto"
        >
          <Plus className="h-4 w-4" /> New Invoice
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Billed · This FY</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-navy">{compactINR(stats.billed)}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy/10 text-navy">
              <IndianRupee className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">{stats.billedCount} issued invoices</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Collected · This FY</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-emerald-700">{compactINR(stats.collected)}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${stats.collectionRate}%` }} />
            </div>
            <p className="text-[11px] text-text-muted">{stats.collectionRate}% collection rate</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setStatusTab("Sent")}
          className="rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition hover:border-navy/30 hover:shadow-md"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Outstanding</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-amber-700">{compactINR(stats.outstanding)}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">{stats.outstandingCount} invoices with a balance</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusTab("Overdue")}
          className="rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition hover:border-navy/30 hover:shadow-md"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Overdue</p>
              <p className={`mt-1.5 text-2xl font-bold tracking-tight ${stats.overdueCount ? "text-rose-600" : "text-text-main"}`}>
                {compactINR(stats.overdueAmount)}
              </p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
              <CalendarClock className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            {stats.overdueCount ? <span className="font-semibold text-rose-600">{stats.overdueCount} past due · click to view</span> : "Nothing overdue"}
          </p>
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-alt p-0.5 text-xs font-semibold">
            {STATUS_TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setStatusTab(t)}
                className={`rounded-md px-2.5 py-1.5 transition ${statusTab === t ? "bg-surface text-navy shadow-sm" : "text-text-muted hover:text-text-main"}`}
              >
                {t}
                <span className="ml-1 text-[10px] font-medium text-text-muted">{stats.tabCounts[t] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="relative w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search invoice #, client, organisation..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading billing records...
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Receipt className="h-6 w-6 text-text-muted" />
            <p className="text-xs text-text-muted">{invoices.length === 0 ? "No invoices generated yet." : "No invoices match this view."}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Due</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Balance</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((i) => {
                  const st = statusOf(i);
                  const overdue = isOverdue(i);
                  const balance = balanceOf(i);
                  return (
                    <tr key={i.id} className={`cursor-pointer transition hover:bg-surface-alt ${st === "Cancelled" ? "opacity-60" : ""}`} onClick={() => openModal(i)}>
                      <td className="whitespace-nowrap font-mono font-bold text-navy">{i.invoice_number || "—"}</td>
                      <td className="whitespace-nowrap">{formatDate(issueOf(i))}</td>
                      <td>
                        <p className="font-medium text-text-main">{clientNameOf(i)}</p>
                        {i.organisation && <p className="text-[10px] text-text-muted">{i.organisation}</p>}
                      </td>
                      <td className={`whitespace-nowrap ${overdue ? "font-semibold text-rose-600" : ""}`}>
                        {dueOf(i) ? formatDate(dueOf(i)) : "—"}
                      </td>
                      <td className="whitespace-nowrap text-right font-semibold">{formatINR(Number(i.total || 0))}</td>
                      <td className="whitespace-nowrap text-right text-emerald-700">{paidOf(i) ? formatINR(paidOf(i)) : "—"}</td>
                      <td className={`whitespace-nowrap text-right font-semibold ${balance > 0 ? (overdue ? "text-rose-600" : "text-amber-700") : "text-text-muted"}`}>
                        {balance > 0 ? formatINR(balance) : "—"}
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[st] || STATUS_STYLES.Draft}`}>{st}</span>
                          {overdue && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600">
                              <AlertCircle className="h-3 w-3" /> Overdue
                            </span>
                          )}
                          {i.email_sent_at && <span className="text-[10px] font-medium text-emerald-600">✓ Emailed {formatDate(i.email_sent_at)}</span>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex gap-1.5">
                          {balance > 0 && !["Draft", "Cancelled"].includes(st) && (
                            <button
                              type="button"
                              onClick={(e) => openPayment(i, e)}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-700"
                            >
                              <Wallet className="h-3 w-3" /> Payment
                            </button>
                          )}
                          {st !== "Cancelled" && (
                            <button
                              type="button"
                              onClick={(e) => requestEmail(i, e)}
                              disabled={sendingId === i.id}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-60 ${
                                i.email_sent_at ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-border hover:bg-surface-alt"
                              }`}
                            >
                              {sendingId === i.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                              {i.email_sent_at ? "Resend" : "Email"}
                            </button>
                          )}
                          <a
                            href={`/invoices/${i.id}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold transition hover:bg-surface-alt"
                          >
                            <Printer className="h-3 w-3" /> PDF
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ================= Invoice Editor / Viewer ================= */}
      {isModalOpen && (
        <Modal
          title={editingInvoice ? `Invoice ${editingInvoice.invoice_number}` : "New Invoice"}
          subtitle={
            editingInvoice
              ? `${clientNameOf(editingInvoice)} · issued ${formatDate(issueOf(editingInvoice))}`
              : "The invoice number is assigned automatically when you save."
          }
          onClose={closeModal}
          maxWidth="max-w-4xl"
          headerExtra={
            editingInvoice ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[editingStatus] || STATUS_STYLES.Draft}`}>
                  {editingStatus}
                </span>
                {isLocked && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-text-muted">
                    <Lock className="h-3 w-3" /> Issued invoices are locked · only due date and notes can change
                  </span>
                )}
              </div>
            ) : null
          }
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {editingInvoice && (
                  <a
                    href={`/invoices/${editingInvoice.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt"
                  >
                    <Printer className="h-3.5 w-3.5" /> PDF
                  </a>
                )}
                {editingInvoice && editingStatus !== "Cancelled" && (
                  <button
                    type="button"
                    onClick={() => requestEmail(editingInvoice)}
                    disabled={sendingId === editingInvoice.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt disabled:opacity-60"
                  >
                    {sendingId === editingInvoice.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {editingInvoice.email_sent_at ? "Resend Email" : "Send Email"}
                  </button>
                )}
                {editingInvoice && editingStatus === "Draft" && (
                  <button
                    type="button"
                    onClick={() => setConfirm({ kind: "markSent", invoice: editingInvoice })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                  >
                    <Lock className="h-3.5 w-3.5" /> Issue (mark as Sent)
                  </button>
                )}
                {editingInvoice && isAdmin && !["Cancelled"].includes(editingStatus) && paidOf(editingInvoice) === 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirm({ kind: "cancel", invoice: editingInvoice })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-100"
                  >
                    <Ban className="h-3.5 w-3.5" /> Cancel Invoice
                  </button>
                )}
              </div>
              <div className="flex gap-2 sm:ml-auto">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt sm:flex-none"
                >
                  Close
                </button>
                {editingStatus !== "Cancelled" && (
                  <button
                    type="submit"
                    form="invoice-form"
                    disabled={saving}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-60 sm:flex-none"
                  >
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {editingInvoice ? "Save Changes" : "Create Draft Invoice"}
                  </button>
                )}
              </div>
            </div>
          }
        >
          <form id="invoice-form" onSubmit={handleSubmit} className="space-y-5">
            {formError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs font-medium text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Client *</label>
                <select required disabled={isLocked} value={selectedClientId} onChange={(e) => handleClientChange(e.target.value)} className={inputClass}>
                  <option value="">— Select Client —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.organization_name ? `(${c.organization_name})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>Organisation</label>
                <input
                  type="text"
                  list="organizations-list-inv"
                  placeholder="e.g. Client Pvt Ltd"
                  value={organisation}
                  disabled={isLocked}
                  onChange={(e) => setOrganisation(e.target.value)}
                  className={inputClass}
                />
                <datalist id="organizations-list-inv">
                  {uniqueOrganizations.map((org: any) => (
                    <option key={org} value={org} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className={labelClass}>Invoice Date</label>
                <input type="date" disabled={isLocked} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={inputClass} />
              </div>

              <div>
                <label className={labelClass}>Due Date</label>
                <input type="date" value={dueDate} min={invoiceDate} disabled={editingStatus === "Cancelled"} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
              </div>

              <div>
                <label className={labelClass}>GST Type</label>
                <select
                  disabled={isLocked}
                  value={String(isInterState)}
                  onChange={(e) => {
                    setIsInterState(e.target.value === "true");
                    setGstAutoNote("");
                  }}
                  className={inputClass}
                >
                  <option value="false">Intra-state (CGST + SGST)</option>
                  <option value="true">Inter-state (IGST)</option>
                </select>
                {gstAutoNote && <p className="mt-1 text-[10px] text-text-muted">{gstAutoNote}</p>}
              </div>

              <div>
                <label className={labelClass}>GST Rate %</label>
                <input type="number" min="0" max="100" step="0.01" disabled={isLocked} value={gstRate} onChange={(e) => setGstRate(Number(e.target.value))} className={inputClass} />
              </div>
            </div>

            {/* Line Items */}
            <div className="space-y-2 border-t border-border pt-4">
              <label className={labelClass}>Line Items</label>
              {isLocked ? (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Rate</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => (
                        <tr key={idx}>
                          <td>{item.description}</td>
                          <td className="text-right">{item.qty}</td>
                          <td className="text-right">{formatINR(item.rate)}</td>
                          <td className="text-right font-semibold">{formatINR(round2(item.qty * item.rate))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <>
                  {items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 items-center gap-2">
                      <input
                        type="text"
                        placeholder="Service description"
                        value={item.description}
                        onChange={(e) => handleItemChange(idx, "description", e.target.value)}
                        className={`${inputClass} col-span-12 sm:col-span-6`}
                        required
                      />
                      <input
                        type="number"
                        min="1"
                        step="1"
                        placeholder="Qty"
                        value={item.qty}
                        onChange={(e) => handleItemChange(idx, "qty", Number(e.target.value))}
                        className={`${inputClass} col-span-3 text-center sm:col-span-1`}
                        required
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Rate"
                        value={item.rate}
                        onChange={(e) => handleItemChange(idx, "rate", Number(e.target.value))}
                        className={`${inputClass} col-span-4 sm:col-span-2`}
                        required
                      />
                      <span className="col-span-4 text-right text-sm font-semibold text-navy sm:col-span-2">
                        {formatINR(round2((Number(item.qty) || 0) * (Number(item.rate) || 0)))}
                      </span>
                      <div className="col-span-1 flex justify-end">
                        {items.length > 1 && (
                          <button type="button" onClick={() => handleRemoveItem(idx)} className="rounded-md p-1.5 text-danger transition hover:bg-danger/10" aria-label="Remove line">
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={handleAddItem} className="inline-flex items-center gap-1 text-xs font-semibold text-navy hover:underline">
                    <Plus className="h-3.5 w-3.5" /> Add line
                  </button>
                </>
              )}
            </div>

            <div className="flex flex-col gap-5 md:flex-row">
              {/* Notes */}
              <div className="flex-1">
                <label className={labelClass}>Notes, Terms & Bank Details</label>
                <textarea rows={7} value={notes} disabled={editingStatus === "Cancelled"} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
              </div>

              {/* Totals Box */}
              <div className="w-full space-y-1.5 self-start rounded-lg border border-border bg-surface-alt p-4 text-xs md:w-72">
                <div className="flex justify-between text-text-muted">
                  <span>Subtotal</span>
                  <span>{formatINR(isLocked ? Number(editingInvoice?.subtotal || subtotal) : subtotal)}</span>
                </div>
                {isInterState ? (
                  <div className="flex justify-between text-text-muted">
                    <span>IGST ({gstRate}%)</span>
                    <span>{formatINR(isLocked ? Number(editingInvoice?.igst || igst) : igst)}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between text-text-muted">
                      <span>CGST ({gstRate / 2}%)</span>
                      <span>{formatINR(isLocked ? Number(editingInvoice?.cgst || cgst) : cgst)}</span>
                    </div>
                    <div className="flex justify-between text-text-muted">
                      <span>SGST ({gstRate / 2}%)</span>
                      <span>{formatINR(isLocked ? Number(editingInvoice?.sgst || sgst) : sgst)}</span>
                    </div>
                  </>
                )}
                <div className="mt-1 flex justify-between border-t border-border pt-2 text-sm font-bold text-navy">
                  <span>Total</span>
                  <span>{formatINR(isLocked ? Number(editingInvoice?.total || grandTotal) : grandTotal)}</span>
                </div>
                {editingInvoice && (
                  <>
                    <div className="flex justify-between text-emerald-700">
                      <span>Paid</span>
                      <span>{formatINR(paidOf(editingInvoice))}</span>
                    </div>
                    <div className={`flex justify-between font-bold ${balanceOf(editingInvoice) > 0 ? "text-rose-600" : "text-emerald-700"}`}>
                      <span>Balance</span>
                      <span>{formatINR(balanceOf(editingInvoice))}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </form>

          {/* Payments ledger */}
          {editingInvoice && (
            <div className="mt-6 space-y-3 border-t border-border pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-1.5 text-xs font-bold text-text-main">
                  <Wallet className="h-4 w-4 text-emerald-600" /> Payments Received
                </h4>
                <div className="flex gap-2">
                  {balanceOf(editingInvoice) > 0 && !["Draft", "Cancelled"].includes(editingStatus) && (
                    <>
                      <button
                        type="button"
                        onClick={() => sendWhatsAppReminder(editingInvoice)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp reminder
                      </button>
                      <button
                        type="button"
                        onClick={() => openPayment(editingInvoice)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-emerald-700"
                      >
                        <Plus className="h-3.5 w-3.5" /> Record payment
                      </button>
                    </>
                  )}
                </div>
              </div>

              {editingStatus === "Draft" && (
                <p className="text-[11px] text-text-muted">Issue the invoice (send it or mark as Sent) before recording payments.</p>
              )}

              {loadingPayments ? (
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading payments...
                </div>
              ) : payments.length === 0 ? (
                <p className="text-xs italic text-text-muted">No payments recorded yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Mode</th>
                        <th>Reference</th>
                        <th>Recorded By</th>
                        <th className="text-right">Amount</th>
                        {isAdmin && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td className="whitespace-nowrap">{formatDate(p.paid_on)}</td>
                          <td>{p.mode}</td>
                          <td className="max-w-[180px] truncate" title={p.notes || ""}>
                            {p.reference || <span className="text-text-muted">{p.notes ? p.notes : "—"}</span>}
                          </td>
                          <td>{teamNames[p.recorded_by] || "—"}</td>
                          <td className="whitespace-nowrap text-right font-semibold text-emerald-700">{formatINR(Number(p.amount))}</td>
                          {isAdmin && (
                            <td className="text-right">
                              <button
                                type="button"
                                onClick={() => setConfirm({ kind: "deletePayment", payment: p })}
                                className="rounded-md p-1 text-rose-600 transition hover:bg-rose-50"
                                aria-label="Delete payment"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* ================= Record Payment ================= */}
      {paymentTarget && (
        <Modal
          title={`Record Payment · ${paymentTarget.invoice_number}`}
          subtitle={`${clientNameOf(paymentTarget)} · balance due ${formatINR(balanceOf(paymentTarget))}`}
          onClose={() => !paySaving && setPaymentTarget(null)}
          maxWidth="max-w-md"
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPaymentTarget(null)}
                disabled={paySaving}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="payment-form"
                disabled={paySaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {paySaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save Payment
              </button>
            </div>
          }
        >
          <form id="payment-form" onSubmit={savePayment} className="space-y-4">
            {payError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs font-medium text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{payError}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Amount (₹) *</label>
                <input type="number" min="0.01" step="0.01" required value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className={inputClass} autoFocus />
              </div>
              <div>
                <label className={labelClass}>Received On *</label>
                <input type="date" required max={today} value={payDate} onChange={(e) => setPayDate(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Payment Mode</label>
              <select value={payMode} onChange={(e) => setPayMode(e.target.value)} className={inputClass}>
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Reference / UTR / Cheque No.</label>
              <input type="text" value={payRef} onChange={(e) => setPayRef(e.target.value)} className={inputClass} placeholder="e.g. UTR 4321…" maxLength={120} />
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <input type="text" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} className={inputClass} maxLength={500} />
            </div>
          </form>
        </Modal>
      )}

      {/* Confirmations */}
      {confirm?.kind === "email" && (
        <ConfirmDialog
          title="Email this invoice?"
          message={`Invoice ${confirm.invoice.invoice_number} will be sent as a PDF to ${clientEmailOf(confirm.invoice)}.${
            statusOf(confirm.invoice) === "Draft" ? " This also issues the invoice, which locks it from editing." : ""
          }`}
          confirmLabel="Send email"
          tone="primary"
          onConfirm={sendInvoiceEmail}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "markSent" && (
        <ConfirmDialog
          title="Issue this invoice?"
          message={`Invoice ${confirm.invoice.invoice_number} will be marked as Sent. Line items, amounts and the client will be locked.`}
          confirmLabel="Issue invoice"
          tone="primary"
          loading={actionBusy}
          onConfirm={markAsSent}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "cancel" && (
        <ConfirmDialog
          title="Cancel this invoice?"
          message={`Invoice ${confirm.invoice.invoice_number} will be marked Cancelled. Its number stays reserved so the GST series has no gap. This cannot be undone.`}
          confirmLabel="Cancel invoice"
          tone="danger"
          loading={actionBusy}
          onConfirm={cancelInvoice}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "deletePayment" && (
        <ConfirmDialog
          title="Remove this payment entry?"
          message={`${formatINR(Number(confirm.payment.amount))} received on ${formatDate(confirm.payment.paid_on)} will be removed and the balance recalculated.`}
          confirmLabel="Remove payment"
          tone="danger"
          loading={actionBusy}
          onConfirm={deletePayment}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-[70] flex max-w-sm items-start gap-2 rounded-lg border px-4 py-3 text-xs font-semibold shadow-lg animate-scale-in ${
            toast.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {toast.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}