"use client";

import { useEffect, useState } from "react";
import { AlertCircle, FileSignature, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { Modal } from "@/components/ui/Modal";

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

export default function EngagementSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt">
        <FileSignature className="h-4 w-4 text-navy" /> Engagement Terms
      </button>
      {open && <EngagementSettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function EngagementSettingsModal({ onClose }: { onClose: () => void }) {
  const [supabase] = useState(() => createClient());
  const [t, setT] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("engagement_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => setT(data || {}));
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    const payload = {
      signatory_name: String(t.signatory_name || "").trim() || null,
      signatory_designation: String(t.signatory_designation || "").trim() || null,
      firm_registration_no: String(t.firm_registration_no || "").trim() || null,
      membership_no: String(t.membership_no || "").trim() || null,
      termination_notice_days: Number(t.termination_notice_days || 30),
      jurisdiction: String(t.jurisdiction || "").trim() || null,
      standard_terms: String(t.standard_terms || "").trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = await supabase.from("engagement_settings").update(payload).eq("id", 1);
    setSaving(false);
    if (err) return setError(err.message);
    logAuditEvent("UPDATE_ENGAGEMENT_TERMS", "SETTINGS", undefined, { signatory: payload.signatory_name });
    onClose();
  }

  return (
    <Modal
      title="Engagement letter terms"
      subtitle="Used on every engagement letter. Have the standard clauses reviewed once by your legal adviser."
      onClose={() => !saving && onClose()}
      maxWidth="max-w-3xl"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving || !t} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </button>
        </div>
      }
    >
      {!t ? (
        <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
      ) : (
        <div className="space-y-3 text-xs">
          {error && (
            <p className="flex items-center gap-1.5 font-medium text-rose-600">
              <AlertCircle className="h-4 w-4" /> {error}
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Signatory name</label>
              <input value={t.signatory_name || ""} onChange={(e) => setT({ ...t, signatory_name: e.target.value })} className={inputClass} placeholder="CA Subhash Kumar" />
            </div>
            <div>
              <label className={labelClass}>Designation</label>
              <input value={t.signatory_designation || ""} onChange={(e) => setT({ ...t, signatory_designation: e.target.value })} className={inputClass} placeholder="Partner / Proprietor" />
            </div>
            <div>
              <label className={labelClass}>Membership no.</label>
              <input value={t.membership_no || ""} onChange={(e) => setT({ ...t, membership_no: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Firm registration no. (FRN)</label>
              <input value={t.firm_registration_no || ""} onChange={(e) => setT({ ...t, firm_registration_no: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Termination notice (days)</label>
              <input type="number" min={0} max={365} value={t.termination_notice_days ?? 30} onChange={(e) => setT({ ...t, termination_notice_days: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Jurisdiction (city)</label>
              <input value={t.jurisdiction || ""} onChange={(e) => setT({ ...t, jurisdiction: e.target.value })} className={inputClass} placeholder="New Delhi" />
            </div>
          </div>
          <div>
            <label className={labelClass}>Standard clauses (blank line between clauses)</label>
            <textarea rows={14} value={t.standard_terms || ""} onChange={(e) => setT({ ...t, standard_terms: e.target.value })} className={`${inputClass} font-mono text-xs`} />
          </div>
        </div>
      )}
    </Modal>
  );
}