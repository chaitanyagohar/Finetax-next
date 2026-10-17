export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { EMAIL_RE, escapeHtml, sendFirmEmail } from "@/lib/email/mailer";
import { verifyProposalToken } from "@/lib/publicLinks";
import { loadProposalBundle, renderEngagementLetter } from "@/lib/pdf/engagementLetter";
import { pdfFileName } from "@/lib/pdf/firmDocuments";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    assertSameOrigin(request);
    const { token } = await params;
    const id = verifyProposalToken(token);
    if (!id) throw new ApiError(404, "This link isn't valid.");

    const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "";
    if (!checkRateLimit(`engagement:${ip || "unknown"}:${id}`, 8, 10 * 60 * 1000)) {
      throw new ApiError(429, "Too many attempts. Please wait a few minutes and try again.");
    }

    const body = await request.json().catch(() => ({}));
    const admin = getAdminClient();

    if (body?.action === "decline") {
      const { error } = await admin.rpc("decline_proposal_online", { p_id: id, p_reason: String(body?.reason || "").slice(0, 500) });
      if (error) throw new ApiError(400, error.message);
      return NextResponse.json({ success: true });
    }

    if (body?.action !== "accept") throw new ApiError(400, "Invalid request.");
    const name = String(body?.name || "").trim().slice(0, 120);
    if (name.length < 2) throw new ApiError(400, "Please enter your full name.");
    if (body?.agree !== true) throw new ApiError(400, "Please confirm you agree to the terms.");

    const { data, error } = await admin.rpc("accept_proposal_online", {
      p_id: id,
      p_name: name,
      p_designation: String(body?.designation || "").trim().slice(0, 120),
      p_ip: ip,
      p_ua: String(request.headers.get("user-agent") || "").slice(0, 300),
    });
    if (error) throw new ApiError(400, error.message);

    // Confirmation email with the accepted letter (best effort)
    try {
      const bundle = await loadProposalBundle(admin, id);
      const to = String(bundle?.proposal.recipient_email || bundle?.client?.email || "").toLowerCase();
      if (bundle && EMAIL_RE.test(to)) {
        const pdf = await renderEngagementLetter(bundle);
        const firmName = bundle.firm?.firm_name || "Our firm";
        await sendFirmEmail({
          to,
          subject: `Engagement confirmed: ${bundle.pkg?.name || "Professional services"} (${bundle.proposal.number})`,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;max-width:600px">
            <p>Dear ${escapeHtml(name)},</p>
            <p>Thank you for accepting our engagement for <strong>${escapeHtml(bundle.pkg?.name || "professional services")}</strong>. The accepted letter is attached for your records.</p>
            <p>Our team will be in touch about the documents we need to get started.</p>
            <p>Regards,<br/><strong>${escapeHtml(firmName)}</strong></p></div>`,
          text: `Thank you for accepting engagement ${bundle.proposal.number}. The accepted letter is attached.`,
          attachments: [{ filename: pdfFileName(bundle.proposal.number, "Engagement-Letter"), content: pdf, contentType: "application/pdf" }],
        });
      }
    } catch (mailErr) {
      console.error("[engagement] confirmation email failed:", mailErr);
    }

    return NextResponse.json({ success: true, tasks_created: (data as any)?.tasks_created ?? 0 });
  } catch (err) {
    return errorResponse(err);
  }
}