"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Award,
  BarChart3,
  CheckCircle2,
  Clock,
  Gauge,
  Loader2,
  MessageSquarePlus,
  Settings2,
  Star,
  Target,
  Timer,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal } from "@/components/ui/Modal";
import { formatDate, getInitials, localISODate } from "@/lib/format";

type Card = Record<string, any>;
type Period = "month" | "lastMonth" | "quarter" | "fy" | "custom";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

function rangeFor(p: Period, today: string, cFrom: string, cTo: string): [string, string] {
  const [y, m] = today.split("-").map(Number);
  if (p === "month") return [localISODate(new Date(y, m - 1, 1)), today];
  if (p === "lastMonth") return [localISODate(new Date(y, m - 2, 1)), localISODate(new Date(y, m - 1, 0))];
  if (p === "quarter") {
    const fyQStart = [4, 7, 10, 1][Math.floor(((m - 4 + 12) % 12) / 3)];
    const qy = fyQStart === 1 && m < 4 ? y : fyQStart === 1 ? y + 1 : y;
    return [localISODate(new Date(fyQStart === 1 ? (m < 4 ? y : y) : y, fyQStart - 1, 1)), today];
  }
  if (p === "fy") return [`${m >= 4 ? y : y - 1}-04-01`, today];
  return [cFrom || today, cTo || today];
}
function hm(mins?: number | null): string {
  const v = Math.max(0, Math.round(Number(mins || 0)));
  const h = Math.floor(v / 60);
  const r = v % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}
function scoreTone(s?: number | null): { text: string; bg: string; ring: string; label: string } {
  if (s === null || s === undefined) return { text: "text-text-muted", bg: "bg-surface-alt", ring: "stroke-border", label: "Not enough data" };
  if (s >= 80) return { text: "text-emerald-700", bg: "bg-emerald-50", ring: "stroke-emerald-500", label: "Excellent" };
  if (s >= 65) return { text: "text-blue-700", bg: "bg-blue-50", ring: "stroke-blue-500", label: "Good" };
  if (s >= 50) return { text: "text-amber-700", bg: "bg-amber-50", ring: "stroke-amber-500", label: "Needs attention" };
  return { text: "text-rose-700", bg: "bg-rose-50", ring: "stroke-rose-500", label: "Needs support" };
}

