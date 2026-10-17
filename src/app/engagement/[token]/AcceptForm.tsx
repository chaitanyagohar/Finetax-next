"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AcceptForm({ token, clientOrg, firmName, expiresAt }: { token: string; clientOrg: string; firmName: string; expiresAt: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"accept" | "decline">("accept");
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "accept") {
      if (name.trim().length < 2) return setError("Please enter your full name.");
      if (!agree) return setError("Please tick the box to confirm you agree to the terms.");
    }
    setBusy(true);
    const res = await fetch(`/api/engagement/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode === "accept" ? { action: "accept", name, designation, agree } : { action: "decline", reason }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(out.error || "Something went wrong. Please try again.");
    router.refresh();
  }

  const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#10233f] focus:ring-2 focus:ring-[#10233f]/15";

  return (
    <form onSubmit={submit} className="space-y-4">
      {mode === "accept" ? (
        <>
          <div>
            <p className="text-base font-bold text-[#10233f]">Accept this engagement</p>
            <p className="text-xs text-slate-500">Please read the full letter before accepting.{expiresAt ? ` This proposal is valid until ${expiresAt}.` : ""}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Your full name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={input} maxLength={120} autoComplete="name" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Designation</label>
              <input value={designation} onChange={(e) => setDesignation(e.target.value)} className={input} maxLength={120} placeholder="Director / Proprietor / Partner" />
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#10233f]" />
            <span>
              I have read the engagement letter and, on behalf of <strong>{clientOrg}</strong>, I agree to engage {firmName || "the firm"} on these terms. I'm authorised to accept for{" "}
              {clientOrg}.
            </span>
          </label>
          {error && <p className="rounded-lg bg-rose-50 p-2 text-sm font-medium text-rose-700">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={() => setMode("decline")} className="text-sm text-slate-500 underline">
              I don't want to proceed
            </button>
            <button type="submit" disabled={busy} className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
              {busy ? "Confirming..." : "Accept engagement"}
            </button>
          </div>
          <p className="text-[11px] text-slate-400">Your name, the date and time, and your device's IP address are recorded as confirmation of acceptance.</p>
        </>
      ) : (
        <>
          <p className="text-base font-bold text-[#10233f]">Decline this proposal</p>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Reason (optional, helps us improve)</label>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={input} maxLength={500} />
          </div>
          {error && <p className="rounded-lg bg-rose-50 p-2 text-sm font-medium text-rose-700">{error}</p>}
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setMode("accept")} className="text-sm text-slate-500 underline">
              Back
            </button>
            <button type="submit" disabled={busy} className="rounded-lg bg-rose-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60">
              {busy ? "Sending..." : "Decline proposal"}
            </button>
          </div>
        </>
      )}
    </form>
  );
}