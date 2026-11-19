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
  MessagesSquare,
  Building2,
  Sun,
  LineChart,
  GitBranch,
  CalendarCheck,
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
  /** Duesk owner */
  isPlatformOwner?: boolean;
  /** Signed in to the Duesk staff workspace (Oddlambda), not a CA firm */
  isPlatformHome?: boolean;
  /** Current firm */
  orgId: string;
  orgName: string;
  /** Features this firm's plan includes (plus any extras from Duesk) */
  features?: Record<string, boolean>;
  plan?: string;
  planName?: string;
  avatarUrl?: string | null;
  firmLogoUrl?: string | null;
  /** Rights from the person's firm role (admins have all of them) */
  permissions?: string[];
}

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  moduleId: string;
  adminOnly?: boolean;
  /** Admins, or people whose firm role grants this */
  permission?: string;
  /** Visible to every active user (each sees only their own data on that page). */
  everyone?: boolean;
  /** Visible only to support agents. */
  supportOnly?: boolean;
  /** Visible only to the Duesk owner. */
  ownerOnly?: boolean;
  /** Shown in the Duesk staff workspace. */
  platform?: boolean;
  /** Plan feature; when the firm's plan lacks it the item shows a lock and leads to the Plan page */
  feature?: string;
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
      { name: "My day", href: "/my-day", icon: Sun, moduleId: "tasks", everyone: true },
      { name: "Unified inbox", href: "/inbox", icon: Inbox, moduleId: "dashboard", feature: "inbox" },
      { name: "Team chat", href: "/chat", icon: MessagesSquare, moduleId: "chat", everyone: true, platform: true },
    ],
  },
  {
    label: "Clients & sales",
    items: [
      { name: "Clients", href: "/clients", icon: Users, moduleId: "leads" },
      { name: "Enquiries & leads", href: "/leads", icon: UserPlus, moduleId: "leads", feature: "leads_crm" },
      { name: "Quotations", href: "/quotations", icon: FileText, moduleId: "quotations" },
      { name: "Client discussions", href: "/client-discussions", icon: MessageSquare, moduleId: "discussions" },
    ],
  },
  {
    label: "Compliance & work",
    items: [
      { name: "Tasks & compliance", href: "/tasks", icon: CheckSquare, moduleId: "tasks" },
      { name: "Compliance calendar", href: "/calendar", icon: Calendar, moduleId: "calendar" },
      { name: "Time tracking", href: "/time-tracking", icon: Clock, moduleId: "time_tracking" },
      { name: "Attendance", href: "/attendance", icon: CalendarCheck, moduleId: "attendance", everyone: true, feature: "attendance" },
      { name: "Performance", href: "/performance", icon: Gauge, moduleId: "performance", everyone: true, feature: "kpi_scorecards" },
      { name: "Documents", href: "/documents", icon: Folder, moduleId: "documents" },
    ],
  },
  {
    label: "Finance",
    items: [
      { name: "Invoices", href: "/invoices", icon: Receipt, moduleId: "invoices" },
      { name: "Practice insights", href: "/insights", icon: LineChart, moduleId: "insights", everyone: true, permission: "see_profitability", feature: "insights" },
    ],
  },
  {
    label: "Support",
    items: [
      { name: "Help & support", href: "/help", icon: LifeBuoy, moduleId: "help", everyone: true },
      { name: "Support inbox", href: "/support", icon: Headphones, moduleId: "support", supportOnly: true, platform: true },
    ],
  },
  {
    label: "Duesk",
    items: [{ name: "Owner console", href: "/owner", icon: Building2, moduleId: "owner", ownerOnly: true, platform: true }],
  },
  {
    label: "Administration",
    items: [
      { name: "Team management", href: "/team", icon: UserCheck, adminOnly: true, moduleId: "team" },
      { name: "Branches and roles", href: "/organisation", icon: GitBranch, adminOnly: true, moduleId: "team" },
      { name: "Service packages", href: "/packages", icon: Package, adminOnly: true, moduleId: "packages", feature: "leads_crm" },
      { name: "Logs", href: "/audit-page", icon: ShieldAlert, adminOnly: true, moduleId: "audit-page" },
      { name: "Firm settings", href: "/settings", icon: Settings, adminOnly: true, moduleId: "settings" },
    ],
  },
];

export const REVIEWER_SUB_TABS = [
  { name: "Pending approvals", href: "/reviewer-queue?tab=pending", tab: "pending", icon: Clock3 },
  { name: "Revision requests", href: "/reviewer-queue?tab=revisions", tab: "revisions", icon: AlertTriangle },
  { name: "Quality analytics", href: "/reviewer-queue?tab=analytics", tab: "analytics", icon: BarChart3 },
];

/** UI-level visibility only. Real enforcement must happen in Supabase RLS + middleware. */
export function canAccess(item: NavItem, user: SessionUser): boolean {
  if (item.href === "/") return true;
  if (item.ownerOnly) return !!user.isPlatformOwner;
  if (item.supportOnly) return !!user.isSupportAgent;
  if (item.permission && !user.isAdmin && !user.permissions?.includes(item.permission)) return false;
  if (item.adminOnly && !user.isAdmin) return false;
  if (item.everyone) return true;
  if (!user.isAdmin) return user.moduleAccess.includes(item.moduleId);
  return true;
}

export function getVisibleSections(user: SessionUser): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    // In the Duesk staff workspace, only console pages are shown
    items: section.items.filter((item) => (!user.isPlatformHome || item.platform) && canAccess(item, user)),
  })).filter((section) => section.items.length > 0);
}

export function isPathActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function getPageTitle(pathname: string): string {
  if (pathname.startsWith("/reviewer-queue")) return "Review tasks";
  if (pathname.startsWith("/security")) return "Sign-in security";
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (isPathActive(pathname, item.href)) return item.name;
    }
  }
  return "Duesk";
}

/** Role shown under the user's name (sidebar footer and top-right menu). */
export function roleLabelFor(user: SessionUser): string {
  if (user.isPlatformHome) return user.isPlatformOwner ? "Duesk Owner" : "Duesk Support";
  if (user.isAdmin) return "Administrator";
  return user.isReviewer ? "Staff + Reviewer" : "Execution Staff";
}