"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Trash2, X, FileText, Download, Mail, Loader2, Landmark } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Client } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";

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

export default function QuotationsPage() {
  function getStatusBadgeClass(status: string) {
    switch (status) {
      case "Converted":
        return "bg-purple-100 text-purple-700 border-purple-200";
      case "Sent":
        return "bg-blue-100 text-blue-700 border-blue-200";
      case "Accepted":
        return "bg-emerald-100 text-emerald-700 border-emerald-200";
      case "Rejected":
        return "bg-rose-100 text-rose-700 border-rose-200";
      default: // Draft
        return "bg-amber-100 text-amber-700 border-amber-200";
    }
  }

  const [quotations, setQuotations] = useState<any[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [firmSettings, setFirmSettings] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState<any | null>(null);

  // Form State
  const [targetType, setTargetType] = useState<"client" | "lead">("client");
  const [clientId, setClientId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [address, setAddress] = useState("");
  const [quotationDate, setQuotationDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [validUntil, setValidUntil] = useState("");
  const [isInterState, setIsInterState] = useState(false);
  const [gstRate, setGstRate] = useState<number>(18);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("Draft");

  // Dynamic Line Items
  const [items, setItems] = useState<
    { description: string; qty: number; rate: number }[]
  >([{ description: "", qty: 1, rate: 0 }]);

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [
      { data: qData }, 
      { data: cData }, 
      { data: lData },
      { data: settingsData }
    ] = await Promise.all([
      supabase
        .from("quotations")
        .select("*, clients(name, email, phone, organization_name, address), leads(name, email, phone, organization_name, company)")
        .order("created_at", { ascending: false }),
      supabase.from("clients").select("*").order("name", { ascending: true }),
      supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("firm_settings").select("*").eq("id", 1).single()
    ]);

    if (qData) setQuotations(qData);
    if (cData) setClients(cData);
    if (lData) setLeads(lData);
    if (settingsData) setFirmSettings(settingsData);
    setLoading(false);
  }

  function openModal(q?: any) {
    if (q) {
      setEditingQuotation(q);
      setTargetType(q.lead_id ? "lead" : "client");
      setClientId(q.client_id || "");
      setLeadId(q.lead_id || "");
      setRecipientName(q.recipient_name || q.clients?.name || q.leads?.name || "");
      setRecipientEmail(q.recipient_email || q.clients?.email || q.leads?.email || "");
      setRecipientPhone(q.recipient_phone || q.clients?.phone || q.leads?.phone || "");
      setOrganisation(q.organisation || q.clients?.organization_name || q.leads?.organization_name || q.leads?.company || "");
      setAddress(q.address || q.clients?.address || "");
      setQuotationDate(q.date || new Date().toISOString().slice(0, 10));
      setValidUntil(q.valid_until || "");
      setIsInterState(Boolean(q.is_inter_state));
      setGstRate(Number(q.gst_rate || 18));
      setNotes(q.notes || "");
      setStatus(q.status || "Draft");
      setItems(
        q.items && q.items.length
          ? q.items
          : [{ description: "", qty: 1, rate: 0 }],
      );
    } else {
      setEditingQuotation(null);
      resetForm();
    }
    setIsModalOpen(true);
  }

  function closeModal() {
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
    setQuotationDate(new Date().toISOString().slice(0, 10));
    setValidUntil("");
    setIsInterState(false);
    setGstRate(firmSettings?.default_gst_rate ?? 18);
    setStatus("Draft");
    setItems([{ description: "", qty: 1, rate: 0 }]);

    const defaultNotes = `Advance Payment Required for Mobilization of Work.\n\nBank Details:\nBank: ${firmSettings?.bank_name || 'N/A'}\nA/C: ${firmSettings?.bank_account_no || 'N/A'}\nIFSC: ${firmSettings?.bank_ifsc || 'N/A'}\nUPI: ${firmSettings?.upi_id || 'N/A'}`;
    setNotes(defaultNotes);
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
    const c = clients.find((client) => String(client.id) === id);
    if (c) {
      setRecipientName(c.name || "");
      setRecipientEmail(c.email || "");
      setRecipientPhone(c.phone || "");
      setOrganisation((c as any).organization_name || "");
      setAddress((c as any).address || "");
    } else {
      setRecipientName("");
      setRecipientEmail("");
      setRecipientPhone("");
      setOrganisation("");
      setAddress("");
    }
  }

  function handleLeadChange(id: string) {
    setLeadId(id);
    const l = leads.find((lead) => String(lead.id) === id);
    if (l) {
      setRecipientName(l.name || "");
      setRecipientEmail(l.email || "");
      setRecipientPhone(l.phone || "");
      setOrganisation(l.organization_name || l.company || "");
      setAddress("");
    } else {
      setRecipientName("");
      setRecipientEmail("");
      setRecipientPhone("");
      setOrganisation("");
      setAddress("");
    }
  }

  function addItem() {
    setItems([...items, { description: "", qty: 1, rate: 0 }]);
  }

  function removeItem(index: number) {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
  }

  function handleServiceSelect(index: number, description: string) {
    const service = MASTER_SERVICES.find(s => s.description === description);
    const updated = [...items];
    updated[index] = { 
      description: description, 
      qty: updated[index].qty || 1, 
      rate: service ? service.defaultRate : updated[index].rate 
    };
    setItems(updated);
  }

  function updateItem(index: number, field: string, value: any) {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  }

  // Financial Calculations
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.qty || 1) * Number(item.rate || 0),
    0,
  );
  const taxRate = Number(gstRate || 0);
  let cgst = 0,
    sgst = 0,
    igst = 0;

  if (taxRate > 0) {
    if (isInterState) {
      igst = Number(((subtotal * taxRate) / 100).toFixed(2));
    } else {
      cgst = Number(((subtotal * taxRate) / 200).toFixed(2));
      sgst = Number(((subtotal * taxRate) / 200).toFixed(2));
    }
  }

  const total = Number((subtotal + cgst + sgst + igst).toFixed(2));

  async function generateNextQuoteNumber() {
    const year = new Date().getFullYear();
    const { data } = await supabase
      .from("quotations")
      .select("quote_number")
      .ilike("quote_number", `QUO/${year}/%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (data && data.quote_number) {
      const parts = data.quote_number.split("/");
      const lastNum = parseInt(parts[2], 10);
      if (!isNaN(lastNum)) {
        return `QUO/${year}/${String(lastNum + 1).padStart(3, "0")}`;
      }
    }
    return `QUO/${year}/001`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (targetType === "client" && !clientId) return alert("Please select a client.");
    if (targetType === "lead" && !leadId) return alert("Please select a lead/enquiry.");
    if (items.some((i) => !i.description.trim())) return alert("All line items require a description.");

    const payload: any = {
      date: quotationDate || new Date().toISOString().slice(0, 10),
      valid_until: validUntil || null,
      items,
      is_inter_state: isInterState,
      gst_rate: taxRate,
      subtotal,
      cgst,
      sgst,
      igst,
      total,
      notes: notes || "",
      organisation: organisation || "",
      address: address || "",
      status: status || "Draft",
      recipient_name: recipientName || "",
      recipient_email: recipientEmail || "",
      recipient_phone: recipientPhone || "",
    };

    if (targetType === "lead") {
      payload.lead_id = leadId;
      payload.client_id = null;
    } else {
      payload.client_id = clientId;
      payload.lead_id = null;
    }

    try {
      if (editingQuotation) {
        const { error } = await supabase
          .from("quotations")
          .update(payload)
          .eq("id", editingQuotation.id);

        if (error) throw error;
        logAuditEvent("UPDATE_QUOTATION", "QUOTATIONS", editingQuotation.id);
      } else {
        payload.quote_number = await generateNextQuoteNumber();
        payload.created_at = new Date().toISOString();

        const { data, error } = await supabase
          .from("quotations")
          .insert([payload])
          .select()
          .single();

        if (error) throw error;
        logAuditEvent("CREATE_QUOTATION", "QUOTATIONS", data.id);
      }

      closeModal();
      loadData();
    } catch (err: any) {
      console.error("Save Quotation Error:", err);
      alert("Error saving quotation: " + (err.message || "Unknown error"));
    }
  }

  async function handleDelete() {
    if (!editingQuotation || !confirm("Delete this quotation?")) return;
    const { error } = await supabase
      .from("quotations")
      .delete()
      .eq("id", editingQuotation.id);
    if (!error) {
      logAuditEvent("DELETE_QUOTATION", "QUOTATIONS", editingQuotation.id);
      closeModal();
      loadData();
    } else alert("Error deleting quotation: " + error.message);
  }

  async function sendQuotationEmail(q: any, e: React.MouseEvent) {
    e.stopPropagation();

    const recipientEmail = q.recipient_email || q.clients?.email || q.leads?.email;

    if (!recipientEmail) {
      alert("No email address associated with this quotation.");
      return;
    }

    if (!confirm(`Send Quotation ${q.quote_number || q.id} to ${recipientEmail}?`)) return;

    setSendingId(q.id);

    try {
      const res = await fetch("/api/quotations/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotationId: q.id,
          recipientEmail,
        }),
      });

      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const rawText = await res.text();
        console.error("Non-JSON Response from Server:", rawText);
        throw new Error(`Server returned status ${res.status} (${res.statusText}). Check Vercel server logs.`);
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send email");

      setQuotations((prev) =>
        prev.map((item) =>
          item.id === q.id
            ? { ...item, status: "Sent", email_sent_at: new Date().toISOString() }
            : item
        )
      );

      alert("Quotation email dispatched successfully!");
    } catch (err: any) {
      console.error("Send Email Error:", err);
      alert("Failed to send quotation email: " + (err.message || "Unknown error"));
    } finally {
      setSendingId(null);
    }
  }

  const filteredQuotations = quotations.filter((q: any) => {
    const nameStr = q.recipient_name || q.clients?.name || q.leads?.name || q.organisation || "";
    const matchesSearch = [q.quote_number, nameStr, q.notes]
      .filter(Boolean)
      .some((f) => f.toLowerCase().includes(search.toLowerCase()));
    return matchesSearch;
  });

  async function convertToInvoice(quotation: any, e: React.MouseEvent) {
    e.stopPropagation();

    if (!quotation.client_id) {
      alert(
        "Quotations created for Enquiries/Leads must first be converted to an active Client in the Leads tab before generating an invoice.",
      );
      return;
    }

    if (
      !confirm(
        `Convert Quotation ${quotation.quote_number || ""} to a Tax Invoice?`,
      )
    )
      return;

    try {
      const payload = {
        client_id: quotation.client_id,
        date: new Date().toISOString().slice(0, 10),
        due_date: quotation.valid_until || new Date().toISOString().slice(0, 10),
        items: quotation.items || [],
        is_inter_state: quotation.is_inter_state || false,
        gst_rate: quotation.gst_rate || 18,
        subtotal: quotation.subtotal || 0,
        cgst: quotation.cgst || 0,
        sgst: quotation.sgst || 0,
        igst: quotation.igst || 0,
        total: quotation.total || 0,
        notes: quotation.notes || "",
        organisation: quotation.organisation || "",
        status: "Draft",
      };

      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to generate invoice");
      }

      const newInvoice = data;

      await supabase
        .from("quotations")
        .update({ status: "Converted" })
        .eq("id", quotation.id);

      logAuditEvent("CONVERT_QUOTATION_TO_INVOICE", "QUOTATIONS", quotation.id);

      alert(`Invoice ${newInvoice.invoice_number} created successfully!`);
      loadData();

      window.open(newInvoice.pdf_url || `/invoices/${newInvoice.id}/pdf`, "_self");
    } catch (err: any) {
      console.error("Conversion Error:", err);
      alert("Failed to convert quotation: " + (err.message || "Unknown error"));
    }
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-surface p-4 rounded-lg border border-border shadow-sm">
        <div className="relative w-full sm:w-60">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search quotations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-border rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-navy"
          />
        </div>

        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 bg-navy text-white px-4 py-2 rounded-md font-medium text-xs hover:bg-navy/90 transition"
        >
          <Plus className="h-4 w-4" /> New Quotation
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted text-xs">
            Loading quotations...
          </div>
        ) : filteredQuotations.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs">
            No quotations created yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-text-muted bg-background/50">
                  <th className="p-3">Quote #</th>
                  <th className="p-3">Created At</th>
                  <th className="p-3">Quotation Date</th>
                  <th className="p-3">Client / Recipient</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredQuotations.map((q: any) => (
                  <tr
                    key={q.id}
                    className="hover:bg-background/50 transition cursor-pointer"
                    onClick={() => openModal(q)}
                  >
                    <td className="p-3 font-bold text-navy whitespace-nowrap">
                      {q.quote_number || q.quotation_number || "-"}
                    </td>
                    <td className="p-3 text-text-muted whitespace-nowrap">
                      {q.created_at
                        ? new Date(q.created_at).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : "-"}
                    </td>
                    <td className="p-3 whitespace-nowrap">{q.date}</td>
                    <td className="p-3 font-medium text-text-main">
                      {q.recipient_name || q.clients?.name || q.leads?.name || q.organisation || "-"}
                      {q.organisation && <div className="text-[10px] text-text-muted">{q.organisation}</div>}
                    </td>
                    <td className="p-3 font-semibold text-text-main">
                      ₹{Number(q.total || 0).toLocaleString("en-IN")}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col gap-1 items-start">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${getStatusBadgeClass(
                            q.status,
                          )}`}
                        >
                          {q.status || "Draft"}
                        </span>

                        {q.email_sent_at ? (
                          <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                            ✓ Email Sent
                          </span>
                        ) : (
                          <span className="text-[10px] text-text-muted">Not emailed</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap space-x-2">
                      <button
                        onClick={(e) => sendQuotationEmail(q, e)}
                        disabled={sendingId === q.id}
                        className={`px-2.5 py-1 border rounded font-semibold inline-flex items-center gap-1 text-[11px] transition ${
                          q.email_sent_at
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "border-border hover:bg-background"
                        }`}
                        title={
                          q.email_sent_at
                            ? `Resend Quotation Email (Last sent ${new Date(
                                q.email_sent_at,
                              ).toLocaleDateString()})`
                            : "Send Quotation via Email"
                        }
                      >
                        {sendingId === q.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Mail className="h-3 w-3" />
                        )}
                        {q.email_sent_at ? "Resend Email" : "Email"}
                      </button>

                      {q.status !== "Converted" && q.client_id && (
                        <button
                          onClick={(e) => convertToInvoice(q, e)}
                          className="px-2.5 py-1 bg-navy text-white rounded text-[11px] font-semibold hover:bg-navy/90 transition"
                        >
                          + Invoice
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(`/quotations/${q.id}/pdf`, "_self");
                        }}
                        className="px-2.5 py-1 border border-border rounded hover:bg-background font-semibold text-[11px]"
                      >
                        PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Form Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-surface rounded-lg border border-border w-full max-w-4xl p-6 space-y-4 shadow-lg text-xs my-8">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-semibold text-base text-text-main">
                {editingQuotation ? "Edit Quotation" : "New Quotation"}
              </h3>
              <button
                onClick={closeModal}
                className="text-text-muted hover:text-text-main"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Recipient Selection */}
              <div className="space-y-2 bg-navy/5 p-3 rounded border border-navy/20">
                <label className="block font-bold text-navy">
                  PREPARE QUOTATION FOR
                </label>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                    <input
                      type="radio"
                      name="targetType"
                      checked={targetType === "client"}
                      onChange={() => handleTargetTypeChange("client")}
                      className="accent-navy"
                    />
                    <span>Existing Client</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                    <input
                      type="radio"
                      name="targetType"
                      checked={targetType === "lead"}
                      onChange={() => handleTargetTypeChange("lead")}
                      className="accent-navy"
                    />
                    <span>Enquiry / Lead</span>
                  </label>
                </div>
              </div>

              {targetType === "client" ? (
                <div>
                  <label className="block font-semibold text-text-muted mb-1">
                    SELECT CLIENT *
                  </label>
                  <select
                    required
                    value={clientId}
                    onChange={(e) => handleClientChange(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs bg-surface focus:ring-1 focus:ring-navy"
                  >
                    <option value="">-- Select Client --</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {(c as any).organization_name ? `(${(c as any).organization_name})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block font-semibold text-text-muted mb-1">
                    SELECT ENQUIRY / LEAD *
                  </label>
                  <select
                    required
                    value={leadId}
                    onChange={(e) => handleLeadChange(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs bg-surface focus:ring-1 focus:ring-navy"
                  >
                    <option value="">-- Select Lead --</option>
                    {leads.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} {l.organization_name || l.company ? `(${l.organization_name || l.company})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Editable Recipient Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">
                    RECIPIENT NAME *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Contact Name"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:ring-1 focus:ring-navy"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text-muted mb-1">
                    ORGANISATION
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Acme Corp"
                    value={organisation}
                    onChange={(e) => setOrganisation(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:ring-1 focus:ring-navy"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-text-muted mb-1">
                    BILLING ADDRESS
                  </label>
                  <textarea
                    rows={2}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:ring-1 focus:ring-navy"
                    placeholder="Full address for quotation..."
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text-muted mb-1">
                    EMAIL
                  </label>
                  <input
                    type="email"
                    placeholder="email@domain.com"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:ring-1 focus:ring-navy"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text-muted mb-1">
                    PHONE
                  </label>
                  <input
                    type="text"
                    placeholder="Phone number"
                    value={recipientPhone}
                    onChange={(e) => setRecipientPhone(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:ring-1 focus:ring-navy"
                  />
                </div>
              </div>

              {/* Dates & Tax Setup */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">
                    DATE
                  </label>
                  <input
                    type="date"
                    required
                    value={quotationDate}
                    onChange={(e) => setQuotationDate(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:ring-1 focus:ring-navy"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text-muted mb-1">
                    VALID UNTIL
                  </label>
                  <input
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:ring-1 focus:ring-navy"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text-muted mb-1">
                    GST TYPE
                  </label>
                  <select
                    value={isInterState ? "inter" : "intra"}
                    onChange={(e) =>
                      setIsInterState(e.target.value === "inter")
                    }
                    className="w-full border border-border rounded p-2 text-xs bg-surface focus:ring-1 focus:ring-navy"
                  >
                    <option value="intra">Intra-state (CGST + SGST)</option>
                    <option value="inter">Inter-state (IGST)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-text-muted mb-1">
                    GST RATE %
                  </label>
                  <input
                    type="number"
                    value={gstRate}
                    onChange={(e) => setGstRate(Number(e.target.value))}
                    className="w-full border border-border rounded p-2 text-xs focus:ring-1 focus:ring-navy"
                  />
                </div>
              </div>

              {/* Dynamic Line Items with Master Services Dropdown */}
              <div className="space-y-2 pt-2 border-t border-border">
                <label className="block font-semibold text-text-muted">
                  QUOTATION LINE ITEMS
                </label>
                {items.map((item, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row gap-2 items-start sm:items-center bg-background p-2 rounded border border-border">
                    <select 
                      value={item.description} 
                      onChange={(e) => handleServiceSelect(idx, e.target.value)}
                      className="w-full sm:w-1/3 border border-border rounded p-2 text-xs focus:ring-1 focus:ring-navy bg-surface"
                    >
                      <option value="">-- Select Master Service --</option>
                      {MASTER_SERVICES.map(s => <option key={s.description} value={s.description}>{s.description}</option>)}
                    </select>
                    <input
                      type="text"
                      placeholder="Or type custom description..."
                      value={item.description}
                      onChange={(e) =>
                        updateItem(idx, "description", e.target.value)
                      }
                      className="flex-1 border border-border rounded p-2 text-xs focus:ring-1 focus:ring-navy"
                    />
                    <input
                      type="number"
                      placeholder="Qty"
                      value={item.qty}
                      onChange={(e) =>
                        updateItem(idx, "qty", Number(e.target.value))
                      }
                      className="w-16 border border-border rounded p-2 text-xs focus:ring-1 focus:ring-navy"
                    />
                    <input
                      type="number"
                      placeholder="Rate"
                      value={item.rate}
                      onChange={(e) =>
                        updateItem(idx, "rate", Number(e.target.value))
                      }
                      className="w-24 border border-border rounded p-2 text-xs focus:ring-1 focus:ring-navy"
                    />
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="p-1.5 text-danger hover:bg-danger/10 rounded"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addItem}
                  className="text-navy font-semibold text-xs flex items-center gap-1 pt-1 hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Item
                </button>
              </div>

              <div className="flex flex-col md:flex-row gap-6 pt-4 border-t border-border">
                {/* Notes and Bank Details */}
                <div className="flex-1">
                  <label className="block font-semibold text-text-muted mb-1 flex items-center gap-1">
                    <Landmark className="h-3.5 w-3.5" /> TERMS, NOTES & BANK DETAILS
                  </label>
                  <textarea
                    rows={6}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:ring-1 focus:ring-navy"
                  />
                </div>

                {/* Totals Breakdown */}
                <div className="w-full md:w-64 bg-background p-4 rounded border border-border space-y-2 text-right">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span className="font-semibold">₹{subtotal.toFixed(2)}</span>
                  </div>
                  {isInterState ? (
                    <div className="flex justify-between text-text-muted">
                      <span>IGST ({taxRate}%):</span>
                      <span>₹{igst.toFixed(2)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between text-text-muted">
                        <span>CGST ({taxRate / 2}%):</span>
                        <span>₹{cgst.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-text-muted">
                        <span>SGST ({taxRate / 2}%):</span>
                        <span>₹{sgst.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between font-bold text-sm text-navy pt-2 border-t border-border mt-2">
                    <span>Total:</span>
                    <span>₹{total.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-border">
                {editingQuotation ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="px-3 py-1.5 bg-danger text-white rounded font-semibold flex items-center gap-1 hover:bg-danger/90"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-1.5 border border-border rounded text-text-main hover:bg-background"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-navy text-white rounded font-medium hover:bg-navy/90"
                  >
                    Save Quotation
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}