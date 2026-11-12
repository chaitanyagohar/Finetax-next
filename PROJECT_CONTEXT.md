# DUESK (formerly "Finetax Manager") — PROJECT CONTEXT
Last updated: 03 Nov 2026, 01:40 IST. Paste this at the start of a new chat, together with the project zip.

## 0. How to use this document (for Claude)
- The ZIP of the repo is the source of truth for CODE. The live Supabase database is the source of truth for SCHEMA (early multi-tenancy migrations were run in the SQL editor and NOT saved as files). When this document and the zip disagree, trust the zip, then ask.
- Before editing any file, read it from the zip. Before changing any SQL function, ask the user for `select pg_get_functiondef('public.<name>'::regproc);` unless it is quoted below.
- Section 12 lists work done in the 02–03 Nov session whose deployment is NOT yet confirmed. Verify first (section 12 has grep checks).
- The user is on Windows PowerShell: give `Select-String` commands, not `git grep` with quotes (PowerShell mangles quotes for git).

## 1. Who / what
- Owner/developer: Subhash. His CA firm: "M/S KUMAR SUBHASH & ASSOCIATES", NG-11 Ground Floor, Jwalaheri Market, Paschim Vihar, New Delhi-110063; GSTIN 07AQMPK4640C1Z0; PAN AQMPK4640C. In the app this firm is org slug `finetax`.
- Product: **Duesk** — practice-management SaaS for Indian CA firms (tasks/compliance, clients, leads, quotations, invoices, packages & recurring billing, engagement letters with online acceptance, time tracking, KPIs, inbox, documents, calendar, team chat, help/support). Company/brand owner: **Oddlambda**. Finetax (Subhash's firm) = customer #1.
- Production: https://finetax-next.vercel.app (Vercel). ONE Supabase project ("Practice Manager Finetax") shared by Preview and Production, so all testing hits the live DB.
- Local: C:\Users\Chait\Downloads\practice-manager-next. GitHub: chaitanyagohar/Finetax-next (branch main). Workflow: edit → `npx tsc --noEmit` (must be 0 errors; Next build only shows the FIRST error) → `npm run build` → commit/push → Vercel deploys. SQL runs in the Supabase SQL Editor.
- If tsc shows errors from `.next/types/...` about deleted routes: `Remove-Item -Recurse -Force .next` then re-run.

## 2. Stack
Next.js 16.4.0 (Turbopack, App Router, `proxy.ts` instead of middleware; /api is excluded from the proxy matcher) · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres, Auth, Storage, Realtime, pg_cron, pg_net, Vault) · @supabase/ssr 0.12 · lucide-react · nodemailer · imapflow · mailparser · @react-pdf/renderer (server-side renderToBuffer) · qrcode.

## 3. Environment variables (Vercel + .env)
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL (= production URL; used by getSiteUrl so links never use preview hosts), INBOUND_EMAIL_WEBHOOK_SECRET (min 32 chars; webhook IS in use), CRON_SECRET (Vercel cron + Supabase email-sync job; same value in Supabase Vault as secret 'cron_secret'), PUBLIC_LINK_SECRET (REQUIRED, min 32 chars; signs public engagement links — no fallback any more).
Optional new: NEXT_PUBLIC_DUESK_CONTACT_EMAIL (shown on the "trial ended / suspended" lock screen).
Not used: ANTHROPIC_API_KEY (no paid AI). Razorpay keys pending (section 10).

## 4. Working rules / preferences (important)
- Give complete files or exact find/replace edits with UNIQUE anchors, and always name the file. (Edits have landed in the wrong file before when two files share lines.) If a line is identical in two files, say "apply in BOTH files X and Y".
- Never put a template literal inside inline code in chat; nested backticks get stripped and break the file (happened 03 Nov). Always use fenced code blocks; prefer `+` string joins over nested backticks.
- After code, give a short "Deploy and test" list. Plain, simple explanations. User is a CA, technically capable but not a full-time developer.
- Every SQL change = a numbered file in `supabase/migrations/NNN_name.sql` saved BEFORE running. Wrap in begin/commit. Take a Supabase backup before any migration that changes or moves DATA.
- Default privileges were changed in migration 030: new functions are NOT executable by public/anon. Any new function the app calls via RPC as a logged-in user needs `grant execute on function public.fn(args) to authenticated;`. Service-only functions: `revoke ... from public, anon, authenticated; grant ... to service_role;`.
- The Supabase SQL editor only shows the result of ONE statement when several are run; ask for diagnostic queries one at a time.
- Don't pick paid third-party services (AI APIs, WhatsApp Business API, etc.) without asking. Prefers free/no-AI; if AI is ever needed, Gemini with Cloud Billing.
- GST correctness matters: continuous invoice series per firm, cancel not delete, late fee carries GST, place of supply.
- Times IST; dates DD/MM/YYYY.

## 5. Multi-tenancy architecture (built Oct–Nov 2026)

### 5.1 Core tables (no org_id; platform level)
- `organizations` (id, name, slug UNIQUE, status, plan, trial_ends_at, created_by, created_at, updated_at). status ∈ trial | active | suspended | cancelled | expired (constraint `organizations_status_check`, migration 031).
  Current rows: `finetax` (M/S KUMAR SUBHASH & ASSOCIATES, active, standard) · `oddlambda` (Duesk staff workspace, active, internal; cannot be suspended) · `sharma-and-associates` (TEST firm, trial; used to test expiry/lock).
