# FINETAX MANAGER — PROJECT CONTEXT (as of 19 Oct 2026)

Paste this at the start of a new chat. It is the complete working context of the build so far.

## 1. Who / what
- Owner/developer: Subhash (CA firm "M/S KUMAR SUBHASH & ASSOCIATES", NG-11 Ground Floor, Jwalaheri Market, Paschim Vihar, New Delhi-110063; GSTIN 07AQMPK4640C1Z0; PAN AQMPK4640C). Admin user of the app.
- App: "Finetax Manager", a practice-management CRM/ERP for a CA firm (tasks/compliance, clients, leads, quotations, invoices, packages & recurring billing, time tracking, inbox, documents, calendar, KPIs, support).
- Production: https://finetax-next.vercel.app (Vercel). Single Supabase project used by both Preview and Production (so test data hits the live DB).
- Local: Windows, project at C:\Users\Chait\Downloads\practice-manager-next. Workflow: edit → `npm run build` → commit/push → Vercel deploy. SQL runs in Supabase SQL Editor.
- Future plan: turn into a multi-tenant SaaS (separate company/brand; Finetax = customer #1). Not started in code.

## 2. Stack
Next.js 16.4.0 (Turbopack, App Router, `proxy.ts` instead of middleware) · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres, Auth, Storage, Realtime, pg_cron, pg_net, Vault) · @supabase/ssr 0.12 · lucide-react · nodemailer · imapflow · mailparser · @react-pdf/renderer (server-side `renderToBuffer`) · qrcode.

## 3. Environment variables (Vercel + .env)
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL (=production URL), INBOUND_EMAIL_WEBHOOK_SECRET, CRON_SECRET (Vercel cron + Supabase email-sync job; same value stored in Supabase Vault as secret name 'cron_secret'), PUBLIC_LINK_SECRET (recommended; signs public engagement links; falls back to service role key).
NOT used: ANTHROPIC_API_KEY (Claude AI support was dropped; user wants no paid AI). Razorpay keys pending (see §9).

## 4. Working rules / preferences (important)
- Give code as complete files or exact find/replace edits with UNIQUE anchors. Several times an edit landed in the wrong file because two files shared the same lines (settings vs calendar, dashboard vs tasks). Always choose anchors unique to one file and say which file.
- After code, give a short "Deploy and test" list. Plain, simple explanations.
- Don't pick paid third-party services (AI APIs etc.) without asking first. User prefers free/no-AI solutions; if AI is ever needed, Gemini (with Cloud Billing activated so data is treated as paid-service data).
- GST correctness matters (continuous invoice series, cancel not delete, late fee carries GST, place of supply).
- Times are IST; dates shown DD/MM/YYYY.

## 5. Shared code you must reuse (signatures)
- `src/lib/api/guard.ts`: requireUser() → {userId, name,...}; requireAdmin(); requireModule(...modules); assertSameOrigin(req); errorResponse(err); ApiError(status,msg); getAdminClient() (service role); writeAuditLog({action, entity, entity_id, metadata, actor?}); getSiteUrl(arg) (needs an argument; publicLinks.ts uses its own siteUrl()).
- `src/lib/api/rateLimit.ts`: checkRateLimit(key, max, windowMs). `src/lib/api/reauth.ts`: verifyCallerPassword().
- `src/lib/email/mailer.ts`: sendFirmEmail({to, subject, html, text, attachments?}), escapeHtml, EMAIL_RE, getAccountPassword(admin, account), imapSettingsFor(account).
- `src/lib/audit` → logAuditEvent(action, entity, id?, metadata) (client side).
- `src/lib/format.ts`: localISODate, formatDate, formatINR, compactINR, getInitials.
- `src/components/ui/Modal.tsx`: Modal({title, subtitle, onClose, maxWidth, footer, headerExtra}), ConfirmDialog({title, message, confirmLabel, tone, loading, onConfirm, onCancel}).
- `src/components/ui/ClientPicker.tsx`: default ClientPicker({clients, value, onChange, disabled, noneLabel, includeInactive, className}); exports clientLabel(c) ("Organisation — Name"), sortByLabel(list).
- `src/components/layout/UserContext` → useCurrentUser() {id, name, email, role, isAdmin, isReviewer, moduleAccess, isSupportAgent}.
- `src/components/tasks/TaskCategories.tsx`: useTaskCategories() {categories, activeNames, colorOf, reload}, CategoryBadge, TaskCategoriesManager. ONLY tasks/calendar/packages pages call useTaskCategories().
- DB: push_notification(user_id, type, title, body, link, entity, entity_id, priority 'normal'|'important') (internal; skips actor = auth.uid()); is_admin(); is_active_user(); is_support_agent(); has_module(text).
- PDFs: `src/lib/pdf/firmDocuments.tsx` (InvoicePdf, QuotationPdf, renderInvoicePdf, renderQuotationPdf, pdfFileName; hyphenation disabled; local UPI QR), `src/lib/pdf/engagementLetter.tsx` (loadProposalBundle, renderEngagementLetter).

