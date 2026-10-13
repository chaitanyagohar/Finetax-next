"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Trash2, X, UserPlus, ArrowRightLeft, MessageCircle, Mail, Send, Activity, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Lead, Profile, Client } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";

const SOURCES = ['Referral', 'Website', 'Social Media', 'Walk-in', 'Phone Enquiry', 'Existing Client', 'Other'];
const STATUSES = ['New', 'Contacted', 'Qualified', 'Quotation Sent', 'Won', 'Lost'];

// 1. SERVICE MASTER LIST & AUTOMATED CHECKLISTS
const SERVICE_CATALOG: Record<string, string[]> = {
  "Tax Consultancy": ["Specific Query Details", "Past Tax Notices (if any)", "Relevant Financial Documents"],
  "GST Registration": ["PAN Card", "Aadhar Card", "Proof of Business Address (Electricity Bill/Rent Agreement)", "Bank Statement/Cancelled Cheque", "Passport Size Photo"],
  "Income Tax Return": ["Form 16", "Bank Statements", "Aadhar Card", "PAN Card", "Investment Proofs (80C, etc.)"],
  "Company Incorporation": ["PAN & Aadhar of all Directors", "Utility Bill for Regd Office", "NOC from Owner", "Passport Size Photos", "Latest Bank Statement"],
  "Audit": ["Previous Year Balance Sheet", "Current Year Bank Statements", "Ledger Accounts", "GST Returns", "Invoices"],
};

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [team, setTeam] = useState<Profile[]>([]);
  const [clientsList, setClientsList] = useState<Client[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [loading, setLoading] = useState(true);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);

  // Discussion Feed State
  const [discussions, setDiscussions] = useState<any[]>([]);
  const [newDiscussionNote, setNewDiscussionNote] = useState("");
  const [loadingDiscussions, setLoadingDiscussions] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [serviceRequested, setServiceRequested] = useState("Tax Consultancy");
  const [customService, setCustomService] = useState(""); // Holds the custom value if "Other" is selected
  
  // Reference Tracking State
  const [referralSource, setReferralSource] = useState("Website"); 
  const [referredByClient, setReferredByClient] = useState("");
  
  const [status, setStatus] = useState("New");
  const [assignedTo, setAssignedTo] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [notes, setNotes] = useState("");

  const supabase = createClient();

  // Dynamically generate the dropdown list based on defaults + whatever is in the database
  const availableServices = Array.from(
    new Set([
      ...Object.keys(SERVICE_CATALOG),
      ...leads.map((l: any) => l.service_requested || l.serviceRequested).filter(Boolean),
    ])
  ).filter(s => s !== "Other"); // Remove "Other" to forcefully append it to the very bottom
  availableServices.push("Other");

  useEffect(() => {
    fetchInitialData();
  }, []);

  async function fetchInitialData() {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setCurrentUser(profile);
    }
const [{ data: leadsData }, { data: profilesData }, { data: clientsData }] = await Promise.all([
  supabase.from("leads").select("*").order("id", { ascending: false }),
  supabase.from("profiles").select("*").order("name", { ascending: true }),
  supabase.from("clients").select("*").order("name", { ascending: true }),
]);

