export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { simpleParser } from "mailparser";
import { ImapFlow } from "imapflow";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireUser } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGES_PER_SYNC = 100;

// Prevents two syncs of the same mailbox running at the same time
const syncingAccounts = new Set<string>();

function extractAddress(field: any, fallback: string): string {
  const value = Array.isArray(field) ? field[0]?.value?.[0]?.address : field?.value?.[0]?.address || field?.address;
  return (value || fallback).toLowerCase();
}

export async function POST(request: NextRequest) {
  try {
    // 0. Security gates
    assertSameOrigin(request);
    await requireUser();

    let body: any;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Invalid request body.");
    }

    const accountId = typeof body?.accountId === "string" ? body.accountId : "";
    if (!UUID_RE.test(accountId)) {
      throw new ApiError(400, "Invalid account.");
    }

    // Throttle: one sync per account every 20 seconds, never concurrent
    if (syncingAccounts.has(accountId) || !checkRateLimit(`sync:${accountId}`, 1, 20000)) {
      return NextResponse.json({ success: true, count: 0, skipped: true });
    }

    syncingAccounts.add(accountId);
    try {
      const supabase = getAdminClient();

      // 1. Fetch account credentials (server-side only)
      const { data: account, error: accErr } = await supabase
        .from("email_accounts")
        .select("*")
        .eq("id", accountId)
        .single();

      if (accErr || !account) {
        throw new ApiError(400, "Account not found or inactive");
      }
      if (account.is_active === false) {
        throw new ApiError(400, "This email account is disabled.");
      }

      const client = new ImapFlow({
        host: account.imap_host || "imap.gmail.com",
        port: Number(account.imap_port) || 993,
        secure: true,
        auth: {
          user: account.imap_user || account.email_address,
          pass: account.imap_pass || account.smtp_pass,
        },
        logger: false,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 60000,
      });

      const rows: any[] = [];

      try {
        try {
          await client.connect();
        } catch (connErr: any) {
          console.error("[sync-emails] IMAP connect error:", connErr?.message || connErr);
          throw new ApiError(502, "Could not connect to the mailbox. Please check its IMAP settings.");
        }

        const lock = await client.getMailboxLock("INBOX");
        try {
          // 2. Find unread messages, newest first, capped per sync
          const unseen = await client.search({ seen: false }, { uid: true });
          const uids = Array.isArray(unseen) ? unseen.slice(-MAX_MESSAGES_PER_SYNC) : [];

          if (uids.length > 0) {
            for await (const msg of client.fetch(uids.join(","), { source: true, envelope: true }, { uid: true })) {
              if (!msg.source) continue;
              const parsed = await simpleParser(msg.source);

              rows.push({
                account_id: account.id,
                direction: "inbound",
                from_address: extractAddress(parsed.from, "unknown@sender.com"),
                to_address: extractAddress(parsed.to, account.email_address),
                subject: parsed.subject || "(No Subject)",
                body_text: parsed.text || "",
                body_html: parsed.html || "",
                message_id: parsed.messageId || `${msg.uid}-${account.id}`,
                is_read: false,
                received_at: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
              });
            }
          }
        } finally {
          lock.release();
        }
      } finally {
        // Always close the IMAP connection, even on errors
        try {
          await client.logout();
        } catch {
          client.close();
        }
      }

      if (rows.length === 0) {
        return NextResponse.json({ success: true, count: 0 });
      }

      // 3. Prevent duplicate processing (one query instead of one per message)
      const messageIds = rows.map((r) => r.message_id);
      const { data: existing } = await supabase
        .from("email_messages")
        .select("message_id")
        .in("message_id", messageIds);

      const existingIds = new Set((existing || []).map((e: any) => e.message_id));
      const seenInBatch = new Set<string>();
      const newRows = rows.filter((r) => {
        if (existingIds.has(r.message_id) || seenInBatch.has(r.message_id)) return false;
        seenInBatch.add(r.message_id);
        return true;
      });

      // 4. Single bulk insert
      if (newRows.length > 0) {
        const { error: insertErr } = await supabase.from("email_messages").insert(newRows);
        if (insertErr) {
          console.error("[sync-emails] Insert error:", insertErr.message);
          throw new ApiError(500, "Emails were fetched but could not be saved.");
        }
      }

      return NextResponse.json({ success: true, count: newRows.length });
    } finally {
      syncingAccounts.delete(accountId);
    }
  } catch (err) {
    return errorResponse(err);
  }
}