## 6. Database migrations done (001–028)
001–009: RLS everywhere; leads/quotations/invoices numbering via document_counters (scope e.g. 'invoices:INV/2026-27/', column last_value); invoice_payments + sync_invoice_paid; client PAN/GSTIN checks; tasks maker-checker; time_logs; discussions.
010 server timers (time_timers, stop_time_timer). 011 firm settings validation + /api/admin/firm-settings (bank changes need password). 012 email accounts with Vault passwords. 013 calendar/audit indexes. 014 private documents + packages + onboard_client_package. 015 task_types (Task List), periods, client duplicates/merge.
016 task_categories, notifications (+realtime), announcements.
017 tasks.estimated_minutes, queue_rank, assigned_by/at; task_types.default_estimate_minutes; task_transfers + request/decide/cancel/transfer_task RPCs; set_work_queue/reset_work_queue.
018 automatic timer: tasks_auto_timer trigger, close_timer, pause/resume_timer, time_logs source/edited_at/needs_review, user_activity_days, presence_heartbeat, confirm_my_day.
019 reminders: reminder_settings, reminder_log, run_reminders() every 15 min via pg_cron 'finetax-reminders', snooze_notification, tasks.stage_changed_at.
020 KPIs: tasks.started_at/submitted_at/return_count, kpi_settings (weights 35/30/20/15, working days 6), kpi_reviews, team_scorecards(from,to).
021 packages v2: service_packages legal+billing fields; engagement_settings; client_packages billing fields (price, cycle, bill_day, due_days, late fees, auto_send, billing_enabled, next_period_start); invoices.client_package_id/billing_period_*; late_fee_charges; invoice_reminders; proposals (EL/2026-27/001…); internal_onboard; record_proposal_acceptance; generate_subscription_bills (service_role only).
022 public acceptance: mark_proposal_viewed, accept_proposal_online, decline_proposal_online (service_role).
023 package_services.task_type_id; clamp_day; compute_service_schedule (period + statutory + internal dates from Task List rule); package_schedule_preview; onboarding alerts admins about unassigned tasks ('tasks_unassigned'); past start date moves to acceptance date (proposals.original_start_date).
024 has_module() + RESTRICTIVE module-gate policies on invoices, invoice_payments, quotations, leads.
025 email_accounts.last_uid/uid_validity/last_synced_at/last_sync_error; pg_net.
026 (Razorpay) NOT done.
027 support system: profiles.is_support_agent (admins true; guarded), support_tickets (SUP-0001, status ai|waiting|open|resolved|closed), support_messages (role user|assistant|agent|system|note), notification triggers, private bucket 'support-attachments', realtime.
028 no-AI support: support_messages.meta (quick-reply options), support_kb (answers added from inbox), support_answer_stats + bump_answer_stat.

Scheduled jobs: pg_cron 'finetax-reminders' (*/15); pg_cron 'finetax-email-sync' (*/5, calls /api/cron/sync-emails via pg_net with Vault secret); Vercel cron (vercel.json) '30 3 * * *' → /api/billing/run (9:00 IST).

