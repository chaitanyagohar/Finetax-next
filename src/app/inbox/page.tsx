"use client";

import { useState, useEffect, useRef } from "react";
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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function UnifiedInboxPage() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [systemFiles, setSystemFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Sync State & Abort Controller
  const [isSyncing, setIsSyncing] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // View States
  const [activeTab, setActiveTab] = useState<"inbox" | "sent" | "settings">(
    "inbox",
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");
  const [selectedMessage, setSelectedMessage] = useState<any | null>(null);

  // Composer State
  const [isComposing, setIsComposing] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeFromId, setComposeFromId] = useState("");
  const [attachments, setAttachments] = useState<any[]>([]); // Mix of PC files and System URLs
  const [showFileMenu, setShowFileMenu] = useState(false); // <-- Add this new state

  // Settings State (Add New Email)
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [smtpPass, setSmtpPass] = useState("");

  const supabase = createClient();

  useEffect(() => {
    loadInboxData();
  }, [selectedAccountId, activeTab]);

  async function loadInboxData() {
    setLoading(true);

    // Fetch Accounts, Documents, Invoices, AND Quotations
    const [accRes, docRes, invRes, quoRes] = await Promise.all([
      supabase.from("email_accounts").select("*"),
      supabase.from("documents").select("id, title, file_url, category"),
      supabase.from("invoices").select("id, invoice_number, pdf_url"),
      supabase.from("quotations").select("id, quote_number, pdf_url"),
    ]);

    if (accRes.data) {
      setAccounts(accRes.data);
      if (!composeFromId && accRes.data.length > 0)
        setComposeFromId(accRes.data[0].id);
    }

    // Combine all system files into a single unified dropdown list
    const combinedFiles = [
      ...(docRes.data || []).map((d: any) => ({
        name: d.title || "Document",
        url: d.file_url,
        type: "Vault Document",
      })),
      ...(invRes.data || []).map((i: any) => ({
        name: `Invoice #${i.invoice_number || i.id.slice(0, 4)}`,
        url: i.pdf_url,
        type: "Tax Invoice",
      })),
      ...(quoRes.data || []).map((q: any) => ({
        name: `Quotation #${q.quote_number || q.id.slice(0, 4)}`,
        url: q.pdf_url,
        type: "Fee Quotation",
      })),
    ].filter((f) => f.url); // Strictly hides files that don't have a generated URL yet

    setSystemFiles(combinedFiles);

    // Fetch Messages
    let query = supabase
      .from("email_messages")
      .select("*, email_accounts(email_address)");

    if (selectedAccountId !== "all") {
      query = query.eq("account_id", selectedAccountId);
    }

    query = query.eq(
      "direction",
      activeTab === "sent" ? "outbound" : "inbound",
    );

    const { data: msgData } = await query.order("received_at", {
      ascending: false,
    });
    if (msgData) setMessages(msgData);

    setLoading(false);
  }

  // --- Sync Controls ---
  async function handleSyncEmails() {
    if (selectedAccountId === "all") {
      alert(
        "Please select a specific email account from the dropdown on the left to sync.",
      );
      return;
    }

    setIsSyncing(true);
    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch("/api/sync-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: selectedAccountId }),
        signal: abortControllerRef.current.signal,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      alert(data.message); // e.g., "Synced 3 new emails."
      loadInboxData(); // Refresh the UI to show the new emails
    } catch (err: any) {
      if (err.name === "AbortError") {
        alert("Sync stopped manually.");
      } else {
        alert("Sync failed: " + err.message);
      }
    } finally {
      setIsSyncing(false);
      abortControllerRef.current = null;
    }
  }

  function handleStopSync() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }

  // --- Message Actions (Read, Delete, Reply, Forward) ---
  async function toggleReadStatus(msgId: string, currentStatus: boolean) {
    await supabase
      .from("email_messages")
      .update({ is_read: !currentStatus })
      .eq("id", msgId);
    if (selectedMessage?.id === msgId)
      setSelectedMessage({ ...selectedMessage, is_read: !currentStatus });
    setMessages(
      messages.map((m) =>
        m.id === msgId ? { ...m, is_read: !currentStatus } : m,
      ),
    );
  }

  async function deleteMessage(msgId: string) {
    if (!confirm("Permanently delete this email?")) return;
    await supabase.from("email_messages").delete().eq("id", msgId);
    if (selectedMessage?.id === msgId) setSelectedMessage(null);
    setMessages(messages.filter((m) => m.id !== msgId));
  }

  // --- Account Management ---
  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("email_accounts").insert([
      {
        email_address: newEmail,
        display_name: newName,
        smtp_pass: smtpPass,
        smtp_host: "smtp.gmail.com",
        smtp_port: 587,
      },
    ]);

    if (error) alert("Error adding account: " + error.message);
    else {
      alert("Email account linked successfully!");
      setNewEmail("");
      setNewName("");
      setSmtpPass("");
      loadInboxData();
    }
  }

  async function handleRemoveAccount(id: string) {
    if (!confirm("Remove this email account and delete all synced messages?"))
      return;
    await supabase.from("email_accounts").delete().eq("id", id);
    loadInboxData();
  }

  // --- Compose, Reply & Forward ---
  function initiateReply(msg: any) {
    setIsComposing(true);
    setComposeTo(msg.from_address);
    setComposeSubject(
      msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`,
    );
    setComposeFromId(msg.account_id);
    setComposeBody(
      `\n\n\n--- On ${new Date(msg.received_at).toLocaleString()}, ${msg.from_address} wrote:\n> ${msg.body_text.replace(/\n/g, "\n> ")}`,
    );
    setAttachments([]);
  }

  function initiateForward(msg: any) {
    setIsComposing(true);
    setComposeTo("");
    setComposeSubject(
      msg.subject.startsWith("Fwd:") ? msg.subject : `Fwd: ${msg.subject}`,
    );
    setComposeFromId(msg.account_id);
    setComposeBody(
      `\n\n\n--- Forwarded message ---\nFrom: ${msg.from_address}\nDate: ${new Date(msg.received_at).toLocaleString()}\nSubject: ${msg.subject}\n\n${msg.body_text}`,
    );
    setAttachments([]);
  }

  function handleAutoReplyGenerate() {
    setComposeBody(
      `Dear Client,\n\nThank you for reaching out regarding "${composeSubject.replace("Re: ", "")}". \n\nWe have received your query and our execution team is currently reviewing your file. We will provide a comprehensive update shortly.\n\nPlease find the requested attachments enclosed below.\n\nBest regards,\n${accounts.find((a) => a.id === composeFromId)?.display_name || "Practice Team"}`,
    );
  }

  function attachPCFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAttachments([
        ...attachments,
        { name: file.name, fileObj: file, type: "PC Upload" },
      ]);
    }
  }

  function attachSystemFile(fileUrl: string, fileName: string) {
    setAttachments([
      ...attachments,
      { name: fileName, url: fileUrl, type: "System Link" },
    ]);
  }

  async function handleSendEmail(e: React.FormEvent) {
    e.preventDefault();

    try {
      const formData = new FormData();
      formData.append("to", composeTo);
      formData.append("subject", composeSubject);
      formData.append("accountId", composeFromId);

      let finalBody = composeBody;
      const systemLinks = attachments.filter((a) => a.url);

      if (systemLinks.length > 0) {
        finalBody += "\n\n--- System Attachments ---\n";
        systemLinks.forEach((link) => {
          finalBody += `${link.name}: ${link.url}\n`;
        });
      }

      formData.append("body", finalBody);

      const pcFiles = attachments.filter((a) => a.fileObj);
      pcFiles.forEach((file) => {
        formData.append("files", file.fileObj);
      });

      const res = await fetch("/api/send-email", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to send email");

      alert("Email sent successfully!");
      setIsComposing(false);
      loadInboxData();
    } catch (err: any) {
      alert("Error sending email: " + err.message);
      console.error(err);
    }
  }

  return (
    <div className="flex h-[calc(100vh-80px)] bg-surface border border-border rounded-lg shadow-sm overflow-hidden">
      {/* Left Sidebar - Mailbox Folders */}
      <div className="w-64 shrink-0 bg-background border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="w-full bg-surface border border-border rounded p-2 text-xs font-bold text-navy"
          >
            <option value="all">All Inboxes</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email_address}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 p-2 space-y-1">
          <button
            onClick={() => setActiveTab("inbox")}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition ${activeTab === "inbox" ? "bg-navy/10 text-navy font-bold" : "text-text-muted hover:bg-surface"}`}
          >
            <Inbox className="h-4 w-4" /> Inbox
          </button>
          <button
            onClick={() => setActiveTab("sent")}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition ${activeTab === "sent" ? "bg-navy/10 text-navy font-bold" : "text-text-muted hover:bg-surface"}`}
          >
            <Send className="h-4 w-4" /> Sent Mail
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition ${activeTab === "settings" ? "bg-navy/10 text-navy font-bold" : "text-text-muted hover:bg-surface"}`}
          >
            <Settings className="h-4 w-4" /> Connected Accounts
          </button>
        </div>

        <div className="p-4 border-t border-border">
          <button
            onClick={() => {
              setIsComposing(true);
              setComposeTo("");
              setComposeSubject("");
              setComposeBody("");
              setAttachments([]);
            }}
            className="w-full py-2 bg-navy text-white rounded font-bold text-xs flex items-center justify-center gap-2 hover:bg-navy/90"
          >
            <Plus className="h-4 w-4" /> Compose Mail
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col bg-surface overflow-hidden">
        {/* Settings Tab: Manage Accounts */}
        {activeTab === "settings" && (
          <div className="p-6 space-y-6 flex-1 overflow-y-auto">
            <h2 className="text-lg font-bold text-navy border-b border-border pb-2">
              Firm Email Accounts
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="p-4 border border-border rounded-lg flex justify-between items-center bg-background"
                >
                  <div>
                    <p className="font-bold text-sm text-navy">
                      {acc.email_address}
                    </p>
                    <p className="text-xs text-text-muted">
                      Display Name: {acc.display_name}
                    </p>
                    <span className="inline-block mt-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded">
                      Active & Syncing
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemoveAccount(acc.id)}
                    className="p-2 text-rose-600 hover:bg-rose-50 rounded"
                    title="Disconnect Account"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <form
              onSubmit={handleAddAccount}
              className="bg-background p-5 border border-border rounded-lg space-y-4 max-w-xl"
            >
              <h3 className="font-bold text-sm text-text-main flex items-center gap-2">
                <Plus className="h-4 w-4 text-navy" /> Link New Email Account
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-text-muted mb-1">
                    Email Address
                  </label>
                  <input
                    required
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full border p-2 rounded text-xs"
                    placeholder="billing@firm.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted mb-1">
                    Display Name
                  </label>
                  <input
                    required
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full border p-2 rounded text-xs"
                    placeholder="Firm Billing"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-text-muted mb-1">
                    App Password / SMTP Secret
                  </label>
                  <input
                    required
                    type="password"
                    value={smtpPass}
                    onChange={(e) => setSmtpPass(e.target.value)}
                    className="w-full border p-2 rounded text-xs"
                    placeholder="••••••••••••"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="px-4 py-2 bg-navy text-white text-xs font-bold rounded"
              >
                Connect Account
              </button>
            </form>
          </div>
        )}

        {/* Message List & Reader (Inbox/Sent) */}
        {(activeTab === "inbox" || activeTab === "sent") && (
          <div className="flex h-full w-full overflow-hidden">
            {/* Thread List (Left Column) - LOCKED WIDTH */}
            <div className="w-1/3 min-w-[280px] max-w-[400px] shrink-0 border-r border-border flex flex-col">
              {/* Sync Bar - ONLY shows when a specific account is selected */}
              {activeTab === "inbox" && selectedAccountId !== "all" && (
                <div className="p-2 border-b border-border bg-surface flex justify-between items-center shrink-0">
                  <span className="text-xs font-bold text-navy">
                    Incoming Mail
                  </span>
                  {isSyncing ? (
                    <button
                      onClick={handleStopSync}
                      className="px-3 py-1 bg-rose-100 text-rose-700 rounded text-xs font-bold hover:bg-rose-200 flex items-center gap-1"
                    >
                      <XOctagon className="h-3.5 w-3.5" /> Stop Sync
                    </button>
                  ) : (
                    <button
                      onClick={handleSyncEmails}
                      className="px-3 py-1 bg-navy/10 text-navy rounded text-xs font-bold hover:bg-navy/20 flex items-center gap-1"
                    >
                      🔄 Sync 30 Days
                    </button>
                  )}
                </div>
              )}

              {/* Scrollable List */}
              <div className="overflow-y-auto flex-1">
                {loading ? (
                  <div className="p-4 text-center text-xs text-text-muted">
                    Loading emails...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="p-4 text-center text-xs text-text-muted">
                    Mailbox is empty.
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        onClick={() => {
                          setSelectedMessage(msg);
                          if (!msg.is_read) toggleReadStatus(msg.id, false); // Auto-read on click
                        }}
                        className={`p-4 cursor-pointer transition ${selectedMessage?.id === msg.id ? "bg-navy/5 border-l-4 border-navy" : "hover:bg-background border-l-4 border-transparent"}`}
                      >
                        <div className="flex justify-between items-baseline mb-1">
                          <span
                            className={`font-bold text-sm truncate pr-2 ${!msg.is_read ? "text-navy" : "text-text-main"}`}
                          >
                            {activeTab === "inbox"
                              ? msg.from_address
                              : `To: ${msg.to_address}`}
                          </span>
                          <span className="text-[10px] text-text-muted whitespace-nowrap">
                            {new Date(msg.received_at).toLocaleDateString()}
                          </span>
                        </div>
                        <p
                          className={`text-xs truncate ${!msg.is_read ? "font-semibold text-text-main" : "text-text-muted"}`}
                        >
                          {msg.subject || "(No Subject)"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Email Reader Area (Right Column) - TAKES REMAINING SPACE */}
            <div className="flex-1 flex flex-col bg-background relative min-w-0 overflow-hidden">
              {selectedMessage ? (
                <>
                  <div className="p-6 border-b border-border bg-surface">
                    <div className="flex justify-between items-start mb-4">
                      <h2 className="text-xl font-bold text-navy truncate pr-4">
                        {selectedMessage.subject || "(No Subject)"}
                      </h2>

                      {/* Reader Action Toolbar */}
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() =>
                            toggleReadStatus(
                              selectedMessage.id,
                              selectedMessage.is_read,
                            )
                          }
                          className="p-2 text-text-muted hover:bg-background rounded"
                          title={
                            selectedMessage.is_read
                              ? "Mark Unread"
                              : "Mark Read"
                          }
                        >
                          {selectedMessage.is_read ? (
                            <MailClosed className="h-4 w-4" />
                          ) : (
                            <MailOpen className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => deleteMessage(selectedMessage.id)}
                          className="p-2 text-rose-500 hover:bg-rose-50 rounded"
                          title="Delete Email"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-xs text-text-muted">
                      <div className="truncate pr-4">
                        <p className="truncate">
                          <strong className="text-text-main">From:</strong>{" "}
                          {selectedMessage.from_address}
                        </p>
                        <p className="truncate">
                          <strong className="text-text-main">To:</strong>{" "}
                          {selectedMessage.to_address}
                        </p>
                      </div>
                      <p className="shrink-0">
                        {new Date(selectedMessage.received_at).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="p-6 flex-1 overflow-y-auto text-sm text-text-main whitespace-pre-wrap">
                    {selectedMessage.body_text || "No content."}
                  </div>

                  {activeTab === "inbox" && (
                    <div className="p-4 border-t border-border bg-surface flex gap-2">
                      <button
                        onClick={() => initiateReply(selectedMessage)}
                        className="px-4 py-2 bg-navy text-white rounded font-bold text-xs flex items-center gap-2 hover:bg-navy/90"
                      >
                        <Reply className="h-4 w-4" /> Reply
                      </button>
                      <button
                        onClick={() => initiateForward(selectedMessage)}
                        className="px-4 py-2 border border-border text-navy rounded font-bold text-xs flex items-center gap-2 hover:bg-background transition"
                      >
                        <Forward className="h-4 w-4" /> Forward
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
                  <div className="text-center space-y-2">
                    <Mail className="h-12 w-12 mx-auto opacity-20" />
                    <p>Select a message to read</p>
                  </div>
                </div>
              )}

              {/* Compose/Reply Overlay Modal */}
              {isComposing && (
                <div className="absolute bottom-0 right-4 w-[500px] h-[550px] bg-surface rounded-t-xl shadow-2xl border border-border flex flex-col z-10">
                  <div className="bg-navy p-3 rounded-t-xl flex justify-between items-center text-white">
                    <span className="font-bold text-sm">New Message</span>
                    <button
                      onClick={() => setIsComposing(false)}
                      className="hover:text-gray-300"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <form
                    onSubmit={handleSendEmail}
                    className="flex-1 flex flex-col"
                  >
                    <div className="border-b border-border p-2 flex items-center text-xs">
                      <span className="w-16 font-semibold text-text-muted">
                        From:
                      </span>
                      <select
                        value={composeFromId}
                        onChange={(e) => setComposeFromId(e.target.value)}
                        className="flex-1 outline-none bg-transparent font-medium"
                      >
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.display_name} &lt;{a.email_address}&gt;
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="border-b border-border p-2 flex items-center text-xs">
                      <span className="w-16 font-semibold text-text-muted">
                        To:
                      </span>
                      <input
                        type="email"
                        required
                        value={composeTo}
                        onChange={(e) => setComposeTo(e.target.value)}
                        className="flex-1 outline-none bg-transparent"
                      />
                    </div>
                    <div className="border-b border-border p-2 flex items-center text-xs">
                      <span className="w-16 font-semibold text-text-muted">
                        Subject:
                      </span>
                      <input
                        type="text"
                        required
                        value={composeSubject}
                        onChange={(e) => setComposeSubject(e.target.value)}
                        className="flex-1 outline-none bg-transparent"
                      />
                    </div>

                    <textarea
                      value={composeBody}
                      onChange={(e) => setComposeBody(e.target.value)}
                      className="flex-1 p-3 outline-none resize-none text-xs"
                      placeholder="Type your message here..."
                    />

                    {/* Attachments Preview Area */}
                    {attachments.length > 0 && (
                      <div className="p-2 bg-background border-t border-border flex flex-wrap gap-2">
                        {attachments.map((att, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-1 bg-surface border border-border px-2 py-1 rounded text-[10px]"
                          >
                            {att.type === "Tax Invoice" ? (
                              <Receipt className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <FileText className="h-3 w-3 text-blue-600" />
                            )}
                            <span className="truncate max-w-[100px]">
                              {att.name}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setAttachments(
                                  attachments.filter((_, i) => i !== idx),
                                )
                              }
                            >
                              <X className="h-3 w-3 text-rose-500" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="p-3 border-t border-border bg-background flex justify-between items-center">
                      <div className="flex gap-2">
                        {/* PC File Upload Button */}
                        <label
                          className="p-1.5 hover:bg-surface rounded cursor-pointer text-text-muted hover:text-navy"
                          title="Attach file from PC"
                        >
                          <Upload className="h-4 w-4" />
                          <input
                            type="file"
                            className="hidden"
                            onChange={attachPCFile}
                          />
                        </label>

                        {/* System File Attacher Dropdown - Upgraded UI */}
                        <div className="relative">
                          <button 
                            type="button" 
                            onClick={() => setShowFileMenu(!showFileMenu)}
                            className={`p-1.5 rounded transition ${showFileMenu ? 'bg-navy text-white' : 'text-text-muted hover:bg-surface hover:text-navy'}`} 
                            title="Attach System Invoice/Vault Document"
                          >
                            <Paperclip className="h-4 w-4" />
                          </button>
                          
                          {showFileMenu && (
                            <div className="absolute bottom-full left-0 mb-1 w-72 bg-surface border border-border shadow-lg rounded overflow-hidden z-20 flex flex-col max-h-64">
                              <div className="flex justify-between items-center text-[10px] font-bold bg-background p-2 border-b border-border uppercase shrink-0">
                                <span>Select System File</span>
                                <button type="button" onClick={() => setShowFileMenu(false)} className="text-text-muted hover:text-rose-500">
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                              
                              <div className="overflow-y-auto flex-1">
                                {systemFiles.length === 0 ? (
                                  <div className="p-4 text-center text-text-muted text-xs">
                                    No documents found in vault.
                                  </div>
                                ) : (
                                  systemFiles.map((sf, idx) => (
                                    <button 
                                      key={idx} 
                                      type="button" 
                                      onClick={() => {
                                        attachSystemFile(sf.url, sf.name);
                                        setShowFileMenu(false);
                                      }} 
                                      className="w-full text-left p-2 hover:bg-background text-xs flex items-center gap-2 border-b border-border/50 last:border-0 transition"
                                    >
                                      {/* Dynamic Icons based on File Type */}
                                      {sf.type === "Tax Invoice" ? (
                                        <Receipt className="h-4 w-4 text-emerald-600 shrink-0"/>
                                      ) : sf.type === "Fee Quotation" ? (
                                        <FileText className="h-4 w-4 text-purple-600 shrink-0"/>
                                      ) : (
                                        <Folder className="h-4 w-4 text-blue-600 shrink-0"/>
                                      )}
                                      
                                      <span className="truncate flex-1 font-medium">{sf.name}</span>
                                      
                                      {/* Type Badge */}
                                      <span className="text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-black/5 text-text-muted shrink-0">
                                        {sf.type}
                                      </span>
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* AI Auto-Reply Generator */}
                        <button
                          type="button"
                          onClick={handleAutoReplyGenerate}
                          className="p-1.5 hover:bg-blue-50 text-blue-600 rounded flex items-center gap-1 text-xs font-bold"
                          title="Generate AI Draft Reply"
                        >
                          <Sparkles className="h-4 w-4" /> Auto-Draft
                        </button>
                      </div>

                      <button
                        type="submit"
                        className="px-4 py-1.5 bg-navy text-white rounded font-bold text-xs flex items-center gap-1.5 hover:bg-navy/90"
                      >
                        <Send className="h-3.5 w-3.5" /> Send Mail
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
