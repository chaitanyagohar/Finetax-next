# Applying Duesk batch 3

One migration this time (047), and nothing in it changes how the live site behaves until the new code is deployed. Run the migration first, then the code. The new code needs the migration, but the old code works fine with it.

## 1. Back up

Use the same `pg_dump` you used for batch 2, with your **new** database password. If PowerShell was closed, set `$pgdump` again first:

```powershell
$pgdump = "C:\Program Files\PostgreSQL\18\pgAdmin 4\runtime\pg_dump.exe"
& $pgdump "PASTE-YOUR-CONNECTION-STRING-HERE" --format=custom --file "$HOME\Downloads\duesk-before-047.dump"
(Get-Item "$HOME\Downloads\duesk-before-047.dump").Length
```

The size should be similar to last time (about 18 MB). Don't paste the connection string into a chat.

## 2. Pre-flight check (Supabase SQL Editor)

This confirms the three functions 047 replaces haven't changed since the 13 Nov dump. It must return `true`.

```sql
select bool_and(md5(regexp_replace(prosrc, '\s+', '', 'g')) = case proname
         when 'tasks_after_approve' then 'dfa25aac5134321784b10587f9b4f768'
         when 'compute_service_schedule' then 'b353252dd5728e24099be8eb6ae6cf7c'
         when 'platform_seed_firm' then 'de4e9367e12cae1fa57230b700d8f02d' end)
       and count(*) = 3 as unchanged_since_dump
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('tasks_after_approve', 'compute_service_schedule', 'platform_seed_firm');
```

## 3. Put the code on a branch

Run these one at a time. The commit comes straight after extracting, so the files can't travel to another branch by accident, which is what happened in batch 2.

```powershell
cd C:\Users\Chait\Downloads\practice-manager-next
git checkout main
git pull
git status --short
```

`git status --short` must print nothing. If it lists files, stop and paste the output here.

```powershell
git checkout -b batch-3-team-requests
Expand-Archive -Path "$HOME\Downloads\duesk-batch-3.zip" -DestinationPath . -Force
git status --short
```

You should see 12 lines starting with `M` and some starting with `??`. Every path should start with `src/`, `supabase/`, `CHANGES.md` or `APPLY.md`. Then commit straight away:

```powershell
git add -A
git commit -m "Batch 3: searchable task picker, Task List search, Daily recurrence, client mobile on tasks, feedback templates"
git branch --show-current
```

The last line must say `batch-3-team-requests`.

## 4. Check the build

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npx tsc --noEmit
npm run build
```

Both must finish without errors.

## 5. Run the migration

```powershell
Get-Content supabase\migrations\047_daily_recurrence_feedback_templates.sql -Raw | Set-Clipboard
```

In the SQL Editor: clear the editor, paste, then click **Run**. If the "destructive operation" warning appears, choose **Run this query**. Expect "Success. No rows returned". It can be run again safely.

Check:

```sql
select o.slug, count(f.id) as templates
from public.organizations o
left join public.feedback_templates f on f.org_id = o.id
group by o.slug order by o.slug;
```

Expect 5 for every firm and 0 for `oddlambda`. Then:

```sql
select public.next_working_day((select id from public.organizations where slug = 'finetax'), date '2026-11-21') as after_saturday;
```

Expect `2026-11-23` (the Monday), if Finetax works Monday to Saturday.

## 6. Test on your computer

This is the route that worked last time. It uses the same database as the live site.

```powershell
git branch --show-current
npm run dev
```

The first line must say `batch-3-team-requests`. Open http://localhost:3000, log in, then:

1. **Manual Time Entry:** Time Tracking → Manual Entry → Task. Type part of a task name and a client, such as "3b" and a client's name. Matching tasks appear with client, period and due date. Pick one: the client and description fill in.
2. **Timer:** the task box next to Start searches the same way.
3. **Documents:** upload or edit a document, choose a client, then Related Task. Only that client's tasks are offered.
4. **Client filters:** on Tasks, Time Tracking and Documents, the client filter lets you type to search.
5. **Add Task:** the Task field lets you type, such as "TDS".
6. **Task List:** Tasks → Task List. The search box is at the top with the cursor in it, and typing narrows the list. **Add a task** opens the form, and **Cancel** closes it.
7. **Daily:** create a test task with Recurrence = Daily, a reviewer, and due date today. Submit it, then approve it as the reviewer. A new task appears for the next working day (Monday if today is Saturday). The Recurrence list on the Task List form and on a package service also offers Daily.
8. **Mobile number:** a task whose client has a mobile shows the number with a phone link and a WhatsApp button on the card, in the task window header, and in the work queue. On a phone, tapping the number dials it.
9. **Templates:** open a task. Above Execution Notes, the five lines appear as buttons. Click two: both are added on separate lines, they show a tick, and the text is still editable. As the reviewer, the same lines appear above Reviewer Feedback, and in the reviewer queue above Review Feedback.
10. **Manage templates:** as an admin, click **Manage templates**. Add one line tied to a single task in the Task List and set to "Execution notes only". It shows first on that task's notes box, and not on other tasks or above feedback. Reorder and delete work.
11. **Staff view:** as a staff member, the template lines appear but **Manage templates** does not.

Press **Ctrl+C** in PowerShell to stop the server when done. If anything looks wrong, send me a screenshot before going further.

## 7. Put it live

```powershell
git push -u origin batch-3-team-requests
git checkout main
git merge --no-ff batch-3-team-requests -m "Merge batch 3: team requests"
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

This works while the batch 3 merge is the latest commit on `main`; otherwise run `git log --oneline` and send me the output.

Database: paste `supabase\undo\047_daily_recurrence_feedback_templates_undo.sql` into the SQL Editor and run it. It restores the earlier task recurrence, package schedule and new-firm set-up exactly. The templates table and its rows stay, unused. Tasks already set to Daily stop repeating, so change them to another recurrence afterwards.

Undo the code and the database together.
