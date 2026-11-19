# Batch 11: pictures, plan controls, branches, roles, attendance, escalations

Four migrations (055 to 058), each with an undo script. No new packages, no new paid services, no new environment variables. Batch 10 must be applied first.

## What changes for users

### Pictures and branding
- **Profile photos.** Everyone can add a photo from the menu under their name (top right). Photos show in the sidebar, Team, Tasks, Chat, Performance, Time tracking and the review queue. People without a photo get coloured initials.
- **Firm logo and colour.** Settings → Logo and brand colour. The logo shows in the sidebar, on invoice, quotation and receipt PDFs, in the client portal and in the morning email. The colour tints the PDF header.
- **Job titles** (designation) show under each person's name in the top bar and on Team, as before.

### Plans, controlled from the owner dashboard
- **Owner console → Plans:**
  - **What each plan includes:** turn each feature on or off per plan, and set storage, audit history and portal client limits.
  - **Extras for one firm:** give one firm a feature its plan lacks (or take one away), with an optional end date and a note.
  - **Requests:** what firms have asked for. Mark them done or declined.
- **For firms:**
  - A feature not in their plan shows a lock in the menu. The page explains what it does, and admins can **Request this feature** in one click.
  - The **Plan** page lists what is included, what is locked and storage used.
- **Enforced in the database too,** not just hidden:
  - review by a second person, enquiries and packages, rates, custom KPI weights, the portal, email attachments, the morning email
  - storage limit on uploads
- **Firms already on Duesk keep everything they use today.** It is added as extras you can see and remove per firm. Features new in this batch follow the plan.

### Branches
- **New page: Branches and roles** (Administration). Every firm has a Head office. Add branches with address, working hours and office internet address.
- **Billing, either way per branch:**
  - **Shared:** the branch bills under the firm's GSTIN and numbering.
  - **Separate:** the branch has its own GSTIN and its own invoice numbering (for example PV/2026-27/0001). The PDF then shows the branch's address and GSTIN.
- **A client belongs to a branch,** and its invoices follow it. An issued invoice keeps its branch.
- **Branch announcements and holidays** can be for one branch only.

### Firm roles
- **Make roles** such as Article, Senior or Branch manager. Each role sets:
  1. **Sees:** own work only, their branch, or the whole firm. Enforced by the database: someone with "own work" cannot open other people's clients, tasks, invoices, time or documents, even by link.
  2. **Sections** in the menu.
  3. **Can:** review work, approve time and leave, see attendance and capacity, see fees and profitability (Practice insights, read-only), export data.
- **Team management** has Branch and Role for each person and shows them as chips. Changing a role updates everyone who has it.

