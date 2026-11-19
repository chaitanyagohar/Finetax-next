/**
 * Client portal sign-in. SERVER ONLY.
 * A client gets a one-time link by email; opening it starts a 30-day session held in an
 * httpOnly cookie. Only SHA-256 hashes of links and sessions are stored.
 */
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/api/guard";

export const PORTAL_COOKIE = "duesk_portal";
export const SESSION_DAYS = 30;

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(String(token)).digest("hex");
}

/** A one-time sign-in link for a portal user; minutes decides how long it works. */
export async function createLoginLink(admin: SupabaseClient, portalUserId: string, siteUrl: string, minutes: number): Promise<string> {
  const { token, hash } = newToken();
  const { error } = await admin.from("client_portal_tokens").insert({
    portal_user_id: portalUserId,
    purpose: "login",
    token_hash: hash,
    expires_at: new Date(Date.now() + minutes * 60_000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return `${siteUrl}/portal/auth?t=${token}`;
}

export interface PortalSession {
  sessionId: string;
  portalUserId: string;
  orgId: string;
  clientId: string;
  email: string;
  name: string | null;
  clientName: string;
  firmName: string;
}

/** The signed-in portal user, or null. Checks the session, the user, the client and the firm every time. */
export async function getPortalSession(): Promise<PortalSession | null> {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token || token.length < 30 || token.length > 100) return null;

  const admin = getAdminClient();
  const { data: row } = await admin
    .from("client_portal_tokens")
    .select("id, expires_at, portal_user_id, client_portal_users!inner(id, org_id, client_id, email, name, is_active)")
    .eq("token_hash", hashToken(token))
    .eq("purpose", "session")
    .maybeSingle();
  if (!row || Date.parse(row.expires_at) < Date.now()) return null;

  const user = (Array.isArray(row.client_portal_users) ? row.client_portal_users[0] : row.client_portal_users) as {
    id: string;
    org_id: string;
    client_id: string;
    email: string;
    name: string | null;
    is_active: boolean;
  };
  if (!user?.is_active) return null;

  const [{ data: client }, { data: org }, { data: firm }] = await Promise.all([
    admin.from("clients").select("name, organization_name, status, merged_into").eq("id", user.client_id).eq("org_id", user.org_id).maybeSingle(),
    admin.from("organizations").select("name, status").eq("id", user.org_id).maybeSingle(),
    admin.from("firm_settings").select("firm_name").eq("org_id", user.org_id).maybeSingle(),
  ]);
  if (!client || client.merged_into || !org || !["trial", "active"].includes(org.status)) return null;
  // A firm whose plan no longer includes the portal: its clients can't sign in
  const { data: allowed } = await admin.rpc("org_has_feature", { p_org: user.org_id, p_feature: "client_portal" });
  if (allowed !== true) return null;

  return {
    sessionId: row.id,
    portalUserId: user.id,
    orgId: user.org_id,
    clientId: user.client_id,
    email: user.email,
    name: user.name,
    clientName: client.organization_name || client.name,
    firmName: firm?.firm_name || org.name,
  };
}

export function sessionCookie(token: string) {
  return {
    name: PORTAL_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  };
}
