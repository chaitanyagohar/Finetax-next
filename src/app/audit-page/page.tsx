"use client";

import { useState, useEffect } from "react";
import { Search, Activity, Filter, RefreshCw, Server, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    loadLogs();
  }, []);

  async function loadLogs() {
    setIsRefreshing(true);
    // Fetch top 500 latest logs to keep performance high
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(500);

    if (data) setLogs(data);
    else console.error(error);
    
    setLoading(false);
    setIsRefreshing(false);
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
      .join("  •  ");
  }

  // Generate 1-2 letter initials for the user avatar
  function getInitials(name: string) {
    if (!name || name === "System API") return "SY";
    const parts = name.trim().split(" ");
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }
  
  const EMAIL_ACTIONS = ["SEND_QUOTATION_EMAIL", "SEND_INVOICE_EMAIL", "SEND_STAFF_ASSIGNMENT_EMAIL"];

  // Extract unique entities for the filter dropdown
  const uniqueEntities = Array.from(new Set(logs.map(log => log.entity)));

  const filteredLogs = logs.filter((log) => {
    const actor = (log.metadata?.actor_name || "System API").toLowerCase();
    const action = log.action.toLowerCase();
    const matchesSearch = actor.includes(search.toLowerCase()) || action.includes(search.toLowerCase());
    const matchesEntity = filterEntity ? log.entity === filterEntity : true;
    
    return matchesSearch && matchesEntity;
  });

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 animate-in fade-in duration-500">
      
      {/* Page Header */}
      <div className="flex flex-col gap-1 border-b border-slate-200 pb-5">
        <div className="flex items-center gap-2 text-slate-900 font-bold text-2xl tracking-tight">
          <Activity className="h-6 w-6 text-blue-600" />
          System Audit Logs
        </div>
        <p className="text-sm text-slate-500">
          Monitor system activity, secure actions, and outbound communications.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          
          {/* Search Input */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search users or actions..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" 
            />
          </div>

          {/* Entity Filter */}
          <div className="relative w-full sm:w-48">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <select 
              value={filterEntity} 
              onChange={(e) => setFilterEntity(e.target.value)} 
              className="w-full pl-9 pr-8 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-slate-50 focus:bg-white transition-all appearance-none cursor-pointer"
            >
              <option value="">All Areas</option>
              {uniqueEntities.map((entity) => (
                <option key={entity as string} value={entity as string}>{entity as string}</option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Refresh Button */}
        <button 
          onClick={loadLogs} 
          disabled={isRefreshing}
          className="flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-200 transition-all active:scale-[0.98] disabled:opacity-70"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin text-blue-600" : "text-slate-500"}`} />
          {isRefreshing ? "Syncing..." : "Refresh"}
        </button>
      </div>

      {/* Main Table Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          // Skeleton Loader State
          <div className="divide-y divide-slate-100">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4 p-5 animate-pulse">
                <div className="w-24 h-4 bg-slate-200 rounded-md"></div>
                <div className="h-9 w-9 rounded-full bg-slate-200 ml-4"></div>
                <div className="w-32 h-4 bg-slate-200 rounded-md"></div>
                <div className="w-24 h-6 bg-slate-200 rounded-full ml-auto"></div>
                <div className="w-48 h-4 bg-slate-200 rounded-md ml-auto"></div>
              </div>
            ))}
          </div>
        ) : filteredLogs.length === 0 ? (
          // Empty State
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <Server className="h-6 w-6 text-slate-400" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">No logs found</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-sm">
              We couldn't find any system activity matching your current filters or search query.
            </p>
          </div>
        ) : (
          // Data Table
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[11px] uppercase tracking-wider font-semibold">
                  <th className="px-6 py-4 rounded-tl-xl">Timestamp</th>
                  <th className="px-6 py-4">User / Actor</th>
                  <th className="px-6 py-4">Action</th>
                  <th className="px-6 py-4">Area</th>
                  <th className="px-6 py-4 rounded-tr-xl">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map((log: any) => {
                  const dt = new Date(log.timestamp);
                  const isDelete = log.action.includes("DELETE");
                  const isCreate = log.action.includes("CREATE");
                  const isEmail = EMAIL_ACTIONS.includes(log.action) || log.action.includes("EMAIL");
                  const actorName = log.metadata?.actor_name || "System API";
                  const isSystem = actorName === "System API";

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/80 transition-colors group">
                      
                      {/* Timestamp Stacked */}
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900">
                            {dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                          <span className="text-xs text-slate-500 mt-0.5">
                            {dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                      </td>

                      {/* User Avatar & Name */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold border ${
                            isSystem 
                              ? "bg-slate-100 text-slate-500 border-slate-200" 
                              : "bg-blue-50 text-blue-700 border-blue-100"
                          }`}>
                            {getInitials(actorName)}
                          </div>
                          <span className={`font-medium ${isSystem ? "text-slate-500" : "text-slate-900"}`}>
                            {actorName}
                          </span>
                        </div>
                      </td>

                      {/* Action Pill Badge */}
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                          isDelete ? 'bg-rose-50 text-rose-700 border-rose-200' : 
                          isCreate ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 
                          isEmail ? 'bg-purple-50 text-purple-700 border-purple-200' : 
                          'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                          {log.action.replace(/_/g, " ")}
                        </span>
                      </td>

                      {/* Area/Entity */}
                      <td className="px-6 py-4">
                        <span className="text-slate-600 font-medium">
                          {log.entity}
                        </span>
                      </td>

                      {/* Metadata Details */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 max-w-sm">
                          <Info className="h-4 w-4 text-slate-400 flex-shrink-0 group-hover:text-blue-500 transition-colors" />
                          <span 
                            className="text-slate-500 truncate text-xs cursor-help" 
                            title={formatMetadata(log.metadata)}
                          >
                            {formatMetadata(log.metadata)}
                          </span>
                        </div>
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