### Attendance (the "away question")
- **Days work themselves out.** First and last activity, active minutes, and in office or remote (from the branch's office internet address; recorded only, never blocks). **Start my day** and **End my day** are optional.
- **Away question:**
  - After **15 minutes** with no activity, the timer pauses. On return, Duesk asks: Tally or Excel, a government portal, a call or meeting, other office work, or a break.
  - Work is counted as "away for work". Closing the question counts as "not answered".
  - Nothing on screen is recorded.
- **Away for work above 2 hours a day** goes for approval. Admins, or roles that can approve time for that person, are notified.
- **Leave:**
  - Apply, cancel, approve or reject. Approvers are notified, and so is the person when it is decided.
  - Half days. Types: casual, sick, earned, unpaid.
- **Holidays,** for every branch or one.
- **Rules (admins):**
  - quiet time before the question
  - daily limit before approval
  - grace before someone counts as late
- **Reports:**
  - **Team report:** present, leave, absent, late, left early, office or remote, active and away hours, and the share of away time. Download as CSV.
  - **Workload:** open work for the next 7, 14 or 30 days against each person's hours, after holidays and leave.
  - The same workload line appears when you assign a task.

### Announcements
- **Must read:** pinned above every page until the person clicks "I've read this".
- **Reminders** to those who haven't read it: every 4 hours, daily or every 3 days.
- **Who has read it,** with the time and branch, "Remind those who haven't read" and **Export**.
- **For one branch only,** when the firm has branches.

### Escalation levels
Under Tasks → Reminders & escalations:
- **Level 1:** the person doing the work (as before).
- **Level 2:** overdue by N days. The reviewer and whoever assigned it are told.
- **Level 3:** overdue longer, or the statutory date within N days and not submitted. The task goes on the **partners' daily list**, sent once a day at a chosen time and shown on the Dashboard as **Needs a partner**.

The existing reminder schedule runs this; nothing new to schedule.

### Help
Four new guides: attendance, attendance reports, branches and roles, must-read announcements and escalations.

## Files

### NEW
| File | Why |
|---|---|
| `supabase/migrations/055_branding_and_plans.sql` | Photos, logo, plan switches and limits, firm extras (keeping what firms use today), upgrade requests, plan checks in the database |
| `supabase/migrations/056_branches_and_roles.sql` | Branches with shared or separate GSTIN and numbering, firm roles, what each person sees, role rights, branch checks |
| `supabase/migrations/057_attendance_and_capacity.sql` | Away answers, approval over the daily limit, leave, holidays, office or remote, attendance and workload reports |
| `supabase/migrations/058_escalations_and_announcements.sql` | Escalation levels, partners' list, must-read announcements, read list, reminders |
| `supabase/undo/055_…_undo.sql` to `058_…_undo.sql` | Undo for each |
| `src/app/organisation/page.tsx` | Branches and roles page |
| `src/app/attendance/page.tsx` | Attendance: my days, team report, workload, approvals, holidays and rules |
| `src/app/api/attendance/ping/route.ts` | Marks today in office or remote; the address itself is never stored |
| `src/app/api/profile/avatar/route.ts`, `src/app/api/admin/logo/route.ts` | Photo and logo upload |
| `src/app/api/owner/plans/route.ts`, `overrides/route.ts`, `upgrade-requests/route.ts` | Owner plan controls |
| `src/components/owner/PlansEditor.tsx` | Plans, extras and requests on the owner console |
| `src/components/plan/FeatureGate.tsx`, `PlanFeatures.tsx` | Locked pages, "Ask for it", the plan matrix |
| `src/components/ui/Avatar.tsx`, `ImagePicker.tsx` | Photos and initials, picture upload |
| `src/components/settings/BrandSettings.tsx` | Logo and colour |
| `src/components/notifications/MustReadBanner.tsx` | Pinned must-read bar |
| `src/components/tasks/EscalationList.tsx` | "Needs a partner" on the Dashboard |
| `src/components/attendance/CapacityHint.tsx` | Workload line under the assignee |
| `src/lib/features.ts`, `src/lib/api/features.ts` | Feature list and checks |
| `src/lib/branding/images.ts` | Picture checks and storage |
| `src/lib/pdf/seller.ts` | Branch address and GSTIN on invoices |
| `src/lib/team/modules.ts` | Section list shared by Team and Roles |
| `src/lib/csv.ts` | CSV download |

### MODIFIED
| File | Why |
|---|---|
| `src/app/layout.tsx` | Loads plan features, photo, logo and role rights |
| `src/components/layout/navConfig.ts`, `Sidebar.tsx`, `Topbar.tsx`, `AppShell.tsx` | Locks, new menu items, photos, logo, must-read bar, new notification types |
| `src/components/time/WorkSession.tsx` | Away question, 15-minute quiet time from settings, office check |
| `src/components/notifications/AnnouncementsPanel.tsx`, `ImportantNotifications.tsx` | Must read, reminders, branch, read list and export |
| `src/components/tasks/ReminderSettings.tsx` | Escalation levels |
| `src/app/page.tsx` | Partners' list on the Dashboard |
| `src/app/team/page.tsx`, `src/app/api/admin/update-member/route.ts` | Branch and role per person, chips |
| `src/app/tasks/page.tsx` | Review and bulk actions follow the plan; workload line |
| `src/app/insights/page.tsx` | Open read-only to roles that may see profitability |
| `src/app/plan/page.tsx`, `src/app/owner/page.tsx`, `src/app/settings/page.tsx` | Plan matrix, plan controls, branding |
| `src/app/clients`, `inbox`, `leads`, `packages`, `performance`, `reviewer-queue` pages | Follow the plan |
| `src/app/chat/page.tsx`, `time-tracking/page.tsx`, `src/components/chat/ChatMessageView.tsx` | Photos |
| Invoice PDF and email routes, `invoiceMailer.ts`, `firmDocuments.tsx` | Branch seller details, logo |
| `src/app/portal/page.tsx`, `src/lib/portal/session.ts`, portal invite and login routes | Logo, and the portal follows the plan |
| `src/lib/billing/morningDigest.ts`, `src/lib/email/attachments.ts` | Follow the plan |
| `src/lib/help/articles.ts` | Four new guides |
| `tests/sql/01_two_firms.sql`, `tests/sql/10_isolation.sql` | Batch 11 data in both test firms; checks C1 to C8 |
| `tests/e2e/signed-in.spec.ts` | New pages, and attendance and branch tabs |

### DELETED
None.

## Checked here
- `npx tsc --noEmit`, `npm run build` and lint: no errors.
- Database suites against a copy of the schema with 041 to 058:
  - 51, 32 and 39 checks pass.
  - The isolation suite passes, including the new C1 to C8: no firm sees, approves or points at another firm's branches, roles, time or leave.
- Each migration was run twice, and the undo scripts were run 058 → 055 and the migrations again, on a copy of the database.
- Playwright: 15 passed, 1 skipped (needs a mailbox).
- Away question tested in a browser with the clock moved forward.
