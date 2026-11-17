# Duesk batch 2: security

Built on `main` with batch 1 deployed, and tested against `supabase/schema_2026-11-13.sql`.

Findings fixed: **S-02**, **S-12**, **S-06**, **S-21**, **S-22**, **D-05**. Also: migration 041 can now be run again safely.

## What changes for users

**Mailboxes (S-02, S-12, D-05)**
- Mail forwarded to Duesk for an address reaches a firm only after that firm confirms it owns the address. To confirm, an administrator clicks **Confirm address** on the mailbox; Duesk emails a six-digit code to the address, and the administrator enters it. A successful connection test no longer counts as proof.
- Mailboxes already tested before this change are confirmed automatically, unless another firm has connected the same address.
- Each mailbox now has **Who can use it**. Administrators can always use every mailbox. Other staff see a mailbox and its emails only when it is shared with them, and they still need the Firm inbox module.
- On the first run, every mailbox is shared with every non-admin who had the Firm inbox module, so nobody loses access on the day. Administrators then remove people mailbox by mailbox.
- A mailbox that has emails in Duesk can no longer be removed; **Disable** keeps it and its emails. Previously, removing it deleted every email.

**Team (S-06, S-21, S-22)**
- Inviting someone who already has a Duesk login no longer adds them straight away. They see the invitation when they next sign in, and can accept or decline. Until they accept they have no access, the firm sees only the name the administrator typed, and they don't use a seat on the plan.
- The reply to an invitation is the same whether or not the email already has a Duesk login, so the Team page no longer reveals who uses Duesk.
- An unanswered invitation gives the inviting firm no say over that person's login: no password reset or email change.
- People lists and pickers show only people in the firm you are working in. Previously, someone in two firms saw both firms' staff.
- Tasks, leads and clients can be given only to an active member of their own firm. A recurring task or other system-made record whose assignee has left is left unassigned rather than failing.
- An administrator can change only people in the firm they are working in.

**Records that can no longer be deleted (D-05)**

| Record | Can't be deleted when | Do instead |
|---|---|---|
| Task | It has time recorded, or messages in its discussion | Change its status |
| Quotation | It isn't a draft, or an invoice was made from it | Change its status |
| Engagement letter | It isn't a draft | Withdraw it |
| Package | Any client is, or was, on it | Archive it |
| Mailbox | It has emails in Duesk | Disable it |

The database enforces these rules for everyone, including the server, and the page shows the reason. The quotations page now offers Delete only on drafts. The packages page deletes a package in one step, so a refused delete no longer loses the package's service list on the way.

## Files

