# Batch 12: security before launch, email checks, setup and tour

Two migrations (059 and 060), each with an undo script. No new packages, no new paid services, no new environment variables. Batch 11 must be applied first. SECURITY_REVIEW.md has the full review and the settings you need to change.

## What changes for users

### Two-step sign-in
- **Turning it on:** everyone can do it from their name (top right) → **Sign-in security**:
  1. Scan a QR code with Google or Microsoft Authenticator.
  2. Type the 6-digit code.
- **Signing in:** after the password, Duesk asks for the code on its own page, before anything of the firm opens.
- **Enforced in the database:** a session without the code sees no firm data at all.
- **Firm rule:** admins can tick **Require two-step sign-in for administrators**. Each admin without it is then sent to set it up first. Only an admin who already uses it can switch the rule on, so nobody locks the firm out.
- **Lost phone:** Team management → key icon → **Reset 2-step**. It needs the admin's own password.

### Email checks
- **Settings → Email activity** (admins):
  - the last 30 emails from the firm's mailbox, and why any failed
  - **Send me a test email**
- **Owner console → Email:**
  - whether Duesk's own emails have a sender
  - **Use my workspace mailbox** and **Send me a test email**
  - per firm: mailboxes, sent and failed in the last 7 days, and the last problem
  - Never subjects or recipients.
- Every email Duesk sends is now logged with its result.

### Support access
- When a firm grants support access, the owner gets a notification. The owner is also emailed, from the Duesk mailbox, when one is set.
- The notification opens that firm's support view directly.
- **Support view fix (059):** it failed with 'column "created_at" does not exist'.

### Activity log written by the database
Covers:
- invoices, payments, team and role changes, client deletion
- firm settings, payment keys, mailboxes, branches and support access

These show in Logs with what changed (secrets are never written).

### Other security
- Signed-out visitors lose every table and function right.
- **Export everything** asks for your password.
- Branches and roles is guarded as an admin-only page.

### Setup wizard, tour and checklist
- **Wizard:**
  - a **logo** upload on the Firm step, which shows on the letterhead preview
  - the last step suggests offices and roles, holidays and attendance rules (only when the plan has them), and two-step sign-in
- **Getting started checklist,** new items:
  - add your photo
  - add your logo
  - turn on two-step sign-in
  - add your other offices
  - make your firm's roles
  - add holidays and attendance rules
- **Tours:**
  - Welcome tour: My day, Attendance, Branches and roles, and your account.
  - New tours: Attendance, Branches and roles, Sign-in security.
  - Updated tours: Dashboard (announcements, Needs a partner), Team (branch, role, sign-in security), Settings (logo, email activity).
  - Steps for features the firm's plan lacks are skipped.
- **Help:** two new guides, "Two-step sign-in" and "Emails are not arriving".

### Fixes to batch 11
- Attendance **Holidays and rules**: saving the rules now works. Before, it said "saved" but nothing changed.

## Files

### NEW
| File | Why |
|---|---|
| `supabase/migrations/059_support_view_fix.sql` | Support view column fix |
| `supabase/migrations/060_security_and_email.sql` | Two-step check in the database, admin rule, signed-out rights removed, database activity log, email log, owner email health, support-access notice, checklist progress |
| `supabase/undo/059_…_undo.sql`, `060_…_undo.sql` | Undo |
| `src/app/verify/page.tsx` | Code page after the password |
| `src/app/security/page.tsx` | Sign-in security |
| `src/app/api/admin/firm-options/route.ts` | Attendance rules and the two-step rule |
| `src/app/api/admin/support-access/route.ts` | Grant support access, email the owner |
| `src/app/api/email/test/route.ts` | Test email |
| `src/app/api/owner/email-health/route.ts` | Choose Duesk's sender mailbox |
| `src/components/owner/EmailHealth.tsx` | Owner email card |
| `src/components/settings/EmailActivity.tsx` | Firm email activity |

### MODIFIED
| File | Why |
|---|---|
| `src/proxy.ts` | Code step, firm rule for admins, `/organisation` admin-only |
| `src/app/layout.tsx` | Code page without the firm shell |
| `src/lib/api/guard.ts` | Admin rights follow the firm's two-step rule |
| `src/lib/email/mailer.ts` and every sender | Email log with a kind for each email |
| `src/app/api/admin/manage-user/route.ts`, `src/app/team/page.tsx` | Reset two-step sign-in |
| `src/app/api/admin/export/route.ts`, `src/components/settings/DataAndSupport.tsx` | Password for export; support access through the server |
| `src/app/owner/page.tsx`, `src/app/settings/page.tsx` | Email cards; open support view from the notice |
| `src/components/layout/Topbar.tsx`, `navConfig.ts` | Sign-in security in the menu |
| `src/app/setup/page.tsx` | Logo, next steps |
| `src/components/onboarding/OnboardingLayer.tsx`, `src/lib/onboarding/tours.ts` | Checklist and tours |
| `src/app/attendance/page.tsx`, `src/app/organisation/page.tsx`, `AnnouncementsPanel.tsx`, `EscalationList.tsx` | Rules save fix; tour anchors |
| `src/lib/help/articles.ts` | Two guides |
| `tests/sql/00_supabase_stubs.sql`, `tests/sql/10_isolation.sql`, `tests/e2e/signed-in.spec.ts` | New checks D1 to D3, security page |

### DELETED
None.

## Checked here
- `npx tsc --noEmit`, `npm run build` and lint: no errors.
- A static checker on every database function: no errors.
- Database suites against the schema with 041 to 060:
  - 51, 32 and 39 checks pass.
  - The isolation suite passes, including:
    - D1: no rights for signed-out visitors
    - D2: no data before the code
    - D3: the database logs changes
- 059 and 060 were each run twice. The undo scripts were run and the migrations again, on a copy of the database.
- In a browser:
  1. Turned on two-step sign-in.
  2. Signed in again: sent to the code page, entered the code, and data opened.
  3. An admin reset it.
  4. The firm rule sent an admin without it to Sign-in security, and admin API calls were refused (403).
  5. The test email failure showed in Email activity and on the owner console.
- Playwright: 15 passed, 1 skipped.
