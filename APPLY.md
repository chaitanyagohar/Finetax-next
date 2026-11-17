# Applying Duesk batch 4

One migration (048). It only **adds** database functions and indexes, so the live site keeps working the same after you run it. Run the migration first, then the code: the new code needs the migration, but the old code works fine with it.

## 1. Back up

If PowerShell was closed, set `$pgdump` again first:

```powershell
$pgdump = "C:\Program Files\PostgreSQL\18\pgAdmin 4\runtime\pg_dump.exe"
& $pgdump "PASTE-YOUR-CONNECTION-STRING-HERE" --format=custom --file "$HOME\Downloads\duesk-before-048.dump"
(Get-Item "$HOME\Downloads\duesk-before-048.dump").Length
```

The size should be about 18 MB, like last time. Don't paste the connection string into a chat.

## 2. Pre-flight check (Supabase SQL Editor)

048 replaces nothing. This confirms none of its names are already taken. It must return `0` and `0`.

```sql
select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('dashboard_finance', 'dashboard_crm', 'client_balances', 'try_date')) as functions_taken,
       (select count(*) from pg_indexes where schemaname = 'public' and indexname in
          ('tasks_org_stage_due_idx', 'tasks_org_approved_idx', 'clients_org_name_idx', 'invoices_org_created_idx',
           'invoice_payments_org_paid_idx', 'leads_org_created_idx', 'discussions_org_date_idx')) as indexes_taken;
```

## 3. Put the code on a branch

Run these one at a time.

```powershell
cd C:\Users\Chait\Downloads\practice-manager-next
git checkout main
git pull
git status --short
```

`git status --short` must print nothing. If it lists files, stop and paste the output here.

```powershell
git checkout -b batch-4-totals-and-paging
Expand-Archive -Path "$HOME\Downloads\duesk-batch-4.zip" -DestinationPath . -Force
git status --short
```

You should see 17 lines starting with `M` (15 under `src/`, plus `CHANGES.md` and `APPLY.md`) and 3 starting with `??`: `src/lib/supabase/fetchAll.ts`, the 048 migration and the 048 undo file. Nothing is deleted this time. Commit straight away:

```powershell
git add -A
git commit -m "Batch 4: totals in the database and paged lists (B-04)"
git branch --show-current
```

The last line must say `batch-4-totals-and-paging`.

## 4. Check the build

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npx tsc --noEmit
npm run build
```

Both must finish without errors.

## 5. Run the migration

```powershell
Get-Content supabase\migrations\048_dashboard_totals.sql -Raw | Set-Clipboard
```

In the SQL Editor: clear the editor, paste, then click **Run**. Expect "Success. No rows returned". It can be run again safely.

Check:

```sql
select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('dashboard_finance', 'dashboard_crm', 'client_balances', 'try_date')) as new_functions,
       (select count(*) from pg_indexes where schemaname = 'public' and indexname in
          ('tasks_org_stage_due_idx', 'tasks_org_approved_idx', 'clients_org_name_idx', 'invoices_org_created_idx',
           'invoice_payments_org_paid_idx', 'leads_org_created_idx', 'discussions_org_date_idx')) as new_indexes;
```

Expect `4` and `7`.

## 6. Test on your computer

**Before you start**, open the live site as admin and note these dashboard numbers with the period set to **All Time**: Billed, Collected, Receivables, Open Leads, Quotation Pipeline, Active Clients, Client Follow-ups, and the Task Pipeline counts. Note the Receivables Aging rows too. At Finetax's size, every one of them should match after the change.

```powershell
git branch --show-current
npm run dev
```

The first line must say `batch-4-totals-and-paging`. Open http://localhost:3000, log in as admin, then:

1. **Dashboard numbers:** with **All Time**, every number you noted matches. The 6-month bars look the same.
2. **Period switch:** change the period to This Month, then This Quarter, then the FY. Billed and Collected change, and Recent Invoices lists only that period. The collected line now reads "… % of the amount billed in this period".
3. **Staff dashboard:** log in as a staff member. Overdue, In Review, "completed in total" and Logged This Week show as before.
4. **Tasks:** open tasks look as before. Under the filters: "Completed tasks from the last 90 days are shown. Show all completed tasks". Click it; older completed tasks appear in the Approved column and in the list (filter Stage = Approved). Saving a task afterwards keeps them shown.
5. **Old task link:** take a task approved more than 90 days ago, if you have one, and open `http://localhost:3000/tasks?task=<its id>`. It opens.
6. **Clients:** the Balance due per client matches what you saw before. Client import still warns about duplicates.
7. **Invoices:** "Billed this FY" and "Outstanding" match the live site.
8. **Other lists:** open Quotations, Leads, Client Discussions, Packages (including Subscription billing), Documents, Time Tracking (including Attendance), Calendar, Reviewer Queue and Inbox → attach a file. Each loads as before.
9. **Live refresh:** keep the dashboard open in one tab. In another, record a small payment on a test invoice. Within a couple of seconds, Collected and Receivables update.

Press **Ctrl+C** in PowerShell to stop the server when done. If anything looks wrong, send me a screenshot before going further.

## 7. Put it live

```powershell
git push -u origin batch-4-totals-and-paging
git checkout main
git merge --no-ff batch-4-totals-and-paging -m "Merge batch 4: totals and paging"
git push
```

Wait for Vercel to show the production deployment as **Ready**, then open the live site and repeat check 1.

## 8. How to undo

Code:

```powershell
git checkout main
git revert -m 1 HEAD
git push
```

This works while the batch 4 merge is the latest commit on `main`; otherwise run `git log --oneline` and send me the output.

Database: undo the code first, because the batch 4 dashboard calls the new functions. Then paste `supabase\undo\048_dashboard_totals_undo.sql` into the SQL Editor and run it. It drops only the four functions and seven indexes; no data is touched. Leaving 048 in place after undoing the code is also fine, because the old code doesn't use it.
