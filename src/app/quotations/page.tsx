"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Trash2,
  X,
  FileText,
  Download,
  Mail,
  Loader2,
  Landmark,
  CheckCircle2,
  AlertCircle,
  IndianRupee,
  Target,
  Hourglass,
  CalendarClock,
  Receipt,
  ExternalLink,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Client } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { clientLabel, sortByLabel } from "@/components/ui/ClientPicker";
import { useTaskCategories } from "@/components/tasks/TaskCategories";
import ClientPicker from "@/components/ui/ClientPicker";
import { compactINR, formatDate, formatINR, localISODate } from "@/lib/format";

type ClientRow = Client & Record<string, any>;
type LineItem = { description: string; qty: number; rate: number };

// ADMIN MASTER SERVICE LIST
const MASTER_SERVICES = [
  { description: "Income Tax Return Filing (Individual)", defaultRate: 1500 },
  { description: "Income Tax Return Filing (Business)", defaultRate: 5000 },
  { description: "GST Registration", defaultRate: 2500 },
  { description: "GST Monthly Return Filing (Per Month)", defaultRate: 1000 },
  { description: "Company Incorporation (Pvt Ltd)", defaultRate: 15000 },
  { description: "LLP Registration", defaultRate: 8000 },
  { description: "Statutory Audit Fee", defaultRate: 10000 },
  { description: "Tax Audit (Section 44AB)", defaultRate: 12000 },
  { description: "Trademark Registration", defaultRate: 6500 },
  { description: "General Tax Consultancy (Per Hour)", defaultRate: 2000 },
  { description: "Custom Service / Miscellaneous", defaultRate: 0 },
];

const EDITABLE_STATUSES = ["Draft", "Sent", "Accepted", "Rejected"];
const STATUS_TABS = ["All", "Draft", "Sent", "Accepted", "Rejected", "Converted", "Expired"];

