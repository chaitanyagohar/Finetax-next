"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CreditCard, Loader2, LogOut, Upload } from "lucide-react";

/** Upload for one requested item, or a general "send us a document". */
export function PortalUpload({ itemId, label, compact = false }: { itemId?: string; label: string; compact?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");

  async function send(file: File) {
    setState("busy");
    setError("");
    const form = new FormData();
    form.append("file", file);
    if (itemId) form.append("itemId", itemId);
    const res = await fetch("/api/portal/upload", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState("idle");
      setError(json.error || "Upload failed. Please try again.");
      return;
    }
    setState("done");
    router.refresh();
  }

  return (
    <div className={compact ? "" : "w-full sm:w-auto"}>
      <input
        ref={input}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.xlsx,.xls,.docx,.doc,.csv,.zip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) send(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={state === "busy"}
        className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition disabled:opacity-60 sm:w-auto ${
          state === "done" ? "bg-emerald-50 text-emerald-700" : compact ? "border border-border bg-surface text-text-main hover:bg-surface-alt" : "bg-navy text-white hover:bg-navy-light"
        }`}
      >
        {state === "busy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
        {state === "done" ? "Received, thank you" : label}
      </button>
      {error && <p className="mt-1 text-[11px] font-medium text-rose-600">{error}</p>}
    </div>
  );
}

export function PayButton({ invoiceId }: { invoiceId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function pay() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/portal/invoices/${invoiceId}/pay`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.url) {
      setBusy(false);
      setError(json.error || "Online payment is not available right now.");
      return;
    }
    window.location.assign(json.url);
  }
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" onClick={pay} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-60">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />} Pay now
      </button>
      {error && <span className="mt-1 text-[10px] text-rose-600">{error}</span>}
    </span>
  );
}

export function PortalSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        setBusy(true);
        await fetch("/api/portal/logout", { method: "POST" });
        router.replace("/portal/login");
      }}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />} Sign out
    </button>
  );
}
