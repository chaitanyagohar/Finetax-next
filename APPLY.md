# Applying batch 12

Two database migrations, then code, then settings in Supabase. Run the PowerShell commands from your project folder. Run the SQL in the Supabase SQL editor.

## 0. Make sure batch 11 is on main

```powershell
git checkout main
git pull
git log --oneline -3
```

If you already ran `059_support_view_fix.sql` from chat, it's fine to run it again below.

## 1. New branch and unzip

```powershell
git checkout -b batch-12
Expand-Archive -Path "$HOME\Downloads\duesk-batch-12.zip" -DestinationPath . -Force
```

## 2. Migrations (Supabase → SQL editor), in this order

Paste the whole file and click Run. Then run its check: the commented query at the bottom, with the leading `-- ` removed.

| File | Check should show |
|---|---|
| `supabase/migrations/059_support_view_fix.sql` | true |
| `supabase/migrations/060_security_and_email.sql` | 0, 10, 1, true |

Then:

```sql
notify pgrst, 'reload schema';
```

## 3. Check and build

```powershell
npx tsc --noEmit
npm run build
```

Both should finish without errors. There are no new packages and no new environment variables.

## 4. Supabase settings (section 3 of SECURITY_REVIEW.md)

Do at least these before testing email:
1. **Authentication → Emails → SMTP settings:** turn on custom SMTP with a mailbox you control. This is what sends sign-up, invitation and password-reset emails.
2. **Authentication → Multi-factor:** make sure TOTP is enabled.
3. **Authentication → URL configuration:** the Site URL is your live address.

## 5. Look it over

```powershell
npm run dev
```

Open http://localhost:3000.

**Email**
- [ ] As the owner, open Owner console → **Email**.
- [ ] If it says no sender:
  1. Open the Inbox in the Duesk workspace and connect a mailbox.
  2. Back on Owner console → Email, click **Use my workspace mailbox**.
- [ ] **Send me a test email.** It arrives, or the reason it failed is shown.
- [ ] As a finetax admin, open Settings → **Email activity** → **Send me a test email**. It arrives, or the reason is shown in the list.
- [ ] As a firm admin, grant support access (Settings → Your data and support):
  - [ ] The owner sees a notification and gets an email.
  - [ ] The notification opens the support view without the error.

**Two-step sign-in**
- [ ] Your name (top right) → **Sign-in security** → set it up with your phone.
- [ ] Sign out and in again: Duesk asks for the code, then opens.
- [ ] As an admin, on Sign-in security, tick **Require two-step sign-in for administrators**:
  - [ ] Sign in as another admin without it: they land on Sign-in security until they set it up.
  - [ ] Untick it again if you are only testing.
- [ ] Team management → key icon on someone → **Reset 2-step**.

**Other**
- [ ] Logs: change a team member's sections. An entry for the change appears.
- [ ] Settings → Export everything asks for your password.
- [ ] Attendance → Holidays and rules: change the quiet time, save, and reload. It stays changed.
- [ ] Setup wizard (`/setup`): the Firm step has the logo upload, and the last step lists the new next steps.
- [ ] Getting started (bottom left): the new items show. "Add your photo" opens your menu.
- [ ] Take the tours on Attendance and Branches and roles.

## 6. Commit and push

```powershell
git add -A
git commit -m "Batch 12: two-step sign-in, email checks, database activity log, security, setup and tours"
git push -u origin batch-12
```

After checking the Vercel preview:

```powershell
git checkout main
git merge --no-ff batch-12 -m "Merge batch 12"
git push
```

On the live site, turn on two-step sign-in for your owner account first.

## Undo

**Code:** `git checkout main` and `git branch -D batch-12` before merging, or `git revert -m 1 <merge-commit-id>` after.

**Database:** run `supabase/undo/060_security_and_email_undo.sql`, then `059_support_view_fix_undo.sql`. Activity entries already written are kept. Signed-out visitors stay without rights, because putting those back would only weaken security.

**If you're locked out of the owner account (lost phone)**, run in the SQL editor:

```sql
delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'YOUR-OWNER-EMAIL');
```
