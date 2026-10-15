"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Layers,
  Plus,
  Trash2,
  CheckCircle2,
  UserCheck,
  Calendar,
  ArrowRight,
  X,
  Edit2,
  Archive,
  Loader2,
  AlertCircle,
  IndianRupee,
  Users,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ArchiveRestore,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { compactINR, formatDate, formatINR, localISODate } from "@/lib/format";

const CATEGORIES = ["GST", "Income Tax", "TDS", "ROC", "Audit", "Accounting", "Payroll", "Other"];
const RECURRENCES = ["None", "Weekly", "Monthly", "Quarterly", "Yearly"];
const CYCLES = ["Monthly", "Quarterly", "Half-Yearly", "Yearly"];
const CYCLE_MONTHS: Record<string, number> = { Monthly: 1, Quarterly: 3, "Half-Yearly": 6, Yearly: 12 };

type ServiceRow = { id?: string; title: string; category: string; days_due_offset: number; recurrence: string; default_assignee_id: string };

const EMPTY_SERVICE: ServiceRow = { title: "", category: "GST", days_due_offset: 10, recurrence: "Monthly", default_assignee_id: "" };

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const smallInput = "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none transition focus:border-navy";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localISODate(new Date(y, m - 1, d + days));
}

export default function PackagesPage() {
  const [supabase] = useState(() => createClient());

  const [packages, setPackages] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Package modal
  const [isPkgModalOpen, setIsPkgModalOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState<any | null>(null);
  const [pkgName, setPkgName] = useState("");
  const [pkgDesc, setPkgDesc] = useState("");
  const [billingCycle, setBillingCycle] = useState("Monthly");
  const [price, setPrice] = useState("");
  const [serviceTemplates, setServiceTemplates] = useState<ServiceRow[]>([{ ...EMPTY_SERVICE, title: "GSTR-3B Return Filing", days_due_offset: 20 }]);
  const [pkgSaving, setPkgSaving] = useState(false);
  const [pkgError, setPkgError] = useState("");

  // Onboarding modal
  const [selectedPkg, setSelectedPkg] = useState<any | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [startDate, setStartDate] = useState(localISODate());
  const [reviewerId, setReviewerId] = useState("");
  const [onboarding, setOnboarding] = useState(false);
  const [onboardError, setOnboardError] = useState("");

  // Confirmations
  const [confirm, setConfirm] = useState<null | { kind: "delete" | "archive" | "end"; target: any }>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 5000);
  }

  async function loadData() {
    setLoading(true);
    const [pRes, sRes, cRes, tRes] = await Promise.all([
      supabase.from("service_packages").select("*, package_services(*)").order("created_at", { ascending: false }),
      supabase.from("client_packages").select("*").order("start_date", { ascending: false }),
      supabase.from("clients").select("id, name, organization_name, assigned_to, status").order("name", { ascending: true }),
      supabase.from("profiles").select("id, name, role, is_active, is_reviewer").order("name", { ascending: true }),
    ]);
    if (pRes.error) showToast("error", "Could not load packages.");
    setPackages(pRes.data || []);
    setSubscriptions(sRes.data || []);
    setClients(cRes.data || []);
    setTeam(tRes.data || []);
    setLoading(false);
  }

  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
  const teamName = (id?: string) => team.find((t) => t.id === id)?.name || "";
  const activeTeam = team.filter((t) => t.is_active !== false);
  const reviewers = activeTeam.filter((t) => t.role === "admin" || t.role === "reviewer" || t.is_reviewer);
  const activeSubsFor = (pkgId: string) => subscriptions.filter((s) => s.package_id === pkgId && s.status === "Active");

  /* ---------------- KPIs ---------------- */

  const stats = useMemo(() => {
    const active = packages.filter((p) => p.is_active !== false);
    const activeSubs = subscriptions.filter((s) => s.status === "Active");
    const mrr = activeSubs.reduce((sum, s) => {
      const pkg = packages.find((p) => p.id === s.package_id);
      if (!pkg) return sum;
      return sum + Number(pkg.price || 0) / (CYCLE_MONTHS[pkg.billing_cycle] || 1);
    }, 0);
    return { packages: active.length, subscriptions: activeSubs.length, mrr, arr: mrr * 12 };
  }, [packages, subscriptions]);

  const visiblePackages = packages.filter((p) => (showArchived ? p.is_active === false : p.is_active !== false));

  /* ---------------- Package create / edit ---------------- */

  function openPkgModal(pkg?: any) {
    setPkgError("");
    if (pkg) {
      setEditingPkg(pkg);
      setPkgName(pkg.name || "");
      setPkgDesc(pkg.description || "");
      setBillingCycle(pkg.billing_cycle || "Monthly");
      setPrice(String(pkg.price ?? ""));
      setServiceTemplates(
        (pkg.package_services || []).map((s: any) => ({
          id: s.id,
          title: s.title,
          category: s.category || "GST",
          days_due_offset: Number(s.days_due_offset ?? 10),
          recurrence: s.recurrence || "None",
          default_assignee_id: s.default_assignee_id || "",
        }))
      );
    } else {
      setEditingPkg(null);
      setPkgName("");
      setPkgDesc("");
      setBillingCycle("Monthly");
      setPrice("");
      setServiceTemplates([{ ...EMPTY_SERVICE, title: "GSTR-3B Return Filing", days_due_offset: 20 }]);
    }
    setIsPkgModalOpen(true);
  }

  function updateTemplateField(index: number, field: keyof ServiceRow, value: any) {
    setServiceTemplates((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  async function handleSavePackage(e: React.FormEvent) {
    e.preventDefault();
    if (pkgSaving) return;
    setPkgError("");

    const fee = Number(price);
    if (!pkgName.trim()) return setPkgError("Package name is required.");
    if (!Number.isFinite(fee) || fee < 0) return setPkgError("Enter a valid retainer fee.");
    if (serviceTemplates.length === 0) return setPkgError("Add at least one service.");
    if (serviceTemplates.some((s) => !s.title.trim())) return setPkgError("Every service needs a title.");
    if (serviceTemplates.some((s) => !(Number(s.days_due_offset) >= 0 && Number(s.days_due_offset) <= 365))) {
      return setPkgError("Due offsets must be between 0 and 365 days.");
    }

    const pkgPayload = { name: pkgName.trim(), description: pkgDesc.trim(), billing_cycle: billingCycle, price: fee };
    const rows = serviceTemplates.map((s) => ({
      title: s.title.trim(),
      category: s.category,
      days_due_offset: Number(s.days_due_offset) || 0,
      recurrence: s.recurrence,
      default_assignee_id: s.default_assignee_id || null,
    }));

    setPkgSaving(true);
    try {
      if (editingPkg) {
        const { error } = await supabase.from("service_packages").update(pkgPayload).eq("id", editingPkg.id);
        if (error) throw error;

        const keptIds = serviceTemplates.filter((s) => s.id).map((s) => s.id as string);
        const removed = (editingPkg.package_services || []).filter((s: any) => !keptIds.includes(s.id)).map((s: any) => s.id);
        if (removed.length) {
          const { error: delErr } = await supabase.from("package_services").delete().in("id", removed);
          if (delErr) throw delErr;
        }
        for (let i = 0; i < serviceTemplates.length; i++) {
          const s = serviceTemplates[i];
          if (s.id) {
            const { error: upErr } = await supabase.from("package_services").update(rows[i]).eq("id", s.id);
            if (upErr) throw upErr;
          } else {
            const { error: insErr } = await supabase.from("package_services").insert([{ ...rows[i], package_id: editingPkg.id }]);
            if (insErr) throw insErr;
          }
        }
        logAuditEvent("UPDATE_SERVICE_PACKAGE", "SERVICE_PACKAGES", editingPkg.id, { name: pkgPayload.name, services: rows.length });
        showToast("success", `"${pkgPayload.name}" updated. Changes apply to future onboardings only.`);
      } else {
        const { data: pkgData, error: pkgErr } = await supabase.from("service_packages").insert([pkgPayload]).select().single();
        if (pkgErr || !pkgData) throw pkgErr || new Error("Could not create the package.");
        const { error: srvErr } = await supabase.from("package_services").insert(rows.map((r) => ({ ...r, package_id: pkgData.id })));
        if (srvErr) {
          await supabase.from("service_packages").delete().eq("id", pkgData.id); // roll back
          throw srvErr;
        }
        logAuditEvent("CREATE_SERVICE_PACKAGE", "SERVICE_PACKAGES", pkgData.id, { name: pkgPayload.name, services: rows.length });
        showToast("success", `"${pkgPayload.name}" created with ${rows.length} service${rows.length === 1 ? "" : "s"}.`);
      }
      setIsPkgModalOpen(false);
      loadData();
    } catch (err: any) {
      setPkgError(err?.message || "Could not save the package.");
    } finally {
      setPkgSaving(false);
    }
  }

  /* ---------------- Onboarding ---------------- */

  function openOnboard(pkg: any) {
    setSelectedPkg(pkg);
    setSelectedClientId("");
    setStartDate(localISODate());
    setReviewerId("");
    setOnboardError("");
  }

  const subscribedClientIds = selectedPkg ? new Set(activeSubsFor(selectedPkg.id).map((s) => s.client_id)) : new Set<string>();
  const selectedClient = clientById[selectedClientId];
  const preview = selectedPkg
    ? (selectedPkg.package_services || [])
        .slice()
        .sort((a: any, b: any) => Number(a.days_due_offset) - Number(b.days_due_offset))
        .map((s: any) => {
          const assignee = s.default_assignee_id || selectedClient?.assigned_to || "";
          return {
            ...s,
            due: addDays(startDate || localISODate(), Number(s.days_due_offset ?? 10)),
            assignee,
            reviewerDropped: !!reviewerId && reviewerId === assignee,
          };
        })
    : [];

  async function handleOnboardClient() {
    if (!selectedPkg || onboarding) return;
    setOnboardError("");
    if (!selectedClientId) return setOnboardError("Choose a client.");
    if (!startDate) return setOnboardError("Choose a start date.");

    setOnboarding(true);
    const { data, error } = await supabase.rpc("onboard_client_package", {
      p_client_id: selectedClientId,
      p_package_id: selectedPkg.id,
      p_start: startDate,
      p_reviewer: reviewerId || null,
    });
    setOnboarding(false);

    if (error) return setOnboardError(error.message);

    const result = data as { tasks_created: number; unassigned: number };
    logAuditEvent("ONBOARD_CLIENT_PACKAGE", "CLIENT_PACKAGES", selectedPkg.id, {
      client: selectedClient?.name,
      package: selectedPkg.name,
      tasks: result?.tasks_created,
    });
    showToast(
      "success",
      `${selectedClient?.name} onboarded to ${selectedPkg.name}. ${result?.tasks_created ?? 0} tasks created${
        result?.unassigned ? `, ${result.unassigned} unassigned (client has no relationship manager)` : ""
      }.`
    );
    setSelectedPkg(null);
    loadData();
  }

  /* ---------------- Archive / delete / end subscription ---------------- */

  async function runConfirm() {
    if (!confirm) return;
    setActionBusy(true);
    const { kind, target } = confirm;
    let error: any = null;

    if (kind === "archive") {
      ({ error } = await supabase.from("service_packages").update({ is_active: target.is_active === false }).eq("id", target.id));
      if (!error) logAuditEvent(target.is_active === false ? "RESTORE_SERVICE_PACKAGE" : "ARCHIVE_SERVICE_PACKAGE", "SERVICE_PACKAGES", target.id, { name: target.name });
    } else if (kind === "delete") {
      const { error: sErr } = await supabase.from("package_services").delete().eq("package_id", target.id);
      error = sErr;
      if (!error) ({ error } = await supabase.from("service_packages").delete().eq("id", target.id));
      if (!error) logAuditEvent("DELETE_SERVICE_PACKAGE", "SERVICE_PACKAGES", target.id, { name: target.name });
    } else if (kind === "end") {
      ({ error } = await supabase.from("client_packages").update({ status: "Ended", end_date: localISODate() }).eq("id", target.id));
      if (!error) logAuditEvent("END_CLIENT_PACKAGE", "CLIENT_PACKAGES", target.id, { client: clientById[target.client_id]?.name });
    }

    setActionBusy(false);
    setConfirm(null);
    if (error) return showToast("error", error.message);
    showToast("success", kind === "end" ? "Subscription ended." : kind === "delete" ? "Package deleted." : target.is_active === false ? "Package restored." : "Package archived.");
    loadData();
  }

  /* ---------------- Render ---------------- */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <Layers className="h-5 w-5 text-navy" /> Service Package Workflows
          </h2>
          <p className="mt-1 text-xs text-text-muted">Bundle compliance retainers and generate every recurring task in one step when a client signs up.</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt sm:flex-none"
          >
            <Archive className="h-4 w-4 text-navy" /> {showArchived ? "Show active" : "Archived"}
          </button>
          <button
            type="button"
            onClick={() => openPkgModal()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light sm:flex-none"
          >
            <Plus className="h-4 w-4" /> Create Package
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          { label: "Active Packages", value: String(stats.packages), sub: "Available for onboarding", icon: Layers, style: "bg-navy/10 text-navy", valueClass: "text-navy" },
          { label: "Active Subscriptions", value: String(stats.subscriptions), sub: "Clients on retainers", icon: Users, style: "bg-violet-50 text-violet-600", valueClass: "text-violet-700" },
          { label: "Monthly Recurring (MRR)", value: compactINR(stats.mrr), sub: "Normalised to one month", icon: IndianRupee, style: "bg-emerald-50 text-emerald-600", valueClass: "text-emerald-700" },
          { label: "Annual Recurring (ARR)", value: compactINR(stats.arr), sub: "MRR × 12", icon: RefreshCw, style: "bg-amber-50 text-amber-600", valueClass: "text-amber-700" },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{k.label}</p>
                  <p className={`mt-1.5 text-2xl font-bold tracking-tight ${k.valueClass}`}>{k.value}</p>
                </div>
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${k.style}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-text-muted">{k.sub}</p>
            </div>
          );
        })}
      </div>

      {/* Package grid */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface p-10 text-xs text-text-muted shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading packages...
        </div>
      ) : visiblePackages.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-xs text-text-muted shadow-sm">
          {showArchived ? "No archived packages." : "No service packages yet. Create your first retainer."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visiblePackages.map((pkg) => {
            const subs = activeSubsFor(pkg.id);
            const everSubscribed = subscriptions.some((s) => s.package_id === pkg.id);
            const isOpen = expanded === pkg.id;
            const services = (pkg.package_services || []).slice().sort((a: any, b: any) => Number(a.days_due_offset) - Number(b.days_due_offset));
            return (
              <div key={pkg.id} className={`flex flex-col rounded-xl border bg-surface shadow-sm ${pkg.is_active === false ? "border-border opacity-80" : "border-border"}`}>
                <div className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-navy">{pkg.name}</h3>
                      {pkg.description && <p className="text-xs text-text-muted">{pkg.description}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-bold text-emerald-700">{formatINR(Number(pkg.price || 0))}</p>
                      <p className="text-[10px] text-text-muted">per {String(pkg.billing_cycle || "Monthly").toLowerCase().replace("ly", "") || "month"}</p>
                    </div>
                  </div>

                  <div className="space-y-1.5 rounded-lg border border-border bg-surface-alt p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-navy">Bundled Services ({services.length})</p>
                    {services.length === 0 ? (
                      <p className="text-[11px] text-text-muted">No services bundled.</p>
                    ) : (
                      services.map((s: any) => (
                        <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate font-medium text-text-main">
                            {s.title} <span className="text-text-muted">· {s.category}</span>
                          </span>
                          <span className="shrink-0 text-[10px] text-text-muted">
                            +{s.days_due_offset}d · {s.recurrence && s.recurrence !== "None" ? `↻ ${s.recurrence}` : "one-time"} · {teamName(s.default_assignee_id) || "Client's RM"}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  <button type="button" onClick={() => setExpanded(isOpen ? null : pkg.id)} className="flex w-full items-center justify-between text-xs font-semibold text-text-main">
                    <span className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-navy" /> {subs.length} active subscriber{subs.length === 1 ? "" : "s"}
                    </span>
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  {isOpen && (
                    <div className="space-y-1.5">
                      {subs.length === 0 ? (
                        <p className="text-[11px] italic text-text-muted">No clients on this package yet.</p>
                      ) : (
                        subs.map((s) => (
                          <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[11px]">
                            <span className="font-medium text-text-main">{clientById[s.client_id]?.name || "Client"}</span>
                            <span className="flex items-center gap-2 text-text-muted">
                              since {formatDate(s.start_date)}
                              <button type="button" onClick={() => setConfirm({ kind: "end", target: s })} className="rounded px-1.5 py-0.5 font-semibold text-rose-600 transition hover:bg-rose-50">
                                End
                              </button>
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-auto flex flex-wrap gap-2 border-t border-border p-3">
                  {pkg.is_active !== false && (
                    <button
                      type="button"
                      onClick={() => openOnboard(pkg)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-navy py-2 text-xs font-semibold text-white transition hover:bg-navy-light"
                    >
                      <UserCheck className="h-4 w-4" /> Onboard Client
                    </button>
                  )}
                  <button type="button" onClick={() => openPkgModal(pkg)} className="rounded-lg border border-border px-3 py-2 text-navy transition hover:bg-surface-alt" title="Edit package">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirm({ kind: "archive", target: pkg })}
                    className="rounded-lg border border-border px-3 py-2 text-text-muted transition hover:bg-surface-alt"
                    title={pkg.is_active === false ? "Restore package" : "Archive package"}
                  >
                    {pkg.is_active === false ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                  </button>
                  {!everSubscribed && (
                    <button type="button" onClick={() => setConfirm({ kind: "delete", target: pkg })} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-600 transition hover:bg-rose-100" title="Delete package">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================= Create / Edit Package ================= */}
      {isPkgModalOpen && (
        <Modal
          title={editingPkg ? `Edit ${editingPkg.name}` : "Create Retainer Package"}
          subtitle={editingPkg ? "Changes apply to future onboardings. Existing client tasks are not modified." : undefined}
          onClose={() => !pkgSaving && setIsPkgModalOpen(false)}
          maxWidth="max-w-3xl"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsPkgModalOpen(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Cancel
              </button>
              <button
                type="submit"
                form="pkg-form"
                disabled={pkgSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
              >
                {pkgSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save Package
              </button>
            </div>
          }
        >
          <form id="pkg-form" onSubmit={handleSavePackage} className="space-y-4 text-xs">
            {pkgError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 font-medium text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{pkgError}</span>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className={labelClass}>Package Name *</label>
                <input value={pkgName} onChange={(e) => setPkgName(e.target.value)} className={inputClass} placeholder="e.g. Complete GST Retainer" maxLength={120} />
              </div>
              <div>
                <label className={labelClass}>Billing Cycle</label>
                <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)} className={inputClass}>
                  {CYCLES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Retainer Fee (₹) *</label>
                <input type="number" min="0" step="1" value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} placeholder="15000" />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Description</label>
                <input value={pkgDesc} onChange={(e) => setPkgDesc(e.target.value)} className={inputClass} placeholder="Scope of the retainer..." />
              </div>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold uppercase tracking-wide text-navy">Services (become tasks on onboarding)</label>
                <button type="button" onClick={() => setServiceTemplates([...serviceTemplates, { ...EMPTY_SERVICE }])} className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy hover:underline">
                  <Plus className="h-3 w-3" /> Add service
                </button>
              </div>
              <div className="hidden grid-cols-12 gap-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted sm:grid">
                <span className="col-span-4">Task title</span>
                <span className="col-span-2">Category</span>
                <span className="col-span-1">Due +days</span>
                <span className="col-span-2">Recurrence</span>
                <span className="col-span-2">Assign to</span>
              </div>
              {serviceTemplates.map((srv, idx) => (
                <div key={srv.id || `new-${idx}`} className="grid grid-cols-2 items-center gap-2 rounded-lg border border-border bg-surface-alt p-2 sm:grid-cols-12">
                  <input value={srv.title} onChange={(e) => updateTemplateField(idx, "title", e.target.value)} placeholder="e.g. GSTR-1 filing" className={`${smallInput} col-span-2 sm:col-span-4`} />
                  <select value={srv.category} onChange={(e) => updateTemplateField(idx, "category", e.target.value)} className={`${smallInput} sm:col-span-2`}>
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <input type="number" min={0} max={365} value={srv.days_due_offset} onChange={(e) => updateTemplateField(idx, "days_due_offset", Number(e.target.value))} className={`${smallInput} sm:col-span-1`} />
                  <select value={srv.recurrence} onChange={(e) => updateTemplateField(idx, "recurrence", e.target.value)} className={`${smallInput} sm:col-span-2`}>
                    {RECURRENCES.map((r) => (
                      <option key={r} value={r}>{r === "None" ? "One-time" : r}</option>
                    ))}
                  </select>
                  <select value={srv.default_assignee_id} onChange={(e) => updateTemplateField(idx, "default_assignee_id", e.target.value)} className={`${smallInput} sm:col-span-2`}>
                    <option value="">Client's RM</option>
                    {activeTeam.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setServiceTemplates(serviceTemplates.filter((_, i) => i !== idx))}
                    disabled={serviceTemplates.length === 1}
                    className="flex justify-center rounded-md p-1.5 text-rose-600 transition hover:bg-rose-50 disabled:opacity-30 sm:col-span-1"
                    aria-label="Remove service"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <p className="text-[10px] text-text-muted">
                "Due +days" counts from the client's start date. Recurring services create their next occurrence automatically when approved.
              </p>
            </div>
          </form>
        </Modal>
      )}

      {/* ================= Onboard Client ================= */}
      {selectedPkg && (
        <Modal
          title={`Onboard client to ${selectedPkg.name}`}
          subtitle={`${formatINR(Number(selectedPkg.price || 0))} / ${selectedPkg.billing_cycle}`}
          onClose={() => !onboarding && setSelectedPkg(null)}
          maxWidth="max-w-2xl"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSelectedPkg(null)} disabled={onboarding} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleOnboardClient}
                disabled={onboarding || !selectedClientId}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
              >
                {onboarding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Confirm & Create {preview.length} Tasks
              </button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            {onboardError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 font-medium text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{onboardError}</span>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className={labelClass}>Client *</label>
                <select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} className={inputClass}>
                  <option value="">— Choose client —</option>
                  {clients
                    .filter((c) => c.status !== "Inactive")
                    .map((c) => (
                      <option key={c.id} value={c.id} disabled={subscribedClientIds.has(c.id)}>
                        {c.name}
                        {subscribedClientIds.has(c.id) ? " (already subscribed)" : ""}
                      </option>
                    ))}
                </select>
                {selectedClient && (
                  <p className="mt-1 text-[10px] text-text-muted">Relationship manager: {teamName(selectedClient.assigned_to) || "none (tasks without a default assignee will be unassigned)"}</p>
                )}
              </div>
              <div>
                <label className={labelClass}>Start Date *</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
              </div>
              <div className="sm:col-span-3">
                <label className={labelClass}>Reviewer for these tasks</label>
                <select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} className={inputClass}>
                  <option value="">— No reviewer —</option>
                  {reviewers.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Tasks that will be created</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Due</th>
                      <th>Recurrence</th>
                      <th>Assigned to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((p: any) => (
                      <tr key={p.id}>
                        <td className="font-medium text-text-main">{p.title}</td>
                        <td className="whitespace-nowrap">{formatDate(p.due)}</td>
                        <td>{p.recurrence && p.recurrence !== "None" ? `↻ ${p.recurrence}` : "One-time"}</td>
                        <td>
                          {teamName(p.assignee) || <span className="font-semibold text-rose-600">Unassigned</span>}
                          {p.reviewerDropped && <span className="block text-[10px] text-amber-700">No reviewer (same person)</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirmations */}
      {confirm && (
        <ConfirmDialog
          title={
            confirm.kind === "end"
              ? "End this subscription?"
              : confirm.kind === "delete"
              ? "Delete this package?"
              : confirm.target.is_active === false
              ? "Restore this package?"
              : "Archive this package?"
          }
          message={
            confirm.kind === "end"
              ? `${clientById[confirm.target.client_id]?.name || "This client"} will be marked as no longer on this package. Recurring tasks already created will continue; change their recurrence on the Tasks page if needed.`
              : confirm.kind === "delete"
              ? `"${confirm.target.name}" and its service templates will be permanently removed.`
              : confirm.target.is_active === false
              ? `"${confirm.target.name}" will be available for onboarding again.`
              : `"${confirm.target.name}" will be hidden from onboarding. Existing subscriptions are not affected.`
          }
          confirmLabel={confirm.kind === "end" ? "End subscription" : confirm.kind === "delete" ? "Delete package" : confirm.target.is_active === false ? "Restore" : "Archive"}
          tone={confirm.kind === "archive" && confirm.target.is_active === false ? "primary" : "danger"}
          loading={actionBusy}
          onConfirm={runConfirm}
          onCancel={() => setConfirm(null)}
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
          <button type="button" onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}