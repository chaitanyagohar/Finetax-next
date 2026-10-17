"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";

function hm(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}
function t(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
}

export default function AttendancePanel({ from, to, team }: { from: string; to: string; team: { id: string; name: string }[] }) {
  const [supabase] = useState(() => createClient());
  const [days, setDays] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [dRes, lRes] = await Promise.all([
        supabase.from("user_activity_days").select("*").gte("day", from).lte("day", to),
        supabase.from("time_logs").select("user_id, log_date, hours").gte("log_date", from).lte("log_date", to),
      ]);
      setDays(dRes.data || []);
      setLogs(lRes.data || []);
      setLoading(false);
    })();
  }, [from, to]);

  const nameOf = (id: string) => team.find((p) => p.id === id)?.name || "—";

  const rows = useMemo(() => {
    const map: Record<string, any> = {};
    days.forEach((d) => {
      map[`${d.user_id}|${d.day}`] = { user_id: d.user_id, day: d.day, first: d.first_seen, last: d.last_seen, active: d.active_minutes, confirmed: d.confirmed_at, logged: 0 };
    });
    logs.forEach((l) => {
      const key = `${l.user_id}|${l.log_date}`;
      if (!map[key]) map[key] = { user_id: l.user_id, day: l.log_date, first: null, last: null, active: 0, confirmed: null, logged: 0 };
      map[key].logged += Math.round(Number(l.hours) * 60);
    });
    return Object.values(map).sort((a: any, b: any) => String(b.day).localeCompare(String(a.day)) || nameOf(a.user_id).localeCompare(nameOf(b.user_id)));
  }, [days, logs, team]);

  return (
    <div className="rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-main">
          <UserCheck className="h-4 w-4 text-navy" /> Attendance & Activity
        </h3>
        <span className="text-[11px] text-text-muted">Activity inside the app only</span>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 p-6 text-xs text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading attendance...
        </div>
      ) : rows.length === 0 ? (
        <p className="p-6 text-center text-xs text-text-muted">No activity recorded in this period yet.</p>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th>Date</th>
                <th>Team Member</th>
                <th>First Seen</th>
                <th>Last Seen</th>
                <th className="text-right">Active</th>
                <th className="text-right">Logged</th>
                <th>Day Confirmed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={`${r.user_id}-${r.day}`}>
                  <td className="whitespace-nowrap">{formatDate(r.day)}</td>
                  <td className="whitespace-nowrap font-semibold text-navy">{nameOf(r.user_id)}</td>
                  <td>{t(r.first)}</td>
                  <td>{t(r.last)}</td>
                  <td className="text-right">{r.active ? hm(r.active) : "—"}</td>
                  <td className={`text-right font-semibold ${r.logged > r.active + 60 && r.active > 0 ? "text-amber-700" : "text-text-main"}`}>{r.logged ? hm(r.logged) : "—"}</td>
                  <td>
                    {r.confirmed ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {t(r.confirmed)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-text-muted">Not yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-border px-4 py-2 text-[10px] text-text-muted">
        "Logged" shown in amber is more than an hour above active time in the app. That's normal for calls and client visits, but worth a glance.
      </p>
    </div>
  );
}