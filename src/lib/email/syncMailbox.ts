/** Fetch new mail from one IMAP mailbox into email_messages. SERVER ONLY. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { simpleParser } from "mailparser";
import { ImapFlow } from "imapflow";
import { getAccountPassword, imapSettingsFor } from "@/lib/email/mailer";
import { assertPublicMailHost } from "@/lib/email/mailHost";
import { keptAttachments, storeMailFiles, type MailFile } from "@/lib/email/attachments";

const MAX_PER_RUN = 100; // larger backlogs continue on the next run
const FIRST_SYNC_DAYS = 14; // how far back the very first sync looks

// Stays under the 60-second route limit, so a slow server can't outlive the request (B-15)
const SOCKET_TIMEOUT_MS = 25000;
// A sync that crashed without releasing its claim is retried after this long
const CLAIM_MS = 90000;

export class MailboxConnectError extends Error {}

function extractAddress(field: any, fallback: string): string {
  const value = Array.isArray(field) ? field[0]?.value?.[0]?.address : field?.value?.[0]?.address || field?.address;
  return (value || fallback).toLowerCase();
}

export async function syncMailbox(admin: SupabaseClient, account: any): Promise<{ count: number; more?: boolean; skipped?: boolean }> {
  // Claimed in the database, so two server instances never sync the same mailbox at once (B-15)
  const now = new Date();
  const { data: claimed } = await admin
    .from("email_accounts")
    .update({ sync_locked_until: new Date(now.getTime() + CLAIM_MS).toISOString() })
    .eq("id", account.id)
    .or(`sync_locked_until.is.null,sync_locked_until.lt.${now.toISOString()}`)
    .select("id");
  if (!claimed?.length) return { count: 0, skipped: true };

  try {
    const password = await getAccountPassword(admin, account);
    const imap = imapSettingsFor(account);
    const address = await assertPublicMailHost(imap.host, imap.port, "imap");

    const client = new ImapFlow({
      host: address,
      servername: imap.host,
      port: imap.port,
      secure: true,
      auth: { user: imap.user, pass: password },
      logger: false,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: SOCKET_TIMEOUT_MS,
    });

    const rows: any[] = [];
    const filesByMessage = new Map<string, MailFile[]>();
    let maxUid = Number(account.last_uid || 0);
    let uidValidity: number | null = null;
    let more = false;

    try {
      try {
        await client.connect();
      } catch (connErr: any) {
        console.error("[sync-emails] IMAP connect error:", connErr?.message || connErr);
        throw new MailboxConnectError(`Could not connect to ${imap.host}. Check the password and IMAP settings with "Test connection".`);
      }

      const lock = await client.getMailboxLock("INBOX");
      try {
        const box: any = client.mailbox;
        uidValidity = box?.uidValidity !== undefined ? Number(box.uidValidity) : null;
        const sameMailbox = uidValidity !== null && Number(account.uid_validity || 0) === uidValidity;

        let uids: number[] = [];
        if (sameMailbox && maxUid > 0) {
          // Everything after the last email we saved, read or unread
          const found = await client.search({ uid: `${maxUid + 1}:*` }, { uid: true });
          uids = (Array.isArray(found) ? found : []).filter((u) => u > maxUid);
        } else {
          // First sync (or the mailbox was reset): recent mail only
          maxUid = 0;
          const found = await client.search({ since: new Date(Date.now() - FIRST_SYNC_DAYS * 86400000) }, { uid: true });
          uids = Array.isArray(found) ? found : [];
        }

        uids.sort((a, b) => a - b);
        if (uids.length > MAX_PER_RUN) {
          uids = uids.slice(0, MAX_PER_RUN);
          more = true;
        }

        if (uids.length > 0) {
          for await (const msg of client.fetch(uids.join(","), { source: true, uid: true }, { uid: true })) {
            if (msg.uid > maxUid) maxUid = msg.uid;
            if (!msg.source) continue;
            const parsed = await simpleParser(msg.source);
            const files = keptAttachments(parsed.attachments);
            const messageId = parsed.messageId || `${msg.uid}-${account.id}`;
            if (files.length) filesByMessage.set(messageId, files);
            rows.push({
              org_id: account.org_id,
              account_id: account.id,
              direction: "inbound",
              from_address: extractAddress(parsed.from, "unknown@sender.com"),
              to_address: extractAddress(parsed.to, account.email_address),
              subject: parsed.subject || "(No Subject)",
              body_text: parsed.text || "",
              body_html: parsed.html || "",
              message_id: messageId,
              is_read: false,
              received_at: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
            });
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }

    // Skip anything already saved
    let newRows: any[] = [];
    if (rows.length > 0) {
      const { data: existing } = await admin
        .from("email_messages")
        .select("message_id")
        .eq("org_id", account.org_id)
        .in("message_id", rows.map((r) => r.message_id));
      const existingIds = new Set((existing || []).map((e: any) => e.message_id));
      const seen = new Set<string>();
      newRows = rows.filter((r) => {
        if (existingIds.has(r.message_id) || seen.has(r.message_id)) return false;
        seen.add(r.message_id);
        return true;
      });
    }

    // Link senders to clients by email, then save
    if (newRows.length > 0) {
      const senders = Array.from(new Set(newRows.map((r) => r.from_address)));
      const { data: matched } = await admin.from("clients").select("id, email").eq("org_id", account.org_id).in("email", senders);
      const clientByEmail = new Map((matched || []).map((c: any) => [String(c.email).toLowerCase(), c.id]));
      newRows.forEach((r) => (r.client_id = clientByEmail.get(r.from_address) || null));

      const { data: savedRows, error: insertErr } = await admin
        .from("email_messages")
        .insert(newRows)
        .select("id, message_id, client_id, subject");
      if (insertErr) {
        console.error("[sync-emails] Insert error:", insertErr.message);
        throw new Error("Emails were fetched but could not be saved.");
      }
      if (filesByMessage.size && savedRows?.length) {
        await storeMailFiles(admin, account.org_id, savedRows, filesByMessage);
      }
    }

    await admin
      .from("email_accounts")
      .update({
        last_uid: maxUid || null,
        uid_validity: uidValidity,
        last_synced_at: new Date().toISOString(),
        last_sync_error: null,
        verified_at: account.verified_at || new Date().toISOString(),
      })
      .eq("id", account.id);

    return { count: newRows.length, more };
  } catch (err: any) {
    await admin
      .from("email_accounts")
      .update({ last_sync_error: String(err?.message || err).slice(0, 300), last_synced_at: new Date().toISOString() })
      .eq("id", account.id);
    throw err;
  } finally {
    await admin.from("email_accounts").update({ sync_locked_until: null }).eq("id", account.id);
  }
}