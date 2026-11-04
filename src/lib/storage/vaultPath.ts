/** Checks that a vault file path belongs to the given firm before the server reads it. SERVER ONLY. */
import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const VAULT_BUCKETS = ["firm-documents", "documents"];

export async function isVaultPathAllowed(admin: SupabaseClient, orgId: string, bucket: string, path: string): Promise<boolean> {
  if (!VAULT_BUCKETS.includes(bucket)) return false;
  const p = String(path || "");
  if (!p || p.startsWith("/") || p.includes("..") || p.includes("\\")) return false;

  const top = p.split("/")[0];
  if (top === orgId) return true;

  // Files from before multi-tenancy belong to the legacy firm (Finetax)
  if (top === "client_files" || top === "internal") {
    const { data } = await admin.from("platform_config").select("legacy_org_id").eq("id", true).maybeSingle();
    return !!data && data.legacy_org_id === orgId;
  }

  // Older client folders: only that firm's own clients
  if (UUID_RE.test(top)) {
    const { data } = await admin.from("clients").select("id").eq("id", top).eq("org_id", orgId).maybeSingle();
    return !!data;
  }
  return false;
}