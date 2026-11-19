"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, CreditCard, ExternalLink, Loader2, Unplug } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "@/components/ui/Modal";
import PasswordInput from "@/components/ui/PasswordInput";
import { formatDate } from "@/lib/format";

type Gateway = {
  key_id: string;
  mode: "live" | "test";
  webhook_secret_id: string | null;
  connected_at: string;
  last_event_at: string | null;
  last_error: string | null;
};

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-main placeholder:text-text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

/** Settings → Payments: the firm connects its own Razorpay account. Admins only. */
export default function PaymentGateway({ orgId, onNotice }: { orgId: string; onNotice: (type: "success" | "error", message: string) => void }) {
  const [supabase] = useState(() => createClient());
  const [gateway, setGateway] = useState<Gateway | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");

  async function load() {
    const { data } = await supabase
      .from("payment_gateways")
      .select("key_id, mode, webhook_secret_id, connected_at, last_event_at, last_error")
      .maybeSingle();
    setGateway((data as Gateway) || null);
    setKeyId(data?.key_id || "");
    setLoading(false);
  }

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/webhooks/razorpay?firm=${orgId}`);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/payments/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId: keyId.trim(), keySecret, webhookSecret }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save.");
      setKeySecret("");
      setWebhookSecret("");
      setEditing(false);
      await load();
      onNotice("success", "Razorpay connected. Issued invoices can now carry a Pay online link.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    const res = await fetch("/api/payments/gateway", { method: "DELETE" });
    setBusy(false);
    setConfirmOff(false);
    if (!res.ok) return onNotice("error", "Could not disconnect Razorpay.");
    setGateway(null);
    setKeyId("");
    onNotice("success", "Razorpay disconnected.");
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => onNotice("success", "Copied."),
      () => onNotice("error", "Copy failed. Select the text and copy it."),
    );
  }

  const showForm = editing || (!gateway && !loading);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-border bg-surface-alt px-5 py-4">
        <div className="flex items-start gap-2">
          <CreditCard className="mt-0.5 h-4 w-4 text-navy" />
          <div>
            <h3 className="text-sm font-semibold text-text-main">Online payments</h3>
            <p className="text-[11px] text-text-muted">
              Connect your firm&apos;s Razorpay account. Clients pay by UPI, card or net banking, the money goes to your account and the payment is recorded on the invoice by itself.
            </p>
          </div>
        </div>
        {gateway && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              gateway.mode === "live" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {gateway.mode === "live" ? "Live" : "Test mode"}
          </span>
        )}
      </div>

      <div className="space-y-4 p-5 text-xs">
        {loading ? (
          <div className="flex items-center gap-2 text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {gateway && !editing && (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-alt p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-0.5">
                  <p className="flex items-center gap-1.5 font-semibold text-text-main">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Connected · <span className="font-mono">{gateway.key_id}</span>
                  </p>
                  <p className="text-[11px] text-text-muted">
                    Since {formatDate(gateway.connected_at)} ·{" "}
                    {gateway.webhook_secret_id
                      ? gateway.last_event_at
                        ? `last update from Razorpay ${formatDate(gateway.last_event_at)}`
                        : "waiting for the first update from Razorpay"
                      : "webhook not set up, so payments won't be recorded by themselves yet"}
                  </p>
                  {gateway.last_error && <p className="text-[11px] font-medium text-rose-600">{gateway.last_error}</p>}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-border px-3 py-1.5 font-semibold hover:bg-surface">
                    Change keys
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmOff(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-1.5 font-semibold text-rose-600 hover:bg-rose-50"
                  >
                    <Unplug className="h-3.5 w-3.5" /> Disconnect
                  </button>
                </div>
              </div>
            )}

            {showForm && (
              <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="rzp-key">Key ID</label>
                  <input id="rzp-key" value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="rzp_live_…" className={`${inputClass} font-mono`} autoComplete="off" required />
                </div>
                <div>
                  <label className={labelClass} htmlFor="rzp-secret">Key secret</label>
                  <PasswordInput
                    id="rzp-secret"
                    value={keySecret}
                    onChange={setKeySecret}
                    placeholder={gateway ? "Leave blank to keep the saved secret" : "Shown once in Razorpay when you create the key"}
                    autoComplete="new-password"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className={labelClass} htmlFor="rzp-webhook">Webhook secret</label>
                  <PasswordInput
                    id="rzp-webhook"
                    value={webhookSecret}
                    onChange={setWebhookSecret}
                    placeholder={gateway?.webhook_secret_id ? "Leave blank to keep the saved secret" : "Any long password you also type into Razorpay"}
                    autoComplete="new-password"
                  />
                </div>
                {error && <p className="md:col-span-2 text-[11px] font-medium text-rose-600">{error}</p>}
                <div className="flex gap-2 md:col-span-2">
                  <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 font-semibold text-white hover:bg-navy-light disabled:opacity-60">
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {gateway ? "Save keys" : "Check and connect"}
                  </button>
                  {editing && (
                    <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-border px-4 py-2 font-semibold hover:bg-surface-alt">
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            )}

            <details className="rounded-lg border border-border p-4" open={!gateway}>
              <summary className="cursor-pointer font-semibold text-text-main">How to set it up (5 minutes)</summary>
              <ol className="mt-3 list-decimal space-y-2 pl-4 text-text-muted">
                <li>
                  In the Razorpay dashboard, open <strong>Account &amp; Settings → API keys</strong> and generate a key. Paste the key ID and key secret above.
                </li>
                <li>
                  Open <strong>Account &amp; Settings → Webhooks → Add new webhook</strong> and use this URL:
                  <span className="mt-1 flex items-center gap-2">
                    <code className="break-all rounded bg-surface-alt px-2 py-1 font-mono text-[11px] text-text-main">{webhookUrl}</code>
                    <button type="button" onClick={() => copy(webhookUrl)} className="rounded-md p-1 hover:bg-surface-alt" aria-label="Copy webhook URL">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </li>
                <li>
                  Choose a secret there, tick the events <strong>payment_link.paid</strong>, <strong>payment_link.cancelled</strong> and <strong>payment_link.expired</strong>, and type the same secret above as the webhook secret.
                </li>
                <li>Use test keys first if you like: issue an invoice, open its Pay online link and pay with Razorpay&apos;s test UPI ID. The payment appears on the invoice within seconds.</li>
              </ol>
              <a href="https://dashboard.razorpay.com/app/website-app-settings/api-keys" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 font-semibold text-navy hover:underline">
                Open Razorpay dashboard <ExternalLink className="h-3 w-3" />
              </a>
            </details>
          </>
        )}
      </div>

      {confirmOff && (
        <ConfirmDialog
        title="Disconnect Razorpay?"
        message="New invoices won't carry a Pay online link. Links already sent stop updating Duesk, so record those payments by hand."
        confirmLabel="Disconnect"
        loading={busy}
        onConfirm={disconnect}
          onCancel={() => setConfirmOff(false)}
        />
      )}
    </section>
  );
}
