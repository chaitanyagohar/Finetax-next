"use client";

import { useState, useEffect } from "react";
import { Folder, Plus, Search, Trash2, ExternalLink, FileText, Download, X, Upload, HardDrive, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";

const CATEGORIES = ["Tax", "Statutory", "Audit", "Legal", "Invoice", "Other"];

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");

  // Modal & File Upload State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState("Tax");
  const [clientId, setClientId] = useState("");
  const [taskId, setTaskId] = useState("");

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, []);

async function loadData() {
    setLoading(true);

    // Fetch ONLY the raw documents. No joins, no complex logic.
    const { data: dData, error: dErr } = await supabase
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false });

    if (dErr) {
      console.error("CRITICAL DB ERROR:", dErr);
      alert("Database error: " + dErr.message); // This will pop up on your screen if it fails!
    } else {
      console.log("SUCCESSFUL FETCH:", dData);
      setDocuments(dData || []);
    }

    setLoading(false);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      if (!title) {
        setTitle(file.name.replace(/\.[^/.]+$/, "")); // Auto-fill title with filename
      }
    }
  }

  function formatBytes(bytes: number) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  async function handleFileUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) {
      alert("Please select a file from your computer to upload.");
      return;
    }

    setUploading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Upload File to Supabase Encrypted Storage Bucket
      const fileExt = selectedFile.name.split(".").pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `client_files/${fileName}`;

      const { error: uploadErr } = await supabase.storage
        .from("firm-documents")
        .upload(filePath, selectedFile, {
          cacheControl: "3600",
          upsert: false
        });

      if (uploadErr) throw uploadErr;

      // 2. Obtain Public File URL
      const { data: urlData } = supabase.storage
        .from("firm-documents")
        .getPublicUrl(filePath);

      const fileUrl = urlData.publicUrl;

      // 3. Register Metadata Record in PostgreSQL Database
      const payload = {
        title: title.trim(),
        file_url: fileUrl,
        category,
        client_id: clientId || null,
        task_id: taskId || null,
        uploaded_by: user?.id || null,
        file_size: formatBytes(selectedFile.size),
      };

      const { data, error: dbErr } = await supabase.from("documents").insert([payload]).select().single();
      if (dbErr) throw dbErr;

      logAuditEvent("UPLOAD_DOCUMENT", "DOCUMENTS", data.id, payload);
      alert("Document uploaded securely and registered in vault!");
      setIsModalOpen(false);
      resetForm();
      loadData();
    } catch (err: any) {
      alert("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(doc: any) {
    if (!confirm(`Delete document "${doc.title}"?`)) return;

    try {
      // 1. Delete record from database
      const { error: dbErr } = await supabase.from("documents").delete().eq("id", doc.id);
      if (dbErr) throw dbErr;

      // 2. Delete file from storage if it belongs to firm-documents bucket
      if (doc.file_url.includes("firm-documents")) {
        const fileKey = doc.file_url.split("firm-documents/")[1];
        if (fileKey) {
          await supabase.storage.from("firm-documents").remove([fileKey]);
        }
      }

      logAuditEvent("DELETE_DOCUMENT", "DOCUMENTS", doc.id);
      loadData();
    } catch (err: any) {
      alert("Error deleting document: " + err.message);
    }
  }

  function resetForm() {
    setTitle("");
    setSelectedFile(null);
    setCategory("Tax");
    setClientId("");
    setTaskId("");
  }

  const filteredDocuments = documents.filter((d) => {
    const matchesSearch = [d.title, d.clients?.name, d.category]
      .filter(Boolean)
      .some((f) => f.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory = categoryFilter === "all" ? true : d.category === categoryFilter;
    const matchesClient = clientFilter === "all" ? true : d.client_id === clientFilter;
    return matchesSearch && matchesCategory && matchesClient;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-surface p-5 rounded-lg border border-border shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-text-main flex items-center gap-2">
            <Folder className="h-5 w-5 text-navy" /> Secure Document Vault
          </h2>
          <p className="text-xs text-text-muted mt-1">
            Upload client tax files, statutory returns, and audit deliverables directly from your PC.
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-navy text-white px-4 py-2 rounded-md font-medium text-xs hover:bg-navy/90 transition"
        >
          <Upload className="h-4 w-4" /> Upload PC File
        </button>
      </div>

      {/* Toolbar & Filters */}
      <div className="bg-surface p-4 rounded-lg border border-border shadow-sm flex flex-col sm:flex-row justify-between gap-3">
        <div className="relative w-full sm:w-60">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search documents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-border rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-navy"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border border-border rounded p-2 text-xs bg-surface font-semibold text-navy"
          >
            <option value="all">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="border border-border rounded p-2 text-xs bg-surface"
          >
            <option value="all">All Clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Documents Table */}
      <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted text-xs">Loading document vault...</div>
        ) : filteredDocuments.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs">No documents found matching your filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-text-muted bg-background/50">
                  <th className="p-3">Document Title</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Client</th>
                  <th className="p-3">Uploaded By</th>
                  <th className="p-3">Size</th>
                  <th className="p-3">Date</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredDocuments.map((doc) => (
                  <tr key={doc.id} className="hover:bg-background/50 transition">
                    <td className="p-3 font-bold text-navy flex items-center gap-2">
                      <FileText className="h-4 w-4 text-blue-600 shrink-0" /> {doc.title}
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 bg-navy/10 text-navy font-bold rounded text-[10px] uppercase">
                        {doc.category}
                      </span>
                    </td>
                    <td className="p-3 font-medium">{doc.clients?.name || "Internal"}</td>
                    <td className="p-3 text-text-muted">{doc.profiles?.name || "Staff"}</td>
                    <td className="p-3 text-text-muted font-mono text-[11px]">{doc.file_size || "-"}</td>
                    <td className="p-3 text-text-muted">{new Date(doc.created_at).toISOString().slice(0, 10)}</td>
                    <td className="p-3 text-right space-x-2">
                      <a
                        href={doc.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-navy font-bold hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Open / Download
                      </a>
                      <button
                        onClick={() => handleDelete(doc)}
                        className="text-rose-600 hover:bg-rose-50 p-1 rounded"
                        title="Delete file"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* PC File Upload Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md p-5 space-y-4 shadow-xl text-xs">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-sm text-text-main flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-navy" /> Upload Local Document
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-text-muted hover:text-text-main">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleFileUpload} className="space-y-4">
              {/* File Selector Drag-Drop Box */}
              <div className="border-2 border-dashed border-border hover:border-navy p-4 rounded-lg text-center bg-background space-y-2 transition">
                <input
                  type="file"
                  id="pc-file-input"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <label htmlFor="pc-file-input" className="cursor-pointer block space-y-1">
                  <Upload className="h-6 w-6 text-navy mx-auto" />
                  <p className="font-bold text-navy text-xs">Click to browse or choose file from PC</p>
                  <p className="text-[10px] text-text-muted">PDF, Excel, Word, Images, Zip supported (Max 50MB)</p>
                </label>

                {selectedFile && (
                  <div className="p-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded font-semibold text-[11px] flex items-center justify-between mt-2">
                    <span className="truncate max-w-[200px]">{selectedFile.name}</span>
                    <span className="text-[10px] font-mono">{formatBytes(selectedFile.size)}</span>
                  </div>
                )}
              </div>

              <div>
                <label className="block font-semibold text-text-muted mb-1">DOCUMENT TITLE *</label>
                <input
                  required
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full border border-border rounded p-2 text-xs"
                  placeholder="e.g. FY 2025-26 Balance Sheet"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">CATEGORY</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">CLIENT</label>
                  <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                    <option value="">Internal / None</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-text-muted mb-1">ASSOCIATED TASK</label>
                <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                  <option value="">-- Optional --</option>
                  {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-1.5 border border-border rounded"
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !selectedFile}
                  className="px-4 py-1.5 bg-navy text-white rounded font-bold hover:bg-navy/90 disabled:bg-gray-400 flex items-center gap-1.5"
                >
                  {uploading ? "Uploading to Cloud..." : "Upload & Save File"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}