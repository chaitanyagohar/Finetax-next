/**
 * Re-authentication helper for sensitive admin actions. SERVER ONLY.
 * Confirms the caller's own password without touching their browser session.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/guard";

export async function verifyCallerPassword(email: string | null, password: unknown) {
  if (!email || typeof password !== "string" || !password) {
    throw new ApiError(401, "Please confirm your own password to continue.");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new ApiError(500, "Server is not configured correctly.");
  }

  const verifier = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await verifier.auth.signInWithPassword({ email, password });
  if (error) {
    throw new ApiError(401, "Your password is incorrect.");
  }

  try {
    await verifier.auth.signOut({ scope: "local" });
  } catch {
    // ignore — temporary verification session only
  }
}