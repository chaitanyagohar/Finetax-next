export type ChatAttachment = { path: string; name: string; size: number; type: string };

export type ChatMessage = {
  id: string;
  channel_id: string;
  sender_id: string | null;
  body: string;
  mentions: string[];
  attachments: ChatAttachment[];
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

export type ChatChannel = {
  id: string;
  kind: "channel" | "dm" | "task";
  name: string | null;
  description: string | null;
  is_private: boolean;
  task_id: string | null;
  created_by: string | null;
  last_message_at: string;
  archived_at: string | null;
};

export type ChatPerson = { id: string; name: string; is_active?: boolean; role?: string };

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const CHAT_FILE_TYPES =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv,.xlsx,.xls,.docx,.doc";