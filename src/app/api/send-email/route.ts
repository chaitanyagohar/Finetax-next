import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

// Use service role key to bypass RLS
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const to = formData.get("to") as string;
    const subject = formData.get("subject") as string;
    const body = formData.get("body") as string;
    let accountId = formData.get("accountId") as string | null;
    
    const files = formData.getAll("files") as File[];

    if (!to || !subject || !body) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // System Fallback: If no account ID is passed (e.g. from Tasks), use the first active inbox.
    if (!accountId) {
      const { data: defaultAccount } = await supabase
        .from("email_accounts").select("*").eq("is_active", true).limit(1).single();
        
      if (defaultAccount) accountId = defaultAccount.id;
      else return NextResponse.json({ error: "No connected email accounts found." }, { status: 400 });
    }

    // Fetch credentials
    const { data: account, error: accErr } = await supabase
      .from("email_accounts").select("*").eq("id", accountId).single();

    if (accErr || !account) {
       return NextResponse.json({ error: "Invalid email credentials in database." }, { status: 400 });
    }

    // 1. DISPATCH VIA NODEMAILER
    const smtpConfig = {
      host: account.smtp_host || "smtp.gmail.com",
      port: account.smtp_port || 587,
      secure: account.smtp_port === 465,
      auth: {
        user: account.smtp_user || account.email_address, // MUST match the From address
        pass: account.smtp_pass, 
      },
      from: `"${account.display_name}" <${account.email_address}>`, // MUST match the auth user
    };

    const transporter = nodemailer.createTransport(smtpConfig as any);
    const mailOptions: nodemailer.SendMailOptions = {
      from: smtpConfig.from,
      to,
      subject,
      html: body.replace(/\n/g, "<br/>"),
      attachments: [],
    };

    if (files && files.length > 0) {
      for (const file of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        mailOptions.attachments!.push({ filename: file.name, content: buffer });
      }
    }

    await transporter.sendMail(mailOptions);

    // 2. SAVE TO SUPABASE (Wrapped in Try/Catch so it doesn't break the whole route if it fails)
    try {
      const { error: dbError } = await supabase.from("email_messages").insert([{
        account_id: account.id,
        direction: "outbound",
        from_address: smtpConfig.from,
        to_address: to,
        subject,
        body_text: body,
        body_html: mailOptions.html,
        is_read: true
      }]);

      if (dbError) {
        console.error("🔴 DATABASE INSERT FAILED:", dbError.message);
        // This will print to your VS Code terminal!
      }
    } catch (e) {
      console.error("🔴 DATABASE FATAL ERROR:", e);
    }

    return NextResponse.json({ success: true, message: "Email sent!" });
  } catch (error: any) {
    console.error("🔴 NODEMAILER ERROR:", error);
    return NextResponse.json({ error: error.message || "Failed to send email" }, { status: 500 });
}
  }