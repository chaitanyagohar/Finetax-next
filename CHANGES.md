# Batch 4: counts and lists that stay right past 1,000 rows (B-04)

Supabase returns at most 1,000 rows per request. Before this batch, the app read whole tables in one request and added them up in the browser. Past 1,000 rows, totals were silently wrong and the oldest rows dropped off lists. On Tasks, the list was sorted oldest first, so the *newest* tasks vanished.

The fix has three parts:

- **Totals in the database.** The dashboard money and CRM figures and the client balances are worked out by three new database functions (048). Every row is counted, and the browser downloads a few numbers instead of every invoice, payment, lead, quotation and discussion.
- **Lists read in pages.** A new helper reads 1,000 rows at a time until it has everything, so lists, client pickers and import duplicate checks see every row.
- **Less loaded up front.** The dashboard loads only open tasks and counts completed ones. Tasks loads open tasks plus those completed in the last 90 days, with a link to show the rest.

Finding: B-04 (Medium, Dashboard / Tasks / Clients / Invoices: unbounded selects stop at 1,000 rows).

## Files

| File | Change | Why |
|---|---|---|
| `supabase/migrations/048_dashboard_totals.sql` | NEW | `dashboard_finance(from, to)`, `dashboard_crm()`, `client_balances()` and the helper `try_date()`. They run with the signed-in user's rights, so firm isolation and module access apply exactly as they do to the tables. Seven indexes for the paged lists. Safe to re-run. No data changed. |
| `supabase/undo/048_dashboard_totals_undo.sql` | NEW | Drops the four functions and seven indexes. Touches no table data. |
| `src/lib/supabase/fetchAll.ts` | NEW | Reads a query 1,000 rows at a time until it has all of them. Used by every list below. |
| `src/app/page.tsx` | MODIFIED | Dashboard. Billed, collected, receivables, aging and the 6-month trend come from `dashboard_finance`. Leads, quotation pipeline, client counts and follow-ups come from `dashboard_crm`. Loads open tasks only; the completed count comes from a count query. Recent Invoices loads just the latest 6. Changing the period reloads only the money figures. Collection rate is labelled "% of the amount billed in this period". |
| `src/app/tasks/page.tsx` | MODIFIED | Loads all open tasks, plus tasks completed in the last 90 days (by approval date, or by due date for old tasks with no approval date). **Show all completed tasks** loads the rest. A link to an older task (`/tasks?task=…`) still opens it. Clients read in pages. |
| `src/app/clients/page.tsx` | MODIFIED | All clients read in pages, which also fixes the import duplicate check. Balance due per client comes from `client_balances` instead of downloading every invoice. |
| `src/app/invoices/page.tsx` | MODIFIED | Invoices and clients read in pages, so "Billed this FY" and "Outstanding" count every invoice. |
| `src/app/quotations/page.tsx` | MODIFIED | Quotations, clients, leads and the quotation→invoice links read in pages. |
| `src/app/leads/page.tsx` | MODIFIED | Leads and clients read in pages. |
| `src/app/client-discussions/page.tsx` | MODIFIED | Discussions and clients read in pages. |
| `src/app/packages/page.tsx` | MODIFIED | Client subscriptions and clients read in pages. |
| `src/app/documents/page.tsx` | MODIFIED | Documents and clients read in pages. |
| `src/app/time-tracking/page.tsx` | MODIFIED | Time logs for the chosen range and clients read in pages. |
| `src/app/calendar/page.tsx` | MODIFIED | The month's tasks and clients read in pages. |
| `src/app/reviewer-queue/page.tsx` | MODIFIED | Open review tasks, recent approvals, the activity log behind the analytics and clients read in pages. |
| `src/app/inbox/page.tsx` | MODIFIED | Clients read in pages. The "attach a file" list now offers the latest 200 documents, like invoices and quotations already did, instead of every document. |
| `src/components/packages/SubscriptionBilling.tsx` | MODIFIED | Active subscriptions read in pages. |
| `src/components/time/AttendancePanel.tsx` | MODIFIED | Attendance days and time logs for the month read in pages (a 10-person firm passes 1,000 log rows in a month). |
| `CHANGES.md`, `APPLY.md` | MODIFIED | This batch. |

## Left as they are, on purpose

- Topbar and notifications already use counts and a limit of 30.
- Team, task type, category and chat lists are per firm and stay far below 1,000.
- Support, transfer history and per-task timelines are filtered to one ticket or task.
- `src/lib/intelligence.ts` reads a column that no longer exists and is not used by any page. It goes in batch 5's clean-up.

## Checks run here

- 048 applied twice, on top of 041–047 (each applied twice), on a copy of the live schema. Then 18 database checks: 1,500 invoices and 1,200 payments counted in full, aging adds up to the receivables total, firm A never sees firm B's figures, a user without the Invoices module gets zero, anonymous callers are refused, and a malformed old follow-up date is ignored. Undo run, data untouched, then re-applied.
- Paging helper tested with 2,345 rows (3 requests, no duplicates), with an exact multiple of 1,000, and with an error part-way.
- `npx tsc --noEmit`: no errors. `npm run build`: passes.
- ESLint on the 15 changed files: 315 problems before, 310 after, and no file got worse. All of them were already there; batch 5 deals with them.
