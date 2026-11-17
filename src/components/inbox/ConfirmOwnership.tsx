"use client";

import { useState } from "react";
import { AlertCircle, Loader2, MailCheck } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

type Props = {
  account: { id: string; email_address: string };
  onClose: () => void;
  onConfirmed: () => void;
};

/** Confirms that the firm owns a mailbox address with a code Duesk emails to it. */
export default function ConfirmOwnership({ account, onClose, onConfirmed }: Props) {
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function call(action: "send" | "confirm"): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/email-accounts/ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account.id, action, code }),
      });
      const data: { error?: string; confirmed?: boolean } = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
      if (data.confirmed) onConfirmed();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    if (await call("send")) {
      setCode("");
      setCodeSent(true);
    }
  }

  return (
    <Modal
      title="Confirm this address"
      subtitle={account.email_address}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-text-muted transition hover:bg-surface-alt">
            Close
          </button>
          {codeSent ? (
            <button
              type="button"
              onClick={() => call("confirm")}
              disabled={busy || code.length !== 6}
              className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailCheck className="h-3.5 w-3.5" />} Confirm
            </button>
          ) : (
            <button
              type="button"
              onClick={sendCode}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailCheck className="h-3.5 w-3.5" />} Email me a code
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-3 text-xs text-text-main">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 font-medium text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {codeSent ? (
          <>
            <p>
              Duesk has emailed a six-digit code to <strong>{account.email_address}</strong>. Open that mailbox, then enter the code here. It is valid for 15 minutes.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              aria-label="Confirmation code"
              className="w-40 rounded-lg border border-border bg-surface px-3 py-2 text-center font-mono text-lg tracking-[0.3em] text-navy outline-none focus:border-navy"
            />
            <p className="text-text-muted">
              No email?{" "}
              <button type="button" onClick={sendCode} disabled={busy} className="font-semibold text-navy underline disabled:opacity-60">
                Send a new code
              </button>
            </p>
          </>
        ) : (
          <>
            <p>Sending from this mailbox and fetching its mail with Sync already work once the connection test passes.</p>
            <p>
              Mail forwarded to Duesk for this address is delivered only after your firm confirms it owns the address. Duesk emails a code to the address; whoever can read
              that mailbox enters it here.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
