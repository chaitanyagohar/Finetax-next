/** Plan checks for server routes and jobs. SERVER ONLY. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/guard";
import { FEATURE_LABEL } from "@/lib/features";

export async function orgHasFeature(admin: SupabaseClient, orgId: string, feature: string): Promise<boolean> {
  const { data, error } = await admin.rpc("org_has_feature", { p_org: orgId, p_feature: feature });
  if (error) {
    console.error("[features] check failed:", error.message);
    return false;
  }
  return data === true;
}

export async function requireOrgFeature(admin: SupabaseClient, orgId: string, feature: string): Promise<void> {
  if (!(await orgHasFeature(admin, orgId, feature))) {
    throw new ApiError(403, `${FEATURE_LABEL[feature] || "This feature"} is not part of your plan. An administrator can ask for it from the Plan page.`);
  }
}
