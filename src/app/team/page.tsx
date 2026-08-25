"use client";

import { useState, useEffect } from "react";
import { UserCheck, Plus, Edit2, Shield, Trash2, X, Check, Lock, Phone, Briefcase, Zap, UserX, UserCheck2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";

const MODULE_OPTIONS = [
  { id: "leads", label: "Enquiries & Business Growth", desc: "Leads, pipeline stages, and conversion tracking" },
  { id: "quotations", label: "Quotations Engine", desc: "Fee proposals, custom line items, and PDF exports" },
  { id: "tasks", label: "Tasks & Compliance Matrix", desc: "Task tracking, compliance board, and assignments" },
  { id: "calendar", label: "Compliance Calendar", desc: "Tax due dates, statutory deadlines, and filing schedule" },
  { id: "discussions", label: "Client Discussions", desc: "Communication history and client notes" },
  { id: "time_tracking", label: "Office Log Sheet & Timers", desc: "Live stopwatch and billable time logs" },
  { id: "invoices", label: "Invoices & Billing", desc: "Tax invoices, payment statuses, and revenue reports" },
  { id: "documents", label: "Document Vault", desc: "Client document uploads and file organization" },
  { id: "team", label: "Team Management", desc: "Manage staff accounts and operational roles" },
  { id: "packages", label: "Service Package Workflows", desc: "Retainer onboarding and recurring sub-tasks" },
  { id: "settings", label: "Firm Settings & Roles", desc: "Practice configuration and system role controls" },
];

const ROLE_PRESETS = [
  {
    label: "Execution Staff",
    role: "staff",
    isReviewer: false,
    modules: ["leads", "tasks", "time_tracking"]
  },
  {
    label: "Senior Staff / Reviewer",
    role: "staff",
    isReviewer: true,
    modules: ["leads", "tasks", "time_tracking", "packages"]
  },
  {
    label: "Administrator",
    role: "admin",
    isReviewer: true,
    modules: ["leads", "tasks", "invoices", "time_tracking", "packages"]
  }
];

export default function TeamPage() {
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<any | null>(null);

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

  const supabase = createClient();

  useEffect(() => {
    loadTeam();
  }, []);

  async function loadTeam() {
    setLoading(true);
    const { data } = await supabase.from("profiles").select("*").order("name", { ascending: true });
    if (data) setTeam(data);
    setLoading(false);
  }

  function applyPreset(preset: typeof ROLE_PRESETS[0]) {
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
      setModuleAccess(member.module_access || ["leads", "tasks", "time_tracking"]);
    } else {
      setEditingMember(null);
      resetForm();
    }
    setIsModalOpen(true);
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

    const payload = {
      name: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      designation: designation.trim(),
      role,
      is_reviewer: isReviewer,
      is_active: isActive,
      module_access: moduleAccess,
    };

    if (editingMember) {
      const { error } = await supabase
        .from("profiles")
        .update(payload)
        .eq("id", editingMember.id);

      if (error) return alert("Error updating member: " + error.message);

      logAuditEvent("UPDATE_TEAM_MEMBER", "PROFILES", editingMember.id, payload);
      alert("Team member updated successfully!");
    } else {
      if (!password || password.length < 6) {
        return alert("Please provide a password of at least 6 characters.");
      }

      // Call Admin Route to bypass Supabase Email Rate Limit
      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        return alert("Error creating account: " + (data.error || "Failed to create user"));
      }

      logAuditEvent("CREATE_TEAM_MEMBER", "PROFILES", data.user.id, payload);
      alert("New team member added successfully!");
    }

    setIsModalOpen(false);
    resetForm();
    loadTeam();
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to remove this team member?")) return;
    const { error } = await supabase.from("profiles").delete().eq("id", id);
    if (!error) {
      logAuditEvent("DELETE_TEAM_MEMBER", "PROFILES", id);
      loadTeam();
    } else alert("Error removing member: " + error.message);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-surface p-5 rounded-lg border border-border shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-text-main flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-navy" /> Firm Team & Permission Console
          </h2>
          <p className="text-xs text-text-muted mt-1">
            Manage practice staff, toggle reviewer gatekeeper access, and configure module-level security.
          </p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 bg-navy text-white px-4 py-2 rounded-md font-medium text-xs hover:bg-navy/90 transition"
        >
          <Plus className="h-4 w-4" /> Add Team Member
        </button>
      </div>

      {/* Team Table */}
      <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted text-xs">Loading team roster...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-text-muted bg-background/50">
                  <th className="p-3">Member Details</th>
                  <th className="p-3">Role & Designation</th>
                  <th className="p-3">Reviewer Status</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Module Permissions</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {team.map((member) => (
                  <tr key={member.id} className="hover:bg-background/50 transition">
                    <td className="p-3">
                      <p className="font-bold text-navy text-sm">{member.name}</p>
                      <p className="text-[11px] text-text-muted">{member.email}</p>
                      {member.phone && <p className="text-[10px] text-text-muted flex items-center gap-1 mt-0.5"><Phone className="h-3 w-3" /> {member.phone}</p>}
                    </td>
                    <td className="p-3">
                      <span className="font-bold text-text-main capitalize block">{member.role}</span>
                      <span className="text-[10px] text-text-muted">{member.designation || "Staff Member"}</span>
                    </td>
                    <td className="p-3">
                      {member.is_reviewer ? (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 font-bold rounded text-[10px] flex items-center gap-1 w-max">
                          <Shield className="h-3 w-3" /> Gatekeeper Enabled
                        </span>
                      ) : (
                        <span className="text-text-muted text-[11px]">-</span>
                      )}
                    </td>
                    <td className="p-3">
                      {member.is_active !== false ? (
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 font-bold rounded text-[10px] border border-emerald-200">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-rose-50 text-rose-600 font-bold rounded text-[10px] border border-rose-200">
                          Disabled
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {(member.module_access || []).map((m: string) => (
                          <span key={m} className="px-1.5 py-0.5 bg-navy/10 text-navy font-medium rounded text-[9px] uppercase">
                            {m}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-right space-x-1 whitespace-nowrap">
                      <button
                        onClick={() => openModal(member)}
                        className="p-1.5 border border-border rounded text-navy hover:bg-background"
                        title="Edit member permissions"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      {member.role !== "admin" && (
                        <button
                          onClick={() => handleDelete(member.id)}
                          className="p-1.5 border border-border rounded text-rose-600 hover:bg-rose-50"
                          title="Delete member"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upgraded Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-surface rounded-lg border border-border w-full max-w-xl p-6 space-y-4 shadow-2xl text-xs my-8">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <div>
                <h3 className="font-bold text-base text-text-main">
                  {editingMember ? "Modify Team Member & Permissions" : "Add New Team Member"}
                </h3>
                <p className="text-[11px] text-text-muted">Configure operational scope and module capabilities.</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-text-muted hover:text-text-main">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Role Preset Selector Bar */}
            <div className="bg-background p-2.5 rounded-lg border border-border space-y-1.5">
              <span className="text-[10px] font-bold text-navy uppercase tracking-wider flex items-center gap-1">
                <Zap className="h-3 w-3 text-amber-500" /> Quick Permission Presets
              </span>
              <div className="flex flex-wrap gap-2">
                {ROLE_PRESETS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className="px-2.5 py-1 bg-surface border border-border hover:border-navy rounded font-semibold text-[11px] text-text-main transition shadow-sm"
                  >
                    + {p.label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">FULL NAME *</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy"
                    placeholder="e.g. Rahul Sharma"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">OFFICIAL EMAIL *</label>
                  <input
                    type="email"
                    required
                    disabled={!!editingMember}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background"
                    placeholder="rahul@firm.com"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">PHONE NUMBER</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy"
                    placeholder="+91 98765 43210"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">DESIGNATION / JOB TITLE</label>
                  <input
                    type="text"
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy"
                    placeholder="e.g. Senior GST Article"
                  />
                </div>
              </div>

              {!editingMember && (
                <div>
                  <label className="block font-semibold text-text-muted mb-1">INITIAL PASSWORD *</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy"
                    placeholder="Minimum 6 characters"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">PRIMARY SYSTEM ROLE *</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs bg-surface font-semibold text-navy"
                  >
                    <option value="staff">Execution Staff</option>
                    <option value="admin">Administrator (Full System Control)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">ACCOUNT STATUS</label>
                  <button
                    type="button"
                    onClick={() => setIsActive(!isActive)}
                    className={`w-full p-2 border rounded font-bold flex items-center justify-center gap-1.5 ${isActive ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"}`}
                  >
                    {isActive ? <UserCheck2 className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
                    {isActive ? "Account Active" : "Account Disabled"}
                  </button>
                </div>
              </div>

              {/* Reviewer Gatekeeper Access Box */}
              <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg flex items-center justify-between">
                <div>
                  <p className="font-bold text-navy text-xs flex items-center gap-1">
                    <Shield className="h-3.5 w-3.5 text-blue-600" /> Enable Task Reviewer Access
                  </p>
                  <p className="text-[11px] text-text-muted">Grants access to inspect, add feedback, and approve/reject staff submissions.</p>
                </div>
                <input
                  type="checkbox"
                  checked={isReviewer}
                  onChange={(e) => setIsReviewer(e.target.checked)}
                  className="h-4 w-4 accent-navy cursor-pointer"
                />
              </div>

              {/* Granular Module Access Cards */}
              <div>
                <label className="block font-semibold text-text-muted mb-2 uppercase tracking-wider text-[10px]">Granular Module Access</label>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {MODULE_OPTIONS.map((m) => {
                    const isChecked = moduleAccess.includes(m.id);
                    return (
                      <div
                        key={m.id}
                        onClick={() => handleModuleToggle(m.id)}
                        className={`p-2.5 border rounded-lg flex items-center justify-between cursor-pointer transition ${isChecked ? "bg-navy/5 border-navy" : "bg-surface border-border hover:bg-background"}`}
                      >
                        <div>
                          <p className="font-bold text-xs text-navy">{m.label}</p>
                          <p className="text-[10px] text-text-muted">{m.desc}</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="accent-navy h-4 w-4 cursor-pointer"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-border rounded hover:bg-background font-semibold"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-navy text-white rounded font-bold hover:bg-navy/90">
                  {editingMember ? "Save Changes" : "Create Team Member"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}