- `memberships` (PK org_id+user_id; role admin|staff|reviewer, is_reviewer, is_support_agent, module_access jsonb (null → default ["leads","tasks","time_tracking"]), designation, is_active, invited_by, joined_at, updated_at). Role/modules live HERE, per firm (profiles.role etc. are legacy).
- `user_active_org` (user_id PK, org_id, updated_at) — the firm a user is currently working in.
- `profiles` (global per login: name, email UNIQUE, is_active, legacy role/module fields).
- `platform_admins` (user_id) — Duesk support staff. `platform_config` (single row, id boolean true; support_org_id = Oddlambda org whose mailbox sends support emails; legacy_org_id = Finetax, owner of pre-multi-tenancy storage folders).
- `rate_limits`, `support_kb`, `support_answer_stats` — global by design.
- `zz_legacy_counters`, `zz_legacy_email_queue`, `zz_legacy_roles`, `zz_legacy_settings` — old tables, RLS on, no policies. Drop later after a backup.

### 5.2 Firm tables (all have org_id uuid NOT NULL default default_org_id())
announcement_acks, announcements, audit_logs, chat_channels, chat_members, chat_messages, client_duplicate_dismissals, client_packages, clients, compliance_events, discussions, document_counters (PK org_id+scope), documents, email_accounts, email_attachments, email_messages, engagement_settings, firm_settings, invoice_payments, invoice_reminders, invoices, kpi_reviews, kpi_settings, late_fee_charges, leads, notifications, package_services, proposals, quotations, reminder_log, reminder_settings, service_packages, support_messages, support_tickets, task_categories, task_transfers, task_types, tasks, time_logs, time_timers, user_activity_days.
- Per-firm unique: invoices(org_id, invoice_number), quotations(org_id, quote_number), proposals(org_id, number), document_counters(org_id, scope), email_accounts(org_id, email_address), email_messages(org_id, message_id), chat_channels(org_id, lower(name)), task_types/task_categories(org_id, lower(trim(name))), one row per org in firm_settings / engagement_settings / kpi_settings / reminder_settings.
- Settings tables are one row PER ORG. Never read them with `.eq("id", 1)`; always `.eq("org_id", ...)`.

### 5.3 RLS
- Every firm table has a RESTRICTIVE policy `org_isolation` (ALL): `org_id = (select current_org_id())`. On support_tickets and support_messages ONLY it is `... OR (select is_platform_admin())` so Duesk support sees all tickets. Older PERMISSIVE policies (is_active_user(), is_admin(), has_module(), RESTRICTIVE module gates) still apply on top.
- The browser (user session) is therefore limited to the CURRENT firm automatically. Server code using the service role key bypasses RLS and MUST filter by org itself.