function ScoreRing({ score, size = 64 }: { score?: number | null; size?: number }) {
  const tone = scoreTone(score);
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = score === null || score === undefined ? 0 : Math.max(0, Math.min(100, score));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={6} className="fill-none stroke-surface-alt" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={6} strokeLinecap="round" className={`fill-none ${tone.ring}`} strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center font-bold ${tone.text}`} style={{ fontSize: size / 4 }}>
        {score === null || score === undefined ? "—" : Math.round(score)}
      </span>
    </div>
  );
}

function Bar({ label, value, weight }: { label: string; value?: number | null; weight: number }) {
  const v = value === null || value === undefined ? null : Math.round(value);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-text-muted">
          {label} <span className="text-[10px]">({weight}%)</span>
        </span>
        <span className="font-semibold text-text-main">{v === null ? "n/a" : v}</span>
      </div>
      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
        <div className={`h-full rounded-full ${v === null ? "" : v >= 80 ? "bg-emerald-500" : v >= 50 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${v ?? 0}%` }} />
      </div>
    </div>
  );
}

export default function PerformancePage() {
  const currentUser = useCurrentUser();
  const me = currentUser?.id || "";
  const isAdmin = !!currentUser?.isAdmin;
  const [supabase] = useState(() => createClient());
  const today = localISODate();

  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState(today.slice(0, 8) + "01");
  const [customTo, setCustomTo] = useState(today);
  const [from, to] = rangeFor(period, today, customFrom, customTo);

  const [cards, setCards] = useState<Card[]>([]);
  const [weights, setWeights] = useState({ w_timeliness: 35, w_quality: 30, w_volume: 20, w_activeness: 15, working_days_per_week: 6 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Card | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    supabase
      .from("kpi_settings")
      .select("*")
      .maybeSingle()
      .then(({ data }) => data && setWeights(data as any));
  }, []);

  useEffect(() => {
    load();
  }, [from, to]);

  async function load() {
    setLoading(true);
    setError("");
    const { data, error: err } = await supabase.rpc("team_scorecards", { p_from: from, p_to: to });
    setLoading(false);
    if (err) return setError(err.message);
    setCards((data || []) as Card[]);
  }

  const visible = isAdmin ? cards : cards.filter((c) => c.user_id === me);
  const ranked = useMemo(() => [...visible].sort((a, b) => (Number(b.score ?? -1) - Number(a.score ?? -1))), [visible]);

  const team = useMemo(() => {
    const scored = visible.filter((c) => c.score !== null);
    const subTotal = visible.reduce((s, c) => s + c.submitted_total, 0);
    const subOn = visible.reduce((s, c) => s + c.submitted_on_time, 0);
    const comp = visible.reduce((s, c) => s + c.completed, 0);
    const fp = visible.reduce((s, c) => s + c.first_pass, 0);
    return {
      avg: scored.length ? scored.reduce((s, c) => s + Number(c.score), 0) / scored.length : null,
      onTime: subTotal ? Math.round((100 * subOn) / subTotal) : null,
      firstPass: comp ? Math.round((100 * fp) / comp) : null,
      breaches: visible.reduce((s, c) => s + c.statutory_breached, 0),
    };
  }, [visible]);

  const mine = cards.find((c) => c.user_id === me);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm lg:flex-row lg:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <Gauge className="h-5 w-5 text-navy" /> Performance Scorecards
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            {isAdmin ? "Timeliness, quality, volume and activeness for every team member." : "Your own performance. Only you and your administrators can see it."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap rounded-lg border border-border bg-surface-alt p-0.5 text-xs font-semibold">
            {(
              [
                ["month", "This Month"],
                ["lastMonth", "Last Month"],
                ["quarter", "This Quarter"],
                ["fy", "This FY"],
                ["custom", "Custom"],
              ] as [Period, string][]
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setPeriod(k)} className={`rounded-md px-2.5 py-1.5 transition ${period === k ? "bg-surface text-navy shadow-sm" : "text-text-muted"}`}>
                {l}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-1 text-xs">
              <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-lg border border-border px-2 py-1.5" />
              <span className="text-text-muted">to</span>
              <input type="date" value={customTo} min={customFrom} max={today} onChange={(e) => setCustomTo(e.target.value)} className="rounded-lg border border-border px-2 py-1.5" />
            </div>
          )}
          {isAdmin && (
            <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt">
              <Settings2 className="h-4 w-4 text-navy" /> Weights
            </button>
          )}
        </div>
      </div>

      <p className="text-[11px] text-text-muted">
        Period {formatDate(from)} – {formatDate(to)} · {weights.working_days_per_week === 6 ? "Monday–Saturday" : weights.working_days_per_week === 5 ? "Monday–Friday" : "All 7 days"} are working days.
      </p>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs font-medium text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface p-10 text-xs text-text-muted shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Calculating scorecards...
        </div>
      ) : isAdmin ? (
        <>
          {/* Team summary */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[
              { label: "Team Average Score", value: team.avg === null ? "—" : Math.round(team.avg), icon: Award, tone: scoreTone(team.avg) },
              { label: "On-Time Submission", value: team.onTime === null ? "—" : `${team.onTime}%`, icon: Clock, tone: scoreTone(team.onTime) },
              { label: "First-Pass Approval", value: team.firstPass === null ? "—" : `${team.firstPass}%`, icon: Target, tone: scoreTone(team.firstPass) },
              {
                label: "Statutory Breaches",
                value: team.breaches,
                icon: AlertCircle,
                tone: team.breaches ? { text: "text-rose-700", bg: "bg-rose-50", ring: "", label: "" } : { text: "text-emerald-700", bg: "bg-emerald-50", ring: "", label: "" },
              },
            ].map((k) => {
              const Icon = k.icon;
              return (
                <div key={k.label} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{k.label}</p>
                      <p className={`mt-1.5 text-2xl font-bold tracking-tight ${k.tone.text}`}>{k.value}</p>
                    </div>
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${k.tone.bg} ${k.tone.text}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Team table */}
          <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Team Member</th>
                  <th>Score</th>
                  <th className="min-w-[180px]">Breakdown</th>
                  <th className="text-right">Completed</th>
                  <th className="text-right">On Time</th>
                  <th className="text-right">First Pass</th>
                  <th className="text-right">Statutory Breaches</th>
                  <th className="text-right">Logged</th>
                  <th className="text-right">Active Days</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((c) => {
                  const tone = scoreTone(c.score);
                  return (
                    <tr key={c.user_id} onClick={() => setSelected(c)} className="cursor-pointer transition hover:bg-surface-alt">
                      <td>
                        <span className="flex items-center gap-2 font-semibold text-navy">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy/10 text-[10px] font-bold">{getInitials(c.name)}</span>
                          {c.name}
                          {c.user_id === me && <span className="text-[10px] font-normal text-text-muted">(you)</span>}
                        </span>
                      </td>
                      <td>
                        <span className="flex items-center gap-2">
                          <ScoreRing score={c.score} size={40} />
                          <span className={`text-[10px] font-semibold ${tone.text}`}>{tone.label}</span>
                        </span>
                      </td>
                      <td className="space-y-1">
                        <Bar label="Timeliness" value={c.score_timeliness} weight={weights.w_timeliness} />
                        <Bar label="Quality" value={c.score_quality} weight={weights.w_quality} />
                      </td>
                      <td className="text-right font-semibold">{c.completed}</td>
                      <td className="text-right">{c.on_time_rate === null ? "—" : `${Math.round(c.on_time_rate)}%`}</td>
                      <td className="text-right">{c.first_pass_rate === null ? "—" : `${Math.round(c.first_pass_rate)}%`}</td>
                      <td className={`text-right font-semibold ${c.statutory_breached ? "text-rose-600" : "text-text-muted"}`}>{c.statutory_breached}</td>
                      <td className="text-right">{hm(c.logged_minutes)}</td>
                      <td className="text-right">
                        {c.active_days}/{c.working_days}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {ranked.length === 0 && <p className="p-8 text-center text-xs text-text-muted">No active team members.</p>}
          </div>
          <p className="text-[11px] text-text-muted">Click a person for their full scorecard and to add a performance review.</p>
        </>
      ) : mine ? (
        <ScorecardDetail card={mine} weights={weights} from={from} to={to} isAdmin={false} me={me} inline />
      ) : (
        <p className="rounded-xl border border-border bg-surface p-10 text-center text-xs text-text-muted">No data yet for this period.</p>
      )}

      {selected && (
        <Modal title={selected.name} subtitle={`Scorecard · ${formatDate(from)} – ${formatDate(to)}`} onClose={() => setSelected(null)} maxWidth="max-w-4xl">
          <ScorecardDetail card={selected} weights={weights} from={from} to={to} isAdmin={isAdmin} me={me} />
        </Modal>
      )}

      {settingsOpen && (
        <WeightsModal
          initial={weights}
          onClose={() => setSettingsOpen(false)}
          onSaved={(w) => {
            setWeights(w);
            setSettingsOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

/* ---------------- Full scorecard + reviews ---------------- */

function ScorecardDetail({ card: c, weights, from, to, isAdmin, me, inline }: { card: Card; weights: any; from: string; to: string; isAdmin: boolean; me: string; inline?: boolean }) {
  const [supabase] = useState(() => createClient());
  const [reviews, setReviews] = useState<any[]>([]);
  const [team, setTeam] = useState<Record<string, string>>({});
  const [rating, setRating] = useState(0);
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [goals, setGoals] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const tone = scoreTone(c.score);

  useEffect(() => {
    loadReviews();
  }, [c.user_id]);

  async function loadReviews() {
    const [r, p] = await Promise.all([
      supabase.from("kpi_reviews").select("*").eq("user_id", c.user_id).order("created_at", { ascending: false }).limit(12),
      supabase.from("profiles").select("id, name"),
    ]);
    setReviews(r.data || []);
    setTeam(Object.fromEntries((p.data || []).map((x: any) => [x.id, x.name])));
  }

  async function addReview(e: React.FormEvent) {
    e.preventDefault();
    if (!strengths.trim() && !improvements.trim() && !goals.trim() && !rating) return setError("Add a rating or at least one note.");
    setSaving(true);
    setError("");
    const { error: err } = await supabase.from("kpi_reviews").insert([
      {
        user_id: c.user_id,
        reviewer_id: me,
        period_from: from,
        period_to: to,
        rating: rating || null,
        strengths: strengths.trim() || null,
        improvements: improvements.trim() || null,
        goals: goals.trim() || null,
        score_snapshot: c.score,
      },
    ]);
    setSaving(false);
    if (err) return setError(err.message);
    logAuditEvent("ADD_PERFORMANCE_REVIEW", "KPI_REVIEWS", c.user_id, { name: c.name, rating, period: `${from} to ${to}` });
    setRating(0);
    setStrengths("");
    setImprovements("");
    setGoals("");
    loadReviews();
  }

  const metrics = [
    { icon: CheckCircle2, label: "Tasks completed", value: c.completed, sub: `${c.assigned} assigned this period · ${c.open_now} open now` },
    { icon: Clock, label: "On-time submissions", value: c.on_time_rate === null ? "—" : `${Math.round(c.on_time_rate)}%`, sub: `${c.submitted_on_time} of ${c.submitted_total} by the internal deadline` },
    { icon: AlertCircle, label: "Statutory deadlines", value: `${c.statutory_due - c.statutory_breached}/${c.statutory_due}`, sub: c.statutory_breached ? `${c.statutory_breached} breached` : "None breached" },
    { icon: Target, label: "First-pass approval", value: c.first_pass_rate === null ? "—" : `${Math.round(c.first_pass_rate)}%`, sub: `Average ${c.avg_rounds ?? 0} revision rounds` },
    { icon: TrendingUp, label: "Time to start", value: c.avg_start_hours === null ? "—" : `${c.avg_start_hours}h`, sub: "Average from assignment to starting" },
    { icon: BarChart3, label: "Work cycle", value: c.avg_cycle_hours === null ? "—" : `${c.avg_cycle_hours}h`, sub: "Average from start to submission" },
    { icon: Timer, label: "Estimate vs actual", value: c.est_minutes ? `${Math.round((100 * c.actual_minutes) / c.est_minutes)}%` : "—", sub: c.est_minutes ? `${hm(c.actual_minutes)} used of ${hm(c.est_minutes)} estimated` : "No estimates on completed tasks" },
    { icon: Users, label: "Activeness", value: `${c.active_days}/${c.working_days} days`, sub: `${hm(c.active_minutes)} active · ${hm(c.logged_minutes)} logged (${c.logged_minutes ? Math.round((100 * c.billable_minutes) / c.logged_minutes) : 0}% billable) · ${c.confirmed_days} days confirmed` },
  ];

  return (
    <div className="space-y-5 text-xs">
      <div className={`flex flex-col gap-4 rounded-xl p-4 sm:flex-row sm:items-center ${inline ? "border border-border bg-surface shadow-sm" : tone.bg}`}>
        <ScoreRing score={c.score} size={88} />
        <div className="flex-1 space-y-1.5">
          <p className={`text-sm font-bold ${tone.text}`}>
            {tone.label}
            {inline ? ` · ${c.name}` : ""}
          </p>
          <Bar label="Timeliness" value={c.score_timeliness} weight={weights.w_timeliness} />
          <Bar label="Quality" value={c.score_quality} weight={weights.w_quality} />
          <Bar label="Volume" value={c.score_volume} weight={weights.w_volume} />
          <Bar label="Activeness" value={c.score_activeness} weight={weights.w_activeness} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {metrics.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy/10 text-navy">
                <Icon className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[11px] text-text-muted">{m.label}</p>
                <p className="text-base font-bold text-text-main">{m.value}</p>
                <p className="text-[10px] text-text-muted">{m.sub}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-xs font-bold text-text-main">
          <MessageSquarePlus className="h-4 w-4 text-navy" /> Performance Reviews
        </h4>

        {isAdmin && (
          <form onSubmit={addReview} className="space-y-2 rounded-lg border border-border bg-surface-alt p-3">
            {error && <p className="font-medium text-rose-600">{error}</p>}
            <div className="flex items-center gap-1">
              <span className="mr-2 text-[11px] font-semibold text-text-muted">Rating</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(rating === n ? 0 : n)} aria-label={`${n} stars`}>
                  <Star className={`h-5 w-5 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-border"}`} />
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <label className={labelClass}>Strengths</label>
                <textarea rows={3} value={strengths} onChange={(e) => setStrengths(e.target.value)} className={inputClass} maxLength={1000} />
              </div>
              <div>
                <label className={labelClass}>To improve</label>
                <textarea rows={3} value={improvements} onChange={(e) => setImprovements(e.target.value)} className={inputClass} maxLength={1000} />
              </div>
              <div>
                <label className={labelClass}>Goals for next period</label>
                <textarea rows={3} value={goals} onChange={(e) => setGoals(e.target.value)} className={inputClass} maxLength={1000} />
              </div>
            </div>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save review
            </button>
          </form>
        )}

        {reviews.length === 0 ? (
          <p className="italic text-text-muted">No reviews yet.</p>
        ) : (
          reviews.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-text-main">
                  {formatDate(r.period_from)} – {formatDate(r.period_to)}
                  {r.score_snapshot !== null && <span className="ml-2 text-[10px] text-text-muted">score then: {Math.round(r.score_snapshot)}</span>}
                </p>
                <span className="flex items-center gap-0.5">
                  {r.rating
                    ? Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-3.5 w-3.5 ${i < r.rating ? "fill-amber-400 text-amber-400" : "text-border"}`} />)
                    : null}
                </span>
              </div>
              <p className="text-[10px] text-text-muted">
                By {team[r.reviewer_id] || "admin"} on {formatDate(r.created_at)}
              </p>
              {r.strengths && <p className="mt-1.5"><span className="font-semibold text-emerald-700">Strengths:</span> {r.strengths}</p>}
              {r.improvements && <p className="mt-1"><span className="font-semibold text-amber-700">To improve:</span> {r.improvements}</p>}
              {r.goals && <p className="mt-1"><span className="font-semibold text-navy">Goals:</span> {r.goals}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ---------------- Weights (admin) ---------------- */

function WeightsModal({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved: (w: any) => void }) {
  const [supabase] = useState(() => createClient());
  const [w, setW] = useState({ ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const total = Number(w.w_timeliness) + Number(w.w_quality) + Number(w.w_volume) + Number(w.w_activeness);

  async function save() {
    if (total !== 100) return setError(`Weights must add up to 100 (now ${total}).`);
    setSaving(true);
    const payload = {
      w_timeliness: Number(w.w_timeliness),
      w_quality: Number(w.w_quality),
      w_volume: Number(w.w_volume),
      w_activeness: Number(w.w_activeness),
      working_days_per_week: Number(w.working_days_per_week),
      updated_at: new Date().toISOString(),
    };
    // The database limits this to your firm's row
    const { error: err } = await supabase.from("kpi_settings").update(payload).not("org_id", "is", null);
    setSaving(false);
    if (err) return setError(err.message);
    logAuditEvent("UPDATE_KPI_WEIGHTS", "SETTINGS", undefined, payload);
    onSaved(payload);
  }

  return (
    <Modal
      title="Scoring weights"
      subtitle="How much each area counts towards the score. Must total 100."
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-xs">
        {error && <p className="font-medium text-rose-600">{error}</p>}
        {(
          [
            ["w_timeliness", "Timeliness", "Submitting by the internal deadline, no statutory breaches"],
            ["w_quality", "Quality", "Approved without being sent back"],
            ["w_volume", "Volume", "Completed work, weighted by estimated hours"],
            ["w_activeness", "Activeness", "Active days in the app vs working days"],
          ] as [string, string, string][]
        ).map(([k, label, hint]) => (
          <div key={k} className="flex items-center gap-3">
            <div className="flex-1">
              <p className="font-semibold text-text-main">{label}</p>
              <p className="text-[10px] text-text-muted">{hint}</p>
            </div>
            <input type="number" min={0} max={100} value={w[k]} onChange={(e) => setW({ ...w, [k]: e.target.value })} className="w-20 rounded-lg border border-border px-2 py-1.5 text-right" />
            <span className="text-text-muted">%</span>
          </div>
        ))}
        <p className={`text-right font-semibold ${total === 100 ? "text-emerald-700" : "text-rose-600"}`}>Total: {total}%</p>
        <div>
          <label className={labelClass}>Working days</label>
          <select value={w.working_days_per_week} onChange={(e) => setW({ ...w, working_days_per_week: Number(e.target.value) })} className={inputClass}>
            <option value={5}>Monday–Friday</option>
            <option value={6}>Monday–Saturday</option>
            <option value={7}>All 7 days</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}