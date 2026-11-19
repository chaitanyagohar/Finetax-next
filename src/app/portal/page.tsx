import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, CheckCircle2, CircleDot, Download, FileText, FolderOpen, Hourglass, Mail, Phone, Receipt, ShieldCheck, UploadCloud } from "lucide-react";
import { getAdminClient } from "@/lib/api/guard";
import { getPortalSession } from "@/lib/portal/session";
import { PayButton, PortalSignOut, PortalUpload } from "@/components/portal/PortalActions";
import { formatDate, formatINR } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client portal" };

const STAGE_FOR_CLIENT: Record<string, { label: string; tone: string; icon: typeof CircleDot }> = {
  Assigned: { label: "Not started", tone: "bg-stone-100 text-stone-600", icon: CircleDot },
  "In Progress": { label: "In progress", tone: "bg-sky-50 text-sky-700", icon: Hourglass },
  "Changes Required": { label: "In progress", tone: "bg-sky-50 text-sky-700", icon: Hourglass },
  "Submitted for Review": { label: "Final review", tone: "bg-violet-50 text-violet-700", icon: ShieldCheck },
  Approved: { label: "Completed", tone: "bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
};

type Request = { id: string; label: string; task_id: string; tasks: { title: string; period: string | null; official_due_date: string | null } };

/** Everything one client can see. Read on the server with the client's id; nothing here is queried from the browser. */
export default async function PortalHome() {
  const s = await getPortalSession();
  if (!s) redirect("/portal/login");

  const admin = getAdminClient();
  const since = new Date(Date.now() - 180 * 86400_000).toISOString();
  const [invoicesRes, requestsRes, tasksRes, docsRes, firmRes, gatewayRes] = await Promise.all([
    admin
      .from("invoices")
      .select("id, invoice_number, date, due_date, total, amount_paid, status")
      .eq("org_id", s.orgId)
      .eq("client_id", s.clientId)
      .not("status", "in", "(Draft,Cancelled)")
      .order("date", { ascending: false })
      .limit(40),
    admin
      .from("task_checklist_items")
      .select("id, label, task_id, tasks!inner(title, period, official_due_date, client_id, stage)")
      .eq("org_id", s.orgId)
      .eq("status", "pending")
      .eq("kind", "document")
      .eq("tasks.client_id", s.clientId)
      .neq("tasks.stage", "Approved")
      .order("created_at")
      .limit(60),
    admin
      .from("tasks")
      .select("id, title, period, stage, official_due_date, stage_changed_at")
      .eq("org_id", s.orgId)
      .eq("client_id", s.clientId)
      .or(`stage.neq.Approved,stage_changed_at.gte.${since}`)
      .order("official_due_date", { ascending: true, nullsFirst: false })
      .limit(60),
    admin
      .from("documents")
      .select("id, title, file_name, category, created_at, from_client")
      .eq("org_id", s.orgId)
      .eq("client_id", s.clientId)
      .eq("shared_with_client", true)
      .order("created_at", { ascending: false })
      .limit(40),
    admin.from("firm_settings").select("firm_name, email, phone, logo_url, brand_color").eq("org_id", s.orgId).maybeSingle(),
    admin.from("payment_gateways").select("is_active, key_secret_id").eq("org_id", s.orgId).maybeSingle(),
  ]);

  const invoices = invoicesRes.data || [];
  const requests = ((requestsRes.data || []) as unknown as (Omit<Request, "tasks"> & { tasks: Request["tasks"] | Request["tasks"][] })[]).map((r) => ({
    ...r,
    tasks: Array.isArray(r.tasks) ? r.tasks[0] : r.tasks,
  }));
  const tasks = tasksRes.data || [];
  const docs = docsRes.data || [];
  const firm = firmRes.data;
  const canPayOnline = !!gatewayRes.data?.is_active && !!gatewayRes.data?.key_secret_id;
  const balanceOf = (i: { total: number | null; amount_paid: number | null }) => Math.max(0, Number(i.total || 0) - Number(i.amount_paid || 0));
  const due = invoices.reduce((sum, i) => sum + balanceOf(i), 0);
  const openFilings = tasks.filter((t) => t.stage !== "Approved");
  const firstName = (s.name || "").split(" ")[0];

  return (
    <div className="min-h-screen bg-background">
      <header
        className="relative overflow-hidden bg-navy text-white"
        style={firm?.brand_color && /^#[0-9a-fA-F]{6}$/.test(firm.brand_color) ? { backgroundColor: firm.brand_color } : undefined}
      >
        <div className="sidebar-glow pointer-events-none absolute inset-0" aria-hidden />
        <svg className="decor-spin pointer-events-none absolute -right-24 -top-24 h-80 w-80 opacity-40" viewBox="0 0 200 200" fill="none" aria-hidden>
          <circle cx="100" cy="100" r="60" stroke="#f2613f" strokeOpacity=".6" />
          <circle cx="100" cy="100" r="88" stroke="#f2613f" strokeOpacity=".25" strokeDasharray="3 8" />
          <circle cx="160" cy="100" r="5" fill="#f2613f" />
        </svg>
        <div className="relative mx-auto max-w-5xl px-5 pb-10 pt-6 sm:px-8">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              {firm?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={firm.logo_url} alt="" className="h-9 w-9 rounded-lg bg-white object-contain p-0.5" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm">{s.firmName.slice(0, 1).toUpperCase()}</span>
              )}
              {s.firmName}
            </p>
            <PortalSignOut />
          </div>
          <h1 className="mt-10 text-2xl font-semibold tracking-tight sm:text-3xl">{firstName ? `Hello, ${firstName}` : "Welcome"}</h1>
          <p className="mt-1 text-sm text-white/70">{s.clientName}</p>
          <div className="mt-8 grid grid-cols-3 gap-3 sm:max-w-xl">
            {[
              { label: "Documents to send", value: String(requests.length), hot: requests.length > 0 },
              { label: "Work in progress", value: String(openFilings.length), hot: false },
              { label: "Amount due", value: formatINR(due), hot: due > 0 },
            ].map((k) => (
              <div key={k.label} className="rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/10 backdrop-blur">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/50">{k.label}</p>
                <p className={`mt-1 text-lg font-semibold tabular-nums ${k.hot ? "text-[#ffb59f]" : "text-white"}`}>{k.value}</p>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto -mt-4 max-w-5xl space-y-6 px-5 pb-16 sm:px-8">
        <section className="animate-page-in overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-text-main">
                <UploadCloud className="h-4 w-4 text-accent" /> Documents we need from you
              </h2>
              <p className="text-xs text-text-muted">Take a photo or pick a file. It reaches your team straight away.</p>
            </div>
            <PortalUpload label="Send another document" compact />
          </div>
          {requests.length === 0 ? (
            <p className="flex items-center gap-2 px-5 py-6 text-sm text-text-muted">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Nothing pending. Thank you.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-main">{r.label}</p>
                    <p className="text-[11px] text-text-muted">
                      For {r.tasks?.title}
                      {r.tasks?.period ? ` · ${r.tasks.period}` : ""}
                      {r.tasks?.official_due_date ? ` · due ${formatDate(r.tasks.official_due_date)}` : ""}
                    </p>
                  </div>
                  <PortalUpload itemId={r.id} label="Upload" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="animate-page-in overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
            <h2 className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm font-semibold text-text-main">
              <CalendarCheck className="h-4 w-4 text-text-muted" /> Your returns and filings
            </h2>
            {tasks.length === 0 ? (
              <p className="px-5 py-6 text-sm text-text-muted">Your firm will list your work here as it starts.</p>
            ) : (
              <ul className="divide-y divide-border">
                {tasks.map((t) => {
                  const look = STAGE_FOR_CLIENT[t.stage] || STAGE_FOR_CLIENT.Assigned;
                  const Icon = look.icon;
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text-main">
                          {t.title}
                          {t.period ? <span className="font-normal text-text-muted"> · {t.period}</span> : null}
                        </p>
                        <p className="text-[11px] text-text-muted">
                          {t.stage === "Approved" ? `Completed ${formatDate(t.stage_changed_at)}` : t.official_due_date ? `Due ${formatDate(t.official_due_date)}` : ""}
                        </p>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${look.tone}`}>
                        <Icon className="h-3 w-3" /> {look.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="animate-page-in overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
            <h2 className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm font-semibold text-text-main">
              <Receipt className="h-4 w-4 text-text-muted" /> Invoices
            </h2>
            {invoices.length === 0 ? (
              <p className="px-5 py-6 text-sm text-text-muted">No invoices yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {invoices.map((i) => {
                  const bal = balanceOf(i);
                  return (
                    <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-main">{i.invoice_number}</p>
                        <p className="text-[11px] text-text-muted">
                          {formatDate(i.date)} · {formatINR(Number(i.total))}
                          {bal > 0 ? (
                            <span className="font-semibold text-accent"> · {formatINR(bal)} due{i.due_date ? ` by ${formatDate(i.due_date)}` : ""}</span>
                          ) : (
                            <span className="font-semibold text-emerald-700"> · paid</span>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <a
                          href={`/api/portal/invoices/${i.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg p-2 text-text-muted hover:bg-surface-alt hover:text-text-main"
                          aria-label={`Download ${i.invoice_number}`}
                        >
                          <Download className="h-4 w-4" />
                        </a>
                        {bal > 0 && canPayOnline && <PayButton invoiceId={i.id} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <section className="animate-page-in overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <h2 className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm font-semibold text-text-main">
            <FolderOpen className="h-4 w-4 text-text-muted" /> Shared documents
          </h2>
          {docs.length === 0 ? (
            <p className="px-5 py-6 text-sm text-text-muted">Returns, acknowledgements and reports your firm shares will appear here.</p>
          ) : (
            <ul className="grid gap-px bg-border sm:grid-cols-2">
              {docs.map((d) => (
                <li key={d.id} className="bg-surface">
                  <a href={`/api/portal/documents/${d.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-alt">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                      <FileText className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text-main">{d.title || d.file_name}</span>
                      <span className="block text-[11px] text-text-muted">
                        {d.from_client ? "Sent by you" : d.category} · {formatDate(d.created_at)}
                      </span>
                    </span>
                    <Download className="h-4 w-4 shrink-0 text-text-muted" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="flex flex-col items-center gap-2 pt-4 text-center text-xs text-text-muted">
          <p>Questions? Contact {s.firmName}</p>
          <p className="flex flex-wrap justify-center gap-4">
            {firm?.email && (
              <a href={`mailto:${firm.email}`} className="inline-flex items-center gap-1 hover:text-text-main">
                <Mail className="h-3.5 w-3.5" /> {firm.email}
              </a>
            )}
            {firm?.phone && (
              <a href={`tel:${firm.phone}`} className="inline-flex items-center gap-1 hover:text-text-main">
                <Phone className="h-3.5 w-3.5" /> {firm.phone}
              </a>
            )}
          </p>
          <p className="mt-4 text-[10px] text-text-muted/70">
            Signed in as {s.email}. <Link href="/portal/login" className="underline">Not you?</Link> · Secured by Duesk
          </p>
        </footer>
      </main>
    </div>
  );
}
