export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { requirePortal } from "@/lib/portal/guard";
import { UUID_RE } from "@/lib/validate";

const BUCKET = "firm-documents";
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif)|application\/(vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document)|vnd\.ms-excel|msword|zip|x-zip-compressed)|text\/csv)$/;

function sizeText(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A client sends a file, either for one item the firm asked for, or on its own. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const s = await requirePortal();
    if (!(await checkRateLimit(`portal-upload:${s.portalUserId}`, 60, 60 * 60 * 1000))) {
      throw new ApiError(429, "Too many uploads in a short time. Please wait a little.");
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const itemId = String(form?.get("itemId") || "");
    const note = String(form?.get("note") || "").trim().slice(0, 300);
    if (!(file instanceof File)) throw new ApiError(400, "Choose a file to upload.");
    if (file.size <= 0 || file.size > MAX_BYTES) throw new ApiError(400, "Files can be up to 15 MB.");
    if (!ALLOWED.test(file.type)) throw new ApiError(400, "Upload a PDF, photo, Excel, Word, CSV or ZIP file.");

    const admin = getAdminClient();
    type Item = { id: string; label: string; task_id: string; tasks: { title: string; period: string | null; assigned_to: string | null } };
    let item: Item | null = null;
    if (itemId) {
      if (!UUID_RE.test(itemId)) throw new ApiError(400, "Invalid request.");
      const { data } = await admin
        .from("task_checklist_items")
        .select("id, label, task_id, tasks!inner(title, period, assigned_to, client_id, org_id)")
        .eq("id", itemId)
        .eq("org_id", s.orgId)
        .eq("tasks.client_id", s.clientId)
        .maybeSingle();
      if (!data) throw new ApiError(404, "This request is no longer open.");
      const raw = data as unknown as Omit<Item, "tasks"> & { tasks: Item["tasks"] | Item["tasks"][] };
      item = { ...raw, tasks: Array.isArray(raw.tasks) ? raw.tasks[0] : raw.tasks };
    }

    const safe = file.name.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(0, 120) || "file";
    const path = `${s.orgId}/${s.clientId}/${new Date().getFullYear()}/${randomUUID()}-${safe}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
    if (upErr) throw new ApiError(500, "The file could not be saved. Please try again.");

    const title = item ? item.label : file.name.replace(/\.[^/.]+$/, "");
    const { data: doc, error: docErr } = await admin
      .from("documents")
      .insert({
        org_id: s.orgId,
        client_id: s.clientId,
        task_id: item?.task_id ?? null,
        title: title.slice(0, 150),
        category: "KYC",
        description: [`Uploaded by ${s.name || s.email} through the client portal.`, note].filter(Boolean).join(" ").slice(0, 500),
        storage_path: path,
        bucket: BUCKET,
        file_name: file.name.slice(0, 200),
        size_bytes: file.size,
        mime_type: file.type,
        file_size: sizeText(file.size),
        from_client: true,
        shared_with_client: true,
      })
      .select("id")
      .single();
    if (docErr || !doc) {
      await admin.storage.from(BUCKET).remove([path]);
      throw new ApiError(500, "The file could not be saved. Please try again.");
    }

    if (item) {
      await admin.from("task_checklist_items").update({ status: "received", document_id: doc.id }).eq("id", item.id);
    }

    // Tell whoever is doing the work (or the client's owner) that the file arrived
    let notify = item?.tasks?.assigned_to || null;
    if (!notify) {
      const { data: c } = await admin.from("clients").select("assigned_to").eq("id", s.clientId).maybeSingle();
      notify = c?.assigned_to || null;
    }
    if (notify) {
      await admin.from("notifications").insert({
        org_id: s.orgId,
        user_id: notify,
        type: "portal_upload",
        title: `${s.clientName} uploaded ${item ? item.label : "a document"}`,
        body: item ? `For ${item.tasks.title}${item.tasks.period ? ` (${item.tasks.period})` : ""}.` : file.name,
        link: item ? `/tasks?task=${item.task_id}` : "/documents",
        entity: "documents",
        entity_id: doc.id,
        priority: "normal",
      });
    }

    await writeAuditLog({ orgId: s.orgId, action: "PORTAL_UPLOAD", entity: "DOCUMENTS", entity_id: doc.id, metadata: { by: s.email, item: item?.label || null } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