if (leadsData) setLeads(leadsData);
if (profilesData) setTeam(profilesData);
if (clientsData) setClientsList(clientsData as any[]);
    
    setLoading(false);
  }

  async function loadDiscussions(leadId: string) {
    setLoadingDiscussions(true);
    const { data } = await supabase
      .from("audit_logs")
      .select("*")
      .eq("entity", "LEAD_DISCUSSION")
      .eq("entity_id", leadId)
      .order("timestamp", { ascending: false });
    
    if (data) setDiscussions(data);
    setLoadingDiscussions(false);
  }

  function openModal(lead?: Lead) {
    if (lead) {
      setEditingLead(lead);
      setName(lead.name || "");
      setOrganizationName((lead as any).organization_name || (lead as any).company || "");
      setPhone(lead.phone || "");
      setEmail(lead.email || "");
      
      const srv = (lead as any).serviceRequested || (lead as any).service_requested || "Tax Consultancy";
      setServiceRequested(srv);
      setCustomService("");
      
      const rawReferredBy = (lead as any).referred_by || "";
      if (rawReferredBy.startsWith("CLIENT_ID:")) {
        setReferralSource("Existing Client");
        setReferredByClient(rawReferredBy.replace("CLIENT_ID:", ""));
      } else {
        setReferralSource(rawReferredBy || (lead as any).source || "Website");
        setReferredByClient("");
      }

      setStatus(lead.status || "New");
      setAssignedTo((lead as any).assignedTo || (lead as any).assigned_to || "");
      setFollowUpDate((lead as any).followUpDate || (lead as any).follow_up_date || "");
      setNotes(lead.notes || "");

      loadDiscussions(lead.id);
    } else {
      setEditingLead(null);
      setDiscussions([]);
      resetForm();
    }
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingLead(null);
    setDiscussions([]);
    resetForm();
  }

  function resetForm() {
    setName("");
    setOrganizationName("");
    setPhone("");
    setEmail("");
    setServiceRequested("Tax Consultancy");
    setCustomService("");
    setReferralSource("Website");
    setReferredByClient("");
    setStatus("New");
    setAssignedTo("");
    setFollowUpDate("");
    setNotes("");
  }

  async function handleAddDiscussion(e: React.FormEvent) {
    e.preventDefault();
    if (!newDiscussionNote.trim() || !editingLead) return;

    await logAuditEvent("POST_DISCUSSION", "LEAD_DISCUSSION", editingLead.id, { 
      note: newDiscussionNote.trim(), 
      author_name: currentUser?.name || "Team Member" 
    });
    
    setNewDiscussionNote("");
    loadDiscussions(editingLead.id);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const isNewAssignment = assignedTo && assignedTo !== ((editingLead as any)?.assignedTo || (editingLead as any)?.assigned_to);
    
    const finalReferredBy = referralSource === "Existing Client" && referredByClient 
      ? `CLIENT_ID:${referredByClient}` 
      : referralSource;

    // Resolve Dynamic Service
    const actualService = serviceRequested === "Other" && customService.trim() 
      ? customService.trim() 
      : serviceRequested;

    const payload: Record<string, any> = {
      name: name.trim(),
      organization_name: organizationName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      service_requested: actualService,
      serviceRequested: actualService, 
      referred_by: finalReferredBy,      
      source: referralSource,            
      status: status || "New",
      assignedTo: assignedTo || null,
      assigned_to: assignedTo || null,
      followUpDate: followUpDate || null,
      follow_up_date: followUpDate || null,
      notes: notes.trim(),
    };

    if (editingLead) {
      const { error } = await supabase.from("leads").update(payload).eq("id", editingLead.id);
      if (!error) {
        logAuditEvent("UPDATE_LEAD", "LEADS", editingLead.id, { status: payload.status, service: payload.service_requested });
        if (isNewAssignment) await notifyAssignedStaff(assignedTo, name, actualService);
        closeModal();
        fetchInitialData();
      } else {
        alert("Error updating lead: " + error.message);
      }
    } else {
      const newLeadId = crypto.randomUUID();
      const { data, error } = await supabase
        .from("leads")
        .insert([{ id: newLeadId, ...payload, createdAt: new Date().toISOString() }])
        .select()
        .single();

      if (!error) {
        logAuditEvent("CREATE_LEAD", "LEADS", data.id, { name: payload.name, service: payload.service_requested });
        if (assignedTo) await notifyAssignedStaff(assignedTo, name, actualService);
        closeModal();
        fetchInitialData();
      } else {
        alert("Error creating lead: " + error.message);
      }
    }
  }

  async function notifyAssignedStaff(profileId: string, leadName: string, service: string) {
    const assignee = team.find((t) => String(t.id) === String(profileId));
    if (!assignee?.email) return;

    try {
      const formData = new FormData();
      formData.append("to", assignee.email);
      formData.append("subject", `New Lead Assigned: ${leadName}`);
      formData.append(
        "body",
        `Hello ${assignee.name},\n\nYou have been assigned a new lead/enquiry in the Finetax Manager portal:\n\nClient/Prospect Name: ${leadName}\nService Requested: ${service}\nPhone: ${phone || "N/A"}\nEmail: ${email || "N/A"}\nFollow-Up Date: ${followUpDate || "N/A"}\n\nPlease check your portal to initiate contact.`
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
      name: name,
      organization_name: organizationName || "",
      type: "Individual",
      email: email || "",
      phone: phone || "",
      assigned_to: assignedTo || null,
      notes: `Converted from lead: ${name}${notes ? " — " + notes : ""}`,
      status: "Active",
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
        conversion_date: new Date().toISOString().split("T")[0],
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

  // Active service tracking for checklists
  const currentServiceForChecklist = serviceRequested === "Other" && customService.trim() ? customService.trim() : serviceRequested;
  const activeChecklist = SERVICE_CATALOG[currentServiceForChecklist] || ["Please specify details during discussion (Custom Service)"];

  function sendWhatsAppChecklist() {
    if (!phone) return alert("Please enter a phone number first.");
    const list = activeChecklist.map(d => `- ${d}`).join('%0A');
    const text = `Hello ${name},%0A%0AThank you for connecting with Finetax.%0A%0AFor processing your request regarding *${currentServiceForChecklist}*, please provide the following documents/details:%0A%0A${list}%0A%0ARegards,%0AFinetax Team`;
    window.open(`https://wa.me/91${phone.replace(/\D/g,'')}?text=${text}`, '_blank');
  }

  async function sendEmailChecklist() {
    if (!email) return alert("Please enter an email address first.");
    if (!confirm(`Send document checklist for ${currentServiceForChecklist} to ${email}?`)) return;

    const list = activeChecklist.map(d => `• ${d}`).join('\n');
    const body = `Hello ${name},\n\nThank you for connecting with Finetax.\n\nFor processing your request regarding ${currentServiceForChecklist}, please provide the following documents/details:\n\n${list}\n\nPlease reply to this email with the attachments.\n\nRegards,\nFinetax Team`;
    
    try {
      const formData = new FormData();
      formData.append("to", email);
      formData.append("subject", `Document Checklist required for ${currentServiceForChecklist}`);
      formData.append("body", body);
      const res = await fetch("/api/send-email", { method: "POST", body: formData });
      if (res.ok) alert("Checklist emailed successfully!");
      else alert("Failed to send email.");
    } catch {
      alert("Error sending email.");
    }
  }

  const filteredLeads = leads.filter((l: any) => {
    const matchesSearch = [l.name, l.organization_name, l.email, l.phone, l.notes]
      .filter(Boolean)
      .some((f) => f.toLowerCase().includes(search.toLowerCase()));

    const matchesStatus = filterStatus ? l.status === filterStatus : true;
    const matchesSource = filterSource ? (l.source === filterSource || (l.referred_by || "").includes(filterSource)) : true;

    return matchesSearch && matchesStatus && matchesSource;
  });

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
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
            className="border border-border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy bg-surface"
          >
            <option value="">All sources</option>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
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
          <div className="p-8 text-center text-text-muted text-xs">No enquiries found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-text-muted bg-background/50">
                  <th className="p-3">Name & Organization</th>
                  <th className="p-3">Service Requested</th>
                  <th className="p-3">Reference / Source</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Assigned To</th>
                  <th className="p-3">Follow-up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredLeads.map((l: any) => (
                  <tr key={l.id} className="hover:bg-background/50 transition cursor-pointer" onClick={() => openModal(l)}>
                    <td className="p-3">
                      <div className="font-semibold text-navy flex items-center gap-1.5">
                        <UserPlus className="h-3.5 w-3.5" /> {l.name}
                      </div>
                      <div className="text-[10px] text-text-muted mt-0.5">{l.organization_name || l.company || "-"}</div>
                    </td>
                    <td className="p-3 font-medium">{l.service_requested || l.serviceRequested || "Consultancy"}</td>
                    <td className="p-3 text-[11px]">
                      {(l.referred_by || "").startsWith("CLIENT_ID") ? (
                         <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-200">Client Referral</span>
                      ) : (
                        l.referred_by || l.source || "-"
                      )}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded font-medium ${
                        l.status === "Won" ? "bg-emerald-100 text-emerald-700" : l.status === "Lost" ? "bg-rose-100 text-rose-700" : l.status === "Quotation Sent" ? "bg-amber-100 text-amber-700" : "bg-navy/10 text-navy"
                      }`}>
                        {l.status || "New"}
                      </span>
                    </td>
                    <td className="p-3">{team.find(t => t.id === (l.assigned_to || l.assignedTo))?.name || "-"}</td>
                    <td className="p-3">{formatDate(l.follow_up_date || l.followUpDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Extended CRM Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-2 sm:p-4 z-50">
          <div className="bg-surface rounded-lg border border-border w-full max-w-6xl flex flex-col max-h-[95vh] shadow-lg text-xs">
            
            <div className="flex justify-between items-center border-b border-border p-4 shrink-0">
              <div>
                <h3 className="font-semibold text-base text-text-main">
                  {editingLead ? "Manage Enquiry / Prospect" : "New Enquiry"}
                </h3>
                {editingLead && (editingLead as any).conversion_date && (
                  <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold mt-1 inline-block">
                    Converted on: {formatDate((editingLead as any).conversion_date)}
                  </span>
                )}
              </div>
              <button onClick={closeModal} className="text-text-muted hover:text-text-main"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto flex-1">
              <div className={`grid grid-cols-1 ${editingLead ? 'lg:grid-cols-3' : 'lg:grid-cols-1'} gap-8`}>

                {/* LEFT COLUMN: Data Entry & Checklists */}
                <div className={`${editingLead ? 'lg:col-span-2' : 'lg:col-span-1'} space-y-5`}>
                  <form id="lead-form" onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-text-muted mb-1">PROSPECT NAME *</label>
                        <input required type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
                      </div>
                      <div>
                        <label className="block font-semibold text-text-muted mb-1">ORGANIZATION NAME</label>
                        <input type="text" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
                      </div>
                      <div>
                        <label className="block font-semibold text-text-muted mb-1">MOBILE NUMBER</label>
                        <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
                      </div>
                      <div>
                        <label className="block font-semibold text-text-muted mb-1">EMAIL ADDRESS</label>
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
                      </div>

                      {/* Dynamic Service Requested */}
                      <div className={serviceRequested === "Other" ? "col-span-1 sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3" : ""}>
                        <div>
                          <label className="block font-semibold text-text-muted mb-1 text-navy">SERVICE REQUESTED *</label>
                          <select value={serviceRequested} onChange={(e) => setServiceRequested(e.target.value)} className="w-full border border-navy/30 rounded p-2 text-xs bg-navy/5 font-semibold text-navy">
                            {availableServices.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        {serviceRequested === "Other" && (
                          <div>
                            <label className="block font-semibold text-text-muted mb-1 text-navy">CUSTOM SERVICE NAME *</label>
                            <input 
                              required 
                              type="text" 
                              value={customService} 
                              onChange={(e) => setCustomService(e.target.value)} 
                              placeholder="e.g. Trademark Registration" 
                              className="w-full border border-navy/30 rounded p-2 text-xs bg-navy/5 font-semibold text-navy focus:outline-none focus:ring-1 focus:ring-navy" 
                            />
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block font-semibold text-text-muted mb-1">CURRENT STATUS</label>
                        <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy bg-surface">
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block font-semibold text-text-muted mb-1">NEXT FOLLOW-UP DATE</label>
                        <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
                      </div>

                      {/* Reference Tracking */}
                      <div className="col-span-1 sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-background rounded-lg border border-border">
                        <div>
                          <label className="block font-semibold text-text-muted mb-1 flex items-center gap-1"><ArrowRightLeft className="h-3 w-3"/> REFERRED BY (SOURCE)</label>
                          <select value={referralSource} onChange={(e) => { setReferralSource(e.target.value); setReferredByClient(""); }} className="w-full border border-border rounded p-2 text-xs bg-surface">
                            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        
                        {referralSource === "Existing Client" && (
                          <div>
                            <label className="block font-semibold text-amber-600 mb-1">SELECT EXISTING CLIENT</label>
                            <select value={referredByClient} onChange={(e) => setReferredByClient(e.target.value)} required className="w-full border border-amber-300 rounded p-2 text-xs bg-amber-50">
                              <option value="">-- Choose Client --</option>
                              {clientsList.map(c => <option key={c.id} value={c.id}>{c.name} {c.organization_name ? `(${c.organization_name})` : ''}</option>)}
                            </select>
                          </div>
                        )}
                      </div>

                      <div className="col-span-1 sm:col-span-2">
                        <label className="block font-semibold text-text-muted mb-1">ASSIGNED TO</label>
                        <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                          <option value="">-- Unassigned --</option>
                          {team.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block font-semibold text-text-muted mb-1">INITIAL BRIEF / NOTES</label>
                      <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy" placeholder="Basic details collected during first touchpoint..." />
                    </div>
                  </form>

                  {/* Automated Document Checklist Module */}
                  <div className="border border-indigo-200 bg-indigo-50/30 rounded-lg p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="font-bold text-indigo-800 flex items-center gap-1.5"><FileText className="h-4 w-4"/> Document Checklist for {currentServiceForChecklist}</h4>
                        <p className="text-[10px] text-text-muted">Auto-generated list based on the requested service master.</p>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={sendWhatsAppChecklist} className="bg-emerald-500 hover:bg-emerald-600 text-white px-2.5 py-1.5 rounded flex items-center gap-1 font-semibold transition">
                          <MessageCircle className="h-3.5 w-3.5"/> WhatsApp
                        </button>
                        <button type="button" onClick={sendEmailChecklist} className="bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1.5 rounded flex items-center gap-1 font-semibold transition">
                          <Mail className="h-3.5 w-3.5"/> Email
                        </button>
                      </div>
                    </div>
                    <ul className="list-disc pl-5 space-y-1 text-[11px] text-text-main font-medium">
                      {activeChecklist.map((doc, i) => (
                        <li key={i}>{doc}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* RIGHT COLUMN: Discussion Feed */}
                {editingLead && (
                  <div className="lg:col-span-1 border-t lg:border-t-0 lg:border-l border-border pt-6 lg:pt-0 lg:pl-6 flex flex-col h-[500px] lg:h-auto">
                    <div className="flex items-center gap-2 text-navy font-bold mb-4 border-b border-border pb-2 sticky top-0 bg-surface">
                      <Activity className="h-4 w-4" /> Discussion & Follow-up Log
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4">
                      {loadingDiscussions ? (
                        <div className="text-text-muted italic">Loading timeline...</div>
                      ) : discussions.length === 0 ? (
                        <div className="text-text-muted italic">No discussion history recorded yet.</div>
                      ) : (
                        discussions.map((log: any) => {
                          const dt = new Date(log.timestamp);
                          return (
                            <div key={log.id} className="relative pl-4 border-l-2 border-navy/30 pb-2 last:border-0 last:pb-0">
                              <div className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-navy"></div>
                              <div className="flex justify-between items-start mb-0.5">
                                <span className="font-bold text-text-main text-[11px]">
                                  {log.metadata?.author_name || "System"}
                                </span>
                                <span className="text-[9px] text-text-muted whitespace-nowrap pl-2">
                                  {dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <div className="text-text-main bg-background p-2 rounded border border-border mt-1 whitespace-pre-wrap">
                                {log.metadata?.note || "Action performed"}
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>

                    {/* Add Discussion Input */}
                    <form onSubmit={handleAddDiscussion} className="mt-auto pt-3 border-t border-border flex gap-2">
                      <input 
                        type="text" 
                        value={newDiscussionNote} 
                        onChange={(e) => setNewDiscussionNote(e.target.value)} 
                        placeholder="Log a call, email summary, or update..." 
                        className="flex-1 border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy" 
                      />
                      <button type="submit" disabled={!newDiscussionNote.trim()} className="bg-navy text-white p-2 rounded hover:bg-navy/90 disabled:opacity-50">
                        <Send className="h-4 w-4" />
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex justify-between items-center p-4 border-t border-border mt-auto bg-surface rounded-b-lg shrink-0">
              <div className="flex gap-2">
                {editingLead && !(editingLead as any).converted_client_id && (
                  <button type="button" onClick={handleConvert} className="px-3 py-1.5 bg-emerald-600 text-white rounded font-semibold flex items-center gap-1 hover:bg-emerald-700">
                    <ArrowRightLeft className="h-3.5 w-3.5" /> Convert to Active Client
                  </button>
                )}
                {editingLead && (
                  <button type="button" onClick={handleDelete} className="px-3 py-1.5 border border-rose-200 text-rose-600 bg-rose-50 rounded font-semibold flex items-center gap-1 hover:bg-rose-100">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                )}
              </div>

              <div className="flex gap-2 ml-auto">
                <button type="button" onClick={closeModal} className="px-4 py-1.5 border border-border rounded text-text-main hover:bg-background">Cancel</button>
                <button type="submit" form="lead-form" className="px-4 py-1.5 bg-navy text-white rounded font-medium hover:bg-navy/90">Save Prospect</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}