"use client";

import { useState, useEffect } from "react";
import { 
  Building2, Save, Mail, Phone, MapPin, Globe, FileText, 
  Shield, Info, Lock, Receipt, Landmark, Bell, Sliders 
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // General & Identity Form State
  const [firmName, setFirmName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [gstin, setGstin] = useState("");
  const [pan, setPan] = useState("");

  // Billing & Bank Form State
  const [invoicePrefix, setInvoicePrefix] = useState("INV-2026-");
  const [quotationPrefix, setQuotationPrefix] = useState("QUO-2026-");
  const [defaultGstRate, setDefaultGstRate] = useState<number>(18);
  const [paymentTerms, setPaymentTerms] = useState("Due on Receipt");
  const [bankName, setBankName] = useState("");
  const [bankAccountNo, setBankAccountNo] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [upiId, setUpiId] = useState("");

  // Workflow & System Form State
  const [enableEmailAlerts, setEnableEmailAlerts] = useState(true);
  const [defaultTaskPriority, setDefaultTaskPriority] = useState("Medium");

  const supabase = createClient();

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);

    // 1. Verify User Role
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setIsAdmin(profile?.role === "admin");
    }

    // 2. Fetch Firm Settings
    const { data: settings } = await supabase
      .from("firm_settings")
      .select("*")
      .eq("id", 1)
      .single();

    if (settings) {
      setFirmName(settings.firm_name || "");
      setEmail(settings.email || "");
      setPhone(settings.phone || "");
      setWebsite(settings.website || "");
      setAddress(settings.address || "");
      setGstin(settings.gstin || "");
      setPan(settings.pan || "");
      
      setInvoicePrefix(settings.invoice_prefix || "INV-2026-");
      setQuotationPrefix(settings.quotation_prefix || "QUO-2026-");
      setDefaultGstRate(settings.default_gst_rate ?? 18);
      setPaymentTerms(settings.payment_terms || "Due on Receipt");
      setBankName(settings.bank_name || "");
      setBankAccountNo(settings.bank_account_no || "");
      setBankIfsc(settings.bank_ifsc || "");
      setUpiId(settings.upi_id || "");

      setEnableEmailAlerts(settings.enable_email_alerts ?? true);
      setDefaultTaskPriority(settings.default_task_priority || "Medium");
    }

    setLoading(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;

    setSaving(true);
    const payload = {
      firm_name: firmName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      website: website.trim(),
      address: address.trim(),
      gstin: gstin.trim(),
      pan: pan.trim(),
      invoice_prefix: invoicePrefix.trim(),
      quotation_prefix: quotationPrefix.trim(),
      default_gst_rate: Number(defaultGstRate || 0),
      payment_terms: paymentTerms,
      bank_name: bankName.trim(),
      bank_account_no: bankAccountNo.trim(),
      bank_ifsc: bankIfsc.trim().toUpperCase(),
      upi_id: upiId.trim(),
      enable_email_alerts: enableEmailAlerts,
      default_task_priority: defaultTaskPriority,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("firm_settings")
      .update(payload)
      .eq("id", 1);

    if (error) {
      alert("Error saving settings: " + error.message);
    } else {
      await logAuditEvent("UPDATE_SETTINGS", "SETTINGS", "1", payload);
      alert("Practice settings updated successfully!");
    }
    setSaving(false);
  }

  if (loading) {
    return <div className="p-8 text-center text-text-muted text-xs">Loading practice configuration...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-surface p-5 rounded-lg border border-border shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-text-main flex items-center gap-2">
            <Building2 className="h-5 w-5 text-navy" /> Firm Settings & System Defaults
          </h2>
          <p className="text-xs text-text-muted mt-1">
            Configure global firm profiles, default billing sequences, bank details, and notification rules.
          </p>
        </div>
        {!isAdmin && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded text-xs font-semibold">
            <Lock className="h-3.5 w-3.5" /> Read-Only Access
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-6 text-xs">
        
        {/* SECTION 1: General Details */}
        <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-background/50 flex items-center gap-2">
            <Info className="h-4 w-4 text-navy" />
            <h3 className="font-semibold text-sm text-text-main">General Identity & Contact</h3>
          </div>
          
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block font-semibold text-text-muted mb-1">FIRM / PRACTICE NAME *</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                <input
                  required
                  disabled={!isAdmin}
                  type="text"
                  value={firmName}
                  onChange={(e) => setFirmName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-70"
                  placeholder="e.g. Sharma & Associates"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-text-muted mb-1">OFFICIAL EMAIL</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                <input
                  disabled={!isAdmin}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-70"
                  placeholder="contact@firm.com"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-text-muted mb-1">PRIMARY PHONE</label>
              <div className="relative">
                <Phone className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                <input
                  disabled={!isAdmin}
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-70"
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-text-muted mb-1">WEBSITE</label>
              <div className="relative">
                <Globe className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                <input
                  disabled={!isAdmin}
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-70"
                  placeholder="https://www.firm.com"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-text-muted mb-1">FIRM PAN</label>
              <div className="relative">
                <FileText className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                <input
                  disabled={!isAdmin}
                  type="text"
                  value={pan}
                  onChange={(e) => setPan(e.target.value.toUpperCase())}
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-70 uppercase"
                  placeholder="ABCDE1234F"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block font-semibold text-text-muted mb-1">GSTIN</label>
              <div className="relative">
                <Shield className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                <input
                  disabled={!isAdmin}
                  type="text"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-70 uppercase"
                  placeholder="22AAAAA0000A1Z5"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block font-semibold text-text-muted mb-1">REGISTERED OFFICE ADDRESS</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-text-muted" />
                <textarea
                  disabled={!isAdmin}
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-70"
                  placeholder="Full office address..."
                />
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: Billing & Payment Defaults */}
        <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-background/50 flex items-center gap-2">
            <Receipt className="h-4 w-4 text-navy" />
            <h3 className="font-semibold text-sm text-text-main">Billing & Invoice Defaults</h3>
          </div>
          
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-text-muted mb-1">INVOICE NUMBER PREFIX</label>
              <input
                disabled={!isAdmin}
                type="text"
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value)}
                className="w-full border border-border rounded p-2 focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-70 font-mono"
                placeholder="INV-2026-"
              />
            </div>

            <div>
              <label className="block font-semibold text-text-muted mb-1">QUOTATION PREFIX</label>
              <input
                disabled={!isAdmin}
                type="text"
                value={quotationPrefix}
                onChange={(e) => setQuotationPrefix(e.target.value)}
                className="w-full border border-border rounded p-2 focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-70 font-mono"
                placeholder="QUO-2026-"
              />
            </div>

            <div>
              <label className="block font-semibold text-text-muted mb-1">DEFAULT GST RATE (%)</label>
              <input
                disabled={!isAdmin}
                type="number"
                step="0.01"
                value={defaultGstRate}
                onChange={(e) => setDefaultGstRate(Number(e.target.value))}
                className="w-full border border-border rounded p-2 focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-70 font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-text-muted mb-1">PAYMENT TERMS</label>
              <select
                disabled={!isAdmin}
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="w-full border border-border rounded p-2 bg-surface disabled:bg-background disabled:opacity-70"
              >
                <option>Due on Receipt</option>
                <option>Net 7 Days</option>
                <option>Net 15 Days</option>
                <option>Net 30 Days</option>
              </select>
            </div>
          </div>
        </div>

        {/* SECTION 3: Bank & Settlement Accounts */}
        <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-background/50 flex items-center gap-2">
            <Landmark className="h-4 w-4 text-navy" />
            <h3 className="font-semibold text-sm text-text-main">Bank Account & UPI Details (For Invoices)</h3>
          </div>
          
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-text-muted mb-1">BANK NAME</label>
              <input
                disabled={!isAdmin}
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="w-full border border-border rounded p-2 focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-70"
                placeholder="HDFC Bank / ICICI Bank"
              />
            </div>

            <div>
              <label className="block font-semibold text-text-muted mb-1">ACCOUNT NUMBER</label>
              <input
                disabled={!isAdmin}
                type="text"
                value={bankAccountNo}
                onChange={(e) => setBankAccountNo(e.target.value)}
                className="w-full border border-border rounded p-2 focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-70 font-mono"
                placeholder="50100XXXXXXX"
              />
            </div>

            <div>
              <label className="block font-semibold text-text-muted mb-1">IFSC CODE</label>
              <input
                disabled={!isAdmin}
                type="text"
                value={bankIfsc}
                onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                className="w-full border border-border rounded p-2 focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-70 uppercase font-mono"
                placeholder="HDFC0001234"
              />
            </div>

            <div>
              <label className="block font-semibold text-text-muted mb-1">UPI ID / VPA</label>
              <input
                disabled={!isAdmin}
                type="text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                className="w-full border border-border rounded p-2 focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-70"
                placeholder="firmname@okicici"
              />
            </div>
          </div>
        </div>

        {/* SECTION 4: Workflow & Notification Rules */}
        <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-background/50 flex items-center gap-2">
            <Sliders className="h-4 w-4 text-navy" />
            <h3 className="font-semibold text-sm text-text-main">Workflow & Notification Engine</h3>
          </div>
          
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between p-3 bg-background border border-border rounded-md">
              <div className="space-y-0.5">
                <p className="font-semibold text-text-main flex items-center gap-1.5">
                  <Bell className="h-4 w-4 text-navy" /> Automated Workflow Email Alerts
                </p>
                <p className="text-text-muted text-[11px]">
                  Send automatic notifications to clients and staff upon task creation, re-assignment, and stage completion.
                </p>
              </div>
              <input
                disabled={!isAdmin}
                type="checkbox"
                checked={enableEmailAlerts}
                onChange={(e) => setEnableEmailAlerts(e.target.checked)}
                className="h-4 w-4 accent-navy cursor-pointer disabled:opacity-50"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block font-semibold text-text-muted mb-1">DEFAULT TASK PRIORITY</label>
                <select
                  disabled={!isAdmin}
                  value={defaultTaskPriority}
                  onChange={(e) => setDefaultTaskPriority(e.target.value)}
                  className="w-full border border-border rounded p-2 bg-surface disabled:bg-background disabled:opacity-70"
                >
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Action Footer */}
        {isAdmin && (
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-navy text-white rounded-md font-bold text-xs hover:bg-navy/90 transition disabled:opacity-70"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving Configuration..." : "Save All Practice Settings"}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}