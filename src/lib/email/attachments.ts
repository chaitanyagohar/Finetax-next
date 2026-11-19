/**
 * Saves files that arrive with inbound email (B-22). SERVER ONLY.
 * Every kept attachment is stored in the firm's private vault bucket and listed on the email.
 * When the sender is a known client, it is also filed in that client's documents.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "firm-documents";
const MAX_FILE = 15 * 1024 * 1024;
const MAX_PER_MESSAGE = 10;

export interface MailFile {
  filename: string;
  contentType: string;
  content: Buffer;
}

type ParsedAttachment = {
  filename?: string;
  contentType?: string;
  contentDisposition?: string;
  related?: boolean;
  cid?: string;
  size?: number;
  content?: Buffer;
};

/** The attachments worth keeping: real files, not signature logos or inline images. */
export function keptAttachments(list: ParsedAttachment[] | undefined): MailFile[] {
  return (list || [])
    .filter((a) => a.content && a.content.length > 0 && a.content.length <= MAX_FILE)
    .filter((a) => !(a.related || (a.cid && a.contentDisposition !== "attachment")))
    .filter((a) => !(String(a.contentType || "").startsWith("image/") && (a.content?.length || 0) < 20 * 1024))
    .slice(0, MAX_PER_MESSAGE)
    .map((a) => ({
      filename: (a.filename || "attachment").slice(0, 180),
      contentType: a.contentType || "application/octet-stream",
      content: a.content as Buffer,
    }));
}

function safeName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(0, 120) || "file";
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Stores the files of saved messages. Failures are logged and skipped; the email itself is already saved. */
export async function storeMailFiles(
  admin: SupabaseClient,
  orgId: string,
  saved: { id: string; message_id: string; client_id: string | null; subject: string | null }[],
  filesByMessageId: Map<string, MailFile[]>,
): Promise<number> {
  let stored = 0;
  const { data: allowed } = await admin.rpc("org_has_feature", { p_org: orgId, p_feature: "email_attachments" });
  if (allowed !== true) return 0;
  const year = new Date().getFullYear();
  for (const msg of saved) {
    for (const file of filesByMessageId.get(msg.message_id) || []) {
      const path = `${orgId}/${msg.client_id || "email"}/${year}/${randomUUID()}-${safeName(file.filename)}`;
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, file.content, { contentType: file.contentType, upsert: false });
      if (upErr) {
        console.error("[mail-files] upload failed:", upErr.message);
        continue;
      }

      let documentId: string | null = null;
      if (msg.client_id) {
        const { data: doc, error: docErr } = await admin
          .from("documents")
          .insert({
            org_id: orgId,
            client_id: msg.client_id,
            title: file.filename.replace(/\.[^/.]+$/, "").slice(0, 150),
            category: "Correspondence",
            description: `Received by email: ${msg.subject || "(no subject)"}`.slice(0, 500),
            storage_path: path,
            bucket: BUCKET,
            file_name: file.filename,
            size_bytes: file.content.length,
            mime_type: file.contentType,
            file_size: sizeText(file.content.length),
          })
          .select("id")
          .single();
        if (docErr) console.error("[mail-files] vault entry failed:", docErr.message);
        documentId = doc?.id || null;
      }

      const { error } = await admin.from("email_attachments").insert({
        org_id: orgId,
        message_id: msg.id,
        file_name: file.filename,
        file_url: path,
        file_size: sizeText(file.content.length),
        bucket: BUCKET,
        storage_path: path,
        mime_type: file.contentType,
        size_bytes: file.content.length,
        document_id: documentId,
      });
      if (error) console.error("[mail-files] attachment row failed:", error.message);
      else stored++;
    }
  }
  return stored;
}
