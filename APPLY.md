# Applying batch 11

Four database migrations, then code. Run the PowerShell commands from your project folder. Run the SQL in the Supabase SQL editor.

## 0. Make sure batch 10 is on main

```powershell
git checkout main
git pull
git log --oneline -3
```

The list should show "Merge batch 10" or "Batch 10: …". If it doesn't, merge it first:

```powershell
git merge --no-ff batch-10 -m "Merge batch 10"
git push
```

Batch 10's migrations (050 to 054) must also be in the database.

## 1. New branch and unzip

```powershell
git checkout -b batch-11
Expand-Archive -Path "$HOME\Downloads\duesk-batch-11.zip" -DestinationPath . -Force
```

## 2. Migrations (Supabase → SQL editor), in this order

Paste the whole file and click Run. Then run its check: the commented query at the bottom of the file, with the leading `-- ` removed.

| File | Check should show |
|---|---|
| `supabase/migrations/055_branding_and_plans.sql` | 4, 3, 2, false |
| `supabase/migrations/056_branches_and_roles.sql` | 2, 0, 9, 1 |
| `supabase/migrations/057_attendance_and_capacity.sql` | 3, 3, 6, false |
| `supabase/migrations/058_escalations_and_announcements.sql` | 6, 5, true |

Each file is safe to run twice. Run this last, so the API sees the new functions straight away:

```sql
notify pgrst, 'reload schema';
```

055 also creates a public storage bucket called `brand-assets` for logos and photos. Check it is there under Storage. If it isn't, create it by hand: public, 2 MB limit, PNG, JPEG and WebP only.

## 3. Check every firm's plan (important)

Firms already on Duesk keep every feature they use today, as extras. Features new in this batch follow each firm's plan:
- attendance and attendance reports
- branches
- firm roles
- escalation levels
- must-read announcements

1. Sign in as the owner and open **Owner console → Plans**.
2. **What each plan includes:** check the switches and limits. They start as agreed on 19/11/2026.
3. For **finetax**, either set its plan to **Firm**, or add the new features under **Extras for one firm**.
4. To see which firms got extras for what they already use:

```sql
select o.name, string_agg(x.feature, ', ' order by x.feature) as kept
from org_feature_overrides x join organizations o on o.id = x.org_id
group by o.name;
```

## 4. Check and build

```powershell
npx tsc --noEmit
npm run build
```

Both should finish without errors. There are no new packages and no new environment variables.

## 5. Look it over

```powershell
npm run dev
```

Open http://localhost:3000 as a firm admin.

**Pictures**
- [ ] Your name (top right) → add a photo. It shows in the sidebar and on Team.
- [ ] Settings → Logo and brand colour: upload a logo and pick a colour. Preview an invoice PDF: the logo and tinted header show.

**Branches and roles** (menu → Administration)
- [ ] Edit the Head office: add working hours. "You are on …" shows your internet address; click it to add it as the office address.
- [ ] Add a branch with **its own GSTIN** and **own invoice numbering** (prefix such as `PV/{FY}/`).
- [ ] Put one client in that branch:
  - [ ] An invoice for that client is numbered PV/2026-27/0001.
  - [ ] Its PDF shows the branch's address and GSTIN.
  - [ ] Another client's invoice still uses the firm's numbering.
- [ ] Roles: add "Article assistant" (Own work only, Tasks and Time tracking) and "Branch manager" (Their branch, with Approve time and leave and See attendance).
- [ ] Team: give a staff member the Article assistant role. Sign in as them:
  - [ ] They see only their own tasks and clients.
  - [ ] Opening another person's task by link shows nothing.

**Attendance** (menu → Compliance & work)
- [ ] My attendance shows today. **Start my day** and **Apply for leave** work.
- [ ] As staff, leave the tab untouched for 15 minutes, then move the mouse. The away question appears. Answer "On the GST, income tax or MCA portal".
- [ ] As admin:
  - [ ] **Team report**, **Workload** and **CSV** open.
  - [ ] **Approvals** lists the leave request; approve it.
  - [ ] **Holidays and rules**: add a holiday and save the rules.
- [ ] Tasks → new task → choose an assignee: the workload line shows under the picker.

**Announcements**
- [ ] Dashboard → Post: tick **Must read** and choose "Every day".
- [ ] Sign in as staff: the amber bar shows on every page until "I've read this".
- [ ] As admin, open "x of y acknowledged": who has read it, **Remind those who haven't read**, **Export**.

**Escalations**
- [ ] Tasks → Reminders & escalations: set the levels.
- [ ] Click "Run check now".
- [ ] The Dashboard shows **Needs a partner** when tasks qualify.

**Plans**
- [ ] On a firm whose plan lacks a feature (Owner console → Extras, turn one off for a test firm):
  - [ ] The menu shows a lock, and the page offers **Request this feature**.
  - [ ] The request appears under Owner console → Plans → Requests.
- [ ] **Phone width** (390px): Attendance and Branches and roles don't overlap.

## 6. Commit and push

```powershell
git add -A
git commit -m "Batch 11: pictures, plan controls, branches, roles, attendance, escalations"
git push -u origin batch-11
```

On the Vercel preview, run the same checklist. "In office" needs the office internet address as Vercel sees it; add it from the branch screen while at the office. Then merge:

```powershell
git checkout main
git merge --no-ff batch-11 -m "Merge batch 11"
git push
```

## Undo

**Code, before merging:**

```powershell
git checkout main
git branch -D batch-11
```

**Code, after merging:**

```powershell
git revert -m 1 <merge-commit-id>
git push
```

**Database:** run the files in `supabase/undo/` in this order:

1. `058_escalations_and_announcements_undo.sql`
2. `057_attendance_and_capacity_undo.sql`
3. `056_branches_and_roles_undo.sql`
4. `055_branding_and_plans_undo.sql`

Each file says at the top what it removes. Clients, tasks, invoices and payments are never deleted. Issued invoices keep their numbers.
