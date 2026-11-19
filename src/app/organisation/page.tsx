"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building, Check, GitBranch, Loader2, Pencil, Plus, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Card, EmptyState, PageHeader, Pill, btn, field } from "@/components/ui/kit";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { LockedHint } from "@/components/plan/FeatureGate";
import { hasFeature } from "@/lib/features";
import { MODULE_OPTIONS } from "@/lib/team/modules";
import { STATE_OPTIONS } from "@/lib/gst";

type Branch = {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  state: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  office_ips: string[];
  work_start: string | null;
  work_end: string | null;
  separate_numbering: boolean;
  invoice_prefix: string | null;
  is_default: boolean;
};
type Role = { id: string; name: string; description: string | null; scope: "own" | "branch" | "firm"; module_access: string[]; permissions: string[] };

const PERMISSIONS: { key: string; label: string; hint: string }[] = [
  { key: "approve_work", label: "Review work", hint: "Approve submitted tasks or send them back" },
  { key: "approve_time", label: "Approve time and leave", hint: "Away time above the daily limit, and leave requests" },
  { key: "view_attendance", label: "See attendance and capacity", hint: "For the people they can see" },
  { key: "see_profitability", label: "See fees and profitability", hint: "Practice insights" },
  { key: "export_data", label: "Export data", hint: "Download reports and exports" },
];

const SCOPES = [
  { key: "own", label: "Own work only", hint: "Their tasks, and the clients they handle" },
  { key: "branch", label: "Their branch", hint: "People, clients and work of their branch" },
  { key: "firm", label: "Whole firm", hint: "Everything the sections allow" },
] as const;

const emptyBranch: Omit<Branch, "id" | "is_default"> = {
  name: "",
  code: null,
  address: null,
  state: null,
  gstin: null,
  phone: null,
  email: null,
  office_ips: [],
  work_start: "10:00",
  work_end: "19:00",
  separate_numbering: false,
  invoice_prefix: null,
};

