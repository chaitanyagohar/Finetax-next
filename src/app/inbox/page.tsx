"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Mail,
  Send,
  Inbox,
  Settings,
  Plus,
  Trash2,
  Paperclip,
  X,
  FileText,
  Reply,
  Sparkles,
  Upload,
  Receipt,
  Forward,
  MailOpen,
  Mail as MailClosed,
  XOctagon,
  Folder,
  RefreshCw,
  Search,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  KeyRound,
  Power,
  Building2,
  MessageSquare,
  Activity,
  ChevronDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import ClientPicker, { clientLabel, sortByLabel } from "@/components/ui/ClientPicker";
import PasswordInput from "@/components/ui/PasswordInput";
import { formatDate, localISODate } from "@/lib/format";

const PAGE_SIZE = 100;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PROVIDERS = [
  { key: "gmail", label: "Gmail / Google Workspace", smtpHost: "smtp.gmail.com", smtpPort: 587, imapHost: "imap.gmail.com", imapPort: 993, help: "Use a Google App Password (Google Account → Security → App passwords), not your normal password." },
  { key: "outlook", label: "Microsoft 365 / Outlook", smtpHost: "smtp.office365.com", smtpPort: 587, imapHost: "outlook.office365.com", imapPort: 993, help: "SMTP AUTH must be enabled for this mailbox in the Microsoft 365 admin centre." },
  { key: "zoho", label: "Zoho Mail (India)", smtpHost: "smtp.zoho.in", smtpPort: 587, imapHost: "imap.zoho.in", imapPort: 993, help: "Use an app-specific password if two-factor login is on." },
  { key: "hostinger", label: "Hostinger", smtpHost: "smtp.hostinger.com", smtpPort: 465, imapHost: "imap.hostinger.com", imapPort: 993, help: "Use the mailbox password from your Hostinger panel." },
  { key: "titan", label: "Titan / GoDaddy", smtpHost: "smtp.titan.email", smtpPort: 465, imapHost: "imap.titan.email", imapPort: 993, help: "Use the Titan mailbox password." },
  { key: "custom", label: "Other (custom server)", smtpHost: "", smtpPort: 587, imapHost: "", imapPort: 993, help: "Ask your email provider for SMTP and IMAP settings." },
];

type Attachment =
  | { kind: "file"; name: string; file: File }
  | { kind: "invoice"; name: string; id: string }
  | { kind: "quotation"; name: string; id: string }
  | { kind: "link"; name: string; url: string };

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15 disabled:bg-surface-alt";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

function formatListDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (localISODate(d) === localISODate()) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  return formatDate(localISODate(d));
}
function formatFullDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${formatDate(localISODate(d))} ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}
function cleanSearch(s: string): string {
  return s.replace(/[,()%*\\]/g, " ").trim().slice(0, 80);
}

