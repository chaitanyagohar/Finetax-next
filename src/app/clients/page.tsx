"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Trash2, X, Building2, ShieldAlert, Upload, Download, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Client } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  
  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  // Form State matching legacy schema
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [type, setType] = useState("Individual");
  const [pan, setPan] = useState("");
  const [gstin, setGstin] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState<"Active" | "Inactive">("Active");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  // CSV Import State
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importCount, setImportCount] = useState<number | null>(null);

  const supabase = createClient();

  useEffect(() => {
    fetchClients();
  }, []);

  async function fetchClients() {
    setLoading(true);
    const { data } = await supabase.from("clients").select("*").order("name", { ascending: true });
    if (data) setClients(data);
    setLoading(false);
  }

  // --- CSV TEMPLATE GENERATOR ---
  function downloadCSVTemplate() {
    const headers = ["Name", "Organization Name", "Type", "PAN", "GSTIN", "Email", "Phone", "State", "Address", "Status", "Notes"];
    const sampleRow = ["Rahul Sharma", "Sharma Logistics Pvt Ltd", "Company", "ABCDE1234F", "07ABCDE1234F1Z5", "rahul@sharmalogistics.com", "9876543210", "Delhi", "Connaught Place New Delhi", "Active", "Imported from legacy system"];
    
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), sampleRow.join(",")].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "finetax_client_import_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // --- BULK CSV PROCESSOR ---
  async function handleCSVImport(e: React.FormEvent) {
    e.preventDefault();
    if (!csvFile) return alert("Please select a valid CSV file.");

    setImporting(true);
    const reader = new FileReader();

    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
        
        if (lines.length < 2) throw new Error("CSV file is empty or missing headers.");

        const recordsToInsert: any[] = [];

        for (let i = 1; i < lines.length; i++) {
          // Parse basic comma-separated line (removes surrounding quotes)
          const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ''));
          if (!values[0]) continue; // Skip if Name is missing

          recordsToInsert.push({
            name: values[0] || "",
            organization_name: values[1] || "",
            type: values[2] || "Individual",
            pan: (values[3] || "").toUpperCase(),
            gstin: (values[4] || "").toUpperCase(),
            email: values[5] || "",
            phone: values[6] || "",
            state: values[7] || "",
            address: values[8] || "",
            status: values[9] || "Active",
            notes: values[10] || "",
            created_at: new Date().toISOString()
          });
        }

        if (recordsToInsert.length === 0) throw new Error("No valid client rows found to import.");

        const { error } = await supabase.from("clients").insert(recordsToInsert);
        if (error) throw error;

        logAuditEvent("BULK_IMPORT_CLIENTS", "CLIENTS", "BATCH", { count: recordsToInsert.length });
        setImportCount(recordsToInsert.length);
        fetchClients();
      } catch (err: any) {
        alert("Import failed: " + err.message);
      } finally {
        setImporting(false);
      }
    };

    reader.readAsText(csvFile);
  }

  function openModal(client?: Client) {
    if (client) {
      setEditingClient(client);
      setName(client.name || "");
      setOrganizationName((client as any).organization_name || "");
      setType((client as any).type || "Individual");
      setPan((client as any).pan || "");
      setGstin((client as any).gstin || "");
      setEmail(client.email || "");
      setPhone(client.phone || "");
      setState((client as any).state || "");
      setStatus(client.status || "Active");
      setAddress((client as any).address || "");
      setNotes((client as any).notes || "");
    } else {
      setEditingClient(null);
      resetForm();
    }
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingClient(null);
    resetForm();
  }

  function resetForm() {
    setName("");
    setOrganizationName("");
    setType("Individual");
    setPan("");
    setGstin("");
    setEmail("");
    setPhone("");
    setState("");
    setStatus("Active");
    setAddress("");
    setNotes("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload = {
      name: name.trim(),
      organization_name: organizationName.trim(),
      type,
      pan: pan.trim().toUpperCase(),
      gstin: gstin.trim().toUpperCase(),
      email: email.trim(),
      phone: phone.trim(),
      state: state.trim(),
      status,
      address: address.trim(),
      notes: notes.trim(),
    };

    if (editingClient) {
      const { error } = await supabase.from("clients").update(payload).eq("id", editingClient.id);
      if (!error) {
        logAuditEvent("UPDATE_CLIENT", "CLIENTS", editingClient.id, payload);
        closeModal();
        fetchClients();
      } else {
        alert("Error updating client: " + error.message);
      }
    } else {
      const { data, error } = await supabase.from("clients").insert([payload]).select().single();
      if (!error) {
        logAuditEvent("CREATE_CLIENT", "CLIENTS", data.id, payload);
        closeModal();
        fetchClients();
      } else {
        alert("Error creating client: " + error.message);
      }
    }
  }

  async function handleDelete() {
    if (!editingClient || !confirm("Delete this client? This cannot be undone.")) return;

    const { error } = await supabase.from("clients").delete().eq("id", editingClient.id);
    if (!error) {
      logAuditEvent("DELETE_CLIENT", "CLIENTS", editingClient.id);
      closeModal();
      fetchClients();
    } else {
      alert("Error deleting client: " + error.message);
    }
  }

  const filteredClients = clients.filter((c) =>
    [c.name, (c as any).organization_name, (c as any).pan, (c as any).gstin, c.email, c.phone]
      .filter(Boolean)
      .some((f) => f.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Search & Actions Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface p-4 rounded-lg border border-border shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by name, org, PAN, GSTIN, email, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy"
          />
        </div>

        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button
            onClick={() => { setImportCount(null); setCsvFile(null); setIsImportModalOpen(true); }}
            className="flex items-center gap-1.5 border border-border hover:bg-background text-text-main px-3 py-2 rounded-md font-medium text-sm transition"
          >
            <Upload className="h-4 w-4 text-navy" /> Bulk Import (CSV)
          </button>
          
          <button
            onClick={() => openModal()}
            className="flex items-center gap-2 bg-navy text-white px-4 py-2 rounded-md font-medium text-sm hover:bg-navy/90 transition"
          >
            <Plus className="h-4 w-4" /> Add Client
          </button>
        </div>
      </div>

      {/* Clients Data Table */}
      <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted text-sm">Loading client directory...</div>
        ) : filteredClients.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-sm">No clients found. Click "+ Add Client" or "Bulk Import" to get started.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>PAN</th>
                  <th>GSTIN</th>
                  <th>Mobile</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredClients.map((c: any) => (
                  <tr key={c.id} className="hover:bg-background/50 transition cursor-pointer" onClick={() => openModal(c)}>
                    <td className="font-semibold text-text-main flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 text-navy shrink-0" /> {c.name}
                    </td>
                    <td>{c.type || "Individual"}</td>
                    <td className="font-mono">{c.pan || "—"}</td>
                    <td className="font-mono">{c.gstin || "—"}</td>
                    <td>{c.phone || "—"}</td>
                    <td>
                      <span className={`px-2 py-0.5 rounded font-medium ${c.status === "Active" ? "bg-success/10 text-success" : "bg-muted text-text-muted"}`}>
                        {c.status || "Active"}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openModal(c);
                        }}
                        className="px-2.5 py-1 bg-background hover:bg-border border border-border rounded text-text-main font-semibold"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CSV Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md p-6 space-y-4 shadow-xl text-sm">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-base text-text-main flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-navy" /> Client Database Import
              </h3>
              <button onClick={() => setIsImportModalOpen(false)}><X className="h-5 w-5 text-text-muted hover:text-text-main" /></button>
            </div>

            {importCount !== null ? (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded text-center space-y-2">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
                <p className="font-bold text-emerald-800 text-base">Import Successful!</p>
                <p className="text-emerald-700">{importCount} clients have been added to your master database.</p>
                <button onClick={() => setIsImportModalOpen(false)} className="mt-2 px-4 py-2 bg-emerald-600 text-white rounded font-bold w-full hover:bg-emerald-700">Continue</button>
              </div>
            ) : (
              <form onSubmit={handleCSVImport} className="space-y-5">
                <div className="text-text-muted text-xs space-y-2">
                  <p>1. Download the exact CSV template format.</p>
                  <p>2. Fill in your existing client data (Do not change column headers).</p>
                  <p>3. Upload the saved `.csv` file here to instantly populate your database.</p>
                </div>

                <button
                  type="button"
                  onClick={downloadCSVTemplate}
                  className="w-full py-2 bg-background border border-border rounded font-bold text-navy flex items-center justify-center gap-1.5 hover:bg-surface transition"
                >
                  <Download className="h-4 w-4" /> Download Sample CSV Template
                </button>

                <div>
                  <label className="block font-semibold text-text-muted mb-1 text-xs">SELECT FILLED CSV FILE</label>
                  <input
                    type="file"
                    accept=".csv"
                    required
                    onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                    className="w-full border border-border rounded p-2 text-sm bg-background"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-border">
                  <button type="button" onClick={() => setIsImportModalOpen(false)} className="px-4 py-2 border border-border rounded font-semibold text-text-main hover:bg-background">Cancel</button>
                  <button type="submit" disabled={importing} className="px-4 py-2 bg-navy text-white rounded font-bold hover:bg-navy/90 flex items-center gap-2">
                    {importing ? "Importing..." : "Upload & Transfer Data"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Add / Edit Client Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-surface rounded-lg border border-border w-full max-w-2xl p-6 space-y-4 shadow-lg">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-semibold text-lg text-text-main">{editingClient ? "Edit Client" : "Add Client"}</h3>
              <button onClick={closeModal} className="text-text-muted hover:text-text-main"><X className="h-5 w-5" /></button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">CLIENT NAME *</label>
                  <input
                    required
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full border border-border rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">ORGANIZATION NAME</label>
                  <input
                    type="text"
                    placeholder="e.g. Moonvita Foods Pvt Ltd"
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    className="w-full border border-border rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">TYPE</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full border border-border rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy bg-surface"
                  >
                    <option>Individual</option>
                    <option>Proprietorship</option>
                    <option>Partnership</option>
                    <option>LLP</option>
                    <option>Private Limited</option>
                    <option>Public Limited</option>
                    <option>Trust/NGO</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">PAN</label>
                  <input
                    type="text"
                    placeholder="ABCDE1234F"
                    value={pan}
                    onChange={(e) => setPan(e.target.value)}
                    className="w-full border border-border rounded p-2 text-sm uppercase focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">GSTIN</label>
                  <input
                    type="text"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value)}
                    className="w-full border border-border rounded p-2 text-sm uppercase focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">EMAIL</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-border rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">Mobile</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full border border-border rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">STATE</label>
                  <input
                    type="text"
                    placeholder="e.g. Delhi"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="w-full border border-border rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">STATUS</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full border border-border rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy bg-surface"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-text-muted mb-1">ADDRESS</label>
                <textarea
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full border border-border rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"
                />
              </div>

              <div>
                <label className="block font-semibold text-text-muted mb-1">NOTES</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full border border-border rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy"
                />
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-border">
                {editingClient ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="px-3 py-1.5 bg-danger text-white rounded text-xs font-semibold flex items-center gap-1 hover:bg-danger/90"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                ) : <div />}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 border border-border rounded text-text-main hover:bg-background"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="px-4 py-2 bg-navy text-white rounded font-medium hover:bg-navy/90">
                    Save Client
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