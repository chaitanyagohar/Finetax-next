export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { simpleParser } from "mailparser";
import { getAdminClient } from "@/lib/api/guard";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Escapes LIKE wildcards so user-controlled input can't match unintended rows
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function extractAddress(field: any, fallback: string): string {
  const value = Array.isArray(field) ? field[0]?.value?.[0]?.address : field?.value?.[0]?.address || field?.address;
  return (value || fallback).toLowerCase().trim();
}

export async function POST(request: NextRequest) {
  try {
    // 0. Verify the shared secret (fail closed if not configured)
    const secret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    if (!secret || secret.length < 32) {
      console.error("[webhook] INBOUND_EMAIL_WEBHOOK_SECRET is missing or too short.");
      return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
    }

    const provided = request.headers.get("x-webhook-secret") || request.nextUrl.searchParams.get("token") || "";
    if (!safeEqual(provided, secret)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    // 1. Size limits
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BYTES) {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    }

    const rawEmail = await request.text();
    if (!rawEmail) {
      return NextResponse.json({ error: "Empty payload." }, { status: 400 });
    }
    if (rawEmail.length > MAX_BYTES) {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    }

    // 2. Parse incoming raw email
    const parsed = await simpleParser(rawEmail);
    const fromAddress = extractAddress(parsed.from, "unknown@sender.com");
    const toAddress = extractAddress(parsed.to, "");

    if (!toAddress) {
      return NextResponse.json({ success: true, message: "Ignored: no recipient" });
    }

    const supabase = getAdminClient();

    // 3. Every firm that connected this address gets its own copy
    const { data: accounts } = await supabase
      .from("email_accounts")
      .select("id, org_id")
      .ilike("email_address", escapeLike(toAddress));

    if (!accounts || accounts.length === 0) {
      console.warn(`[webhook] Incoming email to unknown address: ${toAddress}`);
      return NextResponse.json({ success: true, message: "Ignored: unknown recipient" });
    }

    let saved = 0;
    for (const account of accounts) {
      const messageId = parsed.messageId || `${Date.now()}-${account.id}`;

      // 4. Skip duplicates (within this firm)
      const { data: existing } = await supabase
        .from("email_messages")
        .select("id")
        .eq("org_id", account.org_id)
        .eq("message_id", messageId)
        .limit(1);
      if (existing && existing.length > 0) continue;

      // 5. Match the sender to one of THIS firm's clients (wildcards escaped)
      const { data: clients } = await supabase
        .from("clients")
        .select("id")
        .eq("org_id", account.org_id)
        .ilike("email", `%${escapeLike(fromAddress)}%`)
        .limit(1);

      // 6. Save to that firm's Unified Inbox
      const { error: insertErr } = await supabase.from("email_messages").insert([
        {
          org_id: account.org_id,
          account_id: account.id,
          client_id: clients?.[0]?.id || null,
          direction: "inbound",
          from_address: fromAddress,
          to_address: toAddress,
          subject: parsed.subject || "(No Subject)",
          body_text: parsed.text || "",
          body_html: parsed.html || "",
          message_id: messageId,
          is_read: false,
          received_at: new Date().toISOString(),
        },
      ]);

      if (insertErr) {
        console.error("[webhook] Insert error:", insertErr.message);
        continue;
      }
      saved++;
    }

    return NextResponse.json({ success: true, message: saved ? "Email processed and saved." : "Duplicate ignored." });
  } catch (error) {
    console.error("[webhook] Error:", error);
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}