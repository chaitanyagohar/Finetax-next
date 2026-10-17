export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireAdmin, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { EMAIL_RE, escapeHtml, sendFirmEmail } from "@/lib/email/mailer";
import { loadProposalBundle, renderEngagementLetter } from "@/lib/pdf/engagementLetter";
import { pdfFileName } from "@/lib/pdf/firmDocuments";
import { proposalUrl } from "@/lib/publicLinks";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    if (!checkRateLimit(`proposal-send:${caller.userId}`, 20, 10 * 60 * 1000)) throw new ApiError(429, "Too many emails. Please wait a few minutes.");

    const body = await request.json().catch(() => ({}));
    const proposalId = typeof body?.proposalId === "string" ? body.proposalId : "";
    if (!UUID_RE.test(proposalId)) throw new ApiError(400, "Invalid proposal.");

    const admin = getAdminClient();
    const bundle = await loadProposalBundle(admin, proposalId);
    if (!bundle) throw new ApiError(404, "Proposal not found.");
    const { proposal, client, pkg, firm } = bundle;
    if (["Accepted", "Declined", "Withdrawn"].includes(proposal.status)) throw new ApiError(400, `This proposal is already ${proposal.status.toLowerCase()}.`);

    const to = String(body?.to || proposal.recipient_email || client?.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(to)) throw new ApiError(400, "Enter a valid client email address.");

    const pdf = await renderEngagementLetter({ ...bundle, proposal: { ...proposal, sent_at: proposal.sent_at || new Date().toISOString() } });
    const firmName = firm?.firm_name || "Our firm";
    const message = String(body?.message ?? proposal.cover_message ?? "").trim();
    const link = proposalUrl(proposalId);
    const validity = proposal.expires_at ? ` This proposal is valid until ${escapeHtml(String(proposal.expires_at).split("-").reverse().join("/"))}.` : "";

    await sendFirmEmail({
      to,
      subject: `Engagement letter ${proposal.number}: ${pkg?.name || "Professional services"}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6;max-width:600px">
        <p>Dear ${escapeHtml(client?.name || "Client")},</p>
        ${
          message
            ? `<p>${escapeHtml(message).replace(/\n/g, "<br/>")}</p>`
            : `<p>Thank you for considering us. Please find attached our engagement letter for <strong>${escapeHtml(pkg?.name || "professional services")}</strong>, setting out the scope of work, fees and terms.</p>`
        }
        <p style="margin:22px 0"><a href="${link}" style="background:#10233f;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">Review &amp; accept online</a></p>
        <p style="font-size:12px;color:#64748b">Or open this link: <a href="${link}">${link}</a><br/>You can also sign the attached letter and send us a copy.${validity}</p>
        <p>Regards,<br/><strong>${escapeHtml(firmName)}</strong></p></div>`,
      text: `Engagement letter ${proposal.number} attached. Review and accept online: ${link}`,
      attachments: [{ filename: pdfFileName(proposal.number, "Engagement-Letter"), content: pdf, contentType: "application/pdf" }],
    });

    await admin
      .from("proposals")
      .update({ status: proposal.status === "Draft" ? "Sent" : proposal.status, sent_at: new Date().toISOString(), recipient_email: to })
      .eq("id", proposalId);

    await writeAuditLog({ actor: caller, action: "SEND_PROPOSAL", entity: "PROPOSALS", entity_id: proposalId, metadata: { number: proposal.number, to } });
    return NextResponse.json({ success: true, message: `Engagement letter ${proposal.number} emailed to ${to}.` });
  } catch (err) {
    return errorResponse(err);
  }
}