/** Admin: the firm's offices and its own roles. */
export default function OrganisationPage() {
  const user = useCurrentUser();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<"branches" | "roles">("branches");
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [editBranch, setEditBranch] = useState<(Partial<Branch> & typeof emptyBranch) | null>(null);
  const [ipsText, setIpsText] = useState("");
  const [editRole, setEditRole] = useState<Partial<Role> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removeRole, setRemoveRole] = useState<Role | null>(null);
  const [myIp, setMyIp] = useState("");

  const canBranches = hasFeature(user, "branches");
  const canRoles = hasFeature(user, "custom_roles");

  const load = useCallback(async () => {
    const [b, r, m] = await Promise.all([
      supabase.from("branches").select("*").order("is_default", { ascending: false }).order("name"),
      supabase.from("roles").select("id, name, description, scope, module_access, permissions").order("name"),
      supabase.from("memberships").select("branch_id, role_id").eq("is_active", true),
    ]);
    setBranches((b.data || []) as Branch[]);
    setRoles((r.data || []) as Role[]);
    const c: Record<string, number> = {};
    for (const x of m.data || []) {
      if (x.branch_id) c[x.branch_id] = (c[x.branch_id] || 0) + 1;
      if (x.role_id) c[x.role_id] = (c[x.role_id] || 0) + 1;
    }
    setCounts(c);
  }, [supabase]);

  useEffect(() => {
    if (user && !user.isAdmin) router.replace("/");
  }, [user, router]);

  useEffect(() => {
    load();
    fetch("/api/attendance/ping", { method: "GET" })
      .then((r) => r.json())
      .then((j) => setMyIp(j.ip || ""))
      .catch(() => {});
  }, [load]);

  function openBranch(b?: Branch) {
    setError("");
    setEditBranch(b ? { ...b } : { ...emptyBranch });
    setIpsText((b?.office_ips || []).join("\n"));
  }

  async function saveBranch(e: React.FormEvent) {
    e.preventDefault();
    if (!editBranch) return;
    setBusy(true);
    setError("");
    const row = {
      name: editBranch.name,
      code: editBranch.code?.trim().toUpperCase() || null,
      address: editBranch.address?.trim() || null,
      state: editBranch.state || null,
      gstin: editBranch.gstin?.trim().toUpperCase() || null,
      phone: editBranch.phone?.trim() || null,
      email: editBranch.email?.trim() || null,
      office_ips: ipsText
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .filter(Boolean),
      work_start: editBranch.work_start || null,
      work_end: editBranch.work_end || null,
      separate_numbering: editBranch.separate_numbering,
      invoice_prefix: editBranch.invoice_prefix?.trim() || null,
    };
    const { error: err } = editBranch.id ? await supabase.from("branches").update(row).eq("id", editBranch.id) : await supabase.from("branches").insert(row);
    setBusy(false);
    if (err) return setError(err.message);
    setEditBranch(null);
    setNotice("Branch saved.");
    load();
  }

  async function saveRole(e: React.FormEvent) {
    e.preventDefault();
    if (!editRole) return;
    setBusy(true);
    setError("");
    const row = {
      name: (editRole.name || "").trim(),
      description: editRole.description?.trim() || null,
      scope: editRole.scope || "firm",
      module_access: editRole.module_access || [],
      permissions: editRole.permissions || [],
    };
    const { error: err } = editRole.id ? await supabase.from("roles").update(row).eq("id", editRole.id) : await supabase.from("roles").insert(row);
    setBusy(false);
    if (err) return setError(err.message);
    setEditRole(null);
    setNotice("Role saved. Everyone with it follows the change straight away.");
    load();
  }

  async function deleteRole() {
    if (!removeRole) return;
    setBusy(true);
    const { error: err } = await supabase.from("roles").delete().eq("id", removeRole.id);
    setBusy(false);
    setRemoveRole(null);
    if (err) return setNotice(err.message);
    setNotice("Role removed. People who had it keep their current sections.");
    load();
  }

  function toggleList(list: string[] | undefined, key: string) {
    const set = new Set(list || []);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    return [...set];
  }

  if (!user?.isAdmin) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Building}
        title="Branches and roles"
        subtitle="Your offices, and the roles that decide what each person sees and can do."
        actions={
          tab === "branches" ? (
            canBranches ? (
              <button type="button" onClick={() => openBranch()} className={btn.primary}>
                <Plus className="h-3.5 w-3.5" /> Add branch
              </button>
            ) : (
              <LockedHint feature="branches" />
            )
          ) : canRoles ? (
            <button type="button" onClick={() => setEditRole({ scope: "firm", module_access: ["tasks", "time_tracking"], permissions: [] })} className={btn.primary}>
              <Plus className="h-3.5 w-3.5" /> Add role
            </button>
          ) : (
            <LockedHint feature="custom_roles" />
          )
        }
      >
        <div data-tour="org-tabs" className="inline-flex rounded-lg border border-border bg-surface-alt p-1 text-xs font-semibold">
          {(
            [
              ["branches", "Branches", GitBranch],
              ["roles", "Roles", ShieldCheck],
            ] as const
          ).map(([k, label, Icon]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${tab === k ? "bg-surface text-text-main shadow-sm" : "text-text-muted"}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </PageHeader>

      {notice && <p className="rounded-lg bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-700">{notice}</p>}

      <div key={tab} className="animate-content-in">
        {tab === "branches" ? (
          branches === null ? (
            <div className="skeleton h-40" />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {branches.map((b) => (
                <Card key={b.id} bodyClassName="p-4 space-y-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-semibold text-text-main">
                        {b.name} {b.is_default && <Pill>Head office</Pill>}
                      </p>
                      <p className="text-text-muted">{b.address || "No address yet"}</p>
                    </div>
                    <button type="button" onClick={() => openBranch(b)} className={btn.ghost} aria-label={`Edit ${b.name}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Pill tone="info">
                      <UsersRound className="h-3 w-3" /> {counts[b.id] || 0} people
                    </Pill>
                    {b.gstin ? <Pill tone="accent">Own GSTIN {b.gstin}</Pill> : <Pill>Firm GSTIN</Pill>}
                    {b.separate_numbering ? <Pill tone="accent">Own numbering {b.invoice_prefix}</Pill> : <Pill>Firm numbering</Pill>}
                    {b.office_ips.length > 0 ? <Pill tone="good">{b.office_ips.length} office address{b.office_ips.length === 1 ? "" : "es"}</Pill> : <Pill tone="warn">No office address</Pill>}
                    {b.work_start && b.work_end && (
                      <Pill>
                        {b.work_start.slice(0, 5)} to {b.work_end.slice(0, 5)}
                      </Pill>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )
        ) : roles === null ? (
          <div className="skeleton h-40" />
        ) : roles.length === 0 ? (
          <Card>
            <EmptyState
              title="No firm roles yet"
              hint={
                canRoles
                  ? "Make roles such as Article, Senior, Manager or Accounts. Each decides the sections, the rights and how far the person sees. Then give people a role on the Team page."
                  : "Custom roles are part of the Firm plan. Until then, choose sections for each person on the Team page."
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {roles.map((r) => (
              <Card key={r.id} bodyClassName="p-4 space-y-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-text-main">{r.name}</p>
                    <p className="text-text-muted">{r.description || SCOPES.find((x) => x.key === r.scope)?.hint}</p>
                  </div>
                  <span className="flex">
                    <button type="button" onClick={() => setEditRole({ ...r })} className={btn.ghost} aria-label={`Edit ${r.name}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => setRemoveRole(r)} className={btn.ghost} aria-label={`Delete ${r.name}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Pill tone="info">{counts[r.id] || 0} people</Pill>
                  <Pill tone="accent">Sees {SCOPES.find((x) => x.key === r.scope)?.label.toLowerCase()}</Pill>
                  {r.permissions.map((p) => (
                    <Pill key={p} tone="good">
                      <Check className="h-3 w-3" /> {PERMISSIONS.find((x) => x.key === p)?.label}
                    </Pill>
                  ))}
                </div>
                <p className="text-[11px] text-text-muted">Sections: {r.module_access.map((m) => MODULE_OPTIONS.find((o) => o.id === m)?.short || m).join(", ") || "none"}</p>
              </Card>
            ))}
          </div>
        )}
      </div>

      {editBranch && (
        <Modal title={editBranch.id ? `Edit ${editBranch.name}` : "Add branch"} onClose={() => setEditBranch(null)} maxWidth="max-w-2xl">
          <form onSubmit={saveBranch} className="grid gap-4 text-xs sm:grid-cols-2">
            <div>
              <label className={field.label}>Name</label>
              <input required value={editBranch.name} onChange={(e) => setEditBranch({ ...editBranch, name: e.target.value })} className={field.input} placeholder="Paschim Vihar" />
            </div>
            <div>
              <label className={field.label}>State</label>
              <select value={editBranch.state || ""} onChange={(e) => setEditBranch({ ...editBranch, state: e.target.value || null })} className={field.input}>
                <option value="">Choose…</option>
                {STATE_OPTIONS.map((s) => (
                  <option key={s.code} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={field.label}>Address</label>
              <textarea rows={2} value={editBranch.address || ""} onChange={(e) => setEditBranch({ ...editBranch, address: e.target.value })} className={field.input} />
            </div>
            <div>
              <label className={field.label}>Working hours</label>
              <div className="flex items-center gap-2">
                <input type="time" value={editBranch.work_start?.slice(0, 5) || ""} onChange={(e) => setEditBranch({ ...editBranch, work_start: e.target.value })} className={field.input} />
                <span className="text-text-muted">to</span>
                <input type="time" value={editBranch.work_end?.slice(0, 5) || ""} onChange={(e) => setEditBranch({ ...editBranch, work_end: e.target.value })} className={field.input} />
              </div>
            </div>
            <div>
              <label className={field.label}>Office internet address</label>
              <textarea rows={2} value={ipsText} onChange={(e) => setIpsText(e.target.value)} className={`${field.input} font-mono`} placeholder="203.0.113.7, one per line" />
              <p className="mt-1 text-[10px] text-text-muted">
                Marks days as &quot;In office&quot;. {myIp && <>You are on <button type="button" className="font-mono font-semibold text-accent" onClick={() => setIpsText((t) => (t ? `${t}\n${myIp}` : myIp))}>{myIp}</button> now; click to add it if you are in this office.</>}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3 sm:col-span-2">
              <p className="font-semibold text-text-main">Billing from this branch</p>
              <p className="text-[11px] text-text-muted">Leave both empty to bill under the firm&apos;s GSTIN and numbering.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={field.label}>Branch GSTIN (if registered separately)</label>
                  <input value={editBranch.gstin || ""} onChange={(e) => setEditBranch({ ...editBranch, gstin: e.target.value.toUpperCase() })} maxLength={15} className={`${field.input} font-mono uppercase`} />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    <input type="checkbox" checked={editBranch.separate_numbering} onChange={(e) => setEditBranch({ ...editBranch, separate_numbering: e.target.checked })} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
                    Own invoice numbering
                  </label>
                  <input
                    disabled={!editBranch.separate_numbering}
                    value={editBranch.invoice_prefix || ""}
                    onChange={(e) => setEditBranch({ ...editBranch, invoice_prefix: e.target.value })}
                    placeholder="PV/{FY}/"
                    className={`${field.input} font-mono`}
                  />
                </div>
              </div>
            </div>
            {error && <p className="font-medium text-rose-600 sm:col-span-2">{error}</p>}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" onClick={() => setEditBranch(null)} className={btn.secondary}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={btn.primary}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save branch
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editRole && (
        <Modal title={editRole.id ? `Edit ${editRole.name}` : "Add role"} onClose={() => setEditRole(null)} maxWidth="max-w-2xl">
          <form onSubmit={saveRole} className="space-y-4 text-xs">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={field.label}>Role name</label>
                <input required maxLength={60} value={editRole.name || ""} onChange={(e) => setEditRole({ ...editRole, name: e.target.value })} className={field.input} placeholder="Senior article" />
              </div>
              <div>
                <label className={field.label}>Description</label>
                <input maxLength={300} value={editRole.description || ""} onChange={(e) => setEditRole({ ...editRole, description: e.target.value })} className={field.input} />
              </div>
            </div>
            <div>
              <p className={field.label}>Sees</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {SCOPES.map((s) => (
                  <label key={s.key} className={`cursor-pointer rounded-lg border p-3 ${editRole.scope === s.key ? "border-accent bg-accent-soft/50" : "border-border"}`}>
                    <input type="radio" name="scope" className="sr-only" checked={editRole.scope === s.key} onChange={() => setEditRole({ ...editRole, scope: s.key })} />
                    <span className="block font-semibold text-text-main">{s.label}</span>
                    <span className="text-[11px] text-text-muted">{s.hint}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className={field.label}>Sections</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {MODULE_OPTIONS.map((m) => (
                  <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <input
                      type="checkbox"
                      checked={(editRole.module_access || []).includes(m.id)}
                      onChange={() => setEditRole({ ...editRole, module_access: toggleList(editRole.module_access, m.id) })}
                      className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className={field.label}>Can</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {PERMISSIONS.map((p) => (
                  <label key={p.key} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2">
                    <input
                      type="checkbox"
                      checked={(editRole.permissions || []).includes(p.key)}
                      onChange={() => setEditRole({ ...editRole, permissions: toggleList(editRole.permissions, p.key) })}
                      className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-accent)]"
                    />
                    <span>
                      <span className="block font-semibold text-text-main">{p.label}</span>
                      <span className="text-[11px] text-text-muted">{p.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {error && <p className="font-medium text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditRole(null)} className={btn.secondary}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={btn.primary}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save role
              </button>
            </div>
          </form>
        </Modal>
      )}

      {removeRole && (
        <ConfirmDialog
          title={`Delete the ${removeRole.name} role?`}
          message="People who have it keep their current sections and see the whole firm until you give them another role."
          confirmLabel="Delete role"
          tone="danger"
          loading={busy}
          onConfirm={deleteRole}
          onCancel={() => setRemoveRole(null)}
        />
      )}
    </div>
  );
}
