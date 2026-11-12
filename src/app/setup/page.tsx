"use client";

import { useEffect, useRef, useState } from "react";
import { Barlow_Condensed } from "next/font/google";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BellRing,
  Briefcase,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  Mail,
  Play,
  Receipt,
  RotateCcw,
  Users,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/layout/UserContext";
import DueskLogo from "@/components/onboarding/DueskLogo";
import Stamp from "@/components/onboarding/Stamp";

const stampFont = Barlow_Condensed({ subsets: ["latin"], weight: "700", variable: "--font-stamp" });

/* ------------------------------------------------------------------ */
/* Rules (same as the server)                                          */
/* ------------------------------------------------------------------ */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[\w.\-]{2,256}@[A-Za-z]{2,64}$/;
const PREFIX_RE = /^[A-Za-z0-9/_\-{}]{1,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BANK_FIELDS = ["bank_name", "bank_account_no", "bank_ifsc", "upi_id"] as const;

const STATE_BY_CODE: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "25": "Daman & Diu", "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra",
  "28": "Andhra Pradesh (old)", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
  "97": "Other Territory",
};

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */
const INDEX = ["Firm", "Billing", "Practice", "Compare", "Done"]; // steps 1-5
const LAST = 5;

const PLAN: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Building2, title: "Your firm", text: "Name, GSTIN and address become your letterhead." },
  { icon: Receipt, title: "Billing", text: "Invoice numbering, GST rate and where clients pay you." },
  { icon: Briefcase, title: "Your practice", text: "The services you offer and how you work today." },
  { icon: Play, title: "Compare", text: "Watch one client's month run by itself in Duesk." },
];

const SERVICES = ["GST returns", "TDS / TCS", "Income tax (ITR)", "ROC / MCA", "Audit", "Accounting & bookkeeping", "Payroll, PF & ESI", "Advisory"];
const TEAM_SIZES = ["Just me", "2 to 5", "6 to 15", "16 or more"];

/** Made-up tools for the "how you work now" comparison. */
const TOOLS: { id: string; label: string; app: string; file: string }[] = [
  { id: "excel", label: "Spreadsheets", app: "GridBook", file: "client_deadlines_FINAL_v3.grid" },
  { id: "registers", label: "Registers and chat groups", app: "Daybook", file: "Register 2026-27" },
  { id: "tally", label: "An accounting package", app: "LedgerBooks", file: "Firm Accounts 2026-27" },
  { id: "pms", label: "Another practice software", app: "Practicely", file: "All tasks" },
  { id: "none", label: "Starting fresh", app: "", file: "" },
];

const BETTER: Record<string, { now: string; duesk: string }[]> = {
  excel: [
    { now: "Due dates live in a sheet someone has to remember to open.", duesk: "Every deadline is a task with an internal date before the statutory one, and reminders go out by themselves." },
    { now: "You ask around to find out who is doing what.", duesk: "Each person has a live work queue, and you see every task's stage at a glance." },
    { now: "Hours are guessed at month end.", duesk: "Timers follow the task stage, and a daily review catches anything missed." },
    { now: "Invoices are typed and chased by hand.", duesk: "Retainers bill themselves every month, with reminders and late fees." },
  ],
  registers: [
    { now: "Client messages are scattered across chat groups and email.", duesk: "Your firm mailbox and client discussions sit in one place, linked to each client." },
    { now: "Proposals are typed and signed on paper.", duesk: "Engagement letters come from your packages and are accepted online, which starts the work and the billing." },
    { now: "Documents live on personal phones.", duesk: "A private vault per client, with 7-day share links and a full audit trail." },
    { now: "Quality depends on who checked it.", duesk: "Maker-checker review: work isn't done until a reviewer approves it." },
  ],
  tally: [
    { now: "The accounting package keeps the books, not the practice.", duesk: "Duesk runs the work: compliance tasks, deadlines, reviews and team capacity." },
    { now: "Your own fee invoices need care for GST.", duesk: "GST-correct invoices with place of supply, one continuous series, and cancel instead of delete." },
    { now: "Receivables are tracked from memory.", duesk: "Reminders before and after the due date, and late fees added to the next bill." },
    { now: "No clear view of staff productivity.", duesk: "KPI scorecards built from real task and time data." },
  ],
  pms: [
    { now: "Proposal, onboarding and billing are separate jobs.", duesk: "One chain: engagement letter, online acceptance, tasks scheduled, monthly bills, reminders." },
    { now: "Timesheets are filled from memory.", duesk: "Time is tracked from task stages, with idle detection and a daily review." },
    { now: "Task lists don't know Indian compliance.", duesk: "Statutory and internal due dates for each compliance, handover notes and maker-checker review." },
    { now: "Appraisals rely on impressions.", duesk: "KPI scorecards and monthly reviews based on real work." },
  ],
  none: [
    { now: "Building a practice system from scratch.", duesk: "Ready-made compliance task types with due-date rules are already in your firm." },
    { now: "Juggling separate apps.", duesk: "Clients, tasks, billing, time, inbox, documents and chat in one place." },
    { now: "Worrying about GST on your own invoices.", duesk: "GST-correct invoices and quotations, emailed from your own address." },
    { now: "Growing beyond yourself.", duesk: "Add staff with exactly the access they need; every action is in the audit trail." },
  ],
};

