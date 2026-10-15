"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  UserCheck,
  Plus,
  Edit2,
  Shield,
  Trash2,
  X,
  Check,
  Lock,
  Phone,
  Briefcase,
  Zap,
  UserX,
  UserCheck2,
  KeyRound,
  Mail,
  Search,
  Copy,
  RefreshCw,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Users,
  ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import PasswordInput from "@/components/ui/PasswordInput";
import { getInitials } from "@/lib/format";
import { validatePassword } from "@/lib/password";

const MODULE_OPTIONS = [
  { id: "leads", short: "Leads", label: "Enquiries & Business Growth", desc: "Leads, pipeline stages, and conversion tracking" },
  { id: "quotations", short: "Quotations", label: "Quotations Engine", desc: "Fee proposals, custom line items, and PDF exports" },
  { id: "tasks", short: "Tasks", label: "Tasks & Compliance Matrix", desc: "Task tracking, compliance board, and assignments" },
  { id: "calendar", short: "Calendar", label: "Compliance Calendar", desc: "Tax due dates, statutory deadlines, and filing schedule" },
  { id: "discussions", short: "Discussions", label: "Client Discussions", desc: "Communication history and client notes" },
  { id: "time_tracking", short: "Time Tracking", label: "Office Log Sheet & Timers", desc: "Live stopwatch and billable time logs" },
  { id: "invoices", short: "Invoices", label: "Invoices & Billing", desc: "Tax invoices, payment statuses, and revenue reports" },
  { id: "documents", short: "Documents", label: "Document Vault", desc: "Client document uploads and file organization" },
  { id: "team", short: "Team", label: "Team Management", desc: "Manage staff accounts and operational roles" },
  { id: "packages", short: "Packages", label: "Service Package Workflows", desc: "Retainer onboarding and recurring sub-tasks" },
  { id: "settings", short: "Settings", label: "Firm Settings & Roles", desc: "Finetax configuration and system role controls" },
];

const MODULE_SHORT: Record<string, string> = Object.fromEntries(MODULE_OPTIONS.map((m) => [m.id, m.short]));

const ROLE_PRESETS = [
  {
    label: "Execution Staff",
    role: "staff",
    isReviewer: false,
    modules: ["leads", "tasks", "time_tracking"],
  },
  {
    label: "Senior Staff / Reviewer",
    role: "staff",
    isReviewer: true,
    modules: ["leads", "tasks", "time_tracking", "packages"],
  },
  {
    label: "Administrator",
    role: "admin",
    isReviewer: true,
    modules: ["leads", "tasks", "invoices", "time_tracking", "packages"],
  },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SecurityMode = "set_password" | "send_reset_link" | "update_email";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15 disabled:bg-surface-alt disabled:text-text-muted";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

/** Cryptographically secure random password (letters + numbers + symbols). */
function generatePassword(length = 14): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$%&*";
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  let pw = Array.from(values, (n) => chars[n % chars.length]).join("");
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) pw = pw.slice(0, -2) + "a7";
  return pw;
}

/* ---------------- Small UI helpers ---------------- */

