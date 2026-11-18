# Batch 8: UI/UX pass from real screenshots, plus motion and loading

I ran Duesk locally against a copy of the database structure, with a fictional firm ("Sharma & Associates": 18 clients, 70 tasks, 26 invoices), and took screenshots of every page at desktop and phone width. No database changes and no new dependencies in this batch.

## What changed

**Phones**
- Tasks, Invoices, Quotations, Leads and Client discussions show **cards** on phones. The tables were cut off: amounts, status and actions weren't visible. Invoice cards keep Payment / Email / PDF buttons. From tablet width up, the tables are unchanged.
- Dashboard KPI cards sit two per row on phones (one per row before), and long page descriptions are hidden on small screens.
- Every page has extra space at the bottom, so the floating Help and tour buttons no longer cover the last row or its buttons.

**Work order and clarity**
- The task list shows **open work first, earliest deadline on top**, then completed work, most recently approved first. Before, the oldest approved tasks came first.
- Draft and cancelled invoices no longer show a balance as if it were owed.
- Page headers on the Dashboard and Tasks keep their buttons on one row on wide screens instead of wrapping awkwardly.
- An empty Announcements panel takes one line ("none active" plus Post).
- An empty Inbox with no mailbox offers **Connect a mailbox**. Staff are told to ask an administrator.
- "1 follow-ups due" now reads "1 follow-up due". Leftover Title Case was fixed ("Review tasks", "All tasks", "Live work timer"), and help articles now use the sidebar names as they appear.

**Motion and loading**
- A thin gold progress bar runs along the top while the next page loads.
- Each page fades up gently when you arrive.
- KPI cards rise in one after another and lift slightly on hover. Card lists on phones fade in, and buttons give a small press response.
- While a list loads, shimmering placeholder rows replace the spinner (11 pages). KPI cards show placeholders instead of a misleading "0". The page-level loading screens use the same shimmer.
- If someone has turned on "reduce motion" in their device settings, all of this is switched off.

**Tests**
- All 12 browser checks now run against the local copy: 11 pass, and the Inbox one is skipped because the sample firm has no mailbox. Two checks were corrected along the way.
- The security policy also allows `ws://` when Supabase runs on `http://` (local only; the live site uses https and was already fine).
- The tests README now asks for PostgreSQL 17 or newer.

## Checks run here

- `npx tsc --noEmit` passes. `npm run build` passes. Lint: 0 errors.
- Playwright: 11 passed, 1 skipped (no mailbox). SQL isolation checks: all 16 pass.
- The zip, extracted over a clean copy of batch 5–7 + fix 1, gives identical files and builds.
- Before/after screenshots: `duesk-batch-8-before-after.png` (sent with the zip).

## Files

| File | Change | Why |
|---|---|---|
| `src/components/layout/NavigationProgress.tsx` | NEW | The top progress bar between pages. |
| `src/components/ui/Skeleton.tsx` | NEW | Placeholder rows shown while a list loads. |
| `src/app/globals.css` | MODIFIED | Page fade, shimmer, KPI rise and hover, list fade, button press, KPI loading placeholders, reduced-motion fallback. |
| `src/components/layout/AppShell.tsx` | MODIFIED | Progress bar, page fade-in, extra bottom space for the floating buttons. |
| `src/app/loading.tsx` | MODIFIED | Shimmer instead of pulse. |
| `src/app/page.tsx` | MODIFIED | Header on one row, two KPI columns on phones, plural fix, shimmer skeleton, KPI row motion. |
| `src/app/tasks/page.tsx` | MODIFIED | Open work first; phone cards; header layout; wider task column; "All tasks"; skeleton rows; KPI loading state. |
| `src/app/invoices/page.tsx` | MODIFIED | Phone cards with actions; no balance on drafts or cancelled invoices; skeleton rows; KPI loading state. |
| `src/app/quotations/page.tsx` | MODIFIED | Phone cards; skeleton rows; KPI loading state. |
| `src/app/leads/page.tsx` | MODIFIED | Phone cards; skeleton rows; KPI loading state. |
| `src/app/client-discussions/page.tsx` | MODIFIED | Phone cards; skeleton rows; KPI loading state. |
| `src/app/clients/page.tsx` | MODIFIED | Skeleton rows; KPI loading state. |
| `src/app/documents/page.tsx` | MODIFIED | Skeleton rows; KPI loading state. |
| `src/app/team/page.tsx` | MODIFIED | Skeleton rows; KPI loading state. |
| `src/app/time-tracking/page.tsx` | MODIFIED | Skeleton rows; KPI loading state; "Live work timer". |
| `src/app/audit-page/page.tsx` | MODIFIED | Skeleton rows. |
| `src/app/owner/page.tsx` | MODIFIED | Skeleton rows. |
| `src/app/packages/page.tsx` | MODIFIED | KPI row motion and loading state. |
| `src/app/performance/page.tsx` | MODIFIED | KPI row motion and loading state. |
| `src/app/reviewer-queue/page.tsx` | MODIFIED | KPI row motion and loading state. |
| `src/app/inbox/page.tsx` | MODIFIED | "Connect a mailbox" when none is connected. |
| `src/components/notifications/AnnouncementsPanel.tsx` | MODIFIED | One line when there are no announcements. |
| `src/components/layout/navConfig.ts` | MODIFIED | Page title "Review tasks". |
| `src/components/layout/Topbar.tsx` | MODIFIED | "Review tasks" group name in Jump to. |
| `src/app/api/admin/firm-settings/route.ts` | MODIFIED | "Firm settings" in the payment-details email. |
| `src/lib/help/articles.ts`, `src/lib/help/troubleshooting.ts`, `src/lib/help/troubleshooter.ts` | MODIFIED | Help text uses the sidebar names as they now appear. |
| `src/lib/csp.ts` | MODIFIED | `ws://` allowed when the Supabase URL is `http://` (local use). |
| `tests/e2e/public.spec.ts` | MODIFIED | Webhook check accepts "not configured" (503). |
| `tests/e2e/signed-in.spec.ts` | MODIFIED | Inbox check finds the desktop Compose button; skips when no mailbox. |
| `tests/README.md` | MODIFIED | PostgreSQL 17+; status updated. |
| `CHANGES.md`, `APPLY.md` | MODIFIED | This batch. |
