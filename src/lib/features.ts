/**
 * Every switchable feature, as shown in the owner's plans editor and on the Plan page.
 * The switches themselves live in the database (plans.features, org_feature_overrides).
 */
export interface FeatureInfo {
  key: string;
  label: string;
  hint: string;
  group: "Team workflow" | "Clients and billing" | "Time and people" | "Communication" | "Control and scale";
}

export const FEATURES: FeatureInfo[] = [
  { key: "maker_checker", label: "Maker-checker review", hint: "A second person approves work; review queue and quality analytics", group: "Team workflow" },
  { key: "bulk_actions", label: "Bulk task actions", hint: "Reassign, re-date or delete many tasks at once", group: "Team workflow" },
  { key: "escalation_levels", label: "Escalation levels", hint: "Assignee, then reviewer, then partners, plus a daily escalation list", group: "Team workflow" },
  { key: "leads_crm", label: "Enquiries and retainer packages", hint: "Lead pipeline, proposals and monthly retainers", group: "Clients and billing" },
  { key: "client_portal", label: "Client portal", hint: "Clients upload documents, follow filings and pay online", group: "Clients and billing" },
  { key: "insights", label: "Practice insights", hint: "Profitability, unbilled time and review flow", group: "Clients and billing" },
  { key: "email_attachments", label: "Email attachments to the vault", hint: "Files in client email filed under the client", group: "Clients and billing" },
  { key: "kpi_scorecards", label: "KPI scorecards", hint: "Performance scores for every person", group: "Time and people" },
  { key: "kpi_custom_weights", label: "Custom KPI weights", hint: "Set how much each part of the score counts", group: "Time and people" },
  { key: "attendance", label: "Attendance and away tracking", hint: "In and out times, office or remote, the away question", group: "Time and people" },
  { key: "attendance_reports", label: "Attendance and capacity reports", hint: "Monthly attendance, leave, workload against capacity", group: "Time and people" },
  { key: "inbox", label: "Firm email inbox", hint: "Firm mailboxes inside Duesk", group: "Communication" },
  { key: "morning_digest", label: "Morning summary email", hint: "Daily figures and deadlines for administrators", group: "Communication" },
  { key: "must_acknowledge", label: "Must-acknowledge announcements", hint: "Pinned until read, with reminders and an export", group: "Communication" },
  { key: "branches", label: "Branches", hint: "Several offices, with their own GSTIN and numbering if needed", group: "Control and scale" },
  { key: "custom_roles", label: "Custom roles", hint: "Your own roles, with what they can see and do", group: "Control and scale" },
];

export const FEATURE_LABEL: Record<string, string> = Object.fromEntries(FEATURES.map((f) => [f.key, f.label]));

/** True when the firm's plan (or an extra the owner gave it) includes the feature. */
export function hasFeature(user: { features?: Record<string, boolean>; isPlatformHome?: boolean } | null | undefined, key: string): boolean {
  if (!user) return false;
  if (user.isPlatformHome) return true;
  return !!user.features?.[key];
}
