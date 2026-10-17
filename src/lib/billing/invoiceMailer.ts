/** Issue + email subscription bills, and send payment reminders. SERVER ONLY. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeHtml, sendFirmEmail } from "@/lib/email/mailer";
import { pdfFileName, renderInvoicePdf } from "@/lib/pdf/firmDocuments";

const inr = (n: unknown) => `Rs. ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "-");
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

function emailShell(firmName: string, bodyHtml: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;max-width:600px">
    ${bodyHtml}
    <p style="margin-top:20px">Regards,<br/><strong>${escapeHtml(firmName)}</strong></p>
  </div>`;
}

function paymentBlock(firm: any, balance: number): string {
  const lines = [
    `<strong>Amount payable:</strong> ${inr(balance)}`,
    firm?.upi_id ? `<strong>UPI:</strong> ${escapeHtml(firm.upi_id)}` : "",
    firm?.bank_account_no
      ? `<strong>Bank:</strong> ${escapeHtml(firm.bank_name || "")} · A/C ${escapeHtml(firm.bank_account_no)} · IFSC ${escapeHtml(firm.bank_ifsc || "")}`
      : "",
  ].filter(Boolean);
  return `<p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px">${lines.join("<br/>")}</p>`;
}

export async function issueAndEmailInvoice(admin: SupabaseClient, invoiceId: string): Promise<{ sent: boolean; message: string }> {
  const { data: inv } = await admin.from("invoices").select("*, clients!client_id(*)").eq("id", invoiceId).single();
  if (!inv) return { sent: false, message: "Invoice not found." };
  if (inv.status === "Cancelled") return { sent: false, message: `${inv.invoice_number} is cancelled.` };

  if (inv.status === "Draft") {
    const { error } = await admin.from("invoices").update({ status: "Sent" }).eq("id", invoiceId);
    if (error) return { sent: false, message: `${inv.invoice_number}: ${error.message}` };
    inv.status = "Sent";
  }

  const to = inv.clients?.email;
  if (!to) return { sent: false, message: `${inv.invoice_number} issued, but the client has no email address. Send it from Invoices or WhatsApp.` };

  const [{ data: firm }, { data: sub }] = await Promise.all([
    admin.from("firm_settings").select("*").eq("id", 1).maybeSingle(),
    inv.client_package_id
      ? admin.from("client_packages").select("late_fee_percent, late_fee_min").eq("id", inv.client_package_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const balance = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0));
  const pdf = await renderInvoicePdf(inv, inv.clients, firm);
  const firmName = firm?.firm_name || "Our firm";
  const period = inv.billing_period_start ? ` for ${dmy(inv.billing_period_start)} to ${dmy(inv.billing_period_end)}` : "";
  const late =
    Number(sub?.late_fee_percent) > 0
      ? `<p style="color:#92400e">Please pay by the due date. Late payment charges of ${escapeHtml(String(sub!.late_fee_percent))}% per month (minimum ${inr(sub!.late_fee_min)}) apply on overdue amounts.</p>`
      : "";

  await sendFirmEmail({
    to,
    subject: `Invoice ${inv.invoice_number}${period} · due ${dmy(inv.due_date)}`,
    html: emailShell(
      firmName,
      `<p>Dear ${escapeHtml(inv.clients?.name || "Client")},</p>
       <p>Please find attached invoice <strong>${escapeHtml(inv.invoice_number)}</strong>${escapeHtml(period)} for <strong>${inr(inv.total)}</strong>, payable by <strong>${dmy(inv.due_date)}</strong>.</p>
       ${paymentBlock(firm, balance)}
       ${late}
       <p>Please ignore this message if you have already paid.</p>`
    ),
    text: `Invoice ${inv.invoice_number}${period} for ${inr(inv.total)}, due ${dmy(inv.due_date)}. PDF attached.`,
    attachments: [{ filename: pdfFileName(inv.invoice_number, "Invoice"), content: pdf, contentType: "application/pdf" }],
  });

  await admin.from("invoices").update({ email_sent_at: new Date().toISOString() }).eq("id", invoiceId); // best effort
  return { sent: true, message: `${inv.invoice_number} emailed to ${to}.` };
}

/** Before-due, due-today and 3-days-overdue reminders for subscription bills (each sent once). */
export async function sendPaymentReminders(admin: SupabaseClient): Promise<number> {
  const today = istToday();
  const rules = [
    { kind: "due_in_2", due: addDays(today, 2), subject: "Payment reminder: due in 2 days", lead: "This is a friendly reminder that the invoice below is due in 2 days." },
    { kind: "due_today", due: today, subject: "Payment due today", lead: "The invoice below is due for payment today." },
    { kind: "overdue_3", due: addDays(today, -3), subject: "Payment overdue", lead: "Our records show the invoice below is now overdue." },
  ];
  const { data: firm } = await admin.from("firm_settings").select("*").eq("id", 1).maybeSingle();
  let sent = 0;

  for (const rule of rules) {
    const { data: invoices } = await admin
      .from("invoices")
      .select("*, clients!client_id(*)")
      .not("client_package_id", "is", null)
      .in("status", ["Sent", "Partially Paid"])
      .eq("due_date", rule.due);

    for (const inv of invoices || []) {
      const balance = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0));
      if (balance <= 0.009 || !inv.clients?.email) continue;
      const { error } = await admin.from("invoice_reminders").insert([{ invoice_id: inv.id, kind: rule.kind }]);
      if (error) continue; // already sent

      try {
        await sendFirmEmail({
          to: inv.clients.email,
          subject: `${rule.subject} · ${inv.invoice_number}`,
          html: emailShell(
            firm?.firm_name || "Our firm",
            `<p>Dear ${escapeHtml(inv.clients?.name || "Client")},</p>
             <p>${rule.lead}</p>
             <p><strong>Invoice:</strong> ${escapeHtml(inv.invoice_number)} · <strong>Due date:</strong> ${dmy(inv.due_date)}</p>
             ${paymentBlock(firm, balance)}
             <p>Please ignore this message if you have already paid.</p>`
          ),
          text: `${rule.lead} Invoice ${inv.invoice_number}, balance ${inr(balance)}, due ${dmy(inv.due_date)}.`,
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