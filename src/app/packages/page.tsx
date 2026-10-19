"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Layers,
  Plus,
  Trash2,
  CheckCircle2,
  UserCheck,
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
  FileSignature,
  Receipt,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import ClientPicker, { clientLabel } from "@/components/ui/ClientPicker";
import { useTaskCategories } from "@/components/tasks/TaskCategories";
import EngagementSettingsButton from "@/components/packages/EngagementSettings";
import ProposalsPanel, { ProposalComposer } from "@/components/packages/Proposals";
import SubscriptionBilling from "@/components/packages/SubscriptionBilling";
import { compactINR, formatDate, formatINR, localISODate } from "@/lib/format";

const RECURRENCES = ["None", "Weekly", "Monthly", "Quarterly", "Yearly"];
const CYCLES = ["Monthly", "Quarterly", "Half-Yearly", "Yearly"];
const CYCLE_MONTHS: Record<string, number> = { Monthly: 1, Quarterly: 3, "Half-Yearly": 6, Yearly: 12 };

type ServiceRow = { id?: string; task_type_id: string; title: string; category: string; days_due_offset: number; recurrence: string; default_assignee_id: string };
const EMPTY_SERVICE: ServiceRow = { task_type_id: "", title: "", category: "GST", days_due_offset: 10, recurrence: "Monthly", default_assignee_id: "" };

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
  const { activeNames: CATEGORIES } = useTaskCategories();
  const tabParam = useSearchParams().get("tab");

  const [tab, setTab] = useState<"packages" | "proposals" | "billing">(tabParam === "billing" ? "billing" : tabParam === "proposals" ? "proposals" : "packages");
  const [packages, setPackages] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [taskTypes, setTaskTypes] = useState<any[]>([]);
  const [schedule, setSchedule] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [composerFor, setComposerFor] = useState<string | null | undefined>(undefined);

  // Package modal
  const [isPkgModalOpen, setIsPkgModalOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState<any | null>(null);
  const [pkgName, setPkgName] = useState("");
  const [pkgDesc, setPkgDesc] = useState("");
  const [billingCycle, setBillingCycle] = useState("Monthly");
  const [price, setPrice] = useState("");
  const [legal, setLegal] = useState({ scope_of_work: "", exclusions: "", client_responsibilities: "", special_terms: "" });
  const [billing, setBilling] = useState({ gst_rate: 18, bill_day: 5, due_days: 5, late_fee_percent: 1.5, late_fee_min: 100, prorate_first: true });
  const [serviceTemplates, setServiceTemplates] = useState<ServiceRow[]>([{ ...EMPTY_SERVICE, title: "GSTR-3B Return Filing", days_due_offset: 20 }]);
  const [pkgSaving, setPkgSaving] = useState(false);
  const [pkgError, setPkgError] = useState("");

  // Direct onboarding
  const [selectedPkg, setSelectedPkg] = useState<any | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [startDate, setStartDate] = useState(localISODate());
  const [reviewerId, setReviewerId] = useState("");
  const [onboarding, setOnboarding] = useState(false);
  const [onboardError, setOnboardError] = useState("");

  const [confirm, setConfirm] = useState<null | { kind: "delete" | "archive" | "end"; target: any }>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 6000);
  }

  async function loadData() {
    setLoading(true);
    const [pRes, sRes, cRes, tRes, ttRes] = await Promise.all([
      supabase.from("service_packages").select("*, package_services(*)").order("created_at", { ascending: false }),
      supabase.from("client_packages").select("*").order("start_date", { ascending: false }),
      supabase.from("clients").select("id, name, organization_name, email, phone, pan, gstin, assigned_to, status").order("name", { ascending: true }),
      supabase.from("profiles").select("id, name, role, is_active, is_reviewer").order("name", { ascending: true }),
      supabase.from("task_types").select("*").order("category", { ascending: true }).order("name", { ascending: true }),
    ]);
    if (pRes.error) showToast("error", "Could not load packages.");
    setPackages(pRes.data || []);
    setSubscriptions(sRes.data || []);
    setClients(cRes.data || []);
    setTeam(tRes.data || []);
    setTaskTypes(ttRes.data || []);
    setLoading(false);
    setRefreshKey((k) => k + 1);
  }

  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
  const typeById = useMemo(() => Object.fromEntries(taskTypes.map((t) => [t.id, t])), [taskTypes]);
  const typeGroups = useMemo(() => {
    const groups: Record<string, any[]> = {};
    taskTypes.filter((t) => t.is_active).forEach((t) => (groups[t.category || "Other"] = groups[t.category || "Other"] || []).push(t));
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [taskTypes]);
  const teamName = (id?: string) => team.find((t) => t.id === id)?.name || "";
  const activeTeam = team.filter((t) => t.is_active !== false);
  const reviewers = activeTeam.filter((t) => t.role === "admin" || t.role === "reviewer" || t.is_reviewer);
  const activeSubsFor = (pkgId: string) => subscriptions.filter((s) => s.package_id === pkgId && s.status === "Active");

  const stats = useMemo(() => {
    const activeSubs = subscriptions.filter((s) => s.status === "Active");
    const mrr = activeSubs.reduce((sum, s) => {
      const pkg = packages.find((p) => p.id === s.package_id);
      const fee = Number(s.price ?? pkg?.price ?? 0);
      return sum + fee / (CYCLE_MONTHS[s.billing_cycle || pkg?.billing_cycle] || 1);
    }, 0);
    return { packages: packages.filter((p) => p.is_active !== false).length, subscriptions: activeSubs.length, mrr, arr: mrr * 12 };
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
      setLegal({
        scope_of_work: pkg.scope_of_work || "",
        exclusions: pkg.exclusions || "",
        client_responsibilities: pkg.client_responsibilities || "",
        special_terms: pkg.special_terms || "",
      });
      setBilling({
        gst_rate: Number(pkg.gst_rate ?? 18),
        bill_day: Number(pkg.bill_day ?? 5),
        due_days: Number(pkg.due_days ?? 5),
        late_fee_percent: Number(pkg.late_fee_percent ?? 1.5),
        late_fee_min: Number(pkg.late_fee_min ?? 100),
        prorate_first: pkg.prorate_first ?? true,
      });
      setServiceTemplates(
        (pkg.package_services || []).map((s: any) => ({
          id: s.id,
          title: s.title,
          category: s.category || "GST",
          days_due_offset: Number(s.days_due_offset ?? 10),
          recurrence: s.recurrence || "None",
          default_assignee_id: s.default_assignee_id || "",
          task_type_id: s.task_type_id || "",
        }))
      );
    } else {
      setEditingPkg(null);
      setPkgName("");
      setPkgDesc("");
      setBillingCycle("Monthly");
      setPrice("");
      setLegal({
        scope_of_work: "",
        exclusions: "Representation before tax authorities, assessments, appeals, notices and any work not listed above.",
        client_responsibilities: "Share complete sales, purchase and bank data by the 7th of each month, and approve returns before the filing date.",
        special_terms: "",
      });
      setBilling({ gst_rate: 18, bill_day: 5, due_days: 5, late_fee_percent: 1.5, late_fee_min: 100, prorate_first: true });
      setServiceTemplates([{ ...EMPTY_SERVICE, title: "GSTR-3B Return Filing", days_due_offset: 20 }]);
    }
    setIsPkgModalOpen(true);
  }


  /** Link a service to a Task List entry (title, category and recurrence follow the entry). */
  function linkTaskType(index: number, typeId: string) {
    const t = typeById[typeId];
    setServiceTemplates((rows) =>
      rows.map((r, i) =>
        i !== index ? r : t ? { ...r, task_type_id: typeId, title: t.name, category: t.category || r.category, recurrence: t.default_recurrence || r.recurrence } : { ...r, task_type_id: "" }
      )
    );
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
    if (serviceTemplates.some((s) => !(Number(s.days_due_offset) >= 0 && Number(s.days_due_offset) <= 365))) return setPkgError("Due offsets must be between 0 and 365 days.");
    if (!(billing.bill_day >= 1 && billing.bill_day <= 28)) return setPkgError("Bill day must be between 1 and 28.");

    const pkgPayload = {
      name: pkgName.trim(),
      description: pkgDesc.trim(),
      billing_cycle: billingCycle,
      price: fee,
      scope_of_work: legal.scope_of_work.trim() || null,
      exclusions: legal.exclusions.trim() || null,
      client_responsibilities: legal.client_responsibilities.trim() || null,
      special_terms: legal.special_terms.trim() || null,
      gst_rate: Number(billing.gst_rate),
      bill_day: Number(billing.bill_day),
      due_days: Number(billing.due_days),
      late_fee_percent: Number(billing.late_fee_percent),
      late_fee_min: Number(billing.late_fee_min),
      prorate_first: !!billing.prorate_first,
    };
    const rows = serviceTemplates.map((s) => ({
      title: s.title.trim(),
      category: s.category,
      days_due_offset: Number(s.days_due_offset) || 0,
      recurrence: s.recurrence,
      default_assignee_id: s.default_assignee_id || null,
      task_type_id: s.task_type_id || null,
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
          const { error: err } = s.id
            ? await supabase.from("package_services").update(rows[i]).eq("id", s.id)
            : await supabase.from("package_services").insert([{ ...rows[i], package_id: editingPkg.id }]);
          if (err) throw err;
        }
        logAuditEvent("UPDATE_SERVICE_PACKAGE", "SERVICE_PACKAGES", editingPkg.id, { name: pkgPayload.name, services: rows.length });
        showToast("success", `"${pkgPayload.name}" updated. Changes apply to new proposals and onboardings.`);
      } else {
        const { data: pkgData, error: pkgErr } = await supabase.from("service_packages").insert([pkgPayload]).select().single();
        if (pkgErr || !pkgData) throw pkgErr || new Error("Could not create the package.");
        const { error: srvErr } = await supabase.from("package_services").insert(rows.map((r) => ({ ...r, package_id: pkgData.id })));
        if (srvErr) {
          await supabase.from("service_packages").delete().eq("id", pkgData.id);
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

  /* ---------------- Direct onboarding ---------------- */

  function openOnboard(pkg: any) {
    setSelectedPkg(pkg);
    setSelectedClientId("");
    setStartDate(localISODate());
    setReviewerId("");
    setOnboardError("");
  }

  const subscribedClientIds = selectedPkg ? new Set(activeSubsFor(selectedPkg.id).map((s) => s.client_id)) : new Set<string>();
  const selectedClient = clientById[selectedClientId];
  useEffect(() => {
    if (!selectedPkg || !startDate) {
      setSchedule([]);
      return;
    }
    supabase.rpc("package_schedule_preview", { p_package_id: selectedPkg.id, p_start: startDate }).then(({ data }) => setSchedule(data || []));
  }, [selectedPkg, startDate]);

  const preview = selectedPkg
    ? (selectedPkg.package_services || [])
        .map((s: any) => {
          const sch = schedule.find((x) => x.service_id === s.id);
          const assignee = s.default_assignee_id || selectedClient?.assigned_to || "";
          return {
            ...s,
            title: sch?.title || s.title,
            period: sch?.period || "",
            due: sch?.internal_date || addDays(startDate || localISODate(), Number(s.days_due_offset ?? 10)),
            statutory: sch?.statutory_date || "",
            assignee,
            reviewerDropped: !!reviewerId && reviewerId === assignee,
          };
        })
        .sort((a: any, b: any) => String(a.due).localeCompare(String(b.due)))
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
    logAuditEvent("ONBOARD_CLIENT_PACKAGE", "CLIENT_PACKAGES", selectedPkg.id, { client: clientLabel(selectedClient), package: selectedPkg.name, tasks: result?.tasks_created });
    showToast(
      "success",
      `${clientLabel(selectedClient)} onboarded to ${selectedPkg.name}. ${result?.tasks_created ?? 0} tasks created${result?.unassigned ? `, ${result.unassigned} unassigned` : ""}. Monthly billing is on.`
    );
    setSelectedPkg(null);
    loadData();
  }

  /* ---------------- Archive / delete / end ---------------- */

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
      ({ error } = await supabase.from("client_packages").update({ status: "Ended", end_date: localISODate(), billing_enabled: false }).eq("id", target.id));
      if (!error) logAuditEvent("END_CLIENT_PACKAGE", "CLIENT_PACKAGES", target.id, { client: clientLabel(clientById[target.client_id]) });
    }
    setActionBusy(false);
    setConfirm(null);
    if (error) return showToast("error", error.message);
    showToast("success", kind === "end" ? "Subscription ended and billing stopped." : kind === "delete" ? "Package deleted." : target.is_active === false ? "Package restored." : "Package archived.");
    loadData();
  }

  /* ---------------- Render ---------------- */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm lg:flex-row lg:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <Layers className="h-5 w-5 text-navy" /> Service Packages
          </h2>
          <p className="mt-1 text-xs text-text-muted">Retainers, engagement letters and automatic recurring billing.</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 lg:w-auto">
          <EngagementSettingsButton />
          <button type="button" onClick={() => setComposerFor(null)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt">
            <FileSignature className="h-4 w-4 text-navy" /> New Proposal
          </button>
          <button type="button" onClick={() => openPkgModal()} className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light">
            <Plus className="h-4 w-4" /> Create Package
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          { label: "Active Packages", value: String(stats.packages), sub: "Available for proposals", icon: Layers, style: "bg-navy/10 text-navy", valueClass: "text-navy" },
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

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1 shadow-sm">
        {(
          [
            ["packages", "Packages", Layers],
            ["proposals", "Proposals & Engagement Letters", FileSignature],
            ["billing", "Billing", Receipt],
          ] as const
        ).map(([k, l, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${tab === k ? "bg-navy text-white shadow-sm" : "text-text-muted hover:bg-surface-alt"}`}>
            <Icon className="h-3.5 w-3.5" /> {l}
          </button>
        ))}
      </div>

      {tab === "proposals" && (
        <ProposalsPanel packages={packages} clients={clients} refreshKey={refreshKey} onNew={() => setComposerFor(null)} onChanged={loadData} showToast={showToast} />
      )}

      {tab === "billing" && <SubscriptionBilling packages={packages} clients={clients} refreshKey={refreshKey} showToast={showToast} />}

      {tab === "packages" && (
        <>
          <div className="flex justify-end">
            <button type="button" onClick={() => setShowArchived(!showArchived)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt">
              <Archive className="h-4 w-4 text-navy" /> {showArchived ? "Show active" : "Show archived"}
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface p-10 text-xs text-text-muted shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading packages...
            </div>
          ) : visiblePackages.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-10 text-center text-xs text-text-muted shadow-sm">{showArchived ? "No archived packages." : "No service packages yet. Create your first retainer."}</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {visiblePackages.map((pkg) => {
                const subs = activeSubsFor(pkg.id);
                const everSubscribed = subscriptions.some((s) => s.package_id === pkg.id);
                const isOpen = expanded === pkg.id;
                const services = (pkg.package_services || []).slice().sort((a: any, b: any) => Number(a.days_due_offset) - Number(b.days_due_offset));
                return (
                  <div key={pkg.id} className={`flex flex-col rounded-xl border border-border bg-surface shadow-sm ${pkg.is_active === false ? "opacity-80" : ""}`}>
                    <div className="space-y-4 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-base font-bold text-navy">{pkg.name}</h3>
                          {pkg.description && <p className="text-xs text-text-muted">{pkg.description}</p>}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-lg font-bold text-emerald-700">{formatINR(Number(pkg.price || 0))}</p>
                          <p className="text-[10px] text-text-muted">
                            per {String(pkg.billing_cycle || "Monthly").toLowerCase().replace("ly", "")} + GST {Number(pkg.gst_rate ?? 18)}%
                          </p>
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
                                {s.task_type_id && typeById[s.task_type_id]?.statutory_day ? "statutory rule" : `+${s.days_due_offset}d`} ·{" "}
                                {s.recurrence && s.recurrence !== "None" ? `↻ ${s.recurrence}` : "one-time"} · {teamName(s.default_assignee_id) || "Client's RM"}
                              </span>
                            </div>
                          ))
                        )}
                      </div>

                      <p className="text-[10px] text-text-muted">
                        Bills on the {pkg.bill_day ?? 5}th · due in {pkg.due_days ?? 5} days · late fee {Number(pkg.late_fee_percent ?? 1.5)}%/month (min {formatINR(Number(pkg.late_fee_min ?? 100))})
                        {pkg.scope_of_work || pkg.exclusions ? " · engagement terms set" : ""}
                      </p>

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
                                <span className="font-medium text-text-main">{clientLabel(clientById[s.client_id]) || "Client"}</span>
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
                        <>
                          <button type="button" onClick={() => setComposerFor(pkg.id)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-navy py-2 text-xs font-semibold text-white transition hover:bg-navy-light">
                            <FileSignature className="h-4 w-4" /> Send Proposal
                          </button>
                          <button type="button" onClick={() => openOnboard(pkg)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-navy transition hover:bg-surface-alt" title="Onboard directly without a proposal">
                            <UserCheck className="h-4 w-4" /> Onboard
                          </button>
                        </>
                      )}
                      <button type="button" onClick={() => openPkgModal(pkg)} className="rounded-lg border border-border px-3 py-2 text-navy transition hover:bg-surface-alt" title="Edit package">
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setConfirm({ kind: "archive", target: pkg })} className="rounded-lg border border-border px-3 py-2 text-text-muted transition hover:bg-surface-alt" title={pkg.is_active === false ? "Restore package" : "Archive package"}>
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
        </>
      )}

      {/* ================= Create / Edit Package ================= */}
      {isPkgModalOpen && (
        <Modal
          title={editingPkg ? `Edit ${editingPkg.name}` : "Create Retainer Package"}
          subtitle="Services become tasks on onboarding. Terms and billing defaults are copied into each proposal."
          onClose={() => !pkgSaving && setIsPkgModalOpen(false)}
          maxWidth="max-w-4xl"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsPkgModalOpen(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Cancel
              </button>
              <button type="submit" form="pkg-form" disabled={pkgSaving} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60">
                {pkgSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save Package
              </button>
            </div>
          }
        >
          <form id="pkg-form" onSubmit={handleSavePackage} className="space-y-5 text-xs">
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
                <label className={labelClass}>Retainer Fee (₹, before GST) *</label>
                <input type="number" min="0" step="1" value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} placeholder="15000" />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Short description</label>
                <input value={pkgDesc} onChange={(e) => setPkgDesc(e.target.value)} className={inputClass} placeholder="Shown on the package card" />
              </div>
            </div>

            {/* Services */}
            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold uppercase tracking-wide text-navy">Services (become tasks on onboarding)</label>
                <button type="button" onClick={() => setServiceTemplates([...serviceTemplates, { ...EMPTY_SERVICE }])} className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy hover:underline">
                  <Plus className="h-3 w-3" /> Add service
                </button>
              </div>
              {serviceTemplates.map((srv, idx) => (
                <div key={srv.id || `new-${idx}`} className="grid grid-cols-2 items-center gap-2 rounded-lg border border-border bg-surface-alt p-2 sm:grid-cols-12">
                  <div className="col-span-2 space-y-1 sm:col-span-4">
                    <select value={srv.task_type_id} onChange={(e) => linkTaskType(idx, e.target.value)} className={smallInput}>
                      <option value="">Custom (not in Task List)</option>
                      {typeGroups.map(([cat, list]) => (
                        <optgroup key={cat} label={cat}>
                          {list.map((t: any) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {!srv.task_type_id ? (
                      <input value={srv.title} onChange={(e) => updateTemplateField(idx, "title", e.target.value)} placeholder="Custom task title" className={smallInput} />
                    ) : typeById[srv.task_type_id]?.statutory_day ? (
                      <p className="text-[10px] font-semibold text-emerald-700">Deadlines from the Task List rule (the +days field is ignored)</p>
                    ) : (
                      <p className="text-[10px] text-text-muted">No statutory rule on this entry; uses +days</p>
                    )}
                  </div>
                  <select value={srv.category} onChange={(e) => updateTemplateField(idx, "category", e.target.value)} className={`${smallInput} sm:col-span-2`}>
                    {(CATEGORIES.includes(srv.category) ? CATEGORIES : [srv.category, ...CATEGORIES]).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <input type="number" min={0} max={365} value={srv.days_due_offset} onChange={(e) => updateTemplateField(idx, "days_due_offset", Number(e.target.value))} className={`${smallInput} sm:col-span-1`} title="Due + days from start" />
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
                  <button type="button" onClick={() => setServiceTemplates(serviceTemplates.filter((_, i) => i !== idx))} disabled={serviceTemplates.length === 1} className="flex justify-center rounded-md p-1.5 text-rose-600 transition hover:bg-rose-50 disabled:opacity-30 sm:col-span-1" aria-label="Remove service">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Engagement letter text */}
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-navy">Engagement letter details</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(
                  [
                    ["scope_of_work", "Scope of work (details beyond the service list)"],
                    ["exclusions", "Exclusions (not covered by this fee)"],
                    ["client_responsibilities", "Client responsibilities"],
                    ["special_terms", "Special terms"],
                  ] as [keyof typeof legal, string][]
                ).map(([k, l]) => (
                  <div key={k}>
                    <label className={labelClass}>{l}</label>
                    <textarea rows={3} value={legal[k]} onChange={(e) => setLegal({ ...legal, [k]: e.target.value })} className={inputClass} />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-text-muted">Leave a blank line between separate points. Firm-wide clauses are set under "Engagement Terms".</p>
            </div>

            {/* Billing defaults */}
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-navy">Billing defaults</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                {(
                  [
                    ["gst_rate", "GST %", 0, 100],
                    ["bill_day", "Bill on day", 1, 28],
                    ["due_days", "Due in days", 0, 90],
                    ["late_fee_percent", "Late fee %/month", 0, 10],
                    ["late_fee_min", "Late fee min ₹", 0, 100000],
                  ] as [keyof typeof billing, string, number, number][]
                ).map(([k, l, min, max]) => (
                  <div key={k}>
                    <label className={labelClass}>{l}</label>
                    <input type="number" min={min} max={max} step="any" value={billing[k] as number} onChange={(e) => setBilling({ ...billing, [k]: Number(e.target.value) })} className={inputClass} />
                  </div>
                ))}
                <label className="flex cursor-pointer items-end gap-2 pb-2 text-text-main">
                  <input type="checkbox" checked={billing.prorate_first} onChange={(e) => setBilling({ ...billing, prorate_first: e.target.checked })} className="h-4 w-4 accent-navy" /> Pro-rate first
                </label>
              </div>
              <p className="text-[10px] text-text-muted">Example: period 01/09–30/09 → bill dated {billing.bill_day}/10 → due {billing.bill_day + billing.due_days}/10.</p>
            </div>
          </form>
        </Modal>
      )}

      {/* ================= Direct onboarding ================= */}
      {selectedPkg && (
        <Modal
          title={`Onboard client to ${selectedPkg.name}`}
          subtitle="Direct onboarding without a proposal. Billing uses the package defaults."
          onClose={() => !onboarding && setSelectedPkg(null)}
          maxWidth="max-w-2xl"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSelectedPkg(null)} disabled={onboarding} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Cancel
              </button>
              <button type="button" onClick={handleOnboardClient} disabled={onboarding || !selectedClientId} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60">
                {onboarding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Confirm & Create {preview.length} Tasks
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
                <ClientPicker clients={clients.filter((c) => !subscribedClientIds.has(c.id)) as any} value={selectedClientId} onChange={setSelectedClientId} />
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
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Period</th>
                    <th>Internal</th>
                    <th>Statutory</th>
                    <th>Recurrence</th>
                    <th>Assigned to</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p: any) => (
                    <tr key={p.id}>
                      <td className="font-medium text-text-main">{p.title}</td>
                      <td className="whitespace-nowrap text-text-muted">{p.period || "—"}</td>
                      <td className="whitespace-nowrap">{formatDate(p.due)}</td>
                      <td className="whitespace-nowrap font-semibold text-rose-700">{p.statutory ? formatDate(p.statutory) : "—"}</td>
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
        </Modal>
      )}

      {composerFor !== undefined && (
        <ProposalComposer
          packages={packages}
          clients={clients}
          team={team}
          initialPackageId={composerFor || undefined}
          onClose={() => setComposerFor(undefined)}
          onSaved={(message) => {
            setComposerFor(undefined);
            showToast(message.includes("failed") ? "error" : "success", message);
            setTab("proposals");
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "end" ? "End this subscription?" : confirm.kind === "delete" ? "Delete this package?" : confirm.target.is_active === false ? "Restore this package?" : "Archive this package?"}
          message={
            confirm.kind === "end"
              ? `${clientLabel(clientById[confirm.target.client_id]) || "This client"} will stop being billed. Recurring tasks already created continue; change their recurrence on the Tasks page if needed.`
              : confirm.kind === "delete"
              ? `"${confirm.target.name}" and its service templates will be permanently removed.`
              : confirm.target.is_active === false
              ? `"${confirm.target.name}" will be available again.`
              : `"${confirm.target.name}" will be hidden from proposals and onboarding. Existing subscriptions continue.`
          }
          confirmLabel={confirm.kind === "end" ? "End subscription" : confirm.kind === "delete" ? "Delete package" : confirm.target.is_active === false ? "Restore" : "Archive"}
          tone={confirm.kind === "archive" && confirm.target.is_active === false ? "primary" : "danger"}
          loading={actionBusy}
          onConfirm={runConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-[90] flex max-w-sm items-start gap-2 rounded-lg border px-4 py-3 text-xs font-semibold shadow-lg animate-scale-in ${
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