/** One client's month, played back on the Compare step. */
const MONTH: { day: string; icon: LucideIcon; title: string; detail: string; chips?: string[] }[] = [
  { day: "1 Sep", icon: FileText, title: "Sharma Traders accepts your engagement letter online", detail: "Monthly GST retainer, ₹15,000 + GST" },
  { day: "1 Sep", icon: CalendarClock, title: "The year's work is scheduled", detail: "Each task gets an internal date a few days before the statutory one", chips: ["GSTR-1, Sep", "GSTR-3B, Sep", "TDS, Q2"] },
  { day: "5 Oct", icon: Receipt, title: "September's bill is drafted, approved and emailed", detail: "INV/2026-27/0002 for ₹17,700, with your UPI and bank details" },
  { day: "8 Oct", icon: BellRing, title: "Two reminders go out on their own", detail: "Ankit: GSTR-1's internal deadline is close. Client: payment due in 2 days" },
  { day: "9 Oct", icon: CheckCircle2, title: "Priya reviews and approves GSTR-1", detail: "October's GSTR-1 task is created automatically" },
  { day: "12 Oct", icon: Wallet, title: "Payment of ₹17,700 recorded", detail: "The invoice is marked Paid and the reminders stop" },
];

const NEXT_STEPS: { icon: LucideIcon; title: string; text: string; href: string }[] = [
  { icon: Users, title: "Add your team", text: "Give each person only the modules they need.", href: "/team" },
  { icon: Mail, title: "Connect your firm mailbox", text: "Send invoices from your own address.", href: "/inbox" },
  { icon: Building2, title: "Add your clients", text: "One by one or from a spreadsheet.", href: "/clients" },
  { icon: Briefcase, title: "Create a retainer package", text: "Services plus a fee, ready to send.", href: "/packages" },
];

/* ------------------------------------------------------------------ */
/* Helpers and small pieces                                            */
/* ------------------------------------------------------------------ */
type Form = {
  firm_name: string; gstin: string; pan: string; address: string; phone: string; email: string; website: string;
  invoice_prefix: string; quotation_prefix: string; default_gst_rate: string; payment_terms: string;
  bank_name: string; bank_account_no: string; bank_ifsc: string; upi_id: string;
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-navy focus:ring-4 focus:ring-navy/10";

const money = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function financialYear(): string {
  const now = new Date();
  const y = now.getFullYear();
  const start = now.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      {children}
      {hint && <div className="mt-1.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function Tick({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      className={`flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition active:scale-[0.98] ${
        checked ? "border-navy bg-navy/[0.04] font-semibold text-navy" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
      }`}
    >
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition ${checked ? "border-navy bg-navy text-white" : "border-slate-300"}`}>
        {checked && <Check className="ob-pop h-3.5 w-3.5" />}
      </span>
      {label}
    </button>
  );
}

/** A decorative QR-like block (not scannable): the real QR is generated on the invoice PDF. */
function FakeQr({ seed, size = 60 }: { seed: string; size?: number }) {
  const n = 21;
  let h = 7;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const finder = (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
      if (finder) continue;
      h = (h * 1103515245 + 12345) >>> 0;
      if ((h >>> 16) & 1) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
    }
  }
  const finder = (fx: number, fy: number) => (
    <g key={`f-${fx}-${fy}`}>
      <rect x={fx} y={fy} width="7" height="7" />
      <rect x={fx + 1} y={fy + 1} width="5" height="5" fill="#fff" />
      <rect x={fx + 2} y={fy + 2} width="3" height="3" />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" fill="#10233f" aria-hidden="true">
      {cells}
      {finder(0, 0)}
      {finder(n - 7, 0)}
      {finder(0, n - 7)}
    </svg>
  );
}

/** Made-up marks for the made-up tools. */
function ToolMark({ id }: { id: string }) {
  if (id === "excel")
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <rect width="18" height="18" rx="4" fill="#0e7490" />
        <path d="M4 6.5h10M4 11.5h10M9 4v10" stroke="#fff" strokeWidth="1.4" />
      </svg>
    );
  if (id === "registers")
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <rect x="2" y="1.5" width="14" height="15" rx="2" fill="#8b5e3c" />
        <path d="M5 1.5v15" stroke="#5c3d26" strokeWidth="1.5" />
        <path d="M8 6h5M8 9h5" stroke="#f3e3d3" strokeWidth="1.2" />
      </svg>
    );
  if (id === "tally")
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r="8" fill="#b45309" />
        <path d="M6.5 5v8h5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect width="18" height="18" rx="9" fill="#475569" />
      <path d="M6.5 13V5h3a2.5 2.5 0 0 1 0 5h-3" stroke="#fff" strokeWidth="1.6" fill="none" />
    </svg>
  );
}

