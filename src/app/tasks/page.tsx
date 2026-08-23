"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Trash2, X, CheckCircle2, AlertCircle, RefreshCw, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Task, Client, Profile, TaskStage, TaskCategory } from "@/types/database";
import { logAuditEvent } from "@/lib/audit";

const CATEGORIES: TaskCategory[] = ['GST', 'Income Tax', 'Audit', 'ROC', 'Other'];
const STAGES: TaskStage[] = ['Assigned', 'In Progress', 'Submitted for Review', 'Changes Required', 'Approved'];
const RECURRENCE_OPTIONS = ['None', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'];

export default function TasksPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [team, setTeam] = useState<Profile[]>([]);
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [filterStage, setFilterStage] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterRecurring, setFilterRecurring] = useState("");

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);

  // Form State
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [category, setCategory] = useState<TaskCategory>("Other");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [stage, setStage] = useState<TaskStage>("Assigned");
  const [recurrence, setRecurrence] = useState("None");
  const [notes, setNotes] = useState("");
  const [reviewComments, setReviewComments] = useState("");

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", user?.id || "").single();
    setCurrentUser(profile || null);

    const [{ data: cData }, { data: pData }] = await Promise.all([
      supabase.from("clients").select("*").order("name", { ascending: true }),
      supabase.from("profiles").select("*").order("name", { ascending: true })
    ]);

    if (cData) setClients(cData);
    if (pData) setTeam(pData);

    // Precise Role-Based Viewing Scopes
    let query = supabase.from("tasks").select("*, clients(id, name, email), profiles!tasks_assigned_to_fkey(id, name, email), reviewer:profiles!tasks_reviewer_id_fkey(id, name, email)");

    const isAdmin = profile?.role === "admin";
    const isReviewer = profile?.is_reviewer || profile?.role === "reviewer";

    if (!isAdmin) {
      if (isReviewer) {
        // Reviewer sees work assigned to them OR tasks explicitly submitted to them for review
        query = query.or(`assigned_to.eq.${profile.id},reviewer_id.eq.${profile.id}`);
      } else {
        // Standard Execution Staff ONLY sees tasks assigned directly to them
        query = query.eq("assigned_to", profile.id);
      }
    }

    const { data: tData } = await query.order("due_date", { ascending: true });
    
    if (tData) setTasks(tData);
    setLoading(false);
  }

  function calculateNextDueDate(currentDate: string, recOption: string) {
    const d = new Date(currentDate + "T00:00:00");
    if (recOption === 'Weekly') d.setDate(d.getDate() + 7);
    else if (recOption === 'Monthly') d.setMonth(d.getMonth() + 1);
    else if (recOption === 'Quarterly') d.setMonth(d.getMonth() + 3);
    else if (recOption === 'Yearly') d.setFullYear(d.getFullYear() + 1);
    else return null;
    return d.toISOString().slice(0, 10);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload = {
      title: title.trim(),
      client_id: clientId || null,
      category,
      due_date: dueDate,
      assigned_to: assignedTo || null,
      reviewer_id: reviewerId || null,
      priority,
      stage,
      recurrence,
      notes: notes.trim(),
      review_comments: reviewComments.trim(),
    };

    const isCompleting = stage === "Approved" && editingTask?.stage !== "Approved";
    const isNewAssignment = assignedTo && assignedTo !== editingTask?.assigned_to;
    const isStageChange = editingTask && stage !== editingTask.stage;

    let taskId = editingTask?.id;

    if (editingTask) {
      const { error } = await supabase.from("tasks").update(payload).eq("id", editingTask.id);
      if (!error) {
        logAuditEvent("UPDATE_TASK", "TASKS", editingTask.id, { stage });

        // Auto-Generate Next Recurrence
        if (isCompleting && recurrence !== "None") {
          const nextDate = calculateNextDueDate(dueDate, recurrence);
          if (nextDate) {
            const nextTaskPayload = { ...payload, due_date: nextDate, stage: "Assigned" as TaskStage, review_comments: "" };
            await supabase.from("tasks").insert([nextTaskPayload]);
            alert(`Next occurrence auto-created for ${nextDate}`);
          }
        }
      } else alert("Error updating task: " + error.message);
    } else {
      const { data, error } = await supabase.from("tasks").insert([payload]).select().single();
      if (!error) {
        taskId = data.id;
        logAuditEvent("CREATE_TASK", "TASKS", data.id, payload);
      } else alert("Error creating task: " + error.message);
    }

    // Dual Nodemailer Email Engine
    if (isNewAssignment || isStageChange) {
      const assignee = team.find((t) => String(t.id) === String(assignedTo));
      const selectedClient = clients.find((c) => String(c.id) === String(clientId));
      const reviewer = team.find((t) => String(t.id) === String(reviewerId));

      let emailsAttempted = 0;
      let emailsSent = 0;

      // 1. Notify Assigned Staff Member
      if (isNewAssignment && assignee?.email) {
        emailsAttempted++;
        try {
          const staffForm = new FormData();
          staffForm.append("to", assignee.email);
          staffForm.append("subject", `New Task Assigned: ${title}`);
          staffForm.append(
            "body",
            `Hello ${assignee.name},\n\nYou have been assigned a new task: "${title}".\n\nClient: ${selectedClient?.name || "N/A"}\nDue Date: ${dueDate}\nPriority: ${priority}\n\nPlease check your Practice Manager portal to review and execute.`
          );

          const res = await fetch("/api/send-email", { method: "POST", body: staffForm });
          if (res.ok) emailsSent++;
        } catch (err) {
          console.error("Staff Email Network Error:", err);
        }
      }

      // 2. Notify Reviewer when submitted for review
      if (stage === "Submitted for Review" && reviewer?.email) {
        emailsAttempted++;
        try {
          const revForm = new FormData();
          revForm.append("to", reviewer.email);
          revForm.append("subject", `Task Submitted for Review: ${title}`);
          revForm.append(
            "body",
            `Hello ${reviewer.name},\n\nThe task "${title}" has been submitted for your review by ${assignee?.name || 'Staff'}.\n\nClient: ${selectedClient?.name || 'N/A'}\nNotes: ${notes}\n\nPlease open your Reviewer Queue to verify.`
          );

          const res = await fetch("/api/send-email", { method: "POST", body: revForm });
          if (res.ok) emailsSent++;
        } catch (err) {
          console.error("Reviewer Email Network Error:", err);
        }
      }

      // 3. Notify Client when Completed / Approved
      if (stage === "Approved" && selectedClient?.email) {
        emailsAttempted++;
        try {
          const clientForm = new FormData();
          clientForm.append("to", selectedClient.email);
          clientForm.append("subject", `Task Completed: ${title}`);
          clientForm.append(
            "body",
            `Dear ${selectedClient.name},\n\nWe are pleased to inform you that your task "${title}" has been completed and verified by our team.\n\nBest regards,\nMy CA Practice Team`
          );

          const res = await fetch("/api/send-email", { method: "POST", body: clientForm });
          if (res.ok) emailsSent++;
        } catch (err) {
          console.error("Client Email Network Error:", err);
        }
      }

      if (emailsAttempted > 0) {
        alert(`Task saved! ${emailsSent}/${emailsAttempted} notification emails dispatched successfully.`);
      }
    }

    closeModal();
    loadData();
  }

  function openModal(task?: any) {
    if (task) {
      setEditingTask(task);
      setTitle(task.title);
      setClientId(task.client_id || "");
      setCategory(task.category);
      setDueDate(task.due_date);
      setAssignedTo(task.assigned_to || "");
      setReviewerId(task.reviewer_id || "");
      setPriority(task.priority || "Medium");
      setStage(task.stage);
      setRecurrence(task.recurrence || "None");
      setNotes(task.notes || "");
      setReviewComments(task.review_comments || "");
    } else {
      setEditingTask(null);
      resetForm();
    }
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingTask(null);
    resetForm();
  }

  function resetForm() {
    setTitle("");
    setClientId("");
    setCategory("Other");
    setDueDate("");
    setAssignedTo("");
    setReviewerId("");
    setPriority("Medium");
    setStage("Assigned");
    setRecurrence("None");
    setNotes("");
    setReviewComments("");
  }

  async function handleDelete() {
    if (!editingTask || !confirm("Delete this task?")) return;
    const { error } = await supabase.from("tasks").delete().eq("id", editingTask.id);
    if (!error) {
      logAuditEvent("DELETE_TASK", "TASKS", editingTask.id);
      closeModal();
      loadData();
    } else alert("Error deleting task: " + error.message);
  }

  const today = new Date().toISOString().slice(0, 10);

  const filteredTasks = tasks.filter((t: any) => {
    const matchesSearch = [t.title, t.notes, t.category].filter(Boolean).some((f) => f.toLowerCase().includes(search.toLowerCase()));
    const matchesStage = filterStage ? t.stage === filterStage : true;
    const matchesCategory = filterCategory ? t.category === filterCategory : true;
    const matchesClient = filterClient ? t.client_id === filterClient : true;
    const matchesRecurring = filterRecurring === "recurring" ? t.recurrence && t.recurrence !== "None" : filterRecurring === "onetime" ? !t.recurrence || t.recurrence === "None" : true;

    return matchesSearch && matchesStage && matchesCategory && matchesClient && matchesRecurring;
  });

  const canEditReviewerFeedback = currentUser?.role === "admin" || currentUser?.is_reviewer || currentUser?.role === "reviewer";

  return (
    <div className="space-y-6">
      {/* Filters Toolbar */}
      <div className="flex flex-col md:flex-row flex-wrap justify-between items-start md:items-center gap-3 bg-surface p-4 rounded-lg border border-border shadow-sm">
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="relative w-full sm:w-48">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <input type="text" placeholder="Search tasks..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-border rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
          </div>

          <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)} className="border border-border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy bg-surface">
            <option value="">All Workflow Stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="border border-border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy bg-surface">
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)} className="border border-border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy bg-surface">
            <option value="">All Clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          
          <select value={filterRecurring} onChange={(e) => setFilterRecurring(e.target.value)} className="border border-border rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy bg-surface">
            <option value="">One-time & Recurring</option>
            <option value="recurring">Recurring Only</option>
            <option value="onetime">One-time Only</option>
          </select>
        </div>

        <button onClick={() => openModal()} className="flex items-center gap-2 bg-navy text-white px-4 py-2 rounded-md font-medium text-xs hover:bg-navy/90 transition w-full md:w-auto justify-center">
          <Plus className="h-4 w-4" /> Add Task
        </button>
      </div>

      {/* Task Table */}
      <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-muted text-xs">Loading execution matrices...</div>
        ) : filteredTasks.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs">No tasks match these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-text-muted bg-background/50">
                  <th className="p-3">Due Date</th>
                  <th className="p-3">Task</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Client</th>
                  <th className="p-3">Execution</th>
                  <th className="p-3">Reviewer</th>
                  <th className="p-3">Stage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredTasks.map((t: any) => {
                  const isOverdue = t.due_date < today && t.stage !== "Approved";
                  return (
                    <tr key={t.id} className="hover:bg-background/50 transition cursor-pointer" onClick={() => openModal(t)}>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`font-medium ${isOverdue ? 'text-rose-600 font-bold flex items-center gap-1' : 'text-text-main'}`}>
                          {isOverdue && <AlertCircle className="h-3 w-3" />} {t.due_date}
                        </span>
                      </td>
                      <td className="p-3 font-semibold text-navy">
                        {t.title}
                        {t.recurrence && t.recurrence !== 'None' && <span className="ml-1 text-[10px] bg-navy/10 text-navy px-1.5 py-0.5 rounded">↻ {t.recurrence}</span>}
                      </td>
                      <td className="p-3">{t.category}</td>
                      <td className="p-3">{t.clients?.name || "-"}</td>
                      <td className="p-3">{t.profiles?.name || <span className="text-rose-500 font-semibold">Unassigned</span>}</td>
                      <td className="p-3">{t.reviewer?.name || "-"}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded font-medium ${t.stage === 'Approved' ? 'bg-emerald-100 text-emerald-700' : t.stage === 'Changes Required' ? 'bg-rose-100 text-rose-700' : t.stage === 'Submitted for Review' ? 'bg-blue-100 text-blue-700' : 'bg-navy/10 text-navy'}`}>
                          {t.stage}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Task Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-surface rounded-lg border border-border w-full max-w-2xl p-6 space-y-4 shadow-lg text-xs my-8">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-semibold text-base text-text-main">{editingTask ? "Edit Task" : "Add Task"}</h3>
              <button onClick={closeModal} className="text-text-muted hover:text-text-main"><X className="h-5 w-5" /></button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block font-semibold text-text-muted mb-1">TASK TITLE *</label>
                <input required type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">CLIENT</label>
                  <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                    <option value="">(Internal / No Client)</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                
                <div>
                  <label className="block font-semibold text-text-muted mb-1">CATEGORY</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value as TaskCategory)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">DUE DATE *</label>
                  <input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">WORKFLOW STAGE</label>
                  <select value={stage} onChange={(e) => setStage(e.target.value as TaskStage)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">ASSIGN EXECUTION TO</label>
                  <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                    <option value="">-- Unassigned --</option>
                    {team.map(t => <option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">ASSIGN REVIEWER</label>
                  <select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                    <option value="">-- No Reviewer --</option>
                    {team.filter(t => t.role === 'admin' || (t as any).is_reviewer || t.role === 'reviewer').map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">PRIORITY</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                    <option>Low</option><option>Medium</option><option>High</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">RECURRENCE</label>
                  <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                    {RECURRENCE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              {recurrence !== 'None' && (
                <div className="bg-navy/5 border border-navy/20 text-navy p-2 rounded flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" /> 
                  When this task is moved to "Approved", the next occurrence will be auto-generated.
                </div>
              )}

              <div>
                <label className="block font-semibold text-text-muted mb-1">EXECUTION NOTES</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
              </div>

              {/* Reviewer Feedback Section */}
              <div className="bg-background p-3 rounded-lg border border-border">
                <label className="block font-semibold text-navy mb-1">REVIEWER FEEDBACK / REQUIRED CHANGES</label>
                <textarea
                  rows={2}
                  value={reviewComments}
                  onChange={(e) => setReviewComments(e.target.value)}
                  disabled={!canEditReviewerFeedback}
                  className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-surface disabled:opacity-70"
                  placeholder="Reviewers: Specify required changes here before returning task to 'Changes Required'..."
                />
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-border">
                {editingTask ? (
                  <button type="button" onClick={handleDelete} className="px-3 py-1.5 bg-rose-600 text-white rounded font-semibold flex items-center gap-1 hover:bg-rose-700">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                ) : <div />}

                <div className="flex gap-2 ml-auto">
                  <button type="button" onClick={closeModal} className="px-4 py-1.5 border border-border rounded text-text-main hover:bg-background">Cancel</button>
                  <button type="submit" className="px-4 py-1.5 bg-navy text-white rounded font-medium hover:bg-navy/90">Save Task</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}