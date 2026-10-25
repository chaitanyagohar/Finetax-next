"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  Building2,
  Save,
  Mail,
  Phone,
  MapPin,
  Globe,
  FileText,
  Shield,
  Info,
  Lock,
  Receipt,
  Landmark,
  Bell,
  Sliders,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  QrCode,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal } from "@/components/ui/Modal";
import PasswordInput from "@/components/ui/PasswordInput";
import { localISODate } from "@/lib/format";

type Settings = {
  firm_name: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  gstin: string;
  pan: string;
  invoice_prefix: string;
  quotation_prefix: string;
  default_gst_rate: number;
  payment_terms: string;
  bank_name: string;
  bank_account_no: string;
  bank_ifsc: string;
  upi_id: string;
  enable_email_alerts: boolean;
  default_task_priority: string;
};

const EMPTY: Settings = {
  firm_name: "",
  email: "",
  phone: "",
  website: "",
  address: "",
  gstin: "",
  pan: "",
  invoice_prefix: "INV/{FY}/",
  quotation_prefix: "QUO/{YYYY}/",
  default_gst_rate: 18,
  payment_terms: "Due on Receipt",
  bank_name: "",
  bank_account_no: "",
  bank_ifsc: "",
  upi_id: "",
  enable_email_alerts: true,
  default_task_priority: "Medium",
};

