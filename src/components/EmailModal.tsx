"use client";

import { useState, useEffect } from "react";
import { X, Paperclip, Send, Loader2 } from "lucide-react";

interface EmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTo?: string;
  defaultSubject?: string;
  defaultBody?: string;
  attachmentName?: string;
  attachmentBlob?: Blob | null;
  onSuccess?: () => void;
}

export default function EmailModal({
  isOpen,
  onClose,
  defaultTo = "",
  defaultSubject = "",
  defaultBody = "",
  attachmentName = "",
  attachmentBlob = null,
  onSuccess,
}: EmailModalProps) {
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setTo(defaultTo);
    setSubject(defaultSubject);
    setBody(defaultBody);
  }, [defaultTo, defaultSubject, defaultBody]);

  if (!isOpen) return null;

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);

    try {
      const formData = new FormData();
      formData.append("to", to);
      formData.append("subject", subject);
      formData.append("body", body);

      if (file) {
        formData.append("file", file);
      } else if (attachmentBlob && attachmentName) {
        formData.append("file", new File([attachmentBlob], attachmentName, { type: "application/pdf" }));
      }

      const res = await fetch("/api/send-email", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");

      alert("Email sent successfully!");
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      alert("Error sending email: " + err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-surface rounded-lg border border-border w-full max-w-lg p-5 space-y-4 shadow-xl text-xs">
        <div className="flex justify-between items-center border-b border-border pb-3">
          <h3 className="font-semibold text-sm text-text-main">Send Email</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-main">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSend} className="space-y-3">
          <div>
            <label className="block font-semibold text-text-muted mb-1">RECIPIENT EMAIL *</label>
            <input
              type="email"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full border border-border rounded p-2 text-xs"
              placeholder="client@domain.com"
            />
          </div>

          <div>
            <label className="block font-semibold text-text-muted mb-1">SUBJECT *</label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full border border-border rounded p-2 text-xs"
            />
          </div>

          <div>
            <label className="block font-semibold text-text-muted mb-1">MESSAGE BODY (EDITABLE)</label>
            <textarea
              rows={6}
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full border border-border rounded p-2 text-xs font-mono"
            />
          </div>

          {/* Attachment Row */}
          <div className="border border-border rounded p-2.5 bg-background flex items-center justify-between">
            <div className="flex items-center gap-2 text-text-muted">
              <Paperclip className="h-4 w-4 shrink-0 text-navy" />
              <span className="truncate font-medium">
                {file ? file.name : attachmentName || "No file attached"}
              </span>
            </div>
            <label className="cursor-pointer text-navy font-semibold hover:underline text-[11px]">
              {file || attachmentName ? "Change File" : "Attach File"}
              <input
                type="file"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="px-4 py-1.5 border border-border rounded text-text-main hover:bg-background"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending}
              className="px-4 py-1.5 bg-navy text-white rounded font-medium hover:bg-navy/90 flex items-center gap-1.5"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {sending ? "Sending..." : "Send Email"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}