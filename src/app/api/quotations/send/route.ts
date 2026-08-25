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
    const { quotationId, recipientEmail } = await request.json();

    if (!quotationId || !recipientEmail) {
      return NextResponse.json(
        { error: "Quotation ID and recipient email are required." },
        { status: 400 }
      );
    }

    // 1. Fetch Quotation Details & Related Client/Lead Info
    const { data: quotation, error: qErr } = await supabase
      .from("quotations")
      .select("*, clients!client_id(name, email)")
      .eq("id", quotationId)
      .single();

    if (qErr || !quotation) {
      return NextResponse.json(
        { error: "Quotation not found." },
        { status: 404 }
      );
    }

    // Resolve Recipient Name & Quote Number safely
    const clientName = quotation.clients?.name || quotation.recipient_name || "Valued Client";
    const quoteNum = quotation.quote_number || quotation.quotation_number || "QUO-001";
    const totalAmount = Number(quotation.total || quotation.total_amount || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
    });
    const validUntilDate = quotation.valid_until ? new Date(quotation.valid_until).toLocaleDateString("en-IN") : "N/A";

    // 2. Fetch/Render PDF Buffer internally from your PDF API
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const pdfResponse = await fetch(`${baseUrl}/quotations/${quotationId}/pdf`);

    let pdfBlob: Blob | null = null;
    if (pdfResponse.ok) {
      pdfBlob = await pdfResponse.blob();
    }

    // 3. Draft Professional HTML Email Template
    const emailSubject = `Quotation ${quoteNum} for Professional Services`;
    
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
        <h2 style="color: #1e3a8a; margin-top: 0;">Quotation for Professional Services</h2>
        <p>Dear <strong>${clientName}</strong>,</p>
        <p>Thank you for giving us the opportunity to submit our proposal. Please find attached our detailed quotation <strong>${quoteNum}</strong> for your review.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background-color: #f8fafc; border-radius: 6px;">
          <tr>
            <td style="padding: 10px 14px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Quotation Number:</td>
            <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0;">${quoteNum}</td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Total Amount:</td>
            <td style="padding: 10px 14px; font-weight: bold; color: #1e3a8a; border-bottom: 1px solid #e2e8f0;">₹${totalAmount}</td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; font-weight: bold;">Valid Until:</td>
            <td style="padding: 10px 14px;">${validUntilDate}</td>
          </tr>
        </table>

        <p>You can review the attached PDF document for a line-item breakdown, terms, and tax schedules.</p>
        <p>If you have any questions or require any adjustments, please feel free to reply directly to this email.</p>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="font-size: 12px; color: #64748b; margin-bottom: 0;">
          Best regards,<br/>
          <strong>Practice Management Team</strong>
        </p>
      </div>
    `;

    // 4. Send via FormData to `/api/send-email` with Attachment
    const formData = new FormData();
    formData.append("to", recipientEmail);
    formData.append("subject", emailSubject);
    formData.append("body", htmlBody);

    if (pdfBlob) {
      formData.append(
        "files",
        new File([pdfBlob], `${quoteNum.replace(/\//g, "-")}.pdf`, {
          type: "application/pdf",
        })
      );
    }

    const sendRes = await fetch(`${baseUrl}/api/send-email`, {
      method: "POST",
      body: formData,
    });

    const sendData = await sendRes.json();

    if (!sendRes.ok) {
      throw new Error(sendData.error || "Failed to dispatch email");
    }

    // 5. Update Status to 'Sent' in Supabase
    await supabase
      .from("quotations")
      .update({ status: "Sent", updated_at: new Date().toISOString() })
      .eq("id", quotationId);

    return NextResponse.json({
      success: true,
      message: "Quotation sent successfully with PDF attachment!",
    });
  } catch (error: any) {
    console.error("Quotation Email Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to send quotation email" },
      { status: 500 }
    );
  }
}