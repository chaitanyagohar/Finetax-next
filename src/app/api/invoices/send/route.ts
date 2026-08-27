export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/audit";
import React from "react";
import { renderToStream } from "@react-pdf/renderer";
import InvoiceTemplate from "./InvoiceTemplate";
import { Buffer } from "buffer";

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "Supabase environment variables missing." }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { invoiceId, recipientEmail } = await request.json();

    if (!invoiceId || !recipientEmail) {
      return NextResponse.json({ error: "Invoice ID and recipient email are required." }, { status: 400 });
    }

    // 1. Fetch Invoice & Firm Data
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("*, clients!client_id(name, email, address, gstin, pan)")
      .eq("id", invoiceId)
      .single();

    if (invErr || !invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    const { data: firm } = await supabase.from("firm_settings").select("*").eq("id", 1).single();

    const clientName = invoice.clients?.name || invoice.organisation || "Valued Client";
    const invNum = invoice.invoice_number || "INV-000";

// 2. Generate Pure PDF Binary Stream on Server
    const pdfStream = await renderToStream(
      React.createElement(InvoiceTemplate, {
        invoice,
        client: invoice.clients,
        firm,
      }) as any
    );

    // Convert Stream to Blob for FormData attachment
    const chunks: any[] = [];
    for await (const chunk of pdfStream) {
      chunks.push(chunk);
    }
    const pdfBuffer = Buffer.concat(chunks);
    const pdfBlob = new Blob([pdfBuffer], { type: "application/pdf" });

    // 3. Draft Email
    const host = request.headers.get("host");
    const protocol = host?.includes("localhost") ? "http" : "https";
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `${protocol}://${host}`;
    
    const emailSubject = `Tax Invoice ${invNum} from ${firm?.firm_name || "Finetax"}`;
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #1e293b; padding: 24px;">
        <p>Dear <strong>${clientName}</strong>,</p>
        <p>Please find attached your formal tax invoice <strong>${invNum}</strong> for recent services.</p>
        <p>You can securely view, download, or print the full document from the PDF attachment below.</p>
        <br/>
        <p>Best regards,<br/><strong>${firm?.firm_name || "Finetax Accounts"}</strong></p>
      </div>
    `;

    // 4. Attach and Dispatch
    const formData = new FormData();
    formData.append("to", recipientEmail);
    formData.append("subject", emailSubject);
    formData.append("body", htmlBody);
    
    // Attach the true PDF binary file!
    formData.append("files", pdfBlob, `${invNum.replace(/\//g, "-")}.pdf`);

    const sendRes = await fetch(`${baseUrl}/api/send-email`, {
      method: "POST",
      body: formData,
    });

    const sendData = await sendRes.json();
    if (!sendRes.ok) throw new Error(sendData.error || "Failed to send email");

    const now = new Date().toISOString();
    await supabase.from("invoices").update({ status: "Sent", email_sent_at: now, updated_at: now }).eq("id", invoiceId);

    try {
      await logAuditEvent("SEND_INVOICE_EMAIL", "INVOICES", invoiceId, { recipientEmail, invoiceNumber: invNum });
    } catch (e) {}

    return NextResponse.json({ success: true, message: "Invoice email sent successfully with PDF attachment!" });
  } catch (error: any) {
    console.error("Invoice Send Error:", error);
    return NextResponse.json({ error: error.message || "Failed to send invoice email" }, { status: 500 });
  }
}