const SENSITIVE: (keyof Settings)[] = ["bank_name", "bank_account_no", "bank_ifsc", "upi_id"];
const GST_RATES = [0, 5, 12, 18, 28];
const PAYMENT_TERMS = ["Due on Receipt", "Net 7 Days", "Net 15 Days", "Net 30 Days", "Net 45 Days", "Net 60 Days"];
const PREFIX_TOKENS = [
  { token: "{FY}", hint: "Financial year, e.g. 2026-27" },
  { token: "{YYYY}", hint: "Year, e.g. 2026" },
  { token: "{YY}", hint: "Short year, e.g. 26" },
];

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[\w.\-]{2,256}@[A-Za-z]{2,64}$/;
const PREFIX_RE = /^[A-Za-z0-9/_\-{}]{1,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar",
  "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman & Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15 disabled:bg-surface-alt disabled:text-text-muted";
const iconInputClass = `${inputClass} pl-9`;
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

/** Mirrors public.resolve_doc_prefix() in the database. */
function resolvePrefix(prefix: string, iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const fyStart = m >= 4 ? y : y - 1;
  return prefix
    .replace(/\{FY\}/g, `${fyStart}-${String(fyStart + 1).slice(-2)}`)
    .replace(/\{YYYY\}/g, String(y))
    .replace(/\{YY\}/g, String(y).slice(-2));
}

function normalise(s: Settings): Settings {
  return {
    ...s,
    gstin: s.gstin.trim().toUpperCase(),
    pan: s.pan.trim().toUpperCase(),
    bank_ifsc: s.bank_ifsc.trim().toUpperCase(),
    bank_account_no: s.bank_account_no.replace(/\s/g, ""),
  };
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-[10px] font-medium text-rose-600">{message}</p>;
}

function Section({ icon: Icon, title, subtitle, children }: { icon: any; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-start gap-2 border-b border-border bg-surface-alt px-5 py-4">
        <Icon className="mt-0.5 h-4 w-4 text-navy" />
        <div>
          <h3 className="text-sm font-semibold text-text-main">{title}</h3>
          {subtitle && <p className="text-[11px] text-text-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const currentUser = useCurrentUser();
  const isAdmin = !!currentUser?.isAdmin;
  const [supabase] = useState(() => createClient());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Settings>(EMPTY);
  const [original, setOriginal] = useState<Settings>(EMPTY);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  const today = localISODate();

  useEffect(() => {
    loadSettings();
  }, []);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 5000);
  }

  async function loadSettings() {
    setLoading(true);
    const { data: settings, error } = await supabase.from("firm_settings").select("*").maybeSingle();
    if (error) showToast("error", "Could not load firm settings.");
    if (settings) {
      const loaded: Settings = {
        firm_name: settings.firm_name || "",
        email: settings.email || "",
        phone: settings.phone || "",
        website: settings.website || "",
        address: settings.address || "",
        gstin: settings.gstin || "",
        pan: settings.pan || "",
        invoice_prefix: settings.invoice_prefix || EMPTY.invoice_prefix,
        quotation_prefix: settings.quotation_prefix || EMPTY.quotation_prefix,
        default_gst_rate: Number(settings.default_gst_rate ?? 18),
        payment_terms: settings.payment_terms || "Due on Receipt",
        bank_name: settings.bank_name || "",
        bank_account_no: settings.bank_account_no || "",
        bank_ifsc: settings.bank_ifsc || "",
        upi_id: settings.upi_id || "",
        enable_email_alerts: settings.enable_email_alerts ?? true,
        default_task_priority: settings.default_task_priority || "Medium",
      };
      setForm(loaded);
      setOriginal(loaded);
      setLastUpdated(settings.updated_at || null);
    }
    setLoading(false);
  }

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const dirty = JSON.stringify(normalise(form)) !== JSON.stringify(normalise(original));
  const sensitiveChanged = SENSITIVE.some((k) => String(normalise(form)[k]).trim() !== String(normalise(original)[k]).trim());

  // Warn before leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  /* ---------------- Validation ---------------- */

  const errors = useMemo(() => {
    const n = normalise(form);
    const e: Partial<Record<keyof Settings, string>> = {};
    if (!n.firm_name.trim()) e.firm_name = "Firm name is required";
    if (n.email && !EMAIL_RE.test(n.email.trim())) e.email = "Enter a valid email";
    if (n.gstin && !GSTIN_RE.test(n.gstin)) e.gstin = "15 characters, e.g. 07ABCDE1234F1Z5";
    if (n.pan && !PAN_RE.test(n.pan)) e.pan = "Format: ABCDE1234F";
    if (n.gstin && n.pan && GSTIN_RE.test(n.gstin) && PAN_RE.test(n.pan) && n.gstin.slice(2, 12) !== n.pan) e.gstin = "This GSTIN belongs to a different PAN";
    if (n.bank_ifsc && !IFSC_RE.test(n.bank_ifsc)) e.bank_ifsc = "Format: HDFC0001234";
    if (n.bank_account_no && !/^[0-9]{9,18}$/.test(n.bank_account_no)) e.bank_account_no = "9 to 18 digits";
    if (n.upi_id && !UPI_RE.test(n.upi_id.trim())) e.upi_id = "Format: name@bank";
    if (!n.invoice_prefix.trim() || !PREFIX_RE.test(n.invoice_prefix.trim())) e.invoice_prefix = "Use letters, numbers, / - _ and tokens";
    if (n.quotation_prefix && !PREFIX_RE.test(n.quotation_prefix.trim())) e.quotation_prefix = "Use letters, numbers, / - _ and tokens";
    if (!(n.default_gst_rate >= 0 && n.default_gst_rate <= 100)) e.default_gst_rate = "Between 0 and 100";
    return e;
  }, [form]);

  const hasErrors = Object.keys(errors).length > 0;

  /* ---------------- Derived helpers ---------------- */

  const firmState = GSTIN_RE.test(form.gstin.toUpperCase()) ? GST_STATE_CODES[form.gstin.slice(0, 2)] : "";
  const invoiceExample = `${resolvePrefix(form.invoice_prefix.trim(), today)}0001`;
  const quotationExample = `${resolvePrefix(form.quotation_prefix.trim(), today)}001`;
  const invoiceTooLong = invoiceExample.length > 16;
  const prefixChanged =
    form.invoice_prefix.trim() !== original.invoice_prefix.trim() || form.quotation_prefix.trim() !== original.quotation_prefix.trim();

  // UPI QR preview
  useEffect(() => {
    const upi = form.upi_id.trim();
    if (!UPI_RE.test(upi)) {
      setQrDataUrl("");
      return;
    }
    const uri = `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(form.firm_name.trim() || "Firm")}&cu=INR`;
    QRCode.toDataURL(uri, { margin: 1, width: 180 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [form.upi_id, form.firm_name]);

  function handleGstinChange(value: string) {
    const v = value.toUpperCase().replace(/\s/g, "");
    set("gstin", v);
    if (GSTIN_RE.test(v) && !form.pan.trim()) set("pan", v.slice(2, 12));
  }

  function appendToken(field: "invoice_prefix" | "quotation_prefix", token: string) {
    set(field, `${form[field]}${token}`);
  }

  /* ---------------- Save ---------------- */

  async function submit(password: string | null) {
    setSaving(true);
    setConfirmError("");
    try {
      const res = await fetch("/api/admin/firm-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: normalise(form), adminPassword: password || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (password !== null) setConfirmError(data.error || "Could not save the settings.");
        else setFormError(data.error || "Could not save the settings.");
        return;
      }

      setConfirmOpen(false);
      setAdminPassword("");
      const changedCount = Array.isArray(data.changed) ? data.changed.length : 0;
      showToast(
        "success",
        changedCount === 0
          ? "No changes to save."
          : `Settings saved (${changedCount} field${changedCount === 1 ? "" : "s"}).${sensitiveChanged ? " Other administrators have been alerted to the bank detail change." : ""}`
      );
      loadSettings();
    } catch {
      const msg = "A network error occurred. Please try again.";
      if (password !== null) setConfirmError(msg);
      else setFormError(msg);
    } finally {
      setSaving(false);
    }
  }

  function handleSave(e?: React.FormEvent) {
    e?.preventDefault();
    if (!isAdmin || saving) return;
    setFormError("");
    if (hasErrors) {
      setFormError("Please fix the highlighted fields before saving.");
      return;
    }
    if (sensitiveChanged) {
      setAdminPassword("");
      setConfirmError("");
      setConfirmOpen(true);
      return;
    }
    submit(null);
  }

  function discardChanges() {
    setForm(original);
    setFormError("");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-xs text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading practice configuration...
      </div>
    );
  }

  const disabled = !isAdmin;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <Building2 className="h-5 w-5 text-navy" /> Firm Settings & System Defaults
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Firm identity, GST registration, document numbering and the bank details printed on every invoice.
            {lastUpdated && ` Last updated ${new Date(lastUpdated).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`}
          </p>
        </div>
        {!isAdmin && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700">
            <Lock className="h-3.5 w-3.5" /> Read-Only Access
          </div>
        )}
      </div>

      {formError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs font-medium text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6 text-xs">
        {/* SECTION 1: General Details */}
        <Section icon={Info} title="General Identity & Contact" subtitle="Printed on quotations, invoices and outgoing emails.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className={labelClass}>Firm / Practice Name *</label>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input disabled={disabled} type="text" value={form.firm_name} onChange={(e) => set("firm_name", e.target.value)} className={iconInputClass} placeholder="e.g. Sharma & Associates" />
              </div>
              <FieldError message={errors.firm_name} />
            </div>

            <div>
              <label className={labelClass}>Official Email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input disabled={disabled} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={iconInputClass} placeholder="contact@firm.com" />
              </div>
              <FieldError message={errors.email} />
            </div>

            <div>
              <label className={labelClass}>Primary Phone</label>
              <div className="relative">
                <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input disabled={disabled} type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className={iconInputClass} placeholder="+91 98765 43210" />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className={labelClass}>Website</label>
              <div className="relative">
                <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input disabled={disabled} type="url" value={form.website} onChange={(e) => set("website", e.target.value)} className={iconInputClass} placeholder="https://www.firm.com" />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className={labelClass}>Registered Office Address</label>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-text-muted" />
                <textarea disabled={disabled} rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} className={iconInputClass} placeholder="Full office address..." />
              </div>
            </div>
          </div>
        </Section>

        {/* SECTION 2: Tax Registration */}
        <Section icon={Shield} title="Tax Registration" subtitle="Your GSTIN decides whether invoices use CGST + SGST or IGST.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>GSTIN</label>
              <div className="relative">
                <Shield className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  disabled={disabled}
                  type="text"
                  maxLength={15}
                  value={form.gstin}
                  onChange={(e) => handleGstinChange(e.target.value)}
                  className={`${iconInputClass} pr-8 font-mono uppercase ${errors.gstin ? "border-rose-300" : ""}`}
                  placeholder="07ABCDE1234F1Z5"
                />
                {form.gstin && !errors.gstin && <CheckCircle2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />}
              </div>
              <FieldError message={errors.gstin} />
              {firmState && !errors.gstin && (
                <p className="mt-1 text-[10px] text-text-muted">
                  Registered in <span className="font-semibold text-text-main">{firmState}</span>. Clients in other states are billed IGST automatically.
                </p>
              )}
            </div>

            <div>
              <label className={labelClass}>Firm PAN</label>
              <div className="relative">
                <FileText className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  disabled={disabled}
                  type="text"
                  maxLength={10}
                  value={form.pan}
                  onChange={(e) => set("pan", e.target.value.toUpperCase().replace(/\s/g, ""))}
                  className={`${iconInputClass} pr-8 font-mono uppercase ${errors.pan ? "border-rose-300" : ""}`}
                  placeholder="ABCDE1234F"
                />
                {form.pan && !errors.pan && <CheckCircle2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />}
              </div>
              <FieldError message={errors.pan} />
            </div>
          </div>
        </Section>

        {/* SECTION 3: Numbering & Billing */}
        <Section icon={Receipt} title="Document Numbering & Billing Defaults" subtitle="Numbers are assigned serially by the database. Each prefix has its own series.">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {(
              [
                { key: "invoice_prefix", label: "Invoice Number Prefix *", example: invoiceExample },
                { key: "quotation_prefix", label: "Quotation Prefix", example: quotationExample },
              ] as const
            ).map((p) => (
              <div key={p.key}>
                <label className={labelClass}>{p.label}</label>
                <input
                  disabled={disabled}
                  type="text"
                  maxLength={20}
                  value={form[p.key]}
                  onChange={(e) => set(p.key, e.target.value.replace(/\s/g, ""))}
                  className={`${inputClass} font-mono ${errors[p.key] ? "border-rose-300" : ""}`}
                />
                <FieldError message={errors[p.key]} />
                {!disabled && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {PREFIX_TOKENS.map((t) => (
                      <button
                        key={t.token}
                        type="button"
                        title={t.hint}
                        onClick={() => appendToken(p.key, t.token)}
                        className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] font-semibold text-navy transition hover:bg-surface-alt"
                      >
                        + {t.token}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1.5 text-[11px] text-text-muted">
                  Example: <span className="font-mono font-semibold text-text-main">{p.example}</span>
                </p>
                {p.key === "invoice_prefix" && invoiceTooLong && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-amber-700">
                    <AlertTriangle className="h-3 w-3" /> GST invoice numbers must be at most 16 characters ({invoiceExample.length} here).
                  </p>
                )}
              </div>
            ))}

            {prefixChanged && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 md:col-span-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Changing a prefix starts a <strong>new number series</strong> from 001/0001. Existing documents keep their numbers. For GST, change the invoice prefix only at the start of a financial year.
                </span>
              </div>
            )}

            <div>
              <label className={labelClass}>Default GST Rate (%)</label>
              <select disabled={disabled} value={String(form.default_gst_rate)} onChange={(e) => set("default_gst_rate", Number(e.target.value))} className={inputClass}>
                {(GST_RATES.includes(form.default_gst_rate) ? GST_RATES : [form.default_gst_rate, ...GST_RATES]).map((r) => (
                  <option key={r} value={r}>{r}%</option>
                ))}
              </select>
              <FieldError message={errors.default_gst_rate} />
            </div>

            <div>
              <label className={labelClass}>Payment Terms</label>
              <select disabled={disabled} value={form.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} className={inputClass}>
                {(PAYMENT_TERMS.includes(form.payment_terms) ? PAYMENT_TERMS : [form.payment_terms, ...PAYMENT_TERMS]).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-text-muted">Sets the default due date on new invoices.</p>
            </div>
          </div>
        </Section>

        {/* SECTION 4: Bank & UPI */}
        <Section icon={Landmark} title="Bank Account & UPI Details" subtitle="Printed on every quotation and invoice. Changes require your password and alert other admins.">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:col-span-2">
              <div>
                <label className={labelClass}>Bank Name</label>
                <input disabled={disabled} type="text" value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} className={inputClass} placeholder="HDFC Bank" />
              </div>
              <div>
                <label className={labelClass}>Account Number</label>
                <input
                  disabled={disabled}
                  type="text"
                  inputMode="numeric"
                  value={form.bank_account_no}
                  onChange={(e) => set("bank_account_no", e.target.value.replace(/[^\d\s]/g, ""))}
                  className={`${inputClass} font-mono ${errors.bank_account_no ? "border-rose-300" : ""}`}
                  placeholder="50100XXXXXXXXX"
                />
                <FieldError message={errors.bank_account_no} />
              </div>
              <div>
                <label className={labelClass}>IFSC Code</label>
                <input
                  disabled={disabled}
                  type="text"
                  maxLength={11}
                  value={form.bank_ifsc}
                  onChange={(e) => set("bank_ifsc", e.target.value.toUpperCase().replace(/\s/g, ""))}
                  className={`${inputClass} font-mono uppercase ${errors.bank_ifsc ? "border-rose-300" : ""}`}
                  placeholder="HDFC0001234"
                />
                <FieldError message={errors.bank_ifsc} />
              </div>
              <div>
                <label className={labelClass}>UPI ID / VPA</label>
                <input
                  disabled={disabled}
                  type="text"
                  value={form.upi_id}
                  onChange={(e) => set("upi_id", e.target.value.trim())}
                  className={`${inputClass} ${errors.upi_id ? "border-rose-300" : ""}`}
                  placeholder="firmname@okicici"
                />
                <FieldError message={errors.upi_id} />
              </div>
              {sensitiveChanged && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 sm:col-span-2">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>You are changing payment details. You will be asked for your password, and the other administrators will be notified by email.</span>
                </div>
              )}
            </div>

            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-4 text-center">
              {qrDataUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt="UPI payment QR code preview" className="h-36 w-36" />
                  <p className="mt-2 text-[11px] font-semibold text-text-main">Scan to verify</p>
                  <p className="text-[10px] text-text-muted">Your UPI app should show {form.firm_name || "your firm"} as the payee.</p>
                </>
              ) : (
                <>
                  <QrCode className="h-10 w-10 text-text-muted" />
                  <p className="mt-2 text-[11px] text-text-muted">Enter a valid UPI ID to preview the payment QR code.</p>
                </>
              )}
            </div>
          </div>
        </Section>

        {/* SECTION 5: Workflow Defaults */}
        <Section icon={Sliders} title="Workflow & Notification Defaults">
          <div className="space-y-4">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-surface-alt p-3">
              <div>
                <p className="flex items-center gap-1.5 font-semibold text-text-main">
                  <Bell className="h-4 w-4 text-navy" /> Automated Workflow Email Alerts
                </p>
                <p className="text-[11px] text-text-muted">
                  Notifications to staff and clients on task assignment, review and completion. Saved now; it will be applied across modules in the next update.
                </p>
              </div>
              <input
                disabled={disabled}
                type="checkbox"
                checked={form.enable_email_alerts}
                onChange={(e) => set("enable_email_alerts", e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-navy disabled:opacity-50"
              />
            </label>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass}>Default Task Priority</label>
                <select disabled={disabled} value={form.default_task_priority} onChange={(e) => set("default_task_priority", e.target.value)} className={inputClass}>
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                </select>
                <p className="mt-1 text-[10px] text-text-muted">Will pre-fill new tasks in the next update.</p>
              </div>
            </div>
          </div>
        </Section>
      </form>

      {/* Sticky unsaved-changes bar */}
      {isAdmin && dirty && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-text-main">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" /> You have unsaved changes
              {hasErrors && <span className="font-medium text-rose-600">· fix highlighted fields</span>}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={discardChanges} disabled={saving} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Discard
              </button>
              <button
                type="button"
                onClick={() => handleSave()}
                disabled={saving || hasErrors}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Re-authentication for bank detail changes */}
      {confirmOpen && (
        <Modal
          title="Confirm payment detail change"
          subtitle="Bank and UPI details are printed on every invoice. Please confirm it's really you."
          onClose={() => !saving && setConfirmOpen(false)}
          maxWidth="max-w-md"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={saving} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => submit(adminPassword)}
                disabled={saving || !adminPassword}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Confirm & Save
              </button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            <div className="space-y-1 rounded-lg border border-border bg-surface-alt p-3">
              {SENSITIVE.filter((k) => String(normalise(form)[k]).trim() !== String(normalise(original)[k]).trim()).map((k) => (
                <p key={k}>
                  <span className="font-semibold capitalize text-text-main">{k.replace(/_/g, " ")}:</span>{" "}
                  <span className="text-text-muted line-through">{String(original[k]) || "(empty)"}</span> →{" "}
                  <span className="font-semibold text-navy">{String(normalise(form)[k]) || "(empty)"}</span>
                </p>
              ))}
            </div>
            <PasswordInput label="Your Password" value={adminPassword} onChange={setAdminPassword} autoComplete="current-password" autoFocus />
            {confirmError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 font-medium text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{confirmError}</span>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-20 right-5 z-[70] flex max-w-sm items-start gap-2 rounded-lg border px-4 py-3 text-xs font-semibold shadow-lg animate-scale-in ${
            toast.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {toast.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}