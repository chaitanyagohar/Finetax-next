/** Per-mailbox access checks for server routes, which bypass row-level security. SERVER ONLY. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, type AuthContext } from "@/lib/api/guard";

/**
 * Administrators may use every mailbox of their firm. Other staff need the Firm inbox module
 * (id: dashboard), as the browser does, and the mailbox shared with them.
 */
export async function assertMailboxAccess(admin: SupabaseClient, caller: AuthContext, accountId: string): Promise<void> {
  if (caller.isAdmin) return;
  if (!caller.moduleAccess.includes("dashboard")) throw new ApiError(403, "You don't have access to the firm inbox.");
  const { data } = await admin
    .from("email_account_members")
    .select("account_id")
    .eq("account_id", accountId)
    .eq("user_id", caller.userId)
    .eq("org_id", caller.orgId)
    .maybeSingle();
  if (!data) throw new ApiError(403, "This mailbox is not shared with you. Ask an administrator for access.");
}