### 5.4 Org helper functions (all SECURITY DEFINER, search_path public)
- `current_org_id()`: user_active_org row if the user is an active member of an active/trial org; else first active membership (order joined_at). Null if none.
- `default_org_id()`: `current_setting('app.org_id')` if set (via set_org_context), else current_org_id(). Column default for org_id. In cron/service-role code with no context it returns NULL → inserts without explicit org_id FAIL LOUDLY (good). Always pass org_id explicitly in server code.
- `set_org_context(uuid)` (service only): set_config('app.org_id', ..., true) for the transaction. Cron SQL functions call it per firm.
- `my_access()` → jsonb {org_id, org_name, org_slug, org_status, trial_ends_at, role, is_reviewer, is_support_agent (= is_platform_admin()), module_access, designation, is_platform_admin, is_platform_owner} for the current firm (org_status/trial_ends_at added in 031).
- `my_blocked_firm()` (031, authenticated) → {org_name, status, trial_ends_at, is_admin} of the user's firm when locked out, for the lock screen.
- `my_org_ids()`, `home_org_id(user)`, `is_org_member(user, org)`, `org_admin_ids(org)`, `shares_org_with(target)` (both members active, 030), `set_active_org(org)` (firm switcher), `is_admin()`, `is_active_user()`, `has_module(text)`, `is_reviewer`, `can_manage_task`, `is_platform_admin()`, `is_platform_owner()`, `inherit_org_id()` (generic trigger: copies org_id from a parent row; args table, fk column).
- `push_notification(user, type, title, body, link, entity, entity_id, priority)`: uses default_org_id(); silently does nothing if no firm context or the user isn't a member. Skips notifying the actor (auth.uid()).
- Platform: `platform_create_firm(p_name, p_slug, p_admin, p_status, p_trial_days, p_copy_lists, p_created_by)` (creates org, settings rows, #general, Task List copy, membership), `platform_seed_firm`, `platform_add_staff`, `platform_firm_overview()` (usage counts only, no client data), `notify_platform_support(...)`.
- Numbering: `allocate_document_number`, `next_document_number` (service only).
- Storage: `storage_folder_allowed(name)`, `support_file_allowed(folder)`, `chat_can_access_text(folder)`.
- Trials: `expire_trials()` (031, service only): status trial → expired when trial_ends_at + 7 days < now() (never oddlambda).
- Email: trigger `email_accounts_guard_verified` (032).

### 5.5 Server-side code pattern (MUST follow)
- `requireUser()/requireAdmin()/requireModule(...)` return AuthContext with orgId + orgName. Every `getAdminClient()` query filters `.eq("org_id", caller.orgId)`, or derives the org from the record (e.g. `inv.org_id`) after verifying it belongs to the caller.
- Public/no-login code (engagement links, webhooks, cron) takes the org from the record being processed, never from a "current firm".
- Letterhead/bank details on PDFs and emails always come from the DOCUMENT's own firm: `firm_settings ... .eq("org_id", document.org_id)`.
- `sendFirmEmail({ orgId, to, subject, html, text?, attachments?, accountId? })` sends ONLY from that firm's own mailbox (orgId required).

### 5.6 Proxy / layout / workspaces
- `proxy.ts` calls `my_access` RPC. Public paths: /login /forgot-password /auth/confirm /engagement. Admin-only: /team /packages /audit-page /settings /proposals. Module paths: /clients,/leads→leads; /quotations; /client-discussions→discussions; /tasks; /calendar; /time-tracking→time_tracking; /documents; /invoices; /inbox→dashboard. /reviewer-queue reviewers. /support = support agents (platform admins). /owner = platform owner. Users whose current org slug is `oddlambda` (Duesk staff workspace) are kept to PLATFORM_PATHS /owner /support /chat /reset-password and land on /owner (owner) or /support (agent). Recovery cookie `ft_pw_recovery` gates /reset-password.
- `src/app/layout.tsx` builds `SessionUser` {id, name, email, role, designation, isAdmin, isReviewer, isSupportAgent, moduleAccess, orgId, orgName, isPlatformOwner, isPlatformHome}. If the profile is inactive or there's no active firm, it shows a lock screen (031 version: "Free trial has ended" / "Firm account paused" / "Firm account closed" / "Account deactivated", via my_blocked_firm). Firm admins on trial see an amber bottom banner in the last 7 days and the 7-day grace.
- Metadata title: "Duesk", template "%s · Duesk".

### 5.7 Storage buckets
chat-attachments (private; path `<channel_id>/...`), documents + firm-documents (private vault; new uploads go to `<org_id>/<client_id|internal>/<year>/<uuid>-<file>`; storage_folder_allowed accepts the current org folder, client-id folders of own clients, and legacy `client_files`/`internal` only for the legacy org Finetax; 2 orphan legacy files under firm-documents/client_files with no document row), support-attachments (private; `<user_id>/...`), logos (PUBLIC by design).

## 6. Shared code to reuse (signatures)
- `src/lib/api/guard.ts`: AuthContext {userId, email, name, role, isAdmin, isReviewer, isSupportAgent, isPlatformAdmin, isPlatformOwner, moduleAccess, orgId, orgName}; requireUser(), requireAdmin(), requireModule(...ids), requirePlatformAdmin(), requirePlatformOwner(); assertSameOrigin(req); errorResponse(err); ApiError(status,msg); getAdminClient(); getSiteUrl(request); writeAuditLog({entity, entity_id?, action, metadata?, actor?, orgId?}) (system jobs pass orgId).
- `src/lib/api/rateLimit.ts`: `await checkRateLimit(key, max, windowMs)` — ASYNC; always `if (!(await checkRateLimit(...)))` (three closing brackets).
- `src/lib/api/reauth.ts`: verifyCallerPassword(email, password). `src/lib/password` validatePassword.
- `src/lib/email/mailer.ts`: sendFirmEmail (above), escapeHtml, EMAIL_RE, parseRecipients, sanitizeFilename, getAccountPassword(admin, account) (Vault via get_email_account_secret, service only), imapSettingsFor(account), createSmtpTransport(account, pw), MAX_RECIPIENTS 20, MAX_ATTACHMENTS 10, MAX_TOTAL_ATTACHMENT_BYTES 20MB. Outbound mail is also saved to email_messages.
- `src/lib/email/syncMailbox.ts`: syncMailbox(admin, account) → {count, more?, skipped?}; MailboxConnectError. UID-based, first sync 14 days, max 100/run; inserts with account.org_id; sets verified_at on success (032).
- `src/lib/billing/invoiceMailer.ts`: issueAndEmailInvoice(admin, invoiceId, expectOrgId?), sendPaymentReminders(admin, onlyOrgId?) (due_in_2 / due_today / overdue_3; invoice_reminders insert includes org_id).
- `src/lib/pdf/firmDocuments.tsx` (InvoicePdf, QuotationPdf, renderInvoicePdf(inv, client, firm), renderQuotationPdf, pdfFileName), `src/lib/pdf/engagementLetter.tsx` (loadProposalBundle(db, id, orgId?) → {proposal, client, pkg, firm, terms} with firm/terms by proposal.org_id; renderEngagementLetter).
- `src/lib/publicLinks.ts`: proposalToken(id), verifyProposalToken(token), proposalUrl(id) (HMAC with PUBLIC_LINK_SECRET).
- `src/lib/help/supportServer.ts`: contextFor(caller, pagePath), isPlatformSupport(admin, userId), sanitizeAttachments(raw, userId), escalateTicket(admin, ticket, {summary, category?, priority?}, origin) (emails Duesk agents from platform_config.support_org_id's mailbox).
- `src/lib/audit` → logAuditEvent(action, entity, id?, metadata) (client side). `src/lib/format.ts`: localISODate, formatDate, formatINR, compactINR, getInitials.
- `src/components/ui/Modal.tsx`: Modal({title, subtitle, onClose, maxWidth, footer, headerExtra}), ConfirmDialog({title, message, confirmLabel, tone, loading, onConfirm, onCancel}).
- `src/components/ui/ClientPicker.tsx`: default ClientPicker({clients, value, onChange, disabled, noneLabel, includeInactive, className}); clientLabel(c), sortByLabel(list).
- `src/components/layout/UserContext.tsx` → useCurrentUser(): SessionUser (see 5.6; includes orgId, orgName).
- `src/components/tasks/TaskCategories.tsx`: useTaskCategories() {categories, activeNames, colorOf, reload}, CategoryBadge, TaskCategoriesManager (only tasks/calendar/packages pages call the hook).

## 7. Database migrations
- 001–029 as before: RLS, numbering (document_counters), invoice_payments + sync_invoice_paid, PAN/GSTIN checks, maker-checker, time_logs, discussions (001–009); 010 server timers; 011 firm settings validation; 012 Vault email passwords; 013 indexes; 014 documents + packages + onboard_client_package; 015 task_types, periods, client merge; 016 categories, notifications, announcements; 017 estimates, queue, transfers; 018 automatic timer, presence, day review; 019 reminders (run_reminders); 020 KPIs; 021 packages v2, proposals, subscription billing (generate_subscription_bills); 022 public acceptance; 023 schedules from Task List; 024 module gates; 025 email sync columns + pg_net; 026 Razorpay NOT done; 027 support system; 028 no-AI support; 029 team chat.
- Multi-tenancy migrations (organizations, memberships, org_id everywhere, org_isolation, helpers, platform_*): RUN IN SQL EDITOR, FILES NOT SAVED. Schema is in the DB.
- 030_org_hardening.sql (run 02 Nov): onboard_client_package checks client/package/reviewer belong to the current org (internal_onboard already did); revoked anon/public EXECUTE on 12 helpers (can_manage_task, chat_can_access, chat_can_access_text, current_org_id, default_org_id, is_platform_admin, is_platform_owner, is_reviewer, my_org_ids, shares_org_with, storage_folder_allowed, support_file_allowed) and granted to authenticated, service_role; `alter default privileges for role postgres in schema public revoke execute on functions from public/anon`; shares_org_with requires both members active.
- 031_trial_expiry.sql (run 03 Nov): status 'expired' + constraint; expire_trials(); pg_cron job 'duesk-expire-trials' '15 19 * * *' (00:45 IST, job id 6); my_access adds org_status, trial_ends_at; my_blocked_firm().
- 032_email_account_verified.sql (run 03 Nov): email_accounts.verified_at (backfilled for the 2 existing Finetax mailboxes); trigger email_accounts_guard_verified (only server roles can set it; changing the address clears it).
- Next free number: 033.

Scheduled jobs: pg_cron 'finetax-reminders' (*/15 → run_reminders(), loops firm by firm with set_org_context) · pg_cron 'finetax-email-sync' (*/5 → /api/cron/sync-emails via pg_net with Vault secret; syncs every active/trial firm's mailboxes) · pg_cron 'duesk-expire-trials' (daily) · Vercel cron (vercel.json) '30 3 * * *' → GET /api/billing/run (9:00 IST; generate_subscription_bills loops firm by firm).

## 8. Features (where)
- Layout: AppShell (BARE_PATHS /reset-password, /engagement), Sidebar, Topbar (bell + realtime, WorkSession timer bar, HelpLauncher), navConfig.
- Tasks: src/app/tasks/page.tsx (list/board/queue; Task List, Categories, Reminders for admins; TaskTransfer.tsx, WorkQueue.tsx; deep links ?task= ?view=queue ?staff=unassigned; task chat threads).
- Time: WorkSession.tsx (heartbeat, idle 10 min, day review 18:30; browser keys `finetax:day-review:*` and event `finetax:open-day-review` intentionally kept), AttendancePanel.tsx.
- Performance: src/app/performance/page.tsx (kpi_settings).
- Packages: tabs Packages / Proposals & Engagement Letters / Billing (EngagementSettings, Proposals, SubscriptionBilling). API /api/proposals/send, /api/proposals/link, /api/billing/run (GET cron all firms / POST admin, results for own firm), /api/billing/send.
- Public engagement: /engagement/[token] (page, AcceptForm, /pdf), /api/engagement/[token] (accept/decline via accept_proposal_online / decline_proposal_online which set_org_context from the proposal).
- PDFs: /invoices/[id]/pdf, /quotations/[id]/pdf, /proposals/[id]/pdf (route handlers, user session + RLS).
- Email: /api/invoices/send, /api/quotations/send, /api/send-email (compose with invoice/quotation/vault attachments), /api/sync-emails (button), /api/cron/sync-emails, /api/email-accounts/test (SMTP+IMAP test; sets verified_at), /api/webhooks/incoming-emails (IN USE; secret header x-webhook-secret or ?token=; delivers only to mailboxes with verified_at; exact client email match).
- Team: /api/admin/create-user (creates login + profile + membership in caller's firm; fails if the email already has a login), /api/admin/manage-user (set_password / send_reset_link / update_email / delete_user; only for people in the caller's firm; login changes blocked if they're also in another firm; protects last admin). /api/team was DELETED (duplicate).
- Settings: /api/admin/firm-settings (own firm; bank changes need password + alert other admins).
- Support (no AI): lib/help/articles.ts, troubleshooting.ts, troubleshooter.ts, supportServer.ts; API /api/support/message | ticket | feedback | agent (agent = platform admins only); pages /help, /support. Tickets numbered SUP-0001 globally. Agent reply notification works (support_messages_after_insert sets org context).
- Chat (029): /chat, components/chat/*, lib/chat.ts; new members auto-join #general via trigger memberships_join_general (profiles_join_general no longer attached).
- Owner Console: /owner (src/app/owner/page.tsx) + /api/owner/firms (GET overview, POST create firm + first admin) + /api/owner/firms/[id] (PATCH status/plan/extendTrialDays).

## 9. Decisions recorded
- Billing defaults: bill day 5th of next month, drafts approved by admin (auto-send optional per client), late fee 1.5%/month min ₹100 added to next bill with GST, first period pro-rated, due in 5 days, online acceptance + optional signed copy. Existing subscriptions start with billing OFF.
- Invoice numbers assigned on issue, per firm series; never delete issued invoices (cancel). Finetax counter was reset 18 Oct 2026; next = INV/2026-27/0001.
- Trials: banner for the last 7 days + 7-day grace after trial_ends_at, then status 'expired' and a full lock screen (data kept). Reopen with "Extend trial" in the Owner Console (counts from today if already ended), NOT by switching the dropdown to Trial (old date would re-expire it).
- Platform admins see all support tickets (needed for support) but no customer data tables.
- Branding: software = "Duesk"; messages signed with the current firm's name (useCurrentUser().orgName); CSV names without prefix.
- Incoming-email webhook kept; ownership = verified_at.
- Welcome email after acceptance: later. Tally: later, export file first.

## 10. Pending / next (in order)
A. IMMEDIATE (03 Nov):
  1. Both Gmail mailboxes (finetaxindia@gmail.com, casubhashyadav@gmail.com) fail SMTP AND IMAP ("Login rejected") — app passwords invalid. User will create new Gmail App Passwords and use "Update password" in Inbox → Connected Accounts, then Test connection. Until then invoice/reminder/proposal emails and inbox sync FAIL for Finetax.
  2. Verify that section 12's edits are deployed; tsc 0 errors; build; push.
  3. Run the trial tests: Sharma admin sees banner; force lock (`update organizations set trial_ends_at = now() - interval '8 days' where slug='sharma-and-associates'; select public.expire_trials();`) → lock screen; Owner Console shows "Trial ended" + Extend trial works.
B. Finish multi-tenancy:
  4. Robustness migration (033): per-firm error isolation in generate_subscription_bills and run_reminders (BEGIN…EXCEPTION per firm/subscription); billing run should auto-send ALL pending auto-send drafts (not only those created in this run; 60 s limit can strand them); run_reminders_now could be scoped to the caller's firm.
  5. End-to-end isolation test with a second firm (Sharma): its admin and staff must not see/receive anything of Finetax; letterhead, emails, numbering, chat, documents, notifications, support all per firm.
  6. Invite flow: add an existing Duesk login to another firm (create-user currently fails for existing emails) + firm switcher UI (set_active_org exists).
  7. Self-serve signup wizard (currently firms are created only by the owner in /owner), plans and seat limits, Duesk's own subscription billing.
  8. Housekeeping: drop zz_legacy_* tables (after backup); delete 2 orphan files in firm-documents/client_files; consider a separate test Supabase project; check the Supabase region (India/DPDP).
C. Product roadmap after multi-tenancy (agreed 02 Nov 2026). Market context: ICAI offers a free PMS and Zoho Practice is free for up to 3 users; competitors include Jamku, Turia, Suvit, Vider/ATOM, QwikCA. Basics don't win; switching ease + "proposal-to-payment autopilot" does.
  1. Bulk import (clients/services/fees from Excel/CSV with PAN/GSTIN validation, sample template) + ready-made compliance setups (GST monthly, TDS quarterly, ITR, ROC → a year of tasks via Task List rules) + free migration help for early firms + export-all-data.
  2. Razorpay payments (ON HOLD): payment link per invoice (accept_partial for TDS), webhook /api/webhooks/razorpay with signature check (payment_link.paid / partially_paid / cancelled / expired), auto-record payment, receipt email, one-click TDS; then receivables ageing, statement of account, collections dashboard. Before coding, need: invoice_payments columns, sync_invoice_paid definition, src/app/invoices/page.tsx, test keys RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET.
  3. Client portal: document checklists, uploads, task status, invoices, pay; automatic document requests and chasing.
  4. DSC register with expiry alerts; credentials vault (Vault-encrypted, view-logged); notice tracker (IT/GST/TDS with deadlines).
  5. Client profitability report (fee billed vs time × staff cost).
  6. WhatsApp automation (Business API is PAID per message: decide who bears cost; free wa.me links for now).
  Also: leave/attendance (affects KPI activeness), Tally export, security one-pager, PWA/mobile, Hindi onboarding.
D. Open questions: Is QUO/2026/002 (Converted, 02/09/2026, ₹17,700) real or test?

## 11. Useful checks
- RLS guard on every table: list tables whose RESTRICTIVE policies mention org (`pg_policies` where permissive='RESTRICTIVE' and qual ilike '%org%'); the 13 platform tables listed in 5.1 are expected to have none.
- Functions callable by anon/logged-in: `has_function_privilege('anon'|'authenticated', p.oid, 'execute')` over pg_proc in public.
- Function body: `select pg_get_functiondef('public.<name>'::regproc);`
- Cron: `select jobid, jobname, schedule, active from cron.job;` and cron.job_run_details; pg_net responses: net._http_response.
- Email: `select email_address, last_synced_at, last_sync_error, verified_at from email_accounts;`
- Firms: `select name, slug, status, plan, trial_ends_at from organizations order by created_at;`
- Who can see what: `select m.org_id, p.name, m.role, m.module_access, m.is_active from memberships m join profiles p on p.id = m.user_id;`
- Storage layout: `select bucket_id, split_part(name,'/',1), count(*) from storage.objects group by 1,2;`

## 12. Edits made 02–03 Nov 2026 (VERIFY they are in the code and deployed)
Grep checks are in brackets.
- 12 API routes: `if (!(await checkRateLimit(...)))` bracket fix (admin/firm-settings, admin/manage-user, email-accounts/test, engagement/[token], invoices/send, proposals/send, quotations/send, send-email, support/feedback, support/message, support/ticket, sync-emails).
- proposals/send: org check `proposal.org_id !== caller.orgId` → 404; `orgId: caller.orgId` to sendFirmEmail; update filtered by org_id.
- webhooks/incoming-emails: `.not("verified_at", "is", null)` and exact `.ilike("email", escapeLike(fromAddress))` [Select-String 'verified_at'].
- lib/billing/invoiceMailer.ts: invoice_reminders insert has `org_id: inv.org_id`.
- engagement/[token]/page.tsx: firm_settings `.eq("org_id", p.org_id)` (was id 1).
- invoices/[id]/pdf and quotations/[id]/pdf: fetch the document first, then firm_settings `.eq("org_id", invoice.org_id / quotation.org_id)`.
- support/message: `org_id: ticket.org_id` on the user and assistant message inserts; support/message + support/ticket use `getSiteUrl(request)` for escalateTicket.
- src/app/api/team deleted.
- Branding: AuthLayout "Duesk"; login "Sign in to your Duesk workspace"; firm-settings alert "sign in to Duesk"; CSV names audit_log_, client_import_template.csv, clients_, timesheet_; inbox "removed from Duesk" (x2) + signature fallback `currentUser?.orgName`; team page "Firm configuration…", "Manage your firm's staff…"; dashboard "Firm dashboard…", "Firm-Wide Task Stream"; invoices fallback "Our team"; documents line 367 signature (uses `+` join); reviewer-queue "log in to Duesk", signature orgName; leads "in Duesk:", "connecting with ${currentUser?.orgName || "us"}", signatures orgName (x2); tasks signatures orgName (x2). [Select-String 'Finetax' should only show the cron comment in api/cron/sync-emails.]
- layout.tsx: AccessRow has org_status/trial_ends_at; new lock screen via my_blocked_firm; trialNotice banner [Select-String 'my_blocked_firm|trialNotice'].
- lib/email/syncMailbox.ts sets verified_at; email-accounts/test sets verified_at on a successful login.
- owner/firms/[id]: STATUSES includes "expired"; select includes trial_ends_at; extendTrialDays. owner/page.tsx: expired tone + option "Trial ended", stats "Paused / trial ended", extendTrial() + "Extend trial" link [Select-String 'extendTrial'].







# DUESK — PROJECT CONTEXT
Last updated: 12 Nov 2026. Supersedes all earlier context documents.

## 0. How to use this (for Claude)
- Code truth = the repo. Schema truth = the live Supabase DB (early multi-tenancy migrations were run in the SQL editor without files; later ones are in supabase/migrations/). If this document and the code disagree, trust the code and say so.
- Owner works on Windows PowerShell: give Select-String commands, not git grep with quotes.
- Never run anything against the production Supabase project unless the owner explicitly asks.

## 1. Product and people
- Duesk: multi-tenant practice-management SaaS for Indian CA firms (clients, leads, quotations, invoices + payments, retainer packages + engagement letters + recurring billing, tasks/compliance with maker-checker, calendar, time tracking, KPIs, documents vault, firm inbox, team chat, client discussions, help/support).
- Company: Oddlambda (platform org slug `oddlambda`, Duesk staff workspace: Owner Console + Support Inbox). Brand email domain: oddlambda.com.
- Owner/developer: Subhash (CA). His firm "M/S KUMAR SUBHASH & ASSOCIATES" is customer #1, org slug `finetax`, plan `firm`. Test firm: `sharma-and-associates`.
- Production: https://finetax-next.vercel.app (Vercel). ONE Supabase project ("Practice Manager Finetax", free plan) shared by Preview and Production — test data hits live data (S3 pending).
- Local: C:\Users\Chait\Downloads\practice-manager-next. GitHub chaitanyagohar/Finetax-next (main).
- Workflow: edit → npx tsc --noEmit (Next build shows only the first error) → npm run build → commit/push → Vercel deploys. SQL in Supabase SQL Editor; save every migration as supabase/migrations/NNN_name.sql first. Backups: free plan has none; use pg_dump (PostgreSQL command line tools + session pooler URL) before data-changing migrations.

## 2. Stack
Next.js 16.4.4 (Turbopack, App Router, proxy.ts instead of middleware, /api excluded from proxy) · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres, Auth, Storage, Realtime, pg_cron, pg_net, Vault) · @supabase/ssr · lucide-react · nodemailer 10.3.1 · imapflow · mailparser 3.14.1 · @react-pdf/renderer (server renderToBuffer) · qrcode · next/font (Inter; Barlow Condensed for the setup stamp only).

## 3. Environment and external services
- Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL, INBOUND_EMAIL_WEBHOOK_SECRET (webhook IS used), CRON_SECRET (also in Vault as 'cron_secret'), PUBLIC_LINK_SECRET (required, ≥32 chars), NEXT_PUBLIC_TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY, optional NEXT_PUBLIC_DUESK_CONTACT_EMAIL. No AI keys (owner wants no paid AI). Razorpay not set up.
- Supabase Auth: custom SMTP via Brevo (sender Duesk <noreply@oddlambda.com>, domain authenticated with DKIM+DMARC, branded tracking subdomain r.noreply.oddlambda.com). "Allow new users to sign up" OFF (accounts only via our server's admin invite). Confirm email ON. Email OTP expiration 86400. Site URL = production; redirect URLs include production/** and localhost/**.
- Templates: Invite user = two versions via {{ if .Data.staff_invite }} (staff invite vs new-firm signup), link {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite. Reset password template uses the token_hash flow.
- Cloudflare Turnstile widget on /signup (hostnames production + localhost); CSP allows https://challenges.cloudflare.com.
- Firm outbound mail (invoices, reminders, proposals) goes through each firm's own connected mailbox (Gmail etc. via SMTP app passwords stored in Vault). Finetax's two Gmail app passwords were failing on 03 Nov — confirm they were replaced.

## 4. Working rules (important)
- Complete files, or find/replace edits whose anchor is UNIQUE ACROSS THE WHOLE PROJECT (not just the file) and name the file. Non-unique anchors have repeatedly landed in the wrong file. Prefer whole lines; never a fragment of a line as the find text when the replacement rewrites it.
- Never put template literals inside inline code in chat (backticks get stripped) — use fenced blocks.
- After code: short "Deploy and test" list. Plain language.
- New SQL functions callable by the browser need explicit `grant execute ... to authenticated` (default privileges revoke public/anon since 030); service-only functions revoke from public, anon, authenticated and grant service_role.
- No paid third-party services without asking. GST correctness matters (continuous series per firm, cancel not delete, place of supply, late fees carry GST). IST; dates DD/MM/YYYY.
- Design: product UI is Inter/navy; onboarding uses the "firm file" concept (ledger sheet, violet stamp #5b3fa0). Avoid generic AI-looking UI (gradient text, glass cards, glowing blobs, confetti everywhere). Third-party real logos are not drawn; mocks use invented tools (GridBook, Daybook, LedgerBooks, Practicely, Pinger).

## 5. Multi-tenancy architecture
- Platform tables (no org_id): organizations (id, name, slug, status trial|active|suspended|cancelled|expired, plan, trial_ends_at, setup jsonb, setup_completed_at, grace_ends_at, plan_changed_at), memberships (PK org_id+user_id; role admin|staff|reviewer, is_reviewer, is_support_agent, module_access jsonb, designation, is_active, invited_by, joined_at, onboarding jsonb), user_active_org, profiles (global login profile; legacy role/module fields not authoritative), platform_admins, platform_config (support_org_id, legacy_org_id), plans (starter 3 users/200 active clients; professional 15/unlimited; firm unlimited; internal), rate_limits, support_kb, support_answer_stats, zz_legacy_* (to drop).
- All firm tables have org_id NOT NULL default default_org_id() and a RESTRICTIVE policy org_isolation: org_id = current_org_id() (support_tickets/support_messages also allow is_platform_admin()).
- Helpers: current_org_id(), default_org_id() (app.org_id setting else current org; null in cron/service role → inserts without org_id fail loudly), set_org_context(org) (service only), my_access() (org, role, modules, org_status, trial_ends_at, platform flags), my_blocked_firm(), my_signup_state(), my_onboarding(), mark_onboarding(), my_plan(), my_firms(), set_active_org(), firm_members() (admin), is_admin(), has_module(), is_org_member(), org_admin_ids(), shares_org_with() (both active), push_notification() (uses firm context; silent no-op without it), platform_create_firm(...), auth_email_status(email) (service only), plan_limit_message(org, kind) (service only), plan_refresh_grace(org), enforce_user_limit(org), expire_trials().
- Server rule: requireUser/requireAdmin/requireModule return orgId; every getAdminClient() query filters by org or derives org from the record. Public/no-login code takes org from the record. PDFs/emails take letterhead from the document's own org. sendFirmEmail({orgId,...}) only uses that firm's mailboxes.
- Storage: chat-attachments (<channel_id>/…), firm-documents/documents vault (<org_id>/<client|internal>/<year>/…; storage_folder_allowed also allows own-client folders and legacy client_files/internal for Finetax only; documents_check_path trigger), support-attachments (<user_id>/…), logos (public by design).
- Proxy: public /login /signup /forgot-password /auth/confirm (+/continue) /engagement; admin-only /team /packages /audit-page /settings /proposals /setup /plan; module paths; users with no membership → /welcome; oddlambda workspace limited to /owner /support /chat /reset-password.

## 6. Migrations
001–029 pre-SaaS features (RLS, numbering, payments, maker-checker, time, timers, settings, Vault email, documents, packages, task types, categories, notifications, transfers/queue, automatic timer, reminders, KPIs, packages v2/proposals/billing, public acceptance, schedules, module gates, email sync, support, no-AI support, chat). 026 Razorpay not done.
Multi-tenancy core: run in SQL editor, no files.
030 org hardening (onboarding checks, revoke anon on helpers, default privileges, shares_org_with active).
031 trial expiry status/my_access fields/my_blocked_firm/cron 'duesk-expire-trials' (19:15 UTC).
032 email_accounts.verified_at + guard trigger (webhook delivers only to verified mailboxes).
033 email & vault guards (mail_host_ok check constraint on hosts/ports; documents_check_path trigger).
034 my_signup_state. 035 setup wizard (organizations.setup, setup_completed_at, save_firm_setup, auth_email_status).
036 onboarding (memberships.onboarding, my_onboarding, mark_onboarding).
037 team invites (firm_members, my_firms). 038 plans & limits (plans table, triggers on memberships/clients, grace + trimming, new expire_trials: trials end on free Starter, my_plan).
Next number: 039.
Cron: pg_cron finetax-reminders (*/15 run_reminders), finetax-email-sync (*/5 → /api/cron/sync-emails via pg_net + Vault secret), duesk-expire-trials (daily); Vercel cron 03:30 UTC → GET /api/billing/run.

## 7. Features and where they live (recent additions)
- Auth: /login, /signup (Turnstile, duplicate-email messages), /api/auth/signup (inviteUserByEmail, server-only), /auth/confirm (GET → /auth/confirm/continue page; POST verifies token: protects one-time links from email scanners), /welcome (set password; new signups also create the firm via /api/auth/complete-signup → platform_create_firm, 14-day Professional trial), /forgot-password, /reset-password.
- Setup wizard /setup (firm file design: live letterhead, invoice prints, services, Compare step with mock old tool + "A month with one client" player, violet "Registered on Duesk" stamp). Components: onboarding/DueskLogo, Stamp; app/onboarding.css (ob-* classes, reduced-motion aware).
- Onboarding: components/onboarding/OnboardingLayer (Getting started checklist with progress from my_onboarding, first-visit tour prompts, "Done" stamp toast), TourRunner (spotlight glide, click blockers, tryIt steps), lib/onboarding/tours.ts (tours for every module; data-tour tags exist on dashboard, tasks, clients, invoices, packages, time-tracking, inbox, quotations tabs, team-add; other pages show centred cards).
- Team: /team (invite by email, existing Duesk users added directly, pending invites resend/cancel, remove/restore access per firm, edit role/modules via /api/admin/update-member, login security via /api/admin/manage-user), lib/team/members.ts, /api/admin/invite-member. Topbar firm switcher (my_firms + set_active_org).
- Plans: /plan page, components/billing/PlanBanner (over-limit banner for admins), Owner Console plan select + extend trial; limits enforced by DB triggers; invite/restore pre-check plan_limit_message.
- Email/security fixes: lib/email/mailHost.ts (blocks private hosts/ports), lib/storage/vaultPath.ts, send-email body escaped, EmailModal sends "files", billing run 3/hour/firm, inbox search escaping, webhook exact client match + verified_at.
- Other modules unchanged in structure: dashboard (src/app/page.tsx), clients, leads, quotations, invoices (+/invoices/[id]/pdf), packages (tabs Packages/Proposals/Billing), public /engagement/[token], tasks, reviewer-queue, calendar, time-tracking (+WorkSession, AttendancePanel), performance, documents, inbox (+sync, compose), chat, client-discussions, help & support, settings, audit-page, owner console (/owner, /api/owner/firms).

## 8. Decisions
- Billing: bill day 5th, drafts approved by admin (auto-send per client optional), late fee 1.5%/month min ₹100 with GST on next bill, first period pro-rated, due in 5 days. Invoice numbers per firm, continuous; cancel never delete. OPEN QUESTION: the invoices page says the number is assigned on save (draft) — verify whether drafts consume real numbers.
- Trials: 14 days on Professional; last-7-days admin banner; at end → free Starter. Over Starter limits → 14-day grace → extra users lose access (admins first, then most recently active). Clients over limit: only new clients blocked.
- Plan modules (which features each plan unlocks) — NOT built yet; next step. Paid upgrades are manual via Duesk (contact) until Duesk's own billing exists.
- Signup "already exists" messages are shown (accepted enumeration trade-off; Turnstile + rate limits).
- Free Starter forever, to compete with Zoho Practice (free up to 3 users).

## 9. Open items (priority order)
1. Module gating by plan (needs navConfig.ts, proxy, pages).
2. Security backlog: S2 rotate all secrets (.env was shared in a chat), S3 separate dev Supabase for Preview, S4 repo private + remove context/notes files from repo + secret scanning, S6 browser writes to firm_settings/audit_logs/profiles, S7 composite FKs (org_id, client_id…), S8 review every user-callable RPC for org checks (merge_clients, set_work_queue, team_scorecards, chat_*, record_proposal_acceptance, run_reminders_now should be firm-scoped), S9 webhook ?token= removal, S10 engagement link expiry + PDF rate limit, S11 manage-user must refuse platform staff, S12 reauth session cleanup + duplicate verifyCallerPassword, S13 rate limiter fail-closed + cleanup, S14 nonce CSP, S16 MFA for admins, S17 backups, S18 monitoring (Sentry), S19 DPDP (region Mumbai?, privacy policy, retention, delete-my-data), S20 dependency hygiene.
3. Robustness migration: per-firm error isolation in generate_subscription_bills and run_reminders; billing auto-send should send every pending auto-send draft (60 s limit).
4. Performance: P1 dashboard aggregates in SQL (1,000-row cap breaks totals), P2 realtime filters by org_id, P3 fewer my_access calls, P4 server pagination, P5 composite indexes, P6 email job batching, P7 cache issued PDFs, P8 archiving, P9 maintenance (drop zz_legacy).
5. Inbox composer sends vault documents as links (private bucket → broken for clients) — switch to real attachments (documentIds).
6. Tag remaining pages for tours (leads, documents, chat, performance, settings, reviewer queue, calendar).
7. Product roadmap: bulk import + ready-made compliance setups, Razorpay payments + receivables/statement, client portal with document checklists, DSC register / credentials vault / notice tracker, client profitability, WhatsApp (paid API — decide cost), leave/attendance, Tally export.