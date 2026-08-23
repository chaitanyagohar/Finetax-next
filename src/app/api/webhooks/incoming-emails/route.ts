import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { simpleParser } from "mailparser";

export async function POST(request: Request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Parse incoming raw email body or webhook payload
    const rawEmail = await request.text();
    const parsed = await simpleParser(rawEmail);

    const fromAddress = Array.isArray(parsed.from)
      ? parsed.from[0]?.value?.[0]?.address
      : (parsed.from as any)?.value?.[0]?.address || (parsed.from as any)?.address || "unknown@sender.com";

    const toAddress = Array.isArray(parsed.to)
      ? parsed.to[0]?.value?.[0]?.address
      : (parsed.to as any)?.value?.[0]?.address || (parsed.to as any)?.address || "";

    // 2. Find the corresponding email account in Supabase
    const { data: accounts } = await supabase
      .from("email_accounts")
      .select("id")
      .ilike("email_address", `%${toAddress}%`)
      .limit(1);

    const account = accounts?.[0];

    if (!account) {
      console.warn(`Incoming email to unknown address: ${toAddress}`);
      return NextResponse.json({ success: true, message: "Ignored: unknown recipient" });
    }

    // Check if client exists matching sender email
    const { data: clients } = await supabase
      .from("clients")
      .select("id")
      .ilike("email", `%${fromAddress}%`)
      .limit(1);

    const client = clients?.[0];

    // 3. Save to Unified Inbox
    await supabase.from("email_messages").insert([{
      account_id: account.id,
      client_id: client?.id || null,
      direction: "inbound",
      from_address: fromAddress,
      to_address: toAddress,
      subject: parsed.subject || "(No Subject)",
      body_text: parsed.text || "",
      body_html: parsed.html || "",
      message_id: parsed.messageId || `${Date.now()}`,
      is_read: false,
      received_at: new Date().toISOString()
    }]);

    return NextResponse.json({ success: true, message: "Email processed and saved." });
  } catch (error: any) {
    console.error("Webhook Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}