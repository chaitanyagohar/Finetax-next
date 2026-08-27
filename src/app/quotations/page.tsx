"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Trash2, X, FileText, Download, Mail, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Client } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";

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
    const [{ data: qData }, { data: cData }, { data: lData }] =
      await Promise.all([
        supabase
          .from("quotations")
          .select("*, clients(name, email), leads(name, email)")
          .order("created_at", { ascending: false }),
        supabase.from("clients").select("*").order("name", { ascending: true }),
        supabase
          .from("leads")
          .select("*")
          .order("created_at", { ascending: false }),
      ]);

    if (qData) setQuotations(qData);
    if (cData) setClients(cData);
    if (lData) setLeads(lData);
    setLoading(false);
  }

  function openModal(q?: any) {
    if (q) {
      setEditingQuotation(q);
      setTargetType(q.lead_id ? "lead" : "client");
      setClientId(q.client_id || "");
      setLeadId(q.lead_id || "");
      setRecipientName(q.recipient_name || "");
      setRecipientEmail(q.recipient_email || "");
      setRecipientPhone(q.recipient_phone || "");
      setOrganisation(q.organisation || "");
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
    setQuotationDate(new Date().toISOString().slice(0, 10));
    setValidUntil("");
    setIsInterState(false);
    setGstRate(18);
    setNotes("");
    setStatus("Draft");
    setItems([{ description: "", qty: 1, rate: 0 }]);
  }

  function addItem() {
    setItems([...items, { description: "", qty: 1, rate: 0 }]);
  }

  function removeItem(index: number) {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (targetType === "client" && !clientId)
      return alert("Please select a client.");
    if (items.some((i) => !i.description.trim()))
      return alert("All line items require a description.");

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
      status: status || "Draft",
    };

    if (targetType === "lead") {
      payload.lead_id = leadId || null;
      payload.recipient_name = recipientName;
      payload.recipient_email = recipientEmail;
      payload.recipient_phone = recipientPhone;
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
        const year = new Date().getFullYear();
        const { count } = await supabase
          .from("quotations")
          .select("*", { count: "exact", head: true });
        const seqStr = String((count || 0) + 1).padStart(3, "0");
        payload.quote_number = `QUO/${year}/${seqStr}`;
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

  // Handle Send Email Action
  async function sendQuotationEmail(q: any, e: React.MouseEvent) {
    e.stopPropagation();

    const recipientEmail = q.clients?.email || q.leads?.email || q.recipient_email;

    if (!recipientEmail) {
      alert("No email address associated with this client or lead.");
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
    const nameStr = q.clients?.name || q.leads?.name || q.recipient_name || q.organisation || "";
    const matchesSearch = [q.quote_number, nameStr, q.notes]
      .filter(Boolean)
      .some((f) => f.toLowerCase().includes(search.toLowerCase()));
    return matchesSearch;
  });

  async function convertToInvoice(quotation: any, e: React.MouseEvent) {
    e.stopPropagation();

    if (!quotation.client_id) {
      alert(
        "Quotations created for Enquiries/Leads must first be converted to an active Client before generating an invoice.",
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
                      {q.clients?.name || q.leads?.name || q.recipient_name || q.organisation || "-"}
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
          <div className="bg-surface rounded-lg border border-border w-full max-w-2xl p-6 space-y-4 shadow-lg text-xs my-8">
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
              <div className="space-y-2">
                <label className="block font-semibold text-text-muted">
                  PREPARE QUOTATION FOR
                </label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="targetType"
                      checked={targetType === "client"}
                      onChange={() => setTargetType("client")}
                    />
                    <span>Existing Client</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="targetType"
                      checked={targetType === "lead"}
                      onChange={() => setTargetType("lead")}
                    />
                    <span>Enquiry / Lead</span>
                  </label>
                </div>
              </div>

              {targetType === "client" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-text-muted mb-1">
                      CLIENT *
                    </label>
                    <select
                      required
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      className="w-full border border-border rounded p-2 text-xs bg-surface"
                    >
                      <option value="">-- Select Client --</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-text-muted mb-1">
                      ORGANISATION
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Client Pvt Ltd"
                      value={organisation}
                      onChange={(e) => setOrganisation(e.target.value)}
                      className="w-full border border-border rounded p-2 text-xs"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                      className="w-full border border-border rounded p-2 text-xs"
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
                      className="w-full border border-border rounded p-2 text-xs"
                    />
                  </div>
                </div>
              )}

              {/* Dates & Tax Setup */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">
                    DATE
                  </label>
                  <input
                    type="date"
                    required
                    value={quotationDate}
                    onChange={(e) => setQuotationDate(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs"
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
                    className="w-full border border-border rounded p-2 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">
                    GST TYPE
                  </label>
                  <select
                    value={isInterState ? "inter" : "intra"}
                    onChange={(e) =>
                      setIsInterState(e.target.value === "inter")
                    }
                    className="w-full border border-border rounded p-2 text-xs bg-surface"
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
                    className="w-full border border-border rounded p-2 text-xs"
                  />
                </div>
              </div>

              {/* Dynamic Line Items */}
              <div className="space-y-2 pt-2 border-t border-border">
                <label className="block font-semibold text-text-muted">
                  LINE ITEMS
                </label>
                {items.map((item, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Item description"
                      value={item.description}
                      onChange={(e) =>
                        updateItem(idx, "description", e.target.value)
                      }
                      className="flex-1 border border-border rounded p-2 text-xs"
                    />
                    <input
                      type="number"
                      placeholder="Qty"
                      value={item.qty}
                      onChange={(e) =>
                        updateItem(idx, "qty", Number(e.target.value))
                      }
                      className="w-16 border border-border rounded p-2 text-xs"
                    />
                    <input
                      type="number"
                      placeholder="Rate"
                      value={item.rate}
                      onChange={(e) =>
                        updateItem(idx, "rate", Number(e.target.value))
                      }
                      className="w-24 border border-border rounded p-2 text-xs"
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
                  className="text-navy font-semibold text-xs flex items-center gap-1 pt-1"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Row
                </button>
              </div>

              {/* Totals Breakdown */}
              <div className="bg-background p-3 rounded border border-border space-y-1 text-right">
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
                <div className="flex justify-between font-bold text-sm text-navy pt-1 border-t border-border">
                  <span>Total:</span>
                  <span>₹{total.toFixed(2)}</span>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-text-muted mb-1">
                  NOTES
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full border border-border rounded p-2 text-xs"
                />
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