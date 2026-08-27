export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/audit";
import React from "react";
import { renderToStream } from "@react-pdf/renderer";
import QuotationTemplate from "./QuotationTemplate";
import { Buffer } from "buffer";

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "Supabase environment variables missing." }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { quotationId, recipientEmail } = await request.json();

    if (!quotationId || !recipientEmail) {
      return NextResponse.json({ error: "Quotation ID and recipient email are required." }, { status: 400 });
    }

    // 1. Fetch Quotation & Firm Data
    const { data: quotation, error: quoteErr } = await supabase
      .from("quotations")
      .select("*, clients!client_id(name, email, address, gstin, pan)")
      .eq("id", quotationId)
      .single();

    if (quoteErr || !quotation) {
      return NextResponse.json({ error: "Quotation not found." }, { status: 404 });
    }

    const { data: firm } = await supabase.from("firm_settings").select("*").eq("id", 1).single();

    // FIXED: Extract clientData safely from the joined Supabase query
    const clientData = quotation.clients;
    const clientName = clientData?.name 
      ? String(clientData.name) 
      : quotation?.recipient_name 
      ? String(quotation.recipient_name) 
      : quotation?.organisation 
      ? String(quotation.organisation) 
      : "Valued Client";
      
    const quoteNum = quotation.quote_number || quotation.quotation_number || "QTN-000";

// 2. Generate Pure PDF Binary Stream on Server
    const pdfStream = await renderToStream(
      React.createElement(QuotationTemplate, {
        quotation,
        client: clientData,
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
    
    const emailSubject = `Quotation ${quoteNum} from ${firm?.firm_name || "Finetax"}`;
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #1e293b; padding: 24px;">
        <p>Dear <strong>${clientName}</strong>,</p>
        <p>Please find attached your formal quotation <strong>${quoteNum}</strong> for proposed services.</p>
        <p>You can securely view, download, or print the full document from the PDF attachment below.</p>
        <br/>
        <p>Best regards,<br/><strong>${firm?.firm_name || "Finetax"}</strong></p>
      </div>
    `;

    // 4. Attach and Dispatch
    const formData = new FormData();
    formData.append("to", recipientEmail);
    formData.append("subject", emailSubject);
    formData.append("body", htmlBody);
    
    // Attach the true PDF binary file!
    formData.append("files", pdfBlob, `${quoteNum.replace(/\//g, "-")}.pdf`);

    const sendRes = await fetch(`${baseUrl}/api/send-email`, {
      method: "POST",
      body: formData,
    });

    const sendData = await sendRes.json();
    if (!sendRes.ok) throw new Error(sendData.error || "Failed to send email");

    const now = new Date().toISOString();
    await supabase.from("quotations").update({ status: "Sent", email_sent_at: now, updated_at: now }).eq("id", quotationId);

    try {
      await logAuditEvent("SEND_QUOTATION_EMAIL", "QUOTATIONS", quotationId, { recipientEmail, quotationNumber: quoteNum });
    } catch (e) {}

    return NextResponse.json({ success: true, message: "Quotation email sent successfully with PDF attachment!" });
  } catch (error: any) {
    console.error("Quotation Send Error:", error);
    return NextResponse.json({ error: error.message || "Failed to send quotation email" }, { status: 500 });
  }
}