function Modal({
  title,
  subtitle,
  onClose,
  children,
  maxWidth = "max-w-xl",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 animate-fade-in sm:items-center">
      <div
        className={`my-8 w-full ${maxWidth} rounded-xl border border-border bg-surface shadow-2xl animate-scale-in`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-text-main">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition hover:bg-surface-alt hover:text-text-main"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs font-medium text-danger">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function SuccessBox({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div role="status" className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{message}</span>
      </div>
      {children}
    </div>
  );
}

/* ---------------- Page ---------------- */

export default function TeamPage() {
  const currentUser = useCurrentUser();
  const [supabase] = useState(() => createClient());

  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Add / Edit modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Form State
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [designation, setDesignation] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("staff");
  const [isReviewer, setIsReviewer] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [moduleAccess, setModuleAccess] = useState<string[]>(["leads", "tasks", "time_tracking"]);

  // Security dialog state
  const [securityTarget, setSecurityTarget] = useState<any | null>(null);
  const [securityMode, setSecurityMode] = useState<SecurityMode>("set_password");
  const [secNewPassword, setSecNewPassword] = useState("");
  const [secConfirm, setSecConfirm] = useState("");
  const [secEmail, setSecEmail] = useState("");
  const [secAdminPassword, setSecAdminPassword] = useState("");
  const [secSubmitting, setSecSubmitting] = useState(false);
  const [secError, setSecError] = useState("");
  const [secSuccess, setSecSuccess] = useState("");

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [delAdminPassword, setDelAdminPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState("");

  useEffect(() => {
    loadTeam();
  }, []);

  async function loadTeam() {
    setLoading(true);
    const { data, error } = await supabase.from("profiles").select("*").order("name", { ascending: true });
    if (error) showToast("error", "Could not load the team. Please refresh the page.");
    if (data) setTeam(data);
    setLoading(false);
  }

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4500);
  }

  function isSelf(member: any) {
    return !!currentUser && member?.id === currentUser.id;
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("success", "Copied to clipboard.");
    } catch {
      showToast("error", "Could not copy. Please copy it manually.");
    }
  }

  /* ---------------- Derived data ---------------- */

  const stats = useMemo(
    () => ({
      total: team.length,
      active: team.filter((m) => m.is_active !== false).length,
      admins: team.filter((m) => m.role === "admin").length,
      reviewers: team.filter((m) => m.is_reviewer).length,
    }),
    [team]
  );

  const filteredTeam = useMemo(() => {
    const q = search.trim().toLowerCase();
    return team.filter((m) => {
      if (statusFilter === "active" && m.is_active === false) return false;
      if (statusFilter === "disabled" && m.is_active !== false) return false;
      if (!q) return true;
      return [m.name, m.email, m.designation, m.phone].filter(Boolean).some((f) => String(f).toLowerCase().includes(q));
    });
  }, [team, search, statusFilter]);

  /* ---------------- Add / Edit ---------------- */

  function applyPreset(preset: (typeof ROLE_PRESETS)[0]) {
    setRole(preset.role);
    setIsReviewer(preset.isReviewer);
    setModuleAccess(preset.modules);
  }

  function handleModuleToggle(moduleId: string) {
    if (moduleAccess.includes(moduleId)) {
      setModuleAccess(moduleAccess.filter((m) => m !== moduleId));
    } else {
      setModuleAccess([...moduleAccess, moduleId]);
    }
  }

  function openModal(member?: any) {
    setFormError("");
    if (member) {
      setEditingMember(member);
      setFullName(member.name || "");
      setEmail(member.email || "");
      setPhone(member.phone || "");
      setDesignation(member.designation || "");
      setPassword("");
      setRole(member.role || "staff");
      setIsReviewer(member.is_reviewer || false);
      setIsActive(member.is_active ?? true);
      setModuleAccess(Array.isArray(member.module_access) ? member.module_access : ["leads", "tasks", "time_tracking"]);
    } else {
      setEditingMember(null);
      resetForm();
    }
    setIsModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setIsModalOpen(false);
    setFormError("");
  }

  function resetForm() {
    setFullName("");
    setEmail("");
    setPhone("");
    setDesignation("");
    setPassword("");
    setRole("staff");
    setIsReviewer(false);
    setIsActive(true);
    setModuleAccess(["leads", "tasks", "time_tracking"]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setFormError("");

    const name = fullName.trim();
    if (!name) {
      setFormError("Full name is required.");
      return;
    }

    const basePayload = {
      name,
      phone: phone.trim(),
      designation: designation.trim(),
      role,
      is_reviewer: isReviewer,
      is_active: isActive,
      module_access: moduleAccess,
    };

    setSaving(true);

    try {
      if (editingMember) {
        if (isSelf(editingMember) && (role !== "admin" || !isActive)) {
          setFormError("You can't remove your own admin access or disable your own account.");
          return;
        }

        // Email is intentionally NOT updated here — use "Change login email" so the login stays in sync
        const { error } = await supabase.from("profiles").update(basePayload).eq("id", editingMember.id);

        if (error) {
          setFormError(error.message || "Could not update this team member.");
          return;
        }

        logAuditEvent("UPDATE_TEAM_MEMBER", "PROFILES", editingMember.id, basePayload);
        showToast("success", `${name} has been updated.`);
      } else {
        const cleanEmail = email.trim().toLowerCase();
        if (!EMAIL_RE.test(cleanEmail)) {
          setFormError("Please enter a valid email address.");
          return;
        }

        const problem = validatePassword(password);
        if (problem) {
          setFormError(problem);
          return;
        }

        // Secure admin route creates the login AND the profile together
        const res = await fetch("/api/admin/create-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...basePayload, email: cleanEmail, password }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || data.error) {
          setFormError(data.error || "Failed to create the account.");
          return;
        }

        logAuditEvent("CREATE_TEAM_MEMBER", "PROFILES", data.user?.id, { ...basePayload, email: cleanEmail });
        showToast("success", `${name} has been added. Share their password privately.`);
      }

      setIsModalOpen(false);
      resetForm();
      loadTeam();
    } catch {
      setFormError("A network error occurred. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  /* ---------------- Security dialog ---------------- */

  function openSecurity(member: any, mode: SecurityMode = "set_password") {
    setSecurityTarget(member);
    setSecurityMode(mode);
    setSecNewPassword("");
    setSecConfirm("");
    setSecEmail(member.email || "");
    setSecAdminPassword("");
    setSecError("");
    setSecSuccess("");
  }

  function closeSecurity() {
    if (secSubmitting) return;
    setSecurityTarget(null);
    setSecAdminPassword("");
    setSecNewPassword("");
    setSecConfirm("");
  }

  async function submitSecurity(e: React.FormEvent) {
    e.preventDefault();
    if (secSubmitting || !securityTarget) return;
    setSecError("");
    setSecSuccess("");

    const payload: Record<string, unknown> = {
      action: securityMode,
      userId: securityTarget.id,
      adminPassword: secAdminPassword,
    };

    if (securityMode === "set_password") {
      const problem = validatePassword(secNewPassword);
      if (problem) {
        setSecError(problem);
        return;
      }
      if (secNewPassword !== secConfirm) {
        setSecError("The two passwords do not match.");
        return;
      }
      payload.newPassword = secNewPassword;
    }

    if (securityMode === "update_email") {
      const cleanEmail = secEmail.trim().toLowerCase();
      if (!EMAIL_RE.test(cleanEmail)) {
        setSecError("Please enter a valid email address.");
        return;
      }
      payload.email = cleanEmail;
    }

    if (!secAdminPassword) {
      setSecError("Please confirm your own password to continue.");
      return;
    }

    setSecSubmitting(true);
    try {
      const res = await fetch("/api/admin/manage-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        setSecError(data.error || "Something went wrong. Please try again.");
        return;
      }

      setSecSuccess(data.message || "Done.");
      setSecAdminPassword("");
      if (securityMode === "update_email") loadTeam();
    } catch {
      setSecError("A network error occurred. Please try again.");
    } finally {
      setSecSubmitting(false);
    }
  }

  /* ---------------- Deactivate / Delete ---------------- */

  function openDelete(member: any) {
    setDeleteTarget(member);
    setDelAdminPassword("");
    setDelError("");
  }

  function closeDelete() {
    if (deleting) return;
    setDeleteTarget(null);
    setDelAdminPassword("");
  }

  async function deactivateMember(member: any) {
    if (isSelf(member)) {
      showToast("error", "You can't disable your own account.");
      return;
    }
    setDeleting(true);
    const { error } = await supabase.from("profiles").update({ is_active: false }).eq("id", member.id);
    setDeleting(false);

    if (error) {
      setDelError(error.message || "Could not deactivate this account.");
      return;
    }

    logAuditEvent("DEACTIVATE_TEAM_MEMBER", "PROFILES", member.id, { name: member.name });
    showToast("success", `${member.name} has been deactivated and can no longer sign in.`);
    setDeleteTarget(null);
    loadTeam();
  }

  async function submitDelete(e: React.FormEvent) {
    e.preventDefault();
    if (deleting || !deleteTarget) return;
    setDelError("");

    if (!delAdminPassword) {
      setDelError("Please confirm your own password to continue.");
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch("/api/admin/manage-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_user", userId: deleteTarget.id, adminPassword: delAdminPassword }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        setDelError(data.error || "Could not delete this person.");
        return;
      }

      showToast("success", data.message || "Team member removed.");
      setDeleteTarget(null);
      setDelAdminPassword("");
      loadTeam();
    } catch {
      setDelError("A network error occurred. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  /* ---------------- Render ---------------- */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <UserCheck className="h-5 w-5 text-navy" /> Firm Team & Permission Console
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Manage Finetax staff, reviewer gatekeeper access, module-level permissions and login security.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openModal()}
          className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light"
        >
          <Plus className="h-4 w-4" /> Add Team Member
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Team Members", value: stats.total, icon: Users, style: "bg-navy/10 text-navy" },
          { label: "Active Accounts", value: stats.active, icon: UserCheck2, style: "bg-emerald-50 text-emerald-600" },
          { label: "Administrators", value: stats.admins, icon: ShieldCheck, style: "bg-accent-soft text-accent" },
          { label: "Reviewers", value: stats.reviewers, icon: Shield, style: "bg-violet-50 text-violet-600" },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-center justify-between rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{s.label}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-text-main">{s.value}</p>
              </div>
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${s.style}`}>
                <Icon className="h-4 w-4" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Team Table */}
      <div className="rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, designation..."
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
            />
          </div>
          <div className="flex rounded-lg border border-border bg-surface-alt p-0.5 text-xs font-semibold">
            {(["all", "active", "disabled"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={`rounded-md px-3 py-1.5 capitalize transition ${
                  statusFilter === f ? "bg-surface text-navy shadow-sm" : "text-text-muted hover:text-text-main"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading team roster...
          </div>
        ) : filteredTeam.length === 0 ? (
          <div className="p-10 text-center text-xs text-text-muted">No team members match your search.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Member Details</th>
                  <th>Role & Designation</th>
                  <th>Reviewer Status</th>
                  <th>Status</th>
                  <th>Module Permissions</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeam.map((member) => {
                  const self = isSelf(member);
                  const modules: string[] = Array.isArray(member.module_access) ? member.module_access : [];
                  return (
                    <tr key={member.id} className="transition hover:bg-surface-alt">
                      <td>
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              member.is_active === false ? "bg-border text-text-muted" : "bg-navy text-white"
                            }`}
                          >
                            {getInitials(member.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-sm font-semibold text-navy">
                              <span className="truncate">{member.name}</span>
                              {self && (
                                <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] font-bold uppercase text-accent">You</span>
                              )}
                            </p>
                            <p className="truncate text-[11px] text-text-muted">{member.email}</p>
                            {member.phone && (
                              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-text-muted">
                                <Phone className="h-3 w-3" /> {member.phone}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                            member.role === "admin"
                              ? "border-accent/30 bg-accent-soft text-accent"
                              : "border-border bg-surface-alt text-text-main"
                          }`}
                        >
                          {member.role === "admin" ? "Admin" : "Staff"}
                        </span>
                        <p className="mt-1 text-[11px] text-text-muted">{member.designation || "Staff Member"}</p>
                      </td>
                      <td>
                        {member.is_reviewer ? (
                          <span className="inline-flex w-max items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                            <Shield className="h-3 w-3" /> Gatekeeper Enabled
                          </span>
                        ) : (
                          <span className="text-[11px] text-text-muted">—</span>
                        )}
                      </td>
                      <td>
                        {member.is_active !== false ? (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                            Active
                          </span>
                        ) : (
                          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600">
                            Disabled
                          </span>
                        )}
                      </td>
                      <td>
                        {member.role === "admin" ? (
                          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">All modules</span>
                        ) : (
                          <div className="flex max-w-xs flex-wrap gap-1">
                            {modules.length === 0 && <span className="text-[11px] text-text-muted">No modules</span>}
                            {modules.map((m) => (
                              <span key={m} className="rounded bg-navy/10 px-1.5 py-0.5 text-[10px] font-medium text-navy">
                                {MODULE_SHORT[m] || m}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            onClick={() => openModal(member)}
                            className="rounded-md border border-border p-1.5 text-navy transition hover:bg-surface-alt"
                            title="Edit member & permissions"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openSecurity(member)}
                            className="rounded-md border border-border p-1.5 text-amber-600 transition hover:bg-amber-50"
                            title="Password & login security"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                          {member.role !== "admin" && !self && (
                            <button
                              type="button"
                              onClick={() => openDelete(member)}
                              className="rounded-md border border-border p-1.5 text-rose-600 transition hover:bg-rose-50"
                              title="Deactivate or remove member"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
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

      {/* ================= Add / Edit Modal ================= */}
      {isModalOpen && (
        <Modal
          title={editingMember ? "Modify Team Member & Permissions" : "Add New Team Member"}
          subtitle="Configure operational scope and module capabilities."
          onClose={closeModal}
          maxWidth="max-w-2xl"
        >
          {/* Role Preset Selector Bar */}
          <div className="mb-5 space-y-2 rounded-lg border border-border bg-surface-alt p-3">
            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-navy">
              <Zap className="h-3 w-3 text-amber-500" /> Quick Permission Presets
            </span>
            <div className="flex flex-wrap gap-2">
              {ROLE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-main shadow-sm transition hover:border-navy"
                >
                  + {p.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {formError && <ErrorBox message={formError} />}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Full Name *</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={inputClass}
                  placeholder="e.g. Rahul Sharma"
                />
              </div>

              <div>
                <label className={labelClass}>Official Email *</label>
                {editingMember ? (
                  <div className="flex gap-2">
                    <input type="email" value={email} disabled className={inputClass} />
                    <button
                      type="button"
                      onClick={() => openSecurity(editingMember, "update_email")}
                      className="shrink-0 rounded-lg border border-border px-3 text-xs font-semibold text-navy transition hover:bg-surface-alt"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                    placeholder="rahul@firm.com"
                    autoComplete="off"
                  />
                )}
              </div>

              <div>
                <label className={labelClass}>Mobile Number</label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={`${inputClass} pl-9`}
                    placeholder="+91 98765 43210"
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Designation / Job Title</label>
                <div className="relative">
                  <Briefcase className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    className={`${inputClass} pl-9`}
                    placeholder="e.g. Senior GST Article"
                  />
                </div>
              </div>
            </div>

            {/* Password (new members) / Security shortcut (existing members) */}
            {editingMember ? (
              <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-1 text-xs font-bold text-navy">
                    <Lock className="h-3.5 w-3.5 text-amber-600" /> Login & Password
                  </p>
                  <p className="text-[11px] text-text-muted">Reset the password or change the login email securely.</p>
                </div>
                <button
                  type="button"
                  onClick={() => openSecurity(editingMember, "set_password")}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-navy shadow-sm transition hover:bg-surface-alt"
                >
                  <KeyRound className="h-3.5 w-3.5" /> Manage login security
                </button>
              </div>
            ) : (
              <div>
                <PasswordInput
                  label="Initial Password *"
                  value={password}
                  onChange={setPassword}
                  autoComplete="new-password"
                  showStrength
                  required
                  placeholder="At least 8 characters, with letters and numbers"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPassword(generatePassword())}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-navy transition hover:bg-surface-alt"
                  >
                    <RefreshCw className="h-3 w-3" /> Generate strong password
                  </button>
                  {password && (
                    <button
                      type="button"
                      onClick={() => copyText(password)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-navy transition hover:bg-surface-alt"
                    >
                      <Copy className="h-3 w-3" /> Copy password
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Primary System Role *</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  disabled={!!editingMember && isSelf(editingMember)}
                  className={`${inputClass} font-semibold text-navy`}
                >
                  <option value="staff">Execution Staff</option>
                  <option value="admin">Administrator (Full System Control)</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>Account Status</label>
                <button
                  type="button"
                  onClick={() => setIsActive(!isActive)}
                  disabled={!!editingMember && isSelf(editingMember)}
                  className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {isActive ? <UserCheck2 className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
                  {isActive ? "Account Active" : "Account Disabled"}
                </button>
              </div>
            </div>

            {editingMember && isSelf(editingMember) && (
              <p className="text-[11px] text-text-muted">
                You can't change your own role or disable your own account, to prevent lockouts.
              </p>
            )}

            {/* Reviewer Gatekeeper Access Box */}
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/70 p-3">
              <div>
                <p className="flex items-center gap-1 text-xs font-bold text-navy">
                  <Shield className="h-3.5 w-3.5 text-blue-600" /> Enable Task Reviewer Access
                </p>
                <p className="text-[11px] text-text-muted">
                  Grants access to inspect, add feedback, and approve/reject staff submissions.
                </p>
              </div>
              <input
                type="checkbox"
                checked={isReviewer}
                onChange={(e) => setIsReviewer(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-navy"
              />
            </label>

            {/* Granular Module Access Cards */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Granular Module Access</label>
                <div className="flex gap-2 text-[11px] font-semibold">
                  <button type="button" onClick={() => setModuleAccess(MODULE_OPTIONS.map((m) => m.id))} className="text-navy hover:underline">
                    Select all
                  </button>
                  <span className="text-border">|</span>
                  <button type="button" onClick={() => setModuleAccess([])} className="text-text-muted hover:underline">
                    Clear
                  </button>
                </div>
              </div>
              {role === "admin" && (
                <p className="mb-2 text-[11px] text-text-muted">Administrators automatically have access to every module.</p>
              )}
              <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {MODULE_OPTIONS.map((m) => {
                  const isChecked = moduleAccess.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleModuleToggle(m.id)}
                      className={`flex items-start justify-between gap-2 rounded-lg border p-2.5 text-left transition ${
                        isChecked ? "border-navy bg-navy/5" : "border-border bg-surface hover:bg-surface-alt"
                      }`}
                    >
                      <div>
                        <p className="text-xs font-bold text-navy">{m.label}</p>
                        <p className="text-[10px] text-text-muted">{m.desc}</p>
                      </div>
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          isChecked ? "border-navy bg-navy text-white" : "border-border bg-surface"
                        }`}
                      >
                        {isChecked && <Check className="h-3 w-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingMember ? "Save Changes" : "Create Team Member"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ================= Security Dialog ================= */}
      {securityTarget && (
        <Modal
          title={`Login Security · ${securityTarget.name}`}
          subtitle="Sensitive actions require confirming your own password."
          onClose={closeSecurity}
          maxWidth="max-w-lg"
        >
          <form onSubmit={submitSecurity} className="space-y-4">
            {/* Tabs */}
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-alt p-1 text-[11px] font-semibold">
              {(
                [
                  { mode: "set_password", label: "Set password", icon: KeyRound },
                  { mode: "send_reset_link", label: "Email reset link", icon: Mail },
                  { mode: "update_email", label: "Change email", icon: Edit2 },
                ] as { mode: SecurityMode; label: string; icon: typeof KeyRound }[]
              ).map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.mode}
                    type="button"
                    onClick={() => {
                      setSecurityMode(t.mode);
                      setSecError("");
                      setSecSuccess("");
                    }}
                    className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 transition ${
                      securityMode === t.mode ? "bg-surface text-navy shadow-sm" : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {t.label}
                  </button>
                );
              })}
            </div>

            {/* Mode content */}
            {securityMode === "set_password" && (
              <div className="space-y-3">
                <PasswordInput
                  label="New Password"
                  value={secNewPassword}
                  onChange={setSecNewPassword}
                  autoComplete="new-password"
                  showStrength
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const pw = generatePassword();
                      setSecNewPassword(pw);
                      setSecConfirm(pw);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-navy transition hover:bg-surface-alt"
                  >
                    <RefreshCw className="h-3 w-3" /> Generate strong password
                  </button>
                  {secNewPassword && (
                    <button
                      type="button"
                      onClick={() => copyText(secNewPassword)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-navy transition hover:bg-surface-alt"
                    >
                      <Copy className="h-3 w-3" /> Copy password
                    </button>
                  )}
                </div>
                <PasswordInput
                  label="Confirm New Password"
                  value={secConfirm}
                  onChange={setSecConfirm}
                  autoComplete="new-password"
                />
                <p className="text-[11px] text-text-muted">
                  Their old password stops working immediately. Share the new one privately.
                </p>
              </div>
            )}

            {securityMode === "send_reset_link" && (
              <div className="space-y-2 rounded-lg border border-border bg-surface-alt p-3 text-xs">
                <p className="text-text-main">
                  A secure reset link will be emailed to <span className="font-semibold">{securityTarget.email}</span>.
                </p>
                <p className="text-[11px] text-text-muted">
                  This only works after email sending (custom SMTP) is set up in Supabase. Until then, use "Set password".
                </p>
              </div>
            )}

            {securityMode === "update_email" && (
              <div className="space-y-2">
                <label className={labelClass}>New Login Email</label>
                <input
                  type="email"
                  value={secEmail}
                  onChange={(e) => setSecEmail(e.target.value)}
                  className={inputClass}
                  placeholder="name@firm.com"
                  autoComplete="off"
                />
                <p className="text-[11px] text-text-muted">
                  Updates both their sign-in email and the Team page. Their password stays the same.
                </p>
              </div>
            )}

            {/* Admin re-authentication */}
            <div className="border-t border-border pt-4">
              <PasswordInput
                label="Confirm With YOUR Password"
                value={secAdminPassword}
                onChange={setSecAdminPassword}
                autoComplete="current-password"
                hint="Required to protect accounts if someone else uses your computer."
              />
            </div>

            {secError && <ErrorBox message={secError} />}
            {secSuccess && (
              <SuccessBox message={secSuccess}>
                {securityMode === "set_password" && secNewPassword && (
                  <button
                    type="button"
                    onClick={() => copyText(secNewPassword)}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-surface px-2.5 py-1 text-[11px] font-semibold text-emerald-800"
                  >
                    <Copy className="h-3 w-3" /> Copy new password
                  </button>
                )}
              </SuccessBox>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeSecurity}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt"
              >
                {secSuccess ? "Done" : "Cancel"}
              </button>
              {!secSuccess && (
                <button
                  type="submit"
                  disabled={secSubmitting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-60"
                >
                  {secSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {securityMode === "set_password" && "Update Password"}
                  {securityMode === "send_reset_link" && "Send Reset Link"}
                  {securityMode === "update_email" && "Update Email"}
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}

      {/* ================= Deactivate / Delete Dialog ================= */}
      {deleteTarget && (
        <Modal title={`Remove ${deleteTarget.name}?`} onClose={closeDelete} maxWidth="max-w-md">
          <div className="space-y-4 text-xs">
            {deleteTarget.is_active !== false && (
              <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                <p className="font-bold text-emerald-800">Recommended: deactivate</p>
                <p className="text-emerald-800/80">
                  They can no longer sign in, but their tasks, time logs and history stay intact. You can reactivate them later.
                </p>
                <button
                  type="button"
                  onClick={() => deactivateMember(deleteTarget)}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  <UserX className="h-3.5 w-3.5" /> Deactivate account
                </button>
              </div>
            )}

            <form onSubmit={submitDelete} className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/40 p-3">
              <p className="font-bold text-rose-700">Delete permanently</p>
              <p className="text-rose-700/80">
                Removes their login and profile completely. This cannot be undone, and is blocked if they have linked work records.
              </p>
              <PasswordInput
                label="Confirm With YOUR Password"
                value={delAdminPassword}
                onChange={setDelAdminPassword}
                autoComplete="current-password"
              />
              {delError && <ErrorBox message={delError} />}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDelete}
                  className="rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-4 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <Trash2 className="h-3.5 w-3.5" /> Delete permanently
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-[70] flex max-w-sm items-start gap-2 rounded-lg border px-4 py-3 text-xs font-semibold shadow-lg animate-scale-in ${
            toast.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {toast.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}