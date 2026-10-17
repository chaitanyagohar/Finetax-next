"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Plus,
  Trash2,
  X,
  UserPlus,
  ArrowRightLeft,
  MessageCircle,
  Mail,
  Send,
  Activity,
  FileText,
  Building2,
  CalendarClock,
  IndianRupee,
  TrendingUp,
  Target,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Users,
  Clock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Lead, Profile, Client } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { clientLabel, sortByLabel } from "@/components/ui/ClientPicker";
import { useTaskCategories } from "@/components/tasks/TaskCategories";
import { compactINR, formatDate, formatINR, getInitials, localISODate } from "@/lib/format";

type LeadRow = Lead & Record<string, any>;
type ProfileRow = Profile & Record<string, any>;
type ClientRow = Client & Record<string, any>;

const SOURCES = ["Referral", "Website", "Social Media", "Walk-in", "Phone Enquiry", "Existing Client", "Other"];
const STATUSES = ["New", "Contacted", "Qualified", "Quotation Sent", "Won", "Lost"];

// 1. SERVICE MASTER LIST & AUTOMATED CHECKLISTS
const SERVICE_CATALOG: Record<string, string[]> = {
  "Tax Consultancy": ["Specific Query Details", "Past Tax Notices (if any)", "Relevant Financial Documents"],
  "GST Registration": ["PAN Card", "Aadhar Card", "Proof of Business Address (Electricity Bill/Rent Agreement)", "Bank Statement/Cancelled Cheque", "Passport Size Photo"],
  "Income Tax Return": ["Form 16", "Bank Statements", "Aadhar Card", "PAN Card", "Investment Proofs (80C, etc.)"],
  "Company Incorporation": ["PAN & Aadhar of all Directors", "Utility Bill for Regd Office", "NOC from Owner", "Passport Size Photos", "Latest Bank Statement"],
  "Audit": ["Previous Year Balance Sheet", "Current Year Bank Statements", "Ledger Accounts", "GST Returns", "Invoices"],
};

const STATUS_STYLES: Record<string, string> = {
  New: "bg-sky-50 text-sky-700 border-sky-200",
  Contacted: "bg-blue-50 text-blue-700 border-blue-200",
  Qualified: "bg-violet-50 text-violet-700 border-violet-200",
  "Quotation Sent": "bg-amber-50 text-amber-700 border-amber-200",
  Won: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Lost: "bg-rose-50 text-rose-700 border-rose-200",
};

const STATUS_DOTS: Record<string, string> = {
  New: "bg-sky-500",
  Contacted: "bg-blue-500",
  Qualified: "bg-violet-500",
  "Quotation Sent": "bg-amber-500",
  Won: "bg-emerald-500",
  Lost: "bg-rose-500",
};

