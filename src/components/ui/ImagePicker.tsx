"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";

/** Pick, upload and remove one image (profile photo or firm logo) through a server route. */
export default function ImagePicker({
  endpoint,
  current,
  preview,
  label,
  onChange,
}: {
  endpoint: string;
  current: string | null;
  preview: React.ReactNode;
  label: string;
  onChange: (url: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setError("");
    if (file.size > 2 * 1024 * 1024) return setError("Images can be up to 2 MB.");
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(endpoint, { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error || "Upload failed.");
    onChange(json.url);
  }

  async function remove() {
    setBusy(true);
    const res = await fetch(endpoint, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setError("Could not remove it.");
    onChange(null);
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        {preview}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-main hover:bg-surface-alt disabled:opacity-60"
          >
            <Camera className="h-3.5 w-3.5" /> {current ? `Change ${label}` : `Add ${label}`}
          </button>
          {current && (
            <button type="button" onClick={remove} disabled={busy} className="rounded-lg p-1.5 text-text-muted hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${label}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-text-muted">PNG, JPG or WebP, up to 2 MB.</p>
        {error && <p className="text-[11px] font-medium text-rose-600">{error}</p>}
      </div>
    </div>
  );
}
