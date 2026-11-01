/**
 * Rate limiter shared by every server instance (stored in the database).
 * SERVER ONLY. Always `await` it.
 * If the database check itself fails, the request is allowed (and the error logged),
 * so a temporary database hiccup never locks people out.
 */
import { getAdminClient } from "@/lib/api/guard";

export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    const { data, error } = await getAdminClient().rpc("hit_rate_limit", {
      p_key: String(key).slice(0, 200),
      p_limit: limit,
      p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
    });
    if (error) {
      console.error("[rateLimit] check failed:", error.message);
      return true;
    }
    return data === true;
  } catch (e) {
    console.error("[rateLimit] check failed:", e);
    return true;
  }
}