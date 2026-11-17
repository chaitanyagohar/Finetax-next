export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { EMAIL_RE } from "@/lib/validate";


type EmailStatus = { exists?: boolean; user_id?: string; confirmed?: boolean; has_membership?: boolean };

/** Step 1 of signup: check the email, then send a "confirm your email" invite. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";

    if (!(await checkRateLimit(`signup-ip:${ip}`, 5, 60 * 60 * 1000))) {
      throw new ApiError(429, "Too many signups from this network. Please try again in an hour.");
    }

    const body = await request.json().catch(() => ({}));
    const firmName = String(body?.firmName || "").trim().replace(/\s+/g, " ").slice(0, 200);
    const name = String(body?.name || "").trim().replace(/\s+/g, " ").slice(0, 120);
    const email = String(body?.email || "").trim().toLowerCase();
    const phone = String(body?.phone || "").replace(/[\s-]/g, "").replace(/^(\+91|0)/, "");

    if (firmName.length < 2) throw new ApiError(400, "Please enter your firm's name.");
    if (name.length < 2) throw new ApiError(400, "Please enter your name.");
    if (!EMAIL_RE.test(email) || email.length > 254) throw new ApiError(400, "Please enter a valid email address.");
    if (!/^[6-9]\d{9}$/.test(phone)) throw new ApiError(400, "Please enter a valid 10-digit mobile number.");

    // Bots are stopped before we reveal anything about the email
    if (!(await verifyTurnstile(String(body?.turnstileToken || ""), ip))) {
      throw new ApiError(400, "The security check failed. Please try again.");
    }
    if (!(await checkRateLimit(`signup-email:${email}`, 3, 60 * 60 * 1000))) {
      throw new ApiError(429, "Too many attempts for this email. Please try again in an hour.");
    }

    const admin = getAdminClient();

    const { data: statusData, error: statusErr } = await admin.rpc("auth_email_status", { p_email: email });
    if (statusErr) {
      console.error("[signup] email status check failed:", statusErr.message);
      throw new ApiError(500, "Could not start the signup. Please try again.");
    }
    const status = (statusData || {}) as EmailStatus;

    if (status.exists && status.has_membership) {
      throw new ApiError(
        409,
        status.confirmed
          ? "An account with this email already exists. Please sign in, or use \"Forgot password\" if you don't remember your password."
          : "This email already has a pending invitation to a firm on Duesk. Please open the invitation email to join."
      );
    }
    if (status.exists && status.confirmed) {
      throw new ApiError(409, "This email is already registered. Please sign in to finish setting up your firm.");
    }
    if (status.exists && !status.confirmed && status.user_id) {
      // An earlier signup was never confirmed: start again with a fresh link
      const { error: delErr } = await admin.auth.admin.deleteUser(status.user_id);
      if (delErr) {
        console.error("[signup] could not clear unconfirmed signup:", delErr.message);
        throw new ApiError(409, "A confirmation email was already sent to this address. Please check your inbox and spam folder.");
      }
    }

    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { name, phone, firm_name: firmName, signup: true },
    });
    if (error) {
      console.error("[signup] invite failed:", error.message);
      if (/rate|limit/i.test(error.message)) {
        throw new ApiError(429, "We're sending a lot of emails right now. Please try again in a few minutes.");
      }
      throw new ApiError(500, "We couldn't send the confirmation email. Please try again later.");
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}