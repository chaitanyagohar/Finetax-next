/**
 * Shared server-side security helpers for API route handlers.
 * SERVER ONLY — never import this from a "use client" file
 * (it reads the service-role key).
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Must match DEFAULT_STAFF_MODULES in src/app/layout.tsx
const DEFAULT_STAFF_MODULES = ["leads", "tasks", "time_tracking"];

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface AuthContext {
  userId: string;
  email: string | null;
  name: string;
  role: string;
  isAdmin: boolean;
  isReviewer: boolean;
  isSupportAgent: boolean;
  isPlatformAdmin: boolean;
  moduleAccess: string[];
  /** The firm the caller is working in. Every admin-client query MUST filter by this. */
  orgId: string;
  orgName: string;
}

type AccessRow = {
  org_id: string;
  org_name: string;
  role: string | null;
  is_reviewer: boolean | null;
  is_support_agent: boolean | null;
  module_access: unknown;
  designation: string | null;
  is_platform_admin: boolean | null;
};

/** Service-role client. Bypasses RLS — use only AFTER an auth check, and always filter by orgId. */
export function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new ApiError(500, "Server is not configured correctly.");
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Blocks cross-site requests (CSRF protection for state-changing routes). */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return; // Same-origin requests from some browsers / server-to-server calls
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "Invalid request origin.");
  }
  if (!host || originHost !== host) {
    throw new ApiError(403, "Cross-origin request blocked.");
  }
}

/**
 * Public base URL for links stored in the database or sent to clients.
 * Prefers NEXT_PUBLIC_SITE_URL so a forged Host header can never inject a foreign domain.
 */
export function getSiteUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}

/** Verifies the session, then loads the caller's role and modules in their CURRENT firm. */
export async function requireUser(): Promise<AuthContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ApiError(401, "Not authenticated.");
  }

  const { data: access, error: accessErr } = await supabase.rpc("my_access");
  if (accessErr) {
    console.error("[guard] my_access failed:", accessErr.message);
    throw new ApiError(500, "Could not load your access.");
  }
  const a = access as AccessRow | null;
  if (!a?.org_id) {
    throw new ApiError(403, "This account is not active in any firm.");
  }

  const admin = getAdminClient();
  const { data: profile } = await admin.from("profiles").select("name, is_active").eq("id", user.id).maybeSingle();

  if (!profile) {
    throw new ApiError(403, "Profile not found.");
  }
  if (profile.is_active === false) {
    throw new ApiError(403, "This account is deactivated.");
  }

  const role = a.role || "staff";
  const isAdmin = role === "admin";

  return {
    userId: user.id,
    email: user.email ?? null,
    name: profile.name || user.email?.split("@")[0] || "Staff Member",
    role,
    isAdmin,
    isReviewer: isAdmin || role === "reviewer" || !!a.is_reviewer,
    isSupportAgent: !!a.is_support_agent,
    isPlatformAdmin: !!a.is_platform_admin,
    moduleAccess: Array.isArray(a.module_access) ? (a.module_access as string[]) : DEFAULT_STAFF_MODULES,
    orgId: a.org_id,
    orgName: a.org_name,
  };
}

/** Same as requireUser(), but the caller must be an active administrator of their firm. */
export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (!ctx.isAdmin) {
    throw new ApiError(403, "Administrator access required.");
  }
  return ctx;
}

/** Caller must be an admin OR have at least one of the given module IDs. */
export async function requireModule(...moduleIds: string[]): Promise<AuthContext> {
  const ctx = await requireUser();
  if (ctx.isAdmin) return ctx;
  if (moduleIds.some((m) => ctx.moduleAccess.includes(m))) return ctx;
  throw new ApiError(403, "You do not have access to this module.");
}

/** Oddlambda owner console only. */
export async function requirePlatformAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (!ctx.isPlatformAdmin) {
    throw new ApiError(403, "Platform administrator access required.");
  }
  return ctx;
}

/** Converts any thrown error into a safe JSON response (no internal details leaked). */
export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[API] Unexpected error:", err);
  return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
}

/**
 * Non-blocking audit trail entry. Never fails the main request.
 * Pass `actor` (from requireUser/requireModule) so the entry records who did it and in which firm.
 * System jobs without an actor should pass `orgId`.
 */
export async function writeAuditLog(entry: {
  entity: string;
  entity_id?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
  actor?: AuthContext | null;
  orgId?: string | null;
}) {
  try {
    const admin = getAdminClient();
    const orgId = entry.orgId ?? entry.actor?.orgId ?? null;
    const { error } = await admin.from("audit_logs").insert({
      ...(orgId ? { org_id: orgId } : {}),
      user_id: entry.actor?.userId ?? null,
      entity: entry.entity,
      entity_id: entry.entity_id ?? null,
      action: entry.action,
      metadata: {
        ...(entry.metadata ?? {}),
        ...(entry.actor ? { actor_name: entry.actor.name } : {}),
      },
    });
    if (error) console.error("[AUDIT] Failed to write audit log:", error.message);
  } catch (e) {
    console.error("[AUDIT] Failed to write audit log:", e);
  }
}