/** A mock window of the tool the firm uses today. */
function NowWindow({ toolId }: { toolId: string }) {
  const tool = TOOLS.find((t) => t.id === toolId);
  if (!tool || !tool.app) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-3 py-2">
        <span className="flex gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        </span>
        <ToolMark id={tool.id} />
        <span className="text-xs font-semibold text-slate-700">{tool.app}</span>
        <span className="truncate text-xs text-slate-500">{tool.file}</span>
      </div>

      {tool.id === "excel" && (
        <table className="w-full border-collapse text-[11px] text-slate-700">
          <thead>
            <tr className="bg-slate-50 text-slate-400">
              {["", "A", "B", "C", "D"].map((c) => (
                <th key={c} className="border border-slate-200 px-2 py-1 font-normal">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["1", "Client", "Return", "Due", "Done?"],
              ["2", "Sharma Traders", "GSTR-1", "11/10", "yes"],
              ["3", "Mehta & Sons", "GSTR-3B", "20/10", ""],
              ["4", "Kapoor Foods", "TDS Q2", "31/10", "?"],
              ["5", "Sharma Traders", "GSTR-3B", "20/10", ""],
            ].map((row) => (
              <tr key={row[0]} className={row[0] === "5" ? "bg-amber-50" : ""}>
                {row.map((cell, i) => (
                  <td key={i} className={`border border-slate-200 px-2 py-1 ${i === 0 ? "bg-slate-50 text-center text-slate-400" : ""} ${row[0] === "1" ? "font-semibold" : ""}`}>
                    {cell}
                    {row[0] === "3" && i === 4 && <span className="ob-caret ml-px inline-block h-3 w-px translate-y-0.5 bg-slate-700" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tool.id === "registers" && (
        <div className="space-y-2 p-3 text-xs">
          <div className="space-y-1 italic text-slate-600" style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent 19px, #e2e8f0 19px, #e2e8f0 20px)" }}>
            <p>10/10 Mehta: GST documents pending, call again</p>
            <p>11/10 Sharma GSTR-1: filed? ask Ankit</p>
            <p className="line-through decoration-rose-400">12/10 Kapoor: bill not sent</p>
          </div>
          <div className="w-fit max-w-[85%] rounded-lg rounded-tl-none bg-slate-100 px-3 py-1.5 text-slate-700">
            <span className="block text-[10px] font-semibold text-slate-500">Pinger · Office group</span>
            Sir, which client&apos;s 3B is still pending?
          </div>
        </div>
      )}

      {tool.id === "tally" && (
        <table className="w-full text-[11px] text-slate-700">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="px-3 py-1.5 font-medium">Date</th>
              <th className="px-3 py-1.5 font-medium">Particulars</th>
              <th className="px-3 py-1.5 text-right font-medium">Debit</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="px-3 py-1.5">05/10</td>
              <td className="px-3 py-1.5">Sharma Traders, professional fees</td>
              <td className="px-3 py-1.5 text-right">17,700.00</td>
            </tr>
            <tr>
              <td className="px-3 py-1.5" />
              <td className="px-3 py-1.5 italic text-slate-400" colSpan={2}>
                Which returns are pending, and who is on them? Not recorded here.
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {tool.id === "pms" && (
        <ul className="divide-y divide-slate-100 text-xs text-slate-700">
          <li className="flex justify-between px-3 py-2"><span>GSTR-1, Sharma Traders</span><span className="text-slate-500">Due 11/10 · Ankit</span></li>
          <li className="flex justify-between px-3 py-2"><span>Bill Sharma Traders</span><span className="text-slate-500">Reminder set by hand</span></li>
          <li className="flex justify-between px-3 py-2"><span>Engagement letter</span><span className="text-slate-500">Word file, emailed</span></li>
        </ul>
      )}
    </div>
  );
}

/** Plays one client's month in Duesk, event by event. */
function MonthPlayer() {
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setPlaying(true), 700); // starts by itself once
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (shown >= MONTH.length) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 200 : 1150);
    return () => window.clearTimeout(t);
  }, [playing, shown]);

  const done = shown >= MONTH.length;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold text-navy">
          <DueskLogo size={18} wordmark={false} /> A month with one client
        </span>
        <button
          type="button"
          onClick={() => {
            setShown(0);
            setPlaying(true);
          }}
          disabled={playing}
          className="inline-flex items-center gap-1.5 rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-navy-light disabled:opacity-60"
        >
          {done ? <RotateCcw className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing ? "Playing" : done ? "Play again" : "Play the month"}
        </button>
      </div>
      <div className="px-4 py-4">
        {shown === 0 && <p className="py-8 text-center text-sm text-slate-500">Press play to watch it run.</p>}
        <ol className="relative">
          {shown > 0 && <span className="absolute bottom-4 left-[15px] top-4 w-0.5 bg-[var(--ob-stamp)]/30" />}
          {MONTH.slice(0, shown).map((e) => (
            <li key={e.title} className="ob-slide-left relative flex gap-3 pb-4 last:pb-0">
              <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-[var(--ob-stamp)] bg-white text-[var(--ob-stamp)]">
                <e.icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm font-semibold text-slate-900">
                  <span className="mr-2 font-normal tabular-nums text-slate-500">{e.day}</span>
                  {e.title}
                </p>
                <p className="text-xs text-slate-500">{e.detail}</p>
                {e.chips && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {e.chips.map((c, i) => (
                      <span key={c} className="ob-pop rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700" style={{ animationDelay: `${0.2 + i * 0.15}s` }}>
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
        {done && (
          <p className="ob-rise mt-4 border-t border-slate-200 pt-3 text-sm text-slate-700">
            Nobody typed a date, chased a colleague or wrote a reminder. You approved one bill.
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The firm file (right-hand sheet)                                    */
/* ------------------------------------------------------------------ */
function FirmSheet({
  form,
  gstState,
  sampleNumber,
  services,
  step,
  signatory,
}: {
  form: Form;
  gstState?: string;
  sampleNumber: string;
  services: string[];
  step: number;
  signatory: string;
}) {
  const stamped = step === LAST;
  const rate = Number(form.default_gst_rate) || 0;
  const base = 15000;
  const tax = Math.round(base * rate) / 100;
  const today = new Date();
  const invoiceDate = today.toLocaleDateString("en-GB");
  const stampDate = today.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const maskedAcc = form.bank_account_no ? "XXXX" + form.bank_account_no.slice(-4) : "";

  return (
    <div className={`ob-sheet relative min-h-[560px] rounded-sm py-8 pl-16 pr-8 ${stamped ? "ob-thud" : "ob-sheet-in"}`}>
      {/* Letterhead */}
      <p className="text-xl font-extrabold tracking-tight text-navy">{form.firm_name || "Your firm's name"}</p>
      <p className="mt-1 min-h-[1rem] text-xs text-slate-500">{form.address || "Address"}</p>
      <p className="text-[11px] text-slate-500">
        {[form.gstin && `GSTIN ${form.gstin}`, form.pan && `PAN ${form.pan}`].filter(Boolean).join("     ") || "GSTIN and PAN"}
      </p>
      <p className="min-h-[1rem] text-[11px] text-slate-500">{[form.email, form.phone, form.website].filter(Boolean).join("     ")}</p>
      <div className="mt-4 h-[3px] bg-navy" />
      <div className="mt-0.5 h-px bg-navy" />

      {/* Invoice prints after the Billing step */}
      {step >= 2 ? (
        <div key="invoice" className="ob-print mt-6 text-[12px] text-slate-700">
          <div className="flex items-baseline justify-between">
            <p className="text-base font-bold text-navy">Tax invoice</p>
            <p className="tabular-nums">
              <span className="font-semibold text-navy">{sampleNumber}</span>
              <span className="ml-3 text-slate-500">{invoiceDate}</span>
            </p>
          </div>
          <div className="mt-3 flex justify-between gap-4">
            <p>
              Bill to <span className="font-semibold text-slate-900">Sharma Traders</span>
            </p>
            <p>Place of supply {gstState || "—"}</p>
          </div>
          <table className="mt-3 w-full">
            <tbody>
              <tr className="border-y border-slate-300">
                <td className="py-1.5">GST return filing, September</td>
                <td className="py-1.5 text-right tabular-nums">{money(base)}</td>
              </tr>
              <tr>
                <td className="pt-1.5 text-slate-500">CGST @ {rate / 2}%</td>
                <td className="pt-1.5 text-right tabular-nums text-slate-500">{money(tax / 2)}</td>
              </tr>
              <tr>
                <td className="text-slate-500">SGST @ {rate / 2}%</td>
                <td className="text-right tabular-nums text-slate-500">{money(tax / 2)}</td>
              </tr>
              <tr className="border-b-[3px] border-double border-slate-400">
                <td className="py-1.5 font-bold text-navy">Total</td>
                <td className="py-1.5 text-right font-bold tabular-nums text-navy">{money(base + tax)}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-4 flex items-end justify-between gap-4">
            <div className="text-[11px] leading-relaxed">
              {form.bank_account_no ? (
                <p>
                  Pay to {form.bank_name || "Bank"} · A/C {maskedAcc} · IFSC {form.bank_ifsc}
                </p>
              ) : (
                <p className="text-slate-400">Bank details print here</p>
              )}
              {form.upi_id && <p>UPI {form.upi_id}</p>}
              {form.payment_terms && <p className="text-slate-500">{form.payment_terms}</p>}
            </div>
            {form.upi_id && (
              <div key={form.upi_id} className="ob-pop shrink-0 rounded border border-slate-200 bg-white p-1">
                <FakeQr seed={form.upi_id} />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          <div className="h-2.5 w-2/5 rounded bg-slate-100" />
          <div className="h-2.5 w-4/5 rounded bg-slate-100" />
          <div className="h-2.5 w-3/5 rounded bg-slate-100" />
          <p className="pt-2 text-xs text-slate-400">Your first invoice prints here after the next step.</p>
        </div>
      )}

      {/* Services appear as they're ticked */}
      {step >= 3 && services.length > 0 && (
        <div className="mt-7 text-[12px]">
          <p className="font-bold text-navy">Services we handle</p>
          <ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1">
            {services.map((s) => (
              <li key={s} className="ob-pop flex items-center gap-1.5 text-slate-700">
                <Check className="h-3.5 w-3.5 text-[var(--ob-ok)]" /> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Signature and stamp at the end */}
      <div className="mt-10 w-48">
        {stamped && (
          <svg viewBox="0 0 130 40" className="h-10 w-40" aria-hidden="true">
            <path
              d="M4 30 C 18 4, 32 6, 27 26 S 46 38, 56 18 S 78 6, 74 26 S 96 36, 108 16 L 124 12"
              fill="none"
              stroke="#10233f"
              strokeWidth="2"
              strokeLinecap="round"
              className="ob-draw"
              style={{ "--ob-len": 260, animationDelay: "0.9s" } as React.CSSProperties}
            />
          </svg>
        )}
        <p className="border-t border-slate-300 pt-1 text-[11px] text-slate-500">
          {signatory ? `${signatory}, ` : ""}authorised signatory
        </p>
      </div>
      {stamped && (
        <div className="absolute bottom-12 right-8">
          <Stamp title="Registered" subtitle="on Duesk" date={stampDate} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function SetupWizardPage() {
  const me = useCurrentUser();
  const [supabase] = useState(() => createClient());
  const rootRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [form, setForm] = useState<Form>({
    firm_name: "", gstin: "", pan: "", address: "", phone: "", email: "", website: "",
    invoice_prefix: "", quotation_prefix: "", default_gst_rate: "18", payment_terms: "",
    bank_name: "", bank_account_no: "", bank_ifsc: "", upi_id: "",
  });
  const [adminPassword, setAdminPassword] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [teamSize, setTeamSize] = useState("");
  const [currentTool, setCurrentTool] = useState("");
  const [compareView, setCompareView] = useState<"now" | "duesk">("now");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("firm_settings").select("*").maybeSingle();
      const s = (data || {}) as Record<string, unknown>;
      const str = (k: string) => (s[k] === null || s[k] === undefined ? "" : String(s[k]));
      setSettings(s);
      setForm({
        firm_name: str("firm_name") || me?.orgName || "",
        gstin: str("gstin"), pan: str("pan"), address: str("address"), phone: str("phone"), email: str("email"), website: str("website"),
        invoice_prefix: str("invoice_prefix") || "INV/", quotation_prefix: str("quotation_prefix"),
        default_gst_rate: s.default_gst_rate === null || s.default_gst_rate === undefined ? "18" : String(s.default_gst_rate),
        payment_terms: str("payment_terms"),
        bank_name: str("bank_name"), bank_account_no: str("bank_account_no"), bank_ifsc: str("bank_ifsc"), upi_id: str("upi_id"),
      });
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  function update(key: keyof Form, raw: string) {
    let value = raw;
    if (key === "gstin" || key === "pan" || key === "bank_ifsc") value = raw.toUpperCase().replace(/\s/g, "");
    if (key === "bank_account_no") value = raw.replace(/\s/g, "");
    setForm((f) => {
      const nextForm = { ...f, [key]: value };
      if (key === "gstin" && GSTIN_RE.test(value)) nextForm.pan = value.slice(2, 12); // the GSTIN contains the PAN
      return nextForm;
    });
  }

  const gstState = form.gstin.length >= 2 ? STATE_BY_CODE[form.gstin.slice(0, 2)] : undefined;
  const gstValid = GSTIN_RE.test(form.gstin);
  const bankChanged = BANK_FIELDS.some((k) => String(settings[k] ?? "").trim() !== form[k].trim());
  const sampleNumber = `${(form.invoice_prefix || "INV/").replace(/\{FY\}/gi, financialYear())}0001`;
  const orgName = form.firm_name || me?.orgName || "your firm";
  const tool = TOOLS.find((t) => t.id === currentTool);

  function validateProfile(): string | null {
    if (form.firm_name.trim().length < 2) return "Enter your firm's name.";
    if (form.gstin && !gstValid) return "That GSTIN doesn't look right. It has 15 characters, for example 07ABCDE1234F1Z5.";
    if (form.pan && !PAN_RE.test(form.pan)) return "That PAN doesn't look right, for example ABCDE1234F.";
    if (form.gstin && form.pan && form.gstin.slice(2, 12) !== form.pan) return "The GSTIN doesn't belong to this PAN.";
    if (form.email && !EMAIL_RE.test(form.email)) return "Enter a valid firm email.";
    return null;
  }

  function validateBilling(): string | null {
    if (!PREFIX_RE.test(form.invoice_prefix)) return "Invoice prefix: letters, numbers and / - _ only, up to 20.";
    if (form.quotation_prefix && !PREFIX_RE.test(form.quotation_prefix)) return "Quotation prefix: letters, numbers and / - _ only, up to 20.";
    const rate = Number(form.default_gst_rate);
    if (!(rate >= 0 && rate <= 100)) return "GST rate must be between 0 and 100.";
    if (form.bank_account_no && !/^[0-9]{9,18}$/.test(form.bank_account_no)) return "Account number must be 9 to 18 digits.";
    if (form.bank_ifsc && !IFSC_RE.test(form.bank_ifsc)) return "That IFSC doesn't look right, for example HDFC0001234.";
    if (form.upi_id && !UPI_RE.test(form.upi_id)) return "That UPI ID doesn't look right, for example firm@okhdfcbank.";
    if (bankChanged && !adminPassword) return "Confirm your password to save bank details.";
    return null;
  }

  async function saveSettings(): Promise<boolean> {
    const payload = { ...settings, ...form, default_gst_rate: Number(form.default_gst_rate) };
    const res = await fetch("/api/admin/firm-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: payload, adminPassword: adminPassword || undefined }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(out.error || "Could not save. Check the details and try again.");
      return false;
    }
    setSettings(payload);
    setAdminPassword("");
    return true;
  }

  async function saveAnswers(answers: Record<string, unknown>, complete: boolean): Promise<boolean> {
    const { error: rpcErr } = await supabase.rpc("save_firm_setup", { p_answers: answers, p_complete: complete });
    if (rpcErr) {
      setError("Could not save your answers. Try again.");
      return false;
    }
    return true;
  }

  function goTo(nextStep: number, direction: "forward" | "back") {
    setDir(direction);
    setStep(nextStep);
    if (nextStep === 4) setCompareView(tool && tool.app ? "now" : "duesk");
    rootRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function next() {
    if (busy) return;
    setError("");

    if (step === 1) {
      const problem = validateProfile();
      if (problem) return setError(problem);
      setBusy(true);
      const ok = (await saveSettings()) && (await saveAnswers({ org_name: form.firm_name.trim() }, false));
      setBusy(false);
      if (!ok) return;
    }
    if (step === 2) {
      const problem = validateBilling();
      if (problem) return setError(problem);
      setBusy(true);
      const ok = await saveSettings();
      setBusy(false);
      if (!ok) return;
    }
    if (step === 3) {
      setBusy(true);
      const ok = await saveAnswers({ services, team_size: teamSize, current_tool: currentTool }, false);
      setBusy(false);
      if (!ok) return;
    }
    if (step === 4) {
      setBusy(true);
      const ok = await saveAnswers({}, true); // stamp only when it's really saved
      setBusy(false);
      if (!ok) return;
    }
    goTo(Math.min(step + 1, LAST), "forward");
  }

  function back() {
    setError("");
    goTo(Math.max(step - 1, 0), "back");
  }

  function leave(target: string) {
    window.location.href = target; // full reload so the app picks up the new firm name
  }

  if (me && !me.isAdmin) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--ob-desk)] p-6">
        <div className="ob-rise max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <DueskLogo size={32} />
          <p className="mt-4 text-lg font-bold text-navy">Firm setup is for administrators</p>
          <p className="mt-2 text-sm text-slate-600">Your firm's administrator has already set things up.</p>
          <a href="/" className="mt-6 inline-block rounded-lg bg-navy px-5 py-2.5 text-sm font-semibold text-white">
            Go to dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`${stampFont.variable} fixed inset-0 z-[80] overflow-y-auto bg-[var(--ob-desk)] text-slate-900`}>
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-[var(--ob-desk)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <DueskLogo size={30} />
          <ol className="hidden flex-1 items-center justify-center gap-6 md:flex">
            {INDEX.map((label, i) => {
              const n = i + 1;
              const done = step > n;
              const current = step === n;
              return (
                <li key={label} className="relative pb-1.5 text-sm">
                  <span className={`flex items-center gap-1.5 transition ${current ? "font-semibold text-navy" : done ? "text-slate-700" : "text-slate-400"}`}>
                    {done && <Check className="ob-pop h-3.5 w-3.5 text-[var(--ob-ok)]" />}
                    {label}
                  </span>
                  <span className="ob-underline absolute inset-x-0 bottom-0 h-0.5 rounded bg-navy" data-on={current} />
                </li>
              );
            })}
          </ol>
          <button type="button" onClick={() => leave("/")} className="ml-auto text-sm text-slate-500 transition hover:text-navy">
            Finish later
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
        {/* Left: questions */}
        <div>
          {!loaded ? (
            <p className="flex items-center gap-2 pt-10 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Opening your firm file...
            </p>
          ) : (
            <div key={step} className={dir === "forward" ? "ob-rise" : "ob-slide-left"}>
              {step === 0 && (
                <section>
                  <h1 className="text-4xl font-bold leading-tight tracking-tight text-navy">Let&apos;s set up {orgName}</h1>
                  <p className="mt-4 max-w-md text-base leading-relaxed text-slate-600">
                    Answer a few questions on this side. Your letterhead, your first invoice and your services take shape on the right, exactly as clients will see them.
                  </p>
                  <p className="mt-2 text-sm text-slate-500">About 3 minutes. You can change anything later in Settings. Your 14-day trial is active.</p>
                  <ol className="mt-8 space-y-4">
                    {PLAN.map((p, i) => (
                      <li key={p.title} className="ob-rise flex gap-3" style={{ animationDelay: `${0.15 + i * 0.08}s` }}>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-navy">
                          <p.icon className="h-4 w-4" />
                        </span>
                        <span>
                          <span className="block text-sm font-semibold text-slate-900">{p.title}</span>
                          <span className="block text-sm text-slate-500">{p.text}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                  <button
                    type="button"
                    onClick={() => goTo(1, "forward")}
                    className="group mt-10 inline-flex items-center gap-2 rounded-lg bg-navy px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-light"
                  >
                    Start <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </button>
                </section>
              )}

              {step === 1 && (
                <section className="space-y-5">
                  <div>
                    <h2 className="text-3xl font-bold tracking-tight text-navy">Your firm</h2>
                    <p className="mt-1 text-sm text-slate-600">These details print on every invoice, quotation and engagement letter.</p>
                  </div>
                  <Field label="Firm name">
                    <input className={inputClass} value={form.firm_name} maxLength={200} onChange={(e) => update("firm_name", e.target.value)} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="GSTIN"
                      hint={
                        gstValid ? (
                          <span key="ok" className="ob-pop inline-flex items-center gap-1 font-semibold text-[var(--ob-ok)]">
                            <CheckCircle2 className="h-3.5 w-3.5" /> {gstState || "Valid"}, PAN filled in
                          </span>
                        ) : form.gstin ? (
                          `15 characters, for example 07ABCDE1234F1Z5${gstState ? `. State: ${gstState}` : ""}`
                        ) : (
                          "Leave empty if your firm isn't GST-registered."
                        )
                      }
                    >
                      <input
                        className={`${inputClass} uppercase tracking-wide ${gstValid ? "border-[var(--ob-ok)]" : ""}`}
                        value={form.gstin}
                        maxLength={15}
                        placeholder="07ABCDE1234F1Z5"
                        onChange={(e) => update("gstin", e.target.value)}
                      />
                    </Field>
                    <Field label="PAN" hint={form.pan && !PAN_RE.test(form.pan) ? "10 characters, for example ABCDE1234F" : undefined}>
                      <input className={`${inputClass} uppercase tracking-wide`} value={form.pan} maxLength={10} placeholder="ABCDE1234F" onChange={(e) => update("pan", e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Address">
                    <textarea rows={2} className={inputClass} value={form.address} maxLength={500} onChange={(e) => update("address", e.target.value)} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Email">
                      <input type="email" className={inputClass} value={form.email} maxLength={200} onChange={(e) => update("email", e.target.value)} />
                    </Field>
                    <Field label="Phone">
                      <input className={inputClass} value={form.phone} maxLength={20} onChange={(e) => update("phone", e.target.value)} />
                    </Field>
                    <Field label="Website">
                      <input className={inputClass} value={form.website} maxLength={200} onChange={(e) => update("website", e.target.value)} />
                    </Field>
                  </div>
                </section>
              )}

              {step === 2 && (
                <section className="space-y-5">
                  <div>
                    <h2 className="text-3xl font-bold tracking-tight text-navy">Billing</h2>
                    <p className="mt-1 text-sm text-slate-600">Watch the invoice on the right as you fill these in.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Invoice prefix" hint="{FY} becomes the financial year">
                      <input className={inputClass} value={form.invoice_prefix} maxLength={20} onChange={(e) => update("invoice_prefix", e.target.value)} />
                    </Field>
                    <Field label="Quotation prefix">
                      <input className={inputClass} value={form.quotation_prefix} maxLength={20} onChange={(e) => update("quotation_prefix", e.target.value)} />
                    </Field>
                    <Field label="Default GST %">
                      <input type="number" min={0} max={100} className={inputClass} value={form.default_gst_rate} onChange={(e) => update("default_gst_rate", e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Payment terms">
                    <input className={inputClass} value={form.payment_terms} maxLength={500} placeholder="Payable within 7 days" onChange={(e) => update("payment_terms", e.target.value)} />
                  </Field>
                  <div className="border-t border-slate-200 pt-5">
                    <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Wallet className="h-4 w-4 text-navy" /> Where clients pay you
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Bank name">
                        <input className={inputClass} value={form.bank_name} maxLength={100} onChange={(e) => update("bank_name", e.target.value)} />
                      </Field>
                      <Field label="Account number">
                        <input className={inputClass} value={form.bank_account_no} maxLength={18} onChange={(e) => update("bank_account_no", e.target.value)} />
                      </Field>
                      <Field label="IFSC">
                        <input className={`${inputClass} uppercase`} value={form.bank_ifsc} maxLength={11} onChange={(e) => update("bank_ifsc", e.target.value)} />
                      </Field>
                      <Field label="UPI ID" hint="Invoices carry a QR code for this UPI ID">
                        <input className={inputClass} value={form.upi_id} maxLength={100} onChange={(e) => update("upi_id", e.target.value)} />
                      </Field>
                    </div>
                    {bankChanged && (
                      <div className="ob-rise mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                        <Field
                          label="Confirm your password"
                          hint={
                            <span className="flex items-center gap-1 text-amber-800">
                              <Lock className="h-3 w-3" /> Changing bank details always needs a password, and other admins are told.
                            </span>
                          }
                        >
                          <input type="password" autoComplete="current-password" className={inputClass} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
                        </Field>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {step === 3 && (
                <section className="space-y-7">
                  <div>
                    <h2 className="text-3xl font-bold tracking-tight text-navy">Your practice</h2>
                    <p className="mt-1 text-sm text-slate-600">This tailors what Duesk shows you first. It doesn't limit anything.</p>
                  </div>
                  <div>
                    <p className="mb-2.5 text-sm font-semibold text-slate-900">Services you offer</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {SERVICES.map((s) => (
                        <Tick key={s} label={s} checked={services.includes(s)} onClick={() => setServices((l) => (l.includes(s) ? l.filter((x) => x !== s) : [...l, s]))} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2.5 text-sm font-semibold text-slate-900">Team size</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {TEAM_SIZES.map((t) => (
                        <Tick key={t} label={t} checked={teamSize === t} onClick={() => setTeamSize(t)} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2.5 text-sm font-semibold text-slate-900">How you track work today</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {TOOLS.map((t) => (
                        <Tick key={t.id} label={t.label} checked={currentTool === t.id} onClick={() => setCurrentTool(t.id)} />
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {step === 4 && (
                <section className="space-y-6">
                  <div>
                    <h2 className="text-3xl font-bold tracking-tight text-navy">Compare</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {tool && tool.app ? `Your work today, in a tool like ${tool.app}, next to the same month in Duesk.` : "One client's month in Duesk."}
                    </p>
                  </div>

                  {tool && tool.app && (
                    <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 text-sm">
                      {(["now", "duesk"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setCompareView(v)}
                          className={`rounded-md px-4 py-1.5 font-medium transition ${compareView === v ? "bg-navy text-white" : "text-slate-600 hover:text-navy"}`}
                        >
                          {v === "now" ? "How it's done now" : "With Duesk"}
                        </button>
                      ))}
                    </div>
                  )}

                  <div key={compareView} className="ob-rise">
                    {compareView === "now" && tool && tool.app ? (
                      <div className="space-y-3">
                        <NowWindow toolId={tool.id} />
                        <button
                          type="button"
                          onClick={() => setCompareView("duesk")}
                          className="group inline-flex items-center gap-1.5 text-sm font-semibold text-navy hover:underline"
                        >
                          Now see the same month in Duesk <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                        </button>
                      </div>
                    ) : (
                      <MonthPlayer />
                    )}
                  </div>

                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-navy text-left">
                        <th className="w-1/2 py-2 pr-4 font-semibold text-slate-500">How it&apos;s done now</th>
                        <th className="py-2 font-semibold text-navy">In Duesk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(BETTER[currentTool] || BETTER.none).map((row) => (
                        <tr key={row.now} className="border-b border-slate-200 align-top">
                          <td className="py-2.5 pr-4 text-slate-500">{row.now}</td>
                          <td className="py-2.5 text-slate-900">{row.duesk}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {step === LAST && (
                <section>
                  <h2 className="text-4xl font-bold leading-tight tracking-tight text-navy">{orgName} is set up</h2>
                  <p className="mt-3 max-w-md text-base text-slate-600">Your letterhead, numbering and bank details are saved. These next steps take a couple of minutes each.</p>
                  <ul className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
                    {NEXT_STEPS.map((n, i) => (
                      <li key={n.href} className="ob-rise" style={{ animationDelay: `${1.2 + i * 0.08}s` }}>
                        <button type="button" onClick={() => leave(n.href)} className="group flex w-full items-center gap-3 py-3 text-left">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-navy transition group-hover:border-navy">
                            <n.icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-slate-900">{n.title}</span>
                            <span className="block text-sm text-slate-500">{n.text}</span>
                          </span>
                          <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-navy" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => leave("/")}
                    className="ob-rise group mt-8 inline-flex items-center gap-2 rounded-lg bg-navy px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-light"
                    style={{ animationDelay: "1.6s" }}
                  >
                    Go to my dashboard and take the tour <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </button>
                </section>
              )}

              {/* Navigation for steps 1-4 */}
              {step >= 1 && step <= 4 && (
                <div className="mt-8 flex items-center gap-3 border-t border-slate-200 pt-5">
                  <button
                    type="button"
                    onClick={back}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400"
                  >
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  {error && (
                    <p key={error} role="alert" className="ob-pop flex min-w-0 items-start gap-1.5 text-sm text-rose-700">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span className="break-words">{error}</span>
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={next}
                    disabled={busy}
                    className="group ml-auto inline-flex items-center gap-2 rounded-lg bg-navy px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-60"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {step === 4 ? "Finish setup" : "Continue"}
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: the firm file */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          {loaded && <FirmSheet form={form} gstState={gstState} sampleNumber={sampleNumber} services={services} step={step} signatory={me?.name || ""} />}
        </div>
      </main>
    </div>
  );
}