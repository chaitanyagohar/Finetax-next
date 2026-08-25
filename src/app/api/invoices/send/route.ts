export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "Supabase environment variables are missing." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { invoiceId, recipientEmail } = await request.json();

    if (!invoiceId || !recipientEmail) {
      return NextResponse.json(
        { error: "Invoice ID and recipient email are required." },
        { status: 400 }
      );
    }

    // 1. Fetch Invoice Details & Client Info
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("*, clients!client_id(name, email)")
      .eq("id", invoiceId)
      .single();

    if (invErr || !invoice) {
      return NextResponse.json(
        { error: "Invoice not found." },
        { status: 404 }
      );
    }

    const clientName = invoice.clients?.name || invoice.organisation || "Valued Client";
    const invNum = invoice.invoice_number || "INV-000";
    const totalAmount = Number(invoice.total || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
    });
    const amountPaid = Number(invoice.amount_paid || 0);
    const balanceDue = Math.max(0, invoice.total - amountPaid).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
    });
    const dueDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString("en-IN") : "Due on Receipt";

    // 2. Fetch/Render PDF Buffer internally
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const pdfResponse = await fetch(`${baseUrl}/invoices/${invoiceId}/pdf`);

    let pdfBlob: Blob | null = null;
    if (pdfResponse.ok) {
      pdfBlob = await pdfResponse.blob();
    }

    // 3. Draft Professional HTML Email Template
    const emailSubject = `Invoice ${invNum} from Practice Management`;
    
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
        <h2 style="color: #1e3a8a; margin-top: 0;">Tax Invoice</h2>
        <p>Dear <strong>${clientName}</strong>,</p>
        <p>Please find attached your formal invoice <strong>${invNum}</strong> for recent services.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background-color: #f8fafc; border-radius: 6px;">
          <tr>
            <td style="padding: 10px 14px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Invoice Number:</td>
            <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0;">${invNum}</td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Total Amount:</td>
            <td style="padding: 10px 14px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">₹${totalAmount}</td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Balance Due:</td>
            <td style="padding: 10px 14px; font-weight: bold; color: #dc2626; border-bottom: 1px solid #e2e8f0;">₹${balanceDue}</td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; font-weight: bold;">Due Date:</td>
            <td style="padding: 10px 14px;">${dueDate}</td>
          </tr>
        </table>

        <p>You can review the attached PDF document for a complete line-item breakdown.</p>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="font-size: 12px; color: #64748b; margin-bottom: 0;">
          Best regards,<br/>
          <strong>Practice Management Team</strong>
        </p>
      </div>
    `;

    // 4. Send via FormData to your central mailer
    const formData = new FormData();
    formData.append("to", recipientEmail);
    formData.append("subject", emailSubject);
    formData.append("body", htmlBody);

    if (pdfBlob) {
      formData.append(
        "files",
        new File([pdfBlob], `${invNum.replace(/\//g, "-")}.pdf`, {
          type: "application/pdf",
        })
      );
    }

    const sendRes = await fetch(`${baseUrl}/api/send-email`, {
      method: "POST",
      body: formData,
    });

    const sendData = await sendRes.json();
    if (!sendRes.ok) throw new Error(sendData.error || "Failed to dispatch email");

    // 5. Update Status and Timestamp in Supabase
    const updateData: any = { 
      email_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    if (invoice.status === "Draft") {
      updateData.status = "Sent";
    }

    await supabase
      .from("invoices")
      .update(updateData)
      .eq("id", invoiceId);

    return NextResponse.json({
      success: true,
      message: "Invoice sent successfully with PDF attachment!",
    });
  } catch (error: any) {
    console.error("Invoice Email Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to send invoice email" },
      { status: 500 }
    );
  }
}