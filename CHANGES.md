# Batches 5, 6 and 7 (one zip): remaining findings, UX pass, automated tests

This batch picks up where batch 4 ended. It has one migration (049).

## Batch 5: remaining Medium and Low findings

**Build health**
- **Fonts:** Inter and Barlow Condensed are served from the repo (`src/fonts`, `next/font/local`). The build no longer needs fonts.googleapis.com, and pages no longer load fonts from Google.
- **Dependencies:** `npm audit --omit=dev` finds 0 problems in what runs on the site. The 15 findings that remain are all in lint tools on your computer; the only fix offered downgrades the Next lint config to version 14, so it's left alone.
- **P-01:** `npm ci` works on Linux and Vercel again. The two missing `@emnapi` packages were added to the lockfile, and no existing version changed.
- **P-02:** `npm run lint` works on Next 16 and ends with **0 errors** (batch 4 had 515 errors, 87 warnings). Real problems were fixed: 72 unescaped quote marks, 17 unused imports, a component rebuilt on every keystroke, one statement and one link. Existing `any` types and React Compiler advice are now warnings (490 left) to be cleaned up over time.
- **P-04:** one copy each of the UUID/email patterns, money and date formatters, the ordinal helper and the WhatsApp number helper. Three unused files were deleted, and `finetax:` browser keys were renamed to `duesk:`.

**Security**
- **S-08:** `/welcome` can't change your password if you signed in with one.
- **S-14:** mail servers are connected to by the address that was checked, so a DNS trick can't reach a private address.
- **S-15:** the security policy no longer allows inline scripts. Each page load gets a fresh nonce that only Next's own scripts carry. This was tested in Chrome against a production build: no script was blocked.
- **S-16:** the email webhook secret is accepted only in the `x-webhook-secret` header.
- **S-17:** `/api/invoices` needs the Invoices module and copies only known fields.
- **S-19:** `chat_can_access` answers only about yourself.
- **S-20:** "Run check now" runs reminders for your own firm only.
- **S-23:** legacy `zz_legacy_*` tables are read-only (admins only). Email attachments can only be deleted by an admin.
- **D-04:** trigger functions are no longer callable by visitors or signed-in users.

**Bugs and gaps**
- **B-07:** the "expired" screen no longer mentions a trial.
- **B-12:** the six missing tour targets now exist, so the invoices "Click Overdue" step works.
- **B-13:** a background Duesk tab no longer pauses your timer.
- **B-14:** "Notify client" starts off in the reviewer queue. Quality analytics count approvals by approval date.
- **B-15:** mailbox sync uses a database claim instead of a memory lock, with a shorter timeout.
- **B-18:** default SAC code in Settings, a SAC field per invoice line, and a SAC column on tax invoices. One GST rate per invoice stays.
- **B-19:** "1st/2nd/3rd" instead of "1th/2th/3th".
- **B-20:** quotation dates use India time.
- **B-21:** the support inbox shows the firm with each ticket number.
- **B-23:** the acceptance page no longer claims an email was sent.
- **B-26:** client merge and category rename no longer lock invoices, quotations and tasks for every firm.
- **B-27:** recurring tasks keep their day (31 Jan → 28 Feb → 31 Mar). A one-off deadline extension isn't carried forward. Task type and estimate are copied.
- **B-28:** late fees aren't charged on earlier late fees. Quarterly, half-yearly and yearly bills charge the monthly rate for each month since the last charge.
- **D-02:** any `discussions."clientId"` value is copied into `client_id` where that was empty. The conflicting foreign keys had already been aligned in 039.
- **Your question:** the Inbox attachment search now finds any invoice (by number or client), quotation or document, not just the latest 200.

## Batch 6: UX pass across every page

- Screen text in sentence case: 187 pieces of page text, 82 titles and labels, and the sidebar. Brand names, examples and form values are untouched.
- No exclamation marks in messages.
- The five browser pop-ups (chat leave/archive/delete, owner suspend/cancel) are now in-app confirmations.
- Dialogs move focus inside when they open, give it back when they close, stop the page behind from scrolling, and are announced by their title. Escape closes confirmations too.
- Two icon-only buttons got names for screen readers. Two more dates now show as DD/MM/YYYY.

