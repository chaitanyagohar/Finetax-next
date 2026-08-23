"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Trash2, X, UserPlus, ArrowRightLeft, Calendar, Phone, Mail, Building } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Lead } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";

const SOURCES = ['Referral', 'Website', 'Social Media', 'Walk-in', 'Phone Enquiry', 'Existing Client', 'Other'];
const STATUSES = ['New', 'Contacted', 'Qualified', 'Quotation Sent', 'Won', 'Lost'];

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("Referral");
  const [status, setStatus] = useState("New");
  const [estimatedValue, setEstimatedValue] = useState<number>(0);
  const [assignedTo, setAssignedTo] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [notes, setNotes] = useState("");

  const supabase = createClient();

  useEffect(() => {
    fetchLeads();
  }, []);

  async function fetchLeads() {
    setLoading(true);
    const { data } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
    if (data) setLeads(data);
    setLoading(false);
  }

  function openModal(lead?: Lead) {
    if (lead) {
      setEditingLead(lead);
      setName(lead.name || "");
      setCompany((lead as any).company || "");
      setPhone(lead.phone || "");
      setEmail(lead.email || "");
      setSource((lead as any).source || "Referral");
      setStatus(lead.status || "New");
      setEstimatedValue((lead as any).estimated_value || (lead as any).estimatedValue || 0);
      setAssignedTo((lead as any).assigned_to || (lead as any).assignedTo || "");
      setFollowUpDate((lead as any).follow_up_date || (lead as any).followUpDate || "");
      setNotes(lead.notes || "");
    } else {
      setEditingLead(null);
      resetForm();
    }
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingLead(null);
    resetForm();
  }

  function resetForm() {
    setName("");
    setCompany("");
    setPhone("");
    setEmail("");
    setSource("Referral");
    setStatus("New");
    setEstimatedValue(0);
    setAssignedTo("");
    setFollowUpDate("");
    setNotes("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload = {
      name: name.trim(),
      company: company.trim(),
      phone: phone.trim(),
      email: email.trim(),
      source,
      status,
      estimated_value: Number(estimatedValue || 0),
      assigned_to: assignedTo.trim(),
      follow_up_date: followUpDate || null,
      notes: notes.trim(),
    };

    if (editingLead) {
      const { error } = await supabase.from("leads").update(payload).eq("id", editingLead.id);
      if (!error) {
        logAuditEvent("UPDATE_LEAD", "LEADS", editingLead.id, payload);
        closeModal();
        fetchLeads();
      } else {
        alert("Error updating lead: " + error.message);
      }
    } else {
      const { data, error } = await supabase
        .from("leads")
        .insert([{ ...payload, created_at: new Date().toISOString() }])
        .select()
        .single();

      if (!error) {
        logAuditEvent("CREATE_LEAD", "LEADS", data.id, payload);
        closeModal();
        fetchLeads();
      } else {
        alert("Error creating lead: " + error.message);
      }
    }
  }

  async function handleDelete() {
    if (!editingLead || !confirm("Delete this lead? This cannot be undone.")) return;

    const { error } = await supabase.from("leads").delete().eq("id", editingLead.id);
    if (!error) {
      logAuditEvent("DELETE_LEAD", "LEADS", editingLead.id);
      closeModal();
      fetchLeads();
    } else {
      alert("Error deleting lead: " + error.message);
    }
  }

  // Automates converting lead into a Client record
  async function handleConvert() {
    if (!editingLead) return;
    if ((editingLead as any).converted_client_id) {
      alert("This lead has already been converted to a client.");
      return;
    }

    if (!confirm(`Convert lead "${editingLead.name}" into an active Client record?`)) return;

    const { data: { user } } = await supabase.auth.getUser();

    const clientPayload = {
      name: company || name,
      type: "Individual",
      pan: "",
      gstin: "",
      email: email || "",
      phone: phone || "",
      address: "",
      state: "",
      assigned_to: assignedTo || user?.email || "",
      notes: `Converted from lead: ${name}${notes ? " — " + notes : ""}`,
      status: "Active",
      total_revenue: 0,
      risk_level: "Low",
      created_at: new Date().toISOString(),
    };

    const { data: newClient, error: clientErr } = await supabase
      .from("clients")
      .insert([clientPayload])
      .select()
      .single();

    if (clientErr) {
      alert("Error creating client record: " + clientErr.message);
      return;
    }

    // Update lead status to Won and record client link
    const { error: leadErr } = await supabase
      .from("leads")
      .update({
        status: "Won",
        converted_client_id: newClient.id,
      })
      .eq("id", editingLead.id);

    if (!leadErr) {
      logAuditEvent("CONVERT_LEAD_TO_CLIENT", "LEADS", editingLead.id, { clientId: newClient.id });
      alert(`Converted! New client "${newClient.name}" created.`);
      closeModal();
      fetchLeads();
    } else {
      alert("Error updating lead conversion state: " + leadErr.message);
    }
  }

  const filteredLeads = leads.filter((l: any) => {
    const matchesSearch = [l.name, l.company, l.email, l.phone, l.notes]
      .filter(Boolean)
      .some((f) => f.toLowerCase().includes(search.toLowerCase()));

    const matchesStatus = filterStatus ? l.status === filterStatus : true;
    const matchesSource = filterSource ? l.source === filterSource : true;

    return matchesSearch && matchesStatus && matchesSource;
  });

  function formatMoney(amount: number) {
    return `₹${(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatDate(dateStr?: string) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  return (
    <div className="space-y-6">
      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row flex-wrap justify-between items-start sm:items-center gap-3 bg-surface p-4 rounded-lg border border-border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-52">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search leads..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-border rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </div>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy bg-surface"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
            className="border border-border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy bg-surface"
          >
            <option value="">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 bg-navy text-white px-4 py-2 rounded-md font-medium text-xs hover:bg-navy/90 transition w-full sm:w-auto justify-center"
        >
          <Plus className="h-4 w-4" /> Add Enquiry / Lead
        </button>
      </div>

      {/* Leads Table */}
      <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted text-xs">Loading enquiries & leads...</div>
        ) : filteredLeads.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs">No enquiries or leads yet. Click "+ Add Enquiry / Lead" to create one.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Est. Value</th>
                  <th>Assigned To</th>
                  <th>Follow-up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredLeads.map((l: any) => (
                  <tr
                    key={l.id}
                    className="hover:bg-background/50 transition cursor-pointer"
                    onClick={() => openModal(l)}
                  >
                    <td className="font-semibold text-text-main flex items-center gap-2">
                      <UserPlus className="h-3.5 w-3.5 text-navy shrink-0" /> {l.name}
                    </td>
                    <td>{l.company || "-"}</td>
                    <td>{l.source || "Other"}</td>
                    <td>
                      <span
                        className={`px-2 py-0.5 rounded font-medium ${
                          l.status === "Won"
                            ? "bg-success/10 text-success"
                            : l.status === "Lost"
                            ? "bg-danger/10 text-danger"
                            : l.status === "Quotation Sent"
                            ? "bg-accent/10 text-accent"
                            : "bg-navy/10 text-navy"
                        }`}
                      >
                        {l.status || "New"}
                      </span>
                    </td>
                    <td className="font-mono">{formatMoney(l.estimated_value || l.estimatedValue || 0)}</td>
                    <td>{l.assigned_to || l.assignedTo || "-"}</td>
                    <td>
                      {l.follow_up_date || l.followUpDate ? (
                        formatDate(l.follow_up_date || l.followUpDate)
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Lead Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-surface rounded-lg border border-border w-full max-w-xl p-6 space-y-4 shadow-lg">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-semibold text-base text-text-main">
                {editingLead ? "Edit Lead" : "Add Enquiry / Lead"}
              </h3>
              <button onClick={closeModal} className="text-text-muted hover:text-text-main">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">NAME *</label>
                  <input
                    required
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">COMPANY</label>
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">PHONE</label>
                  <input
                    type="text"
                    placeholder="10-digit or with country code"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">EMAIL</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">SOURCE</label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy bg-surface"
                  >
                    {SOURCES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">STATUS</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy bg-surface"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">ESTIMATED VALUE (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={estimatedValue}
                    onChange={(e) => setEstimatedValue(Number(e.target.value))}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">ASSIGNED TO</label>
                  <input
                    type="text"
                    placeholder="Staff name"
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-text-muted mb-1">FOLLOW-UP DATE</label>
                  <input
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-text-muted mb-1">NOTES</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy"
                />
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-border">
                <div className="flex gap-2">
                  {editingLead && !(editingLead as any).converted_client_id && (
                    <button
                      type="button"
                      onClick={handleConvert}
                      className="px-3 py-1.5 bg-accent text-white rounded font-semibold flex items-center gap-1 hover:bg-accent/90"
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" /> Convert to Client
                    </button>
                  )}
                  {editingLead && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="px-3 py-1.5 bg-danger text-white rounded font-semibold flex items-center gap-1 hover:bg-danger/90"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-1.5 border border-border rounded text-text-main hover:bg-background"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="px-4 py-1.5 bg-navy text-white rounded font-medium hover:bg-navy/90">
                    Save
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