export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { verifyTurnstile } from "@/lib/auth/turnstile";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Step 1 of signup: send a "confirm your email" invite. Same answer whether or not the email exists. */
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

    if (!(await verifyTurnstile(String(body?.turnstileToken || ""), ip))) {
      throw new ApiError(400, "The security check failed. Please try again.");
    }
    if (!(await checkRateLimit(`signup-email:${email}`, 3, 60 * 60 * 1000))) {
      throw new ApiError(429, "Too many attempts for this email. Please try again in an hour.");
    }

    const admin = getAdminClient();
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { name, phone, firm_name: firmName, signup: true },
    });

    // An existing account gets the same answer (so the form can't be used to discover users)
    if (error && !/already|registered|exists/i.test(error.message)) {
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