## Batch 7: automated tests (`tests/`, see `tests/README.md`)

- **SQL (`tests/sql`):** 16 two-firm isolation checks. They run on a scratch local database built from a structure-only dump of the live one. The tables are read from the database, so new tables are covered automatically.
- **Browser (`tests/e2e`, Playwright):** 6 checks need no account (security policy and nonce, headers, sign-in redirects, API refusals). 6 read-only checks need a test firm's admin login: every main page opens with no blocked scripts, the dashboard, tasks, time entry, the inbox search and dialogs.

## Not in this batch

- **B-22 (saving attachments of incoming mail):** needs a new private storage bucket with its own access rules and a download view in the Inbox. That's a feature of its own; I'd rather do it carefully than squeeze it in.
- **S-09 (audit entries written by the browser can be skipped):** moving them into the database is a larger change. Forging was already blocked.
- **Admins approving their own work (part of B-27):** this is a policy choice for you. Today an admin can approve a task where they are the assignee. Tell me if that should be blocked.
- **Several GST rates on one invoice (part of B-18):** each invoice still has one rate.


## Checks run here

- **Migrations:** 041–049 applied twice on a copy of the live schema. All test suites still pass: batch 2 (51 checks), batch 3 (32), batch 4 + 5 (39) and the new isolation suite (16). The 049 undo restores all seven functions exactly (matching fingerprints) and every trigger.
- **SQL tests:** run from a fresh `pg_dump --schema-only`, the way the README describes.
- **Type check and build:** `npx tsc --noEmit` has no errors. `npm run build` passes without any Google Fonts access.
- **Lint:** `npm run lint` gives 0 errors, 490 warnings.
- **Install:** `npm ci` succeeds in an empty folder on Linux.
- **Browser:** the 6 public Playwright checks pass in Chrome against a production build. The signed-in checks need a real account and haven't run yet.
- **Clean copy:** the zip, extracted over a clean copy of batch 4, gives the same files, type-checks and builds.

## Files

