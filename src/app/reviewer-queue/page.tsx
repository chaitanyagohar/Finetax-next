"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Clock3, AlertTriangle, BarChart3, ShieldCheck, CheckCircle2, ArrowRight, X, Search, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAuditEvent } from "@/lib/audit";

export default function ReviewerQueuePage() {
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") || "pending";

  const [tasks, setTasks] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Inspection Drawer State
  const [inspectTask, setInspectTask] = useState<any | null>(null);
  const [reviewComments, setReviewComments] = useState("");

  const supabase = createClient();

  useEffect(() => {
    loadReviewData();
  }, [activeTab]);

  async function loadReviewData() {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    setCurrentUser(profile || null);

    // FIX: Strictly fetch tasks where THIS user is the designated reviewer_id, regardless of admin status.
    const { data, error } = await supabase
      .from("tasks")
      .select("*, clients(name, email), assignee:profiles!tasks_assigned_to_fkey(name, email)")
      .eq("reviewer_id", user.id)
      .order("due_date", { ascending: true });

    if (error) {
      console.error("Error fetching reviewer tasks:", error);
    } else if (data) {
      setTasks(data);
    }

    setLoading(false);
  }

  async function handleDecision(newStage: "Approved" | "Changes Required") {
    if (!inspectTask) return;

    if (newStage === "Changes Required" && !reviewComments.trim()) {
      alert("Please provide feedback notes explaining required changes.");
      return;
    }

    const { error } = await supabase
      .from("tasks")
      .update({
        stage: newStage,
        review_comments: reviewComments.trim()
      })
      .eq("id", inspectTask.id);

    if (error) return alert("Error processing decision: " + error.message);

    logAuditEvent("REVIEW_DECISION", "TASKS", inspectTask.id, { decision: newStage, comments: reviewComments.trim() });

    let emailsAttempted = 0;
    let emailsSent = 0;

    // 1. Always notify Execution Staff of the decision
    if (inspectTask.assignee?.email) {
      emailsAttempted++;
      const formData = new FormData();
      formData.append("to", inspectTask.assignee.email);
      formData.append("subject", `[Task Review Update] ${inspectTask.title} -> ${newStage}`);
      formData.append(
        "body",
        `Hello ${inspectTask.assignee.name},\n\nYour submitted task "${inspectTask.title}" has been updated to "${newStage}" by ${currentUser?.name || 'your Reviewer'}.\n\nFeedback: ${reviewComments || "No additional comments."}\n\nPlease log into the Practice Manager portal to view details.`
      );

      try {
        const res = await fetch("/api/send-email", { method: "POST", body: formData });
        if (res.ok) emailsSent++;
      } catch (err) {
        console.error("Failed to email staff:", err);
      }
    }

    // 2. Notify Client if the task is Approved
    if (newStage === "Approved" && inspectTask.clients?.email) {
      emailsAttempted++;
      const clientForm = new FormData();
      clientForm.append("to", inspectTask.clients.email);
      clientForm.append("subject", `Task Completed: ${inspectTask.title}`);
      clientForm.append(
        "body",
        `Dear ${inspectTask.clients.name},\n\nWe are pleased to inform you that your task "${inspectTask.title}" has been completed and verified by our team.\n\nBest regards,\nPractice Team`
      );

      try {
        const res = await fetch("/api/send-email", { method: "POST", body: clientForm });
        if (res.ok) emailsSent++;
      } catch (err) {
        console.error("Failed to email client:", err);
      }
    }

    alert(`Task status updated to ${newStage}! ${emailsSent}/${emailsAttempted} notification emails dispatched.`);
    setInspectTask(null);
    setReviewComments("");
    loadReviewData();
  }

  const filteredTasks = tasks.filter((t) =>
    [t.title, t.clients?.name, t.assignee?.name]
      .filter(Boolean)
      .some((f) => f.toLowerCase().includes(search.toLowerCase()))
  );

  const pendingTasks = filteredTasks.filter((t) => t.stage === "Submitted for Review");
  const revisionTasks = filteredTasks.filter((t) => t.stage === "Changes Required");
  const approvedTasks = filteredTasks.filter((t) => t.stage === "Approved");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-surface p-5 rounded-lg border border-border shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-text-main">Reviewer Verification Hub</h2>
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 font-bold rounded text-[10px] uppercase">
              My Queue
            </span>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Verify submitted staff work, request revision edits, and track your practice quality metrics.
          </p>
        </div>

        <div className="relative w-full sm:w-60">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search queue items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-border rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-navy"
          />
        </div>
      </div>

      {/* Sub-Tab 1: Pending Approvals */}
      {activeTab === "pending" && (
        <div className="space-y-4">
          <h3 className="font-bold text-sm text-navy flex items-center gap-2 border-b border-border pb-2">
            <Clock3 className="h-4 w-4 text-amber-500" /> Awaiting Verification ({pendingTasks.length})
          </h3>

          {loading ? (
            <div className="p-8 text-center text-text-muted text-xs">Loading queue...</div>
          ) : pendingTasks.length === 0 ? (
            <div className="p-8 text-center text-text-muted text-xs bg-surface rounded-lg border border-border">
              No tasks currently pending review in your queue!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pendingTasks.map((t) => (
                <div key={t.id} className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-bold uppercase bg-navy/10 text-navy px-1.5 py-0.5 rounded">
                        {t.category}
                      </span>
                      <h4 className="font-bold text-sm text-navy mt-1">{t.title}</h4>
                    </div>
                    <span className="text-xs font-semibold text-rose-600">Due: {t.due_date}</span>
                  </div>

                  <div className="text-xs space-y-1 text-text-muted bg-background p-2.5 rounded border border-border">
                    <p><strong className="text-text-main">Client:</strong> {t.clients?.name || "Internal"}</p>
                    <p><strong className="text-text-main">Executed By:</strong> {t.assignee?.name || "Staff"}</p>
                    {t.notes && <p><strong className="text-text-main">Staff Execution Notes:</strong> {t.notes}</p>}
                  </div>

                  <button
                    onClick={() => {
                      setInspectTask(t);
                      setReviewComments(t.review_comments || "");
                    }}
                    className="w-full py-2 bg-navy text-white rounded font-bold text-xs hover:bg-navy/90 flex items-center justify-center gap-1.5"
                  >
                    <ShieldCheck className="h-4 w-4" /> Inspect & Sign-Off
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sub-Tab 2: Revision Requests */}
      {activeTab === "revisions" && (
        <div className="space-y-4">
          <h3 className="font-bold text-sm text-navy flex items-center gap-2 border-b border-border pb-2">
            <AlertTriangle className="h-4 w-4 text-rose-500" /> Sent for Revision ({revisionTasks.length})
          </h3>

          {loading ? (
            <div className="p-8 text-center text-text-muted text-xs">Loading revisions...</div>
          ) : revisionTasks.length === 0 ? (
            <div className="p-8 text-center text-text-muted text-xs bg-surface rounded-lg border border-border">
              No active revision requests.
            </div>
          ) : (
            <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-text-muted bg-background/50">
                    <th className="p-3">Due Date</th>
                    <th className="p-3">Task Title</th>
                    <th className="p-3">Client</th>
                    <th className="p-3">Executed By</th>
                    <th className="p-3">Required Changes Feedback</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {revisionTasks.map((t) => (
                    <tr key={t.id} className="hover:bg-background/50 transition">
                      <td className="p-3 font-semibold text-rose-600">{t.due_date}</td>
                      <td className="p-3 font-bold text-navy">{t.title}</td>
                      <td className="p-3">{t.clients?.name || "Internal"}</td>
                      <td className="p-3">{t.assignee?.name || "Staff"}</td>
                      <td className="p-3 text-rose-700 italic">{t.review_comments || "No comment specified"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Sub-Tab 3: Quality Analytics */}
      {activeTab === "analytics" && (
        <div className="space-y-4">
          <h3 className="font-bold text-sm text-navy flex items-center gap-2 border-b border-border pb-2">
            <BarChart3 className="h-4 w-4 text-emerald-600" /> My Verification Metrics
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-1">
              <span className="text-xs font-semibold text-text-muted uppercase">Pending Verification</span>
              <div className="text-2xl font-bold text-amber-600">{pendingTasks.length}</div>
            </div>

            <div className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-1">
              <span className="text-xs font-semibold text-text-muted uppercase">Revision Cycle Rate</span>
              <div className="text-2xl font-bold text-rose-600">
                {tasks.length > 0 ? ((revisionTasks.length / tasks.length) * 100).toFixed(0) : 0}%
              </div>
            </div>

            <div className="bg-surface p-4 rounded-lg border border-border shadow-sm space-y-1">
              <span className="text-xs font-semibold text-text-muted uppercase">Approved & Verified</span>
              <div className="text-2xl font-bold text-emerald-600">{approvedTasks.length}</div>
            </div>
          </div>
        </div>
      )}

      {/* Inspection Modal */}
      {inspectTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md p-5 space-y-4 shadow-xl text-xs">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-sm text-navy">Inspect Task: {inspectTask.title}</h3>
              <button onClick={() => setInspectTask(null)} className="text-text-muted hover:text-text-main">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="bg-background p-3 rounded border border-border space-y-1">
                <p><strong className="text-text-main">Client:</strong> {inspectTask.clients?.name || "Internal"}</p>
                <p><strong className="text-text-main">Executed By:</strong> {inspectTask.assignee?.name || "Staff"}</p>
                <p><strong className="text-text-main">Due Date:</strong> {inspectTask.due_date}</p>
                {inspectTask.notes && <p><strong className="text-text-main">Staff Execution Notes:</strong> {inspectTask.notes}</p>}
              </div>

              <div>
                <label className="block font-semibold text-text-muted mb-1">REVIEW FEEDBACK / CORRECTION NOTES</label>
                <textarea
                  rows={3}
                  value={reviewComments}
                  onChange={(e) => setReviewComments(e.target.value)}
                  className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy"
                  placeholder="Specify required corrections..."
                />
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
                <button
                  onClick={() => handleDecision("Changes Required")}
                  className="py-2 bg-rose-600 text-white rounded font-bold hover:bg-rose-700 transition"
                >
                  Request Changes
                </button>
                <button
                  onClick={() => handleDecision("Approved")}
                  className="py-2 bg-emerald-600 text-white rounded font-bold hover:bg-emerald-700 transition"
                >
                  Approve & Sign-Off
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}