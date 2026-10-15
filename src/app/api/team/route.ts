export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import {
  ApiError,
  assertSameOrigin,
  errorResponse,
  getAdminClient,
  requireAdmin,
  writeAuditLog,
} from "@/lib/api/guard";

const ALLOWED_ROLES = ["admin", "staff", "reviewer"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  try {
    // Security gates: same-origin + authenticated active admin
    assertSameOrigin(request);
    const caller = await requireAdmin();

    let body: any;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Invalid request body.");
    }

    const { name, email, password, role, permissions } = body ?? {};

    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 254) {
      throw new ApiError(400, "Please enter a valid email address.");
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
      throw new ApiError(400, "Password must be between 8 and 72 characters.");
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      throw new ApiError(400, "Password must contain at least one letter and one number.");
    }
    const cleanName = typeof name === "string" ? name.trim().slice(0, 120) : "";
    if (!cleanName) {
      throw new ApiError(400, "Name is required.");
    }
    const cleanRole = typeof role === "string" && ALLOWED_ROLES.includes(role) ? role : "staff";
    const cleanPermissions =
      permissions && typeof permissions === "object" && !Array.isArray(permissions) ? permissions : null;

    const supabaseAdmin = getAdminClient();

    // 1. Create the secure Auth login credentials
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      app_metadata: { role: cleanRole },
    });

    if (authError || !authData?.user) {
      const alreadyExists = authError?.message?.toLowerCase().includes("already");
      if (authError) console.error("[team] Auth error:", authError.message);
      throw new ApiError(400, alreadyExists ? "A user with this email already exists." : "Could not create the user account.");
    }

    // 2. Map the new Auth ID to our custom Profiles table
    const { error: profileError } = await supabaseAdmin.from("profiles").insert([
      {
        id: authData.user.id,
        name: cleanName,
        email: cleanEmail,
        role: cleanRole,
        permissions: cleanPermissions,
      },
    ]);

    if (profileError) {
      console.error("[team] Profile error:", profileError.message);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id); // Roll back orphan login
      throw new ApiError(400, "Could not create the staff profile. No account was created.");
    }

    await writeAuditLog({
      entity: "profiles",
      entity_id: authData.user.id,
      action: "user_created",
      metadata: { created_by: caller.userId, created_by_email: caller.email, email: cleanEmail, role: cleanRole, via: "api/team" },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}