export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/api/guard";
import { verifyProposalToken } from "@/lib/publicLinks";
import { loadProposalBundle, renderEngagementLetter } from "@/lib/pdf/engagementLetter";
import { pdfFileName } from "@/lib/pdf/firmDocuments";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = verifyProposalToken(token);
  if (!id) return new NextResponse("This link isn't valid.", { status: 404 });

  const bundle = await loadProposalBundle(getAdminClient(), id);
  if (!bundle || bundle.proposal.status === "Withdrawn") return new NextResponse("Engagement letter not found.", { status: 404 });

  try {
    const pdf = await renderEngagementLetter(bundle);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pdfFileName(bundle.proposal.number, "Engagement-Letter")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (err) {
    console.error("[public-engagement-pdf] render failed:", err);
    return new NextResponse("Could not generate the PDF. Please try again later.", { status: 500 });
  }
}