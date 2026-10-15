import { NextResponse, type NextRequest } from "next/server";
import {
  ApiError,
  assertSameOrigin,
  errorResponse,
  getAdminClient,
  requireAdmin,
  writeAuditLog,
} from "@/lib/api/guard";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["admin", "staff", "reviewer"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MODULE_ID_RE = /^[a-z0-9_-]{1,40}$/i;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function POST(req: NextRequest) {
  try {
    // 0. Security gates: same-origin + authenticated active admin
    assertSameOrigin(req);
    const caller = await requireAdmin();

    let body: any;
    try {
      body = await req.json();
    } catch {
      throw new ApiError(400, "Invalid request body.");
    }

    const { email, password, name, role, phone, designation, is_reviewer, is_active, module_access } = body ?? {};

    // 1. Validate and sanitise input
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

    const cleanName = cleanText(name, 120);
    if (!cleanName) {
      throw new ApiError(400, "Name is required.");
    }

    const cleanRole = typeof role === "string" && ALLOWED_ROLES.includes(role) ? role : "staff";

    const cleanModules: string[] = Array.isArray(module_access)
      ? Array.from(
          new Set(
            module_access
              .filter((m: unknown): m is string => typeof m === "string" && MODULE_ID_RE.test(m))
              .slice(0, 40)
          )
        )
      : [];

    const supabaseAdmin = getAdminClient();

    // 2. Create Auth User directly (auto-confirmed)
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: { name: cleanName, role: cleanRole },
      app_metadata: { role: cleanRole }, // Not editable by the user — safe for authorization
    });

    if (authErr || !authData?.user) {
      const alreadyExists = authErr?.message?.toLowerCase().includes("already");
      if (authErr) console.error("[create-user] Auth error:", authErr.message);
      throw new ApiError(400, alreadyExists ? "A user with this email already exists." : "Could not create the user account.");
    }

    // 3. Insert into Profiles Table
    const { error: profErr } = await supabaseAdmin.from("profiles").upsert({
      id: authData.user.id,
      name: cleanName,
      email: cleanEmail,
      phone: cleanText(phone, 20),
      designation: cleanText(designation, 80),
      role: cleanRole,
      is_reviewer: Boolean(is_reviewer),
      is_active: is_active === undefined ? true : Boolean(is_active),
      module_access: cleanModules,
    });

    if (profErr) {
      console.error("[create-user] Profile error:", profErr.message);
      // Roll back the auth user so no orphan login exists without a profile
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw new ApiError(400, "Could not create the staff profile. No account was created.");
    }

    // 4. Audit trail
    await writeAuditLog({
      entity: "profiles",
      entity_id: authData.user.id,
      action: "user_created",
      metadata: {
        created_by: caller.userId,
        created_by_email: caller.email,
        email: cleanEmail,
        role: cleanRole,
        is_reviewer: Boolean(is_reviewer),
        module_access: cleanModules,
      },
    });

    return NextResponse.json({ success: true, user: authData.user });
  } catch (err) {
    return errorResponse(err);
  }
}