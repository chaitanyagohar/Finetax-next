"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Invitation = {
  org_id: string;
  org_name: string;
  role: string;
  invited_by_name: string | null;
};

const ROLE_LABELS: Record<string, string> = { admin: "an administrator", reviewer: "a reviewer", staff: "a staff member" };

/** Invitations from other firms to the signed-in person. A firm gets access to nothing until one is accepted. */
export default function PendingInvitations() {
  const [supabase] = useState(() => createClient());
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [joined, setJoined] = useState<Invitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("my_invitations").then(({ data }) => {
      if (!cancelled) setInvitations((data || []) as Invitation[]);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function respond(invitation: Invitation, accept: boolean) {
    setBusy(true);
    setError("");
    const { error: rpcError } = await supabase.rpc("respond_to_invitation", { p_org: invitation.org_id, p_accept: accept });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);
    setInvitations((list) => list.filter((i) => i.org_id !== invitation.org_id));
    if (accept) setJoined(invitation);
  }

  async function openFirm(invitation: Invitation) {
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("set_active_org", { p_org: invitation.org_id });
    if (rpcError) {
      setBusy(false);
      return setError(rpcError.message);
    }
    window.location.href = "/"; // reload so every page shows the new firm
  }

  const invitation = invitations[0];
  if (!invitation && !joined) return null;

  return (
    <div
      role="status"
      className="fixed left-1/2 top-4 z-[60] w-[min(92vw,560px)] -translate-x-1/2 rounded-lg border border-border bg-surface px-4 py-3 text-xs text-text-main shadow-lg"
    >
      {joined ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            You have joined <strong>{joined.org_name}</strong>. You can switch between your firms from the menu at the top right.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setJoined(null)} className="rounded-lg border border-border px-3 py-1.5 font-semibold text-text-muted transition hover:bg-surface-alt">
              Later
            </button>
            <button
              type="button"
              onClick={() => openFirm(joined)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Open {joined.org_name}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1">
            {invitation.invited_by_name || "An administrator"} has invited you to join <strong>{invitation.org_name}</strong> as{" "}
            {ROLE_LABELS[invitation.role] || "a staff member"}. The firm sees nothing of yours unless you accept.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => respond(invitation, false)}
              disabled={busy}
              className="rounded-lg border border-border px-3 py-1.5 font-semibold text-text-muted transition hover:bg-surface-alt disabled:opacity-60"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => respond(invitation, true)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Accept
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
