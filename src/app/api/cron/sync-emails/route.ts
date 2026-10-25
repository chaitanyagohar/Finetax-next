export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/api/guard";
import { syncMailbox } from "@/lib/email/syncMailbox";

/**
 * Called every 5 minutes by the Supabase scheduler (pg_cron 'finetax-email-sync').
 * Protected by CRON_SECRET. Syncs every active firm's mailboxes, oldest first.
 */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();
  const { data: accounts, error } = await admin
    .from("email_accounts")
    .select("*, organizations!inner(status)")
    .in("organizations.status", ["trial", "active"])
    .or("is_active.is.null,is_active.eq.true")
    .order("last_synced_at", { ascending: true, nullsFirst: true });

  if (error) {
    console.error("[cron sync-emails] Could not load accounts:", error.message);
    return NextResponse.json({ error: "Could not load accounts." }, { status: 500 });
  }

  const started = Date.now();
  const results: any[] = [];
  for (const account of accounts || []) {
    if (Date.now() - started > 45000) break; // stay inside the time limit; the rest sync next run
    try {
      const r = await syncMailbox(admin, account);
      results.push({ account: account.email_address, ...r });
    } catch (e: any) {
      results.push({ account: account.email_address, error: e?.message || String(e) });
    }
  }
  return NextResponse.json({ success: true, synced: results.length, results });
}

export const GET = handle;
export const POST = handle;