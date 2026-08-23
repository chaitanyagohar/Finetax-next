"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Users,
  UserPlus,
  FileText,
  CheckSquare,
  Calendar,
  MessageSquare,
  Clock,
  Receipt,
  Folder,
  UserCheck,
  ShieldAlert,
  Settings,
  LogOut,
  Shield,
  ChevronDown,
  ChevronRight,
  Clock3,
  AlertTriangle,
  Package,
  Inbox,
  BarChart3
} from "lucide-react";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const [profile, setProfile] = useState<any>(null);
  const [isReviewerOpen, setIsReviewerOpen] = useState(true);

  useEffect(() => {
    async function fetchProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
        if (data) setProfile(data);
      }
    }
    fetchProfile();
  }, []);

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error("Logout Error:", error);
    }
  }

  const role = profile?.role || "staff";
  const isAdmin = role === "admin";
  const isReviewer = profile?.is_reviewer || isAdmin;
  const userModules: string[] = profile?.module_access || ["leads", "tasks", "time_tracking"];

  const PRIMARY_NAV = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard, moduleId: "dashboard" },
    { name: "Clients", href: "/clients", icon: Users, moduleId: "leads" },
    { name: "Unified Inbox", href: "/inbox", icon: Inbox, moduleId: "dashboard" },
    { name: "Enquiries & Leads", href: "/leads", icon: UserPlus, moduleId: "leads" },
    { name: "Quotations", href: "/quotations", icon: FileText, moduleId: "quotations" },
    { name: "Tasks & Compliance", href: "/tasks", icon: CheckSquare, moduleId: "tasks" },
    { name: "Compliance Calendar", href: "/calendar", icon: Calendar, moduleId: "calendar" },
    { name: "Client Discussions", href: "/client-discussions", icon: MessageSquare, moduleId: "discussions" },
    { name: "Time Tracking", href: "/time-tracking", icon: Clock, moduleId: "time_tracking" },
    { name: "Invoices", href: "/invoices", icon: Receipt, moduleId: "invoices" },
    { name: "Documents", href: "/documents", icon: Folder, moduleId: "documents" },
    { name: "Team Management", href: "/team", icon: UserCheck, adminOnly: true, moduleId: "team" },
    { name: "Service Packages", href: "/packages", icon: Package, adminOnly: true, moduleId: "packages" },
    { name: "Firm Settings", href: "/settings", icon: Settings, adminOnly: true, moduleId: "settings" },
  ];

  const REVIEWER_SUB_TABS = [
    { name: "Pending Approvals", href: "/reviewer-queue?tab=pending", icon: Clock3 },
    { name: "Revision Requests", href: "/reviewer-queue?tab=revisions", icon: AlertTriangle },
    { name: "Quality Analytics", href: "/reviewer-queue?tab=analytics", icon: BarChart3 },
  ];

  return (
    <aside className="w-64 bg-navy text-white flex flex-col h-screen shrink-0 border-r border-navy/20">
      {/* Brand Header */}
      <div className="p-4 border-b border-white/10">
        <h1 className="text-xl font-bold tracking-tight text-white">Practice Manager</h1>
        <p className="text-xs text-muted font-medium">Local Office Edition</p>
      </div>

      {/* Dynamic Navigation Stream */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        {PRIMARY_NAV.filter((item) => {
          if (item.href === "/") return true;
          if (item.adminOnly && !isAdmin) return false;
          if (!isAdmin && item.moduleId) return userModules.includes(item.moduleId);
          return true;
        }).map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition ${
                isActive
                  ? "bg-accent text-white shadow-sm font-semibold"
                  : "text-muted hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.name}</span>
            </Link>
          );
        })}

        {/* COMBINED REVIEWER HUB (Rendered for Staff members with is_reviewer = true) */}
        {isReviewer && (
          <div className="pt-2">
            <button
              onClick={() => setIsReviewerOpen(!isReviewerOpen)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-wider text-accent hover:text-white transition"
            >
              <span className="flex items-center gap-2">
                <Shield className="h-4 w-4" /> Reviewer Gatekeeper
              </span>
              {isReviewerOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>

            {isReviewerOpen && (
              <div className="mt-1 pl-4 space-y-1 border-l-2 border-accent/30 ml-3">
                {REVIEWER_SUB_TABS.map((sub) => {
                  const SubIcon = sub.icon;
                  const isSubActive = pathname === "/reviewer-queue" && (
                    typeof window !== "undefined" && window.location.search.includes(sub.href.split("?")[1])
                  );

                  return (
                    <Link
                      key={sub.href}
                      href={sub.href}
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition ${
                        isSubActive
                          ? "bg-white/15 text-white font-bold"
                          : "text-muted hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <SubIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
                      <span>{sub.name}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Profile & Account Status Footer */}
      <div className="p-4 border-t border-white/10 bg-navy/50">
        <div className="flex items-center justify-between">
          <div className="truncate">
            <p className="text-sm font-semibold text-white truncate">{profile?.name || "User"}</p>
            <p className="text-[11px] text-muted capitalize">
              {isAdmin ? "Administrator" : profile?.is_reviewer ? "Staff + Reviewer" : "Execution Staff"}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="text-muted hover:text-white p-1 rounded transition"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}