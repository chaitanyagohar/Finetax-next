"use client";

import { useEffect, useState } from "react";
import { FileText, FolderCheck, Loader2, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Attachment = {
  id: string;
  file_name: string;
  file_size: string | null;
  bucket: string | null;
  storage_path: string | null;
  document_id: string | null;
};

/** Files that came with an email. They open through a short-lived private link. */
export default function MessageAttachments({ messageId }: { messageId: string }) {
  const [supabase] = useState(() => createClient());
  const [files, setFiles] = useState<Attachment[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("email_attachments")
      .select("id, file_name, file_size, bucket, storage_path, document_id")
      .eq("message_id", messageId)
      .order("created_at")
      .then(({ data }) => {
        if (!cancelled) setFiles((data || []) as Attachment[]);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, messageId]);

  async function open(file: Attachment) {
    if (!file.storage_path) return;
    setOpeningId(file.id);
    setError("");
    const { data, error: err } = await supabase.storage
      .from(file.bucket || "firm-documents")
      .createSignedUrl(file.storage_path, 120, { download: file.file_name });
    setOpeningId(null);
    if (err || !data?.signedUrl) return setError("Could not open this file.");
    window.location.assign(data.signedUrl);
  }

  if (!files.length) return null;

  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        <Paperclip className="h-3.5 w-3.5" /> {files.length} attachment{files.length === 1 ? "" : "s"}
      </p>
      <div className="flex flex-wrap gap-2">
        {files.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => open(f)}
            disabled={!f.storage_path || openingId === f.id}
            className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs hover:border-accent/40 hover:bg-surface-alt disabled:opacity-60"
          >
            {openingId === f.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <FileText className="h-4 w-4 shrink-0 text-accent" />}
            <span className="min-w-0">
              <span className="block truncate font-medium text-text-main">{f.file_name}</span>
              <span className="flex items-center gap-1 text-[10px] text-text-muted">
                {f.file_size}
                {f.document_id && (
                  <>
                    · <FolderCheck className="h-3 w-3 text-emerald-600" /> in client documents
                  </>
                )}
              </span>
            </span>
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-[11px] font-medium text-rose-600">{error}</p>}
    </div>
  );
}
