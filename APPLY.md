# Applying batches 5, 6 and 7 (one zip)

This zip has one migration (049), three deleted files, and a new development dependency (Playwright, used only for tests). Run the migration first, then the code. The new code needs the migration; the old code works fine with it.

The list is long because it covers three batches. Do it in order and stop at anything unexpected.

## 1. Back up

```powershell
$pgdump = "C:\Program Files\PostgreSQL\18\pgAdmin 4\runtime\pg_dump.exe"
& $pgdump "PASTE-YOUR-CONNECTION-STRING-HERE" --format=custom --file "$HOME\Downloads\duesk-before-049.dump"
(Get-Item "$HOME\Downloads\duesk-before-049.dump").Length
```

The size should be about 18 MB. Don't paste the connection string into a chat.

## 2. Pre-flight check (Supabase SQL Editor)

049 replaces seven functions. This confirms the live versions are the ones it was written against. It must return `true` and `7`:

```sql
select bool_and(md5(regexp_replace(prosrc, '\s+', '', 'g')) = case proname
         when 'chat_can_access' then 'e0f1b8b22920fbfb51ba25a3c380d379'
         when 'generate_subscription_bills' then '6b10cc0d8bb5063aba3c4418e10dea77'
         when 'merge_clients' then '22b33229ef1cb3c9936ff7d7f414548e'
         when 'rename_task_category' then 'e40583a816cee57eb3eafce5ebaa733d'
         when 'run_reminders' then '080efd42ab90c831da82fba4f05c4056'
         when 'run_reminders_now' then '1c8f0100615eca82d9b4b84e1f5b8d81'
         when 'tasks_after_approve' then 'ca0d2ad13d797d1e8ad65ad6e1070636' end) as unchanged,
       count(*) as functions
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('chat_can_access', 'generate_subscription_bills', 'merge_clients', 'rename_task_category',
                  'run_reminders', 'run_reminders_now', 'tasks_after_approve');
```

If it shows `false`, or a number other than 7, stop and send me a screenshot.

## 3. Check the email webhook (one minute, before deploying)

From now on, the inbound-email webhook accepts its secret only in the `x-webhook-secret` header, not as `?token=` in the URL. If a mail-forwarding service calls `/api/webhooks/incoming-emails?token=...`, it would stop working.

To check: Vercel → your project → **Logs**, then search for `incoming-emails` over the last 7 days.

- **No results:** nothing calls it. Carry on.
- **Results:** tell me before deploying, or move the secret into an `x-webhook-secret` header in that service.

## 4. Put the code on a branch

Run these one at a time.

```powershell
cd C:\Users\Chait\Downloads\practice-manager-next
git checkout main
git pull
git status --short
```

`git status --short` must print nothing. If it lists files, stop and paste the output here.

```powershell
git checkout -b batch-5-7-cleanup-ux-tests
Expand-Archive -Path "$HOME\Downloads\duesk-batch-5-7.zip" -DestinationPath . -Force
git rm src/components/EmailModal.tsx src/lib/auth/permissions.ts src/lib/intelligence.ts
git status --short
```

Expect three lines starting with `D`, about 92 starting with `M`, and new files under `src/fonts/`, `src/lib/`, `supabase/` and `tests/`. Every path should start with `src/`, `supabase/`, `tests/`, `.gitignore`, `eslint.config.mjs`, `next.config.mjs`, `package.json`, `package-lock.json`, `CHANGES.md` or `APPLY.md`. Commit straight away:

```powershell
git add -A
git commit -m "Batches 5-7: remaining findings, UX pass, automated tests"
git branch --show-current
```

The last line must say `batch-5-7-cleanup-ux-tests`.

## 5. Install and check the build

The lockfile changed (Playwright plus the Linux fix), so install from it:

```powershell
npm ci
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npx tsc --noEmit
npm run build
npm run lint
```

- `npm ci` finishes. If Windows says a file is in use, close VS Code's terminal running `npm run dev` and try again.
- `tsc` and `build` finish without errors. The build no longer downloads fonts.
- `lint` ends with `0 errors` and about 490 warnings.

## 6. Run the migration

```powershell
Get-Content supabase\migrations\049_findings_cleanup.sql -Raw | Set-Clipboard
```

In the SQL Editor: clear the editor, paste, then click **Run**. If the "destructive operation" warning appears, choose **Run this query**. The warning appears because 049 rebuilds some triggers and replaces one function; no data is deleted. Expect "Success. No rows returned". It can be run again safely.

Check:

