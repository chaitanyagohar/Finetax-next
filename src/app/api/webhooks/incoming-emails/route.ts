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

    // 3. Find the corresponding email account (exact, case-insensitive match)
    const { data: accounts } = await supabase
      .from("email_accounts")
      .select("id")
      .ilike("email_address", escapeLike(toAddress))
      .limit(1);

    const account = accounts?.[0];
    if (!account) {
      console.warn(`[webhook] Incoming email to unknown address: ${toAddress}`);
      return NextResponse.json({ success: true, message: "Ignored: unknown recipient" });
    }

    // 4. Skip duplicates
    const messageId = parsed.messageId || `${Date.now()}-${account.id}`;
    const { data: existing } = await supabase
      .from("email_messages")
      .select("id")
      .eq("message_id", messageId)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ success: true, message: "Duplicate ignored." });
    }

    // 5. Check if client exists matching sender email (wildcards escaped)
    const { data: clients } = await supabase
      .from("clients")
      .select("id")
      .ilike("email", `%${escapeLike(fromAddress)}%`)
      .limit(1);

    const client = clients?.[0];

    // 6. Save to Unified Inbox
    const { error: insertErr } = await supabase.from("email_messages").insert([
      {
        account_id: account.id,
        client_id: client?.id || null,
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
      return NextResponse.json({ error: "Could not save email." }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Email processed and saved." });
  } catch (error) {
    console.error("[webhook] Error:", error);
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}