"use client";

import { useState, useEffect } from "react";
import { Search, Activity, Clock, User, Filter } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterEntity, setFilterEntity] = useState("");

  const supabase = createClient();

  useEffect(() => {
    loadLogs();
  }, []);

  async function loadLogs() {
    setLoading(true);
    // Fetch top 500 latest logs to keep performance high
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(500);

    if (data) setLogs(data);
    else console.error(error);
    setLoading(false);
  }

  function formatMetadata(metadata: any) {
    if (!metadata || Object.keys(metadata).length === 0) return "-";
    
    // Create a clean readable string from the metadata JSON, ignoring the actor_name
    return Object.entries(metadata)
      .filter(([key]) => key !== "actor_name")
      .map(([key, value]) => {
        const readableKey = key.replace(/_/g, " ");
        return `${readableKey}: ${value}`;
      })
      .join(" | ");
  }
  const EMAIL_ACTIONS = ["SEND_QUOTATION_EMAIL", "SEND_INVOICE_EMAIL", "SEND_STAFF_ASSIGNMENT_EMAIL"];

  // Extract unique entities for the filter dropdown
  const uniqueEntities = Array.from(new Set(logs.map(log => log.entity)));

  const filteredLogs = logs.filter((log) => {
    const actor = (log.metadata?.actor_name || "System").toLowerCase();
    const action = log.action.toLowerCase();
    const matchesSearch = actor.includes(search.toLowerCase()) || action.includes(search.toLowerCase());
    const matchesEntity = filterEntity ? log.entity === filterEntity : true;
    
    return matchesSearch && matchesEntity;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-navy font-bold text-lg border-b border-border pb-4">
        <Activity className="h-6 w-6" /> System Audit Logs
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-surface p-4 rounded-lg border border-border shadow-sm">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-60">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <input 
              type="text" 
              placeholder="Search user or action..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
              className="w-full pl-9 pr-3 py-2 border border-border rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-navy" 
            />
          </div>

          <div className="relative">
            <Filter className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <select 
              value={filterEntity} 
              onChange={(e) => setFilterEntity(e.target.value)} 
              className="pl-9 pr-8 py-2 border border-border rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-navy bg-surface"
            >
              <option value="">All Areas</option>
              {uniqueEntities.map((entity) => (
                <option key={entity as string} value={entity as string}>{entity as string}</option>
              ))}
            </select>
          </div>
        </div>
        
        <button 
          onClick={loadLogs} 
          className="px-4 py-2 border border-border rounded text-xs hover:bg-background transition"
        >
          Refresh Logs
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted text-xs">Fetching system activity...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs">No logs found matching your criteria.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-border bg-background/50 text-text-muted uppercase tracking-wider">
                  <th className="p-4 font-semibold">Timestamp</th>
                  <th className="p-4 font-semibold">User</th>
                  <th className="p-4 font-semibold">Action</th>
                  <th className="p-4 font-semibold">Area</th>
                  <th className="p-4 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredLogs.map((log: any) => {
                  const dt = new Date(log.timestamp);
                  const isDelete = log.action.includes("DELETE");
                  const isCreate = log.action.includes("CREATE");

                  return (
                    <tr key={log.id} className="hover:bg-background/50 transition">
                      <td className="p-4 whitespace-nowrap text-text-muted flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5" />
                        {dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at {dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-4 font-semibold text-navy flex items-center gap-2">
                        <User className="h-3.5 w-3.5" />
                        {log.metadata?.actor_name || "System"}
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded font-semibold text-[10px] tracking-wide ${
                          isDelete ? 'bg-rose-100 text-rose-700' : 
                          isCreate ? 'bg-emerald-100 text-emerald-700' : 
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {log.action.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="p-4 font-semibold text-text-main">
                        {log.entity}
                      </td>
                      <td className="p-4 text-text-muted max-w-xs truncate" title={formatMetadata(log.metadata)}>
                        {formatMetadata(log.metadata)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}