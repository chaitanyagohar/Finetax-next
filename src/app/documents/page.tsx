"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Folder,
  Plus,
  Search,
  Trash2,
  ExternalLink,
  FileText,
  Download,
  X,
  Upload,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Link2,
  Mail,
  Edit2,
  FileSpreadsheet,
  FileImage,
  FileArchive,
  ShieldCheck,
  Users,
  Calendar,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { clientLabel, sortByLabel } from "@/components/ui/ClientPicker";
import { useTaskCategories } from "@/components/tasks/TaskCategories";
import ClientPicker, { clientLabel, sortByLabel } from "@/components/ui/ClientPicker";
import { formatDate, localISODate } from "@/lib/format";

const CATEGORIES = ["Tax", "Statutory", "Audit", "Legal", "Invoice", "KYC", "Financials", "Other"];
const BUCKET = "firm-documents";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXT = ["pdf", "xls", "xlsx", "csv", "doc", "docx", "ppt", "pptx", "txt", "jpg", "jpeg", "png", "zip", "xml", "json"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

function formatBytes(bytes: number) {
  if (!bytes) return "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
function extOf(name: string): string {
  return (name.split(".").pop() || "").toLowerCase();
}
function safeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(-120) || "file";
}
function FileIcon({ name }: { name: string }) {
  const ext = extOf(name);
  if (["xls", "xlsx", "csv"].includes(ext)) return <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />;
  if (["jpg", "jpeg", "png"].includes(ext)) return <FileImage className="h-4 w-4 shrink-0 text-violet-600" />;
  if (["zip"].includes(ext)) return <FileArchive className="h-4 w-4 shrink-0 text-amber-600" />;
  return <FileText className="h-4 w-4 shrink-0 text-blue-600" />;
}

export default function DocumentsPage() {
  const currentUser = useCurrentUser();
  const me = currentUser?.id || "";
  const isAdmin = !!currentUser?.isAdmin;
  const [supabase] = useState(() => createClient());
  // Editable categories (replaces the fixed list inside this page)
  const { activeNames: CATEGORIES } = useTaskCategories();

  const [documents, setDocuments] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [uploaderFilter, setUploaderFilter] = useState("all");

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  // Upload / edit modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any | null>(null);
  const [title, setTitle] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [formError, setFormError] = useState("");
  const [category, setCategory] = useState("Tax");
  const [clientId, setClientId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [description, setDescription] = useState("");

  // Email modal
  const [emailDoc, setEmailDoc] = useState<any | null>(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 5000);
  }

  async function loadData() {
    setLoading(true);
    const [dRes, cRes, tRes, pRes] = await Promise.all([
      supabase.from("documents").select("*").order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name, organization_name, email, phone, pan, gstin, status").order("name", { ascending: true }),
      supabase.from("tasks").select("id, title, client_id, stage").neq("stage", "Approved").order("due_date", { ascending: true }),
      supabase.from("profiles").select("id, name").order("name", { ascending: true }),
    ]);
    if (dRes.error) showToast("error", "Could not load the document vault.");
    setDocuments(dRes.data || []);
    setClients(cRes.data || []);
    setTasks(tRes.data || []);
    setTeam(pRes.data || []);
    setLoading(false);
  }

  const clientById = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
  const teamName = (id?: string) => team.find((t) => t.id === id)?.name || "";
  const canDelete = (doc: any) => isAdmin || doc.uploaded_by === me;
  const sizeOf = (doc: any) => Number(doc.size_bytes ?? doc.sizeBytes ?? 0);

  /* ---------------- Stats & filtering ---------------- */

  const monthStart = localISODate().slice(0, 8) + "01";
  const stats = useMemo(
    () => ({
      total: documents.length,
      storage: documents.reduce((s, d) => s + sizeOf(d), 0),
      thisMonth: documents.filter((d) => String(d.created_at || "").slice(0, 10) >= monthStart).length,
      clientsCovered: new Set(documents.map((d) => d.client_id).filter(Boolean)).size,
    }),
    [documents, monthStart]
  );

  const filteredDocuments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((d) => {
      if (categoryFilter !== "all" && d.category !== categoryFilter) return false;
      if (clientFilter === "internal" && d.client_id) return false;
      if (clientFilter !== "all" && clientFilter !== "internal" && d.client_id !== clientFilter) return false;
      if (uploaderFilter === "mine" && d.uploaded_by !== me) return false;
      if (uploaderFilter !== "all" && uploaderFilter !== "mine" && d.uploaded_by !== uploaderFilter) return false;
      if (!q) return true;
      return [d.title, d.file_name, d.category, d.description, clientById[d.client_id]?.name, clientById[d.client_id]?.organization_name]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q));
    });
  }, [documents, search, categoryFilter, clientFilter, uploaderFilter, clientById, me]);

  /* ---------------- Upload / edit ---------------- */

  function openUpload() {
    setEditingDoc(null);
    setTitle("");
    setSelectedFiles([]);
    setCategory("Tax");
    setClientId(clientFilter !== "all" && clientFilter !== "internal" ? clientFilter : "");
    setTaskId("");
    setDescription("");
    setFormError("");
    setUploadProgress("");
    setIsModalOpen(true);
  }

  function openEdit(doc: any) {
    setEditingDoc(doc);
    setTitle(doc.title || "");
    setSelectedFiles([]);
    setCategory(doc.category || "Other");
    setClientId(doc.client_id || "");
    setTaskId(doc.task_id || "");
    setDescription(doc.description || "");
    setFormError("");
    setIsModalOpen(true);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    const rejected: string[] = [];
    const ok = picked.filter((f) => {
      if (!ALLOWED_EXT.includes(extOf(f.name))) {
        rejected.push(`${f.name} (type not allowed)`);
        return false;
      }
      if (f.size > MAX_FILE_BYTES) {
        rejected.push(`${f.name} (over 50 MB)`);
        return false;
      }
      return true;
    });
    setSelectedFiles((prev) => [...prev, ...ok]);
    if (ok.length === 1 && !title && selectedFiles.length === 0) setTitle(ok[0].name.replace(/\.[^/.]+$/, ""));
    setFormError(rejected.length ? `Skipped: ${rejected.join(", ")}` : "");
    e.target.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (uploading) return;
    setFormError("");

    // Edit details only
    if (editingDoc) {
      if (!title.trim()) return setFormError("Title is required.");
      setUploading(true);
      const { error } = await supabase
        .from("documents")
        .update({ title: title.trim(), category, client_id: clientId || null, task_id: taskId || null, description: description.trim() })
        .eq("id", editingDoc.id);
      setUploading(false);
      if (error) return setFormError(error.message);
      logAuditEvent("UPDATE_DOCUMENT", "DOCUMENTS", editingDoc.id, { title: title.trim(), category });
      showToast("success", "Document details updated.");
      setIsModalOpen(false);
      loadData();
      return;
    }

    if (selectedFiles.length === 0) return setFormError("Choose at least one file to upload.");
    if (selectedFiles.length === 1 && !title.trim()) return setFormError("Title is required.");

    setUploading(true);
    let done = 0;
    const failures: string[] = [];

    for (const file of selectedFiles) {
      setUploadProgress(`Uploading ${done + 1} of ${selectedFiles.length}: ${file.name}`);
      const path = `${clientId || "internal"}/${new Date().getFullYear()}/${crypto.randomUUID()}-${safeFileName(file.name)}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || undefined,
        upsert: false,
      });
      if (upErr) {
        failures.push(`${file.name}: ${upErr.message}`);
        continue;
      }

      const docTitle = selectedFiles.length === 1 ? title.trim() : file.name.replace(/\.[^/.]+$/, "");
      const { data, error: dbErr } = await supabase
        .from("documents")
        .insert([
          {
            title: docTitle,
            category,
            client_id: clientId || null,
            task_id: taskId || null,
            description: description.trim(),
            storage_path: path,
            bucket: BUCKET,
            file_name: file.name,
            size_bytes: file.size,
            mime_type: file.type || null,
            file_size: formatBytes(file.size),
          },
        ])
        .select("id")
        .single();

      if (dbErr || !data) {
        // Clean up the orphaned file so storage never holds unregistered documents
        await supabase.storage.from(BUCKET).remove([path]);
        failures.push(`${file.name}: ${dbErr?.message || "could not register"}`);
        continue;
      }

      logAuditEvent("UPLOAD_DOCUMENT", "DOCUMENTS", data.id, {
        title: docTitle,
        client: clientById[clientId]?.name || "Internal",
        size: formatBytes(file.size),
      });
      done++;
    }

    setUploading(false);
    setUploadProgress("");
    if (failures.length) {
      setFormError(`${done} uploaded. Failed: ${failures.join(" · ")}`);
      setSelectedFiles([]);
      loadData();
      return;
    }
    showToast("success", `${done} document${done === 1 ? "" : "s"} uploaded to the private vault.`);
    setIsModalOpen(false);
    loadData();
  }

  /* ---------------- Open / download / share ---------------- */

  async function signedUrl(doc: any, seconds: number, download: boolean): Promise<string | null> {
    if (!doc.storage_path) {
      showToast("error", "This document has no stored file. Please re-upload it.");
      return null;
    }
    const { data, error } = await supabase.storage
      .from(doc.bucket || BUCKET)
      .createSignedUrl(doc.storage_path, seconds, download ? { download: doc.file_name || doc.title || true } : undefined);
    if (error || !data?.signedUrl) {
      showToast("error", "Could not open this file. It may have been moved or deleted.");
      return null;
    }
    return data.signedUrl;
  }

  async function openDocument(doc: any, download = false) {
    const win = download ? null : window.open("", "_blank");
    setBusyId(doc.id);
    const url = await signedUrl(doc, 300, download);
    setBusyId(null);
    if (!url) {
      win?.close();
      return;
    }
    if (download) {
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else if (win) {
      win.location.href = url;
    }
    logAuditEvent(download ? "DOWNLOAD_DOCUMENT" : "VIEW_DOCUMENT", "DOCUMENTS", doc.id, { title: doc.title });
  }

  async function shareLink(doc: any) {
    setBusyId(doc.id);
    const url = await signedUrl(doc, 7 * 24 * 3600, true);
    setBusyId(null);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      const expiry = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      showToast("success", `Link copied. Anyone with it can download until ${formatDate(localISODate(expiry))}.`);
      logAuditEvent("SHARE_DOCUMENT_LINK", "DOCUMENTS", doc.id, { title: doc.title, expires: localISODate(expiry) });
    } catch {
      showToast("error", "Could not copy the link.");
    }
  }

  /* ---------------- Email ---------------- */

  function openEmail(doc: any) {
    const client = clientById[doc.client_id];
    setEmailDoc(doc);
    setEmailTo(client?.email || "");
    setEmailSubject(`Document: ${doc.title}`);
    setEmailBody(`Dear ${client?.name || "Client"},\n\nPlease find attached "${doc.title}".\n\nBest regards,\n${currentUser?.name || "Finetax Team"}`);
    setEmailError("");
  }

  async function sendEmail() {
    if (!emailDoc || emailSending) return;
    const recipients = emailTo.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (recipients.length === 0 || recipients.some((r) => !EMAIL_RE.test(r))) return setEmailError("Enter valid email addresses.");
    if (sizeOf(emailDoc) > 20 * 1024 * 1024) return setEmailError("This file is over 20 MB. Use 'Share link' instead.");

    setEmailSending(true);
    setEmailError("");
    try {
      const fd = new FormData();
      fd.append("to", recipients.join(", "));
      fd.append("subject", emailSubject.trim() || `Document: ${emailDoc.title}`);
      fd.append("body", emailBody);
      fd.append("documentIds", emailDoc.id);
      const res = await fetch("/api/send-email", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send the email.");
      showToast("success", `"${emailDoc.title}" emailed to ${recipients.join(", ")}.`);
      setEmailDoc(null);
    } catch (err: any) {
      setEmailError(err?.message || "Could not send the email.");
    } finally {
      setEmailSending(false);
    }
  }

  /* ---------------- Delete ---------------- */

  async function handleDelete() {
    const doc = deleteTarget;
    if (!doc) return;
    setBusyId(doc.id);
    const { error: dbErr } = await supabase.from("documents").delete().eq("id", doc.id);
    if (dbErr) {
      setBusyId(null);
      setDeleteTarget(null);
      return showToast("error", "Could not delete this document. Only its uploader or an administrator can.");
    }
    if (doc.storage_path) {
      const { error: stErr } = await supabase.storage.from(doc.bucket || BUCKET).remove([doc.storage_path]);
      if (stErr) console.error("Storage cleanup failed:", stErr.message);
    }
    logAuditEvent("DELETE_DOCUMENT", "DOCUMENTS", doc.id, { title: doc.title });
    setBusyId(null);
    setDeleteTarget(null);
    showToast("success", "Document deleted.");
    loadData();
  }

  const taskOptions = tasks.filter((t) => !clientId || t.client_id === clientId || t.id === taskId);

  /* ---------------- Render ---------------- */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <Folder className="h-5 w-5 text-navy" /> Secure Document Vault
          </h2>
          <p className="mt-1 flex items-center gap-1 text-xs text-text-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Private storage. Files open through links that expire within minutes.
          </p>
        </div>
        <button
          type="button"
          onClick={openUpload}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light sm:w-auto"
        >
          <Upload className="h-4 w-4" /> Upload Files
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          { label: "Documents", value: String(stats.total), sub: "In the vault", icon: Folder, style: "bg-navy/10 text-navy", valueClass: "text-navy" },
          { label: "Storage Used", value: formatBytes(stats.storage), sub: "Across all files", icon: HardDrive, style: "bg-violet-50 text-violet-600", valueClass: "text-violet-700" },
          { label: "This Month", value: String(stats.thisMonth), sub: "New uploads", icon: Calendar, style: "bg-emerald-50 text-emerald-600", valueClass: "text-emerald-700" },
          { label: "Clients Covered", value: String(stats.clientsCovered), sub: "With at least one document", icon: Users, style: "bg-amber-50 text-amber-600", valueClass: "text-amber-700" },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{k.label}</p>
                  <p className={`mt-1.5 text-2xl font-bold tracking-tight ${k.valueClass}`}>{k.value}</p>
                </div>
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${k.style}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-text-muted">{k.sub}</p>
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-col gap-2 border-b border-border p-4 lg:flex-row lg:items-center">
          <div className="relative w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search title, file name, client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="max-w-[200px] rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
              <option value="all">All clients</option>
              <option value="internal">Internal (no client)</option>
              {sortByLabel(clients.filter((c) => c.status !== "Merged")).map((c) => (
                <option key={c.id} value={c.id}>{clientLabel(c)}</option>
              ))}
            </select>
            <select value={uploaderFilter} onChange={(e) => setUploaderFilter(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
              <option value="all">Anyone</option>
              <option value="mine">Uploaded by me</option>
              {team.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <span className="text-[11px] text-text-muted lg:ml-auto">
            Showing {filteredDocuments.length} of {documents.length}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document vault...
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Folder className="h-6 w-6 text-text-muted" />
            <p className="text-xs text-text-muted">{documents.length === 0 ? "No documents yet. Upload your first file." : "No documents match these filters."}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Category</th>
                  <th>Client</th>
                  <th>Uploaded By</th>
                  <th className="text-right">Size</th>
                  <th>Date</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.map((doc) => {
                  const busy = busyId === doc.id;
                  return (
                    <tr key={doc.id} className="transition hover:bg-surface-alt">
                      <td>
                        <button type="button" onClick={() => openDocument(doc)} className="flex items-start gap-2 text-left">
                          <FileIcon name={doc.file_name || doc.title || ""} />
                          <span className="min-w-0">
                            <span className="block font-semibold text-navy hover:underline">{doc.title}</span>
                            {doc.file_name && doc.file_name !== doc.title && <span className="block truncate text-[10px] text-text-muted">{doc.file_name}</span>}
                            {!doc.storage_path && <span className="block text-[10px] font-semibold text-rose-600">File missing: please re-upload</span>}
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[10px] font-semibold text-navy">{doc.category || "Other"}</span>
                      </td>
                      <td>
                        {clientById[doc.client_id] ? (
                          <>
                            <p className="font-medium">{clientById[doc.client_id].organization_name || clientById[doc.client_id].name}</p>
                            {clientById[doc.client_id].organization_name && <p className="text-[10px] text-text-muted">{clientById[doc.client_id].name}</p>}
                          </>
                        ) : (
                          <span className="text-text-muted">Internal</span>
                        )}
                      </td>
                      <td className="text-text-muted">{teamName(doc.uploaded_by) || "—"}</td>
                      <td className="whitespace-nowrap text-right font-mono text-[11px] text-text-muted">{formatBytes(sizeOf(doc)) || doc.file_size || "—"}</td>
                      <td className="whitespace-nowrap text-text-muted">{doc.created_at ? formatDate(doc.created_at) : "—"}</td>
                      <td className="whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-0.5">
                          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-text-muted" />}
                          <button type="button" onClick={() => openDocument(doc)} disabled={busy} className="rounded-md p-1.5 text-navy transition hover:bg-surface-alt" title="Open">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => openDocument(doc, true)} disabled={busy} className="rounded-md p-1.5 text-navy transition hover:bg-surface-alt" title="Download">
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => openEmail(doc)} disabled={busy || !doc.storage_path} className="rounded-md p-1.5 text-navy transition hover:bg-surface-alt disabled:opacity-40" title="Email as attachment">
                            <Mail className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => shareLink(doc)} disabled={busy || !doc.storage_path} className="rounded-md p-1.5 text-navy transition hover:bg-surface-alt disabled:opacity-40" title="Copy a 7-day download link">
                            <Link2 className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => openEdit(doc)} className="rounded-md p-1.5 text-text-muted transition hover:bg-surface-alt" title="Edit details">
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          {canDelete(doc) && (
                            <button type="button" onClick={() => setDeleteTarget(doc)} className="rounded-md p-1.5 text-rose-600 transition hover:bg-rose-50" title="Delete">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ================= Upload / Edit ================= */}
      {isModalOpen && (
        <Modal
          title={editingDoc ? "Edit Document Details" : "Upload to Vault"}
          subtitle={editingDoc ? editingDoc.file_name || editingDoc.title : "PDF, Excel, Word, images, ZIP · up to 50 MB per file"}
          onClose={() => !uploading && setIsModalOpen(false)}
          maxWidth="max-w-lg"
          footer={
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-text-muted">{uploadProgress}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setIsModalOpen(false)} disabled={uploading} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                  Cancel
                </button>
                <button
                  type="submit"
                  form="doc-form"
                  disabled={uploading || (!editingDoc && selectedFiles.length === 0)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
                >
                  {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {editingDoc ? "Save Details" : `Upload ${selectedFiles.length || ""} File${selectedFiles.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          }
        >
          <form id="doc-form" onSubmit={handleSubmit} className="space-y-4 text-xs">
            {formError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 font-medium text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {!editingDoc && (
              <div className="space-y-2 rounded-lg border-2 border-dashed border-border bg-surface-alt p-4 text-center transition hover:border-navy">
                <input type="file" id="pc-file-input" multiple onChange={handleFileSelect} className="hidden" accept={ALLOWED_EXT.map((e) => `.${e}`).join(",")} />
                <label htmlFor="pc-file-input" className="block cursor-pointer space-y-1">
                  <Upload className="mx-auto h-6 w-6 text-navy" />
                  <p className="font-bold text-navy">Click to choose files</p>
                  <p className="text-[10px] text-text-muted">You can select several files at once</p>
                </label>
                {selectedFiles.length > 0 && (
                  <div className="space-y-1 pt-2 text-left">
                    {selectedFiles.map((f, i) => (
                      <div key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <FileIcon name={f.name} />
                          <span className="truncate">{f.name}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="font-mono text-[10px]">{formatBytes(f.size)}</span>
                          <button type="button" onClick={() => setSelectedFiles(selectedFiles.filter((_, idx) => idx !== i))} aria-label="Remove file">
                            <X className="h-3.5 w-3.5 text-rose-500" />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(editingDoc || selectedFiles.length <= 1) && (
              <div>
                <label className={labelClass}>Document Title *</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="e.g. FY 2025-26 Balance Sheet" maxLength={200} />
              </div>
            )}
            {!editingDoc && selectedFiles.length > 1 && <p className="text-[11px] text-text-muted">Each file uses its file name as the title. The details below apply to all.</p>}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Client</label>
                <ClientPicker
                  clients={clients as any}
                  value={clientId}
                  onChange={(id) => {
                    setClientId(id);
                    setTaskId("");
                  }}
                  noneLabel="Internal / none"
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Related Task</label>
              <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className={inputClass}>
                <option value="">— Optional —</option>
                {taskOptions.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Description</label>
              <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} placeholder="Period, version, notes..." />
            </div>
          </form>
        </Modal>
      )}

      {/* ================= Email document ================= */}
      {emailDoc && (
        <Modal
          title="Email document"
          subtitle={`"${emailDoc.title}" will be attached as a file`}
          onClose={() => !emailSending && setEmailDoc(null)}
          maxWidth="max-w-lg"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEmailDoc(null)} disabled={emailSending} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt">
                Cancel
              </button>
              <button
                type="button"
                onClick={sendEmail}
                disabled={emailSending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-navy-light disabled:opacity-60"
              >
                {emailSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Send
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-xs">
            {emailError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 font-medium text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{emailError}</span>
              </div>
            )}
            <div>
              <label className={labelClass}>To</label>
              <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} className={inputClass} placeholder="client@example.com" />
            </div>
            <div>
              <label className={labelClass}>Subject</label>
              <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className={inputClass} maxLength={300} />
            </div>
            <div>
              <label className={labelClass}>Message</label>
              <textarea rows={6} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} className={inputClass} />
            </div>
            <p className="text-[10px] text-text-muted">Sent from your firm's default email account. Files over 20 MB must be shared as a link.</p>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this document?"
          message={`"${deleteTarget.title}" and its stored file will be permanently removed.`}
          confirmLabel="Delete document"
          tone="danger"
          loading={busyId === deleteTarget.id}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
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