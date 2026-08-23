"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Trash2, X, MessageSquare, CheckCircle, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Client } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";

export default function ClientDiscussionsPage() {
  const [discussions, setDiscussions] = useState<any[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [selectedClientFilter, setSelectedClientFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);

  // Form State
  const [clientId, setClientId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [staff, setStaff] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpDone, setFollowUpDone] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [{ data: discData, error: discError }, { data: cData }] = await Promise.all([
      supabase
        .from("discussions")
        .select("*, clients!client_id(name)")
        .order("date", { ascending: false }),
      supabase.from("clients").select("*").order("name", { ascending: true })
    ]);

    if (discError) {
      console.error("Fetch Discussions Error:", discError);
    } else if (discData) {
      setDiscussions(discData);
    }

    if (cData) setClients(cData);
    setLoading(false);
  }

  function openModal(item?: any) {
    if (item) {
      setEditingItem(item);
      setClientId(item.client_id || "");
      setDate(item.date || new Date().toISOString().slice(0, 10));
      setSummary(item.summary || "");
      setNotes(item.notes || "");
      setStaff(item.staff || "");
      setFollowUpDate(item.follow_up_date || "");
      setFollowUpDone(Boolean(item.follow_up_done));
    } else {
      setEditingItem(null);
      resetForm();
    }
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingItem(null);
    resetForm();
  }

  function resetForm() {
    setClientId("");
    setDate(new Date().toISOString().slice(0, 10));
    setSummary("");
    setNotes("");
    setStaff("");
    setFollowUpDate("");
    setFollowUpDone(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return alert("Please select a client.");
    if (!summary.trim()) return alert("Summary is required.");

    const payload = {
      client_id: clientId,
      date,
      summary: summary.trim(),
      notes: notes.trim(),
      staff: staff.trim(),
      follow_up_date: followUpDate || null,
      follow_up_done: followUpDone,
    };

    if (editingItem) {
      const { error } = await supabase.from("discussions").update(payload).eq("id", editingItem.id);
      if (!error) {
        logAuditEvent("UPDATE_DISCUSSION", "DISCUSSIONS", editingItem.id);
        closeModal();
        loadData();
      } else alert("Error updating entry: " + error.message);
    } else {
      const { data, error } = await supabase.from("discussions").insert([payload]).select().single();
      if (!error) {
        logAuditEvent("CREATE_DISCUSSION", "DISCUSSIONS", data.id);
        closeModal();
        loadData();
      } else alert("Error logging discussion: " + error.message);
    }
  }

  async function handleDelete() {
    if (!editingItem || !confirm("Delete this discussion entry?")) return;
    const { error } = await supabase.from("discussions").delete().eq("id", editingItem.id);
    if (!error) {
      logAuditEvent("DELETE_DISCUSSION", "DISCUSSIONS", editingItem.id);
      closeModal();
      loadData();
    } else alert("Error deleting entry: " + error.message);
  }

  const filteredDiscussions = discussions.filter((d: any) => {
    const matchesSearch = [d.summary, d.notes, d.staff, d.clients?.name]
      .filter(Boolean)
      .some((f) => f.toLowerCase().includes(search.toLowerCase()));
    const matchesClient = selectedClientFilter ? d.client_id === selectedClientFilter : true;
    return matchesSearch && matchesClient;
  });

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-surface p-4 rounded-lg border border-border shadow-sm">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-60">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search discussions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-border rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </div>

          <select
            value={selectedClientFilter}
            onChange={(e) => setSelectedClientFilter(e.target.value)}
            className="border border-border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy bg-surface max-w-[200px]"
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => openModal()}
          className="flex items-center gap-2 bg-navy text-white px-4 py-2 rounded-md font-medium text-xs hover:bg-navy/90 transition"
        >
          <Plus className="h-4 w-4" /> Log Discussion
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted text-xs">Loading client records...</div>
        ) : filteredDiscussions.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs">No discussions logged yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Summary</th>
                  <th>Handled By</th>
                  <th>Follow-up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredDiscussions.map((d: any) => (
                  <tr
                    key={d.id}
                    className="hover:bg-background/50 transition cursor-pointer"
                    onClick={() => openModal(d)}
                  >
                    <td className="font-medium whitespace-nowrap text-text-main">{d.date}</td>
                    <td className="font-semibold text-navy flex items-center gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5 text-navy shrink-0" />
                      {d.clients?.name || "-"}
                    </td>
                    <td className="max-w-xs truncate">{d.summary}</td>
                    <td>{d.staff || "-"}</td>
                    <td>
                      {d.follow_up_date ? (
                        d.follow_up_done ? (
                          <span className="inline-flex items-center gap-1 bg-success/10 text-success px-2 py-0.5 rounded text-[10px] font-medium">
                            <CheckCircle className="h-3 w-3" /> Done
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-accent/10 text-accent px-2 py-0.5 rounded text-[10px] font-medium">
                            <Clock className="h-3 w-3" /> {d.follow_up_date}
                          </span>
                        )
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Form Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-surface rounded-lg border border-border w-full max-w-lg p-6 space-y-4 shadow-lg text-xs">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-semibold text-base text-text-main">
                {editingItem ? "Edit Discussion" : "Log Discussion"}
              </h3>
              <button onClick={closeModal} className="text-text-muted hover:text-text-main">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">CLIENT *</label>
                  <select
                    required
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs bg-surface"
                  >
                    <option value="">-- Select Client --</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">DATE *</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-text-muted mb-1">SUMMARY *</label>
                <input
                  type="text"
                  required
                  placeholder="What was discussed, in one line"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  className="w-full border border-border rounded p-2 text-xs"
                />
              </div>

              <div>
                <label className="block font-semibold text-text-muted mb-1">NOTES / DETAILS</label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full border border-border rounded p-2 text-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">HANDLED BY</label>
                  <input
                    type="text"
                    placeholder="Staff name"
                    value={staff}
                    onChange={(e) => setStaff(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">FOLLOW-UP DATE</label>
                  <input
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="f_followupDone"
                  checked={followUpDone}
                  onChange={(e) => setFollowUpDone(e.target.checked)}
                  className="rounded border-border text-navy focus:ring-navy"
                />
                <label htmlFor="f_followupDone" className="font-medium text-text-main">
                  Follow-up completed
                </label>
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-border">
                {editingItem ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="px-3 py-1.5 bg-danger text-white rounded font-semibold flex items-center gap-1 hover:bg-danger/90"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-1.5 border border-border rounded text-text-main hover:bg-background"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-navy text-white rounded font-medium hover:bg-navy/90"
                  >
                    Save
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