const STATUS_STYLES: Record<string, string> = {
  Draft: "bg-amber-50 text-amber-700 border-amber-200",
  Sent: "bg-blue-50 text-blue-700 border-blue-200",
  Accepted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Rejected: "bg-rose-50 text-rose-700 border-rose-200",
  Converted: "bg-violet-50 text-violet-700 border-violet-200",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_VALIDITY_DAYS = 15;

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15 disabled:bg-surface-alt disabled:text-text-muted";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

/* ---------------- Helpers ---------------- */

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localISODate(new Date(y, m - 1, d + days));
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function getQuoteNumber(q: any): string {
  return q.quote_number || q.quotation_number || "—";
}
function getIsoDate(value: unknown): string {
  const v = String(value || "");
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "";
}
function getValidUntil(q: any): string {
  return getIsoDate(q.valid_until || q.validUntil);
}
function normalizeItems(raw: unknown): LineItem[] {
  if (!Array.isArray(raw) || raw.length === 0) return [{ description: "", qty: 1, rate: 0 }];
  return raw.map((it: any) => ({
    description: String(it?.description ?? it?.desc ?? ""),
    qty: Number(it?.qty ?? 1) || 1,
    rate: Number(it?.rate ?? it?.price ?? 0) || 0,
  }));
}

/* ---------------- Page ---------------- */

export default function QuotationsPage() {
  const currentUser = useCurrentUser();
  const isAdmin = !!currentUser?.isAdmin;
  const [supabase] = useState(() => createClient());

  const [quotations, setQuotations] = useState<any[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [invoiceByQuote, setInvoiceByQuote] = useState<Record<string, { id: string; invoice_number: string }>>({});
  const [firmSettings, setFirmSettings] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState("All");
  const [loading, setLoading] = useState(true);

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string; href?: string; hrefLabel?: string } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "delete" | "email" | "invoice"; quote: any }>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Form State
  const [targetType, setTargetType] = useState<"client" | "lead">("client");
  const [clientId, setClientId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [address, setAddress] = useState("");
  const [quotationDate, setQuotationDate] = useState(localISODate());
  const [validUntil, setValidUntil] = useState("");
  const [isInterState, setIsInterState] = useState(false);
  const [gstRate, setGstRate] = useState<number>(18);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("Draft");

  // Dynamic Line Items
  const [items, setItems] = useState<LineItem[]>([{ description: "", qty: 1, rate: 0 }]);

  const today = localISODate();
  const weekAhead = addDays(today, 7);

  useEffect(() => {
    loadData();
  }, []);

  function showToast(type: "success" | "error", message: string, href?: string, hrefLabel?: string) {
    setToast({ type, message, href, hrefLabel });
    window.setTimeout(() => setToast(null), href ? 9000 : 4500);
  }

  async function loadData(showSpinner = true) {
    if (showSpinner) setLoading(true);

    const [qRes, cRes, lRes, sRes, iRes] = await Promise.all([
      supabase.from("quotations").select("*").order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name, email, phone, organization_name, address, status").order("name", { ascending: true }),
      supabase
        .from("leads")
        .select("id, name, email, phone, organization_name, company, status, converted_client_id")
        .order("created_at", { ascending: false }),
      supabase
        .from("firm_settings")
        .select("firm_name, bank_name, bank_account_no, bank_ifsc, upi_id, default_gst_rate, payment_terms")
        .eq("id", 1)
        .maybeSingle(),
      supabase.from("invoices").select("id, invoice_number, quotation_id").not("quotation_id", "is", null),
    ]);

    if (qRes.error) showToast("error", "Could not load quotations. Please refresh the page.");
    if (qRes.data) setQuotations(qRes.data);
    if (cRes.data) setClients(cRes.data as ClientRow[]);
    if (lRes.data) setLeads(lRes.data);
    if (sRes.data) setFirmSettings(sRes.data);
    if (iRes.data) {
      const map: Record<string, { id: string; invoice_number: string }> = {};
      iRes.data.forEach((inv: any) => {
        if (inv.quotation_id) map[inv.quotation_id] = { id: inv.id, invoice_number: inv.invoice_number };
      });
      setInvoiceByQuote(map);
    }

    setLoading(false);
  }

  /* ---------------- Lookups ---------------- */

  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [String(c.id), c])), [clients]);
  const leadById = useMemo(() => Object.fromEntries(leads.map((l) => [String(l.id), l])), [leads]);

  const recipientOf = (q: any) =>
    q.recipient_name || clientById[q.client_id]?.name || leadById[q.lead_id]?.name || q.organisation || "—";
  const statusOf = (q: any) => q.status || "Draft";
  const isExpired = (q: any) => {
    const v = getValidUntil(q);
    return ["Draft", "Sent"].includes(statusOf(q)) && !!v && v < today;
  };
  const canInvoice = (q: any) =>
    !["Converted", "Rejected"].includes(statusOf(q)) &&
    !invoiceByQuote[q.id] &&
    !!(q.client_id || leadById[q.lead_id]?.converted_client_id);

  /* ---------------- Analytics ---------------- */

  const stats = useMemo(() => {
    const live = quotations.filter((q) => statusOf(q) !== "Rejected");
    const awaiting = quotations.filter((q) => ["Draft", "Sent"].includes(statusOf(q)) && !isExpired(q));
    const won = quotations.filter((q) => ["Accepted", "Converted"].includes(statusOf(q))).length;
    const rejected = quotations.filter((q) => statusOf(q) === "Rejected").length;
    const expiringSoon = awaiting.filter((q) => {
      const v = getValidUntil(q);
      return v && v >= today && v <= weekAhead;
    }).length;
    const expired = quotations.filter(isExpired).length;
    const tabCounts: Record<string, number> = { All: quotations.length, Expired: expired };
    ["Draft", "Sent", "Accepted", "Rejected", "Converted"].forEach((s) => {
      tabCounts[s] = quotations.filter((q) => statusOf(q) === s).length;
    });
    return {
      quotedValue: live.reduce((sum, q) => sum + Number(q.total || 0), 0),
      quotedCount: live.length,
      awaitingCount: awaiting.length,
      awaitingValue: awaiting.reduce((sum, q) => sum + Number(q.total || 0), 0),
      acceptanceRate: won + rejected > 0 ? Math.round((won / (won + rejected)) * 100) : 0,
      won,
      rejected,
      expiringSoon,
      expired,
      tabCounts,
    };
  }, [quotations, today, weekAhead, invoiceByQuote]);

  const filteredQuotations = useMemo(() => {
    const s = search.trim().toLowerCase();
    return quotations.filter((q) => {
      if (statusTab === "Expired" && !isExpired(q)) return false;
      if (!["All", "Expired"].includes(statusTab) && statusOf(q) !== statusTab) return false;
      if (!s) return true;
      return [getQuoteNumber(q), recipientOf(q), q.organisation, q.notes]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(s));
    });
  }, [quotations, search, statusTab, clientById, leadById, today]);

  /* ---------------- Modal ---------------- */

  function defaultNotes(): string {
    return `Advance Payment Required for Mobilization of Work.\n\nBank Details:\nBank: ${firmSettings?.bank_name || "N/A"}\nA/C: ${firmSettings?.bank_account_no || "N/A"}\nIFSC: ${firmSettings?.bank_ifsc || "N/A"}\nUPI: ${firmSettings?.upi_id || "N/A"}`;
  }

  function openModal(q?: any) {
    setFormError("");
    if (q) {
      setEditingQuotation(q);
      setTargetType(q.lead_id && !q.client_id ? "lead" : "client");
      setClientId(q.client_id || "");
      setLeadId(q.lead_id || "");
      const c = clientById[q.client_id];
      const l = leadById[q.lead_id];
      setRecipientName(q.recipient_name || c?.name || l?.name || "");
      setRecipientEmail(q.recipient_email || c?.email || l?.email || "");
      setRecipientPhone(q.recipient_phone || c?.phone || l?.phone || "");
      setOrganisation(q.organisation || c?.organization_name || l?.organization_name || l?.company || "");
      setAddress(q.address || c?.address || "");
      setQuotationDate(getIsoDate(q.date) || today);
      setValidUntil(getValidUntil(q));
      setIsInterState(Boolean(q.is_inter_state));
      setGstRate(Number(q.gst_rate ?? 18));
      setNotes(q.notes || "");
      setStatus(statusOf(q));
      setItems(normalizeItems(q.items));
    } else {
      setEditingQuotation(null);
      resetForm();
    }
    setIsModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setIsModalOpen(false);
    setEditingQuotation(null);
    resetForm();
  }

  function resetForm() {
    setTargetType("client");
    setClientId("");
    setLeadId("");
    setRecipientName("");
    setRecipientEmail("");
    setRecipientPhone("");
    setOrganisation("");
    setAddress("");
    setQuotationDate(today);
    setValidUntil(addDays(today, DEFAULT_VALIDITY_DAYS));
    setIsInterState(false);
    setGstRate(Number(firmSettings?.default_gst_rate ?? 18));
    setStatus("Draft");
    setItems([{ description: "", qty: 1, rate: 0 }]);
    setNotes(defaultNotes());
    setFormError("");
  }

  // --- AUTO-FILL HANDLERS ---
  function handleTargetTypeChange(type: "client" | "lead") {
    setTargetType(type);
    setClientId("");
    setLeadId("");
    setRecipientName("");
    setRecipientEmail("");
    setRecipientPhone("");
    setOrganisation("");
    setAddress("");
  }

  function handleClientChange(id: string) {
    setClientId(id);
    const c = clientById[id];
    setRecipientName(c?.name || "");
    setRecipientEmail(c?.email || "");
    setRecipientPhone(c?.phone || "");
    setOrganisation(c?.organization_name || "");
    setAddress(c?.address || "");
  }

  function handleLeadChange(id: string) {
    setLeadId(id);
    const l = leadById[id];
    setRecipientName(l?.name || "");
    setRecipientEmail(l?.email || "");
    setRecipientPhone(l?.phone || "");
    setOrganisation(l?.organization_name || l?.company || "");
    setAddress("");
  }

  function addItem() {
    setItems([...items, { description: "", qty: 1, rate: 0 }]);
  }

  function removeItem(index: number) {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
  }

  function handleServiceSelect(index: number, description: string) {
    const service = MASTER_SERVICES.find((s) => s.description === description);
    const updated = [...items];
    updated[index] = {
      description,
      qty: updated[index].qty || 1,
      rate: service ? service.defaultRate : updated[index].rate,
    };
    setItems(updated);
  }

  function updateItem(index: number, field: keyof LineItem, value: any) {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  }

  // Financial preview (the database recalculates the same figures on save)
  const subtotal = round2(items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.rate || 0), 0));
  const taxRate = Number(gstRate || 0);
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (taxRate > 0) {
    if (isInterState) {
      igst = round2((subtotal * taxRate) / 100);
    } else {
      cgst = round2((subtotal * taxRate) / 200);
      sgst = cgst;
    }
  }
  const total = round2(subtotal + cgst + sgst + igst);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setFormError("");

    if (targetType === "client" && !clientId) return setFormError("Please select a client.");
    if (targetType === "lead" && !leadId) return setFormError("Please select a lead / enquiry.");
    if (!recipientName.trim()) return setFormError("Recipient name is required.");
    if (recipientEmail.trim() && !EMAIL_RE.test(recipientEmail.trim())) return setFormError("Please enter a valid email address.");
    if (items.some((i) => !i.description.trim())) return setFormError("All line items require a description.");
    if (items.some((i) => !(Number(i.qty) > 0) || Number(i.rate) < 0)) {
      return setFormError("Each line item needs a quantity above zero and a rate of zero or more.");
    }
    if (!(taxRate >= 0 && taxRate <= 100)) return setFormError("GST rate must be between 0 and 100.");
    if (validUntil && validUntil < quotationDate) return setFormError("'Valid until' cannot be before the quotation date.");

    const cleanItems = items.map((i) => ({
      description: i.description.trim(),
      qty: Number(i.qty),
      rate: Number(i.rate),
    }));

    // Totals and the quotation number are assigned by the database
    const payload: Record<string, any> = {
      date: quotationDate || today,
      valid_until: validUntil || null,
      validUntil: validUntil || null,
      items: cleanItems,
      is_inter_state: isInterState,
      gst_rate: taxRate,
      notes: notes || "",
      organisation: organisation.trim(),
      address: address.trim(),
      status: status || "Draft",
      recipient_name: recipientName.trim(),
      recipient_email: recipientEmail.trim().toLowerCase(),
      recipient_phone: recipientPhone.trim(),
      client_id: targetType === "client" ? clientId : null,
      lead_id: targetType === "lead" ? leadId : null,
    };

    setSaving(true);
    try {
      if (editingQuotation) {
        const { error } = await supabase.from("quotations").update(payload).eq("id", editingQuotation.id);
        if (error) throw error;
        logAuditEvent("UPDATE_QUOTATION", "QUOTATIONS", editingQuotation.id, { status: payload.status });
        showToast("success", `Quotation ${getQuoteNumber(editingQuotation)} saved.`);
      } else {
        const { data, error } = await supabase
          .from("quotations")
          .insert([{ ...payload, createdBy: currentUser?.id || null }])
          .select()
          .single();
        if (error || !data) throw error || new Error("Could not create the quotation.");

        await supabase
          .from("quotations")
          .update({ pdf_url: `${window.location.origin}/quotations/${data.id}/pdf` })
          .eq("id", data.id);

        logAuditEvent("CREATE_QUOTATION", "QUOTATIONS", data.id, { quoteNumber: data.quote_number });
        showToast("success", `Quotation ${data.quote_number} created.`);
      }

      setIsModalOpen(false);
      setEditingQuotation(null);
      resetForm();
      loadData(false);
    } catch (err: any) {
      console.error("Save Quotation Error:", err);
      setFormError(err?.message || "Could not save the quotation.");
    } finally {
      setSaving(false);
    }
  }

  /* ---------------- Actions ---------------- */

  async function handleDelete() {
    const q = confirm?.quote;
    if (!q) return;
    setActionBusy(true);
    const { error } = await supabase.from("quotations").delete().eq("id", q.id);
    setActionBusy(false);
    setConfirm(null);

    if (error) {
      showToast("error", "Could not delete this quotation. Only administrators can delete quotations.");
      return;
    }
    logAuditEvent("DELETE_QUOTATION", "QUOTATIONS", q.id, { quoteNumber: getQuoteNumber(q) });
    showToast("success", `Quotation ${getQuoteNumber(q)} deleted.`);
    setIsModalOpen(false);
    setEditingQuotation(null);
    loadData(false);
  }

  function emailFor(q: any): string {
    return q.recipient_email || clientById[q.client_id]?.email || leadById[q.lead_id]?.email || "";
  }

  function requestEmail(q: any, e?: React.MouseEvent) {
    e?.stopPropagation();
    if (!EMAIL_RE.test(emailFor(q))) {
      showToast("error", "This quotation has no valid email address. Edit it and add the recipient's email.");
      return;
    }
    setConfirm({ kind: "email", quote: q });
  }

  async function sendQuotationEmail() {
    const q = confirm?.quote;
    if (!q) return;
    const to = emailFor(q);
    setConfirm(null);
    setSendingId(q.id);

    try {
      const res = await fetch("/api/quotations/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotationId: q.id, recipientEmail: to }),
      });

      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await res.json() : {};
      if (!res.ok) throw new Error((data as any).error || `Server returned status ${res.status}.`);

      // Persist the "Sent" status (previously only shown on screen)
      if (statusOf(q) === "Draft") {
        await supabase.from("quotations").update({ status: "Sent" }).eq("id", q.id);
      }

      showToast("success", `Quotation ${getQuoteNumber(q)} emailed to ${to}.`);
      loadData(false);
    } catch (err: any) {
      console.error("Send Email Error:", err);
      showToast("error", "Failed to send the quotation email: " + (err?.message || "Unknown error"));
    } finally {
      setSendingId(null);
    }
  }

  function requestInvoice(q: any, e?: React.MouseEvent) {
    e?.stopPropagation();
    setConfirm({ kind: "invoice", quote: q });
  }

  async function convertToInvoice() {
    const q = confirm?.quote;
    if (!q) return;
    setActionBusy(true);

    const { data, error } = await supabase.rpc("convert_quotation_to_invoice", { p_quotation_id: q.id });

    if (error || !data) {
      setActionBusy(false);
      setConfirm(null);
      showToast("error", error?.message || "Could not convert this quotation.");
      return;
    }

    const invoice = data as { id: string; invoice_number: string };
    const pdfUrl = `${window.location.origin}/invoices/${invoice.id}/pdf`;
    await supabase.from("invoices").update({ pdf_url: pdfUrl }).eq("id", invoice.id);

    logAuditEvent("CONVERT_QUOTATION_TO_INVOICE", "QUOTATIONS", q.id, { invoiceNumber: invoice.invoice_number });

    setActionBusy(false);
    setConfirm(null);
    setIsModalOpen(false);
    setEditingQuotation(null);
    showToast("success", `Invoice ${invoice.invoice_number} created.`, pdfUrl, "Open invoice PDF");
    loadData(false);
  }

  /* ---------------- Render ---------------- */

  const locked = !!editingQuotation && (statusOf(editingQuotation) === "Converted" || !!invoiceByQuote[editingQuotation.id]);
  const linkedInvoice = editingQuotation ? invoiceByQuote[editingQuotation.id] : undefined;
  const leadOptions = leads.filter((l) => !["Won", "Lost"].includes(l.status) || String(l.id) === String(leadId));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <FileText className="h-5 w-5 text-navy" /> Quotations
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Prepare GST-ready fee proposals for clients and leads, email them as PDFs, and convert accepted quotes to invoices.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openModal()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light sm:w-auto"
        >
          <Plus className="h-4 w-4" /> New Quotation
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Quoted Value</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-navy">{compactINR(stats.quotedValue)}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy/10 text-navy">
              <IndianRupee className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">{stats.quotedCount} quotations (excluding rejected)</p>
        </div>

        <button
          type="button"
          onClick={() => setStatusTab("Sent")}
          className="rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition hover:border-navy/30 hover:shadow-md"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Awaiting Response</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-blue-700">{stats.awaitingCount}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Hourglass className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">{formatINR(stats.awaitingValue)} in draft or sent quotes</p>
        </button>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Acceptance Rate</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-emerald-700">{stats.acceptanceRate}%</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Target className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            {stats.won} accepted · {stats.rejected} rejected
          </p>
        </div>

        <button
          type="button"
          onClick={() => setStatusTab(stats.expired > 0 ? "Expired" : "Sent")}
          className="rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition hover:border-navy/30 hover:shadow-md"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Expiring in 7 Days</p>
              <p className={`mt-1.5 text-2xl font-bold tracking-tight ${stats.expiringSoon > 0 ? "text-amber-700" : "text-text-main"}`}>
                {stats.expiringSoon}
              </p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <CalendarClock className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            {stats.expired > 0 ? <span className="font-semibold text-rose-600">{stats.expired} already expired</span> : "None expired"}
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
                className={`rounded-md px-2.5 py-1.5 transition ${
                  statusTab === t ? "bg-surface text-navy shadow-sm" : "text-text-muted hover:text-text-main"
                }`}
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
              placeholder="Search number, recipient, notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading quotations...
          </div>
        ) : filteredQuotations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <FileText className="h-6 w-6 text-text-muted" />
            <p className="text-xs text-text-muted">
              {quotations.length === 0 ? "No quotations created yet." : "No quotations match this view."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Quote #</th>
                  <th>Date</th>
                  <th>Client / Recipient</th>
                  <th>Valid Until</th>
                  <th className="text-right">Amount</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredQuotations.map((q) => {
                  const st = statusOf(q);
                  const expired = isExpired(q);
                  const validTo = getValidUntil(q);
                  const inv = invoiceByQuote[q.id];
                  return (
                    <tr key={q.id} className="cursor-pointer transition hover:bg-surface-alt" onClick={() => openModal(q)}>
                      <td className="whitespace-nowrap font-bold text-navy">{getQuoteNumber(q)}</td>
                      <td className="whitespace-nowrap">{formatDate(getIsoDate(q.date) || q.created_at)}</td>
                      <td>
                        <p className="font-medium text-text-main">{q.organisation || recipientOf(q)}</p>
                        <p className="text-[10px] text-text-muted">
                          {q.organisation && q.organisation !== recipientOf(q) ? `${recipientOf(q)} · ` : ""}
                          {q.client_id ? "Client" : q.lead_id ? "Lead" : ""}
                        </p>
                      </td>
                      <td className={`whitespace-nowrap ${expired ? "font-semibold text-rose-600" : ""}`}>
                        {validTo ? formatDate(validTo) : "—"}
                      </td>
                      <td className="whitespace-nowrap text-right font-semibold text-text-main">{formatINR(Number(q.total || 0))}</td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[st] || STATUS_STYLES.Draft}`}>
                            {st}
                          </span>
                          {expired && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600">
                              <AlertCircle className="h-3 w-3" /> Expired
                            </span>
                          )}
                          {inv ? (
                            <span className="text-[10px] font-medium text-violet-700">Invoice {inv.invoice_number}</span>
                          ) : q.email_sent_at ? (
                            <span className="text-[10px] font-medium text-emerald-600">✓ Emailed {formatDate(q.email_sent_at)}</span>
                          ) : (
                            <span className="text-[10px] text-text-muted">Not emailed</span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => requestEmail(q, e)}
                            disabled={sendingId === q.id}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-60 ${
                              q.email_sent_at
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                : "border-border hover:bg-surface-alt"
                            }`}
                            title={q.email_sent_at ? `Resend (last sent ${formatDate(q.email_sent_at)})` : "Send quotation via email"}
                          >
                            {sendingId === q.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                            {q.email_sent_at ? "Resend" : "Email"}
                          </button>

                          {canInvoice(q) && (
                            <button
                              type="button"
                              onClick={(e) => requestInvoice(q, e)}
                              className="inline-flex items-center gap-1 rounded-lg bg-navy px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-navy-light"
                            >
                              <Receipt className="h-3 w-3" /> Invoice
                            </button>
                          )}

                          <a
                            href={`/quotations/${q.id}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold transition hover:bg-surface-alt"
                          >
                            <Download className="h-3 w-3" /> PDF
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

      {/* ================= Quotation Editor ================= */}
      {isModalOpen && (
        <Modal
          title={editingQuotation ? `Quotation ${getQuoteNumber(editingQuotation)}` : "New Quotation"}
          subtitle={
            editingQuotation
              ? `Created ${formatDate(editingQuotation.created_at)}`
              : "The quotation number is assigned automatically when you save."
          }
          onClose={closeModal}
          maxWidth="max-w-5xl"
          headerExtra={
            locked ? (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                <CheckCircle2 className="h-3 w-3" /> Converted to invoice {linkedInvoice?.invoice_number || ""} · read-only
              </span>
            ) : null
          }
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {editingQuotation && isAdmin && !locked && (
                  <button
                    type="button"
                    onClick={() => setConfirm({ kind: "delete", quote: editingQuotation })}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                )}
                {editingQuotation && linkedInvoice && (
                  <a
                    href={`/invoices/${linkedInvoice.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open invoice PDF
                  </a>
                )}
                {editingQuotation && !locked && canInvoice(editingQuotation) && (
                  <button
                    type="button"
                    onClick={() => requestInvoice(editingQuotation)}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <Receipt className="h-3.5 w-3.5" /> Convert to Invoice
                  </button>
                )}
              </div>
              <div className="flex gap-2 sm:ml-auto">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt sm:flex-none"
                >
                  {locked ? "Close" : "Cancel"}
                </button>
                {!locked && (
                  <button
                    type="submit"
                    form="quotation-form"
                    disabled={saving}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-60 sm:flex-none"
                  >
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Save Quotation
                  </button>
                )}
              </div>
            </div>
          }
        >
          <form id="quotation-form" onSubmit={handleSubmit}>
            <fieldset disabled={locked} className="min-w-0 space-y-5">
              {formError && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs font-medium text-danger">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Recipient Selection */}
              <div className="space-y-3 rounded-lg border border-navy/20 bg-navy/5 p-3">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-navy">Prepare quotation for</span>
                  <div className="flex rounded-lg border border-border bg-surface p-0.5 text-xs font-semibold">
                    {(["client", "lead"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => handleTargetTypeChange(t)}
                        className={`rounded-md px-3 py-1.5 transition ${
                          targetType === t ? "bg-navy text-white shadow-sm" : "text-text-muted hover:text-text-main"
                        }`}
                      >
                        {t === "client" ? "Existing Client" : "Enquiry / Lead"}
                      </button>
                    ))}
                  </div>
                </div>

                {targetType === "client" ? (
                  <ClientPicker clients={clients as any} value={clientId} onChange={handleClientChange} />
                ) : (
                  <select required value={leadId} onChange={(e) => handleLeadChange(e.target.value)} className={inputClass}>
                    <option value="">— Select Lead —</option>
                    {leadOptions.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} {l.organization_name || l.company ? `(${l.organization_name || l.company})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Editable Recipient Details */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Recipient Name *</label>
                  <input type="text" required value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className={inputClass} placeholder="Contact name" />
                </div>
                <div>
                  <label className={labelClass}>Organisation</label>
                  <input type="text" value={organisation} onChange={(e) => setOrganisation(e.target.value)} className={inputClass} placeholder="e.g. Acme Corp" />
                </div>
                <div>
                  <label className={labelClass}>Email</label>
                  <input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} className={inputClass} placeholder="email@domain.com" />
                </div>
                <div>
                  <label className={labelClass}>Phone</label>
                  <input type="tel" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} className={inputClass} placeholder="Phone number" />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Billing Address</label>
                  <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} placeholder="Full address for the quotation..." />
                </div>
              </div>

              {/* Dates, Status & Tax Setup */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                <div>
                  <label className={labelClass}>Date *</label>
                  <input type="date" required value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Valid Until</label>
                  <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                    {(locked ? ["Converted"] : EDITABLE_STATUSES).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>GST Type</label>
                  <select value={isInterState ? "inter" : "intra"} onChange={(e) => setIsInterState(e.target.value === "inter")} className={inputClass}>
                    <option value="intra">Intra-state (CGST + SGST)</option>
                    <option value="inter">Inter-state (IGST)</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>GST Rate %</label>
                  <input type="number" min="0" max="100" step="0.01" value={gstRate} onChange={(e) => setGstRate(Number(e.target.value))} className={inputClass} />
                </div>
              </div>

              {/* Line Items with Master Services Dropdown */}
              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <label className={labelClass}>Quotation Line Items</label>
                  <span className="text-[10px] text-text-muted">{items.length} item{items.length === 1 ? "" : "s"}</span>
                </div>

                <div className="hidden grid-cols-12 gap-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted sm:grid">
                  <span className="col-span-3">Master service</span>
                  <span className="col-span-4">Description</span>
                  <span className="col-span-1">Qty</span>
                  <span className="col-span-2">Rate (₹)</span>
                  <span className="col-span-2 text-right">Amount</span>
                </div>

                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-border bg-surface-alt p-2 sm:grid-cols-12">
                    <select
                      value={MASTER_SERVICES.some((s) => s.description === item.description) ? item.description : ""}
                      onChange={(e) => handleServiceSelect(idx, e.target.value)}
                      className={`${inputClass} sm:col-span-3`}
                    >
                      <option value="">— Master service —</option>
                      {MASTER_SERVICES.map((s) => (
                        <option key={s.description} value={s.description}>{s.description}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Or type a custom description..."
                      value={item.description}
                      onChange={(e) => updateItem(idx, "description", e.target.value)}
                      className={`${inputClass} sm:col-span-4`}
                    />
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Qty"
                      value={item.qty}
                      onChange={(e) => updateItem(idx, "qty", Number(e.target.value))}
                      className={`${inputClass} sm:col-span-1`}
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Rate"
                      value={item.rate}
                      onChange={(e) => updateItem(idx, "rate", Number(e.target.value))}
                      className={`${inputClass} sm:col-span-2`}
                    />
                    <div className="flex items-center justify-between gap-2 sm:col-span-2 sm:justify-end">
                      <span className="text-sm font-semibold text-text-main">
                        {formatINR(round2(Number(item.qty || 0) * Number(item.rate || 0)))}
                      </span>
                      {items.length > 1 && !locked && (
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="rounded-md p-1.5 text-danger transition hover:bg-danger/10"
                          aria-label="Remove item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {!locked && (
                  <button type="button" onClick={addItem} className="inline-flex items-center gap-1 pt-1 text-xs font-semibold text-navy hover:underline">
                    <Plus className="h-3.5 w-3.5" /> Add item
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-6 border-t border-border pt-4 md:flex-row">
                {/* Notes and Bank Details */}
                <div className="flex-1">
                  <label className={`${labelClass} flex items-center gap-1`}>
                    <Landmark className="h-3.5 w-3.5" /> Terms, Notes & Bank Details
                  </label>
                  <textarea rows={7} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
                </div>

                {/* Totals Breakdown */}
                <div className="w-full space-y-2 self-start rounded-lg border border-border bg-surface-alt p-4 text-xs md:w-72">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Subtotal</span>
                    <span className="font-semibold">{formatINR(subtotal)}</span>
                  </div>
                  {isInterState ? (
                    <div className="flex justify-between text-text-muted">
                      <span>IGST ({taxRate}%)</span>
                      <span>{formatINR(igst)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between text-text-muted">
                        <span>CGST ({taxRate / 2}%)</span>
                        <span>{formatINR(cgst)}</span>
                      </div>
                      <div className="flex justify-between text-text-muted">
                        <span>SGST ({taxRate / 2}%)</span>
                        <span>{formatINR(sgst)}</span>
                      </div>
                    </>
                  )}
                  <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm font-bold text-navy">
                    <span>Total</span>
                    <span>{formatINR(total)}</span>
                  </div>
                  <p className="pt-1 text-[10px] text-text-muted">Final figures are verified by the server on save.</p>
                </div>
              </div>
            </fieldset>
          </form>
        </Modal>
      )}

      {/* Confirmations */}
      {confirm?.kind === "delete" && (
        <ConfirmDialog
          title="Delete this quotation?"
          message={`Quotation ${getQuoteNumber(confirm.quote)} will be permanently removed. Its number will not be reused.`}
          confirmLabel="Delete quotation"
          tone="danger"
          loading={actionBusy}
          onConfirm={handleDelete}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "email" && (
        <ConfirmDialog
          title="Email this quotation?"
          message={`Quotation ${getQuoteNumber(confirm.quote)} will be sent as a PDF to ${emailFor(confirm.quote)}.`}
          confirmLabel="Send email"
          tone="primary"
          onConfirm={sendQuotationEmail}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "invoice" && (
        <ConfirmDialog
          title="Convert to a tax invoice?"
          message={`A new invoice will be created from quotation ${getQuoteNumber(confirm.quote)} with the next serial invoice number. The quotation will be locked.`}
          confirmLabel="Create invoice"
          tone="primary"
          loading={actionBusy}
          onConfirm={convertToInvoice}
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
          <div className="space-y-1">
            <span className="block">{toast.message}</span>
            {toast.href && (
              <a href={toast.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
                <ExternalLink className="h-3 w-3" /> {toast.hrefLabel || "Open"}
              </a>
            )}
          </div>
          <button type="button" onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}