| File | Change | Why |
|---|---|---|
| `src/app/api/admin/firm-settings/route.ts` | MODIFIED | Saves and checks the default SAC code (B-18). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/admin/manage-user/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/admin/update-member/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/auth/signup/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/billing/run/route.ts` | MODIFIED | Uses the shared India-date helper. Shared money/date/ordinal helpers from `src/lib/format.ts` (P-04). |
| `src/app/api/billing/send/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/email-accounts/ownership/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/email-accounts/test/route.ts` | MODIFIED | Connects to the checked IP address, with the host name for TLS (S-14). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/engagement/[token]/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/invoices/route.ts` | MODIFIED | Needs the Invoices module and copies only the fields the Invoices page sends (S-17). |
| `src/app/api/invoices/send/route.ts` | MODIFIED | Shared money/date/ordinal helpers from `src/lib/format.ts` (P-04). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/owner/firms/[id]/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/owner/firms/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/proposals/link/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/proposals/send/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/quotations/route.ts` | MODIFIED | Default quotation date is today in India, not UTC (B-20). Shared money/date/ordinal helpers from `src/lib/format.ts` (P-04). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/quotations/send/route.ts` | MODIFIED | Plain success message. Shared money/date/ordinal helpers from `src/lib/format.ts` (P-04). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/send-email/route.ts` | MODIFIED | No exclamation mark in the success message. UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/support/agent/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/support/message/route.ts` | MODIFIED | No exclamation mark in the support bot reply. UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/support/ticket/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/sync-emails/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/api/webhooks/incoming-emails/route.ts` | MODIFIED | Secret accepted only in the `x-webhook-secret` header, not the URL (S-16). |
| `src/app/audit-page/page.tsx` | MODIFIED | Sentence-case screen text (UX). |
| `src/app/calendar/page.tsx` | MODIFIED | Tour target for the month grid (B-12). Unused constant removed. Sentence-case screen text (UX). Quote marks in page text escaped, a lint error (P-02). |
| `src/app/chat/page.tsx` | MODIFIED | In-app confirmation instead of the browser pop-up when leaving or archiving a channel. Sentence-case screen text (UX). Quote marks in page text escaped, a lint error (P-02). |
| `src/app/client-discussions/page.tsx` | MODIFIED | Unused import removed. Sentence-case screen text (UX). Quote marks in page text escaped, a lint error (P-02). |
| `src/app/clients/page.tsx` | MODIFIED | Export file name uses the local date. Unused imports removed. Sentence-case screen text (UX). Quote marks in page text escaped, a lint error (P-02). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/documents/page.tsx` | MODIFIED | Tour target for the upload button (B-12). Sentence-case screen text (UX). Quote marks in page text escaped, a lint error (P-02). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/engagement/[token]/AcceptForm.tsx` | MODIFIED | Quote marks in page text escaped, a lint error (P-02). |
| `src/app/engagement/[token]/page.tsx` | MODIFIED | After acceptance, no longer claims an email was sent when it may not have been (B-23). "Billed on the 1st", not "1th" (B-19). Sentence-case screen text (UX). Shared money/date/ordinal helpers from `src/lib/format.ts` (P-04). Quote marks in page text escaped, a lint error (P-02). |
| `src/app/forgot-password/page.tsx` | MODIFIED | Quote marks in page text escaped, a lint error (P-02). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/help/page.tsx` | MODIFIED | Sentence-case screen text (UX). |
| `src/app/inbox/page.tsx` | MODIFIED | Attachment search looks through all invoices, quotations and documents, not just the latest 200. Two icon buttons named for screen readers. Sentence-case screen text (UX). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/invoices/[id]/pdf/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/invoices/page.tsx` | MODIFIED | Optional SAC code on each line, prefilled from the firm default (B-18). Tour target for the status tabs (B-12). Sentence-case screen text (UX). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/layout.tsx` | MODIFIED | Inter served from the repo (`next/font/local`). "Expired" firm screen no longer talks about a trial (B-07). |
| `src/app/leads/page.tsx` | MODIFIED | Tour target for the new-lead button (B-12). Unused imports removed. Sentence-case screen text (UX). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/owner/page.tsx` | MODIFIED | In-app confirmation instead of the browser pop-up when suspending or cancelling a firm. Sentence-case screen text (UX). Quote marks in page text escaped, a lint error (P-02). |
| `src/app/packages/page.tsx` | MODIFIED | "Bills on the 1st", not "1th" (B-19). Sentence-case screen text (UX). Shared money/date/ordinal helpers from `src/lib/format.ts` (P-04). Quote marks in page text escaped, a lint error (P-02). |
| `src/app/page.tsx` | MODIFIED | Tour target for team capacity (B-12). Plain empty-state text. Sentence-case screen text (UX). |
| `src/app/performance/page.tsx` | MODIFIED | Tour target for scorecards (B-12). Simplified quarter start date (same result). Unused import removed. Sentence-case screen text (UX). |
| `src/app/plan/page.tsx` | MODIFIED | Quote marks in page text escaped, a lint error (P-02). |
| `src/app/proposals/[id]/pdf/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/quotations/[id]/pdf/route.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/quotations/page.tsx` | MODIFIED | Unused imports removed. Sentence-case screen text (UX). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/reset-password/page.tsx` | MODIFIED | Sentence-case screen text (UX). |
| `src/app/reviewer-queue/page.tsx` | MODIFIED | "Notify client" starts off; quality analytics count approvals by approval date (B-14). Sentence-case screen text (UX). |
| `src/app/settings/page.tsx` | MODIFIED | Default SAC code field (B-18). Sentence-case screen text (UX). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/setup/page.tsx` | MODIFIED | Barlow Condensed served from the repo. Sample invoice date in DD/MM/YYYY. A link uses `<Link>` (lint). Quote marks in page text escaped, a lint error (P-02). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/signup/page.tsx` | MODIFIED | Quote marks in page text escaped, a lint error (P-02). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/support/page.tsx` | MODIFIED | Central support inbox shows the firm with each ticket number, since numbers restart per firm (B-21). |
| `src/app/tasks/page.tsx` | MODIFIED | Shared `ordinal` helper. Sentence-case screen text (UX). Quote marks in page text escaped, a lint error (P-02). |
| `src/app/team/page.tsx` | MODIFIED | Unused import removed. Quote marks in page text escaped, a lint error (P-02). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/app/time-tracking/page.tsx` | MODIFIED | Browser event renamed from `finetax:` to `duesk:` (P-04). Sentence-case screen text (UX). |
| `src/app/welcome/page.tsx` | MODIFIED | If you signed in with your password, this page no longer lets you set a new one without the old one (S-08). |
| `src/components/EmailModal.tsx` | DELETED | not used anywhere (P-04). |
| `src/components/chat/ChatConversation.tsx` | MODIFIED | No exclamation mark. |
| `src/components/chat/ChatMessageView.tsx` | MODIFIED | In-app confirmation before deleting a message. |
| `src/components/help/HelpCenter.tsx` | MODIFIED | Ticket dates in DD/MM/YYYY; no exclamation marks. Sentence-case screen text (UX). Quote marks in page text escaped, a lint error (P-02). |
| `src/components/help/KnowledgeBaseManager.tsx` | MODIFIED | Sentence-case screen text (UX). Quote marks in page text escaped, a lint error (P-02). |
| `src/components/layout/Sidebar.tsx` | MODIFIED | Sentence-case screen text (UX). |
| `src/components/layout/navConfig.ts` | MODIFIED | Sidebar names in sentence case. Sentence-case screen text (UX). |
| `src/components/notifications/AnnouncementsPanel.tsx` | MODIFIED | Quote marks in page text escaped, a lint error (P-02). |
| `src/components/notifications/ImportantNotifications.tsx` | MODIFIED | Quote marks in page text escaped, a lint error (P-02). |
| `src/components/onboarding/TourRunner.tsx` | MODIFIED | An expression used as a statement rewritten (lint). |
| `src/components/packages/EngagementSettings.tsx` | MODIFIED | Sentence-case screen text (UX). |
| `src/components/packages/Proposals.tsx` | MODIFIED | Quote marks in page text escaped, a lint error (P-02). Shared `toWhatsAppNumber` instead of a local copy (P-04). |
| `src/components/packages/SubscriptionBilling.tsx` | MODIFIED | Quote marks in page text escaped, a lint error (P-02). Shared `toWhatsAppNumber` instead of a local copy (P-04). |
| `src/components/tasks/ReminderSettings.tsx` | MODIFIED | Checkboxes are no longer rebuilt on every keystroke (a component defined inside a component). Sentence-case screen text (UX). Quote marks in page text escaped, a lint error (P-02). |
| `src/components/tasks/TaskCategories.tsx` | MODIFIED | Sentence-case screen text (UX). Quote marks in page text escaped, a lint error (P-02). |
| `src/components/tasks/TaskTransfer.tsx` | MODIFIED | Quote marks in page text escaped, a lint error (P-02). |
| `src/components/tasks/WorkQueue.tsx` | MODIFIED | Sentence-case screen text (UX). |
| `src/components/time/AttendancePanel.tsx` | MODIFIED | Sentence-case screen text (UX). Quote marks in page text escaped, a lint error (P-02). |
| `src/components/time/WorkSession.tsx` | MODIFIED | Activity is shared between your open Duesk tabs, so a background tab doesn't pause the timer while you work in another (B-13). Storage keys renamed from `finetax:` to `duesk:`. Quote marks in page text escaped, a lint error (P-02). |
| `src/components/ui/Modal.tsx` | MODIFIED | Dialogs move focus inside when they open, return it when they close, stop the page behind from scrolling, and are labelled by their title. Escape works on confirmations too. |
| `src/fonts/OFL-BarlowCondensed.txt` | NEW | Font licence (SIL Open Font License). |
| `src/fonts/OFL-Inter.txt` | NEW | Font licence (SIL Open Font License; free to bundle). |
| `src/fonts/barlow-condensed-latin-700.woff2` | NEW | Barlow Condensed bold, used for the setup wizard stamp. |
| `src/fonts/inter-latin-variable.woff2` | NEW | Inter (latin, variable weight), so builds never call fonts.googleapis.com. |
| `src/lib/auth/permissions.ts` | DELETED | not used anywhere (P-04). |
| `src/lib/billing/invoiceMailer.ts` | MODIFIED | Shared India-date and money helpers. Shared money/date/ordinal helpers from `src/lib/format.ts` (P-04). |
| `src/lib/csp.ts` | NEW | The page security policy, built per request with a nonce (S-15). |
| `src/lib/email/mailHost.ts` | MODIFIED | Returns the checked address so callers connect to it, closing the DNS-rebinding gap (S-14). |
| `src/lib/email/mailer.ts` | MODIFIED | SMTP connects to the checked address with the host name for TLS (S-14). UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/lib/email/syncMailbox.ts` | MODIFIED | IMAP connects to the checked address (S-14). A database claim replaces the in-memory lock, so two server instances never sync one mailbox at once; socket timeout 25 s, under the 60 s limit (B-15). |
| `src/lib/format.ts` | MODIFIED | New shared helpers: `istDate` (India date on the server), `rupees`, `formatINRExact`, `ordinal`; `formatDate` takes an empty-value text. Shared money/date/ordinal helpers from `src/lib/format.ts` (P-04). |
| `src/lib/intelligence.ts` | DELETED | not used anywhere, and it read a column that no longer exists (P-04). |
| `src/lib/onboarding/tours.ts` | MODIFIED | Sentence-case screen text (UX). |
| `src/lib/pdf/engagementLetter.tsx` | MODIFIED | Shared money/date/ordinal helpers from `src/lib/format.ts` (P-04). Quote marks in page text escaped, a lint error (P-02). |
| `src/lib/pdf/firmDocuments.tsx` | MODIFIED | Tax invoices show a SAC column; a line without its own code uses the firm default (B-18). |
| `src/lib/publicLinks.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/lib/storage/vaultPath.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/lib/team/members.ts` | MODIFIED | UUID/email patterns from `src/lib/validate.ts` (P-04). |
| `src/lib/validate.ts` | NEW | One copy of the UUID and email patterns (P-04). |
| `src/proxy.ts` | MODIFIED | Sets the security policy per request with a fresh nonce; scripts need it to run, so `'unsafe-inline'` is gone for scripts (S-15). |
| `supabase/migrations/049_findings_cleanup.sql` | NEW | Database fixes: S-19, S-20, S-23, D-02, D-04, B-15, B-18, B-26, B-27, B-28 (details above). Safe to re-run. |
| `supabase/undo/049_findings_cleanup_undo.sql` | NEW | Puts back every function, trigger and policy 049 changed. Keeps the two new columns and copied data. |
| `.gitignore` | MODIFIED | Ignores Playwright output folders. |
| `APPLY.md` | MODIFIED | How to apply this batch. |
| `CHANGES.md` | MODIFIED | This file. |
| `eslint.config.mjs` | MODIFIED | Makes `npm run lint` usable (P-02): full-page reloads allowed on purpose; existing `any` and React Compiler advice shown as warnings; PDF files exempt from two rules that don't apply to them. |
| `next.config.mjs` | MODIFIED | The page security policy moved to `src/proxy.ts` (S-15). API responses get `default-src 'none'`. |
| `package-lock.json` | MODIFIED | Adds the two `@emnapi` packages a Linux `npm ci` needs (P-01) and Playwright. No existing version changed. |
| `package.json` | MODIFIED | `lint` runs ESLint directly (Next 16 removed `next lint`, P-02); new `test:e2e`; `@playwright/test` added as a development-only dependency (approved). |
| `tests/README.md` | NEW | How to run both kinds of tests on Windows. |
| `tests/e2e/helpers.ts` | NEW | Sign-in and error-collecting helpers. |
| `tests/e2e/public.spec.ts` | NEW | 6 checks needing no account. |
| `tests/e2e/signed-in.spec.ts` | NEW | 6 read-only checks for a test firm's admin. |
| `tests/playwright.config.ts` | NEW | Playwright settings. |
| `tests/sql/00_supabase_stubs.sql` | NEW | Stand-ins for Supabase-only parts, so a schema dump loads into plain PostgreSQL. |
| `tests/sql/01_two_firms.sql` | NEW | Two test firms with the same kinds of rows. |
| `tests/sql/10_isolation.sql` | NEW | 16 isolation checks over every firm table. |
| `tests/sql/run.ps1` | NEW | Runs the SQL checks on Windows. |
| `tests/sql/run.sh` | NEW | Runs the SQL checks on Mac/Linux. |
