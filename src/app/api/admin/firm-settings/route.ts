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
import { checkRateLimit } from "@/lib/api/rateLimit";
import { verifyCallerPassword } from "@/lib/api/reauth";
import { escapeHtml, sendFirmEmail } from "@/lib/email/mailer";

const TEXT_FIELDS = [
  "firm_name",
  "email",
  "phone",
  "website",
  "address",
  "gstin",
  "pan",
  "invoice_prefix",
  "quotation_prefix",
  "payment_terms",
  "bank_name",
  "bank_account_no",
  "bank_ifsc",
  "upi_id",
  "default_task_priority",
] as const;

const SENSITIVE_FIELDS = ["bank_name", "bank_account_no", "bank_ifsc", "upi_id"];
const UPPERCASE_FIELDS = ["gstin", "pan", "bank_ifsc"];

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[\w.\-]{2,256}@[A-Za-z]{2,64}$/;
const PREFIX_RE = /^[A-Za-z0-9/_\-{}]{1,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mask(field: string, value: string): string {
  if (!value) return "(empty)";
  if (field === "bank_account_no") return `••••${value.slice(-4)}`;
  if (field === "upi_id") {
    const [user, domain] = value.split("@");
    return `${user.slice(0, 2)}•••@${domain || ""}`;
  }
  return value;
}

function validate(s: Record<string, any>) {
  if (!s.firm_name) throw new ApiError(400, "Firm name is required.");
  if (s.email && !EMAIL_RE.test(s.email)) throw new ApiError(400, "Please enter a valid firm email.");
  if (s.gstin && !GSTIN_RE.test(s.gstin)) throw new ApiError(400, "Invalid firm GSTIN.");
  if (s.pan && !PAN_RE.test(s.pan)) throw new ApiError(400, "Invalid firm PAN.");
  if (s.gstin && s.pan && s.gstin.slice(2, 12) !== s.pan) throw new ApiError(400, "The GSTIN does not belong to this PAN.");
  if (s.bank_ifsc && !IFSC_RE.test(s.bank_ifsc)) throw new ApiError(400, "Invalid IFSC code.");
  if (s.upi_id && !UPI_RE.test(s.upi_id)) throw new ApiError(400, "Invalid UPI ID.");
  if (s.bank_account_no && !/^[0-9]{9,18}$/.test(s.bank_account_no)) throw new ApiError(400, "Account number must be 9 to 18 digits.");
  if (!s.invoice_prefix || !PREFIX_RE.test(s.invoice_prefix)) {
    throw new ApiError(400, "Invoice prefix may only use letters, numbers, / - _ and tokens like {FY}.");
  }
  if (s.quotation_prefix && !PREFIX_RE.test(s.quotation_prefix)) {
    throw new ApiError(400, "Quotation prefix may only use letters, numbers, / - _ and tokens like {FY}.");
  }
  if (!(s.default_gst_rate >= 0 && s.default_gst_rate <= 100)) throw new ApiError(400, "Default GST rate must be between 0 and 100.");
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();

    if (!checkRateLimit(`firm-settings:${caller.userId}`, 20, 15 * 60 * 1000)) {
      throw new ApiError(429, "Too many attempts. Please wait a few minutes.");
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Invalid request body.");
    }

    const input = body?.settings ?? {};

    // 1. Whitelist + normalise
    const next: Record<string, any> = {};
    for (const field of TEXT_FIELDS) {
      let v = typeof input[field] === "string" ? input[field].trim().slice(0, 500) : "";
      if (UPPERCASE_FIELDS.includes(field)) v = v.toUpperCase();
      if (field === "bank_account_no") v = v.replace(/\s/g, "");
      next[field] = v;
    }
    next.default_gst_rate = Number(input.default_gst_rate ?? 18);
    next.enable_email_alerts = Boolean(input.enable_email_alerts);

    validate(next);

    // 2. Compare with what is stored
    const admin = getAdminClient();
    const { data: current, error: loadErr } = await admin
      .from("firm_settings")
      .select("*")
      .eq("org_id", caller.orgId)
      .maybeSingle();
    if (loadErr || !current) throw new ApiError(500, "Could not load the current settings.");

    const norm = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    const changed = Object.keys(next).filter((k) => norm(current[k]) !== norm(next[k]));

    if (changed.length === 0) {
      return NextResponse.json({ success: true, changed: [] });
    }

    // 3. Bank / payment details require the admin's password
    const sensitiveChanged = changed.filter((k) => SENSITIVE_FIELDS.includes(k));
    if (sensitiveChanged.length > 0) {
      await verifyCallerPassword(caller.email, body?.adminPassword);
    }

    const update: Record<string, any> = {};
    changed.forEach((k) => {
      update[k] = next[k] === "" ? null : next[k];
    });

    const { error: updateErr } = await admin.from("firm_settings").update(update).eq("org_id", caller.orgId);
    if (updateErr) {
      console.error("[firm-settings] update error:", updateErr.message);
      throw new ApiError(400, updateErr.message);
    }

    // 4. Audit trail (sensitive values masked)
    const bankChanges = Object.fromEntries(
      sensitiveChanged.map((k) => [k, { from: mask(k, norm(current[k])), to: mask(k, norm(next[k])) }])
    );
    await writeAuditLog({
      actor: caller,
      action: "UPDATE_SETTINGS",
      entity: "SETTINGS",
      entity_id: null,
      metadata: { changed, ...(sensitiveChanged.length ? { bank_changes: bankChanges } : {}) },
    });

    // 5. Alert every other admin when payment details change
    if (sensitiveChanged.length > 0) {
      try {
        const { data: adminMembers } = await admin
          .from("memberships")
          .select("user_id")
          .eq("org_id", caller.orgId)
          .eq("role", "admin")
          .eq("is_active", true)
          .neq("user_id", caller.userId);
        const adminIds = (adminMembers || []).map((m: any) => m.user_id);
        const { data: admins } = adminIds.length
          ? await admin.from("profiles").select("email").in("id", adminIds)
          : { data: [] as any[] };

        const recipients = (admins || []).map((a: any) => a.email).filter(Boolean);
        if (recipients.length > 0) {
          const rows = sensitiveChanged
            .map((k) => `<li><strong>${escapeHtml(k.replace(/_/g, " "))}</strong>: ${escapeHtml(bankChanges[k].from)} → ${escapeHtml(bankChanges[k].to)}</li>`)
            .join("");
          await sendFirmEmail({
            orgId: caller.orgId,
            to: recipients,
            subject: "Security alert: firm bank / payment details were changed",
            html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">
              <p>The payment details printed on your invoices were changed by <strong>${escapeHtml(caller.name)}</strong> (${escapeHtml(caller.email || "")})
              on ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.</p>
              <ul>${rows}</ul>
              <p>If you did not expect this change, sign in to Finetax Manager immediately and review Firm Settings.</p></div>`,
            text: `Firm payment details were changed by ${caller.name}. Fields: ${sensitiveChanged.join(", ")}. Review Firm Settings if unexpected.`,
          });
        }
      } catch (mailErr) {
        console.error("[firm-settings] alert email failed:", mailErr);
      }
    }

    return NextResponse.json({ success: true, changed });
  } catch (err) {
    return errorResponse(err);
  }
}