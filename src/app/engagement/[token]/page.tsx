import type { Metadata } from "next";
import { getAdminClient } from "@/lib/api/guard";
import { verifyProposalToken } from "@/lib/publicLinks";
import AcceptForm from "./AcceptForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Engagement Letter", robots: { index: false, follow: false } };

const inr = (n: unknown) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (v?: string | null) => (v ? String(v).slice(0, 10).split("-").reverse().join("/") : "-");
const per = (c: string) => ({ Monthly: "month", Quarterly: "quarter", "Half-Yearly": "half-year", Yearly: "year" } as Record<string, string>)[c] || "month";

function Shell({ firmName, children }: { firmName?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="bg-[#10233f] px-6 py-5 text-white sm:px-8">
          <p className="text-lg font-bold tracking-wide">{(firmName || "Engagement Letter").toUpperCase()}</p>
          <p className="text-xs text-slate-300">Secure engagement letter</p>
        </div>
        <div className="p-6 sm:p-8">{children}</div>
      </div>
      <p className="mt-4 text-center text-[11px] text-slate-500">This page is private to you. Please don't forward the link.</p>
    </div>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="py-6 text-center">
      <p className="text-lg font-bold text-[#10233f]">{title}</p>
      <p className="mt-2 text-sm text-slate-600">{text}</p>
    </div>
  );
}

export default async function EngagementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = verifyProposalToken(token);
  if (!id) {
    return (
      <Shell>
        <Notice title="This link isn't valid" text="Please check the link in your email, or contact the firm for a new one." />
      </Shell>
    );
  }

  const admin = getAdminClient();
  const { data: p } = await admin.from("proposals").select("*").eq("id", id).maybeSingle();
  if (!p) {
    return (
      <Shell>
        <Notice title="Engagement letter not found" text="Please contact the firm for a new link." />
      </Shell>
    );
  }

  const [{ data: client }, { data: pkg }, { data: firm }] = await Promise.all([
    admin.from("clients").select("name, organization_name").eq("id", p.client_id).maybeSingle(),
    admin.from("service_packages").select("name").eq("id", p.package_id).maybeSingle(),
    admin.from("firm_settings").select("firm_name, email, phone").eq("id", 1).maybeSingle(),
  ]);

  if (p.status === "Sent") await admin.rpc("mark_proposal_viewed", { p_id: id });

  const firmName = firm?.firm_name || "";
  const clientOrg = client?.organization_name || client?.name || "your organisation";
  const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const expired = ["Sent", "Viewed", "Draft"].includes(p.status) && p.expires_at && p.expires_at < todayIST;
  const services: any[] = Array.isArray(p.services) ? p.services : [];
  const pdfHref = `/engagement/${token}/pdf`;
  const contact = [firm?.email, firm?.phone].filter(Boolean).join(" · ");

  return (
    <Shell firmName={firmName}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Engagement letter {p.number}</p>
          <h1 className="mt-1 text-xl font-bold text-[#10233f]">{pkg?.name || "Professional services"}</h1>
          <p className="text-sm text-slate-600">For {clientOrg} · starting {dmy(p.start_date)}</p>
        </div>
        <a href={pdfHref} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-[#10233f] hover:bg-slate-50">
          View full letter (PDF)
        </a>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-[11px] font-semibold uppercase text-slate-500">Professional fee</p>
          <p className="text-lg font-bold text-[#10233f]">
            {inr(p.price)} <span className="text-sm font-medium text-slate-500">per {per(p.billing_cycle)} + GST {Number(p.gst_rate)}%</span>
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p className="text-[11px] font-semibold uppercase text-slate-500">Billing</p>
          <p>
            Billed on the {p.bill_day}th of the following month · due in {p.due_days} days
          </p>
          {Number(p.late_fee_percent) > 0 && (
            <p className="text-xs text-slate-500">
              Late payment: {Number(p.late_fee_percent)}% per month (min {inr(p.late_fee_min)})
            </p>
          )}
        </div>
      </div>

      {services.length > 0 && (
        <div className="mt-6">
          <p className="text-sm font-bold text-[#10233f]">Services included</p>
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {services.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="text-slate-800">{s.title}</span>
                <span className="shrink-0 text-xs text-slate-500">{!s.recurrence || s.recurrence === "None" ? "One-time" : s.recurrence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.exclusions && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Not included</p>
          <p className="mt-1 whitespace-pre-line">{p.exclusions}</p>
        </div>
      )}

      <div className="mt-8 border-t border-slate-200 pt-6">
        {p.status === "Accepted" ? (
          <Notice title="Thank you, this engagement is accepted" text={`Accepted by ${p.accepted_name} on ${dmy(p.accepted_at)}. A confirmation with the signed letter has been emailed to you.`} />
        ) : p.status === "Declined" ? (
          <Notice title="This proposal was declined" text={`If you'd like to reconsider, please contact us${contact ? `: ${contact}` : "."}`} />
        ) : p.status === "Withdrawn" ? (
          <Notice title="This proposal has been withdrawn" text={`Please contact us for an updated letter${contact ? `: ${contact}` : "."}`} />
        ) : expired ? (
          <Notice title="This proposal has expired" text={`It was valid until ${dmy(p.expires_at)}. Please contact us for an updated letter${contact ? `: ${contact}` : "."}`} />
        ) : (
          <AcceptForm token={token} clientOrg={clientOrg} firmName={firmName} expiresAt={p.expires_at ? dmy(p.expires_at) : null} />
        )}
      </div>
    </Shell>
  );
}