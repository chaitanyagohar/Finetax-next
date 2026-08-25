"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Trash2, X, UserPlus, ArrowRightLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Lead, Profile } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";

const SOURCES = ['Referral', 'Website', 'Social Media', 'Walk-in', 'Phone Enquiry', 'Existing Client', 'Other'];
const STATUSES = ['New', 'Contacted', 'Qualified', 'Quotation Sent', 'Won', 'Lost'];

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [team, setTeam] = useState<Profile[]>([]);
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
  const [serviceRequested, setServiceRequested] = useState("Tax Consultancy");
  const [source, setSource] = useState("Referral");
  const [status, setStatus] = useState("New");
  const [estimatedValue, setEstimatedValue] = useState<number>(0);
  const [assignedTo, setAssignedTo] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [notes, setNotes] = useState("");

  const supabase = createClient();

  useEffect(() => {
    fetchInitialData();
  }, []);

  async function fetchInitialData() {
    setLoading(true);
    const [{ data: leadsData }, { data: profilesData }] = await Promise.all([
      supabase.from("leads").select("*").order("id", { ascending: false }),
      supabase.from("profiles").select("*").order("name", { ascending: true }),
    ]);

    if (leadsData) setLeads(leadsData);
    if (profilesData) setTeam(profilesData);
    setLoading(false);
  }

  function openModal(lead?: Lead) {
    if (lead) {
      setEditingLead(lead);
      setName(lead.name || "");
      setCompany((lead as any).company || "");
      setPhone(lead.phone || "");
      setEmail(lead.email || "");
      setServiceRequested((lead as any).serviceRequested || (lead as any).service_requested || "Tax Consultancy");
      setSource((lead as any).source || "Referral");
      setStatus(lead.status || "New");
      setEstimatedValue((lead as any).estimatedValue || (lead as any).estimated_value || 0);
      setAssignedTo((lead as any).assignedTo || (lead as any).assigned_to || "");
      setFollowUpDate((lead as any).followUpDate || (lead as any).follow_up_date || "");
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
    setServiceRequested("Tax Consultancy");
    setSource("Referral");
    setStatus("New");
    setEstimatedValue(0);
    setAssignedTo("");
    setFollowUpDate("");
    setNotes("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const isNewAssignment = assignedTo && assignedTo !== ((editingLead as any)?.assignedTo || (editingLead as any)?.assigned_to);

    const payload: Record<string, any> = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      serviceRequested: serviceRequested.trim(),
      status: status || "New",
      assignedTo: assignedTo || null,
      followUpDate: followUpDate || null,
      notes: notes.trim(),
    };

    if (editingLead) {
      const { error } = await supabase.from("leads").update(payload).eq("id", editingLead.id);
      if (!error) {
        logAuditEvent("UPDATE_LEAD", "LEADS", editingLead.id, payload);
        
        // Notify Assigned Staff if re-assigned
        if (isNewAssignment) {
          await notifyAssignedStaff(assignedTo, name, serviceRequested);
        }

        closeModal();
        fetchInitialData();
      } else {
        alert("Error updating lead: " + error.message);
      }
    } else {
      // Explicitly generate a UUID to prevent 'null value in column id' constraint errors
      const newLeadId = crypto.randomUUID();

      const { data, error } = await supabase
        .from("leads")
        .insert([{ id: newLeadId, ...payload, createdAt: new Date().toISOString() }])
        .select()
        .single();

      if (!error) {
        logAuditEvent("CREATE_LEAD", "LEADS", data.id, payload);
        
        // Notify Assigned Staff on creation
        if (assignedTo) {
          await notifyAssignedStaff(assignedTo, name, serviceRequested);
        }

        closeModal();
        fetchInitialData();
      } else {
        alert("Error creating lead: " + error.message);
      }
    }
  }

  // Outbound Email Engine for Assigned Staff
  async function notifyAssignedStaff(profileId: string, leadName: string, service: string) {
    const assignee = team.find((t) => String(t.id) === String(profileId));
    if (!assignee?.email) return;

    try {
      const formData = new FormData();
      formData.append("to", assignee.email);
      formData.append("subject", `New Lead Assigned: ${leadName}`);
      formData.append(
        "body",
        `Hello ${assignee.name},\n\nYou have been assigned a new lead/enquiry in the Practice Manager portal:\n\nClient/Prospect Name: ${leadName}\nService Requested: ${service}\nPhone: ${phone || "N/A"}\nEmail: ${email || "N/A"}\nFollow-Up Date: ${followUpDate || "N/A"}\n\nPlease check your portal to initiate contact.`
      );

      await fetch("/api/send-email", { method: "POST", body: formData });
    } catch (err) {
      console.error("Failed to send lead assignment email:", err);
    }
  }

  async function handleDelete() {
    if (!editingLead || !confirm("Delete this lead? This cannot be undone.")) return;

    const { error } = await supabase.from("leads").delete().eq("id", editingLead.id);
    if (!error) {
      logAuditEvent("DELETE_LEAD", "LEADS", editingLead.id);
      closeModal();
      fetchInitialData();
    } else {
      alert("Error deleting lead: " + error.message);
    }
  }

  async function handleConvert() {
    if (!editingLead) return;
    if ((editingLead as any).converted_client_id) {
      alert("This lead has already been converted to a client.");
      return;
    }

    if (!confirm(`Convert lead "${editingLead.name}" into an active Client record?`)) return;

    const clientPayload = {
      name: company || name,
      type: "Individual",
      pan: "",
      gstin: "",
      email: email || "",
      phone: phone || "",
      address: "",
      state: "",
      assigned_to: assignedTo || null,
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
      fetchInitialData();
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

  function formatDate(dateStr?: string) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  function getAssigneeName(profileId?: string) {
    if (!profileId) return "-";
    const found = team.find((t) => String(t.id) === String(profileId));
    return found ? found.name : profileId;
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
                <tr className="border-b border-border text-left text-text-muted bg-background/50">
                  <th className="p-3">Name</th>
                  <th className="p-3">Service Requested</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Assigned To</th>
                  <th className="p-3">Follow-up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredLeads.map((l: any) => (
                  <tr
                    key={l.id}
                    className="hover:bg-background/50 transition cursor-pointer"
                    onClick={() => openModal(l)}
                  >
                    <td className="p-3 font-semibold text-text-main flex items-center gap-2">
                      <UserPlus className="h-3.5 w-3.5 text-navy shrink-0" /> {l.name}
                    </td>
                    <td className="p-3">{l.serviceRequested || l.service_requested || "Consultancy"}</td>
                    <td className="p-3">
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
                    <td className="p-3">{getAssigneeName(l.assignedTo || l.assigned_to)}</td>
                    <td className="p-3">
                      {l.followUpDate || l.follow_up_date ? (
                        formatDate(l.followUpDate || l.follow_up_date)
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
                  <label className="block font-semibold text-text-muted mb-1">PHONE</label>
                  <input
                    type="text"
                    placeholder="10-digit phone"
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
                  <label className="block font-semibold text-text-muted mb-1">SERVICE REQUESTED</label>
                  <input
                    type="text"
                    placeholder="e.g. Audit, GST Registration"
                    value={serviceRequested}
                    onChange={(e) => setServiceRequested(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy"
                  />
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
                  <label className="block font-semibold text-text-muted mb-1">ASSIGNED TO</label>
                  <select
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy bg-surface"
                  >
                    <option value="">-- Unassigned --</option>
                    {team.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.role})
                      </option>
                    ))}
                  </select>
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
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-navy text-white rounded font-medium hover:bg-navy/90"
                  >
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