```sql
select
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and c.relname in ('invoices', 'quotations', 'tasks')
      and pg_get_triggerdef(t.oid) not like '%app.bulk_move%') as triggers_without_flag,
  (select count(*) from pg_proc where proname = 'run_reminders' and pronamespace = 'public'::regnamespace) as run_reminders_versions,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'execute')) as trigger_fns_callable,
  (select count(*) from pg_policies where policyname in ('legacy_admin_read', 'email_attachments_delete_admin')) as new_policies,
  (select count(*) from information_schema.columns where (table_name, column_name) in
    (('email_accounts', 'sync_locked_until'), ('firm_settings', 'default_sac'))) as new_columns;
```

Expect `0, 1, 0, 3, 2`.

Then check that the scheduled reminder job still matches the function. The job calls `run_reminders()`, which now means "every firm":

```sql
select jobname, command from cron.job where command ilike '%run_reminders%';
```

Expect a command like `select public.run_reminders()`, with nothing in the brackets. No rows is also fine. If the brackets have something in them, send me a screenshot.

## 7. Test on your computer

```powershell
git branch --show-current
npm run dev
```

The first line must say `batch-5-7-cleanup-ux-tests`. Open http://localhost:3000. **Keep the browser console open (F12 → Console)** for the whole test. A red message containing "Content Security Policy" or "Refused to" means the new security policy blocked something: stop and screenshot it.

1. **Login and fonts:** the login page and the app look the same as before, same font.
2. **Sentence case:** buttons and headings read like "Add client", "New invoice", "Tasks & compliance". Nothing important is renamed.
3. **Dialogs:** open **Add client**. The cursor is in the first field. Press Escape: the dialog closes. In **Team chat**, leave or archive a channel: an in-app confirmation appears instead of a browser pop-up. Cancel it.
4. **SAC:** **Firm settings** → **Default SAC code**: enter your usual code (for example `998231`) and save. Create a **draft** invoice: each line has a SAC box filled with that code. Open its PDF: there's a SAC column. Delete the draft.
5. **Inbox attachments:** **Unified inbox** → **New message** → the attach button → type part of an old invoice number or a client's name. Results come from all your invoices and quotations, not just recent ones. Close without sending.
6. **Recurring dates:** on a test task due on the 31st with Recurrence = Monthly, approve it. The next one is due on the last day of next month.
7. **Reviewer queue:** "Notify client" is unticked by default when you open a task to approve.
8. **Timer:** start a timer, open Duesk in a second tab, and keep working in the first tab for 10+ minutes. The timer doesn't pause.
9. **Reminders:** Tasks → Reminders → **Run check now** works.
10. **Merge clients (only if you have two test clients):** merging still works.
11. **Support (Duesk staff login):** tickets show the firm name before the number.
12. **Tour:** Help → start the Invoices tour. The "Click Overdue" step highlights the tabs.

Press **Ctrl+C** to stop the server. If anything looks wrong, send me a screenshot before going further.

## 8. Optional: run the automated tests

See `tests\README.md`. The quickest is the browser checks, with `npm run dev` running in another window:

```powershell
npx playwright install chromium
npm run test:e2e
```

Six checks pass and six are skipped until you set `$env:E2E_EMAIL` / `$env:E2E_PASSWORD` for the **Sharma and Associates** admin. Then all twelve should run. Tell me if a signed-in check fails on a label; those six haven't run against a real account yet.

## 9. Put it live

```powershell
git push -u origin batch-5-7-cleanup-ux-tests
git checkout main
git merge --no-ff batch-5-7-cleanup-ux-tests -m "Merge batches 5-7: cleanup, UX pass, tests"
git push
```

Wait for Vercel to show **Ready**. Open the live site with the console open (F12) and click through Dashboard, Tasks, Invoices and Inbox. There should be no red "Content Security Policy" messages.

**If the live site shows a blank page or blocked scripts:** open `src\lib\csp.ts`, change `CSP_REPORT_ONLY = false` to `true`, commit and push. The policy then only reports instead of blocking. Send me the console messages.

## 10. How to undo

Code:

```powershell
git checkout main
git revert -m 1 HEAD
git push
npm ci
```

This works while this merge is the latest commit on `main`; otherwise run `git log --oneline` and send me the output.

Database: undo the code first. Then paste `supabase\undo\049_findings_cleanup_undo.sql` into the SQL Editor and run it. It puts back the seven functions, the triggers, the policies and the function permissions exactly as they were. It leaves the two new columns (`sync_locked_until`, `default_sac`) and any `client_id` values copied into discussions; the old code ignores them.
