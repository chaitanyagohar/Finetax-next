"use client";

import { useState, useEffect } from "react";
import { Layers, Plus, Trash2, CheckCircle2, UserCheck, Calendar, ArrowRight, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";

export default function PackagesPage() {
  const [packages, setPackages] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State - Package Creation
  const [isPkgModalOpen, setIsPkgModalOpen] = useState(false);
  const [pkgName, setPkgName] = useState("");
  const [pkgDesc, setPkgDesc] = useState("");
  const [billingCycle, setBillingCycle] = useState("Monthly");
  const [price, setPrice] = useState("");

  // Sub-Services Form State
  const [serviceTemplates, setServiceTemplates] = useState<any[]>([
    { title: "GST-3B Return Filing", category: "GST", days_due_offset: 20, recurrence: "Monthly", default_assignee_id: "" }
  ]);

  // Modal State - Onboarding Client
  const [isOnboardModalOpen, setIsOnboardModalOpen] = useState(false);
  const [selectedPkg, setSelectedPkg] = useState<any | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [{ data: pData }, { data: cData }, { data: tData }] = await Promise.all([
      supabase.from("service_packages").select("*, package_services(*)").order("created_at", { ascending: false }),
      supabase.from("clients").select("*").order("name", { ascending: true }),
      supabase.from("profiles").select("*").order("name", { ascending: true })
    ]);

    if (pData) setPackages(pData);
    if (cData) setClients(cData);
    if (tData) setTeam(tData);
    setLoading(false);
  }

  function addServiceTemplateRow() {
    setServiceTemplates([
      ...serviceTemplates,
      { title: "", category: "GST", days_due_offset: 10, recurrence: "Monthly", default_assignee_id: "" }
    ]);
  }

  function removeServiceTemplateRow(index: number) {
    setServiceTemplates(serviceTemplates.filter((_, idx) => idx !== index));
  }

  function updateTemplateField(index: number, field: string, value: any) {
    const updated = [...serviceTemplates];
    updated[index][field] = value;
    setServiceTemplates(updated);
  }

  // Create Package & Template Services
  async function handleCreatePackage(e: React.FormEvent) {
    e.preventDefault();

    const { data: pkgData, error: pkgErr } = await supabase
      .from("service_packages")
      .insert([
        {
          name: pkgName.trim(),
          description: pkgDesc.trim(),
          billing_cycle: billingCycle,
          price: Number(price) || 0,
        }
      ])
      .select()
      .single();

    if (pkgErr) return alert("Error creating package: " + pkgErr.message);

    // Insert sub-service templates
    const templatesWithId = serviceTemplates.map((s) => ({
      package_id: pkgData.id,
      title: s.title.trim(),
      category: s.category,
      days_due_offset: Number(s.days_due_offset) || 10,
      recurrence: s.recurrence,
      default_assignee_id: s.default_assignee_id || null,
    }));

    const { error: srvErr } = await supabase.from("package_services").insert(templatesWithId);
    if (srvErr) alert("Package created, but template sub-services failed: " + srvErr.message);
    else {
      logAuditEvent("CREATE_SERVICE_PACKAGE", "SERVICE_PACKAGES", pkgData.id);
      alert("Service package created successfully!");
    }

    setIsPkgModalOpen(false);
    resetPkgForm();
    loadData();
  }

  // Onboard Client to Package & Auto-Generate Recurring Tasks
  async function handleOnboardClient(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPkg || !selectedClientId) return;

    // 1. Record Client Subscription
    const { error: subErr } = await supabase.from("client_packages").insert([
      {
        client_id: selectedClientId,
        package_id: selectedPkg.id,
        start_date: startDate,
        status: "Active"
      }
    ]);

    if (subErr) return alert("Error onboarding client: " + subErr.message);

    // 2. Auto-generate sub-tasks based on templates
    const start = new Date(startDate);
    const generatedTasks = (selectedPkg.package_services || []).map((srv: any) => {
      const dueDateObj = new Date(start);
      dueDateObj.setDate(dueDateObj.getDate() + (srv.days_due_offset || 10));

      return {
        title: srv.title,
        client_id: selectedClientId,
        category: srv.category || "Other",
        due_date: dueDateObj.toISOString().slice(0, 10),
        assigned_to: srv.default_assignee_id || null,
        stage: "Assigned",
        priority: "Medium",
        recurrence: srv.recurrence || "Monthly",
        notes: `Auto-generated via Package: ${selectedPkg.name}`,
      };
    });

    if (generatedTasks.length > 0) {
      const { error: taskErr } = await supabase.from("tasks").insert(generatedTasks);
      if (taskErr) alert("Onboarded, but task auto-generation had issues: " + taskErr.message);
      else {
        logAuditEvent("ONBOARD_CLIENT_PACKAGE", "CLIENT_PACKAGES", selectedPkg.id, { clientId: selectedClientId });
        alert(`Client onboarded! ${generatedTasks.length} recurring sub-tasks auto-created.`);
      }
    }

    setIsOnboardModalOpen(false);
    loadData();
  }

  function resetPkgForm() {
    setPkgName("");
    setPkgDesc("");
    setBillingCycle("Monthly");
    setPrice("");
    setServiceTemplates([
      { title: "GST-3B Return Filing", category: "GST", days_due_offset: 20, recurrence: "Monthly", default_assignee_id: "" }
    ]);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-surface p-5 rounded-lg border border-border shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-text-main flex items-center gap-2">
            <Layers className="h-5 w-5 text-navy" /> Service Package Workflows
          </h2>
          <p className="text-xs text-text-muted mt-1">
            Bundle compliance retainers and auto-generate recurring execution sub-tasks upon client onboarding.
          </p>
        </div>
        <button
          onClick={() => setIsPkgModalOpen(true)}
          className="flex items-center gap-2 bg-navy text-white px-4 py-2 rounded-md font-medium text-xs hover:bg-navy/90 transition"
        >
          <Plus className="h-4 w-4" /> Create Package
        </button>
      </div>

      {/* Package List Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading ? (
          <div className="col-span-2 p-8 text-center text-text-muted text-xs">Loading packages...</div>
        ) : packages.length === 0 ? (
          <div className="col-span-2 p-8 text-center text-text-muted text-xs bg-surface rounded-lg border border-border">
            No service packages configured yet.
          </div>
        ) : (
          packages.map((pkg) => (
            <div key={pkg.id} className="bg-surface p-5 rounded-lg border border-border shadow-sm space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-base text-navy">{pkg.name}</h3>
                    <p className="text-xs text-text-muted">{pkg.description}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-bold text-emerald-600">₹{Number(pkg.price).toLocaleString("en-IN")}</span>
                    <span className="text-[10px] text-text-muted block capitalize">/ {pkg.billing_cycle}</span>
                  </div>
                </div>

                {/* Sub-Service Templates Breakdown */}
                <div className="bg-background p-3 rounded border border-border space-y-2">
                  <span className="text-[10px] font-bold uppercase text-navy tracking-wider">Bundled Sub-Services</span>
                  {(pkg.package_services || []).length === 0 ? (
                    <p className="text-[11px] text-text-muted">No template sub-services bundled.</p>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {pkg.package_services.map((s: any) => (
                        <li key={s.id} className="flex items-center justify-between text-text-main">
                          <span className="font-medium">• {s.title} ({s.category})</span>
                          <span className="text-[10px] text-text-muted">Due +{s.days_due_offset} days</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <button
                onClick={() => {
                  setSelectedPkg(pkg);
                  setIsOnboardModalOpen(true);
                }}
                className="w-full py-2 bg-navy text-white rounded font-semibold text-xs hover:bg-navy/90 flex items-center justify-center gap-1.5"
              >
                <UserCheck className="h-4 w-4" /> Onboard Client to Package
              </button>
            </div>
          ))
        )}
      </div>

      {/* Create Package Modal */}
      {isPkgModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-surface rounded-lg border border-border w-full max-w-2xl p-6 space-y-4 shadow-xl text-xs my-8">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-base text-text-main">Create Retainer Package</h3>
              <button onClick={() => setIsPkgModalOpen(false)} className="text-text-muted hover:text-text-main">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePackage} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">PACKAGE NAME *</label>
                  <input required type="text" value={pkgName} onChange={(e) => setPkgName(e.target.value)} className="w-full border border-border rounded p-2 text-xs" placeholder="e.g. Complete GST Retainer" />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">RETAINER FEE (₹) *</label>
                  <input required type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full border border-border rounded p-2 text-xs" placeholder="15000" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">BILLING CYCLE</label>
                  <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                    <option>Monthly</option><option>Quarterly</option><option>Yearly</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">DESCRIPTION</label>
                  <input type="text" value={pkgDesc} onChange={(e) => setPkgDesc(e.target.value)} className="w-full border border-border rounded p-2 text-xs" placeholder="Package scope..." />
                </div>
              </div>

              {/* Dynamic Sub-Service Template Builder */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-navy text-xs uppercase">Bundled Sub-Task Templates</label>
                  <button type="button" onClick={addServiceTemplateRow} className="text-navy font-bold hover:underline text-[11px] flex items-center gap-1">
                    <Plus className="h-3 w-3" /> Add Sub-Task
                  </button>
                </div>

                {serviceTemplates.map((srv, idx) => (
                  <div key={idx} className="p-3 border border-border rounded bg-background grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <input required type="text" placeholder="Sub-Task Title" value={srv.title} onChange={(e) => updateTemplateField(idx, "title", e.target.value)} className="sm:col-span-4 border border-border rounded p-1.5 text-xs" />
                    <select value={srv.category} onChange={(e) => updateTemplateField(idx, "category", e.target.value)} className="sm:col-span-2 border border-border rounded p-1.5 text-xs bg-surface">
                      <option>GST</option><option>Income Tax</option><option>Audit</option><option>ROC</option><option>Other</option>
                    </select>
                    <input type="number" placeholder="+Days" value={srv.days_due_offset} onChange={(e) => updateTemplateField(idx, "days_due_offset", e.target.value)} className="sm:col-span-2 border border-border rounded p-1.5 text-xs" />
                    <select value={srv.default_assignee_id} onChange={(e) => updateTemplateField(idx, "default_assignee_id", e.target.value)} className="sm:col-span-3 border border-border rounded p-1.5 text-xs bg-surface">
                      <option value="">Auto Assign Staff</option>
                      {team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <button type="button" onClick={() => removeServiceTemplateRow(idx)} className="sm:col-span-1 text-rose-600 hover:bg-rose-50 p-1 rounded flex justify-center">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button type="button" onClick={() => setIsPkgModalOpen(false)} className="px-4 py-2 border border-border rounded">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-navy text-white rounded font-bold">Save Service Package</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Onboard Client Modal */}
      {isOnboardModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md p-5 space-y-4 shadow-xl text-xs">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-sm text-text-main">Onboard Client to {selectedPkg?.name}</h3>
              <button onClick={() => setIsOnboardModalOpen(false)} className="text-text-muted"><X className="h-4 w-4" /></button>
            </div>

            <form onSubmit={handleOnboardClient} className="space-y-3">
              <div>
                <label className="block font-semibold text-text-muted mb-1">SELECT CLIENT *</label>
                <select required value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                  <option value="">-- Choose Client --</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-text-muted mb-1">CONTRACT START DATE</label>
                <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full border border-border rounded p-2 text-xs" />
              </div>

              <div className="p-3 bg-blue-50 border border-blue-200 rounded text-navy text-[11px] space-y-1">
                <p className="font-bold">Automated Action Notice:</p>
                <p>Onboarding this client will instantly create {(selectedPkg?.package_services || []).length} recurring compliance sub-tasks with assigned due dates.</p>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button type="button" onClick={() => setIsOnboardModalOpen(false)} className="px-4 py-1.5 border border-border rounded">Cancel</button>
                <button type="submit" className="px-4 py-1.5 bg-navy text-white rounded font-bold">Confirm & Auto-Generate Tasks</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}