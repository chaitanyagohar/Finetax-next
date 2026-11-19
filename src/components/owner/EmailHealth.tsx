"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Mail, Send, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, EmptyState, Pill, btn } from "@/components/ui/kit";

type Health = {
  platform_sender: { org_id: string | null; org_name: string | null; mailboxes: { address: string; active: boolean; last_sync_error: string | null }[] };
  firms: { org_id: string; name: string; mailboxes: number; sent_7d: number; failed_7d: number; last_error: string | null; last_error_at: string | null; last_sent_at: string | null }[];
};

const when = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

/** Owner: is email going out, for Duesk itself and for each firm. Counts and errors only. */
export default function EmailHealth() {
  const [supabase] = useState(() => createClient());
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState<"" | "test" | "sender">("");
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("platform_email_health");
    if (error) setMessage({ tone: "bad", text: error.message });
    else setHealth(data as Health);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function test() {
    setBusy("test");
    setMessage(null);
    const res = await fetch("/api/email/test", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setBusy("");
    setMessage(res.ok ? { tone: "good", text: `Sent from ${json.from} to ${json.to}. Check that inbox (and Spam).` } : { tone: "bad", text: json.error || "The test failed." });
    load();
  }

  async function useMine() {
    setBusy("sender");
    const res = await fetch("/api/owner/email-health", { method: "PATCH" });
    const json = await res.json().catch(() => ({}));
    setBusy("");
    setMessage(res.ok ? { tone: "good", text: "Duesk's emails now go from your workspace mailbox." } : { tone: "bad", text: json.error || "Could not save." });
    load();
  }

  const sender = health?.platform_sender;
  const senderOk = !!sender?.org_id && (sender.mailboxes || []).some((m) => m.active);

  return (
    <Card
      title="Email"
      icon={Mail}
      action={
        <button type="button" onClick={test} disabled={busy !== ""} className={btn.secondary}>
          {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send me a test email
        </button>
      }
      bodyClassName="p-0"
    >
      <div className="space-y-3 border-b border-border p-4 text-xs">
        {message && <p className={`rounded-lg px-3 py-2 font-medium ${message.tone === "good" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{message.text}</p>}
        {!health ? (
          <div className="skeleton h-10" />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 font-semibold text-text-main">
                {senderOk ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <TriangleAlert className="h-4 w-4 text-amber-600" />}
                Duesk&apos;s own emails (support requests, support access)
              </p>
              <p className="text-text-muted">
                {!sender?.org_id
                  ? "No sender chosen, so these emails are not sent."
                  : sender.mailboxes.length === 0
                    ? `${sender.org_name} has no mailbox connected, so these emails are not sent.`
                    : `From ${sender.mailboxes.map((m) => m.address).join(", ")} (${sender.org_name}).`}
              </p>
            </div>
            {!senderOk && (
              <button type="button" onClick={useMine} disabled={busy !== ""} className={btn.primary}>
                {busy === "sender" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Use my workspace mailbox
              </button>
            )}
          </div>
        )}
        <p className="text-[11px] text-text-muted">
          Sign-in emails (password reset, confirm email) are sent by Supabase, not by these mailboxes. They need custom SMTP set in Supabase → Authentication → Emails.
        </p>
      </div>
      {health &&
        (health.firms.length === 0 ? (
          <EmptyState title="No firms yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface-alt text-left text-[11px] uppercase tracking-wide text-text-muted">
                <tr>
                  {["Firm", "Mailboxes", "Sent, 7 days", "Failed, 7 days", "Last sent", "Last problem"].map((h) => (
                    <th key={h} className="px-4 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {health.firms.map((f) => (
                  <tr key={f.org_id}>
                    <td className="px-4 py-2 font-semibold text-text-main">{f.name}</td>
                    <td className="px-4 py-2">{f.mailboxes ? f.mailboxes : <Pill tone="warn">None</Pill>}</td>
                    <td className="px-4 py-2">{f.sent_7d}</td>
                    <td className="px-4 py-2">{f.failed_7d ? <Pill tone="bad">{f.failed_7d}</Pill> : "—"}</td>
                    <td className="px-4 py-2">{when(f.last_sent_at)}</td>
                    <td className="max-w-md px-4 py-2 text-text-muted">{f.last_error ? `${when(f.last_error_at)} · ${f.last_error}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </Card>
  );
}
