/** Issue + email subscription bills, and send payment reminders. SERVER ONLY. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeHtml, sendFirmEmail } from "@/lib/email/mailer";
import { pdfFileName, renderInvoicePdf } from "@/lib/pdf/firmDocuments";
import { formatDate, istDate, rupees } from "@/lib/format";
import { ensurePaymentLink, type InvoiceForLink } from "@/lib/payments/links";
import { sellerFor } from "@/lib/pdf/seller";

const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

function emailShell(firmName: string, bodyHtml: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;max-width:600px">
    ${bodyHtml}
    <p style="margin-top:20px">Regards,<br/><strong>${escapeHtml(firmName)}</strong></p>
  </div>`;
}

/** The invoice's Razorpay link, or null. Never stops an email from going out. */
export async function payLinkFor(admin: SupabaseClient, inv: InvoiceForLink): Promise<string | null> {
  try {
    return await ensurePaymentLink(admin, inv);
  } catch (e) {
    console.error("[billing] payment link failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export function payButton(url: string | null): string {
  if (!url) return "";
  return `<p style="margin:16px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">Pay online</a>
    <span style="color:#64748b;font-size:12px;margin-left:8px">UPI, cards and net banking</span></p>`;
}

function paymentBlock(firm: any, balance: number, payUrl: string | null = null): string {
  const lines = [
    `<strong>Amount payable:</strong> ${rupees(balance)}`,
    firm?.upi_id ? `<strong>UPI:</strong> ${escapeHtml(firm.upi_id)}` : "",
    firm?.bank_account_no
      ? `<strong>Bank:</strong> ${escapeHtml(firm.bank_name || "")} · A/C ${escapeHtml(firm.bank_account_no)} · IFSC ${escapeHtml(firm.bank_ifsc || "")}`
      : "",
  ].filter(Boolean);
  return `${payButton(payUrl)}<p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px">${lines.join("<br/>")}</p>`;
}

/**
 * Issue a draft bill (if needed) and email it from the bill's own firm.
 * Pass expectOrgId when an admin triggers this, so they can only act on their own firm's bills.
 */
export async function issueAndEmailInvoice(
  admin: SupabaseClient,
  invoiceId: string,
  expectOrgId?: string | null
): Promise<{ sent: boolean; message: string }> {
  const loadInvoice = () => {
    const query = admin.from("invoices").select("*, clients!client_id(*)").eq("id", invoiceId);
    return (expectOrgId ? query.eq("org_id", expectOrgId) : query).maybeSingle();
  };

  let { data: inv } = await loadInvoice();
  if (!inv) return { sent: false, message: "Invoice not found." };
  if (inv.status === "Cancelled") return { sent: false, message: `${inv.invoice_number || "This draft bill"} is cancelled.` };

  if (inv.status === "Draft") {
    const clientName = inv.clients?.name || "this client";
    const { error } = await admin.from("invoices").update({ status: "Sent" }).eq("id", invoiceId);
    if (error) return { sent: false, message: `The bill for ${clientName} could not be issued: ${error.message}` };
    // Issuing assigns the number, the invoice date and the tax split
    ({ data: inv } = await loadInvoice());
    if (!inv) return { sent: false, message: `The bill for ${clientName} was issued but could not be reloaded. Email it from Invoices.` };
  }

  const to = inv.clients?.email;
  if (!to) return { sent: false, message: `${inv.invoice_number} issued, but the client has no email address. Send it from Invoices or WhatsApp.` };

  const [{ data: firm }, { data: sub }] = await Promise.all([
    admin.from("firm_settings").select("*").eq("org_id", inv.org_id).maybeSingle(),
    inv.client_package_id
      ? admin.from("client_packages").select("late_fee_percent, late_fee_min").eq("id", inv.client_package_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const balance = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0));
  const pdf = await renderInvoicePdf(inv, inv.clients, await sellerFor(inv, firm));
  const payUrl = balance > 0 ? await payLinkFor(admin, inv) : null;
  const firmName = firm?.firm_name || "Our firm";
  const period = inv.billing_period_start ? ` for ${formatDate(inv.billing_period_start, "-")} to ${formatDate(inv.billing_period_end, "-")}` : "";
  const late =
    Number(sub?.late_fee_percent) > 0
      ? `<p style="color:#92400e">Please pay by the due date. Late payment charges of ${escapeHtml(String(sub!.late_fee_percent))}% per month (minimum ${rupees(sub!.late_fee_min)}) apply on overdue amounts.</p>`
      : "";

  await sendFirmEmail({
    orgId: inv.org_id,
    to,
    subject: `Invoice ${inv.invoice_number}${period} · due ${formatDate(inv.due_date, "-")}`,
    html: emailShell(
      firmName,
      `<p>Dear ${escapeHtml(inv.clients?.name || "Client")},</p>
       <p>Please find attached invoice <strong>${escapeHtml(inv.invoice_number)}</strong>${escapeHtml(period)} for <strong>${rupees(inv.total)}</strong>, payable by <strong>${formatDate(inv.due_date, "-")}</strong>.</p>
       ${paymentBlock(firm, balance, payUrl)}
       ${late}
       <p>Please ignore this message if you have already paid.</p>`
    ),
    text: `Invoice ${inv.invoice_number}${period} for ${rupees(inv.total)}, due ${formatDate(inv.due_date, "-")}. PDF attached.`,
    attachments: [{ filename: pdfFileName(inv.invoice_number, "Invoice"), content: pdf, contentType: "application/pdf" }],
  });

  await admin.from("invoices").update({ email_sent_at: new Date().toISOString() }).eq("id", invoiceId); // best effort
  return { sent: true, message: `${inv.invoice_number} emailed to ${to}.` };
}

/**
 * Before-due, due-today and 3-days-overdue reminders (each sent once): for subscription bills always,
 * and for every other issued invoice when the firm has turned that on in Settings.
 * Pass onlyOrgId to limit the run to one firm (the "Run billing now" button).
 */
export async function sendPaymentReminders(admin: SupabaseClient, onlyOrgId?: string | null): Promise<number> {
  const today = istDate();
  const rules = [
    { kind: "due_in_2", due: addDays(today, 2), subject: "Payment reminder: due in 2 days", lead: "This is a friendly reminder that the invoice below is due in 2 days." },
    { kind: "due_today", due: today, subject: "Payment due today", lead: "The invoice below is due for payment today." },
    { kind: "overdue_3", due: addDays(today, -3), subject: "Payment overdue", lead: "Our records show the invoice below is now overdue." },
  ];

  // Each firm's own settings (bank details, name), loaded once per firm
  const firmCache = new Map<string, any>();
  async function firmFor(orgId: string) {
    if (!firmCache.has(orgId)) {
      const { data } = await admin.from("firm_settings").select("*").eq("org_id", orgId).maybeSingle();
      firmCache.set(orgId, data);
    }
    return firmCache.get(orgId);
  }

  let sent = 0;

  for (const rule of rules) {
    let query = admin
      .from("invoices")
      .select("*, clients!client_id(*)")
      .in("status", ["Sent", "Partially Paid"])
      .eq("due_date", rule.due);
    if (onlyOrgId) query = query.eq("org_id", onlyOrgId);
    const { data: invoices } = await query;

    for (const inv of invoices || []) {
      const balance = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0));
      if (balance <= 0.009 || !inv.clients?.email) continue;
      if (!inv.client_package_id && !(await firmFor(inv.org_id))?.remind_all_invoices) continue;
      const { error } = await admin.from("invoice_reminders").insert([{ org_id: inv.org_id, invoice_id: inv.id, kind: rule.kind }]);
      if (error) continue; // already sent

      try {
        const firm = await firmFor(inv.org_id);
        const payUrl = await payLinkFor(admin, inv);
        await sendFirmEmail({
          orgId: inv.org_id,
          to: inv.clients.email,
          subject: `${rule.subject} · ${inv.invoice_number}`,
          html: emailShell(
            firm?.firm_name || "Our firm",
            `<p>Dear ${escapeHtml(inv.clients?.name || "Client")},</p>
             <p>${rule.lead}</p>
             <p><strong>Invoice:</strong> ${escapeHtml(inv.invoice_number)} · <strong>Due date:</strong> ${formatDate(inv.due_date, "-")}</p>
             ${paymentBlock(firm, balance, payUrl)}
             <p>Please ignore this message if you have already paid.</p>`
          ),
          text: `${rule.lead} Invoice ${inv.invoice_number}, balance ${rupees(balance)}, due ${formatDate(inv.due_date, "-")}.${payUrl ? ` Pay online: ${payUrl}` : ""}`,
        });
        sent++;
      } catch (e) {
        console.error("[billing] reminder failed:", e);
        await admin.from("invoice_reminders").delete().eq("invoice_id", inv.id).eq("kind", rule.kind);
      }
    }
  }
  return sent;
}