## 7. Features built (where)
- Layout: AppShell (BARE_PATHS /reset-password, /engagement), Sidebar, Topbar (bell + realtime, WorkSession timer bar, HelpLauncher), navConfig (sections incl. Performance (everyone), Support: Help & Support (everyone) + Support Inbox (supportOnly)). layout.tsx passes isSupportAgent.
- proxy.ts: public paths /login /forgot-password /auth/confirm /engagement; admin-only /team /packages /audit-page /settings /proposals; module paths (clients/leads→leads, quotations, client-discussions→discussions, tasks, calendar, time-tracking→time_tracking, documents, invoices, inbox→dashboard); /reviewer-queue reviewers; /support support agents. /api excluded from proxy matcher.
- Tasks page (`src/app/tasks/page.tsx`): list/board/queue views, Task List + Categories + Reminders (admins), transfers (TaskTransfer.tsx), WorkQueue.tsx, estimates, deep links ?task= ?view=queue ?staff=unassigned.
- Time: WorkSession.tsx (heartbeat, idle 10 min, day review 18:30), AttendancePanel.tsx on Time Tracking.
- Performance: src/app/performance/page.tsx.
- Packages page: tabs Packages / Proposals & Engagement Letters / Billing; components EngagementSettings, Proposals (composer, list, record acceptance, WhatsApp link), SubscriptionBilling. API: /api/proposals/send, /api/proposals/link, /api/billing/run (GET cron / POST admin), /api/billing/send; lib/billing/invoiceMailer.ts (issue+email, payment reminders).
- Public engagement page: /engagement/[token] (+AcceptForm, +/pdf), /api/engagement/[token]; signed tokens in lib/publicLinks.ts.
- PDFs served by route handlers: /invoices/[id]/pdf, /quotations/[id]/pdf, /proposals/[id]/pdf (old client-side PDFViewer pages deleted). Email routes /api/invoices/send, /api/quotations/send, /api/send-email use the shared PDF design.
- Inbox sync: lib/email/syncMailbox.ts (UID-based, read+unread, first sync 14 days), /api/sync-emails (button), /api/cron/sync-emails.
- Support (no AI): lib/help/articles.ts (25 guides), lib/help/troubleshooting.ts (44 problems incl. Hinglish phrases, follow-up questions), lib/help/troubleshooter.ts (matcher: synonyms, stemming, typo tolerance, IDF scoring, page boost; present(); buildSummary()), lib/help/supportServer.ts (SupportContext, contextFor, sanitizeAttachments, escalateTicket + email agents), API /api/support/message | ticket | feedback | agent, components help/HelpCenter.tsx (tabs Get help/Guides/My requests/Feedback, quick-reply buttons, screenshots), help/RichText.tsx, help/KnowledgeBaseManager.tsx, pages /help and /support (inbox with Save as answer, Knowledge base). assistant.ts (Claude) was deleted.

## 8. Decisions recorded
- Packages billing defaults (user said "defaults OK"): fixed bill day (5th of next month), drafts approved by admin (auto-send optional per client), late fee 1.5%/month min ₹100 added to next bill with GST, first period pro-rated, due in 5 days, online acceptance + optional signed copy. Existing subscriptions start with billing OFF.
- Invoice numbers: assigned on issue; never delete issued invoices (cancel). Test invoices INV/2026-27/0001-0002 were deleted and the counter reset to 0 on 18 Oct 2026, so the next issued invoice = INV/2026-27/0001.
- Welcome email after acceptance: postponed ("later").
- Tally: later premium feature; start with export file for the firm's own books.

## 9. Pending / next
1. Razorpay payment tracking (ON HOLD by user). Firm HAS a Razorpay account. Plan: payment link per invoice (accept_partial for TDS), webhook /api/webhooks/razorpay with signature check (events payment_link.paid / partially_paid / cancelled / expired), auto-record payment, receipt email, TDS one-click ("short by ~10% → record as TDS"). Defaults proposed (link in every invoice email, partial allowed, Razorpay notifications off, firm absorbs fee). BEFORE coding, need from user: output of `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name='invoice_payments'` and `select pg_get_functiondef('public.sync_invoice_paid'::regproc)`, plus `src/app/invoices/page.tsx`; env RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET (test mode first).
2. Payment tracking extras: client statement of account, receivables ageing, collections dashboard, advance/lump-sum allocation, bank statement upload matching.
3. Team chat (task threads, channels, DMs, @mentions).
4. Tally export file.
5. SaaS multi-tenancy (organizations, memberships, org_id everywhere, signup wizard, owner console, plans/billing); separate test Supabase project recommended.
6. Leave tracking (affects KPI activeness).
7. Open questions: is QUO/2026/002 (Converted, 02/09/2026, ₹17,700) real or test? Confirm the email-sync schedule shows recent last_synced_at with no errors. Confirm migrations 027+028 and the support files are deployed and tested.

## 10. Useful checks
- Migrations present: query information_schema / to_regclass for tables above.
- Cron: `select jobname, schedule, active from cron.job;` and `cron.job_run_details`; pg_net responses: `net._http_response`.
- Email sync: `select email_address, last_synced_at, last_sync_error from email_accounts;`
- Who can see what: `select name, role, module_access, is_support_agent from profiles;`