const EVENT_LABELS: Record<string, string> = {
  CREATE_LEAD: "created this lead",
  UPDATE_LEAD: "updated the lead",
  CONVERT_LEAD_TO_CLIENT: "converted this lead to a client",
  SEND_CHECKLIST_EMAIL: "emailed the document checklist",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

/* ---------------- Helpers (read new columns, fall back to legacy ones) ---------------- */

function getService(l: LeadRow): string {
  return l.service_requested || l.serviceRequested || "Consultancy";
}
function getOrg(l: LeadRow): string {
  return l.organization_name || l.company || "";
}
function getAssignee(l: LeadRow): string {
  return l.assigned_to || l.assignedTo || "";
}
function getFollowUp(l: LeadRow): string {
  const v = String(l.follow_up_date || l.followUpDate || "");
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "";
}
function getValue(l: LeadRow): number {
  return Number(l.estimated_value ?? l.estimatedValue ?? 0) || 0;
}
function getReferringClientId(l: LeadRow): string {
  if (l.referring_client_id) return l.referring_client_id;
  const raw = String(l.referred_by || "");
  return raw.startsWith("CLIENT_ID:") ? raw.replace("CLIENT_ID:", "") : "";
}
function getSource(l: LeadRow): string {
  if (getReferringClientId(l)) return "Existing Client";
  return l.source || l.referred_by || "Other";
}
function isOpen(l: LeadRow): boolean {
  return !["Won", "Lost"].includes(l.status || "New");
}
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDate(localISODate(d))} ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}
/** Normalises Indian numbers for wa.me (avoids "9191…" double prefixes). */
function toWhatsAppNumber(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = "91" + digits;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/* ---------------- Page ---------------- */

export default function LeadsPage() {
  const currentUser = useCurrentUser();
  const isAdmin = !!currentUser?.isAdmin;
  const [supabase] = useState(() => createClient());

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [team, setTeam] = useState<ProfileRow[]>([]);
  const [clientsList, setClientsList] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [filterFollowUp, setFilterFollowUp] = useState("all");

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<LeadRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirmAction, setConfirmAction] = useState<null | "delete" | "convert" | "email">(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Discussion Feed State
  const [discussions, setDiscussions] = useState<any[]>([]);
  const [newDiscussionNote, setNewDiscussionNote] = useState("");
  const [loadingDiscussions, setLoadingDiscussions] = useState(false);
  const [postingNote, setPostingNote] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [serviceRequested, setServiceRequested] = useState("Tax Consultancy");
  const [customService, setCustomService] = useState("");
  const [referralSource, setReferralSource] = useState("Website");
  const [referredByClient, setReferredByClient] = useState("");
  const [status, setStatus] = useState("New");
  const [assignedTo, setAssignedTo] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [notes, setNotes] = useState("");

  const today = localISODate();
  const weekAhead = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return localISODate(d);
  }, []);

  // Dropdown list = default services + any custom services already saved on leads
  const availableServices = Array.from(
    new Set([...Object.keys(SERVICE_CATALOG), ...leads.map((l) => getService(l)).filter((s) => s && s !== "Consultancy")])
  ).filter((s) => s !== "Other");
  availableServices.push("Other");

  useEffect(() => {
    fetchInitialData();
  }, []);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4500);
  }

  async function fetchInitialData(showSpinner = true) {
    if (showSpinner) setLoading(true);

    const [leadsRes, profilesRes, clientsRes] = await Promise.all([
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, name, email, role, is_active").order("name", { ascending: true }),
      supabase.from("clients").select("id, name, organization_name").order("name", { ascending: true }),
    ]);

    if (leadsRes.error) showToast("error", "Could not load leads. Please refresh the page.");
    if (leadsRes.data) setLeads(leadsRes.data as LeadRow[]);
    if (profilesRes.data) setTeam(profilesRes.data as ProfileRow[]);
    if (clientsRes.data) setClientsList(clientsRes.data as ClientRow[]);

    setLoading(false);
  }

  async function loadDiscussions(leadId: string) {
    setLoadingDiscussions(true);
    const { data } = await supabase
      .from("audit_logs")
      .select("*")
      .eq("entity_id", leadId)
      .in("entity", ["LEAD_DISCUSSION", "LEADS"])
      .order("timestamp", { ascending: false });

    setDiscussions(data || []);
    setLoadingDiscussions(false);
  }

  const teamName = (id: string) => team.find((t) => String(t.id) === String(id))?.name || "";
  const clientName = (id: string) => {
    const c = clientsList.find((x) => String(x.id) === String(id));
    return c ? c.name : "";
  };
  const activeTeam = team.filter((t) => t.is_active !== false || String(t.id) === String(assignedTo));

  /* ---------------- Analytics ---------------- */

  const stats = useMemo(() => {
    const open = leads.filter(isOpen);
    const won = leads.filter((l) => l.status === "Won").length;
    const lost = leads.filter((l) => l.status === "Lost").length;
    const due = open.filter((l) => {
      const f = getFollowUp(l);
      return f && f <= today;
    });
    const overdue = due.filter((l) => getFollowUp(l) < today).length;
    const statusCounts: Record<string, number> = {};
    STATUSES.forEach((s) => {
      statusCounts[s] = leads.filter((l) => (l.status || "New") === s).length;
    });
    return {
      total: leads.length,
      open: open.length,
      won,
      lost,
      dueCount: due.length,
      overdue,
      winRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0,
      pipelineValue: open.reduce((sum, l) => sum + getValue(l), 0),
      statusCounts,
    };
  }, [leads, today]);

  const sourcePerformance = useMemo(() => {
    const map: Record<string, { total: number; won: number }> = {};
    leads.forEach((l) => {
      const s = getSource(l);
      if (!map[s]) map[s] = { total: 0, won: 0 };
      map[s].total++;
      if (l.status === "Won") map[s].won++;
    });
    return Object.entries(map)
      .map(([source, v]) => ({ source, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [leads]);
  const maxSourceCount = Math.max(1, ...sourcePerformance.map((s) => s.total));

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (q) {
        const hay = [l.name, getOrg(l), l.email, l.phone, l.notes, getService(l)].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterStatus && (l.status || "New") !== filterStatus) return false;
      if (filterSource && getSource(l) !== filterSource) return false;

      const assignee = getAssignee(l);
      if (filterAssignee === "mine" && assignee !== currentUser?.id) return false;
      if (filterAssignee === "unassigned" && assignee) return false;
      if (!["all", "mine", "unassigned"].includes(filterAssignee) && assignee !== filterAssignee) return false;

      if (filterFollowUp !== "all") {
        const f = getFollowUp(l);
        if (!f || !isOpen(l)) return false;
        if (filterFollowUp === "overdue" && !(f < today)) return false;
        if (filterFollowUp === "today" && f !== today) return false;
        if (filterFollowUp === "week" && !(f >= today && f <= weekAhead)) return false;
      }
      return true;
    });
  }, [leads, search, filterStatus, filterSource, filterAssignee, filterFollowUp, currentUser?.id, today, weekAhead]);

  const hasFilters = !!(search || filterStatus || filterSource || filterAssignee !== "all" || filterFollowUp !== "all");

  function clearFilters() {
    setSearch("");
    setFilterStatus("");
    setFilterSource("");
    setFilterAssignee("all");
    setFilterFollowUp("all");
  }

  /* ---------------- Modal ---------------- */

  function openModal(lead?: LeadRow) {
    setFormError("");
    setNewDiscussionNote("");
    if (lead) {
      setEditingLead(lead);
      setName(lead.name || "");
      setOrganizationName(getOrg(lead));
      setPhone(lead.phone || "");
      setEmail(lead.email || "");
      setServiceRequested(getService(lead) === "Consultancy" ? "Tax Consultancy" : getService(lead));
      setCustomService("");

      const refClient = getReferringClientId(lead);
      if (refClient) {
        setReferralSource("Existing Client");
        setReferredByClient(refClient);
      } else {
        const src = lead.source || lead.referred_by || "Website";
        setReferralSource(SOURCES.includes(src) ? src : "Other");
        setReferredByClient("");
      }

      setStatus(lead.status || "New");
      setAssignedTo(getAssignee(lead));
      setFollowUpDate(getFollowUp(lead));
      setEstimatedValue(getValue(lead) ? String(getValue(lead)) : "");
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
    if (saving || actionBusy) return;
    setIsModalOpen(false);
    setEditingLead(null);
    setDiscussions([]);
    setConfirmAction(null);
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
    setAssignedTo(currentUser && !currentUser.isAdmin ? currentUser.id : "");
    setFollowUpDate("");
    setEstimatedValue("");
    setNotes("");
  }

  async function handleAddDiscussion(e: React.FormEvent) {
    e.preventDefault();
    const note = newDiscussionNote.trim();
    if (!note || !editingLead || postingNote) return;

    setPostingNote(true);
    await logAuditEvent("POST_DISCUSSION", "LEAD_DISCUSSION", editingLead.id, {
      note,
      author_name: currentUser?.name || "Team Member",
    });
    setNewDiscussionNote("");
    setPostingNote(false);
    loadDiscussions(editingLead.id);
  }

  /** Saves the form. Returns the lead id on success, or null on failure. */
  async function saveLead(closeAfter: boolean): Promise<string | null> {
    setFormError("");

    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName) {
      setFormError("Prospect name is required.");
      return null;
    }
    if (cleanPhone.replace(/\D/g, "").length < 10) {
      setFormError("Please enter a valid mobile number (at least 10 digits).");
      return null;
    }
    if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
      setFormError("Please enter a valid email address.");
      return null;
    }

    const actualService = serviceRequested === "Other" ? customService.trim() : serviceRequested;
    if (!actualService) {
      setFormError("Please enter the custom service name.");
      return null;
    }

    if (referralSource === "Existing Client" && !referredByClient) {
      setFormError("Please choose the referring client.");
      return null;
    }

    const value = estimatedValue ? Number(estimatedValue) : 0;
    if (!Number.isFinite(value) || value < 0) {
      setFormError("Estimated value must be a positive number.");
      return null;
    }

    const isClientReferral = referralSource === "Existing Client" && !!referredByClient;
    const previousAssignee = editingLead ? getAssignee(editingLead) : "";
    const isNewAssignment = !!assignedTo && assignedTo !== previousAssignee;

    const payload: Record<string, any> = {
      name: cleanName,
      organization_name: organizationName.trim(),
      phone: cleanPhone,
      email: cleanEmail || null,
      service_requested: actualService,
      source: referralSource,
      referred_by: isClientReferral ? `CLIENT_ID:${referredByClient}` : referralSource,
      referring_client_id: isClientReferral ? referredByClient : null,
      status: status || "New",
      assigned_to: assignedTo || null,
      follow_up_date: followUpDate || null,
      estimated_value: value,
      notes: notes.trim(),
      // Legacy mirrors (kept until every module reads the new columns)
      company: organizationName.trim(),
      serviceRequested: actualService,
      assignedTo: assignedTo || null,
      followUpDate: followUpDate || null,
      estimatedValue: value,
    };

    setSaving(true);
    try {
      let leadId: string;

      if (editingLead) {
        const { error } = await supabase.from("leads").update(payload).eq("id", editingLead.id);
        if (error) {
          setFormError("Could not save this lead: " + error.message);
          return null;
        }
        leadId = editingLead.id;
        logAuditEvent("UPDATE_LEAD", "LEADS", leadId, { status: payload.status, service: actualService });
      } else {
        const { data, error } = await supabase
          .from("leads")
          .insert([{ ...payload, createdAt: new Date().toISOString(), createdBy: currentUser?.id || null }])
          .select()
          .single();
        if (error || !data) {
          setFormError("Could not create this lead: " + (error?.message || "Unknown error"));
          return null;
        }
        leadId = data.id;
        logAuditEvent("CREATE_LEAD", "LEADS", leadId, { name: cleanName, service: actualService });
      }

      if (isNewAssignment) notifyAssignedStaff(assignedTo, cleanName, actualService);

      if (closeAfter) {
        showToast("success", editingLead ? "Lead updated." : "New enquiry added.");
        setIsModalOpen(false);
        setEditingLead(null);
        setDiscussions([]);
        resetForm();
        fetchInitialData(false);
      }
      return leadId;
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    await saveLead(true);
  }

  async function notifyAssignedStaff(profileId: string, leadName: string, service: string) {
    const assignee = team.find((t) => String(t.id) === String(profileId));
    if (!assignee?.email || String(profileId) === String(currentUser?.id)) return;

    try {
      const formData = new FormData();
      formData.append("to", assignee.email);
      formData.append("subject", `New Lead Assigned: ${leadName}`);
      formData.append(
        "body",
        `Hello ${assignee.name},\n\nYou have been assigned a new lead/enquiry in the Finetax Manager portal:\n\nClient/Prospect Name: ${leadName}\nService Requested: ${service}\nPhone: ${phone || "N/A"}\nEmail: ${email || "N/A"}\nFollow-Up Date: ${followUpDate ? formatDate(followUpDate) : "N/A"}\n\nPlease check your portal to initiate contact.`
      );
      await fetch("/api/send-email", { method: "POST", body: formData });
    } catch (err) {
      console.error("Failed to send lead assignment email:", err);
    }
  }

  async function handleDelete() {
    if (!editingLead) return;
    setActionBusy(true);
    const { error } = await supabase.from("leads").delete().eq("id", editingLead.id);
    setActionBusy(false);
    setConfirmAction(null);

    if (error) {
      showToast("error", "Could not delete this lead. Only administrators can delete leads.");
      return;
    }
    logAuditEvent("DELETE_LEAD", "LEADS", editingLead.id, { name: editingLead.name });
    showToast("success", "Lead deleted.");
    setIsModalOpen(false);
    setEditingLead(null);
    resetForm();
    fetchInitialData(false);
  }

  async function handleConvert() {
    if (!editingLead) return;
    setActionBusy(true);

    // Save any unsaved edits first, then convert in one database transaction
    const savedId = await saveLead(false);
    if (!savedId) {
      setActionBusy(false);
      setConfirmAction(null);
      return;
    }

    const { data: clientId, error } = await supabase.rpc("convert_lead_to_client", { p_lead_id: editingLead.id });
    setActionBusy(false);
    setConfirmAction(null);

    if (error) {
      showToast("error", error.message || "Could not convert this lead.");
      return;
    }

    logAuditEvent("CONVERT_LEAD_TO_CLIENT", "LEADS", editingLead.id, { clientId });
    showToast("success", `${name.trim()} is now an active client.`);
    setIsModalOpen(false);
    setEditingLead(null);
    resetForm();
    fetchInitialData(false);
  }

  /* ---------------- Document checklist ---------------- */

  const currentServiceForChecklist = serviceRequested === "Other" && customService.trim() ? customService.trim() : serviceRequested;
  const activeChecklist = SERVICE_CATALOG[currentServiceForChecklist] || ["Please specify details during discussion (Custom Service)"];

  function sendWhatsAppChecklist() {
    const number = toWhatsAppNumber(phone);
    if (!number) {
      showToast("error", "Please enter a valid mobile number first.");
      return;
    }
    const list = activeChecklist.map((d) => `- ${d}`).join("\n");
    const text = `Hello ${name.trim() || "there"},\n\nThank you for connecting with Finetax.\n\nFor processing your request regarding *${currentServiceForChecklist}*, please provide the following documents/details:\n\n${list}\n\nRegards,\nFinetax Team`;
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  async function sendEmailChecklist() {
    const to = email.trim().toLowerCase();
    setActionBusy(true);

    const list = activeChecklist.map((d) => `• ${d}`).join("\n");
    const body = `Hello ${name.trim() || "there"},\n\nThank you for connecting with Finetax.\n\nFor processing your request regarding ${currentServiceForChecklist}, please provide the following documents/details:\n\n${list}\n\nPlease reply to this email with the attachments.\n\nRegards,\nFinetax Team`;

    try {
      const formData = new FormData();
      formData.append("to", to);
      formData.append("subject", `Document Checklist required for ${currentServiceForChecklist}`);
      formData.append("body", body);
      const res = await fetch("/api/send-email", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        showToast("success", `Checklist emailed to ${to}.`);
        if (editingLead) {
          await logAuditEvent("SEND_CHECKLIST_EMAIL", "LEADS", editingLead.id, { to, service: currentServiceForChecklist });
          loadDiscussions(editingLead.id);
        }
      } else {
        showToast("error", data.error || "Failed to send the email.");
      }
    } catch {
      showToast("error", "A network error occurred while sending the email.");
    } finally {
      setActionBusy(false);
      setConfirmAction(null);
    }
  }

  function requestEmailChecklist() {
    if (!EMAIL_RE.test(email.trim())) {
      showToast("error", "Please enter a valid email address first.");
      return;
    }
    setConfirmAction("email");
  }

  /* ---------------- Render ---------------- */

  const isConverted = !!editingLead?.converted_client_id;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <UserPlus className="h-5 w-5 text-navy" /> Enquiries & Leads
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Track every prospect from first enquiry to signed client, with follow-ups and document checklists.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openModal()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light sm:w-auto"
        >
          <Plus className="h-4 w-4" /> Add Enquiry / Lead
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Open Leads</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-navy">{stats.open}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy/10 text-navy">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">{stats.total} enquiries in total</p>
        </div>

        <button
          type="button"
          onClick={() => setFilterFollowUp(stats.overdue > 0 ? "overdue" : "today")}
          className="rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition hover:border-navy/30 hover:shadow-md"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Follow-ups Due</p>
              <p className={`mt-1.5 text-2xl font-bold tracking-tight ${stats.dueCount > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                {stats.dueCount}
              </p>
            </div>
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${stats.dueCount > 0 ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}>
              <CalendarClock className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            {stats.overdue > 0 ? <span className="font-semibold text-rose-600">{stats.overdue} overdue · click to view</span> : "Nothing overdue"}
          </p>
        </button>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Win Rate</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-emerald-700">{stats.winRate}%</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Target className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            {stats.won} won · {stats.lost} lost
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Pipeline Value</p>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-violet-700">{compactINR(stats.pipelineValue)}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
              <IndianRupee className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">Estimated value of open leads</p>
        </div>
      </div>

      {/* Pipeline stages + Source performance */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm lg:col-span-2">
          <p className="mb-3 text-xs font-semibold text-text-main">Pipeline Stages</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {STATUSES.map((s) => {
              const active = filterStatus === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilterStatus(active ? "" : s)}
                  className={`rounded-lg border p-3 text-left transition ${
                    active ? "border-navy bg-navy/5 ring-2 ring-navy/15" : "border-border hover:bg-surface-alt"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted">
                    <span className={`h-2 w-2 rounded-full ${STATUS_DOTS[s]}`} /> {s}
                  </span>
                  <span className="mt-1 block text-xl font-bold text-text-main">{stats.statusCounts[s] || 0}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-text-main">
            <TrendingUp className="h-3.5 w-3.5 text-navy" /> Lead Sources
          </p>
          {sourcePerformance.length === 0 ? (
            <p className="py-4 text-center text-xs text-text-muted">No leads yet.</p>
          ) : (
            <div className="space-y-2.5">
              {sourcePerformance.map((s) => (
                <button
                  key={s.source}
                  type="button"
                  onClick={() => setFilterSource(filterSource === s.source ? "" : s.source)}
                  className="block w-full text-left"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className={`font-medium ${filterSource === s.source ? "text-navy" : "text-text-main"}`}>{s.source}</span>
                    <span className="text-text-muted">
                      {s.total} · <span className="font-semibold text-emerald-700">{s.won} won</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
                    <div className="h-full rounded-full bg-navy" style={{ width: `${(s.total / maxSourceCount) * 100}%` }} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-surface shadow-sm">
        {/* Toolbar */}
        <div className="flex flex-col gap-2 border-b border-border p-4 lg:flex-row lg:items-center">
          <div className="relative w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search name, organisation, phone, service..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy"
            >
              <option value="">All sources</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
              className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy"
            >
              <option value="all">Everyone</option>
              <option value="mine">My leads</option>
              <option value="unassigned">Unassigned</option>
              {team
                .filter((t) => t.is_active !== false)
                .map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
            </select>
            <select
              value={filterFollowUp}
              onChange={(e) => setFilterFollowUp(e.target.value)}
              className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy"
            >
              <option value="all">Any follow-up</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="week">Next 7 days</option>
            </select>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs font-semibold text-text-muted transition hover:bg-surface-alt hover:text-text-main"
              >
                <X className="h-3.5 w-3.5" /> Clear filters
              </button>
            )}
          </div>
          <span className="text-[11px] text-text-muted lg:ml-auto">
            Showing {filteredLeads.length} of {leads.length}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading enquiries & leads...
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <UserPlus className="h-6 w-6 text-text-muted" />
            <p className="text-xs text-text-muted">{hasFilters ? "No leads match these filters." : "No enquiries yet. Add your first lead."}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Name & Organisation</th>
                  <th>Service</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Assigned To</th>
                  <th>Follow-up</th>
                  <th className="text-right">Est. Value</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((l) => {
                  const follow = getFollowUp(l);
                  const open = isOpen(l);
                  const overdue = open && !!follow && follow < today;
                  const dueToday = open && follow === today;
                  const assignee = teamName(getAssignee(l));
                  const refClientId = getReferringClientId(l);
                  return (
                    <tr key={l.id} className="cursor-pointer transition hover:bg-surface-alt" onClick={() => openModal(l)}>
                      <td>
                        <p className="font-semibold text-navy">{l.name}</p>
                        {getOrg(l) && (
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-text-muted">
                            <Building2 className="h-3 w-3" /> {getOrg(l)}
                          </p>
                        )}
                      </td>
                      <td className="font-medium">{getService(l)}</td>
                      <td>
                        {refClientId ? (
                          <span className="inline-block rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                            Ref: {clientName(refClientId) || "Client"}
                          </span>
                        ) : (
                          <span className="text-text-main">{getSource(l)}</span>
                        )}
                      </td>
                      <td>
                        <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[l.status || "New"] || STATUS_STYLES.New}`}>
                          {l.status || "New"}
                        </span>
                      </td>
                      <td>
                        {assignee ? (
                          <span className="flex items-center gap-1.5">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy/10 text-[9px] font-bold text-navy">
                              {getInitials(assignee)}
                            </span>
                            <span className="whitespace-nowrap">{assignee}</span>
                          </span>
                        ) : (
                          <span className="text-text-muted">Unassigned</span>
                        )}
                      </td>
                      <td>
                        {follow ? (
                          <span
                            className={`inline-flex items-center gap-1 whitespace-nowrap font-medium ${
                              overdue ? "font-semibold text-rose-600" : dueToday ? "font-semibold text-amber-600" : "text-text-main"
                            }`}
                          >
                            {overdue && <AlertCircle className="h-3 w-3" />}
                            {formatDate(follow)}
                            {dueToday && " · Today"}
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-right font-medium">{getValue(l) ? formatINR(getValue(l)) : "—"}</td>
                      <td className="whitespace-nowrap text-text-muted">{l.created_at ? formatDate(l.created_at) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ================= Lead Modal ================= */}
      {isModalOpen && (
        <Modal
          title={editingLead ? "Manage Enquiry / Prospect" : "New Enquiry"}
          subtitle={editingLead ? `Added ${editingLead.created_at ? formatDate(editingLead.created_at) : ""}` : "Capture the prospect's details and requirement."}
          onClose={closeModal}
          maxWidth="max-w-6xl"
          headerExtra={
            isConverted ? (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                <CheckCircle2 className="h-3 w-3" /> Converted to client
                {editingLead?.conversion_date ? ` on ${formatDate(editingLead.conversion_date)}` : ""}
              </span>
            ) : null
          }
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {editingLead && !isConverted && (
                  <button
                    type="button"
                    onClick={() => setConfirmAction("convert")}
                    disabled={saving || actionBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" /> Convert to Active Client
                  </button>
                )}
                {editingLead && isConverted && (
                  <Link
                    href="/clients"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> View in Clients
                  </Link>
                )}
                {editingLead && isAdmin && (
                  <button
                    type="button"
                    onClick={() => setConfirmAction("delete")}
                    disabled={saving || actionBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                )}
              </div>
              <div className="flex gap-2 sm:ml-auto">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt sm:flex-none"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="lead-form"
                  disabled={saving || actionBusy}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-60 sm:flex-none"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {editingLead ? "Save Changes" : "Save Prospect"}
                </button>
              </div>
            </div>
          }
        >
          <div className={`grid grid-cols-1 gap-8 ${editingLead ? "lg:grid-cols-3" : ""}`}>
            {/* LEFT COLUMN: Data Entry & Checklists */}
            <div className={`space-y-5 ${editingLead ? "lg:col-span-2" : ""}`}>
              {formError && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs font-medium text-danger">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <form id="lead-form" onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Prospect Name *</label>
                    <input required type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Amit Verma" />
                  </div>
                  <div>
                    <label className={labelClass}>Organisation Name</label>
                    <input type="text" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} className={inputClass} placeholder="e.g. Verma Traders" />
                  </div>
                  <div>
                    <label className={labelClass}>Mobile Number *</label>
                    <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="98765 43210" />
                  </div>
                  <div>
                    <label className={labelClass}>Email Address</label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="name@example.com" />
                  </div>

                  {/* Dynamic Service Requested */}
                  <div className={serviceRequested === "Other" ? "grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2" : ""}>
                    <div>
                      <label className={`${labelClass} text-navy`}>Service Requested *</label>
                      <select
                        value={serviceRequested}
                        onChange={(e) => setServiceRequested(e.target.value)}
                        className={`${inputClass} border-navy/30 bg-navy/5 font-semibold text-navy`}
                      >
                        {availableServices.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    {serviceRequested === "Other" && (
                      <div>
                        <label className={`${labelClass} text-navy`}>Custom Service Name *</label>
                        <input
                          required
                          type="text"
                          value={customService}
                          onChange={(e) => setCustomService(e.target.value)}
                          placeholder="e.g. Trademark Registration"
                          className={`${inputClass} border-navy/30 bg-navy/5 font-semibold text-navy`}
                        />
                        <p className="mt-1 text-[10px] text-text-muted">Saved automatically to the service list for future leads.</p>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className={labelClass}>Current Status</label>
                    <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Next Follow-up Date</label>
                    <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Estimated Value (₹)</label>
                    <div className="relative">
                      <IndianRupee className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={estimatedValue}
                        onChange={(e) => setEstimatedValue(e.target.value)}
                        className={`${inputClass} pl-8`}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Assigned To</label>
                    <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={inputClass}>
                      <option value="">— Unassigned —</option>
                      {activeTeam.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.is_active === false ? " (inactive)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Reference Tracking */}
                  <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface-alt p-3 sm:col-span-2 sm:grid-cols-2">
                    <div>
                      <label className={`${labelClass} flex items-center gap-1`}>
                        <ArrowRightLeft className="h-3 w-3" /> Referred By (Source)
                      </label>
                      <select
                        value={referralSource}
                        onChange={(e) => {
                          setReferralSource(e.target.value);
                          setReferredByClient("");
                        }}
                        className={inputClass}
                      >
                        {SOURCES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>

                    {referralSource === "Existing Client" && (
                      <div>
                        <label className={`${labelClass} text-amber-700`}>Select Existing Client *</label>
                        <select
                          value={referredByClient}
                          onChange={(e) => setReferredByClient(e.target.value)}
                          required
                          className={`${inputClass} border-amber-300 bg-amber-50`}
                        >
                          <option value="">— Choose Client —</option>
                          {clientsList.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} {c.organization_name ? `(${c.organization_name})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Initial Brief / Notes</label>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className={inputClass}
                    placeholder="Basic details collected during first touchpoint..."
                  />
                </div>
              </form>

              {/* Automated Document Checklist Module */}
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="flex items-center gap-1.5 text-xs font-bold text-indigo-800">
                      <FileText className="h-4 w-4" /> Document Checklist · {currentServiceForChecklist}
                    </h4>
                    <p className="text-[10px] text-text-muted">Auto-generated list based on the requested service.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={sendWhatsAppChecklist}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-600"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={requestEmailChecklist}
                      disabled={actionBusy}
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                    >
                      <Mail className="h-3.5 w-3.5" /> Email
                    </button>
                  </div>
                </div>
                <ul className="list-disc space-y-1 pl-5 text-[11px] font-medium text-text-main">
                  {activeChecklist.map((doc, i) => (
                    <li key={i}>{doc}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* RIGHT COLUMN: Discussion Feed */}
            {editingLead && (
              <div className="flex h-[520px] flex-col border-t border-border pt-6 lg:h-auto lg:min-h-[520px] lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                <div className="mb-4 flex items-center gap-2 border-b border-border pb-2 text-xs font-bold text-navy">
                  <Activity className="h-4 w-4" /> Discussion & Follow-up Log
                </div>

                <div className="mb-4 flex-1 space-y-4 overflow-y-auto pr-2">
                  {loadingDiscussions ? (
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading timeline...
                    </div>
                  ) : discussions.length === 0 ? (
                    <div className="text-xs italic text-text-muted">No discussion history recorded yet.</div>
                  ) : (
                    discussions.map((log: any) => {
                      const isNote = log.entity === "LEAD_DISCUSSION";
                      const author = log.metadata?.author_name || log.metadata?.actor_name || "System";
                      return (
                        <div key={log.id} className="relative border-l-2 border-navy/20 pb-1 pl-4">
                          <div className={`absolute -left-[5px] top-1 h-2 w-2 rounded-full ${isNote ? "bg-navy" : "bg-text-muted"}`} />
                          <div className="mb-0.5 flex items-start justify-between gap-2">
                            <span className="text-[11px] font-bold text-text-main">{author}</span>
                            <span className="whitespace-nowrap text-[10px] text-text-muted">{formatDateTime(log.timestamp)}</span>
                          </div>
                          {isNote ? (
                            <div className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-surface-alt p-2 text-xs text-text-main">
                              {log.metadata?.note || "—"}
                            </div>
                          ) : (
                            <p className="flex items-center gap-1 text-[11px] text-text-muted">
                              <Clock className="h-3 w-3" />
                              {EVENT_LABELS[log.action] || log.action}
                              {log.action === "UPDATE_LEAD" && log.metadata?.status ? ` · status: ${log.metadata.status}` : ""}
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Add Discussion Input */}
                <form onSubmit={handleAddDiscussion} className="mt-auto flex gap-2 border-t border-border pt-3">
                  <input
                    type="text"
                    value={newDiscussionNote}
                    onChange={(e) => setNewDiscussionNote(e.target.value)}
                    maxLength={2000}
                    placeholder="Log a call, email summary, or update..."
                    className={`${inputClass} flex-1`}
                  />
                  <button
                    type="submit"
                    disabled={!newDiscussionNote.trim() || postingNote}
                    className="rounded-lg bg-navy p-2.5 text-white transition hover:bg-navy-light disabled:opacity-50"
                    aria-label="Post note"
                  >
                    {postingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </form>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Confirmations */}
      {confirmAction === "delete" && (
        <ConfirmDialog
          title="Delete this lead?"
          message={`"${editingLead?.name}" and its follow-up dates will be removed. Discussion history stays in the audit log. This cannot be undone.`}
          confirmLabel="Delete lead"
          tone="danger"
          loading={actionBusy}
          onConfirm={handleDelete}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "convert" && (
        <ConfirmDialog
          title="Convert to an active client?"
          message={`Your changes will be saved and "${name.trim()}" will be added to the Client Master as an active client. The lead will be marked as Won.`}
          confirmLabel="Convert to client"
          tone="primary"
          loading={actionBusy}
          onConfirm={handleConvert}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "email" && (
        <ConfirmDialog
          title="Email the document checklist?"
          message={`The ${currentServiceForChecklist} checklist will be sent to ${email.trim()}.`}
          confirmLabel="Send email"
          tone="primary"
          loading={actionBusy}
          onConfirm={sendEmailChecklist}
          onCancel={() => setConfirmAction(null)}
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