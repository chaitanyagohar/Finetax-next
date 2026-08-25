export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { simpleParser } from "mailparser";
import { ImapFlow } from "imapflow";

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "Missing Supabase env configuration" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { accountId } = await request.json();

    // Fetch account credentials
    const { data: account, error: accErr } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", accountId)
      .single();

    if (accErr || !account) {
      return NextResponse.json({ error: "Account not found or inactive" }, { status: 400 });
    }

    const client = new ImapFlow({
      host: account.imap_host || "imap.gmail.com",
      port: account.imap_port || 993,
      secure: true,
      auth: {
        user: account.imap_user || account.email_address,
        pass: account.imap_pass || account.smtp_pass,
      },
      logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    let newEmailsCount = 0;
    try {
      // Fetch recent unread messages
      for await (const msg of client.fetch({ unseen: true }, { source: true, envelope: true })) {
        if (!msg.source) continue;

        const parsed = await simpleParser(msg.source);
        const msgId = parsed.messageId || `${msg.uid}-${account.id}`;

        // Prevent duplicate processing
        const { data: existing } = await supabase
          .from("email_messages")
          .select("id")
          .eq("message_id", msgId)
          .limit(1);

        if (!existing || existing.length === 0) {
          const fromParsed = parsed.from;
          const fromAddress = Array.isArray(fromParsed)
            ? fromParsed[0]?.value?.[0]?.address
            : (fromParsed as any)?.value?.[0]?.address || (fromParsed as any)?.address || "unknown@sender.com";

          const toParsed = parsed.to;
          const toAddress = Array.isArray(toParsed)
            ? toParsed[0]?.value?.[0]?.address
            : (toParsed as any)?.value?.[0]?.address || (toParsed as any)?.address || account.email_address;

          await supabase.from("email_messages").insert([{
            account_id: account.id,
            direction: "inbound",
            from_address: fromAddress,
            to_address: toAddress,
            subject: parsed.subject || "(No Subject)",
            body_text: parsed.text || "",
            body_html: parsed.html || "",
            message_id: msgId,
            is_read: false,
            received_at: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
          }]);

          newEmailsCount++;
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
    return NextResponse.json({ success: true, count: newEmailsCount });

  } catch (error: any) {
    console.error("IMAP Sync Error:", error);
    return NextResponse.json({ error: error.message || "Sync failed" }, { status: 500 });
  }
}