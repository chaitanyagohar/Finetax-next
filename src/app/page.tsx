"use client";

import { useState, useEffect } from "react";
import {
  CheckSquare,
  Clock,
  AlertCircle,
  FileText,
  CheckCircle2,
  Users,
  IndianRupee,
  Receipt,
  ArrowRight,
  Plus,
  ShieldCheck,
  Calendar,
  X,
  MessageSquare
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function DashboardPage() {
  const [profile, setProfile] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & State
  const [dateFilter, setDateFilter] = useState("all"); // 'month', 'quarter', 'fy', 'all'
  const [selectedOverdueTask, setSelectedOverdueTask] = useState<any | null>(null);
  const [isOverdueDrawerOpen, setIsOverdueDrawerOpen] = useState(false);

  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    loadDashboardData();

    // Real-time Supabase Data Subscriptions
    const taskSub = supabase.channel("realtime-tasks").on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadDashboardData()).subscribe();
    const invSub = supabase.channel("realtime-invoices").on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, () => loadDashboardData()).subscribe();

    return () => {
      supabase.removeChannel(taskSub);
      supabase.removeChannel(invSub);
    };
  }, []);

  async function loadDashboardData() {
    setLoading(true);

    // 1. Fetch current user profile with secure fallback
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: userProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    const currentProfile = userProfile || { name: "User", role: "staff", id: user.id };
    setProfile(currentProfile);

    // 2. Fetch Tasks (Staff sees assigned tasks, Admin/Reviewer sees broad scope)
    let taskQuery = supabase
      .from("tasks")
      .select("*, clients(name), profiles!tasks_assigned_to_fkey(name)");

    if (currentProfile.role === "staff") {
      taskQuery = taskQuery.eq("assigned_to", currentProfile.id);
    }

    const { data: taskData } = await taskQuery.order("due_date", { ascending: true });
    if (taskData) setTasks(taskData);

    // 3. Admin Eagle's Eye Data Stream
    if (currentProfile.role === "admin") {
      const [{ data: cData }, { data: iData }, { data: qData }, { data: pData }] = await Promise.all([
        supabase.from("clients").select("*"),
        supabase.from("invoices").select("*, clients(name)"),
        supabase.from("quotations").select("*"),
        supabase.from("profiles").select("*")
      ]);

      if (cData) setClients(cData);
      if (iData) setInvoices(iData);
      if (qData) setQuotations(qData);
      if (pData) setTeam(pData);
    }

    setLoading(false);
  }

  // Filter Financials by Date Range
  function filterByDate(items: any[], dateField: string) {
    if (dateFilter === "all") return items;
    const now = new Date();
    return items.filter((item) => {
      if (!item[dateField]) return false;
      const d = new Date(item[dateField]);
      if (dateFilter === "month") {
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }
      if (dateFilter === "quarter") {
        const currentQuarter = Math.floor(now.getMonth() / 3);
        const itemQuarter = Math.floor(d.getMonth() / 3);
        return itemQuarter === currentQuarter && d.getFullYear() === now.getFullYear();
      }
      if (dateFilter === "fy") {
        // FY starts April 1st
        const fyStart = now.getMonth() >= 3 ? new Date(now.getFullYear(), 3, 1) : new Date(now.getFullYear() - 1, 3, 1);
        return d >= fyStart;
      }
      return true;
    });
  }

  if (loading) {
    return <div className="p-8 text-center text-text-muted text-xs font-medium">Loading Operations Console...</div>;
  }

  const isAdmin = profile?.role === "admin";

  // Calculations
  const filteredInvoices = filterByDate(invoices, "date");
  const pendingTasks = tasks.filter((t) => t.stage !== "Approved");
  const overdueTasks = pendingTasks.filter((t) => t.due_date < today);
  const completedTasks = tasks.filter((t) => t.stage === "Approved");

  const totalRevenue = filteredInvoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
  const unpaidInvoices = filteredInvoices.filter((inv) => inv.status !== "Paid");
  const totalUnpaid = unpaidInvoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0);

  // Workload Map per Staff (Admin view)
  const staffWorkload = team.map((member) => {
    const memberTasks = tasks.filter((t) => t.assigned_to === member.id && t.stage !== "Approved");
    const memberOverdue = memberTasks.filter((t) => t.due_date < today);
    return {
      name: member.name,
      role: member.role,
      activeCount: memberTasks.length,
      overdueCount: memberOverdue.length,
    };
  });

  return (
    <div className="space-y-6">
      {/* Top Header Controls */}
      <div className="bg-surface p-5 rounded-lg border border-border shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-text-main">Finetax Dashboard</h2>
            {isAdmin}
          </div>
          <p className="text-xs text-text-muted mt-1">
            {isAdmin
              ? "Full operational control, live real-time financial metrics, and workload capacity monitoring."
              : `Welcome back, ${profile?.name}. Here is your active work schedule.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <div className="flex items-center gap-1.5 bg-background p-1 border border-border rounded text-xs">
              <Calendar className="h-3.5 w-3.5 text-text-muted ml-1" />
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="bg-transparent font-medium focus:outline-none text-xs"
              >
                <option value="all">All Time</option>
                <option value="month">This Month</option>
                <option value="quarter">This Quarter</option>
                <option value="fy">FY 2026-27</option>
              </select>
            </div>
          )}

          {isAdmin ? (
            <>
              <Link href="/quotations" className="px-3 py-1.5 bg-surface border border-border text-text-main rounded text-xs font-semibold hover:bg-background transition flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Quote
              </Link>
              <Link href="/invoices" className="px-3 py-1.5 bg-surface border border-border text-text-main rounded text-xs font-semibold hover:bg-background transition flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Invoice
              </Link>
              <Link href="/tasks" className="px-3 py-1.5 bg-navy text-white rounded text-xs font-semibold hover:bg-navy/90 transition flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Assign Task
              </Link>
            </>
          ) : (
            <Link href="/tasks" className="px-3 py-1.5 bg-navy text-white rounded text-xs font-semibold hover:bg-navy/90 transition flex items-center gap-1">
              View Work Schedule
            </Link>
          )}
        </div>
      </div>

      {isAdmin ? (
        /* ADMIN EAGLE'S EYE VIEW */
        <>
          {/* Key Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-1">
              <div className="flex justify-between items-center text-text-muted">
                <span className="text-xs font-semibold uppercase">Revenue ({dateFilter})</span>
                <IndianRupee className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-navy">₹{totalRevenue.toLocaleString("en-IN")}</div>
              <p className="text-[10px] text-text-muted">{filteredInvoices.length} invoices generated</p>
            </div>

            <div className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-1">
              <div className="flex justify-between items-center text-text-muted">
                <span className="text-xs font-semibold uppercase">Unpaid Receivables</span>
                <Receipt className="h-4 w-4 text-amber-500" />
              </div>
              <div className="text-2xl font-bold text-amber-600">₹{totalUnpaid.toLocaleString("en-IN")}</div>
              <p className="text-[10px] text-amber-600/80 font-medium">{unpaidInvoices.length} invoices pending payment</p>
            </div>

            <div className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-1">
              <div className="flex justify-between items-center text-text-muted">
                <span className="text-xs font-semibold uppercase">Active Clients</span>
                <Users className="h-4 w-4 text-navy" />
              </div>
              <div className="text-2xl font-bold text-navy">{clients.length}</div>
              <p className="text-[10px] text-text-muted">{quotations.length} active quotes drafted</p>
            </div>

            <div
              onClick={() => setIsOverdueDrawerOpen(true)}
              className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-1 cursor-pointer hover:border-rose-300 transition"
            >
              <div className="flex justify-between items-center text-text-muted">
                <span className="text-xs font-semibold uppercase">Firm Overdue Work</span>
                <AlertCircle className="h-4 w-4 text-rose-500" />
              </div>
              <div className="text-2xl font-bold text-rose-600">{overdueTasks.length}</div>
              <p className="text-[10px] text-rose-500/80 font-bold underline">Click to inspect overdue files →</p>
            </div>
          </div>

          {/* Workload Capacity Monitor */}
          <div className="bg-surface rounded-lg border border-border shadow-sm p-4 space-y-3">
            <h3 className="font-bold text-sm text-text-main flex items-center gap-2 border-b border-border pb-2">
              <Users className="h-4 w-4 text-navy" /> Staff Workload & Capacity Distribution
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {staffWorkload.map((staff, idx) => (
                <div key={idx} className="p-3 bg-background rounded border border-border space-y-1 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-navy truncate">{staff.name}</span>
                    <span className="text-[10px] uppercase font-semibold text-text-muted">{staff.role}</span>
                  </div>
                  <div className="flex justify-between text-text-muted">
                    <span>Active Tasks:</span>
                    <span className="font-semibold text-text-main">{staff.activeCount}</span>
                  </div>
                  <div className="flex justify-between text-text-muted">
                    <span>Overdue:</span>
                    <span className={`font-bold ${staff.overdueCount > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {staff.overdueCount}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Workload Monitor & Invoice Quick Feed */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Finetax Tasks Stream */}
            <div className="lg:col-span-2 bg-surface rounded-lg border border-border shadow-sm p-4 space-y-4">
              <div className="flex justify-between items-center border-b border-border pb-3">
                <h3 className="font-bold text-sm text-text-main flex items-center gap-2">
                  <CheckSquare className="h-4 w-4 text-navy" /> Finetax-Wide Task Stream
                </h3>
                <Link href="/tasks" className="text-xs font-semibold text-navy hover:underline flex items-center gap-1">
                  Manage Tasks <ArrowRight className="h-3 w-3" />
                </Link>
              </div>

              {tasks.length === 0 ? (
                <div className="p-6 text-center text-text-muted text-xs">No active tasks in the firm workflow.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left text-text-muted">
                        <th className="pb-2">Due</th>
                        <th className="pb-2">Task</th>
                        <th className="pb-2">Client</th>
                        <th className="pb-2">Assigned To</th>
                        <th className="pb-2">Stage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {tasks.slice(0, 6).map((t) => {
                        const isOverdue = t.due_date < today && t.stage !== "Approved";
                        return (
                          <tr key={t.id} className="hover:bg-background/50 transition">
                            <td className="py-2.5 font-medium">
                              <span className={isOverdue ? "text-rose-600 font-bold flex items-center gap-1" : "text-text-main"}>
                                {isOverdue && <AlertCircle className="h-3 w-3" />} {t.due_date}
                              </span>
                            </td>
                            <td className="font-bold text-navy">{t.title}</td>
                            <td>{t.clients?.name || "Internal"}</td>
                            <td>{t.profiles?.name || <span className="text-rose-500 font-semibold">Unassigned</span>}</td>
                            <td>
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-navy/10 text-navy border border-navy/20">
                                {t.stage}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Invoices Feed */}
            <div className="bg-surface rounded-lg border border-border shadow-sm p-4 space-y-4">
              <div className="flex justify-between items-center border-b border-border pb-3">
                <h3 className="font-bold text-sm text-text-main flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-navy" /> Recent Invoices
                </h3>
                <Link href="/invoices" className="text-xs font-semibold text-navy hover:underline flex items-center gap-1">
                  View All <ArrowRight className="h-3 w-3" />
                </Link>
              </div>

              {filteredInvoices.length === 0 ? (
                <div className="p-6 text-center text-text-muted text-xs">No invoices found for this range.</div>
              ) : (
                <div className="space-y-3">
                  {filteredInvoices.slice(0, 5).map((inv) => (
                    <div key={inv.id} className="p-2.5 rounded border border-border bg-background flex items-center justify-between">
                      <div>
                        <p className="font-bold text-navy text-xs">{inv.invoice_number}</p>
                        <p className="text-[11px] text-text-muted truncate max-w-[130px]">{inv.clients?.name || inv.organisation || "Client"}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-text-main text-xs">₹{Number(inv.total || 0).toLocaleString("en-IN")}</p>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${inv.status === "Paid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {inv.status || "Unpaid"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        /* STAFF PERSONAL DASHBOARD VIEW */
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-1">
              <span className="text-xs font-semibold text-text-muted uppercase">My Pending Tasks</span>
              <div className="text-2xl font-bold text-navy">{pendingTasks.length}</div>
            </div>

            <div className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-1">
              <span className="text-xs font-semibold text-text-muted uppercase">Overdue Deadlines</span>
              <div className="text-2xl font-bold text-rose-600">{overdueTasks.length}</div>
            </div>

            <div className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-1">
              <span className="text-xs font-semibold text-text-muted uppercase">In Review</span>
              <div className="text-2xl font-bold text-blue-600">{tasks.filter((t) => t.stage === "Submitted for Review").length}</div>
            </div>

            <div className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-1">
              <span className="text-xs font-semibold text-text-muted uppercase">Completed</span>
              <div className="text-2xl font-bold text-emerald-600">{completedTasks.length}</div>
            </div>
          </div>

          <div className="bg-surface rounded-lg border border-border shadow-sm p-4 space-y-4">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-sm text-text-main flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-navy" /> My Assigned Tasks
              </h3>
              <Link href="/tasks" className="text-xs font-semibold text-navy hover:underline flex items-center gap-1">
                View Work Schedule <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {pendingTasks.length === 0 ? (
              <div className="p-6 text-center text-text-muted text-xs">You have no active pending tasks assigned!</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-text-muted">
                      <th className="pb-2">Due Date</th>
                      <th className="pb-2">Task</th>
                      <th className="pb-2">Category</th>
                      <th className="pb-2">Client</th>
                      <th className="pb-2">Stage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pendingTasks.map((t) => {
                      const isOverdue = t.due_date < today;
                      return (
                        <tr key={t.id} className="hover:bg-background/50 transition">
                          <td className="py-2.5 font-medium">
                            <span className={isOverdue ? "text-rose-600 font-bold flex items-center gap-1" : "text-text-main"}>
                              {isOverdue && <AlertCircle className="h-3 w-3" />} {t.due_date}
                            </span>
                          </td>
                          <td className="font-bold text-navy">{t.title}</td>
                          <td>{t.category}</td>
                          <td>{t.clients?.name || "Internal"}</td>
                          <td>
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-navy/10 text-navy border border-navy/20">
                              {t.stage}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Actionable Overdue Task Drawer */}
      {isOverdueDrawerOpen && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
          <div className="bg-surface w-full max-w-md h-full p-5 space-y-4 shadow-xl text-xs overflow-y-auto">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-sm text-rose-600 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> Firm Overdue Compliance Items ({overdueTasks.length})
              </h3>
              <button onClick={() => setIsOverdueDrawerOpen(false)} className="text-text-muted hover:text-text-main">
                <X className="h-5 w-5" />
              </button>
            </div>

            {overdueTasks.length === 0 ? (
              <p className="text-text-muted text-center py-8">Great job! No overdue items in the firm.</p>
            ) : (
              <div className="space-y-2">
                {overdueTasks.map((t) => (
                  <div key={t.id} className="p-3 border border-border rounded bg-background space-y-1">
                    <div className="flex justify-between items-start">
                      <span className="font-bold text-navy">{t.title}</span>
                      <span className="text-rose-600 font-bold">{t.due_date}</span>
                    </div>
                    <p className="text-text-muted text-[11px]">Client: {t.clients?.name || "Internal"}</p>
                    <p className="text-text-muted text-[11px]">Assigned Staff: {t.profiles?.name || "Unassigned"}</p>
                    <div className="pt-2 flex justify-end">
                      <Link href="/tasks" className="text-navy font-semibold underline text-[11px]">
                        Open Task Board →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}