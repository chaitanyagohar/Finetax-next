"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, CalendarOff, Check, Download, Gauge, Loader2, LogIn, LogOut, Plus, Trash2, UserCheck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Card, EmptyState, Meter, PageHeader, Pill, Stat, btn, field } from "@/components/ui/kit";
import { Modal } from "@/components/ui/Modal";
import FeatureGate, { LockedHint } from "@/components/plan/FeatureGate";
import { PersonAvatar } from "@/components/ui/Avatar";
import { hasFeature } from "@/lib/features";
import { downloadCsv } from "@/lib/csv";
import { formatDate, localISODate } from "@/lib/format";

type Tab = "me" | "team" | "capacity" | "approvals" | "holidays";
type Day = { day: string; first_seen: string | null; last_seen: string | null; active_minutes: number; declared_minutes: number; break_minutes: number; unaccounted_minutes: number; in_office: boolean; day_started_at: string | null; day_ended_at: string | null };
type Leave = { id: string; user_id: string; from_date: string; to_date: string; half_day: boolean; kind: string; reason: string | null; status: string; profiles?: { name: string | null } | null };
type Away = { id: string; user_id: string; day: string; started_at: string; minutes: number; kind: string; note: string | null; profiles?: { name: string | null } | null };
type Report = { user_id: string; name: string; branch: string | null; working_days: number; present_days: number; leave_days: number; absent_days: number; late_days: number; early_days: number; office_days: number; remote_days: number; active_hours: number; declared_hours: number; pending_hours: number; break_hours: number; unaccounted_hours: number };
type Capacity = { user_id: string; name: string; branch: string | null; available_minutes: number; assigned_minutes: number; open_tasks: number; overdue_tasks: number };

const KIND_LABEL: Record<string, string> = {
  task: "On the timer task",
  tally_excel: "Tally, Excel or another program",
  portal: "Government portal",
  call_meeting: "Call or meeting",
  other_work: "Other office work",
  break: "Break",
  unanswered: "Not answered",
};
const LEAVE_KINDS = [
  ["casual", "Casual"],
  ["sick", "Sick"],
  ["earned", "Earned"],
  ["unpaid", "Unpaid"],
  ["other", "Other"],
] as const;

const time = (v: string | null) => (v ? new Date(v).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—");
const hrs = (m: number) => {
  if (!m) return "—";
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
};
const shift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localISODate(d);
};

