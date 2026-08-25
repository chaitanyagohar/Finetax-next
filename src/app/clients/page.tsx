"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Trash2, X, Building2, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Client } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";
import AsyncButton from "@/components/ui/AsyncButton";

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  // Form State matching legacy schema
  const [name, setName] = useState("");
  const [type, setType] = useState("Individual");
  const [pan, setPan] = useState("");
  const [gstin, setGstin] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState<"Active" | "Inactive">("Active");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

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

  function openModal(client?: Client) {
    if (client) {
      setEditingClient(client);
      setName(client.name || "");
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
    [c.name, (c as any).pan, (c as any).gstin, c.email, c.phone]
      .filter(Boolean)
      .some((f) => f.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Search Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface p-4 rounded-lg border border-border shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by name, PAN, GSTIN, email, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy"
          />
        </div>

        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 bg-navy text-white px-4 py-2 rounded-md font-medium text-sm hover:bg-navy/90 transition"
        >
          <Plus className="h-4 w-4" /> Add Client
        </button>
      </div>

      {/* Clients Data Table */}
      <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted text-sm">Loading client directory...</div>
        ) : filteredClients.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-sm">No clients found. Click "+ Add Client" to create one.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>PAN</th>
                  <th>GSTIN</th>
                  <th>Phone</th>
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
                  <label className="block font-semibold text-text-muted mb-1">PHONE</label>
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
                  <AsyncButton type="submit" className="px-4 py-2 bg-navy text-white rounded font-medium hover:bg-navy/90">
                    Save Client
                  </AsyncButton>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}