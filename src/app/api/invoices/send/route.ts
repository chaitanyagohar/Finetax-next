export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import React from "react";
import { renderToStream } from "@react-pdf/renderer";
import InvoiceTemplate from "./InvoiceTemplate";
import { Buffer } from "buffer";

export async function POST(request: Request) {
  try {
    // 1. Authenticate the current user session
    const cookieStore = await cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => cookieStore.get(name)?.value } }
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    
    // Smart name extraction: Checks metadata, then falls back to capitalizing the email prefix
    let actorName = user?.user_metadata?.full_name || user?.user_metadata?.name;
    
    if (!actorName && user?.email) {
      const emailPrefix = user.email.split('@')[0];
      actorName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
    } else if (!actorName) {
      actorName = "System API";
    }
    const userId = user?.id || null;

    // 2. Initialize Admin Client for DB Operations
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

    // 3. Fetch Invoice & Firm Data
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

    // 4. Generate Pure PDF Binary Stream on Server
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

    // 5. Draft Email
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

    // 6. Attach and Dispatch
    const formData = new FormData();
    formData.append("to", recipientEmail);
    formData.append("subject", emailSubject);
    formData.append("body", htmlBody);
    
    // Attach the true PDF binary file
    formData.append("files", pdfBlob, `${invNum.replace(/\//g, "-")}.pdf`);

    const sendRes = await fetch(`${baseUrl}/api/send-email`, {
      method: "POST",
      body: formData,
    });

    const sendData = await sendRes.json();
    if (!sendRes.ok) throw new Error(sendData.error || "Failed to send email");

    // 7. Update DB Status
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("invoices")
      .update({ 
        email_sent_at: now,
      })
      .eq("id", invoiceId);

    if (updateError) {
      console.error("Supabase Update Error:", updateError);
      throw new Error(`Database update failed: ${updateError.message}`);
    }

    // 8. Log to Audit Table
    try {
      await supabase.from("audit_logs").insert({
        action: "SEND_INVOICE_EMAIL",
        entity: "INVOICES",
        entity_id: invoiceId,
        user_id: userId,
        metadata: { 
          recipientEmail, 
          invoiceNumber: invNum, 
          actor_name: actorName 
        }
      });
    } catch (e) {
      console.error("Audit Log Error:", e);
    }

    return NextResponse.json({ success: true, message: "Invoice email sent successfully with PDF attachment!" });
  } catch (error: any) {
    console.error("Invoice Send Error:", error);
    return NextResponse.json({ error: error.message || "Failed to send invoice email" }, { status: 500 });
  }
}