function AttendancePage() {
  const user = useCurrentUser();
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<Tab>("me");
  const [perm, setPerm] = useState({ view: false, approve: false, export: false });
  const [days, setDays] = useState<Day[] | null>(null);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [pendingAway, setPendingAway] = useState<Away[]>([]);
  const [holidays, setHolidays] = useState<{ id: string; day: string; name: string; branch_id: string | null }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [from, setFrom] = useState(shift(-30));
  const [to, setTo] = useState(localISODate());
  const [branch, setBranch] = useState("");
  const [report, setReport] = useState<Report[] | null>(null);
  const [capacity, setCapacity] = useState<Capacity[] | null>(null);
  const [horizon, setHorizon] = useState(7);
  const [applyOpen, setApplyOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ from_date: shift(1), to_date: shift(1), half_day: false, kind: "casual", reason: "" });
  const [holidayForm, setHolidayForm] = useState({ day: shift(1), name: "", branch_id: "" });
  const [rules, setRules] = useState({ away_quiet_minutes: 15, declared_approval_minutes: 120, late_grace_minutes: 15 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canReports = hasFeature(user, "attendance_reports");
  const today = localISODate();
  const todayRow = days?.find((d) => d.day === today);

  const loadMine = useCallback(async () => {
    if (!user) return;
    const [d, l] = await Promise.all([
      supabase.from("user_activity_days").select("*").eq("user_id", user.id).gte("day", shift(-30)).order("day", { ascending: false }),
      supabase.from("leave_requests").select("*, profiles:user_id(name)").order("from_date", { ascending: false }).limit(200),
    ]);
    setDays((d.data || []) as Day[]);
    setLeaves((l.data || []) as Leave[]);
  }, [supabase, user]);

  const loadApprovals = useCallback(async () => {
    const { data } = await supabase.from("away_periods").select("id, user_id, day, started_at, minutes, kind, note, profiles:user_id(name)").eq("status", "pending").order("started_at");
    setPendingAway(((data || []) as unknown as Away[]).filter((a) => a.user_id !== user?.id));
  }, [supabase, user]);

  useEffect(() => {
    if (!user) return;
    loadMine();
    Promise.all(["view_attendance", "approve_time", "export_data"].map((k) => supabase.rpc("has_permission", { p_permission: k }))).then(([v, a, e]) =>
      setPerm({ view: !!v.data, approve: !!a.data, export: !!e.data }),
    );
    supabase.from("holidays").select("id, day, name, branch_id").gte("day", shift(-60)).order("day").then(({ data }) => setHolidays(data || []));
    supabase
      .from("firm_settings")
      .select("away_quiet_minutes, declared_approval_minutes, late_grace_minutes")
      .maybeSingle()
      .then(({ data }) => data && setRules(data));
    supabase.from("branches").select("id, name").order("is_default", { ascending: false }).then(({ data }) => setBranches(data || []));
  }, [user, supabase, loadMine]);

  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("tab");
    if (want && ["me", "team", "capacity", "approvals", "holidays"].includes(want)) setTab(want as Tab);
  }, []);

  useEffect(() => {
    if (perm.approve) loadApprovals();
  }, [perm.approve, loadApprovals]);

  const loadReport = useCallback(async () => {
    setReport(null);
    const { data, error: err } = await supabase.rpc("attendance_report", { p_from: from, p_to: to, p_branch: branch || null });
    if (err) setError(err.message);
    setReport((data || []) as Report[]);
  }, [supabase, from, to, branch]);

  const loadCapacity = useCallback(async () => {
    setCapacity(null);
    const { data, error: err } = await supabase.rpc("capacity_report", { p_to: shift(horizon), p_branch: branch || null });
    if (err) setError(err.message);
    setCapacity((data || []) as Capacity[]);
  }, [supabase, horizon, branch]);

  useEffect(() => {
    setError("");
    if (tab === "team" && canReports) loadReport();
    if (tab === "capacity") loadCapacity();
  }, [tab, canReports, loadReport, loadCapacity]);

  async function markDay(action: "start" | "end") {
    setBusy(true);
    const { error: err } = await supabase.rpc("mark_my_day", { p_action: action });
    setBusy(false);
    if (err) return setNotice(err.message);
    setNotice(action === "start" ? "Day started." : "Day ended. See you tomorrow.");
    loadMine();
  }

  async function applyLeave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: err } = await supabase.from("leave_requests").insert({ ...leaveForm, to_date: leaveForm.half_day ? leaveForm.from_date : leaveForm.to_date, reason: leaveForm.reason.trim() || null });
    setBusy(false);
    if (err) return setError(err.message);
    setApplyOpen(false);
    setNotice("Leave request sent.");
    loadMine();
  }

  async function setLeaveStatus(id: string, status: "approved" | "rejected" | "cancelled") {
    const { error: err } = await supabase.from("leave_requests").update({ status }).eq("id", id);
    setNotice(err ? err.message : status === "cancelled" ? "Leave cancelled." : `Leave ${status}.`);
    loadMine();
  }

  async function decideAway(id: string, approve: boolean) {
    const { error: err } = await supabase.rpc("decide_away", { p_id: id, p_approve: approve });
    setNotice(err ? err.message : approve ? "Time approved." : "Time not approved; it shows as unaccounted.");
    loadApprovals();
  }

  async function addHoliday(e: React.FormEvent) {
    e.preventDefault();
    const { error: err } = await supabase.from("holidays").insert({ day: holidayForm.day, name: holidayForm.name.trim(), branch_id: holidayForm.branch_id || null });
    if (err) return setNotice(err.message.includes("duplicate") ? "There is already a holiday on that day." : err.message);
    setHolidayForm({ ...holidayForm, name: "" });
    const { data } = await supabase.from("holidays").select("id, day, name, branch_id").gte("day", shift(-60)).order("day");
    setHolidays(data || []);
  }

  async function saveRules(e: React.FormEvent) {
    e.preventDefault();
    const { error: err } = await supabase.from("firm_settings").update(rules).eq("org_id", user!.orgId);
    setNotice(err ? err.message : "Rules saved. They apply from each person's next page load.");
  }

  async function removeHoliday(id: string) {
    await supabase.from("holidays").delete().eq("id", id);
    setHolidays((h) => h.filter((x) => x.id !== id));
  }

  function exportReport() {
    if (!report) return;
    downloadCsv(
      `attendance-${from}-to-${to}.csv`,
      ["Name", "Branch", "Working days", "Present", "Leave", "Absent", "Late", "Left early", "In office", "Remote", "Active hours", "Declared hours", "Awaiting approval", "Break hours", "Unaccounted hours"],
      report.map((r) => [r.name, r.branch, r.working_days, r.present_days, r.leave_days, r.absent_days, r.late_days, r.early_days, r.office_days, r.remote_days, r.active_hours, r.declared_hours, r.pending_hours, r.break_hours, r.unaccounted_hours]),
    );
  }

  if (!user) return null;
  const pendingLeaves = leaves.filter((l) => l.status === "pending" && l.user_id !== user.id);
  const myLeaves = leaves.filter((l) => l.user_id === user.id);
  const tabs: [Tab, string, boolean][] = [
    ["me", "My attendance", true],
    ["team", "Team report", perm.view || perm.approve],
    ["capacity", "Workload", perm.view || user.isAdmin],
    ["approvals", `Approvals${pendingAway.length + pendingLeaves.length ? ` (${pendingAway.length + pendingLeaves.length})` : ""}`, perm.approve],
    ["holidays", user.isAdmin ? "Holidays and rules" : "Holidays", true],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarCheck}
        title="Attendance"
        subtitle="Days, time away from the screen, leave and workload. Worked out from activity in Duesk; nothing on anyone's screen is recorded."
        actions={
          <div className="flex gap-2">
            {!todayRow?.day_started_at || todayRow.day_ended_at ? (
              <button type="button" disabled={busy} onClick={() => markDay("start")} className={btn.secondary}>
                <LogIn className="h-3.5 w-3.5" /> Start my day
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => markDay("end")} className={btn.secondary}>
                <LogOut className="h-3.5 w-3.5" /> End my day
              </button>
            )}
            <button type="button" onClick={() => setApplyOpen(true)} className={btn.primary}>
              <CalendarOff className="h-3.5 w-3.5" /> Apply for leave
            </button>
          </div>
        }
      >
        <div className="inline-flex flex-wrap rounded-lg border border-border bg-surface-alt p-1 text-xs font-semibold">
          {tabs
            .filter(([, , show]) => show)
            .map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 ${tab === k ? "bg-surface text-text-main shadow-sm" : "text-text-muted"}`}>
                {label}
              </button>
            ))}
        </div>
      </PageHeader>

      {notice && <p className="rounded-lg bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-700">{notice}</p>}
      {error && <p className="rounded-lg bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-700">{error}</p>}

      <div key={tab} className="animate-content-in space-y-6">
        {tab === "me" && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Today, active" value={hrs(todayRow?.active_minutes || 0)} hint={todayRow ? `Since ${time(todayRow.day_started_at || todayRow.first_seen)}` : "Not started"} icon={UserCheck} />
              <Stat label="Today, away for work" value={hrs(todayRow?.declared_minutes || 0)} tone="accent" />
              <Stat label="Today, breaks" value={hrs(todayRow?.break_minutes || 0)} />
              <Stat label="Today, where" value={todayRow ? (todayRow.in_office ? "In office" : "Remote") : "—"} tone={todayRow?.in_office ? "good" : "default"} />
            </div>
            <Card title="Last 30 days" bodyClassName="p-0">
              {days === null ? (
                <div className="skeleton m-4 h-24" />
              ) : days.length === 0 ? (
                <EmptyState title="No days yet" hint="Your days appear here as you work in Duesk." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-alt text-left text-[11px] uppercase tracking-wide text-text-muted">
                      <tr>
                        {["Day", "First seen", "Last seen", "Active", "Away for work", "Breaks", "Unaccounted", "Where"].map((h) => (
                          <th key={h} className="px-4 py-2 font-semibold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {days.map((d) => (
                        <tr key={d.day}>
                          <td className="px-4 py-2 font-medium text-text-main">{formatDate(d.day)}</td>
                          <td className="px-4 py-2">{time(d.day_started_at || d.first_seen)}</td>
                          <td className="px-4 py-2">{time(d.day_ended_at || d.last_seen)}</td>
                          <td className="px-4 py-2">{hrs(d.active_minutes)}</td>
                          <td className="px-4 py-2">{hrs(d.declared_minutes)}</td>
                          <td className="px-4 py-2">{hrs(d.break_minutes)}</td>
                          <td className="px-4 py-2">{d.unaccounted_minutes ? <Pill tone="warn">{hrs(d.unaccounted_minutes)}</Pill> : "—"}</td>
                          <td className="px-4 py-2">{d.in_office ? <Pill tone="good">Office</Pill> : <Pill>Remote</Pill>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card title="My leave" bodyClassName="p-0">
              {myLeaves.length === 0 ? (
                <EmptyState title="No leave requests" />
              ) : (
                <ul className="divide-y divide-border text-xs">
                  {myLeaves.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span>
                        <span className="font-semibold text-text-main">
                          {formatDate(l.from_date)}
                          {l.to_date !== l.from_date && ` to ${formatDate(l.to_date)}`}
                          {l.half_day && " (half day)"}
                        </span>{" "}
                        <span className="text-text-muted">· {LEAVE_KINDS.find((k) => k[0] === l.kind)?.[1]} {l.reason && `· ${l.reason}`}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Pill tone={l.status === "approved" ? "good" : l.status === "rejected" ? "bad" : l.status === "pending" ? "warn" : "default"}>{l.status}</Pill>
                        {(l.status === "pending" || (l.status === "approved" && l.from_date > today)) && (
                          <button type="button" onClick={() => setLeaveStatus(l.id, "cancelled")} className={btn.ghost}>
                            Cancel
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}

        {tab === "team" &&
          (!canReports ? (
            <Card>
              <EmptyState title="Attendance reports are part of the Firm plan" hint="Each person still sees their own days here." action={<LockedHint feature="attendance_reports" />} />
            </Card>
          ) : (
            <Card
              title="Team attendance"
              action={
                (perm.export || user.isAdmin) && report?.length ? (
                  <button type="button" onClick={exportReport} className={btn.ghost}>
                    <Download className="h-3.5 w-3.5" /> CSV
                  </button>
                ) : null
              }
              bodyClassName="p-0"
            >
              <div className="flex flex-wrap items-end gap-3 border-b border-border p-4 text-xs">
                <div>
                  <label className={field.label}>From</label>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field.input} />
                </div>
                <div>
                  <label className={field.label}>To</label>
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field.input} />
                </div>
                {branches.length > 1 && (
                  <div>
                    <label className={field.label}>Branch</label>
                    <select value={branch} onChange={(e) => setBranch(e.target.value)} className={field.input}>
                      <option value="">All</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              {report === null ? (
                <div className="skeleton m-4 h-24" />
              ) : report.length === 0 ? (
                <EmptyState title="Nobody to show" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-alt text-left text-[11px] uppercase tracking-wide text-text-muted">
                      <tr>
                        {["Person", "Present", "Leave", "Absent", "Late", "Left early", "Office / remote", "Active", "Away for work", "Unaccounted"].map((h) => (
                          <th key={h} className="px-3 py-2 font-semibold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.map((r) => {
                        const share = r.active_hours + r.declared_hours > 0 ? r.declared_hours / (r.active_hours + r.declared_hours) : 0;
                        return (
                          <tr key={r.user_id}>
                            <td className="px-3 py-2">
                              <span className="flex items-center gap-2">
                                <PersonAvatar id={r.user_id} name={r.name} size="sm" />
                                <span>
                                  <span className="block font-semibold text-text-main">{r.name}</span>
                                  {r.branch && <span className="text-[10px] text-text-muted">{r.branch}</span>}
                                </span>
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              {r.present_days} of {r.working_days}
                            </td>
                            <td className="px-3 py-2">{r.leave_days || "—"}</td>
                            <td className="px-3 py-2">{r.absent_days ? <Pill tone="bad">{r.absent_days}</Pill> : "—"}</td>
                            <td className="px-3 py-2">{r.late_days ? <Pill tone="warn">{r.late_days}</Pill> : "—"}</td>
                            <td className="px-3 py-2">{r.early_days || "—"}</td>
                            <td className="px-3 py-2">
                              {r.office_days} / {r.remote_days}
                            </td>
                            <td className="px-3 py-2">{r.active_hours}h</td>
                            <td className="px-3 py-2">
                              {r.declared_hours}h {share > 0.4 && <Pill tone="warn">{Math.round(share * 100)}% of time</Pill>}
                              {r.pending_hours > 0 && <span className="block text-[10px] text-amber-700">{r.pending_hours}h waiting</span>}
                            </td>
                            <td className="px-3 py-2">{r.unaccounted_hours ? <Pill tone="bad">{r.unaccounted_hours}h</Pill> : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="border-t border-border px-4 py-2 text-[11px] text-text-muted">
                Active is time using Duesk. Away for work is time people said they were in Tally, on a portal or on a call. A high share of away time is worth a look next to the work they finished.
              </p>
            </Card>
          ))}

        {tab === "capacity" && (
          <Card
            title="Workload against time available"
            icon={Gauge}
            action={
              <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="rounded-md border border-border bg-surface px-2 py-1 text-xs">
                <option value={7}>Next 7 days</option>
                <option value={14}>Next 14 days</option>
                <option value={30}>Next 30 days</option>
              </select>
            }
          >
            {capacity === null ? (
              <div className="skeleton h-24" />
            ) : capacity.length === 0 ? (
              <EmptyState title="Nobody to show" />
            ) : (
              <ul className="space-y-3 text-xs">
                {capacity.map((c) => {
                  const load = c.available_minutes > 0 ? c.assigned_minutes / c.available_minutes : c.assigned_minutes > 0 ? 2 : 0;
                  return (
                    <li key={c.user_id} className="grid items-center gap-3 sm:grid-cols-[13rem_1fr_17rem]">
                      <span className="flex items-center gap-2">
                        <PersonAvatar id={c.user_id} name={c.name} size="sm" />
                        <span className="font-semibold text-text-main">{c.name}</span>
                      </span>
                      <Meter value={load} tone={load > 1 ? "bad" : load > 0.8 ? "warn" : "good"} />
                      <span className="text-text-muted">
                        <strong className={load > 1 ? "text-rose-600" : "text-text-main"}>{hrs(c.assigned_minutes)}</strong> of {hrs(c.available_minutes)} · {c.open_tasks} tasks
                        {c.overdue_tasks > 0 && <span className="text-rose-600"> · {c.overdue_tasks} overdue</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-4 text-[11px] text-text-muted">Uses each task&apos;s estimate less time already logged (an hour when there is no estimate), working hours of the branch, holidays and approved leave.</p>
          </Card>
        )}

        {tab === "approvals" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Time away above the daily limit" bodyClassName="p-0">
              {pendingAway.length === 0 ? (
                <EmptyState title="Nothing waiting" />
              ) : (
                <ul className="divide-y divide-border text-xs">
                  {pendingAway.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span>
                        <span className="block font-semibold text-text-main">
                          {a.profiles?.name || "Member"} · {hrs(a.minutes)}
                        </span>
                        <span className="text-text-muted">
                          {formatDate(a.day)} from {time(a.started_at)} · {KIND_LABEL[a.kind]} {a.note && `· ${a.note}`}
                        </span>
                      </span>
                      <span className="flex gap-1">
                        <button type="button" onClick={() => decideAway(a.id, true)} className={btn.ghost} aria-label="Approve">
                          <Check className="h-4 w-4 text-emerald-600" />
                        </button>
                        <button type="button" onClick={() => decideAway(a.id, false)} className={btn.ghost} aria-label="Do not approve">
                          <X className="h-4 w-4 text-rose-600" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Leave requests" bodyClassName="p-0">
              {pendingLeaves.length === 0 ? (
                <EmptyState title="Nothing waiting" />
              ) : (
                <ul className="divide-y divide-border text-xs">
                  {pendingLeaves.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span>
                        <span className="block font-semibold text-text-main">{l.profiles?.name || "Member"}</span>
                        <span className="text-text-muted">
                          {formatDate(l.from_date)}
                          {l.to_date !== l.from_date && ` to ${formatDate(l.to_date)}`}
                          {l.half_day && " (half day)"} · {LEAVE_KINDS.find((k) => k[0] === l.kind)?.[1]} {l.reason && `· ${l.reason}`}
                        </span>
                      </span>
                      <span className="flex gap-1">
                        <button type="button" onClick={() => setLeaveStatus(l.id, "approved")} className={btn.ghost} aria-label="Approve">
                          <Check className="h-4 w-4 text-emerald-600" />
                        </button>
                        <button type="button" onClick={() => setLeaveStatus(l.id, "rejected")} className={btn.ghost} aria-label="Reject">
                          <X className="h-4 w-4 text-rose-600" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}

        {tab === "holidays" && user.isAdmin && (
          <Card title="Rules">
            <form onSubmit={saveRules} className="grid gap-4 text-xs sm:grid-cols-4">
              {(
                [
                  ["away_quiet_minutes", "Ask \"where were you?\" after", 5, 120],
                  ["declared_approval_minutes", "Away for work a day before approval is needed", 0, 600],
                  ["late_grace_minutes", "Late after start of hours by more than", 0, 120],
                ] as const
              ).map(([k, label, min, max]) => (
                <div key={k}>
                  <label className={field.label}>{label}</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min={min} max={max} value={rules[k]} onChange={(e) => setRules({ ...rules, [k]: Number(e.target.value) })} className={field.input} />
                    <span className="text-text-muted">min</span>
                  </div>
                </div>
              ))}
              <div className="flex items-end">
                <button type="submit" className={btn.primary}>
                  Save rules
                </button>
              </div>
            </form>
            <p className="mt-3 text-[11px] text-text-muted">Working hours are set per branch on Branches and roles. Set the approval limit to 0 to approve all away time automatically.</p>
          </Card>
        )}

        {tab === "holidays" && (
          <Card title="Holidays" bodyClassName="p-0">
            {user.isAdmin && (
              <form onSubmit={addHoliday} className="flex flex-wrap items-end gap-3 border-b border-border p-4 text-xs">
                <div>
                  <label className={field.label}>Day</label>
                  <input type="date" required value={holidayForm.day} onChange={(e) => setHolidayForm({ ...holidayForm, day: e.target.value })} className={field.input} />
                </div>
                <div className="min-w-48 flex-1">
                  <label className={field.label}>Name</label>
                  <input required maxLength={80} value={holidayForm.name} onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })} placeholder="Diwali" className={field.input} />
                </div>
                {branches.length > 1 && (
                  <div>
                    <label className={field.label}>Applies to</label>
                    <select value={holidayForm.branch_id} onChange={(e) => setHolidayForm({ ...holidayForm, branch_id: e.target.value })} className={field.input}>
                      <option value="">Every branch</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <button type="submit" className={btn.primary}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </form>
            )}
            {holidays.length === 0 ? (
              <EmptyState title="No holidays added" hint="Holidays are left out when counting working days and absences." />
            ) : (
              <ul className="divide-y divide-border text-xs">
                {holidays.map((h) => (
                  <li key={h.id} className="flex items-center justify-between px-4 py-2.5">
                    <span>
                      <span className="font-semibold text-text-main">{formatDate(h.day)}</span> · {h.name}{" "}
                      {h.branch_id && <Pill>{branches.find((b) => b.id === h.branch_id)?.name}</Pill>}
                    </span>
                    {user.isAdmin && (
                      <button type="button" onClick={() => removeHoliday(h.id)} className={btn.ghost} aria-label={`Remove ${h.name}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {applyOpen && (
        <Modal title="Apply for leave" onClose={() => setApplyOpen(false)} maxWidth="max-w-md">
          <form onSubmit={applyLeave} className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={field.label}>From</label>
                <input type="date" required min={today} value={leaveForm.from_date} onChange={(e) => setLeaveForm({ ...leaveForm, from_date: e.target.value, to_date: e.target.value > leaveForm.to_date ? e.target.value : leaveForm.to_date })} className={field.input} />
              </div>
              <div>
                <label className={field.label}>To</label>
                <input type="date" required disabled={leaveForm.half_day} min={leaveForm.from_date} value={leaveForm.half_day ? leaveForm.from_date : leaveForm.to_date} onChange={(e) => setLeaveForm({ ...leaveForm, to_date: e.target.value })} className={field.input} />
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={leaveForm.half_day} onChange={(e) => setLeaveForm({ ...leaveForm, half_day: e.target.checked })} className="h-3.5 w-3.5 accent-[var(--color-accent)]" /> Half day
            </label>
            <div>
              <label className={field.label}>Type</label>
              <select value={leaveForm.kind} onChange={(e) => setLeaveForm({ ...leaveForm, kind: e.target.value })} className={field.input}>
                {LEAVE_KINDS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={field.label}>Reason</label>
              <textarea rows={2} maxLength={500} value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} className={field.input} />
            </div>
            {error && <p className="font-medium text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setApplyOpen(false)} className={btn.secondary}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={btn.primary}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send request
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default function AttendanceWithPlan() {
  return (
    <FeatureGate feature="attendance">
      <AttendancePage />
    </FeatureGate>
  );
}
