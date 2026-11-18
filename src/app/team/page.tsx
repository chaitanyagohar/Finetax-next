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
  Send,
  Clock,
} from "lucide-react";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/layout/UserContext";
import PasswordInput from "@/components/ui/PasswordInput";
import { formatDate, getInitials } from "@/lib/format";
import { validatePassword } from "@/lib/password";
import { EMAIL_RE } from "@/lib/validate";

const MODULE_OPTIONS = [
  { id: "leads", short: "Leads", label: "Clients & leads", desc: "Client master, enquiries and follow-ups" },
  { id: "quotations", short: "Quotations", label: "Quotations", desc: "Fee proposals and PDF quotations" },
  { id: "tasks", short: "Tasks", label: "Tasks & compliance", desc: "Task board, deadlines and assignments" },
  { id: "calendar", short: "Calendar", label: "Compliance calendar", desc: "Statutory and internal due dates" },
  { id: "discussions", short: "Discussions", label: "Client discussions", desc: "Call notes and client history" },
  { id: "time_tracking", short: "Time", label: "Time tracking", desc: "Timers, timesheets and attendance" },
  { id: "invoices", short: "Invoices", label: "Invoices & payments", desc: "Tax invoices and receivables" },
  { id: "documents", short: "Documents", label: "Document vault", desc: "Client files and share links" },
  { id: "dashboard", short: "Inbox", label: "Firm inbox", desc: "Read and send from firm mailboxes" },
];
const MODULE_SHORT: Record<string, string> = Object.fromEntries(MODULE_OPTIONS.map((m) => [m.id, m.short]));

const ROLE_PRESETS = [
  { label: "Execution staff", role: "staff", isReviewer: false, modules: ["leads", "tasks", "time_tracking"] },
  { label: "Senior staff / reviewer", role: "staff", isReviewer: true, modules: ["leads", "tasks", "time_tracking", "calendar", "documents"] },
  { label: "Administrator", role: "admin", isReviewer: true, modules: [] as string[] },
];


type Member = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  designation: string | null;
  role: string;
  is_reviewer: boolean;
  is_active: boolean;
  module_access: string[] | null;
  joined_at: string;
  invite_pending: boolean;
  last_sign_in_at: string | null;
};
type SecurityMode = "set_password" | "send_reset_link" | "update_email";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15 disabled:bg-surface-alt disabled:text-text-muted";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

function generatePassword(length = 14): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$%&*";
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  let pw = Array.from(values, (n) => chars[n % chars.length]).join("");
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) pw = pw.slice(0, -2) + "a7";
  return pw;
}

