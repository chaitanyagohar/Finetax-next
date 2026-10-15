"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Plus,
  Trash2,
  X,
  Building2,
  ShieldAlert,
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Users,
  UserCheck,
  BadgeCheck,
  Wallet,
  Receipt,
  CheckSquare,
  UserX,
  Phone,
  Mail,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Client } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";
import { useCurrentUser } from "@/components/layout/UserContext";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { compactINR, formatDate, formatINR, getInitials } from "@/lib/format";

type ClientRow = Client & Record<string, any>;

const CLIENT_TYPES = [
  "Individual",
  "HUF",
  "Proprietorship",
  "Partnership",
  "LLP",
  "Private Limited",
  "Public Limited",
  "Trust/NGO",
  "Government",
  "Other",
];

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar",
  "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman & Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};
const STATE_NAMES = Array.from(new Set(Object.values(GST_STATE_CODES))).sort();

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted";

/* ---------------- CSV helpers ---------------- */

/** RFC-4180 parser: handles quotes, escaped quotes, commas and newlines inside fields. */
function parseCSV(raw: string): string[][] {
  const text = raw.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Escapes a value for CSV and blocks spreadsheet formula injection. */
function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadFile(content: string, filename: string) {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const HEADER_MAP: Record<string, string> = {
  name: "name",
  clientname: "name",
  organizationname: "organization_name",
  organisationname: "organization_name",
  organization: "organization_name",
  organisation: "organization_name",
  company: "organization_name",
  type: "type",
  clienttype: "type",
  pan: "pan",
  gstin: "gstin",
  gst: "gstin",
  email: "email",
  phone: "phone",
  mobile: "phone",
  state: "state",
  address: "address",
  status: "status",
  notes: "notes",
};

interface ImportRow {
  line: number;
  data: Record<string, string>;
  errors: string[];
  warnings: string[];
}

/* ---------------- Page ---------------- */

export default function ClientsPage() {
  const currentUser = useCurrentUser();
  const isAdmin = !!currentUser?.isAdmin;
  const [supabase] = useState(() => createClient());

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [team, setTeam] = useState<{ id: string; name: string; is_active?: boolean }[]>([]);
  const [outstandingByClient, setOutstandingByClient] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Inactive">("Active");
  const [typeFilter, setTypeFilter] = useState("");
  const [rmFilter, setRmFilter] = useState("");

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirm, setConfirm] = useState<null | "delete" | "inactive">(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [panWarning, setPanWarning] = useState("");
  const [panDupConfirmed, setPanDupConfirmed] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [type, setType] = useState("Individual");
  const [pan, setPan] = useState("");
  const [gstin, setGstin] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState<string>("Active");
  const [assignedTo, setAssignedTo] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  // Client snapshot
  const [snapshot, setSnapshot] = useState<{ invoices: any[]; tasks: any[]; quotations: any[] } | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);

  // CSV Import State
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importCount, setImportCount] = useState<number | null>(null);

  useEffect(() => {
    fetchClients();
  }, []);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4500);
  }

  async function fetchClients(showSpinner = true) {
    if (showSpinner) setLoading(true);

    const [cRes, iRes, pRes] = await Promise.all([
      supabase.from("clients").select("*").order("name", { ascending: true }),
      supabase.from("invoices").select("client_id, total, amount_paid, status"),
      supabase.from("profiles").select("id, name, is_active").order("name", { ascending: true }),
    ]);

    if (cRes.error) showToast("error", "Could not load clients. Please refresh the page.");
    if (cRes.data) setClients(cRes.data as ClientRow[]);
    if (pRes.data) setTeam(pRes.data as any[]);
    if (iRes.data) {
      const map: Record<string, number> = {};
      iRes.data.forEach((inv: any) => {
        if (!inv.client_id || ["Draft", "Cancelled"].includes(inv.status || "Draft")) return;
        const bal = Number(inv.total || 0) - Number(inv.amount_paid || 0);
        if (bal > 0.009) map[inv.client_id] = (map[inv.client_id] || 0) + bal;
      });
      setOutstandingByClient(map);
    }

    setLoading(false);
  }

  async function loadSnapshot(clientId: string) {
    setLoadingSnapshot(true);
    const [invRes, taskRes, quoteRes] = await Promise.all([
      supabase
        .from("invoices")
        .select("id, invoice_number, total, amount_paid, status, date, due_date")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
      supabase.from("tasks").select("id, title, stage, due_date").eq("client_id", clientId).order("due_date", { ascending: true }),
      supabase.from("quotations").select("id, quote_number, total, status").eq("client_id", clientId),
    ]);
    setSnapshot({ invoices: invRes.data || [], tasks: taskRes.data || [], quotations: quoteRes.data || [] });
    setLoadingSnapshot(false);
  }

  const teamName = (id?: string) => team.find((t) => String(t.id) === String(id))?.name || "";
  const statusOf = (c: ClientRow) => c.status || "Active";

  /* ---------------- Analytics & filtering ---------------- */

  const stats = useMemo(() => {
    const active = clients.filter((c) => statusOf(c) === "Active");
    const outstandingTotal = Object.values(outstandingByClient).reduce((a, b) => a + b, 0);
    return {
      total: clients.length,
      active: active.length,
      gstRegistered: clients.filter((c) => !!c.gstin).length,
      outstandingTotal,
      withDues: Object.keys(outstandingByClient).length,
    };
  }, [clients, outstandingByClient]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (statusFilter !== "All" && statusOf(c) !== statusFilter) return false;
      if (typeFilter && (c.type || "Individual") !== typeFilter) return false;
      if (rmFilter === "unassigned" && c.assigned_to) return false;
      if (rmFilter && rmFilter !== "unassigned" && String(c.assigned_to) !== rmFilter) return false;
      if (!q) return true;
      return [c.name, c.organization_name, c.pan, c.gstin, c.email, c.phone, c.state]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q));
    });
  }, [clients, search, statusFilter, typeFilter, rmFilter]);

  /* ---------------- Form ---------------- */

  const panUpper = pan.trim().toUpperCase();
  const gstinUpper = gstin.trim().toUpperCase();
  const panValid = !panUpper || PAN_RE.test(panUpper);
  const gstinValid = !gstinUpper || GSTIN_RE.test(gstinUpper);
  const gstPanMismatch = !!panUpper && !!gstinUpper && gstinValid && panValid && gstinUpper.slice(2, 12) !== panUpper;

  function handleGstinChange(value: string) {
    const v = value.toUpperCase().replace(/\s/g, "");
    setGstin(v);
    if (GSTIN_RE.test(v)) {
      const stateName = GST_STATE_CODES[v.slice(0, 2)];
      if (stateName) setState(stateName);
      if (!pan.trim()) setPan(v.slice(2, 12));
    }
  }

  function openModal(client?: ClientRow) {
    setFormError("");
    setPanWarning("");
    setPanDupConfirmed(false);
    setSnapshot(null);
    if (client) {
      setEditingClient(client);
      setName(client.name || "");
      setOrganizationName(client.organization_name || "");
      setType(client.type || "Individual");
      setPan(client.pan || "");
      setGstin(client.gstin || "");
      setEmail(client.email || "");
      setPhone(client.phone || "");
      setState(client.state || "");
      setStatus(client.status || "Active");
      setAssignedTo(client.assigned_to || "");
      setAddress(client.address || "");
      setNotes(client.notes || "");
      loadSnapshot(client.id);
    } else {
      setEditingClient(null);
      resetForm();
    }
    setIsModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setIsModalOpen(false);
    setEditingClient(null);
    setSnapshot(null);
    resetForm();
  }

  function resetForm() {
    setName("");
    setOrganizationName("");
    setType("Individual");
    setPan("");
    setGstin("");
    setEmail("");
    setPhone("");
    setState("");
    setStatus("Active");
    setAssignedTo("");
    setAddress("");
    setNotes("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setFormError("");

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName) return setFormError("Client name is required.");
    if (!panValid) return setFormError("PAN must look like ABCDE1234F.");
    if (!gstinValid) return setFormError("GSTIN must look like 07ABCDE1234F1Z5.");
    if (gstPanMismatch) return setFormError("This GSTIN does not belong to the PAN entered.");
    if (cleanEmail && !EMAIL_RE.test(cleanEmail)) return setFormError("Please enter a valid email address.");
    if (phone.trim() && phone.replace(/\D/g, "").length < 10) return setFormError("Please enter a valid mobile number.");

    setSaving(true);
    try {
      // Duplicate checks (GSTIN is unique; a shared PAN is allowed after confirmation)
      if (gstinUpper) {
        let q = supabase.from("clients").select("id, name").eq("gstin", gstinUpper).limit(1);
        if (editingClient) q = q.neq("id", editingClient.id);
        const { data } = await q;
        if (data && data.length) {
          setFormError(`GSTIN ${gstinUpper} already belongs to "${data[0].name}".`);
          return;
        }
      }
      if (panUpper && !panDupConfirmed) {
        let q = supabase.from("clients").select("id, name").eq("pan", panUpper).limit(1);
        if (editingClient) q = q.neq("id", editingClient.id);
        const { data } = await q;
        if (data && data.length) {
          setPanWarning(`PAN ${panUpper} is already used by "${data[0].name}". If this is another GST registration of the same business, click Save again.`);
          setPanDupConfirmed(true);
          return;
        }
      }

      const payload = {
        name: cleanName,
        organization_name: organizationName.trim(),
        type,
        pan: panUpper || null,
        gstin: gstinUpper || null,
        email: cleanEmail,
        phone: phone.trim(),
        state: state.trim(),
        status,
        assigned_to: assignedTo || null,
        address: address.trim(),
        notes: notes.trim(),
      };

      if (editingClient) {
        const { error } = await supabase.from("clients").update(payload).eq("id", editingClient.id);
        if (error) throw error;
        logAuditEvent("UPDATE_CLIENT", "CLIENTS", editingClient.id, payload);
        showToast("success", `${cleanName} updated.`);
      } else {
        const { data, error } = await supabase.from("clients").insert([payload]).select().single();
        if (error || !data) throw error || new Error("Could not create the client.");
        logAuditEvent("CREATE_CLIENT", "CLIENTS", data.id, payload);
        showToast("success", `${cleanName} added to the client master.`);
      }

      setIsModalOpen(false);
      setEditingClient(null);
      resetForm();
      fetchClients(false);
    } catch (err: any) {
      setFormError(err?.message || "Could not save the client.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingClient) return;
    setActionBusy(true);
    const { error } = await supabase.from("clients").delete().eq("id", editingClient.id);
    setActionBusy(false);
    setConfirm(null);

    if (error) {
      showToast("error", error.message || "Could not delete this client.");
      return;
    }
    logAuditEvent("DELETE_CLIENT", "CLIENTS", editingClient.id, { name: editingClient.name });
    showToast("success", `${editingClient.name} deleted.`);
    setIsModalOpen(false);
    setEditingClient(null);
    fetchClients(false);
  }

  async function markInactive() {
    if (!editingClient) return;
    setActionBusy(true);
    const { error } = await supabase.from("clients").update({ status: "Inactive" }).eq("id", editingClient.id);
    setActionBusy(false);
    setConfirm(null);
    if (error) return showToast("error", error.message);
    logAuditEvent("DEACTIVATE_CLIENT", "CLIENTS", editingClient.id, { name: editingClient.name });
    showToast("success", `${editingClient.name} marked Inactive.`);
    setIsModalOpen(false);
    setEditingClient(null);
    fetchClients(false);
  }

  /* ---------------- CSV: template, export, import ---------------- */

  function downloadCSVTemplate() {
    const headers = ["Name", "Organization Name", "Type", "PAN", "GSTIN", "Email", "Phone", "State", "Address", "Status", "Notes"];
    const sample = [
      "Rahul Sharma",
      "Sharma Logistics Pvt Ltd",
      "Private Limited",
      "ABCDE1234F",
      "07ABCDE1234F1Z5",
      "rahul@sharmalogistics.com",
      "9876543210",
      "Delhi",
      "Plot 4, Connaught Place, New Delhi",
      "Active",
      "Imported from legacy system",
    ];
    downloadFile([headers.map(csvCell).join(","), sample.map(csvCell).join(",")].join("\r\n"), "finetax_client_import_template.csv");
  }

  function exportClients() {
    const headers = ["Name", "Organization Name", "Type", "PAN", "GSTIN", "Email", "Phone", "State", "Address", "Status", "Relationship Manager", "Outstanding", "Notes"];
    const lines = filteredClients.map((c) =>
      [
        c.name,
        c.organization_name,
        c.type,
        c.pan,
        c.gstin,
        c.email,
        c.phone,
        c.state,
        c.address,
        statusOf(c),
        teamName(c.assigned_to),
        (outstandingByClient[c.id] || 0).toFixed(2),
        c.notes,
      ]
        .map(csvCell)
        .join(",")
    );
    downloadFile([headers.map(csvCell).join(","), ...lines].join("\r\n"), `finetax_clients_${new Date().toISOString().slice(0, 10)}.csv`);
    logAuditEvent("EXPORT_CLIENTS", "CLIENTS", undefined, { count: filteredClients.length });
  }

  function openImport() {
    setImportCount(null);
    setCsvFile(null);
    setImportRows(null);
    setImportError("");
    setIsImportModalOpen(true);
  }

  async function handleFileSelect(file: File | null) {
    setCsvFile(file);
    setImportRows(null);
    setImportError("");
    if (!file) return;

    if (file.size > MAX_IMPORT_BYTES) {
      setImportError("The file is larger than 2 MB. Please split it into smaller files.");
      return;
    }

    try {
      const rows = parseCSV(await file.text());
      if (rows.length < 2) throw new Error("The file is empty or has no data rows below the header.");
      if (rows.length - 1 > MAX_IMPORT_ROWS) throw new Error(`Please import at most ${MAX_IMPORT_ROWS} clients at a time.`);

      const headerKeys = rows[0].map((h) => HEADER_MAP[h.toLowerCase().replace(/[^a-z]/g, "")] || "");
      if (!headerKeys.includes("name")) throw new Error('A "Name" column is required. Please use the template headers.');

      const existingPan = new Set(clients.map((c) => (c.pan || "").toUpperCase()).filter(Boolean));
      const existingGstin = new Set(clients.map((c) => (c.gstin || "").toUpperCase()).filter(Boolean));
      const seenGstin = new Set<string>();

      const parsed: ImportRow[] = rows.slice(1).map((cells, idx) => {
        const data: Record<string, string> = {};
        headerKeys.forEach((key, i) => {
          if (key) data[key] = (cells[i] || "").trim();
        });
        data.pan = (data.pan || "").toUpperCase().replace(/\s/g, "");
        data.gstin = (data.gstin || "").toUpperCase().replace(/\s/g, "");
        data.email = (data.email || "").toLowerCase();

        const errors: string[] = [];
        const warnings: string[] = [];

        if (!data.name) errors.push("Name is missing");
        if (data.pan && !PAN_RE.test(data.pan)) errors.push("Invalid PAN");
        if (data.gstin && !GSTIN_RE.test(data.gstin)) errors.push("Invalid GSTIN");
        if (data.pan && data.gstin && PAN_RE.test(data.pan) && GSTIN_RE.test(data.gstin) && data.gstin.slice(2, 12) !== data.pan) {
          errors.push("GSTIN does not match PAN");
        }
        if (data.email && !EMAIL_RE.test(data.email)) errors.push("Invalid email");
        if (data.gstin && existingGstin.has(data.gstin)) errors.push("GSTIN already exists");
        if (data.gstin && seenGstin.has(data.gstin)) errors.push("Duplicate GSTIN in file");
        if (data.gstin) seenGstin.add(data.gstin);
        if (data.pan && existingPan.has(data.pan)) warnings.push("PAN already used by another client");

        // Fill state from GSTIN and PAN from GSTIN when missing
        if (data.gstin && GSTIN_RE.test(data.gstin)) {
          if (!data.state) data.state = GST_STATE_CODES[data.gstin.slice(0, 2)] || "";
          if (!data.pan) data.pan = data.gstin.slice(2, 12);
        }
        if (data.type && !CLIENT_TYPES.includes(data.type)) {
          const match = CLIENT_TYPES.find((t) => t.toLowerCase() === data.type.toLowerCase());
          data.type = match || (data.type.toLowerCase() === "company" ? "Private Limited" : "Other");
        }
        if (data.status && !["Active", "Inactive"].includes(data.status)) {
          data.status = data.status.toLowerCase() === "inactive" ? "Inactive" : "Active";
        }

        return { line: idx + 2, data, errors, warnings };
      });

      setImportRows(parsed);
    } catch (err: any) {
      setImportError(err?.message || "Could not read this file.");
    }
  }

  async function handleCSVImport() {
    if (!importRows) return;
    const valid = importRows.filter((r) => r.errors.length === 0);
    if (!valid.length) return setImportError("There are no valid rows to import.");

    setImporting(true);
    setImportError("");

    try {
      const records = valid.map((r) => ({
        name: r.data.name,
        organization_name: r.data.organization_name || "",
        type: r.data.type || "Individual",
        pan: r.data.pan || null,
        gstin: r.data.gstin || null,
        email: r.data.email || "",
        phone: r.data.phone || "",
        state: r.data.state || "",
        address: r.data.address || "",
        status: r.data.status || "Active",
        notes: r.data.notes || "",
      }));

      let inserted = 0;
      for (let i = 0; i < records.length; i += 200) {
        const chunk = records.slice(i, i + 200);
        const { error } = await supabase.from("clients").insert(chunk);
        if (error) throw new Error(`Stopped after ${inserted} clients: ${error.message}`);
        inserted += chunk.length;
      }

      logAuditEvent("BULK_IMPORT_CLIENTS", "CLIENTS", undefined, {
        count: inserted,
        skipped: importRows.length - valid.length,
        file: csvFile?.name,
      });
      setImportCount(inserted);
      fetchClients(false);
    } catch (err: any) {
      setImportError(err?.message || "Import failed.");
      fetchClients(false);
    } finally {
      setImporting(false);
    }
  }

  /* ---------------- Snapshot figures ---------------- */

  const snap = useMemo(() => {
    if (!snapshot) return null;
    const issued = snapshot.invoices.filter((i) => !["Draft", "Cancelled"].includes(i.status || "Draft"));
    const billed = issued.reduce((s, i) => s + Number(i.total || 0), 0);
    const received = issued.reduce((s, i) => s + Number(i.amount_paid || 0), 0);
    const openTasks = snapshot.tasks.filter((t) => t.stage !== "Approved");
    const openQuotes = snapshot.quotations.filter((q) => ["Draft", "Sent"].includes(q.status || "Draft"));
    return {
      billed,
      received,
      outstanding: Math.max(0, billed - received),
      openTasks,
      openQuotes,
      recentInvoices: snapshot.invoices.slice(0, 5),
    };
  }, [snapshot]);

  const validImportCount = importRows ? importRows.filter((r) => r.errors.length === 0).length : 0;
  const hasLinkedRecords = !!snapshot && (snapshot.invoices.length > 0 || snapshot.tasks.length > 0 || snapshot.quotations.length > 0);

  /* ---------------- Render ---------------- */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm lg:flex-row lg:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-text-main">
            <Building2 className="h-5 w-5 text-navy" /> Client Master
          </h2>
          <p className="mt-1 text-xs text-text-muted">Verified PAN and GSTIN records, relationship managers and receivables for every client.</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 lg:w-auto">
          <button
            type="button"
            onClick={exportClients}
            disabled={filteredClients.length === 0}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt disabled:opacity-50 lg:flex-none"
          >
            <Download className="h-4 w-4 text-navy" /> Export
          </button>
          <button
            type="button"
            onClick={openImport}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold transition hover:bg-surface-alt lg:flex-none"
          >
            <Upload className="h-4 w-4 text-navy" /> Bulk Import (CSV)
          </button>
          <button
            type="button"
            onClick={() => openModal()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-navy-light lg:flex-none"
          >
            <Plus className="h-4 w-4" /> Add Client
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          { label: "Total Clients", value: String(stats.total), sub: "In the client master", icon: Users, style: "bg-navy/10 text-navy", valueClass: "text-navy" },
          { label: "Active Clients", value: String(stats.active), sub: `${stats.total - stats.active} inactive`, icon: UserCheck, style: "bg-emerald-50 text-emerald-600", valueClass: "text-emerald-700" },
          { label: "GST Registered", value: String(stats.gstRegistered), sub: "Clients with a GSTIN", icon: BadgeCheck, style: "bg-violet-50 text-violet-600", valueClass: "text-violet-700" },
          { label: "Receivables", value: compactINR(stats.outstandingTotal), sub: `${stats.withDues} clients with dues`, icon: Wallet, style: "bg-amber-50 text-amber-600", valueClass: "text-amber-700" },
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
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">
          <div className="relative w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search name, organisation, PAN, GSTIN, email, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-lg border border-border bg-surface-alt p-0.5 text-xs font-semibold">
              {(["Active", "Inactive", "All"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-md px-3 py-1.5 transition ${statusFilter === s ? "bg-surface text-navy shadow-sm" : "text-text-muted hover:text-text-main"}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
              <option value="">All types</option>
              {CLIENT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select value={rmFilter} onChange={(e) => setRmFilter(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-sm outline-none focus:border-navy">
              <option value="">All managers</option>
              <option value="unassigned">Unassigned</option>
              {team
                .filter((t) => t.is_active !== false)
                .map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
            </select>
          </div>
          <span className="text-[11px] text-text-muted lg:ml-auto">
            Showing {filteredClients.length} of {clients.length}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading client directory...
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <Building2 className="h-6 w-6 text-text-muted" />
            <p className="text-xs text-text-muted">
              {clients.length === 0 ? 'No clients yet. Click "Add Client" or "Bulk Import" to get started.' : "No clients match these filters."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Type</th>
                  <th>PAN</th>
                  <th>GSTIN</th>
                  <th>Contact</th>
                  <th>Manager</th>
                  <th className="text-right">Outstanding</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((c) => {
                  const due = outstandingByClient[c.id] || 0;
                  const rm = teamName(c.assigned_to);
                  return (
                    <tr key={c.id} className="cursor-pointer transition hover:bg-surface-alt" onClick={() => openModal(c)}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy/10 text-[10px] font-bold text-navy">
                            {getInitials(c.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-text-main">{c.name}</p>
                            {c.organization_name && <p className="truncate text-[10px] text-text-muted">{c.organization_name}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap">{c.type || "Individual"}</td>
                      <td className="whitespace-nowrap font-mono">{c.pan || "—"}</td>
                      <td>
                        {c.gstin ? (
                          <>
                            <p className="whitespace-nowrap font-mono">{c.gstin}</p>
                            {c.state && <p className="text-[10px] text-text-muted">{c.state}</p>}
                          </>
                        ) : (
                          <span className="text-text-muted">Unregistered</span>
                        )}
                      </td>
                      <td>
                        {c.phone && <p className="whitespace-nowrap">{c.phone}</p>}
                        {c.email && <p className="max-w-[180px] truncate text-[10px] text-text-muted">{c.email}</p>}
                        {!c.phone && !c.email && <span className="text-text-muted">—</span>}
                      </td>
                      <td className="whitespace-nowrap">{rm || <span className="text-text-muted">—</span>}</td>
                      <td className={`whitespace-nowrap text-right font-semibold ${due > 0 ? "text-amber-700" : "text-text-muted"}`}>
                        {due > 0 ? formatINR(due) : "—"}
                      </td>
                      <td>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            statusOf(c) === "Active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-surface-alt text-text-muted"
                          }`}
                        >
                          {statusOf(c)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ================= CSV Import ================= */}
      {isImportModalOpen && (
        <Modal
          title="Client Database Import"
          subtitle="Columns are matched by header name, so their order does not matter."
          onClose={() => !importing && setIsImportModalOpen(false)}
          maxWidth="max-w-3xl"
          footer={
            importCount === null ? (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[11px] text-text-muted">
                  {importRows ? `${validImportCount} of ${importRows.length} rows ready to import` : "Choose a file to preview it"}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsImportModalOpen(false)}
                    disabled={importing}
                    className="rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCSVImport}
                    disabled={importing || validImportCount === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-50"
                  >
                    {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {importing ? "Importing..." : `Import ${validImportCount} Clients`}
                  </button>
                </div>
              </div>
            ) : undefined
          }
        >
          {importCount !== null ? (
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
              <p className="text-base font-bold text-emerald-800">Import Successful</p>
              <p className="text-sm text-emerald-700">{importCount} clients have been added to your master database.</p>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="mt-2 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700"
              >
                Continue
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1 rounded-lg border border-border bg-surface-alt p-3 text-xs text-text-muted">
                <p>1. Download the template. Only the <span className="font-semibold text-text-main">Name</span> column is required.</p>
                <p>2. Fill in your client data. Commas inside addresses are fine.</p>
                <p>3. Choose the file to preview it. Rows with errors are skipped, and nothing is saved until you click Import.</p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={downloadCSVTemplate}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-navy transition hover:bg-surface-alt"
                >
                  <Download className="h-4 w-4" /> Download Template
                </button>
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-navy/40 px-3 py-2 text-xs font-semibold text-navy transition hover:bg-navy/5">
                  <FileSpreadsheet className="h-4 w-4" />
                  <span className="truncate">{csvFile ? csvFile.name : "Choose CSV file..."}</span>
                  <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => handleFileSelect(e.target.files?.[0] || null)} />
                </label>
              </div>

              {importError && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs font-medium text-danger">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              {importRows && (
                <div className="max-h-80 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Name</th>
                        <th>PAN</th>
                        <th>GSTIN</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 200).map((r) => (
                        <tr key={r.line} className={r.errors.length ? "bg-rose-50/50" : ""}>
                          <td className="text-text-muted">{r.line}</td>
                          <td className="font-medium">{r.data.name || "—"}</td>
                          <td className="font-mono">{r.data.pan || "—"}</td>
                          <td className="font-mono">{r.data.gstin || "—"}</td>
                          <td>
                            {r.errors.length ? (
                              <span className="font-semibold text-rose-600">Skip: {r.errors.join(", ")}</span>
                            ) : r.warnings.length ? (
                              <span className="font-semibold text-amber-700">OK · {r.warnings.join(", ")}</span>
                            ) : (
                              <span className="font-semibold text-emerald-700">Ready</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importRows.length > 200 && (
                    <p className="border-t border-border p-2 text-center text-[11px] text-text-muted">
                      Showing the first 200 of {importRows.length} rows.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* ================= Add / Edit Client ================= */}
      {isModalOpen && (
        <Modal
          title={editingClient ? editingClient.name : "Add Client"}
          subtitle={
            editingClient
              ? [editingClient.organization_name, editingClient.lead_source ? `Source: ${editingClient.lead_source}` : ""].filter(Boolean).join(" · ") || "Client record"
              : "PAN and GSTIN are validated automatically."
          }
          onClose={closeModal}
          maxWidth={editingClient ? "max-w-5xl" : "max-w-2xl"}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {editingClient && statusOf(editingClient) === "Active" && (
                  <button
                    type="button"
                    onClick={() => setConfirm("inactive")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-muted transition hover:bg-surface-alt"
                  >
                    <UserX className="h-3.5 w-3.5" /> Mark Inactive
                  </button>
                )}
                {editingClient && isAdmin && !hasLinkedRecords && !loadingSnapshot && (
                  <button
                    type="button"
                    onClick={() => setConfirm("delete")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                )}
              </div>
              <div className="flex gap-2 sm:ml-auto">
                <button type="button" onClick={closeModal} className="flex-1 rounded-lg border border-border px-4 py-2 text-xs font-semibold transition hover:bg-surface-alt sm:flex-none">
                  Cancel
                </button>
                <button
                  type="submit"
                  form="client-form"
                  disabled={saving}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-navy-light disabled:opacity-60 sm:flex-none"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {panDupConfirmed && panWarning ? "Save Anyway" : "Save Client"}
                </button>
              </div>
            </div>
          }
        >
          <div className={`grid grid-cols-1 gap-6 ${editingClient ? "lg:grid-cols-5" : ""}`}>
            {/* Form */}
            <form id="client-form" onSubmit={handleSubmit} className={`space-y-4 ${editingClient ? "lg:col-span-3" : ""}`}>
              {formError && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs font-medium text-danger">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}
              {panWarning && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{panWarning}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Client Name *</label>
                  <input required type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Organisation Name</label>
                  <input type="text" placeholder="e.g. Moonvita Foods Pvt Ltd" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Type</label>
                  <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
                    {(CLIENT_TYPES.includes(type) ? CLIENT_TYPES : [type, ...CLIENT_TYPES]).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>

                <div>
                  <label className={labelClass}>PAN</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="ABCDE1234F"
                      maxLength={10}
                      value={pan}
                      onChange={(e) => {
                        setPan(e.target.value.toUpperCase().replace(/\s/g, ""));
                        setPanWarning("");
                        setPanDupConfirmed(false);
                      }}
                      className={`${inputClass} pr-8 font-mono uppercase ${!panValid ? "border-rose-300 focus:border-rose-400 focus:ring-rose-200" : ""}`}
                    />
                    {panUpper && panValid && <CheckCircle2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />}
                  </div>
                  {!panValid && <p className="mt-1 text-[10px] font-medium text-rose-600">Format: 5 letters, 4 digits, 1 letter</p>}
                </div>

                <div>
                  <label className={labelClass}>GSTIN</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="07ABCDE1234F1Z5"
                      maxLength={15}
                      value={gstin}
                      onChange={(e) => handleGstinChange(e.target.value)}
                      className={`${inputClass} pr-8 font-mono uppercase ${!gstinValid || gstPanMismatch ? "border-rose-300 focus:border-rose-400 focus:ring-rose-200" : ""}`}
                    />
                    {gstinUpper && gstinValid && !gstPanMismatch && (
                      <CheckCircle2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />
                    )}
                  </div>
                  {!gstinValid && <p className="mt-1 text-[10px] font-medium text-rose-600">15 characters, e.g. 07ABCDE1234F1Z5</p>}
                  {gstPanMismatch && <p className="mt-1 text-[10px] font-medium text-rose-600">This GSTIN belongs to a different PAN</p>}
                  {gstinUpper && gstinValid && !gstPanMismatch && (
                    <p className="mt-1 text-[10px] text-text-muted">State auto-filled from GSTIN</p>
                  )}
                </div>

                <div>
                  <label className={labelClass}>Email</label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputClass} pl-9`} />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Mobile</label>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${inputClass} pl-9`} />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>State</label>
                  <input type="text" list="state-list" placeholder="e.g. Delhi" value={state} onChange={(e) => setState(e.target.value)} className={inputClass} />
                  <datalist id="state-list">
                    {STATE_NAMES.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className={labelClass}>Relationship Manager</label>
                  <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={inputClass}>
                    <option value="">— Unassigned —</option>
                    {team
                      .filter((t) => t.is_active !== false || String(t.id) === String(assignedTo))
                      .map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass}>Address</label>
                <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Notes</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
              </div>
            </form>

            {/* Client snapshot */}
            {editingClient && (
              <div className="space-y-4 lg:col-span-2 lg:border-l lg:border-border lg:pl-6">
                <h4 className="text-xs font-bold text-text-main">Client Snapshot</h4>
                {loadingSnapshot || !snap ? (
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading activity...
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-surface-alt p-2.5">
                        <p className="text-[10px] font-semibold uppercase text-text-muted">Billed</p>
                        <p className="text-sm font-bold text-navy">{compactINR(snap.billed)}</p>
                      </div>
                      <div className="rounded-lg bg-emerald-50 p-2.5">
                        <p className="text-[10px] font-semibold uppercase text-emerald-700">Received</p>
                        <p className="text-sm font-bold text-emerald-700">{compactINR(snap.received)}</p>
                      </div>
                      <div className={`rounded-lg p-2.5 ${snap.outstanding > 0 ? "bg-amber-50" : "bg-surface-alt"}`}>
                        <p className="text-[10px] font-semibold uppercase text-amber-700">Due</p>
                        <p className={`text-sm font-bold ${snap.outstanding > 0 ? "text-amber-700" : "text-text-muted"}`}>{compactINR(snap.outstanding)}</p>
                      </div>
                    </div>

                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="flex items-center gap-1 text-[11px] font-semibold text-text-main">
                          <Receipt className="h-3.5 w-3.5 text-navy" /> Recent Invoices
                        </p>
                        <Link href="/invoices" className="text-[11px] font-semibold text-navy hover:underline">View all</Link>
                      </div>
                      {snap.recentInvoices.length === 0 ? (
                        <p className="text-[11px] italic text-text-muted">No invoices yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {snap.recentInvoices.map((inv) => (
                            <div key={inv.id} className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-[11px]">
                              <div>
                                <p className="font-mono font-semibold text-navy">{inv.invoice_number}</p>
                                <p className="text-text-muted">{formatDate(inv.date)} · {inv.status}</p>
                              </div>
                              <p className="font-semibold">{formatINR(Number(inv.total || 0))}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <p className="flex items-center gap-1 text-[11px] font-semibold text-text-main">
                          <CheckSquare className="h-3.5 w-3.5 text-navy" /> Open Tasks ({snap.openTasks.length})
                        </p>
                        <Link href="/tasks" className="text-[11px] font-semibold text-navy hover:underline">Task board</Link>
                      </div>
                      {snap.openTasks.length === 0 ? (
                        <p className="text-[11px] italic text-text-muted">No open tasks.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {snap.openTasks.slice(0, 5).map((t) => (
                            <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[11px]">
                              <p className="truncate font-medium">{t.title}</p>
                              <p className="shrink-0 text-text-muted">{t.due_date ? formatDate(t.due_date) : "—"}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {snap.openQuotes.length > 0 && (
                      <p className="rounded-lg bg-blue-50 px-2.5 py-2 text-[11px] font-medium text-blue-700">
                        {snap.openQuotes.length} open quotation{snap.openQuotes.length === 1 ? "" : "s"} awaiting a decision.
                      </p>
                    )}

                    {hasLinkedRecords && (
                      <p className="text-[10px] text-text-muted">
                        This client has linked records, so it can't be deleted. Mark it Inactive instead.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Confirmations */}
      {confirm === "delete" && editingClient && (
        <ConfirmDialog
          title="Delete this client?"
          message={`"${editingClient.name}" will be permanently removed. This is only possible because the client has no invoices, tasks or quotations.`}
          confirmLabel="Delete client"
          tone="danger"
          loading={actionBusy}
          onConfirm={handleDelete}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "inactive" && editingClient && (
        <ConfirmDialog
          title="Mark this client inactive?"
          message={`"${editingClient.name}" will be hidden from the Active list. All history stays intact and you can reactivate them anytime.`}
          confirmLabel="Mark inactive"
          tone="primary"
          loading={actionBusy}
          onConfirm={markInactive}
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