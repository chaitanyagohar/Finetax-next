"use client";

import { useCallback, useEffect, useState } from "react";
import { DatabaseBackup, Download, LifeBuoy, Loader2, ShieldOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { btn, field } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";

type Grant = { id: string; expires_at: string; reason: string | null; created_at: string };

/** Admins: export all firm data, and let Duesk support see the firm's setup for a limited time. */
export default function DataAndSupport({ onNotice }: { onNotice: (type: "success" | "error", message: string) => void }) {
  const [supabase] = useState(() => createClient());
  const [exporting, setExporting] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [grant, setGrant] = useState<Grant | null>(null);
  const [hours, setHours] = useState("24");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("support_access_grants")
      .select("id, expires_at, reason, created_at")
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setGrant((data as Grant) || null);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function exportAll(e: React.FormEvent) {
    e.preventDefault();
    setExporting(true);
    try {
      const res = await fetch("/api/admin/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminPassword: exportPassword }) });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Export failed.");
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "duesk-export.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onNotice("success", "Export downloaded.");
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
      setExportPassword("");
    }
  }

  async function allow(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/admin/support-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours: Number(hours), reason: reason.trim() }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return onNotice("error", json.error || "Could not give access.");
    setReason("");
    onNotice("success", "Duesk support can now see your setup until the time shown. Duesk has been told.");
    load();
  }

  async function revoke() {
    if (!grant) return;
    setBusy(true);
    const { error } = await supabase.from("support_access_grants").update({ revoked_at: new Date().toISOString() }).eq("id", grant.id);
    setBusy(false);
    if (error) return onNotice("error", error.message);
    setGrant(null);
    onNotice("success", "Support access ended.");
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-start gap-2 border-b border-border bg-surface-alt px-5 py-4">
        <DatabaseBackup className="mt-0.5 h-4 w-4 text-navy" />
        <div>
          <h3 className="text-sm font-semibold text-text-main">Your data and support</h3>
          <p className="text-[11px] text-text-muted">Your firm&apos;s data belongs to you. Take a full copy any time, and decide when Duesk support may look at your setup.</p>
        </div>
      </div>
      <div className="grid gap-6 p-5 text-xs md:grid-cols-2">
        <div className="space-y-2">
          <p className="font-semibold text-text-main">Export everything</p>
          <p className="text-text-muted">Clients, enquiries, quotations, invoices, payments, tasks, checklists, time and discussions as spreadsheet (CSV) files in one ZIP.</p>
          <form onSubmit={exportAll} className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              required
              autoComplete="current-password"
              value={exportPassword}
              onChange={(e) => setExportPassword(e.target.value)}
              placeholder="Your password"
              aria-label="Your password"
              className={`${field.input} max-w-48`}
            />
            <button type="submit" disabled={exporting || !exportPassword} className={btn.secondary}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download export
            </button>
          </form>
        </div>
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 font-semibold text-text-main">
            <LifeBuoy className="h-4 w-4 text-text-muted" /> Support access
          </p>
          {grant ? (
            <div className="space-y-2">
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                Duesk support can see your setup (settings, mailbox and payment status, error messages, recent activity) until {formatDate(grant.expires_at)}{" "}
                {new Date(grant.expires_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}. Client records are never shown.
              </p>
              <button type="button" onClick={revoke} disabled={busy} className={btn.danger}>
                <ShieldOff className="h-3.5 w-3.5" /> End access now
              </button>
            </div>
          ) : (
            <form onSubmit={allow} className="space-y-2">
              <p className="text-text-muted">Off. When you ask for help, allow it here for a short time. Client records are never shown to support.</p>
              <div className="flex gap-2">
                <select aria-label="How long" value={hours} onChange={(e) => setHours(e.target.value)} className={`${field.input} w-36 text-xs`}>
                  <option value="24">For 24 hours</option>
                  <option value="72">For 3 days</option>
                  <option value="168">For 7 days</option>
                </select>
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="What do you need help with?" className={`${field.input} text-xs`} />
              </div>
              <button type="submit" disabled={busy} className={btn.secondary}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Allow support access
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
