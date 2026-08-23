"use client";

import { useState, useEffect } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, AlertCircle, Plus, Filter, X, CheckSquare, Clock, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function ComplianceCalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date(2026, 7, 1));
  const [statutoryEvents, setStatutoryEvents] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [viewType, setViewType] = useState<"all" | "statutory" | "tasks">("all");

  // Day Agenda Drawer State
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(null);
  const [selectedDayEvents, setSelectedDayEvents] = useState<any[]>([]);
  const [selectedDayTasks, setSelectedDayTasks] = useState<any[]>([]);

  // Modal State for New Statutory Deadline
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("GST");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");

  const supabase = createClient();

  useEffect(() => {
    loadCalendarData();
  }, []);

// Inside loadCalendarData in src/app/calendar/page.tsx:

async function loadCalendarData() {
  setLoading(true);

  // Auto-trigger recurrence generation check safely
  try {
    const { error: rpcErr } = await supabase.rpc("generate_upcoming_recurring_tasks");
    if (rpcErr) console.warn("Recurrence RPC Notice:", rpcErr.message);
  } catch (err) {
    console.error("Recurrence execution error:", err);
  }

  const [{ data: eData }, { data: tData }] = await Promise.all([
    supabase.from("compliance_events").select("*"),
    supabase.from("tasks").select("*, clients(name), profiles!tasks_assigned_to_fkey(name)")
  ]);

  if (eData) setStatutoryEvents(eData);
  if (tData) setTasks(tData);

  setLoading(false);
}
  // Month Navigation
  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const formatDateKey = (dayNum: number) => {
    const d = new Date(year, month, dayNum);
    return d.toISOString().slice(0, 10);
  };

  const filteredEvents = statutoryEvents.filter((e) =>
    categoryFilter === "all" ? true : e.category === categoryFilter
  );

  const filteredTasks = tasks.filter((t) =>
    categoryFilter === "all" ? true : t.category === categoryFilter
  );

  function openDayInspector(dateStr: string, dayEvents: any[], dayTasks: any[]) {
    setSelectedDayDate(dateStr);
    setSelectedDayEvents(dayEvents);
    setSelectedDayTasks(dayTasks);
  }

  async function handleAddStatutory(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("compliance_events").insert([
      { title, category, due_date: dueDate, description }
    ]);

    if (error) alert("Error adding event: " + error.message);
    else {
      alert("Statutory deadline added to calendar!");
      setIsModalOpen(false);
      setTitle("");
      setDueDate("");
      setDescription("");
      loadCalendarData();
    }
  }

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="bg-surface p-5 rounded-lg border border-border shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-text-main flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-navy" /> Compliance & Workload Calendar
          </h2>
          <p className="text-xs text-text-muted mt-1">
            Integrated calendar tracking statutory deadlines and auto-generated recurring tasks.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-background p-1 border border-border rounded text-xs">
            <Filter className="h-3.5 w-3.5 text-text-muted ml-1" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-transparent font-medium focus:outline-none text-xs"
            >
              <option value="all">All Categories</option>
              <option value="GST">GST</option>
              <option value="Income Tax">Income Tax</option>
              <option value="ROC">ROC</option>
              <option value="Audit">Audit</option>
            </select>
          </div>

          <select
            value={viewType}
            onChange={(e: any) => setViewType(e.target.value)}
            className="border border-border rounded p-1.5 text-xs bg-surface font-semibold text-navy"
          >
            <option value="all">All Items</option>
            <option value="statutory">Statutory Only</option>
            <option value="tasks">Tasks Only</option>
          </select>

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 bg-navy text-white px-3 py-1.5 rounded font-medium text-xs hover:bg-navy/90"
          >
            <Plus className="h-3.5 w-3.5" /> Add Statutory Deadline
          </button>
        </div>
      </div>

      {/* Calendar Month Selector */}
      <div className="bg-surface p-4 rounded-lg border border-border shadow-sm flex items-center justify-between">
        <button onClick={prevMonth} className="p-1.5 border border-border rounded hover:bg-background text-navy">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h3 className="font-bold text-base text-navy">
          {monthNames[month]} {year}
        </h3>
        <button onClick={nextMonth} className="p-1.5 border border-border rounded hover:bg-background text-navy">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Monthly Calendar Grid */}
      <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
        <div className="grid grid-cols-7 bg-background border-b border-border text-center text-xs font-bold text-navy py-2">
          <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
        </div>

        <div className="grid grid-cols-7 divide-x divide-y divide-border text-xs min-h-[500px]">
          {Array.from({ length: firstDayOfMonth }).map((_, i) => (
            <div key={`empty-${i}`} className="bg-background/30 min-h-[110px] p-1" />
          ))}

          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const dateStr = formatDateKey(dayNum);

            const dayEvents = (viewType === "tasks" ? [] : filteredEvents).filter((e) => e.due_date === dateStr);
            const dayTasks = (viewType === "statutory" ? [] : filteredTasks).filter((t) => t.due_date === dateStr);

            const totalCount = dayEvents.length + dayTasks.length;
            const isToday = new Date().toISOString().slice(0, 10) === dateStr;

            // Combine and limit display to max 3 items
            const combinedItems = [
              ...dayEvents.map((e) => ({ ...e, isStatutory: true })),
              ...dayTasks.map((t) => ({ ...t, isStatutory: false }))
            ];
            const visibleItems = combinedItems.slice(0, 3);
            const hiddenCount = totalCount - visibleItems.length;

            return (
              <div
                key={dayNum}
                onClick={() => openDayInspector(dateStr, dayEvents, dayTasks)}
                className={`min-h-[110px] p-1.5 space-y-1 transition cursor-pointer ${isToday ? "bg-navy/5" : "hover:bg-background/60"}`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${isToday ? "bg-navy text-white" : "text-text-main"}`}>
                    {dayNum}
                  </span>
                  {totalCount > 0 && (
                    <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-1 rounded border border-rose-200">
                      {totalCount}
                    </span>
                  )}
                </div>

                {/* Render Visible Badges */}
                {visibleItems.map((item, idx) => (
                  <div
                    key={idx}
                    className={`p-1 rounded text-[10px] space-y-0.5 shadow-xs truncate ${
                      item.isStatutory
                        ? "bg-rose-50 border border-rose-200 text-rose-800 font-bold"
                        : "bg-blue-50 border border-blue-200 text-navy font-medium"
                    }`}
                  >
                    <p className="truncate">{item.isStatutory ? `📌 ${item.title}` : `✓ ${item.title}`}</p>
                  </div>
                ))}

                {/* Render Overflow Indicator */}
                {hiddenCount > 0 && (
                  <div className="p-0.5 rounded bg-navy/10 text-navy font-bold text-[9px] text-center hover:bg-navy/20">
                    +{hiddenCount} more items...
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Day Agenda Inspector Drawer */}
      {selectedDayDate && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
          <div className="bg-surface w-full max-w-md h-full p-5 space-y-4 shadow-xl text-xs overflow-y-auto">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <div>
                <h3 className="font-bold text-base text-navy flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Day Agenda: {selectedDayDate}
                </h3>
                <p className="text-[11px] text-text-muted">Detailed task breakdown for this date.</p>
              </div>
              <button onClick={() => setSelectedDayDate(null)} className="text-text-muted hover:text-text-main">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Statutory Events Section */}
            {selectedDayEvents.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase text-rose-600 tracking-wider">Statutory Tax Deadlines</span>
                {selectedDayEvents.map((e) => (
                  <div key={e.id} className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-800 space-y-1">
                    <p className="font-bold text-xs">📌 {e.title}</p>
                    <p className="text-[11px]">{e.description || "Official statutory filing deadline."}</p>
                    <span className="inline-block px-1.5 py-0.5 bg-rose-200 text-rose-800 font-bold rounded text-[9px] uppercase">
                      {e.category}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Client Tasks Section */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase text-navy tracking-wider">
                Assigned Tasks ({selectedDayTasks.length})
              </span>
              {selectedDayTasks.length === 0 ? (
                <p className="text-text-muted text-center py-4">No client tasks scheduled on this day.</p>
              ) : (
                selectedDayTasks.map((t) => (
                  <div key={t.id} className="p-3 border border-border rounded bg-background space-y-1.5 shadow-sm">
                    <div className="flex justify-between items-start">
                      <span className="font-bold text-navy text-xs">{t.title}</span>
                      <span className="px-1.5 py-0.5 bg-navy/10 text-navy font-bold text-[9px] rounded uppercase">
                        {t.stage}
                      </span>
                    </div>
                    <p className="text-text-muted text-[11px]">Client: {t.clients?.name || "Internal"}</p>
                    <p className="text-text-muted text-[11px]">Assigned Staff: {t.profiles?.name || "Unassigned"}</p>
                    {t.recurrence && t.recurrence !== "None" && (
                      <span className="inline-block text-[10px] text-accent font-semibold">↻ {t.recurrence} Task</span>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t border-border">
              <Link
                href="/tasks"
                className="w-full py-2 bg-navy text-white rounded font-bold text-center block hover:bg-navy/90"
              >
                Open Full Task Board
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Modal for Statutory Entry */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md p-5 space-y-4 shadow-xl text-xs">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-sm text-text-main">Add Statutory Event</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-text-muted"><X className="h-4 w-4" /></button>
            </div>

            <form onSubmit={handleAddStatutory} className="space-y-3">
              <div>
                <label className="block font-semibold text-text-muted mb-1">EVENT TITLE *</label>
                <input required type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border border-border rounded p-2 text-xs" placeholder="GSTR-3B Return Filing" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-muted mb-1">CATEGORY</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border border-border rounded p-2 text-xs bg-surface">
                    <option>GST</option><option>Income Tax</option><option>ROC</option><option>Audit</option><option>Other</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-muted mb-1">DUE DATE *</label>
                  <input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full border border-border rounded p-2 text-xs" />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-text-muted mb-1">DESCRIPTION</label>
                <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full border border-border rounded p-2 text-xs" placeholder="Filing instructions..." />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-1.5 border border-border rounded">Cancel</button>
                <button type="submit" className="px-4 py-1.5 bg-navy text-white rounded font-bold">Save Event</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}