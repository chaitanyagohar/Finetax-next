/** Shared checks for portal API routes. SERVER ONLY. */
import { ApiError } from "@/lib/api/guard";
import { getPortalSession, type PortalSession } from "@/lib/portal/session";

export async function requirePortal(): Promise<PortalSession> {
  const s = await getPortalSession();
  if (!s) throw new ApiError(401, "Your session has ended. Please sign in again.");
  return s;
}