| File | Status | Reason |
|---|---|---|
| `supabase/migrations/041_invoice_issue_gst.sql` | MODIFIED | Runs safely more than once: the temporary table the SQL Editor lost between statements is replaced by a single statement. A pre-041 invoice whose client had no state now takes the buyer state on a re-run. Has the same effect as the version you ran. |
| `supabase/migrations/042_mailbox_ownership.sql` | NEW | Confirmed owner per address, code table, guard trigger, one confirmed owner per address (S-02) |
| `supabase/migrations/043_mailbox_access.sql` | NEW | `email_account_members`, `can_use_mailbox`, mailbox and email visibility rules (S-12) |
| `supabase/migrations/044_invitation_consent.sql` | NEW | Pending memberships, `my_invitations`, `respond_to_invitation`, signup state and Team list for pending invitations (S-06) |
| `supabase/migrations/045_firm_scoped_people.sql` | NEW | People visible and editable only within the current firm; assignees must be members of the record's firm (S-21, S-22) |
| `supabase/migrations/046_delete_protections.sql` | NEW | Delete guards on tasks, mailboxes, quotations, engagement letters, packages; package foreign key changed to restrict (D-05) |
| `supabase/undo/042_046_security_undo.sql` | NEW | Tested rollback for 042 to 046 |
| `src/lib/email/ownership.ts` | NEW | Sends and checks the six-digit ownership code (S-02) |
| `src/app/api/email-accounts/ownership/route.ts` | NEW | Admin route to send and confirm the code (S-02) |
| `src/components/inbox/ConfirmOwnership.tsx` | NEW | Confirm address dialog (S-02) |
| `src/lib/email/access.ts` | NEW | Per-mailbox check for server routes, which bypass row-level security (S-12) |
| `src/components/inbox/MailboxAccess.tsx` | NEW | Who can use it dialog (S-12) |
| `src/components/team/PendingInvitations.tsx` | NEW | Accept or decline bar for invitations (S-06) |
| `src/app/api/webhooks/incoming-emails/route.ts` | MODIFIED | Delivers only to the firm that confirmed the address (S-02) |
| `src/app/api/email-accounts/test/route.ts` | MODIFIED | Comment: a passing test records a working connection, not ownership (S-02) |
| `src/lib/email/mailer.ts` | MODIFIED | `record: false` keeps one-time code emails out of the sending firm's Sent list (S-02) |
| `src/app/api/send-email/route.ts` | MODIFIED | A chosen mailbox must be one the sender may use; the account ID is validated (S-12) |
| `src/app/api/sync-emails/route.ts` | MODIFIED | Sync only mailboxes the caller may use (S-12) |
| `src/app/inbox/page.tsx` | MODIFIED | Confirm address, Who can use it, confirmed badge; remove no longer deletes emails first (S-02, S-12, D-05) |
| `src/app/api/admin/invite-member/route.ts` | MODIFIED | Existing logins get a pending invitation; same reply either way (S-06) |
| `src/lib/team/members.ts` | MODIFIED | `inviteExistingPerson`, `sendInvitationNotice` (S-06) |
| `src/app/api/admin/update-member/route.ts` | MODIFIED | Edit, resend and cancel work on pending invitations; their login is not touched (S-06) |
| `src/app/api/admin/manage-user/route.ts` | MODIFIED | Login changes only for people who have accepted (S-06) |
| `src/app/api/auth/complete-signup/route.ts` | MODIFIED | An unanswered invitation doesn't stop a new signup creating their own firm (S-06) |
| `src/app/layout.tsx` | MODIFIED | Shows the invitation bar (S-06) |
| `src/app/team/page.tsx` | MODIFIED | One message for every invitation (S-06) |
| `src/app/tasks/page.tsx` | MODIFIED | Shows why a delete was refused (D-05) |
| `src/app/quotations/page.tsx` | MODIFIED | Delete only on drafts; shows why a delete was refused (D-05) |
| `src/app/packages/page.tsx` | MODIFIED | Deletes a package in one step (D-05) |

No files deleted. No dependency changes; `package.json` and `package-lock.json` are untouched.

## Overlap with fixes already on main

- **`src/app/api/send-email/route.ts` (S-01, `isVaultPathAllowed`):** untouched. The mailbox check sits just before sending, after the vault check.
- **`src/app/api/admin/update-member/route.ts` (B-01, moved to its own folder):** kept at its new path; edits only.
- **`src/app/layout.tsx` (`onboarding.css` import):** kept; one import and three render lines added.
- **`src/app/quotations/page.tsx` (batch 1, B-29):** the reload after a failed email is kept.
- **Not touched:** `api/billing/run`, `api/billing/send`, `api/invoices/send`, `api/quotations/send`, login, the lock file.

## Notes

- **Where the code email comes from:** the ownership code is emailed from Duesk's own mailbox (the Oddlambda workspace, `platform_config.support_org_id`), the same mailbox that sends support escalations. It is never sent through the server the firm typed in. `APPLY.md` checks that this mailbox works.
- **S-22 scope:** pickers read `profiles`, which the database now limits to the current firm, so the pages needed no change.
- **D-05 scope:** a person can still delete their own time entries and then the task. The guard covers the common case the audit found, an administrator deleting a task with history.

## How it was checked

- `npx tsc --noEmit`: 0 errors, on a fresh copy of `main` (batch 1 deployed) with this zip extracted over it.
- `npm run build`: passes, 64 routes. The two Google Font downloads were stubbed for the check (batch 5 removes the need).
- **Database:** a local copy of your 13 Nov schema, with two firms, staff in both, mailboxes (including a rival copy of the same address in the second firm), emails, tasks, quotations, engagement letters and a retainer.
  - Migrations 041 to 046 were each run twice in order; 51 checks passed. They cover row-level security as staff, admin and a person in two firms.
  - The new 041 was run twice over the old 041, as you have it in production; invoices and counters were unchanged.
  - Your NZIE situation was reproduced on the copy: adding the client's state and re-running 041 fills its place of supply and nothing else.
  - The undo script restored every policy, function, trigger, constraint and index of the pre-batch schema; the only difference is a trailing newline in four function bodies, which has no effect.
- ESLint on the touched files: no new problems. One warning in `PendingInvitations.tsx` is the same deliberate full-page reload the firm switcher in `Topbar.tsx` uses.
- Not checked: the pages in a browser, and sending a real code email. The checklist in `APPLY.md` covers both.
