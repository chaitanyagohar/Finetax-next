"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Trash2, X, AlertCircle, RefreshCw, Clock, Activity, Lock } from "lucide-react";
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
  const [taskTimeline, setTaskTimeline] = useState<any[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  // Form State
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [category, setCategory] = useState<TaskCategory>("Other");
  const [dueDate, setDueDate] = useState("");
  const [officialDueDate, setOfficialDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [stage, setStage] = useState<TaskStage>("Assigned");
  const [recurrence, setRecurrence] = useState("None");
  const [notes, setNotes] = useState("");
  const [reviewComments, setReviewComments] = useState("");
  const [timeSpent, setTimeSpent] = useState<number>(0);

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

    let query = supabase.from("tasks").select("*, clients(id, name, email, organization_name), profiles!tasks_assigned_to_fkey(id, name, email), reviewer:profiles!tasks_reviewer_id_fkey(id, name, email)");

    const isAdmin = profile?.role === "admin";
    const isReviewer = profile?.is_reviewer || profile?.role === "reviewer";

    if (!isAdmin) {
      if (isReviewer) {
        query = query.or(`assigned_to.eq.${profile?.id},reviewer_id.eq.${profile?.id}`);
      } else {
        query = query.eq("assigned_to", profile?.id);
      }
    }

    const { data: tData } = await query.order("due_date", { ascending: true });

    if (tData) setTasks(tData);
    setLoading(false);
  }

  async function loadTaskTimeline(taskId: string) {
    setLoadingTimeline(true);
    const { data: logs } = await supabase
      .from("audit_logs")
      .select("*")
      .eq("entity", "TASKS")
      .eq("entity_id", taskId)
      .order("timestamp", { ascending: false });

    if (logs) setTaskTimeline(logs);
    setLoadingTimeline(false);
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

  // Helper to send emails
  async function dispatchEmail(to: string, subject: string, body: string) {
    if (!to) return false;
    const formData = new FormData();
    formData.append("to", to);
    formData.append("subject", subject);
    formData.append("body", body);
    try {
      const res = await fetch("/api/send-email", { method: "POST", body: formData });
      return res.ok;
    } catch {
      return false;
    }
  }

  function handleClientChange(id: string) {
    setClientId(id);
    const c = clients.find((client) => String(client.id) === id);
    if (c) {
      setOrganisation((c as any).organization_name || "");
    } else {
      setOrganisation("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload = {
      title: title.trim(),
      client_id: clientId || null,
      organisation: organisation.trim(),
      category,
      due_date: dueDate,
      official_due_date: officialDueDate || null,
      assigned_to: assignedTo || null,
      reviewer_id: reviewerId || null,
      priority,
      stage,
      recurrence,
      notes: notes.trim(),
      review_comments: reviewComments.trim(),
      time_spent_minutes: timeSpent
    };

    const isNewTask = !editingTask;
    const isReassigned = editingTask && assignedTo !== editingTask.assigned_to;
    const stageChangedTo = editingTask && stage !== editingTask.stage ? stage : null;

    if (editingTask) {
      const { error } = await supabase.from("tasks").update(payload).eq("id", editingTask.id);
      if (error) return alert("Error updating task: " + error.message);

      const metadata: any = {};
      if (stageChangedTo) metadata.stage_changed_to = stage;
      if (isReassigned) metadata.reassigned = true;
      if (timeSpent !== editingTask.time_spent_minutes) metadata.time_logged = `${timeSpent} mins`;

      await logAuditEvent("UPDATE_TASK", "TASKS", editingTask.id, metadata);

      if (stageChangedTo === "Approved" && recurrence !== "None") {
        const nextDate = calculateNextDueDate(dueDate, recurrence);
        if (nextDate) {
          const nextTaskPayload = { ...payload, due_date: nextDate, stage: "Assigned" as TaskStage, review_comments: "", time_spent_minutes: 0 };
          await supabase.from("tasks").insert([nextTaskPayload]);
        }
      }
    } else {
      const { data, error } = await supabase.from("tasks").insert([payload]).select().single();
      if (error) return alert("Error creating task: " + error.message);
      await logAuditEvent("CREATE_TASK", "TASKS", data.id, { title, stage });
    }

    // --- EXACT WORKFLOW EMAIL ENGINE ---
    const assignee = team.find((t) => String(t.id) === String(assignedTo));
    const selectedClient = clients.find((c) => String(c.id) === String(clientId));
    const reviewer = team.find((t) => String(t.id) === String(reviewerId));

    let emailsSent = 0;

    if (isNewTask || isReassigned) {
      if (selectedClient?.email) {
        const sent = await dispatchEmail(
          selectedClient.email, 
          `New Service Request Initiated: ${title}`, 
          `Dear ${selectedClient.name},\n\nWe have initiated work on your request: "${title}". Our team will notify you upon completion.\n\nBest regards,\nFinetax Team`
        );
        if (sent) emailsSent++;
      }
      if (assignee?.email) {
        const sent = await dispatchEmail(
          assignee.email, 
          `New Task Assigned: ${title}`, 
          `Hello ${assignee.name},\n\nYou have been assigned a new task: "${title}".\n\nClient: ${selectedClient?.name || "N/A"}\nDue Date: ${dueDate}\n\nPlease log into the portal, mark as 'In Progress', and execute.`
        );
        if (sent) emailsSent++;
      }
    }

    if (stageChangedTo) {
      if (stageChangedTo === "Submitted for Review" && reviewer?.email) {
        const sent = await dispatchEmail(
          reviewer.email, 
          `Task Ready for Review: ${title}`, 
          `Hello ${reviewer.name},\n\nThe task "${title}" was submitted for review by ${assignee?.name || 'Staff'}.\n\nPlease review it in your queue.`
        );
        if (sent) emailsSent++;
      } 
      else if (stageChangedTo === "Changes Required" && assignee?.email) {
        const sent = await dispatchEmail(
          assignee.email, 
          `Task Needs Correction: ${title}`, 
          `Hello ${assignee.name},\n\nYour submitted task "${title}" requires corrections.\n\nReviewer Feedback: ${reviewComments}\n\nPlease revise and resubmit.`
        );
        if (sent) emailsSent++;
      } 
      else if (stageChangedTo === "Approved" && selectedClient?.email) {
        const sent = await dispatchEmail(
          selectedClient.email, 
          `Task Completed: ${title}`, 
          `Dear ${selectedClient.name},\n\nWe are pleased to inform you that your task "${title}" has been completed and verified.\n\nBest regards,\nFinetax Team`
        );
        if (sent) emailsSent++;
      }
    }

    if (emailsSent > 0) {
      alert(`Task saved! ${emailsSent} workflow notification emails dispatched.`);
    }

    closeModal();
    loadData();
  }

  function openModal(task?: any) {
    if (task) {
      setEditingTask(task);
      setTitle(task.title);
      setClientId(task.client_id || "");
      setOrganisation(task.organisation || task.clients?.organization_name || "");
      setCategory(task.category);
      setDueDate(task.due_date || "");
      setOfficialDueDate(task.official_due_date || "");
      setAssignedTo(task.assigned_to || "");
      setReviewerId(task.reviewer_id || "");
      setPriority(task.priority || "Medium");
      setStage(task.stage);
      setRecurrence(task.recurrence || "None");
      setNotes(task.notes || "");
      setReviewComments(task.review_comments || "");
      setTimeSpent(task.time_spent_minutes || 0);

      loadTaskTimeline(task.id);
    } else {
      setEditingTask(null);
      setTaskTimeline([]);
      resetForm();
    }
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingTask(null);
    setTaskTimeline([]);
    resetForm();
  }

  function resetForm() {
    setTitle("");
    setClientId("");
    setOrganisation("");
    setCategory("Other");
    setDueDate("");
    setOfficialDueDate("");
    setAssignedTo("");
    setReviewerId("");
    setPriority("Medium");
    setStage("Assigned");
    setRecurrence("None");
    setNotes("");
    setReviewComments("");
    setTimeSpent(0);
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
    const matchesSearch = [t.title, t.notes, t.category, t.organisation].filter(Boolean).some((f) => f.toLowerCase().includes(search.toLowerCase()));
    const matchesStage = filterStage ? t.stage === filterStage : true;
    const matchesCategory = filterCategory ? t.category === filterCategory : true;
    const matchesClient = filterClient ? t.client_id === filterClient : true;
    const matchesRecurring = filterRecurring === "recurring" ? t.recurrence && t.recurrence !== "None" : filterRecurring === "onetime" ? !t.recurrence || t.recurrence === "None" : true;

    return matchesSearch && matchesStage && matchesCategory && matchesClient && matchesRecurring;
  });

  // --- ROLE BASED ACCESS CONTROL ---
  const isAdmin = currentUser?.role === "admin";
  const isTaskReviewer = currentUser?.id === reviewerId;
  const isTaskAssignee = currentUser?.id === assignedTo;

  const canEditCoreDetails = !editingTask || isAdmin || isTaskReviewer;
  const canEditReviewerFeedback = isAdmin || isTaskReviewer || currentUser?.role === "reviewer";

  let availableStages = STAGES;
  if (editingTask && !isAdmin && !isTaskReviewer && isTaskAssignee) {
    availableStages = ['Assigned', 'In Progress', 'Submitted for Review'];
    if (editingTask.stage === 'Changes Required') {
      availableStages = ['Changes Required', 'In Progress', 'Submitted for Review'];
    }
  }

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

        {isAdmin && (
          <button onClick={() => openModal()} className="flex items-center gap-2 bg-navy text-white px-4 py-2 rounded-md font-medium text-xs hover:bg-navy/90 transition w-full md:w-auto justify-center">
            <Plus className="h-4 w-4" /> Add Task
          </button>
        )}
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
                  <th className="p-3">Deadlines (Int / Off)</th>
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
                  const needsAction = t.assigned_to === currentUser?.id && (t.stage === 'Assigned' || t.stage === 'Changes Required');

                  return (
                    <tr key={t.id} className={`hover:bg-background/50 transition cursor-pointer ${needsAction ? 'bg-amber-50/30' : ''}`} onClick={() => openModal(t)}>
                      <td className="p-3 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className={`font-medium ${isOverdue ? 'text-rose-600 font-bold flex items-center gap-1' : 'text-text-main'}`}>
                            {isOverdue && <AlertCircle className="h-3 w-3" />} Int: {t.due_date || "-"}
                          </span>
                          <span className="text-[10px] text-text-muted mt-0.5">
                            Off: {t.official_due_date || "-"}
                          </span>
                        </div>
                      </td>

                      <td className="p-3 font-semibold text-navy">
                        {t.title}
                        {needsAction && <span className="ml-2 h-2 w-2 rounded-full bg-amber-500 inline-block animate-pulse" title="Action Required"></span>}
                      </td>
                      <td className="p-3">{t.category}</td>
                      <td className="p-3">
                        <div className="font-medium">{t.clients?.name || "-"}</div>
                        {t.organisation && <div className="text-[10px] text-text-muted">{t.organisation}</div>}
                      </td>
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

      {/* Task Modal (Responsive & Scrollable Layout) */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-2 sm:p-4 z-50">
          <div className="bg-surface rounded-lg border border-border w-full max-w-5xl flex flex-col max-h-[95vh] shadow-lg text-xs">
            
            {/* Fixed Header */}
            <div className="flex justify-between items-center border-b border-border p-4 shrink-0">
              <h3 className="font-semibold text-base text-text-main flex items-center gap-2">
                {editingTask ? "Manage Task Lifecycle" : "Add Task"}
                {!canEditCoreDetails && (
                  <span title="Core details locked for execution staff">
                    <Lock className="h-4 w-4 text-text-muted" />
                  </span>
                )}
              </h3>
              <button onClick={closeModal} className="text-text-muted hover:text-text-main"><X className="h-5 w-5" /></button>
            </div>

            {/* Scrollable Body */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1">
              <div className={`grid grid-cols-1 ${editingTask ? 'md:grid-cols-3' : 'md:grid-cols-1'} gap-8`}>

                {/* LEFT COLUMN: Form Execution */}
                <div className={`${editingTask ? 'md:col-span-2' : 'md:col-span-1'} space-y-4`}>
                  <form id="task-form" onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label className="block font-semibold text-text-muted mb-1">TASK TITLE *</label>
                      <input disabled={!canEditCoreDetails} required type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-60" />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-text-muted mb-1">CLIENT</label>
                        <select disabled={!canEditCoreDetails} value={clientId} onChange={(e) => handleClientChange(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface disabled:bg-background disabled:opacity-60">
                          <option value="">(Internal / No Client)</option>
                          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-semibold text-text-muted mb-1">ORGANISATION</label>
                        <input disabled={!canEditCoreDetails} type="text" placeholder="e.g. Acme Corp" value={organisation} onChange={(e) => setOrganisation(e.target.value)} className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-60" />
                      </div>

                      <div>
                        <label className="block font-semibold text-text-muted mb-1">CATEGORY</label>
                        <select disabled={!canEditCoreDetails} value={category} onChange={(e) => setCategory(e.target.value as TaskCategory)} className="w-full border border-border rounded p-2 text-xs bg-surface disabled:bg-background disabled:opacity-60">
                          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-semibold text-text-muted mb-1">RECURRENCE</label>
                        <select disabled={!canEditCoreDetails} value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface disabled:bg-background disabled:opacity-60">
                          {RECURRENCE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-semibold text-amber-600 mb-1">INTERNAL TEAM DEADLINE *</label>
                        <input disabled={!canEditCoreDetails} required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full border border-amber-300 rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-60" />
                      </div>

                      <div>
                        <label className="block font-semibold text-rose-600 mb-1">OFFICIAL STATUTORY DEADLINE</label>
                        <input disabled={!canEditCoreDetails} type="date" value={officialDueDate} onChange={(e) => setOfficialDueDate(e.target.value)} className="w-full border border-rose-300 rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-background disabled:opacity-60" />
                      </div>

                      <div>
                        <label className="block font-semibold text-text-muted mb-1 text-navy">WORKFLOW STAGE *</label>
                        <select value={stage} onChange={(e) => setStage(e.target.value as TaskStage)} className="w-full border border-navy/30 rounded p-2 text-xs bg-navy/5 font-semibold text-navy">
                          {availableStages.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-semibold text-text-muted mb-1">ASSIGN EXECUTION TO</label>
                        <select disabled={!canEditCoreDetails} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface disabled:bg-background disabled:opacity-60">
                          <option value="">-- Unassigned --</option>
                          {team.map(t => <option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block font-semibold text-text-muted mb-1">ASSIGN REVIEWER</label>
                        <select disabled={!canEditCoreDetails} value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface disabled:bg-background disabled:opacity-60">
                          <option value="">-- No Reviewer --</option>
                          {team.filter(t => t.role === 'admin' || (t as any).is_reviewer || t.role === 'reviewer').map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block font-semibold text-text-muted mb-1">PRIORITY</label>
                        <select disabled={!canEditCoreDetails} value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface disabled:bg-background disabled:opacity-60">
                          <option>Low</option><option>Medium</option><option>High</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-semibold text-text-muted mb-1">TIME SPENT (MINUTES)</label>
                        <div className="relative">
                          <Clock className="absolute left-2.5 top-2 h-4 w-4 text-text-muted" />
                          <input type="number" min="0" value={timeSpent} onChange={(e) => setTimeSpent(Number(e.target.value))} className="w-full pl-8 pr-3 py-2 border border-border rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
                        </div>
                      </div>
                    </div>

                    {recurrence !== 'None' && (
                      <div className="bg-navy/5 border border-navy/20 text-navy p-2 rounded flex items-center gap-2">
                        <RefreshCw className="h-4 w-4" /> 
                        When this task is approved, the next occurrence will auto-generate.
                      </div>
                    )}

                    <div>
                      <label className="block font-semibold text-text-muted mb-1">EXECUTION NOTES</label>
                      <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
                    </div>

                    <div className="bg-background p-3 rounded-lg border border-border">
                      <label className="block font-semibold text-navy mb-1">REVIEWER FEEDBACK / REQUIRED CHANGES</label>
                      <textarea
                        rows={2}
                        value={reviewComments}
                        onChange={(e) => setReviewComments(e.target.value)}
                        disabled={!canEditReviewerFeedback}
                        className="w-full border border-border rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-surface disabled:opacity-60"
                        placeholder="Reviewers: Specify required changes here before returning task to 'Changes Required'..."
                      />
                    </div>
                  </form>
                </div>

                {/* RIGHT COLUMN: The Audit Timeline Feed */}
                {editingTask && (
                  <div className="md:col-span-1 border-t md:border-t-0 md:border-l border-border pt-6 md:pt-0 md:pl-6 max-h-full md:max-h-[60vh] overflow-y-auto">
                    <div className="flex items-center gap-2 text-navy font-bold mb-4 border-b border-border pb-2 sticky top-0 bg-surface">
                      <Activity className="h-4 w-4" /> Task Timeline Feed
                    </div>

                    {loadingTimeline ? (
                      <div className="text-text-muted italic">Loading task history...</div>
                    ) : taskTimeline.length === 0 ? (
                      <div className="text-text-muted italic">No historical data recorded yet.</div>
                    ) : (
                      <div className="space-y-4">
                        {taskTimeline.map((log: any) => {
                          const dt = new Date(log.timestamp);
                          const isCreate = log.action === "CREATE_TASK";

                          return (
                            <div key={log.id} className="relative pl-4 border-l-2 border-border pb-4 last:border-0 last:pb-0">
                              <div className={`absolute -left-[5px] top-1 h-2 w-2 rounded-full ${isCreate ? 'bg-emerald-500' : 'bg-navy'}`}></div>

                              <div className="flex justify-between items-start mb-1">
                                <span className="font-semibold text-text-main">
                                  {isCreate ? "Task Created" : log.action.replace("_", " ")}
                                </span>
                                <span className="text-[10px] text-text-muted whitespace-nowrap pl-2">
                                  {dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>

                              <div className="text-text-muted">
                                by <span className="font-semibold">{log.metadata?.actor_name || "System"}</span>
                              </div>

                              {log.metadata?.stage_changed_to && (
                                <div className="mt-1 bg-navy/5 text-navy px-2 py-1 rounded inline-block text-[10px] font-medium border border-navy/10">
                                  Moved to <span className="font-bold">{log.metadata.stage_changed_to}</span>
                                </div>
                              )}
                              {log.metadata?.time_logged && (
                                <div className="mt-1 bg-emerald-50 text-emerald-700 px-2 py-1 rounded inline-block text-[10px] font-medium border border-emerald-200">
                                  Logged <span className="font-bold">{log.metadata.time_logged}</span>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Fixed Footer Buttons */}
            <div className="flex justify-between items-center p-4 border-t border-border mt-auto bg-surface rounded-b-lg">
              {editingTask && canEditCoreDetails ? (
                <button type="button" onClick={handleDelete} className="px-3 py-1.5 bg-rose-600 text-white rounded font-semibold flex items-center gap-1 hover:bg-rose-700">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              ) : <div />}

              <div className="flex gap-2 ml-auto">
                <button type="button" onClick={closeModal} className="px-4 py-1.5 border border-border rounded text-text-main hover:bg-background">Cancel</button>
                <button type="submit" form="task-form" className="px-4 py-1.5 bg-navy text-white rounded font-medium hover:bg-navy/90">Save Task</button>
              </div>
            </div>
            
          </div>
        </div>
      )}
    </div>
  );
}