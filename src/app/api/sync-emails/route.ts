import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { accountId } = await request.json();

    if (!accountId) return NextResponse.json({ error: "Account ID is required." }, { status: 400 });

    const { data: account } = await supabase.from("email_accounts").select("*").eq("id", accountId).single();
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const client = new ImapFlow({
      host: account.smtp_host === "smtp.gmail.com" ? "imap.gmail.com" : account.smtp_host,
      port: 993,
      secure: true,
      auth: { user: account.smtp_user || account.email_address, pass: account.smtp_pass },
      logger: false,
    });

    await client.connect();
    let lock = await client.getMailboxLock("INBOX");
    let newEmailsCount = 0;

    try {
      // Fetch ALL emails from the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const messages = client.fetch({ since: thirtyDaysAgo }, { source: true, envelope: true });

      for await (const msg of messages) {
      // Ensure msg.source exists before passing it to simpleParser
          if (!msg.source) continue;

          const parsed = await simpleParser(msg.source);
          
          // Use the official email Message-ID to prevent duplicates
          const msgId = parsed.messageId || `${msg.uid}-${account.id}`;

        // Check if we already have this email
        const { data: existing } = await supabase.from("email_messages").select("id").eq("message_id", msgId).single();
        
  if (!existing) {
          // Type-safe address extraction for mailparser unions
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
            message_id: msgId,
            direction: "inbound",
            from_address: fromAddress,
            to_address: toAddress,
            subject: parsed.subject || "(No Subject)",
            body_text: parsed.text || "",
            body_html: parsed.html || parsed.textAsHtml || "",
            is_read: false, // Always mark newly fetched emails as unread in your UI
            received_at: parsed.date ? new Date(parsed.date).toISOString() : new Date().toISOString()
          }]);
          
          newEmailsCount++;
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
    return NextResponse.json({ success: true, count: newEmailsCount, message: `Synced ${newEmailsCount} new emails.` });
  } catch (error: any) {
    console.error("IMAP Sync Error:", error);
    return NextResponse.json({ error: error.message || "Failed to sync emails" }, { status: 500 });
  }
}