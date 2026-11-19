"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { formatDate } from "@/lib/format";

type Diag = {
  access_until: string;
  organization: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  mailboxes: { address: string; verified: boolean; last_synced_at: string | null; last_sync_error: string | null; active: boolean }[];
  payments: { mode: string; active: boolean; webhook: boolean; last_event_at: string | null; last_error: string | null } | null;
  members: { role: string; active: boolean; modules: unknown; joined_at: string }[];
  counts: Record<string, number>;
  recent_actions: { action: string; entity: string; at: string }[];
};

function Row({ label, value, bad }: { label: string; value: React.ReactNode; bad?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-text-muted">{label}</span>
      <span className={`text-right font-medium ${bad ? "text-rose-600" : "text-text-main"}`}>{value}</span>
    </div>
  );
}

/** Setup and error details for a firm that has turned on support access. No client records. */
export default function FirmDiagnostics({ orgId, firmName, onClose }: { orgId: string; firmName: string; onClose: () => void }) {
  const [supabase] = useState(() => createClient());
  const [data, setData] = useState<Diag | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.rpc("support_diagnostics", { p_org: orgId }).then(({ data: d, error: e }) => {
      if (e) setError(e.message);
      else setData(d as Diag);
    });
  }, [supabase, orgId]);

  const yes = (v: unknown) => (v ? <CheckCircle2 className="inline h-3.5 w-3.5 text-emerald-600" /> : "No");

  return (
    <Modal title={`Support view: ${firmName}`} subtitle="Setup and errors only. Client records stay private." onClose={onClose} maxWidth="max-w-3xl">
      {error ? (
        <p className="flex items-center gap-2 text-xs font-medium text-rose-600">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      ) : !data ? (
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      ) : (
        <div className="grid gap-5 text-xs md:grid-cols-2">
          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Firm</h3>
            <div className="divide-y divide-border rounded-lg border border-border px-3">
              <Row label="Access until" value={formatDate(data.access_until)} />
              <Row label="Status / plan" value={`${data.organization?.status} · ${data.organization?.plan}`} />
              <Row label="Setup finished" value={data.organization?.setup_completed_at ? formatDate(String(data.organization.setup_completed_at)) : "Not yet"} bad={!data.organization?.setup_completed_at} />
              <Row label="GSTIN set" value={yes(data.settings?.gstin_set)} bad={!data.settings?.gstin_set} />
              <Row label="UPI set" value={yes(data.settings?.upi_set)} />
              <Row label="Invoice numbering" value={String(data.settings?.invoice_prefix || "")} />
              {Object.entries(data.counts || {}).map(([k, v]) => (
                <Row key={k} label={k.replace(/_/g, " ")} value={v} />
              ))}
            </div>
          </section>
          <section className="space-y-4">
            <div>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Mailboxes</h3>
              <div className="divide-y divide-border rounded-lg border border-border px-3">
                {data.mailboxes.length === 0 ? (
                  <Row label="None connected" value="" bad />
                ) : (
                  data.mailboxes.map((m) => (
                    <div key={m.address} className="py-1.5">
                      <Row label={m.address} value={m.verified ? "Verified" : "Not verified"} bad={!m.verified} />
                      <p className="text-[11px] text-text-muted">Last sync {m.last_synced_at ? formatDate(m.last_synced_at) : "never"}</p>
                      {m.last_sync_error && <p className="text-[11px] text-rose-600">{m.last_sync_error}</p>}
                    </div>
                  ))
                )}
              </div>
            </div>
            <div>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Online payments</h3>
              <div className="divide-y divide-border rounded-lg border border-border px-3">
                {!data.payments ? (
                  <Row label="Razorpay" value="Not connected" />
                ) : (
                  <>
                    <Row label="Razorpay" value={`${data.payments.mode}${data.payments.active ? "" : " (off)"}`} />
                    <Row label="Webhook" value={yes(data.payments.webhook)} bad={!data.payments.webhook} />
                    <Row label="Last update" value={data.payments.last_event_at ? formatDate(data.payments.last_event_at) : "None yet"} />
                    {data.payments.last_error && <p className="py-1.5 text-[11px] text-rose-600">{data.payments.last_error}</p>}
                  </>
                )}
              </div>
            </div>
          </section>
          <section className="md:col-span-2">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Recent activity</h3>
            <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {data.recent_actions.map((a, i) => (
                <li key={i} className="flex justify-between px-3 py-1.5">
                  <span className="font-mono text-[11px]">
                    {a.entity} · {a.action}
                  </span>
                  <span className="text-text-muted">{formatDate(a.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  );
}
