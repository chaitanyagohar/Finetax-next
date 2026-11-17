"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { Modal } from "@/components/ui/Modal";

const INBOX_MODULE = "dashboard";

type Member = {
  id: string;
  name: string;
  designation: string | null;
  role: string;
  is_active: boolean;
  invite_pending: boolean;
  module_access: unknown;
};

type Props = {
  account: { id: string; email_address: string };
  onClose: () => void;
};

/** Lets an administrator choose which staff can read and send from one mailbox. */
export default function MailboxAccess({ account, onClose }: Props) {
  const [supabase] = useState(() => createClient());
  const [staff, setStaff] = useState<Member[]>([]);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [members, access] = await Promise.all([
        supabase.rpc("firm_members"),
        supabase.from("email_account_members").select("user_id").eq("account_id", account.id),
      ]);
      if (cancelled) return;
      if (members.error || access.error) {
        setError("Could not load who has access. Close this and try again.");
      } else {
        const people = (members.data || []) as Member[];
        setStaff(people.filter((m) => m.is_active && !m.invite_pending && m.role !== "admin"));
        setAllowed(new Set((access.data || []).map((row: { user_id: string }) => row.user_id)));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, account.id]);

  async function toggle(member: Member) {
    const grant = !allowed.has(member.id);
    setSavingId(member.id);
    setError("");
    const { error: saveError } = grant
      ? await supabase.from("email_account_members").insert({ account_id: account.id, user_id: member.id })
      : await supabase.from("email_account_members").delete().eq("account_id", account.id).eq("user_id", member.id);
    setSavingId(null);
    if (saveError) return setError(saveError.message);

    logAuditEvent(grant ? "GRANT_MAILBOX_ACCESS" : "REMOVE_MAILBOX_ACCESS", "EMAIL_ACCOUNTS", account.id, {
      email: account.email_address,
      member: member.name,
    });
    setAllowed((current) => {
      const next = new Set(current);
      if (grant) next.add(member.id);
      else next.delete(member.id);
      return next;
    });
  }

  const hasInboxModule = (member: Member) => Array.isArray(member.module_access) && member.module_access.includes(INBOX_MODULE);

  return (
    <Modal title="Who can use this mailbox" subtitle={account.email_address} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3 text-xs">
        <p className="text-text-muted">
          Administrators can always read and send from every mailbox. Other staff see a mailbox, and its emails, only when it is shared with them here.
        </p>
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 font-medium text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {loading ? (
          <p className="flex items-center gap-2 py-4 text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading staff
          </p>
        ) : staff.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-text-muted">Your firm has no staff other than administrators.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {staff.map((member) => (
              <li key={member.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allowed.has(member.id)}
                    disabled={savingId === member.id}
                    onChange={() => toggle(member)}
                    className="h-4 w-4 rounded border-border accent-navy"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-navy">{member.name}</span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {member.designation || "Staff"}
                      {allowed.has(member.id) && !hasInboxModule(member) ? " · also needs the Firm inbox module (Team page)" : ""}
                    </span>
                  </span>
                  {savingId === member.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
