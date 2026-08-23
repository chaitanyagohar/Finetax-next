"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Clock, Play, Square, Calendar, User, CheckCircle2, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";

export default function TimeTrackingPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterDate, setFilterDate] = useState("all");

  // Timer State
  const [timerActive, setTimerActive] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerDescription, setTimerDescription] = useState("");
  const [timerClientId, setTimerClientId] = useState("");
  const [timerTaskId, setTimerTaskId] = useState("");

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [hours, setHours] = useState("");
  const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10));
  const [isBillable, setIsBillable] = useState(true);

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, []);

  // Timer Effect
  useEffect(() => {
    let interval: any = null;
    if (timerActive) {
      interval = setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [timerActive]);

  async function loadData() {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", user?.id || "").single();
    setCurrentUser(profile || { role: "staff" });

    const [{ data: cData }, { data: tData }, { data: pData }] = await Promise.all([
      supabase.from("clients").select("*").order("name", { ascending: true }),
      supabase.from("tasks").select("*").order("title", { ascending: true }),
      supabase.from("profiles").select("*").order("name", { ascending: true })
    ]);

    if (cData) setClients(cData);
    if (tData) setTasks(tData);
    if (pData) setTeam(pData);

    let query = supabase.from("time_logs").select("*, profiles!time_logs_user_id_fkey(name), clients(name), tasks(title)");

    if (profile?.role === "staff") {
      query = query.eq("user_id", profile.id);
    }

    const { data: lData } = await query.order("log_date", { ascending: false });
    if (lData) setLogs(lData);

    setLoading(false);
  }
  function handleStartTimer() {
  if (!timerDescription.trim()) {
    alert("Please enter a description before starting the timer.");
    return;
  }

  if (!timerClientId) {
    alert("Please select a client before starting the timer.");
    return;
  }

  setTimerActive(true);
}


  // Handle Stop Timer & Save Log
  async function handleStopTimer() {
    if (!timerDescription.trim()) {
      alert("Please enter a description for this timer entry.");
      return;
    }

    setTimerActive(false);
    const loggedHours = Number((timerSeconds / 3600).toFixed(2)) || 0.1;

    const payload = {
      user_id: currentUser.id,
      client_id: timerClientId || null,
      task_id: timerTaskId || null,
      description: timerDescription.trim(),
      hours: loggedHours,
      log_date: new Date().toISOString().slice(0, 10),
      is_billable: true,
    };

    const { data, error } = await supabase.from("time_logs").insert([payload]).select().single();
    if (!error) {
      logAuditEvent("CREATE_TIME_LOG", "TIME_LOGS", data.id, payload);
      setTimerSeconds(0);
      setTimerDescription("");
      setTimerClientId("");
      setTimerTaskId("");
      loadData();
    } else {
      alert("Error saving log: " + error.message);
    }
  }

  // Handle Manual Log Submission
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload = {
      user_id: currentUser.id,
      client_id: clientId || null,
      task_id: taskId || null,
      description: description.trim(),
      hours: Number(hours),
      log_date: logDate,
      is_billable: isBillable,
    };

    const { data, error } = await supabase.from("time_logs").insert([payload]).select().single();
    if (!error) {
      logAuditEvent("CREATE_TIME_LOG", "TIME_LOGS", data.id, payload);
      setIsModalOpen(false);
      resetForm();
      loadData();
    } else {
      alert("Error logging time: " + error.message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this log entry?")) return;
    const { error } = await supabase.from("time_logs").delete().eq("id", id);
    if (!error) {
      logAuditEvent("DELETE_TIME_LOG", "TIME_LOGS", id);
      loadData();
    } else alert("Error deleting log: " + error.message);
  }

  function resetForm() {
    setDescription("");
    setClientId("");
    setTaskId("");
    setHours("");
    setLogDate(new Date().toISOString().slice(0, 10));
    setIsBillable(true);
  }

  function formatTimerDisplay(seconds: number) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  const isAdmin = currentUser?.role === "admin";

  // Calculations
  const filteredLogs = logs.filter((l) => {
    const matchesSearch = [l.description, l.profiles?.name, l.clients?.name, l.tasks?.title]
      .filter(Boolean)
      .some((f) => f.toLowerCase().includes(search.toLowerCase()));
    const matchesUser = filterUser ? l.user_id === filterUser : true;
    const matchesClient = filterClient ? l.client_id === filterClient : true;
    return matchesSearch && matchesUser && matchesClient;
  });

  const totalHours = filteredLogs.reduce((sum, l) => sum + Number(l.hours || 0), 0);
  const billableHours = filteredLogs.filter((l) => l.is_billable).reduce((sum, l) => sum + Number(l.hours || 0), 0);

  return (
    <div className="space-y-6">
      {/* Live Stopwatch Widget */}
      <div className="bg-surface p-4 rounded-lg border border-border shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="p-2.5 bg-navy/10 text-navy rounded-lg">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-text-main">Live Work Timer</h3>
            <p className="text-[11px] text-text-muted">Track billable time directly as you execute tasks.</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto">
          <input
            type="text"
            placeholder="What are you working on?"
            value={timerDescription}
            onChange={(e) => setTimerDescription(e.target.value)}
            disabled={timerActive}
            className="w-full sm:w-60 border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background"
          />

          <select
            value={timerClientId}
            onChange={(e) => setTimerClientId(e.target.value)}
            disabled={timerActive}
            className="w-full sm:w-40 border border-border rounded p-2 text-xs bg-surface disabled:bg-background"
          >
            <option value="">-- Client --</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="font-mono text-base font-bold text-navy px-3 py-1.5 bg-background border border-border rounded min-w-[90px] text-center">
            {formatTimerDisplay(timerSeconds)}
          </div>

          {!timerActive ? (
            <button
  onClick={handleStartTimer}
  className="w-full sm:w-auto px-4 py-2 bg-emerald-600 text-white rounded font-medium text-xs hover:bg-emerald-700 flex items-center justify-center gap-1.5"
>
  <Play className="h-3.5 w-3.5" /> Start
</button>
          ) : (
            <button
              onClick={handleStopTimer}
              className="w-full sm:w-auto px-4 py-2 bg-rose-600 text-white rounded font-medium text-xs hover:bg-rose-700 flex items-center justify-center gap-1.5"
            >
              <Square className="h-3.5 w-3.5" /> Stop & Save
            </button>
          )}
        </div>
      </div>

      {/* Admin Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-1">
          <span className="text-xs font-semibold text-text-muted uppercase">Total Hours Logged</span>
          <div className="text-2xl font-bold text-navy">{totalHours.toFixed(2)} hrs</div>
        </div>

        <div className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-1">
          <span className="text-xs font-semibold text-text-muted uppercase">Billable Hours</span>
          <div className="text-2xl font-bold text-emerald-600">{billableHours.toFixed(2)} hrs</div>
        </div>

        <div className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-1">
          <span className="text-xs font-semibold text-text-muted uppercase">Billable Ratio</span>
          <div className="text-2xl font-bold text-navy">
            {totalHours > 0 ? ((billableHours / totalHours) * 100).toFixed(0) : 0}%
          </div>
        </div>
      </div>

      {/* Toolbar & Filters */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 bg-surface p-4 rounded-lg border border-border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="relative w-full sm:w-48">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search logs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-border rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </div>

          {isAdmin && (
            <select
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="border border-border rounded-md p-2 text-xs bg-surface"
            >
              <option value="">All Team Members</option>
              {team.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}

          <select
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
            className="border border-border rounded-md p-2 text-xs bg-surface"
          >
            <option value="">All Clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-navy text-white px-4 py-2 rounded-md font-medium text-xs hover:bg-navy/90 transition w-full md:w-auto justify-center"
        >
          <Plus className="h-4 w-4" /> Manual Log Entry
        </button>
      </div>

      {/* Office Log Sheet Table */}
      <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted text-xs">Loading office log sheet...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs">No time logs recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-text-muted bg-background/50">
                  <th className="p-3">Date</th>
                  <th className="p-3">Staff Member</th>
                  <th className="p-3">Client</th>
                  <th className="p-3">Task / Description</th>
                  <th className="p-3">Hours</th>
                  <th className="p-3">Billable</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-background/50 transition">
                    <td className="p-3 font-medium whitespace-nowrap">{log.log_date}</td>
                    <td className="p-3 font-bold text-navy">{log.profiles?.name || "Staff"}</td>
                    <td className="p-3">{log.clients?.name || "-"}</td>
                    <td className="p-3 font-medium text-text-main">
                      {log.description}
                      {log.tasks?.title && <span className="block text-[10px] text-text-muted">Task: {log.tasks.title}</span>}
                    </td>
                    <td className="p-3 font-bold text-text-main">{Number(log.hours).toFixed(2)} hrs</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${log.is_billable ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                        {log.is_billable ? "Billable" : "Non-Billable"}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleDelete(log.id)}
                        className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                        title="Delete entry"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual Log Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md p-5 space-y-4 shadow-xl text-xs">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-semibold text-sm text-text-main">Manual Time Entry</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-text-muted hover:text-text-main">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block font-semibold text-text-muted mb-1">DESCRIPTION *</label>
                <textarea
                  required
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full border border-border rounded p-2 text-xs"
                  placeholder="Summarize work completed..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">CLIENT</label>
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs bg-surface"
                  >
                    <option value="">-- Optional --</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">TASK</label>
                  <select
                    value={taskId}
                    onChange={(e) => setTaskId(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs bg-surface"
                  >
                    <option value="">-- Optional --</option>
                    {tasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">HOURS SPENT *</label>
                  <input
                    type="number"
                    step="0.25"
                    required
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs"
                    placeholder="e.g. 1.5"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">LOG DATE</label>
                  <input
                    type="date"
                    required
                    value={logDate}
                    onChange={(e) => setLogDate(e.target.value)}
                    className="w-full border border-border rounded p-2 text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="billable"
                  checked={isBillable}
                  onChange={(e) => setIsBillable(e.target.checked)}
                />
                <label htmlFor="billable" className="font-semibold text-text-main cursor-pointer">
                  Mark as Billable Work
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-1.5 border border-border rounded hover:bg-background"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-1.5 bg-navy text-white rounded font-medium hover:bg-navy/90">
                  Save Log Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}