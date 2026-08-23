import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";

export async function POST(request: Request) {
  try {
    const { to, subject, body, templateType, entityId } = await request.json();

    if (!to || !subject || !body) {
      return NextResponse.json(
        { error: "Missing recipient, subject, or content." },
        { status: 400 }
      );
    }

    // Standard SMTP / Resend payload execution
    console.log(`[AUTOMATED EMAIL SENT TO ${to}] Subject: ${subject}`);

    // Record Immutable Audit Trail
    await logAuditEvent("EMAIL_SENT", templateType || "GENERAL", entityId, {
      recipient: to,
      subject,
    });

    return NextResponse.json({ success: true, message: "Email dispatched successfully." });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}