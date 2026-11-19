"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Globe2, Loader2, MailCheck, UserMinus, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { btn, field } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";

type PortalUser = { id: string; email: string; name: string | null; is_active: boolean; last_login_at: string | null; created_at: string };

/** Who can sign in to the client portal for one client. */
export default function PortalAccess({
  clientId,
  clientName,
  defaultEmail,
  onClose,
}: {
  clientId: string;
  clientName: string;
  defaultEmail?: string | null;
  onClose: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [users, setUsers] = useState<PortalUser[] | null>(null);
  const [email, setEmail] = useState(defaultEmail || "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; emailed: boolean } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("client_portal_users")
      .select("id, email, name, is_active, last_login_at, created_at")
      .eq("client_id", clientId)
      .order("created_at");
    setUsers((data || []) as PortalUser[]);
  }, [supabase, clientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function invite(e: React.SyntheticEvent, again?: PortalUser) {
    e.preventDefault();
    setError("");
    setLink(null);
    setBusy(again ? again.id : "new");
    const res = await fetch("/api/portal/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, email: again ? again.email : email, name: again ? again.name : name }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(json.error || "Could not give access.");
    setLink({ url: json.url, emailed: !!json.emailed });
    if (!again) {
      setEmail("");
      setName("");
    }
    load();
  }

  async function revoke(u: PortalUser) {
    setBusy(u.id);
    const res = await fetch("/api/portal/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portalUserId: u.id }),
    });
    setBusy(null);
    if (!res.ok) return setError("Could not turn access off.");
    load();
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
    } catch {
      window.prompt("Copy the sign-in link", link.url);
    }
  }

  return (
    <Modal title={`Client portal for ${clientName}`} subtitle="Contacts you add can upload requested documents, follow their filings and pay invoices." onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-5 text-xs">
        <form onSubmit={(e) => invite(e)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label className={field.label} htmlFor="portal-name">Name</label>
            <input id="portal-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Contact person" className={field.input} />
          </div>
          <div>
            <label className={field.label} htmlFor="portal-mail">Email</label>
            <input id="portal-mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" className={field.input} />
          </div>
          <button type="submit" disabled={busy === "new"} className={btn.primary}>
            {busy === "new" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Give access
          </button>
        </form>

        {link && (
          <div className="animate-pop-in rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
            <p className="flex items-center gap-1.5 font-semibold">
              <MailCheck className="h-4 w-4" /> {link.emailed ? "Invitation emailed." : "Access given. The email could not be sent from your mailbox, so share this link yourself."}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-white/70 px-2 py-1 font-mono text-[11px]">{link.url}</code>
              <button type="button" onClick={copy} className="rounded-md p-1.5 hover:bg-white" aria-label="Copy link">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-emerald-700">Works once within 7 days. After that they sign in with their email at /portal/login.</p>
          </div>
        )}
        {error && <p className="font-medium text-rose-600">{error}</p>}

        <div>
          <p className="mb-2 flex items-center gap-1.5 font-semibold text-text-main">
            <Globe2 className="h-4 w-4 text-text-muted" /> People with access
          </p>
          {users === null ? (
            <div className="skeleton h-12" />
          ) : users.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-text-muted">Nobody yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {users.map((u) => (
                <li key={u.id} className={`flex items-center gap-3 px-3 py-2.5 ${u.is_active ? "" : "opacity-60"}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-text-main">{u.name || u.email}</span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {u.name ? `${u.email} · ` : ""}
                      {!u.is_active ? "access off" : u.last_login_at ? `last signed in ${formatDate(u.last_login_at)}` : "hasn't signed in yet"}
                    </span>
                  </span>
                  <button type="button" onClick={(e) => invite(e, u)} disabled={busy === u.id} className={btn.ghost}>
                    {u.is_active ? "Send new link" : "Turn back on"}
                  </button>
                  {u.is_active && (
                    <button type="button" onClick={() => revoke(u)} disabled={busy === u.id} className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50" aria-label={`Turn off access for ${u.email}`}>
                      <UserMinus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
