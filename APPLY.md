# Applying batch 9

No migration. Code and font files only. Run these in PowerShell from your project folder.

## 1. New branch

```powershell
git checkout main
git pull
git checkout -b batch-9-theme
```

## 2. Unzip over the project

```powershell
Expand-Archive -Path "$HOME\Downloads\duesk-batch-9.zip" -DestinationPath . -Force
```

## 3. Remove the old font files

```powershell
git rm src/fonts/inter-latin-variable.woff2 src/fonts/OFL-Inter.txt
```

## 4. Check and build

```powershell
npx tsc --noEmit
npm run build
```

Both should finish without errors.

## 5. Look it over

```powershell
npm run dev
```

Open http://localhost:3000 and check:

- [ ] Sign-in page: illustration on the left, headline at the bottom, "Sign in" button
- [ ] Dashboard: coral highlight on the active sidebar item, rings and dots in the greeting card corner
- [ ] Hover and click buttons: colour fades and a slight press
- [ ] Open the bell and your profile menu: they pop in
- [ ] Tasks: switch List / Board / Queue: the content fades in
- [ ] Documents or Leads with no rows: small drawing in the empty state
- [ ] ₹ amounts look the same font as the numbers next to them
- [ ] Owner login: black sidebar with amber highlight, entry named "Firms"
- [ ] Phone width (browser dev tools, 390px): nothing overlaps

## 6. Commit and push

```powershell
git add -A
git commit -m "Batch 9: midnight and coral theme, Geist font, motion and artwork"
git push -u origin batch-9-theme
```

Check the Vercel preview, then merge to main.

## Undo

Before committing:

```powershell
git checkout main
git branch -D batch-9-theme
```

After merging:

```powershell
git revert <commit-id-of-batch-9>
git push
```