function Modal({ title, subtitle, onClose, children, maxWidth = "max-w-xl" }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; maxWidth?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 animate-fade-in sm:items-center">
      <div className={`my-8 w-full ${maxWidth} rounded-xl border border-border bg-surface shadow-2xl animate-scale-in`} role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-text-main">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-text-muted transition hover:bg-surface-alt hover:text-text-main" aria-label="Close">
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

export default function TeamPage() {
  const currentUser = useCurrentUser();
  const [supabase] = useState(() => createClient());

  const [team, setTeam] = useState<Member[]>([]);
  const [plan, setPlan] = useState<{ plan_name: string; max_users: number | null; users: number; status: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "invited" | "disabled">("all");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Invite / edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [designation, setDesignation] = useState("");
  const [role, setRole] = useState("staff");
  const [isReviewer, setIsReviewer] = useState(false);
  const [moduleAccess, setModuleAccess] = useState<string[]>(["leads", "tasks", "time_tracking"]);

  // Row actions (deactivate, reactivate, resend, cancel)
  const [confirm, setConfirm] = useState<null | { member: Member; action: "deactivate" | "reactivate" | "resend_invite" | "cancel_invite" }>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Login security
  const [securityTarget, setSecurityTarget] = useState<Member | null>(null);
  const [securityMode, setSecurityMode] = useState<SecurityMode>("send_reset_link");
  const [secNewPassword, setSecNewPassword] = useState("");
  const [secConfirm, setSecConfirm] = useState("");
  const [secEmail, setSecEmail] = useState("");
  const [secAdminPassword, setSecAdminPassword] = useState("");
  const [secSubmitting, setSecSubmitting] = useState(false);
  const [secError, setSecError] = useState("");
  const [secSuccess, setSecSuccess] = useState("");

  // Permanent delete (only for people with no work history)
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);
  const [delAdminPassword, setDelAdminPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState("");

  useEffect(() => {
    loadTeam();
  }, []);

  async function loadTeam() {
    setLoading(true);
    const [{ data, error }, { data: planData }] = await Promise.all([supabase.rpc("firm_members"), supabase.rpc("my_plan")]);
    setPlan((planData as any) || null);
    if (error) showToast("error", "Could not load the team. Refresh the page.");
    setTeam(((data as Member[]) || []).map((m) => ({ ...m, module_access: Array.isArray(m.module_access) ? m.module_access : null })));
    setLoading(false);
  }

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 5000);
  }

  const isSelf = (m: Member | null) => !!currentUser && !!m && m.id === currentUser.id;

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("success", "Copied.");
    } catch {
      showToast("error", "Could not copy. Copy it manually.");
    }
  }

  const statusOf = (m: Member) => (m.invite_pending ? "invited" : m.is_active ? "active" : "disabled");

  const stats = useMemo(
    () => ({
      active: team.filter((m) => statusOf(m) === "active").length,
      invited: team.filter((m) => statusOf(m) === "invited").length,
      admins: team.filter((m) => m.role === "admin" && m.is_active).length,
      reviewers: team.filter((m) => (m.is_reviewer || m.role === "admin") && m.is_active).length,
    }),
    [team]
  );

  const filteredTeam = useMemo(() => {
    const q = search.trim().toLowerCase();
    return team.filter((m) => {
      if (statusFilter !== "all" && statusOf(m) !== statusFilter) return false;
      if (!q) return true;
      return [m.name, m.email, m.designation, m.phone].filter(Boolean).some((f) => String(f).toLowerCase().includes(q));
    });
  }, [team, search, statusFilter]);

  /* ---------------- Invite / edit ---------------- */

  function applyPreset(p: (typeof ROLE_PRESETS)[number]) {
    setRole(p.role);
    setIsReviewer(p.isReviewer);
    if (p.role !== "admin") setModuleAccess(p.modules);
  }

  function openModal(member?: Member) {
    setFormError("");
    if (member) {
      setEditingMember(member);
      setFullName(member.name || "");
      setEmail(member.email || "");
      setPhone(member.phone || "");
      setDesignation(member.designation || "");
      setRole(member.role || "staff");
      setIsReviewer(!!member.is_reviewer);
      setModuleAccess(member.module_access || ["leads", "tasks", "time_tracking"]);
    } else {
      setEditingMember(null);
      setFullName("");
      setEmail("");
      setPhone("");
      setDesignation("");
      setRole("staff");
      setIsReviewer(false);
      setModuleAccess(["leads", "tasks", "time_tracking"]);
    }
    setIsModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setFormError("");
    if (fullName.trim().length < 2) return setFormError("Enter the person's full name.");
    if (!editingMember && !EMAIL_RE.test(email.trim())) return setFormError("Enter a valid email address.");

    const payload = {
      name: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      designation: designation.trim(),
      role,
      is_reviewer: isReviewer,
      module_access: moduleAccess,
    };

    setSaving(true);
    try {
      const res = await fetch(editingMember ? "/api/admin/update-member" : "/api/admin/invite-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingMember ? { ...payload, action: "update", userId: editingMember.id } : payload),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return setFormError(out.error || "Could not save. Try again.");

      if (editingMember) showToast("success", out.message || "Saved.");
      else showToast("success", `Invitation sent to ${payload.email}. They join your firm once they accept.`);

      setIsModalOpen(false);
      loadTeam();
    } catch {
      setFormError("A network error occurred. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function runAction() {
    if (!confirm || actionBusy) return;
    setActionBusy(true);
    try {
      const res = await fetch("/api/admin/update-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: confirm.action, userId: confirm.member.id }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) showToast("error", out.error || "Could not complete that.");
      else showToast("success", out.message || "Done.");
      setConfirm(null);
      loadTeam();
    } catch {
      showToast("error", "A network error occurred. Try again.");
    } finally {
      setActionBusy(false);
    }
  }

  /* ---------------- Login security ---------------- */

  function openSecurity(member: Member, mode: SecurityMode = "send_reset_link") {
    setSecurityTarget(member);
    setSecurityMode(mode);
    setSecNewPassword("");
    setSecConfirm("");
    setSecEmail(member.email || "");
    setSecAdminPassword("");
    setSecError("");
    setSecSuccess("");
  }

  async function submitSecurity(e: React.FormEvent) {
    e.preventDefault();
    if (secSubmitting || !securityTarget) return;
    setSecError("");
    setSecSuccess("");

    const payload: Record<string, unknown> = { action: securityMode, userId: securityTarget.id, adminPassword: secAdminPassword };
    if (securityMode === "set_password") {
      const problem = validatePassword(secNewPassword);
      if (problem) return setSecError(problem);
      if (secNewPassword !== secConfirm) return setSecError("The two passwords don't match.");
      payload.newPassword = secNewPassword;
    }
    if (securityMode === "update_email") {
      const clean = secEmail.trim().toLowerCase();
      if (!EMAIL_RE.test(clean)) return setSecError("Enter a valid email address.");
      payload.email = clean;
    }
    if (!secAdminPassword) return setSecError("Confirm your own password to continue.");

    setSecSubmitting(true);
    try {
      const res = await fetch("/api/admin/manage-user", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) return setSecError(data.error || "Something went wrong. Try again.");
      setSecSuccess(data.message || "Done.");
      setSecAdminPassword("");
      if (securityMode === "update_email") loadTeam();
    } catch {
      setSecError("A network error occurred. Try again.");
    } finally {
      setSecSubmitting(false);
    }
  }

  async function submitDelete(e: React.FormEvent) {
    e.preventDefault();
    if (deleting || !deleteTarget) return;
    setDelError("");
    if (!delAdminPassword) return setDelError("Confirm your own password to continue.");
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/manage-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_user", userId: deleteTarget.id, adminPassword: delAdminPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) return setDelError(data.error || "Could not delete this person.");
      showToast("success", data.message || "Removed.");
      setDeleteTarget(null);
      setDelAdminPassword("");
      loadTeam();
    } catch {
      setDelError("A network error occurred. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  const CONFIRM_TEXT = {
    deactivate: { title: "Remove access?", body: "They can no longer open this firm. Their tasks, time logs and history stay. You can restore access any time.", button: "Remove access", danger: true },
    reactivate: { title: "Restore access?", body: "They'll be able to sign in to this firm again with the same role and modules.", button: "Restore access", danger: false },
    resend_invite: { title: "Send the invitation again?", body: "A fresh link is emailed and the old one stops working.", button: "Send again", danger: false },
    cancel_invite: { title: "Cancel this invitation?", body: "The link stops working and they're removed from the team list.", button: "Cancel invitation", danger: true },
  } as const;

  /* ---------------- Render ---------------- */

  return (
    <div className="space-y-6">
      <div className="hero-card flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-text-main">
            <UserCheck className="h-5 w-5 text-navy" /> Team
          </h2>
          <p className="mt-1 text-xs text-text-muted">Invite your staff, choose what each person can open, and manage reviewers and sign-in security.</p>
          {plan && (
            <p className="mt-1 text-xs text-text-muted">
              {plan.users} of {plan.max_users ?? "unlimited"} users on {plan.status === "trial" ? "your Professional trial" : plan.plan_name}.{" "}
              <a href="/plan" className="font-semibold text-navy hover:underline">
                See plans
              </a>
            </p>
          )}
        </div>
        <button
          type="button"
          data-tour="team-add"
          onClick={() => openModal()}
          className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light"
        >
          <Plus className="h-4 w-4" /> Invite team member
        </button>
      </div>

      <div aria-busy={loading} className="kpi-grid grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Active", value: stats.active, icon: Users, style: "bg-navy/10 text-navy" },
          { label: "Invited", value: stats.invited, icon: Clock, style: "bg-amber-50 text-amber-600" },
          { label: "Administrators", value: stats.admins, icon: ShieldCheck, style: "bg-accent-soft text-accent" },
          { label: "Reviewers", value: stats.reviewers, icon: Shield, style: "bg-violet-50 text-violet-600" },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-center justify-between rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{s.label}</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-text-main">{s.value}</p>
              </div>
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${s.style}`}>
                <Icon className="h-4 w-4" />
              </div>
            </div>
          );
        })}
      </div>

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
            {(["all", "active", "invited", "disabled"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={`rounded-md px-3 py-1.5 capitalize transition ${statusFilter === f ? "bg-surface text-navy shadow-sm" : "text-text-muted hover:text-text-main"}`}
              >
                {f === "disabled" ? "No access" : f}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <ListSkeleton label="Loading your team" />
        ) : filteredTeam.length === 0 ? (
          <div className="p-10 text-center text-xs text-text-muted">{team.length === 0 ? "No one here yet. Invite your first team member." : "No one matches this view."}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Modules</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeam.map((m) => {
                  const self = isSelf(m);
                  const st = statusOf(m);
                  const modules = m.module_access || [];
                  return (
                    <tr key={m.id} className="transition hover:bg-surface-alt">
                      <td>
                        <div className="flex items-center gap-3">
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${st === "active" ? "bg-navy text-white" : "bg-border text-text-muted"}`}>
                            {getInitials(m.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-sm font-semibold text-navy">
                              <span className="truncate">{m.name}</span>
                              {self && <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent">You</span>}
                            </p>
                            <p className="truncate text-[11px] text-text-muted">{m.email}</p>
                            {m.phone && (
                              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-text-muted">
                                <Phone className="h-3 w-3" /> {m.phone}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${m.role === "admin" ? "border-accent/30 bg-accent-soft text-accent" : "border-border bg-surface-alt text-text-main"}`}>
                          {m.role === "admin" ? "Admin" : "Staff"}
                        </span>
                        {m.is_reviewer && m.role !== "admin" && (
                          <span className="ml-1 inline-flex items-center gap-0.5 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                            <Shield className="h-3 w-3" /> Reviewer
                          </span>
                        )}
                        <p className="mt-1 text-[11px] text-text-muted">{m.designation || "—"}</p>
                      </td>
                      <td>
                        {st === "active" && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Active</span>}
                        {st === "invited" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            <Clock className="h-3 w-3" /> Invited {formatDate(m.joined_at)}
                          </span>
                        )}
                        {st === "disabled" && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">No access</span>}
                        {st === "active" && m.last_sign_in_at && <p className="mt-1 text-[10px] text-text-muted">Last sign-in {formatDate(m.last_sign_in_at)}</p>}
                      </td>
                      <td>
                        {m.role === "admin" ? (
                          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">All modules</span>
                        ) : (
                          <div className="flex max-w-xs flex-wrap gap-1">
                            {modules.length === 0 && <span className="text-[11px] text-text-muted">No modules</span>}
                            {modules.map((id) => (
                              <span key={id} className="rounded bg-navy/10 px-1.5 py-0.5 text-[10px] font-medium text-navy">{MODULE_SHORT[id] || id}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <div className="inline-flex gap-1">
                          <button type="button" onClick={() => openModal(m)} className="rounded-md border border-border p-1.5 text-navy transition hover:bg-surface-alt" title="Edit role and modules">
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          {st === "invited" && (
                            <>
                              <button type="button" onClick={() => setConfirm({ member: m, action: "resend_invite" })} className="rounded-md border border-border p-1.5 text-navy transition hover:bg-surface-alt" title="Send the invitation again">
                                <Send className="h-3.5 w-3.5" />
                              </button>
                              <button type="button" onClick={() => setConfirm({ member: m, action: "cancel_invite" })} className="rounded-md border border-border p-1.5 text-rose-600 transition hover:bg-rose-50" title="Cancel invitation">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          {st === "active" && (
                            <button type="button" onClick={() => openSecurity(m)} className="rounded-md border border-border p-1.5 text-amber-600 transition hover:bg-amber-50" title="Password and sign-in">
                              <KeyRound className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {st === "active" && !self && (
                            <button type="button" onClick={() => setConfirm({ member: m, action: "deactivate" })} className="rounded-md border border-border p-1.5 text-rose-600 transition hover:bg-rose-50" title="Remove access">
                              <UserX className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {st === "disabled" && (
                            <>
                              <button type="button" onClick={() => setConfirm({ member: m, action: "reactivate" })} className="rounded-md border border-border p-1.5 text-emerald-600 transition hover:bg-emerald-50" title="Restore access">
                                <UserCheck2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteTarget(m);
                                  setDelAdminPassword("");
                                  setDelError("");
                                }}
                                className="rounded-md border border-border p-1.5 text-rose-600 transition hover:bg-rose-50"
                                title="Delete permanently"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
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

      {/* Invite / edit */}
      {isModalOpen && (
        <Modal
          title={editingMember ? `Edit ${editingMember.name}` : "Invite a team member"}
          subtitle={editingMember ? "Role, reviewer access and modules apply to this firm only." : "They'll get an email to join and choose their own password."}
          onClose={() => !saving && setIsModalOpen(false)}
          maxWidth="max-w-2xl"
        >
          <div className="mb-5 space-y-2 rounded-lg border border-border bg-surface-alt p-3">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-navy">
              <Zap className="h-3 w-3 text-amber-500" /> Quick presets
            </span>
            <div className="flex flex-wrap gap-2">
              {ROLE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p)}
                  disabled={isSelf(editingMember) && p.role !== "admin"}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-main shadow-sm transition hover:border-navy disabled:opacity-50"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {formError && <ErrorBox message={formError} />}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Full name *</label>
                <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} placeholder="e.g. Priya Sharma" />
              </div>
              <div>
                <label className={labelClass}>Email *</label>
                {editingMember ? (
                  <div className="flex gap-2">
                    <input type="email" value={email} disabled className={inputClass} />
                    {!editingMember.invite_pending && (
                      <button
                        type="button"
                        onClick={() => openSecurity(editingMember, "update_email")}
                        className="shrink-0 rounded-lg border border-border px-3 text-xs font-semibold text-navy transition hover:bg-surface-alt"
                      >
                        Change
                      </button>
                    )}
                  </div>
                ) : (
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="priya@yourfirm.com" autoComplete="off" />
                )}
              </div>
              <div>
                <label className={labelClass}>Mobile</label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${inputClass} pl-9`} placeholder="98765 43210" />
                </div>
              </div>
              <div>
                <label className={labelClass}>Designation</label>
                <div className="relative">
                  <Briefcase className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                  <input value={designation} onChange={(e) => setDesignation(e.target.value)} className={`${inputClass} pl-9`} placeholder="e.g. Senior GST article" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Role *</label>
                <select value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf(editingMember)} className={`${inputClass} font-semibold text-navy`}>
                  <option value="staff">Staff: only the modules you choose below</option>
                  <option value="admin">Administrator: everything, including billing and settings</option>
                </select>
                {isSelf(editingMember) && <p className="mt-1 text-[11px] text-text-muted">You can&apos;t change your own role, so the firm never loses its administrator.</p>}
              </div>
            </div>

            {role !== "admin" && (
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/70 p-3">
                <div>
                  <p className="flex items-center gap-1 text-xs font-semibold text-navy">
                    <Shield className="h-3.5 w-3.5 text-blue-600" /> Can review work
                  </p>
                  <p className="text-[11px] text-text-muted">Approves submitted tasks or sends them back with feedback.</p>
                </div>
                <input type="checkbox" checked={isReviewer} onChange={(e) => setIsReviewer(e.target.checked)} className="h-4 w-4 cursor-pointer accent-navy" />
              </label>
            )}

            {role === "admin" ? (
              <p className="rounded-lg border border-border bg-surface-alt p-3 text-xs text-text-muted">Administrators can open every module and review all work.</p>
            ) : (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-text-muted">Modules they can open</span>
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
                <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {MODULE_OPTIONS.map((m) => {
                    const checked = moduleAccess.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setModuleAccess(checked ? moduleAccess.filter((x) => x !== m.id) : [...moduleAccess, m.id])}
                        className={`flex items-start justify-between gap-2 rounded-lg border p-2.5 text-left transition ${checked ? "border-navy bg-navy/5" : "border-border bg-surface hover:bg-surface-alt"}`}
                      >
                        <div>
                          <p className="text-xs font-semibold text-navy">{m.label}</p>
                          <p className="text-[10px] text-text-muted">{m.desc}</p>
                        </div>
                        <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-navy bg-navy text-white" : "border-border bg-surface"}`}>
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-60">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingMember ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                {editingMember ? "Save changes" : "Send invitation"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Row action confirmation */}
      {confirm && (
        <Modal title={CONFIRM_TEXT[confirm.action].title} subtitle={`${confirm.member.name} · ${confirm.member.email}`} onClose={() => !actionBusy && setConfirm(null)} maxWidth="max-w-md">
          <p className="text-sm text-text-main">{CONFIRM_TEXT[confirm.action].body}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirm(null)} disabled={actionBusy} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
              Back
            </button>
            <button
              type="button"
              onClick={runAction}
              disabled={actionBusy}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-60 ${CONFIRM_TEXT[confirm.action].danger ? "bg-danger hover:opacity-90" : "bg-navy hover:bg-navy-light"}`}
            >
              {actionBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {CONFIRM_TEXT[confirm.action].button}
            </button>
          </div>
        </Modal>
      )}

      {/* Login security */}
      {securityTarget && (
        <Modal title={`Sign-in security for ${securityTarget.name}`} subtitle="Sensitive actions need your own password." onClose={() => !secSubmitting && setSecurityTarget(null)} maxWidth="max-w-lg">
          <form onSubmit={submitSecurity} className="space-y-4">
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-alt p-1 text-[11px] font-semibold">
              {(
                [
                  { mode: "send_reset_link", label: "Email reset link", icon: Mail },
                  { mode: "set_password", label: "Set password", icon: KeyRound },
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
                    className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 transition ${securityMode === t.mode ? "bg-surface text-navy shadow-sm" : "text-text-muted hover:text-text-main"}`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {t.label}
                  </button>
                );
              })}
            </div>

            {securityMode === "send_reset_link" && (
              <p className="rounded-lg border border-border bg-surface-alt p-3 text-xs text-text-main">
                A secure link is emailed to <span className="font-semibold">{securityTarget.email}</span> so they can choose a new password themselves. This is the safest option.
              </p>
            )}

            {securityMode === "set_password" && (
              <div className="space-y-3">
                <PasswordInput label="New password" value={secNewPassword} onChange={setSecNewPassword} autoComplete="new-password" showStrength />
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
                    <button type="button" onClick={() => copyText(secNewPassword)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-navy transition hover:bg-surface-alt">
                      <Copy className="h-3 w-3" /> Copy
                    </button>
                  )}
                </div>
                <PasswordInput label="Confirm new password" value={secConfirm} onChange={setSecConfirm} autoComplete="new-password" />
                <p className="text-[11px] text-text-muted">Their old password stops working immediately. Share the new one privately.</p>
              </div>
            )}

            {securityMode === "update_email" && (
              <div className="space-y-2">
                <label className={labelClass}>New sign-in email</label>
                <input type="email" value={secEmail} onChange={(e) => setSecEmail(e.target.value)} className={inputClass} autoComplete="off" />
                <p className="text-[11px] text-text-muted">Their password stays the same.</p>
              </div>
            )}

            <div className="border-t border-border pt-4">
              <PasswordInput label="Your password" value={secAdminPassword} onChange={setSecAdminPassword} autoComplete="current-password" />
            </div>

            {secError && <ErrorBox message={secError} />}
            {secSuccess && <SuccessBox message={secSuccess} />}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSecurityTarget(null)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                {secSuccess ? "Done" : "Cancel"}
              </button>
              {!secSuccess && (
                <button type="submit" disabled={secSubmitting} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-60">
                  {secSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {securityMode === "set_password" ? "Update password" : securityMode === "send_reset_link" ? "Send reset link" : "Update email"}
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}

      {/* Permanent delete */}
      {deleteTarget && (
        <Modal title={`Delete ${deleteTarget.name} permanently?`} onClose={() => !deleting && setDeleteTarget(null)} maxWidth="max-w-md">
          <form onSubmit={submitDelete} className="space-y-3 text-xs">
            <p className="text-text-main">
              Removes their login completely. It&apos;s only possible if they have no tasks, time logs or other history, and only if they don&apos;t work with another firm. Otherwise, keep their access removed instead.
            </p>
            <PasswordInput label="Your password" value={delAdminPassword} onChange={setDelAdminPassword} autoComplete="current-password" />
            {delError && <ErrorBox message={delError} />}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Cancel
              </button>
              <button type="submit" disabled={deleting} className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete permanently
              </button>
            </div>
          </form>
        </Modal>
      )}

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