"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Trash2, X, Send, Printer, Receipt, Mail, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Client } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";

interface LineItem {
  description: string;
  qty: number;
  rate: number;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<any | null>(null);

  // 1. Add state for settings
const [firmSettings, setFirmSettings] = useState<any>(null);

  // Form State
  const [selectedClientId, setSelectedClientId] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [isInterState, setIsInterState] = useState(false);
  const [gstRate, setGstRate] = useState<number>(18);
  const [status, setStatus] = useState("Draft");
  const [notes, setNotes] = useState("");
  const [amountPaid, setAmountPaid] = useState<number>(0);
  const [items, setItems] = useState<LineItem[]>([{ description: "", qty: 1, rate: 0 }]);

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    
// Fetch settings alongside your existing data
  const { data: settings } = await supabase.from("firm_settings").select("*").eq("id", 1).single();
  if (settings) setFirmSettings(settings);

    const { data: invData, error: invError } = await supabase
      .from("invoices")
      .select("*, clients!client_id(name, email, phone)")
      .order("id", { ascending: false });

    if (invError) {
      console.error("Fetch Invoices Error:", invError);
      alert("Failed to load invoices from database: " + invError.message);
    } else if (invData) {
      setInvoices(invData);
    }

    const { data: cData } = await supabase
      .from("clients")
      .select("*")
      .order("name", { ascending: true });
      
    if (cData) setClients(cData);
    
    setLoading(false);
  }

  // Real-time Math
  const subtotal = items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.rate) || 0), 0);
  const cgst = isInterState ? 0 : (subtotal * gstRate) / 200;
  const sgst = isInterState ? 0 : (subtotal * gstRate) / 200;
  const igst = isInterState ? (subtotal * gstRate) / 100 : 0;
  const grandTotal = subtotal + cgst + sgst + igst;
  const balance = Math.max(0, grandTotal - amountPaid);

  // Auto-update status based on amount paid
  useEffect(() => {
    if (amountPaid >= grandTotal && grandTotal > 0) setStatus("Paid");
    else if (amountPaid > 0 && amountPaid < grandTotal) setStatus("Partially Paid");
  }, [amountPaid, grandTotal]);

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