export default function UnifiedInboxPage() {
  const currentUser = useCurrentUser();
  const me = currentUser?.id || "";
  const isAdmin = !!currentUser?.isAdmin;
  const [supabase] = useState(() => createClient());

  const [accounts, setAccounts] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [systemFiles, setSystemFiles] = useState<{ kind: "invoice" | "quotation" | "link"; id?: string; url?: string; name: string; type: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Sync State & Abort Controller
  const [isSyncing, setIsSyncing] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // View States
  const [activeTab, setActiveTab] = useState<"inbox" | "sent" | "settings">("inbox");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");
  const [selectedMessage, setSelectedMessage] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "deleteMessage" | "deleteAccount"; target: any }>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Composer State
  const [isComposing, setIsComposing] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeFromId, setComposeFromId] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [fileSearch, setFileSearch] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [sending, setSending] = useState(false);
  const [composeError, setComposeError] = useState("");

  // Account management
  const [providerKey, setProviderKey] = useState("gmail");
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpHost, setSmtpHost] = useState(PROVIDERS[0].smtpHost);
  const [smtpPort, setSmtpPort] = useState(String(PROVIDERS[0].smtpPort));
  const [imapHost, setImapHost] = useState(PROVIDERS[0].imapHost);
  const [imapPort, setImapPort] = useState(String(PROVIDERS[0].imapPort));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [passwordTarget, setPasswordTarget] = useState<any | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const provider = PROVIDERS.find((p) => p.key === providerKey) || PROVIDERS[0];

  useEffect(() => {
    loadAccounts();
    loadClients();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(cleanSearch(search)), 400);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (activeTab === "settings") return;
    setSelectedMessage(null);
    loadMessages(true);
    loadUnreadCount();
  }, [selectedAccountId, activeTab, debouncedSearch]);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 5000);
  }

  async function loadAccounts() {
    const { data } = await supabase
      .from("email_accounts")
      .select("id, email_address, display_name, smtp_host, smtp_port, imap_host, imap_port, is_active, smtp_secret_id, created_at")
      .order("created_at", { ascending: true });
    const list = data || [];
    setAccounts(list);
    if (!composeFromId) {
      const firstActive = list.find((a: any) => a.is_active !== false);
      if (firstActive) setComposeFromId(firstActive.id);
    }
  }

  async function loadClients() {
    const { data } = await supabase
      .from("clients")
      .select("id, name, organization_name, email, phone, pan, gstin, status")
      .order("name", { ascending: true });
    setClients(data || []);
  }

  async function loadSystemFiles() {
    const [docRes, invRes, quoRes] = await Promise.all([
      supabase.from("documents").select("id, title, file_url"),
      supabase.from("invoices").select("id, invoice_number, status").neq("status", "Cancelled").order("created_at", { ascending: false }).limit(200),
      supabase.from("quotations").select("id, quote_number").order("created_at", { ascending: false }).limit(200),
    ]);
    setSystemFiles([
      ...(invRes.data || []).map((i: any) => ({ kind: "invoice" as const, id: i.id, name: `Invoice ${i.invoice_number || i.id.slice(0, 6)}`, type: "Invoice PDF" })),
      ...(quoRes.data || []).map((q: any) => ({ kind: "quotation" as const, id: q.id, name: `Quotation ${q.quote_number || q.id.slice(0, 6)}`, type: "Quotation PDF" })),
      ...(docRes.data || [])
        .filter((d: any) => d.file_url)
        .map((d: any) => ({ kind: "link" as const, url: d.file_url, name: d.title || "Document", type: "Vault link" })),
    ]);
  }

  function messageQuery() {
    let query = supabase
      .from("email_messages")
      .select("id, account_id, client_id, direction, from_address, to_address, subject, body_text, is_read, received_at")
      .eq("direction", activeTab === "sent" ? "outbound" : "inbound");
    if (selectedAccountId !== "all") query = query.eq("account_id", selectedAccountId);
    if (debouncedSearch) {
      query = query.or(`subject.ilike.%${debouncedSearch}%,from_address.ilike.%${debouncedSearch}%,to_address.ilike.%${debouncedSearch}%`);
    }
    return query;
  }

  async function loadMessages(reset: boolean) {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    const from = reset ? 0 : messages.length;
    const { data, error } = await messageQuery().order("received_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
    if (error) showToast("error", "Could not load messages.");
    const rows = data || [];
    setMessages(reset ? rows : [...messages, ...rows]);
    setHasMore(rows.length === PAGE_SIZE);
    setLoading(false);
    setLoadingMore(false);
  }

  async function loadUnreadCount() {
    let q = supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("direction", "inbound").eq("is_read", false);
    if (selectedAccountId !== "all") q = q.eq("account_id", selectedAccountId);
    const { count } = await q;
    setUnreadCount(count || 0);
  }

  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [String(c.id), c])), [clients]);
  const accountById = useMemo(() => Object.fromEntries(accounts.map((a) => [String(a.id), a])), [accounts]);
  const activeAccounts = accounts.filter((a) => a.is_active !== false);

  /* ---------------- Sync ---------------- */

  async function syncOne(accountId: string, signal: AbortSignal): Promise<number> {
    const res = await fetch("/api/sync-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${accountById[accountId]?.email_address || "Account"}: ${data.error || "sync failed"}`);
    return Number(data.count || 0);
  }

  async function handleSyncEmails() {
    const targets = selectedAccountId === "all" ? activeAccounts.map((a) => a.id) : [selectedAccountId];
    if (targets.length === 0) return showToast("error", "No active email accounts to sync.");

    setIsSyncing(true);
    abortControllerRef.current = new AbortController();
    let total = 0;
    const failures: string[] = [];

    try {
      for (const id of targets) {
        try {
          total += await syncOne(id, abortControllerRef.current.signal);
        } catch (err: any) {
          if (err.name === "AbortError") throw err;
          failures.push(err.message);
        }
      }
      if (failures.length) showToast("error", failures.join(" · "));
      else showToast("success", total ? `${total} new email${total === 1 ? "" : "s"} received.` : "You're up to date.");
      loadMessages(true);
      loadUnreadCount();
    } catch (err: any) {
      if (err.name === "AbortError") showToast("success", "Stopped waiting. The sync may finish in the background.");
    } finally {
      setIsSyncing(false);
      abortControllerRef.current = null;
    }
  }

  function handleStopSync() {
    abortControllerRef.current?.abort();
  }

  /* ---------------- Message actions ---------------- */

  async function openMessage(msg: any) {
    setSelectedMessage(msg);
    if (!msg.is_read && msg.direction === "inbound") toggleReadStatus(msg, true);
  }

  async function toggleReadStatus(msg: any, nextRead?: boolean) {
    const value = nextRead ?? !msg.is_read;
    const { error } = await supabase.from("email_messages").update({ is_read: value }).eq("id", msg.id);
    if (error) return showToast("error", "Could not update the message.");
    setMessages((list) => list.map((m) => (m.id === msg.id ? { ...m, is_read: value } : m)));
    setSelectedMessage((s: any) => (s?.id === msg.id ? { ...s, is_read: value } : s));
    if (msg.direction === "inbound") setUnreadCount((c) => Math.max(0, c + (value ? -1 : 1)));
  }

  async function deleteMessage() {
    const msg = confirm?.target;
    if (!msg) return;
    setActionBusy(true);
    const { error } = await supabase.from("email_messages").delete().eq("id", msg.id);
    setActionBusy(false);
    setConfirm(null);
    if (error) return showToast("error", "Could not delete this email. Only administrators can delete emails.");
    logAuditEvent("DELETE_EMAIL", "EMAIL_MESSAGES", msg.id, { subject: msg.subject });
    setMessages((list) => list.filter((m) => m.id !== msg.id));
    if (selectedMessage?.id === msg.id) setSelectedMessage(null);
    showToast("success", "Email deleted.");
  }

  async function linkClient(msg: any, clientId: string) {
    const { error } = await supabase.from("email_messages").update({ client_id: clientId || null }).eq("id", msg.id);
    if (error) return showToast("error", "Could not link this email.");
    setMessages((list) => list.map((m) => (m.id === msg.id ? { ...m, client_id: clientId || null } : m)));
    setSelectedMessage((s: any) => (s?.id === msg.id ? { ...s, client_id: clientId || null } : s));
    showToast("success", clientId ? `Linked to ${clientLabel(clientById[clientId])}.` : "Client link removed.");
  }

  async function logAsDiscussion(msg: any) {
    if (!msg.client_id) return showToast("error", "Link this email to a client first.");
    const { error } = await supabase.from("discussions").insert([
      {
        client_id: msg.client_id,
        date: localISODate(new Date(msg.received_at)),
        mode: "Email",
        summary: (msg.subject || "Email").slice(0, 200),
        notes: String(msg.body_text || "").slice(0, 2000),
        handled_by: me,
      },
    ]);
    if (error) return showToast("error", error.message);
    showToast("success", "Saved to Client Discussions.");
  }

  /* ---------------- Compose ---------------- */

  function openCompose(preset?: { to?: string; subject?: string; body?: string; fromId?: string }) {
    setComposeTo(preset?.to || "");
    setComposeSubject(preset?.subject || "");
    setComposeBody(preset?.body || "");
    if (preset?.fromId && accountById[preset.fromId]?.is_active !== false) setComposeFromId(preset.fromId);
    setAttachments([]);
    setComposeError("");
    setShowFileMenu(false);
    setShowTemplates(false);
    setIsComposing(true);
    if (systemFiles.length === 0) loadSystemFiles();
  }

  function initiateReply(msg: any) {
    const subject = msg.subject || "";
    openCompose({
      to: msg.from_address,
      subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
      fromId: msg.account_id,
      body: `\n\n\n--- On ${formatFullDate(msg.received_at)}, ${msg.from_address} wrote:\n> ${String(msg.body_text || "").replace(/\n/g, "\n> ")}`,
    });
  }

  function initiateForward(msg: any) {
    const subject = msg.subject || "";
    openCompose({
      subject: /^fwd:/i.test(subject) ? subject : `Fwd: ${subject}`,
      fromId: msg.account_id,
      body: `\n\n\n--- Forwarded message ---\nFrom: ${msg.from_address}\nDate: ${formatFullDate(msg.received_at)}\nSubject: ${subject}\n\n${msg.body_text || ""}`,
    });
  }

  const signature = accountById[composeFromId]?.display_name || "Finetax Team";
  const TEMPLATES = [
    {
      label: "Acknowledgement",
      body: `Dear Client,\n\nThank you for reaching out regarding "${composeSubject.replace(/^(re|fwd):\s*/i, "")}". We have received your query and our team is reviewing it. We will share a detailed update shortly.\n\nBest regards,\n${signature}`,
    },
    {
      label: "Documents request",
      body: `Dear Client,\n\nTo proceed with your request, please share the following documents at the earliest:\n\n1. \n2. \n3. \n\nYou can reply to this email with the attachments.\n\nBest regards,\n${signature}`,
    },
    {
      label: "Payment reminder",
      body: `Dear Client,\n\nThis is a gentle reminder that the payment against our invoice is pending. Please find the invoice attached for your reference.\n\nKindly ignore this message if the payment has already been made.\n\nBest regards,\n${signature}`,
    },
  ];

  function insertTemplate(body: string) {
    const quoted = composeBody.includes("\n--- ") ? composeBody.slice(composeBody.indexOf("\n--- ")) : "";
    setComposeBody(body + (quoted ? `\n\n${quoted.trim()}` : ""));
    setShowTemplates(false);
  }

  function attachPCFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    const current = attachments.filter((a) => a.kind === "file").reduce((s, a: any) => s + a.file.size, 0);
    const total = picked.reduce((s, f) => s + f.size, current);
    if (total > MAX_UPLOAD_BYTES) {
      showToast("error", "Attachments can be at most 20 MB in total.");
    } else {
      setAttachments([...attachments, ...picked.map((file) => ({ kind: "file" as const, name: file.name, file }))]);
    }
    e.target.value = "";
  }

  function attachSystemFile(sf: (typeof systemFiles)[number]) {
    if (sf.kind === "link") setAttachments([...attachments, { kind: "link", name: sf.name, url: sf.url! }]);
    else setAttachments([...attachments, { kind: sf.kind, name: sf.name, id: sf.id! }]);
    setShowFileMenu(false);
    setFileSearch("");
  }

  async function handleSendEmail(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setComposeError("");

    const recipients = composeTo.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (!composeFromId) return setComposeError("Choose an account to send from.");
    if (recipients.length === 0 || recipients.some((r) => !EMAIL_RE.test(r))) return setComposeError("Enter valid recipient email addresses, separated by commas.");
    if (!composeSubject.trim()) return setComposeError("Subject is required.");
    if (!composeBody.trim()) return setComposeError("Message body is empty.");

    setSending(true);
    try {
      const formData = new FormData();
      formData.append("to", recipients.join(", "));
      formData.append("subject", composeSubject.trim());
      formData.append("accountId", composeFromId);

      let finalBody = composeBody;
      const links = attachments.filter((a): a is Extract<Attachment, { kind: "link" }> => a.kind === "link");
      if (links.length > 0) {
        finalBody += "\n\n--- Shared documents ---\n";
        links.forEach((l) => (finalBody += `${l.name}: ${l.url}\n`));
      }
      formData.append("body", finalBody);

      attachments.forEach((a) => {
        if (a.kind === "file") formData.append("files", a.file);
        if (a.kind === "invoice") formData.append("invoiceIds", a.id);
        if (a.kind === "quotation") formData.append("quotationIds", a.id);
      });

      const res = await fetch("/api/send-email", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to send the email.");

      showToast("success", `Email sent to ${recipients.join(", ")}.`);
      setIsComposing(false);
      if (activeTab === "sent") loadMessages(true);
    } catch (err: any) {
      setComposeError(err?.message || "Failed to send the email.");
    } finally {
      setSending(false);
    }
  }

  /* ---------------- Account management (admin) ---------------- */

  function chooseProvider(key: string) {
    const p = PROVIDERS.find((x) => x.key === key) || PROVIDERS[0];
    setProviderKey(p.key);
    setSmtpHost(p.smtpHost);
    setSmtpPort(String(p.smtpPort));
    setImapHost(p.imapHost);
    setImapPort(String(p.imapPort));
    setShowAdvanced(p.key === "custom");
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    if (accountSaving) return;
    setAccountError("");

    const email = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return setAccountError("Enter a valid email address.");
    if (!newName.trim()) return setAccountError("Display name is required.");
    if (!smtpPass) return setAccountError("Enter the mailbox password or app password.");
    if (!smtpHost.trim() || !imapHost.trim()) return setAccountError("SMTP and IMAP servers are required.");
    if (accounts.some((a) => a.email_address === email)) return setAccountError("This mailbox is already connected.");

    setAccountSaving(true);
    const { data, error } = await supabase
      .from("email_accounts")
      .insert([
        {
          email_address: email,
          display_name: newName.trim(),
          smtp_pass: smtpPass, // encrypted into Vault by the database immediately
          smtp_host: smtpHost.trim(),
          smtp_port: Number(smtpPort) || 587,
          imap_host: imapHost.trim(),
          imap_port: Number(imapPort) || 993,
          is_active: true,
        },
      ])
      .select("id")
      .single();
    setAccountSaving(false);

    if (error || !data) return setAccountError(error?.message || "Could not connect this account.");

    logAuditEvent("CONNECT_EMAIL_ACCOUNT", "EMAIL_ACCOUNTS", data.id, { email });
    setNewEmail("");
    setNewName("");
    setSmtpPass("");
    showToast("success", `${email} connected. Testing the connection...`);
    await loadAccounts();
    testConnection(data.id);
  }

  async function testConnection(accountId: string) {
    setTestingId(accountId);
    try {
      const res = await fetch("/api/email-accounts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Test failed.");
      setTestResults((r) => ({ ...r, [accountId]: data }));
    } catch (err: any) {
      setTestResults((r) => ({ ...r, [accountId]: { error: err?.message } }));
    } finally {
      setTestingId(null);
    }
  }

  async function savePassword() {
    if (!passwordTarget || !newPassword) return;
    setActionBusy(true);
    const { error } = await supabase.from("email_accounts").update({ smtp_pass: newPassword }).eq("id", passwordTarget.id);
    setActionBusy(false);
    if (error) return showToast("error", error.message);
    logAuditEvent("UPDATE_EMAIL_PASSWORD", "EMAIL_ACCOUNTS", passwordTarget.id, { email: passwordTarget.email_address });
    const id = passwordTarget.id;
    setPasswordTarget(null);
    setNewPassword("");
    showToast("success", "Password updated and encrypted.");
    await loadAccounts();
    testConnection(id);
  }

  async function toggleAccountActive(acc: any) {
    const { error } = await supabase.from("email_accounts").update({ is_active: acc.is_active === false }).eq("id", acc.id);
    if (error) return showToast("error", error.message);
    logAuditEvent(acc.is_active === false ? "ENABLE_EMAIL_ACCOUNT" : "DISABLE_EMAIL_ACCOUNT", "EMAIL_ACCOUNTS", acc.id, { email: acc.email_address });
    loadAccounts();
  }

  async function deleteAccount() {
    const acc = confirm?.target;
    if (!acc) return;
    setActionBusy(true);
    const { error: msgErr } = await supabase.from("email_messages").delete().eq("account_id", acc.id);
    const { error } = msgErr ? { error: msgErr } : await supabase.from("email_accounts").delete().eq("id", acc.id);
    setActionBusy(false);
    setConfirm(null);
    if (error) return showToast("error", error.message);
    logAuditEvent("DELETE_EMAIL_ACCOUNT", "EMAIL_ACCOUNTS", acc.id, { email: acc.email_address });
    if (selectedAccountId === acc.id) setSelectedAccountId("all");
    showToast("success", `${acc.email_address} removed with its synced messages.`);
    loadAccounts();
  }

  /* ---------------- Render ---------------- */

  const filteredSystemFiles = systemFiles.filter((f) => !fileSearch || f.name.toLowerCase().includes(fileSearch.toLowerCase()));

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[520px] overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      {/* Left Sidebar - Mailbox Folders */}
      <div className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface-alt md:flex">
        <div className="border-b border-border p-3">
          <select value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)} className={`${inputClass} text-xs font-semibold text-navy`}>
            <option value="all">All Inboxes</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email_address}
                {a.is_active === false ? " (disabled)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 space-y-1 p-2">
          {(
            [
              { key: "inbox", label: "Inbox", icon: Inbox, badge: unreadCount },
              { key: "sent", label: "Sent Mail", icon: Send, badge: 0 },
              { key: "settings", label: "Connected Accounts", icon: Settings, badge: 0 },
            ] as const
          ).map((f) => {
            const Icon = f.icon;
            const active = activeTab === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setActiveTab(f.key)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? "bg-navy/10 font-semibold text-navy" : "text-text-muted hover:bg-surface hover:text-text-main"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1 text-left">{f.label}</span>
                {f.badge > 0 && <span className="rounded-full bg-navy px-1.5 text-[10px] font-bold text-white">{f.badge}</span>}
              </button>
            );
          })}
        </div>

        <div className="space-y-2 border-t border-border p-3">
          <button
            type="button"
            onClick={isSyncing ? handleStopSync : handleSyncEmails}
            className={`flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition ${
              isSyncing ? "bg-rose-50 text-rose-700 hover:bg-rose-100" : "border border-border bg-surface text-navy hover:bg-surface-alt"
            }`}
          >
            {isSyncing ? (
              <>
                <XOctagon className="h-4 w-4" /> Stop waiting
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" /> {selectedAccountId === "all" ? "Sync all inboxes" : "Sync this inbox"}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => openCompose()}
            disabled={activeAccounts.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Compose
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile toolbar */}
        <div className="flex items-center gap-2 border-b border-border p-2 md:hidden">
          <select value={activeTab} onChange={(e) => setActiveTab(e.target.value as any)} className={`${inputClass} text-xs`}>
            <option value="inbox">Inbox ({unreadCount})</option>
            <option value="sent">Sent</option>
            <option value="settings">Accounts</option>
          </select>
          <button type="button" onClick={handleSyncEmails} disabled={isSyncing} className="rounded-lg border border-border p-2 text-navy">
            <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
          </button>
          <button type="button" onClick={() => openCompose()} className="rounded-lg bg-navy p-2 text-white">
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* ---------- Connected Accounts ---------- */}
        {activeTab === "settings" && (
          <div className="flex-1 space-y-6 overflow-y-auto p-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h2 className="text-lg font-bold text-navy">Firm Email Accounts</h2>
                <p className="text-xs text-text-muted">Passwords are encrypted in the database and never shown again.</p>
              </div>
            </div>

            {accounts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-text-muted">No email accounts connected yet.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {accounts.map((acc) => {
                  const test = testResults[acc.id];
                  return (
                    <div key={acc.id} className={`space-y-3 rounded-xl border p-4 ${acc.is_active === false ? "border-border bg-surface-alt opacity-80" : "border-border bg-surface"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-navy">{acc.email_address}</p>
                          <p className="text-xs text-text-muted">{acc.display_name}</p>
                          <p className="mt-1 font-mono text-[10px] text-text-muted">
                            SMTP {acc.smtp_host || "smtp.gmail.com"}:{acc.smtp_port || 587} · IMAP {acc.imap_host || "auto"}:{acc.imap_port || 993}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              acc.is_active === false ? "border-border bg-surface-alt text-text-muted" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {acc.is_active === false ? "Disabled" : "Active"}
                          </span>
                          {acc.smtp_secret_id ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                              <ShieldCheck className="h-3 w-3" /> Encrypted
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold text-rose-600">No password saved</span>
                          )}
                        </div>
                      </div>

                      {test && (
                        <div className="space-y-1 rounded-lg border border-border bg-surface-alt p-2 text-[11px]">
                          {test.error ? (
                            <p className="flex items-center gap-1 text-rose-600">
                              <AlertCircle className="h-3.5 w-3.5" /> {test.error}
                            </p>
                          ) : (
                            <>
                              <p className={`flex items-center gap-1 ${test.smtp?.ok ? "text-emerald-700" : "text-rose-600"}`}>
                                {test.smtp?.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />} Sending: {test.smtp?.message}
                              </p>
                              <p className={`flex items-center gap-1 ${test.imap?.ok ? "text-emerald-700" : "text-rose-600"}`}>
                                {test.imap?.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />} Receiving: {test.imap?.message}
                              </p>
                            </>
                          )}
                        </div>
                      )}

                      {isAdmin && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => testConnection(acc.id)}
                            disabled={testingId === acc.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-navy transition hover:bg-surface-alt disabled:opacity-60"
                          >
                            {testingId === acc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />} Test connection
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPasswordTarget(acc);
                              setNewPassword("");
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-navy transition hover:bg-surface-alt"
                          >
                            <KeyRound className="h-3.5 w-3.5" /> Update password
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleAccountActive(acc)}
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-text-muted transition hover:bg-surface-alt"
                          >
                            <Power className="h-3.5 w-3.5" /> {acc.is_active === false ? "Enable" : "Disable"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirm({ kind: "deleteAccount", target: acc })}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Remove
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {isAdmin ? (
              <form onSubmit={handleAddAccount} className="max-w-2xl space-y-4 rounded-xl border border-border bg-surface-alt p-5">
                <h3 className="flex items-center gap-2 text-sm font-bold text-text-main">
                  <Plus className="h-4 w-4 text-navy" /> Connect an Email Account
                </h3>

                {accountError && (
                  <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs font-medium text-danger">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{accountError}</span>
                  </div>
                )}

                <div>
                  <label className={labelClass}>Email Provider</label>
                  <select value={providerKey} onChange={(e) => chooseProvider(e.target.value)} className={inputClass}>
                    {PROVIDERS.map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                  {provider.help && <p className="mt-1 text-[11px] text-text-muted">{provider.help}</p>}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Email Address</label>
                    <input required type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className={inputClass} placeholder="billing@firm.com" />
                  </div>
                  <div>
                    <label className={labelClass}>Display Name</label>
                    <input required type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className={inputClass} placeholder="Firm Billing" />
                  </div>
                </div>

                <PasswordInput label="App Password / Mailbox Password" value={smtpPass} onChange={setSmtpPass} autoComplete="new-password" hint="Encrypted the moment you save. Nobody, including admins, can view it again." />

                <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy">
                  <ChevronDown className={`h-3.5 w-3.5 transition ${showAdvanced ? "rotate-180" : ""}`} /> Server settings
                </button>
                {showAdvanced && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="col-span-2 sm:col-span-1">
                      <label className={labelClass}>SMTP Host</label>
                      <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} className={`${inputClass} font-mono text-xs`} />
                    </div>
                    <div>
                      <label className={labelClass}>SMTP Port</label>
                      <input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value.replace(/\D/g, ""))} className={`${inputClass} font-mono text-xs`} />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className={labelClass}>IMAP Host</label>
                      <input value={imapHost} onChange={(e) => setImapHost(e.target.value)} className={`${inputClass} font-mono text-xs`} />
                    </div>
                    <div>
                      <label className={labelClass}>IMAP Port</label>
                      <input value={imapPort} onChange={(e) => setImapPort(e.target.value.replace(/\D/g, ""))} className={`${inputClass} font-mono text-xs`} />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={accountSaving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
                >
                  {accountSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Connect & Test
                </button>
              </form>
            ) : (
              <p className="text-xs text-text-muted">Only administrators can connect or change email accounts.</p>
            )}
          </div>
        )}

        {/* ---------- Message List & Reader ---------- */}
        {(activeTab === "inbox" || activeTab === "sent") && (
          <div className="flex h-full w-full overflow-hidden">
            {/* Thread List */}
            <div className={`flex w-full shrink-0 flex-col border-r border-border md:w-[340px] lg:w-[380px] ${selectedMessage ? "hidden md:flex" : "flex"}`}>
              <div className="border-b border-border p-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Search ${activeTab === "sent" ? "sent mail" : "inbox"}...`}
                    className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 p-6 text-xs text-text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading emails...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="p-6 text-center text-xs text-text-muted">
                    {debouncedSearch ? "No emails match your search." : activeTab === "inbox" ? "Inbox is empty. Click Sync to fetch new mail." : "No sent emails yet."}
                  </div>
                ) : (
                  <>
                    <div className="divide-y divide-border">
                      {messages.map((msg) => {
                        const client = clientById[msg.client_id];
                        const unread = !msg.is_read && msg.direction === "inbound";
                        return (
                          <button
                            key={msg.id}
                            type="button"
                            onClick={() => openMessage(msg)}
                            className={`block w-full border-l-4 p-3 text-left transition ${
                              selectedMessage?.id === msg.id ? "border-navy bg-navy/5" : "border-transparent hover:bg-surface-alt"
                            }`}
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className={`truncate text-sm ${unread ? "font-bold text-navy" : "font-medium text-text-main"}`}>
                                {activeTab === "inbox" ? msg.from_address : `To: ${msg.to_address}`}
                              </span>
                              <span className="shrink-0 text-[10px] text-text-muted">{formatListDate(msg.received_at)}</span>
                            </div>
                            <p className={`truncate text-xs ${unread ? "font-semibold text-text-main" : "text-text-muted"}`}>{msg.subject || "(No Subject)"}</p>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              {client && (
                                <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-indigo-50 px-1.5 text-[9px] font-semibold text-indigo-700">
                                  <Building2 className="h-2.5 w-2.5" /> {client.organization_name || client.name}
                                </span>
                              )}
                              <span className="truncate text-[11px] text-text-muted">{String(msg.body_text || "").replace(/\s+/g, " ").slice(0, 90)}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {hasMore && (
                      <div className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => loadMessages(false)}
                          disabled={loadingMore}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-navy transition hover:bg-surface-alt disabled:opacity-60"
                        >
                          {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Load older emails
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Email Reader */}
            <div className={`min-w-0 flex-1 flex-col overflow-hidden bg-surface-alt ${selectedMessage ? "flex" : "hidden md:flex"}`}>
              {selectedMessage ? (
                <>
                  <div className="border-b border-border bg-surface p-5">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <button type="button" onClick={() => setSelectedMessage(null)} className="mb-2 text-[11px] font-semibold text-navy md:hidden">
                          ← Back
                        </button>
                        <h2 className="text-lg font-bold text-navy">{selectedMessage.subject || "(No Subject)"}</h2>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => toggleReadStatus(selectedMessage)}
                          className="rounded-md p-2 text-text-muted transition hover:bg-surface-alt"
                          title={selectedMessage.is_read ? "Mark unread" : "Mark read"}
                        >
                          {selectedMessage.is_read ? <MailClosed className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => setConfirm({ kind: "deleteMessage", target: selectedMessage })}
                            className="rounded-md p-2 text-rose-500 transition hover:bg-rose-50"
                            title="Delete email"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 text-xs text-text-muted sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate">
                          <strong className="text-text-main">From:</strong> {selectedMessage.from_address}
                        </p>
                        <p className="truncate">
                          <strong className="text-text-main">To:</strong> {selectedMessage.to_address}
                        </p>
                        <p className="truncate">
                          <strong className="text-text-main">Mailbox:</strong> {accountById[selectedMessage.account_id]?.email_address || "—"}
                        </p>
                      </div>
                      <p className="shrink-0">{formatFullDate(selectedMessage.received_at)}</p>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5 text-xs">
                        <Building2 className="h-3.5 w-3.5 text-text-muted" />
                        <ClientPicker
                          clients={clients as any}
                          value={selectedMessage.client_id || ""}
                          onChange={(id) => linkClient(selectedMessage, id)}
                          noneLabel="Not linked to a client"
                          includeInactive
                          className="w-72"
                        />
                      </div>
                      {selectedMessage.client_id && (
                        <button
                          type="button"
                          onClick={() => logAsDiscussion(selectedMessage)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-navy transition hover:bg-surface-alt"
                        >
                          <MessageSquare className="h-3.5 w-3.5" /> Log as discussion
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto whitespace-pre-wrap bg-surface p-5 text-sm leading-relaxed text-text-main">
                    {selectedMessage.body_text || "No content."}
                  </div>

                  <div className="flex gap-2 border-t border-border bg-surface p-3">
                    {activeTab === "inbox" && (
                      <button
                        type="button"
                        onClick={() => initiateReply(selectedMessage)}
                        className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light"
                      >
                        <Reply className="h-4 w-4" /> Reply
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => initiateForward(selectedMessage)}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-xs font-bold text-navy transition hover:bg-surface-alt"
                    >
                      <Forward className="h-4 w-4" /> Forward
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
                  <div className="space-y-2 text-center">
                    <Mail className="mx-auto h-12 w-12 opacity-20" />
                    <p>Select a message to read</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ================= Compose ================= */}
      {isComposing && (
        <Modal
          title="New Message"
          onClose={() => !sending && setIsComposing(false)}
          maxWidth="max-w-2xl"
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1">
                <label className="cursor-pointer rounded-md p-2 text-text-muted transition hover:bg-surface-alt hover:text-navy" title="Attach files from your computer">
                  <Upload className="h-4 w-4" />
                  <input type="file" multiple className="hidden" onChange={attachPCFiles} />
                </label>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setShowFileMenu(!showFileMenu);
                      setShowTemplates(false);
                    }}
                    className={`rounded-md p-2 transition ${showFileMenu ? "bg-navy text-white" : "text-text-muted hover:bg-surface-alt hover:text-navy"}`}
                    title="Attach an invoice, quotation or vault document"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                  {showFileMenu && (
                    <div className="absolute bottom-full left-0 z-20 mb-1 flex max-h-72 w-80 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                      <div className="border-b border-border p-2">
                        <input
                          autoFocus
                          value={fileSearch}
                          onChange={(e) => setFileSearch(e.target.value)}
                          placeholder="Search invoices, quotations, documents..."
                          className="w-full rounded-md border border-border px-2 py-1.5 text-xs outline-none focus:border-navy"
                        />
                      </div>
                      <div className="flex-1 overflow-y-auto">
                        {filteredSystemFiles.length === 0 ? (
                          <p className="p-4 text-center text-xs text-text-muted">No matching files.</p>
                        ) : (
                          filteredSystemFiles.slice(0, 100).map((sf, idx) => (
                            <button
                              key={`${sf.kind}-${sf.id || sf.url}-${idx}`}
                              type="button"
                              onClick={() => attachSystemFile(sf)}
                              className="flex w-full items-center gap-2 border-b border-border/50 p-2 text-left text-xs transition last:border-0 hover:bg-surface-alt"
                            >
                              {sf.kind === "invoice" ? (
                                <Receipt className="h-4 w-4 shrink-0 text-emerald-600" />
                              ) : sf.kind === "quotation" ? (
                                <FileText className="h-4 w-4 shrink-0 text-violet-600" />
                              ) : (
                                <Folder className="h-4 w-4 shrink-0 text-blue-600" />
                              )}
                              <span className="flex-1 truncate font-medium">{sf.name}</span>
                              <span className="shrink-0 rounded bg-surface-alt px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-text-muted">{sf.type}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setShowTemplates(!showTemplates);
                      setShowFileMenu(false);
                    }}
                    className="inline-flex items-center gap-1 rounded-md p-2 text-xs font-semibold text-blue-600 transition hover:bg-blue-50"
                    title="Insert a reply template"
                  >
                    <Sparkles className="h-4 w-4" /> Templates
                  </button>
                  {showTemplates && (
                    <div className="absolute bottom-full left-0 z-20 mb-1 w-52 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                      {TEMPLATES.map((t) => (
                        <button key={t.label} type="button" onClick={() => insertTemplate(t.body)} className="block w-full px-3 py-2 text-left text-xs transition hover:bg-surface-alt">
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="submit"
                form="compose-form"
                disabled={sending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
              >
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          }
        >
          <form id="compose-form" onSubmit={handleSendEmail} className="space-y-3 text-xs">
            {composeError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 font-medium text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{composeError}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 font-semibold text-text-muted">From</span>
              <select value={composeFromId} onChange={(e) => setComposeFromId(e.target.value)} className={inputClass}>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.display_name} &lt;{a.email_address}&gt;
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 font-semibold text-text-muted">To</span>
              <input
                type="text"
                list="client-emails"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                className={inputClass}
                placeholder="name@example.com, another@example.com"
              />
              <datalist id="client-emails">
                {clients
                  .filter((c) => c.email)
                  .map((c) => (
                    <option key={c.id} value={c.email}>{clientLabel(c)}</option>
                  ))}
              </datalist>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 font-semibold text-text-muted">Subject</span>
              <input type="text" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} className={inputClass} maxLength={300} />
            </div>

            <textarea
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              rows={12}
              className={`${inputClass} resize-y`}
              placeholder="Type your message here..."
            />

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((att, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-alt px-2 py-1 text-[11px]">
                    {att.kind === "invoice" ? (
                      <Receipt className="h-3 w-3 text-emerald-600" />
                    ) : att.kind === "quotation" ? (
                      <FileText className="h-3 w-3 text-violet-600" />
                    ) : att.kind === "link" ? (
                      <Folder className="h-3 w-3 text-blue-600" />
                    ) : (
                      <Paperclip className="h-3 w-3 text-text-muted" />
                    )}
                    <span className="max-w-[160px] truncate">{att.name}</span>
                    <span className="text-[9px] text-text-muted">{att.kind === "link" ? "link" : att.kind === "file" ? "" : "PDF"}</span>
                    <button type="button" onClick={() => setAttachments(attachments.filter((_, i) => i !== idx))} aria-label="Remove attachment">
                      <X className="h-3 w-3 text-rose-500" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </form>
        </Modal>
      )}

      {/* Update password */}
      {passwordTarget && (
        <Modal
          title="Update mailbox password"
          subtitle={passwordTarget.email_address}
          onClose={() => !actionBusy && setPasswordTarget(null)}
          maxWidth="max-w-md"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPasswordTarget(null)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Cancel
              </button>
              <button
                type="button"
                onClick={savePassword}
                disabled={actionBusy || !newPassword}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
              >
                {actionBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save & Test
              </button>
            </div>
          }
        >
          <PasswordInput label="New App Password / Mailbox Password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" autoFocus hint="Replaces the stored password. It is encrypted immediately." />
        </Modal>
      )}

      {/* Confirmations */}
      {confirm?.kind === "deleteMessage" && (
        <ConfirmDialog
          title="Delete this email?"
          message={`"${confirm.target.subject || "(No Subject)"}" will be removed from Finetax Manager. It stays in the actual mailbox.`}
          confirmLabel="Delete email"
          tone="danger"
          loading={actionBusy}
          onConfirm={deleteMessage}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "deleteAccount" && (
        <ConfirmDialog
          title="Remove this email account?"
          message={`${confirm.target.email_address} will be disconnected and all its synced messages removed from Finetax Manager. Its encrypted password is destroyed. Consider "Disable" instead to keep history.`}
          confirmLabel="Remove account"
          tone="danger"
          loading={actionBusy}
          onConfirm={deleteAccount}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-[70] flex max-w-sm items-start gap-2 rounded-lg border px-4 py-3 text-xs font-semibold shadow-lg animate-scale-in ${
            toast.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {toast.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}