# Duesk batch 3: team requests

Built on `main` with batches 1 and 2 deployed, and tested against `supabase/schema_2026-11-13.sql` with migrations 041 to 046 applied.

## What changes for users

**1. Searchable task picker**
- Wherever a task is chosen from a list, you now type to search: Manual Time Entry, the timer, and the Related Task field on a document. Every word you type must match the task name, period, category, client or organisation, so "3b sharma oct" finds GSTR-3B for Sharma for Oct 2026.
- Each option shows the task and period, then the client, due date and stage, so similar tasks can be told apart.
- Search runs on the server, so every task can be found. Previously the list was loaded in one go and stopped at 1,000 tasks, which is why some tasks were missing.
- Time entries now load the names of only the tasks they refer to, so a task name no longer goes missing from older entries.
- The task choice in the Add Task window (the Task List, 47 entries at Finetax) is searchable too.
- The client filters on Tasks, Time Tracking and Documents are now the same searchable client picker used in forms.
- Task transfer is opened from a task that is already chosen, and its only list is of people, so it needed no task picker.

**2. Task List search**
- The search box was already there, but below the "Add a task" form, so it was easy to miss. The window now opens with the search box (cursor in it) and the list first. The form appears only after **Add a task** or **Edit**. The count shows how many entries match.

**3. Daily recurrence**
- **Daily** is now offered for tasks, Task List entries and package services, alongside Weekly, Monthly, Quarterly and Yearly.
- When a daily task is approved, the next one is created for the firm's next working day. Working days are the setting under **Performance → Weights → Working days**: Monday to Saturday (the default), Monday to Friday, or all seven days. This is the same setting the KPI scores use.
- A daily task approved late continues from today rather than from its old due date, so no backlog of past days is created.
- If the daily task has a period, the next one's period is its date (for example "18 Nov 2026"). A daily package service starts on the first working day from its start date.
- Holidays are not known to Duesk; only the weekly working days are skipped.

**4. Client mobile on tasks**
- The client's mobile number shows as a tap-to-call link with a WhatsApp button:
  - on each task card on the board
  - in the task window header
  - on each row of the work queue
  - in the reviewer queue's task window
- Nothing new is exposed: anyone who can see a task could already read its client's number, and the tasks page already loaded it.

**5. Feedback templates**
- One-click lines appear above the **Execution Notes** and **Reviewer Feedback** boxes in the task window, and above **Review Feedback** in the reviewer queue.
- Clicking a line adds it on a new line. Several can be added, and the text stays editable. A line already in the box shows a tick and isn't added twice.
- Administrators see **Manage templates** next to the lines. There they can add, edit, reorder or delete templates. Each template can be shown above both boxes or just one, and can be tied to one task in the Task List. A tied template shows first on that task and is hidden on others.
- Every firm starts with the five examples you gave. New firms get them as part of set-up.

## Files

| File | Status | Reason |
|---|---|---|
| `supabase/migrations/047_daily_recurrence_feedback_templates.sql` | NEW | `next_working_day`, Daily in `tasks_after_approve` and `compute_service_schedule`, `feedback_templates` table with rules and seed, new firms seeded in `platform_seed_firm`, `search_tasks` |
| `supabase/undo/047_daily_recurrence_feedback_templates_undo.sql` | NEW | Tested rollback for 047 |
| `src/components/ui/Combobox.tsx` | NEW | Shared searchable dropdown (keyboard, search box, none option) used by the pickers below |
| `src/components/tasks/TaskPicker.tsx` | NEW | Searchable task choice backed by `search_tasks` (request 1) |
| `src/components/tasks/FeedbackTemplates.tsx` | NEW | Template lines, loader and the Manage templates window (request 5) |
| `src/components/ui/ClientContact.tsx` | NEW | Call and WhatsApp links for a client's mobile (request 4) |
| `src/lib/phone.ts` | NEW | WhatsApp/tel number formatting, moved from the Leads page |
| `src/lib/tasks/recurrence.ts` | NEW | One list of recurrence options, including Daily, and their wording (request 3) |
| `src/components/ui/ClientPicker.tsx` | MODIFIED | Rebuilt on `Combobox`; same props and look, plus `compact` and `extraOptions` for filter bars |
| `src/app/time-tracking/page.tsx` | MODIFIED | Task picker for the timer and Manual Time Entry; loads only the task names its entries need; searchable client filter |
| `src/app/documents/page.tsx` | MODIFIED | Task picker for Related Task (limited to the chosen client); searchable client filter; unused import removed |
| `src/app/tasks/page.tsx` | MODIFIED | Searchable task choice; Task List search first; Daily; contact links on cards and header; template lines; searchable client filter |
| `src/components/tasks/WorkQueue.tsx` | MODIFIED | Contact links on each row |
| `src/app/reviewer-queue/page.tsx` | MODIFIED | Template lines above Review Feedback; contact links in the header; Daily wording |
| `src/app/packages/page.tsx` | MODIFIED | Uses the shared recurrence list, so services can be Daily |
| `src/app/leads/page.tsx` | MODIFIED | Uses the shared WhatsApp number helper instead of its own copy |
| `src/lib/help/articles.ts` | MODIFIED | Help on recurring tasks explains Daily and working days |
| `src/lib/help/troubleshooting.ts` | MODIFIED | "Next recurring task wasn't created" covers Daily |

No files deleted. No dependency changes; `package.json` and `package-lock.json` are untouched.

## Overlap with earlier fixes

- `src/app/tasks/page.tsx` and `src/app/documents/page.tsx` carry batch 2's delete-refusal messages (D-05); untouched.
- `src/app/packages/page.tsx` carries batch 2's one-step package delete (D-05); untouched.
- `src/app/reviewer-queue/page.tsx`: only the additions listed above.

## Decisions taken

- **Daily after a late approval** continues from today, not from the missed due date.
- **Statutory deadline on a daily task**, if set, moves by the same number of days as the internal one.
- **Templates for the reviewer feedback box** show only to the person who can review that task, like the box itself.
- **Templates are firm-wide lines.** There are no personal templates.
- **Other copies of the WhatsApp number code**, on the invoices, billing and engagement letter pages, are left for batch 5 with the other duplicates. They behave the same.

## How it was checked

- `npx tsc --noEmit`: 0 errors, on a fresh copy of `main` (batch 2 deployed) with this zip extracted over it.
- `npm run build`: passes, 64 routes. The two Google Font downloads were stubbed for the check (batch 5 removes the need).
- Database: migrations 041 to 047 were each run twice on a local copy of your schema with two test firms, then 32 checks passed:
  - working days for Monday-to-Saturday, Monday-to-Friday and a firm with no setting
  - daily tasks approved late and early
  - a monthly task, to confirm it is unchanged
  - daily package services
  - templates: seeded once per firm, visible within the firm only, staff read-only, admin add/edit/delete, a task type from another firm refused, new firms seeded once
  - task search: multi-word matching, approved tasks only when asked, "my tasks", by client, and another firm finding nothing
- The batch 2 suite (51 checks) still passes with 047 applied.
- The undo script was run twice and restored the earlier functions exactly.
- ESLint on the touched files: 124 problems before, 115 after, none new.
- Not checked: the pages in a browser. The checklist in `APPLY.md` covers them.
