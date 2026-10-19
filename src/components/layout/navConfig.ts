import type { LucideIcon } from "lucide-react";
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
  Package,
  Inbox,
  Clock3,
  AlertTriangle,
  BarChart3,
  Gauge,
  LifeBuoy,
  Headphones,
} from "lucide-react";

/** Minimal, serialisable user object passed from the server layout to the client shell. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  designation: string | null;
  isAdmin: boolean;
  isReviewer: boolean;
  moduleAccess: string[];
  isSupportAgent?: boolean;
}

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  moduleId: string;
  adminOnly?: boolean;
  /** Visible to every active user (each sees only their own data on that page). */
  everyone?: boolean;
    /** Visible only to support agents. */
  supportOnly?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard, moduleId: "dashboard" },
      { name: "Unified Inbox", href: "/inbox", icon: Inbox, moduleId: "dashboard" },
    ],
  },
  {
    label: "Clients & Sales",
    items: [
      { name: "Clients", href: "/clients", icon: Users, moduleId: "leads" },
      { name: "Enquiries & Leads", href: "/leads", icon: UserPlus, moduleId: "leads" },
      { name: "Quotations", href: "/quotations", icon: FileText, moduleId: "quotations" },
      { name: "Client Discussions", href: "/client-discussions", icon: MessageSquare, moduleId: "discussions" },
    ],
  },
  {
    label: "Compliance & Work",
    items: [
      { name: "Tasks & Compliance", href: "/tasks", icon: CheckSquare, moduleId: "tasks" },
      { name: "Compliance Calendar", href: "/calendar", icon: Calendar, moduleId: "calendar" },
      { name: "Time Tracking", href: "/time-tracking", icon: Clock, moduleId: "time_tracking" },
      { name: "Performance", href: "/performance", icon: Gauge, moduleId: "performance", everyone: true },
      { name: "Documents", href: "/documents", icon: Folder, moduleId: "documents" },
    ],
  },
  {
    label: "Finance",
    items: [{ name: "Invoices", href: "/invoices", icon: Receipt, moduleId: "invoices" }],
  },
  {
    label: "Support",
    items: [
      { name: "Help & Support", href: "/help", icon: LifeBuoy, moduleId: "help", everyone: true },
      { name: "Support Inbox", href: "/support", icon: Headphones, moduleId: "support", supportOnly: true },
    ],
  },
  {
    label: "Administration",
    items: [
      { name: "Team Management", href: "/team", icon: UserCheck, adminOnly: true, moduleId: "team" },
      { name: "Service Packages", href: "/packages", icon: Package, adminOnly: true, moduleId: "packages" },
      { name: "Logs", href: "/audit-page", icon: ShieldAlert, adminOnly: true, moduleId: "audit-page" },
      { name: "Firm Settings", href: "/settings", icon: Settings, adminOnly: true, moduleId: "settings" },
    ],
  },
];

export const REVIEWER_SUB_TABS = [
  { name: "Pending Approvals", href: "/reviewer-queue?tab=pending", tab: "pending", icon: Clock3 },
  { name: "Revision Requests", href: "/reviewer-queue?tab=revisions", tab: "revisions", icon: AlertTriangle },
  { name: "Quality Analytics", href: "/reviewer-queue?tab=analytics", tab: "analytics", icon: BarChart3 },
];

/** UI-level visibility only. Real enforcement must happen in Supabase RLS + middleware. */
export function canAccess(item: NavItem, user: SessionUser): boolean {
  if (item.href === "/") return true;
  if (item.supportOnly) return !!user.isSupportAgent;
  if (item.adminOnly && !user.isAdmin) return false;
  if (item.everyone) return true;
  if (!user.isAdmin) return user.moduleAccess.includes(item.moduleId);
  return true;
}

export function getVisibleSections(user: SessionUser): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAccess(item, user)),
  })).filter((section) => section.items.length > 0);
}

export function isPathActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function getPageTitle(pathname: string): string {
  if (pathname.startsWith("/reviewer-queue")) return "Review Tasks";
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (isPathActive(pathname, item.href)) return item.name;
    }
  }
  return "Finetax Manager";
}