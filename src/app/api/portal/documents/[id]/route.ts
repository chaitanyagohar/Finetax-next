export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, errorResponse, getAdminClient } from "@/lib/api/guard";
import { requirePortal } from "@/lib/portal/guard";
import { isVaultPathAllowed } from "@/lib/storage/vaultPath";
import { UUID_RE } from "@/lib/validate";

/** Opens a document the firm has shared with this client, through a link valid for one minute. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const s = await requirePortal();
    const { id } = await params;
    if (!UUID_RE.test(id)) throw new ApiError(404, "Not found.");
    const admin = getAdminClient();
    const { data: doc } = await admin
      .from("documents")
      .select("storage_path, bucket, file_name, title")
      .eq("id", id)
      .eq("org_id", s.orgId)
      .eq("client_id", s.clientId)
      .eq("shared_with_client", true)
      .maybeSingle();
    if (!doc?.storage_path) throw new ApiError(404, "Document not found.");
    const bucket = doc.bucket || "firm-documents";
    if (!(await isVaultPathAllowed(admin, s.orgId, bucket, doc.storage_path))) throw new ApiError(404, "Document not found.");
    const { data, error } = await admin.storage.from(bucket).createSignedUrl(doc.storage_path, 60, { download: doc.file_name || doc.title || true });
    if (error || !data?.signedUrl) throw new ApiError(500, "Could not open this document.");
    return NextResponse.redirect(data.signedUrl);
  } catch (err) {
    return errorResponse(err);
  }
}