async function openModal(inv?: any) {
    if (inv) {
      setEditingInvoice(inv);
      setSelectedClientId(inv.client_id || "");
      setOrganisation(inv.organisation || "");
      setInvoiceDate(inv.issue_date || inv.date || new Date().toISOString().slice(0, 10));
      setDueDate(inv.due_date || "");
      setIsInterState(Boolean(inv.is_inter_state));
      setGstRate(Number(inv.gst_rate) || 18);
      setStatus(inv.status || "Draft");
      setNotes(inv.notes || "");
      setAmountPaid(Number(inv.amount_paid) || 0);
      setItems(inv.items?.length ? inv.items : [{ description: "", qty: 1, rate: 0 }]);
      
      // If you have an invoice number state, set it here for editing:
      // setInvoiceNumber(inv.invoice_number || "");
    } else {
      setEditingInvoice(null);
      resetForm();

      // --- INJECT FIRM SETTINGS DEFAULTS ---
      
      // 1. Calculate and set the next Invoice Number
      const { count } = await supabase.from("invoices").select("*", { count: "exact", head: true });
      const nextNumber = (count || 0) + 1;
      const formattedNumber = String(nextNumber).padStart(4, '0');
      const prefix = firmSettings?.invoice_prefix || "INV-2026-";
      
      // If you are storing the invoice number in state, uncomment this:
      // setInvoiceNumber(`${prefix}${formattedNumber}`);

      // 2. Apply Default GST Rate
      setGstRate(firmSettings?.default_gst_rate ?? 18);

      // 3. Auto-populate Payment Terms & Bank Details into Notes
      const defaultNotes = `Payment Terms: ${firmSettings?.payment_terms || 'Due on Receipt'}\n\nBank Details:\nBank: ${firmSettings?.bank_name || 'N/A'}\nA/C: ${firmSettings?.bank_account_no || 'N/A'}\nIFSC: ${firmSettings?.bank_ifsc || 'N/A'}\nUPI: ${firmSettings?.upi_id || 'N/A'}`;
      
      setNotes(defaultNotes);
    }
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingInvoice(null);
    resetForm();
  }

  function resetForm() {
    setSelectedClientId("");
    setOrganisation("");
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setDueDate("");
    setIsInterState(false);
    setGstRate(18);
    setStatus("Draft");
    setNotes("");
    setAmountPaid(0);
    setItems([{ description: "", qty: 1, rate: 0 }]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validItems = items.filter((it) => it.description.trim() !== "");
    if (!validItems.length) return alert("Please add at least one line item.");
    if (!selectedClientId) return alert("Please select a client.");

    const payload = {
      client_id: selectedClientId,
      organisation: organisation.trim(),
      date: invoiceDate,
      issue_date: invoiceDate, // Legacy support mapping
      due_date: dueDate || null,
      is_inter_state: isInterState,
      gst_rate: gstRate,
      subtotal,
      tax: cgst + sgst + igst,
      total: grandTotal,
      amount_paid: amountPaid,
      status,
      notes: notes.trim(),
      items: validItems,
    };

    if (editingInvoice) {
      const { error } = await supabase.from("invoices").update(payload).eq("id", editingInvoice.id);
      if (!error) {
        logAuditEvent("UPDATE_INVOICE", "INVOICES", editingInvoice.id, { status, amountPaid });
        closeModal();
        loadData();
      } else alert("Error updating invoice: " + error.message);
    } else {
      try {
        const res = await fetch("/api/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const responseData = await res.json();

        if (res.ok) {
          closeModal();
          loadData();
        } else {
          alert("Error creating invoice: " + (responseData.error || "Unknown server error"));
        }
      } catch (err: any) {
        console.error("Critical Fetch Error:", err);
        alert("Network error: Please check the browser console (F12) for details.");
      }
    }
  }

  async function handleDelete() {
    if (!editingInvoice || !confirm("Delete this invoice?")) return;
    const { error } = await supabase.from("invoices").delete().eq("id", editingInvoice.id);
    if (!error) {
      logAuditEvent("DELETE_INVOICE", "INVOICES", editingInvoice.id);
      closeModal();
      loadData();
    } else alert("Error deleting invoice: " + error.message);
  }

  // Improved Email Dispatch Function
  async function sendInvoiceEmail(inv: any, e?: React.MouseEvent) {
    if (e) e.stopPropagation();

    const recipientEmail = inv.clients?.email;
    if (!recipientEmail) {
      alert("No email address associated with this client.");
      return;
    }

    if (!confirm(`Send Invoice ${inv.invoice_number} to ${recipientEmail}?`)) return;

    setSendingId(inv.id);

    try {
      const res = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: inv.id,
          recipientEmail,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Optimistically update the UI without refetching the whole DB
      setInvoices((prev) =>
        prev.map((item) =>
          item.id === inv.id
            ? { ...item, status: item.status === "Draft" ? "Sent" : item.status, email_sent_at: new Date().toISOString() }
            : item
        )
      );
      
      logAuditEvent("SEND_INVOICE_EMAIL", "INVOICES", inv.id);
      alert("Invoice email dispatched successfully!");
    } catch (err: any) {
      console.error("Send Email Error:", err);
      alert("Failed to send invoice email: " + (err.message || "Unknown error"));
    } finally {
      setSendingId(null);
    }
  }

  function formatMoney(amount: number) {
    return `₹${(Number(amount) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const filteredInvoices = invoices.filter((i: any) => {
    const matchesSearch = [i.invoice_number, i.clients?.name, i.organisation]
      .filter(Boolean)
      .some((f) => f.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = filterStatus ? i.status === filterStatus : true;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-surface p-4 rounded-lg border border-border shadow-sm">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-60">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <input type="text" placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-border rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
          </div>

          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="border border-border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy bg-surface">
            <option value="">All statuses</option>
            <option>Draft</option><option>Sent</option><option>Partially Paid</option><option>Paid</option>
          </select>
        </div>

        <button onClick={() => openModal()} className="flex items-center gap-2 bg-navy text-white px-4 py-2 rounded-md font-medium text-xs hover:bg-navy/90 transition">
          <Plus className="h-4 w-4" /> New Invoice
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted text-xs">Loading billing records...</div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs">No invoices generated yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Client</th>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Status</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredInvoices.map((i: any) => (
                  <tr key={i.id} className="hover:bg-background/50 transition cursor-pointer" onClick={() => openModal(i)}>
                    <td className="font-mono font-bold text-navy flex items-center gap-1.5"><Receipt className="h-3.5 w-3.5 text-navy shrink-0" /> {i.invoice_number}</td>
                    <td className="font-medium text-text-main">{i.clients?.name || "-"}</td>
                    <td>{i.date || i.issue_date}</td>
                    <td className="font-bold text-navy">{formatMoney(i.total)}</td>
                    <td className="text-success font-medium">{formatMoney(i.amount_paid)}</td>
                    <td>
                      <div className="flex flex-col gap-1 items-start">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                          i.status === "Paid" ? "bg-success/10 text-success" : i.status === "Partially Paid" ? "bg-accent/10 text-accent" : "bg-navy/10 text-navy"
                        }`}>
                          {i.status}
                        </span>
                        {i.email_sent_at ? (
                          <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">✓ Email Sent</span>
                        ) : (
                          <span className="text-[10px] text-text-muted">Not emailed</span>
                        )}
                      </div>
                    </td>
                    <td className="text-right whitespace-nowrap space-x-2">
                      <button
                        onClick={(e) => sendInvoiceEmail(i, e)}
                        disabled={sendingId === i.id}
                        className={`px-2.5 py-1 border rounded font-semibold inline-flex items-center gap-1 text-[11px] transition ${
                          i.email_sent_at 
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" 
                            : "border-border hover:bg-background"
                        }`}
                        title={i.email_sent_at ? `Resend Invoice (Last sent ${new Date(i.email_sent_at).toLocaleDateString()})` : "Email Invoice"}
                      >
                        {sendingId === i.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                        {i.email_sent_at ? "Resend" : "Email"}
                      </button>
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          window.open(`/invoices/${i.id}/pdf`, '_self'); 
                        }} 
                        className="px-2.5 py-1 border border-border rounded hover:bg-background font-semibold"
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
          <div className="bg-surface rounded-lg border border-border w-full max-w-2xl p-6 space-y-4 shadow-lg text-xs">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-semibold text-base text-text-main">{editingInvoice ? `Invoice ${editingInvoice.invoice_number}` : "New Invoice"}</h3>
              <button onClick={closeModal} className="text-text-muted hover:text-text-main"><X className="h-5 w-5" /></button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">CLIENT *</label>
                  <select required value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                    <option value="">-- Select Client --</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">ORGANISATION</label>
                  <input type="text" placeholder="e.g. Client Pvt Ltd" value={organisation} onChange={(e) => setOrganisation(e.target.value)} className="w-full border border-border rounded p-2 text-xs" />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">INVOICE DATE</label>
                  <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full border border-border rounded p-2 text-xs" />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">DUE DATE</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full border border-border rounded p-2 text-xs" />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">GST TYPE</label>
                  <select value={String(isInterState)} onChange={(e) => setIsInterState(e.target.value === "true")} className="w-full border border-border rounded p-2 text-xs bg-surface">
                    <option value="false">Intra-state (CGST+SGST)</option>
                    <option value="true">Inter-state (IGST)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">GST RATE %</label>
                  <input type="number" step="0.01" value={gstRate} onChange={(e) => setGstRate(Number(e.target.value))} className="w-full border border-border rounded p-2 text-xs" />
                </div>
              </div>

              {/* Line Items */}
              <div className="space-y-2 pt-2 border-t border-border">
                <label className="block font-semibold text-text-muted">LINE ITEMS</label>
                {items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input type="text" placeholder="Service description" value={item.description} onChange={(e) => handleItemChange(idx, "description", e.target.value)} className="flex-1 border border-border rounded p-2 text-xs" required />
                    <input type="number" min="1" placeholder="Qty" value={item.qty} onChange={(e) => handleItemChange(idx, "qty", Number(e.target.value))} className="w-16 border border-border rounded p-2 text-xs text-center" required />
                    <input type="number" step="0.01" placeholder="Rate" value={item.rate} onChange={(e) => handleItemChange(idx, "rate", Number(e.target.value))} className="w-24 border border-border rounded p-2 text-xs" required />
                    <span className="w-24 text-right font-semibold text-navy">{formatMoney(item.qty * item.rate)}</span>
                    {items.length > 1 && <button type="button" onClick={() => handleRemoveItem(idx)} className="text-danger p-1"><X className="h-4 w-4" /></button>}
                  </div>
                ))}
                <button type="button" onClick={handleAddItem} className="text-xs text-navy font-semibold hover:underline">+ Add line</button>
              </div>

              {/* Totals Box */}
              <div className="bg-background p-3 rounded border border-border space-y-1 font-mono text-xs">
                <div className="flex justify-between text-text-muted"><span>Subtotal</span><span>{formatMoney(subtotal)}</span></div>
                {isInterState ? (
                  <div className="flex justify-between text-text-muted"><span>IGST ({gstRate}%)</span><span>{formatMoney(igst)}</span></div>
                ) : (
                  <>
                    <div className="flex justify-between text-text-muted"><span>CGST ({gstRate / 2}%)</span><span>{formatMoney(cgst)}</span></div>
                    <div className="flex justify-between text-text-muted"><span>SGST ({gstRate / 2}%)</span><span>{formatMoney(sgst)}</span></div>
                  </>
                )}
                <div className="flex justify-between font-bold text-navy text-sm border-t border-border pt-1 mt-1"><span>Total Due</span><span>{formatMoney(grandTotal)}</span></div>
                {amountPaid > 0 && (
                  <div className="flex justify-between font-bold text-danger text-sm pt-1"><span>Balance</span><span>{formatMoney(balance)}</span></div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">AMOUNT PAID (₹)</label>
                  <input type="number" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(Number(e.target.value))} className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-success border-success/30 bg-success/5" />
                </div>
                <div>
                  <label className="block font-semibold text-text-muted mb-1">STATUS OVERRIDE</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                    <option>Draft</option><option>Sent</option><option>Partially Paid</option><option>Paid</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-text-muted mb-1">NOTES</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-border rounded p-2 text-xs" />
              </div>

              {/* Toolbar */}
              <div className="flex flex-wrap justify-between items-center gap-2 pt-3 border-t border-border">
                <div className="flex flex-wrap gap-1.5">
                  {editingInvoice && (
                    <>
                      <button 
                        type="button" 
                        onClick={() => editingInvoice?.id && window.open(`/invoices/${editingInvoice.id}/pdf`, '_self')} 
                        className="px-2.5 py-1.5 border border-border rounded text-text-main hover:bg-background flex items-center gap-1 font-semibold"
                      >
                        <Printer className="h-3.5 w-3.5" /> PDF
                      </button>
                      <button 
                        type="button" 
                        onClick={() => sendInvoiceEmail(editingInvoice)} 
                        disabled={sendingId === editingInvoice.id}
                        className="px-2.5 py-1.5 border border-border rounded text-text-main hover:bg-background flex items-center gap-1 font-semibold disabled:opacity-50"
                      >
                        {sendingId === editingInvoice.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} 
                        {editingInvoice.email_sent_at ? "Resend Email" : "Send Email"}
                      </button>
                      <button type="button" onClick={handleDelete} className="px-2.5 py-1.5 bg-danger text-white rounded font-semibold flex items-center gap-1 hover:bg-danger/90"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                    </>
                  )}
                </div>

                <div className="flex gap-2 ml-auto">
                  <button type="button" onClick={closeModal} className="px-4 py-1.5 border border-border rounded text-text-main hover:bg-background">Cancel</button>
                  <button type="submit" className="px-4 py-1.5 bg-navy text-white rounded font-medium hover:bg-navy/90">Save Invoice</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}