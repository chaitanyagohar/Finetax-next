# Applying batch 8

Code only: no migration, no new packages. Close any running `npm run dev` first.

## 1. Branch and extract

Run these one at a time:

```powershell
cd C:\Users\Chait\Downloads\practice-manager-next
git checkout main
git pull
git status --short
```

`git status --short` must print nothing.

```powershell
git checkout -b batch-8-ux
Expand-Archive -Path "$HOME\Downloads\duesk-batch-8.zip" -DestinationPath . -Force
git status --short
git add -A
git commit -m "Batch 8: UX pass, motion and loading states"
```

You should see about 33 changed files, plus 2 new ones (`NavigationProgress.tsx`, `Skeleton.tsx`).

## 2. Check

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npx tsc --noEmit
npm run build
npm run dev
```

Open http://localhost:3000. Test on your computer, and on your phone if you can: use Chrome's device toolbar (F12, then Ctrl+Shift+M, then pick a phone).

1. **Moving between pages:** click around the sidebar. A thin gold bar runs along the top, and each page fades in.
2. **Loading:** refresh Clients or Invoices. Grey shimmering rows and KPI placeholders appear briefly instead of a spinner and zeros.
3. **Hover:** move the mouse over the KPI cards; they lift slightly.
4. **Tasks:** overdue and open tasks are at the top, completed ones at the bottom.
5. **On a phone:** Tasks, Invoices, Quotations, Leads and Client discussions show cards with amount, status and dates. Invoice cards have Payment / Email / PDF.
6. **Dashboard:** buttons sit on one row, and Announcements is a single line when empty.
7. **Drafts:** a draft invoice shows no "due" amount.
8. **Help button:** scroll to the bottom of a long list; the Help button no longer covers the last row.

## 3. Put it live

```powershell
git push -u origin batch-8-ux
git checkout main
git merge --no-ff batch-8-ux -m "Merge batch 8: UX pass"
git push
```

## Undo

```powershell
git checkout main
git revert -m 1 HEAD
git push
```
