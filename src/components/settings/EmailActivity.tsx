"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MailCheck, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, EmptyState, Pill, btn } from "@/components/ui/kit";

type Row = { id: string; kind: string; from_address: string | null; recipients: string[]; subject: string | null; status: string; error: string | null; created_at: string };

const KIND: Record<string, string> = {
  invoice: "Invoice",
  payment_reminder: "Payment reminder",
  quotation: "Quotation",
  engagement: "Engagement letter",
  invitation: "Team invitation",
  portal_invite: "Portal invitation",
  portal_sign_in: "Portal sign-in",
  compose: "Email from Inbox",
  morning_email: "Morning email",
  security_alert: "Security alert",
  mailbox_code: "Mailbox code",
  support: "Support",
  test: "Test",
  other: "Other",
};

/** Admins: what Duesk sent from the firm's mailbox recently, and why anything failed. */
export default function EmailActivity({ onNotice }: { onNotice: (type: "success" | "error", message: string) => void }) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("email_log").select("*").order("created_at", { ascending: false }).limit(30);
    setRows((data || []) as Row[]);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function test() {
    setBusy(true);
    const res = await fetch("/api/email/test", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) onNotice("success", `Test sent from ${json.from} to ${json.to}. Check that inbox, and Spam.`);
    else onNotice("error", json.error || "The test email failed.");
    load();
  }

  const failed = (rows || []).filter((r) => r.status === "failed").length;

  return (
    <Card
      title="Email activity"
      icon={MailCheck}
      action={
        <button type="button" onClick={test} disabled={busy} className={btn.secondary}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send me a test email
        </button>
      }
      bodyClassName="p-0"
    >
      <p className="border-b border-border px-4 py-2.5 text-[11px] text-text-muted">
        Every email Duesk sends goes from your connected mailbox. {failed > 0 ? `${failed} of the last ${rows?.length} failed; the reason is shown.` : "The last 30 are listed here."}
      </p>
      {rows === null ? (
        <div className="skeleton m-4 h-16" />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing sent yet" hint="Send a test email to check your mailbox works." />
      ) : (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto text-xs">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-text-main">{r.subject || KIND[r.kind] || r.kind}</span>
                <span className="block truncate text-text-muted">
                  {KIND[r.kind] || r.kind}
                  {r.recipients.length > 0 && ` · to ${r.recipients.join(", ")}`}
                </span>
                {r.error && <span className="block text-rose-600">{r.error}</span>}
              </span>
              <span className="shrink-0 text-right">
                <Pill tone={r.status === "sent" ? "good" : "bad"}>{r.status === "sent" ? "Sent" : "Failed"}</Pill>
                <span className="mt-0.5 block text-[10px] text-text-muted">{new Date(r.created_at).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
