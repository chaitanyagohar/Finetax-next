"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Activity, Filter, RefreshCw, Server, Info, ShieldAlert, Download, Loader2, ChevronDown, ChevronRight, Lock, Trash2, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDate, getInitials, localISODate } from "@/lib/format";

const PAGE_SIZE = 100;

const SECURITY_ACTIONS = [
  "user_password_reset",
  "user_email_changed",
  "user_deleted",
  "user_created",
  "UPDATE_SETTINGS",
  "DELETE_EMAIL_ACCOUNT",
  "UPDATE_EMAIL_PASSWORD",
  "CONNECT_EMAIL_ACCOUNT",
  "EXPORT_CLIENTS",
  "CANCEL_INVOICE",
  "DELETE_PAYMENT",
  "DEACTIVATE_TEAM_MEMBER",
];

const COMMON_AREAS = ["TASKS", "LEADS", "LEAD_DISCUSSION", "CLIENTS", "QUOTATIONS", "INVOICES", "DISCUSSIONS", "TIME_LOGS", "PROFILES", "profiles", "SETTINGS", "EMAIL_ACCOUNTS", "email_messages", "COMPLIANCE_EVENTS"];

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localISODate(new Date(y, m - 1, d + days));
}
function startOfDayISO(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0).toISOString();
}
function endOfDayISO(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}
function summarise(metadata: any): string {
  if (!metadata || typeof metadata !== "object") return "—";
  const parts = Object.entries(metadata)
    .filter(([k]) => !["actor_name", "author_name"].includes(k))
    .slice(0, 4)
    .map(([k, v]) => {
      const value = v === null || v === undefined ? "—" : typeof v === "object" ? (Array.isArray(v) ? v.join(", ") : "{…}") : String(v);
      return `${k.replace(/_/g, " ")}: ${value.length > 60 ? value.slice(0, 60) + "…" : value}`;
    });
  return parts.length ? parts.join("  •  ") : "—";
}
function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export default function AuditLogsPage() {
  const [supabase] = useState(() => createClient());

  const [logs, setLogs] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Filters
  const today = localISODate();
  const [fromDate, setFromDate] = useState(addDays(today, -7));
  const [toDate, setToDate] = useState(today);
  const [filterEntity, setFilterEntity] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [securityOnly, setSecurityOnly] = useState(false);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, name")
      .order("name", { ascending: true })
      .then(({ data }) => setTeam(data || []));
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim().replace(/[,()%*\\]/g, "").replace(/\s+/g, "_").slice(0, 60)), 400);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    loadLogs(true);
  }, [fromDate, toDate, filterEntity, filterUser, debouncedSearch, securityOnly]);

  function buildQuery() {
    let q = supabase
      .from("audit_logs")
      .select("*")
      .gte("timestamp", startOfDayISO(fromDate))
      .lte("timestamp", endOfDayISO(toDate));
    if (filterEntity) q = q.eq("entity", filterEntity);
    if (filterUser) q = q.eq("user_id", filterUser);
    if (debouncedSearch) q = q.ilike("action", `%${debouncedSearch}%`);
    if (securityOnly) q = q.in("action", SECURITY_ACTIONS);
    return q;
  }

  async function loadLogs(reset: boolean) {
    if (reset) {
      setIsRefreshing(true);
    } else {
      setLoadingMore(true);
    }
    const offset = reset ? 0 : logs.length;
    const { data, error } = await buildQuery().order("timestamp", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
    if (error) console.error(error);
    const rows = data || [];
    setLogs(reset ? rows : [...logs, ...rows]);
    setHasMore(rows.length === PAGE_SIZE);
    setLoading(false);
    setIsRefreshing(false);
    setLoadingMore(false);
  }

  const teamName = (id?: string) => team.find((t) => t.id === id)?.name || "";
  const actorOf = (log: any) => log.metadata?.actor_name || log.metadata?.author_name || teamName(log.user_id) || "System";

  const areas = useMemo(() => Array.from(new Set([...COMMON_AREAS, ...logs.map((l) => l.entity)].filter(Boolean))).sort(), [logs]);

  const stats = useMemo(
    () => ({
      total: logs.length,
      deletes: logs.filter((l) => String(l.action).toUpperCase().includes("DELETE")).length,
      security: logs.filter((l) => SECURITY_ACTIONS.includes(l.action)).length,
      emails: logs.filter((l) => String(l.action).toUpperCase().includes("EMAIL")).length,
    }),
    [logs]
  );

  function exportCSV() {
    const headers = ["Date", "Time", "Actor", "Action", "Area", "Record ID", "Details"];
    const lines = logs.map((l) => {
      const d = new Date(l.timestamp);
      return [formatDate(localISODate(d)), d.toLocaleTimeString("en-IN"), actorOf(l), l.action, l.entity, l.entity_id || "", JSON.stringify(l.metadata || {})]
        .map(csvCell)
        .join(",");
    });
    const blob = new Blob(["\uFEFF" + [headers.map(csvCell).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `finetax_audit_log_${fromDate}_to_${toDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm lg:flex-row lg:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <Activity className="h-5 w-5 text-navy" /> System Audit Logs
          </h2>
          <p className="mt-1 flex items-center gap-1 text-xs text-text-muted">
            <Lock className="h-3 w-3" /> Tamper-proof record: entries cannot be edited or deleted, and times are set by the server.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={exportCSV}
            disabled={logs.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt disabled:opacity-50"
          >
            <Download className="h-4 w-4 text-navy" /> Export
          </button>
          <button
            type="button"
            onClick={() => loadLogs(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 text-navy ${isRefreshing ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          { label: "Entries Shown", value: stats.total, icon: Activity, style: "bg-navy/10 text-navy", valueClass: "text-navy", sub: hasMore ? "More available below" : "All entries in range" },
          { label: "Security Events", value: stats.security, icon: ShieldAlert, style: "bg-rose-50 text-rose-600", valueClass: "text-rose-600", sub: "Passwords, users, bank, mailboxes" },
          { label: "Deletions", value: stats.deletes, icon: Trash2, style: "bg-amber-50 text-amber-600", valueClass: "text-amber-700", sub: "Records removed" },
          { label: "Email Activity", value: stats.emails, icon: Mail, style: "bg-violet-50 text-violet-600", valueClass: "text-violet-700", sub: "Sent or changed" },
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

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm lg:flex-row lg:flex-wrap lg:items-center">
        <div className="flex items-center gap-2 text-xs">
          <input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 shadow-sm outline-none focus:border-navy" />
          <span className="text-text-muted">to</span>
          <input type="date" value={toDate} min={fromDate} max={today} onChange={(e) => setToDate(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 shadow-sm outline-none focus:border-navy" />
        </div>
        <div className="relative w-full lg:w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search action, e.g. delete"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-2 text-xs">
          <Filter className="h-3.5 w-3.5 text-text-muted" />
          <select value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)} className="bg-transparent focus:outline-none">
            <option value="">All areas</option>
            {areas.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
          <option value="">Everyone</option>
          {team.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs font-semibold text-rose-700">
          <input type="checkbox" checked={securityOnly} onChange={(e) => setSecurityOnly(e.target.checked)} className="accent-rose-600" />
          Security events only
        </label>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading audit trail...
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-alt">
              <Server className="h-6 w-6 text-text-muted" />
            </div>
            <h3 className="text-sm font-semibold text-text-main">No activity found</h3>
            <p className="mt-1 max-w-sm text-xs text-text-muted">Try widening the date range or clearing filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="w-8" />
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Area</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const dt = new Date(log.timestamp);
                  const action = String(log.action || "");
                  const upper = action.toUpperCase();
                  const isSecurity = SECURITY_ACTIONS.includes(action);
                  const isDelete = upper.includes("DELETE") || upper.includes("CANCEL");
                  const isCreate = upper.includes("CREATE") || upper.includes("CONNECT");
                  const isEmail = upper.includes("EMAIL");
                  const actor = actorOf(log);
                  const isOpen = expanded === log.id;
                  return (
                    <>
                      <tr
                        key={log.id}
                        onClick={() => setExpanded(isOpen ? null : log.id)}
                        className={`cursor-pointer transition hover:bg-surface-alt ${isSecurity ? "bg-rose-50/40" : ""}`}
                      >
                        <td className="text-text-muted">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                        <td className="whitespace-nowrap">
                          <p className="font-medium text-text-main">{formatDate(localISODate(dt))}</p>
                          <p className="text-[10px] text-text-muted">{dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
                        </td>
                        <td className="whitespace-nowrap">
                          <span className="flex items-center gap-2">
                            <span
                              className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${
                                actor === "System" ? "bg-surface-alt text-text-muted" : "bg-navy/10 text-navy"
                              }`}
                            >
                              {actor === "System" ? "SY" : getInitials(actor)}
                            </span>
                            <span className={actor === "System" ? "text-text-muted" : "font-medium text-text-main"}>{actor}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              isSecurity
                                ? "border-rose-300 bg-rose-100 text-rose-700"
                                : isDelete
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : isCreate
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : isEmail
                                ? "border-violet-200 bg-violet-50 text-violet-700"
                                : "border-border bg-surface-alt text-text-main"
                            }`}
                          >
                            {isSecurity && <ShieldAlert className="h-3 w-3" />}
                            {action.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="whitespace-nowrap text-text-muted">{log.entity}</td>
                        <td className="max-w-md">
                          <span className="flex items-center gap-1.5">
                            <Info className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                            <span className="truncate text-text-muted">{summarise(log.metadata)}</span>
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${log.id}-detail`} className="bg-surface-alt">
                          <td />
                          <td colSpan={5}>
                            <div className="space-y-2 py-1">
                              <p className="text-[11px] text-text-muted">
                                Record ID: <span className="font-mono">{log.entity_id || "—"}</span> · Log ID: <span className="font-mono">{log.id}</span>
                              </p>
                              <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-[11px] leading-relaxed text-text-main">
                                {JSON.stringify(log.metadata || {}, null, 2)}
                              </pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && !loading && (
          <div className="border-t border-border p-3 text-center">
            <button
              type="button"
              onClick={() => loadLogs(false)}
              disabled={loadingMore}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-navy transition hover:bg-surface-alt disabled:opacity-60"
            >
              {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Load older entries
            </button>
          </div>
        )}
      </div>
    </div>
  );
}