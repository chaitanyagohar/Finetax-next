# Applying Duesk batch 2

Preview and Production share one database, so each migration takes effect for the live site as soon as it runs. Do the steps in order, in one sitting.

## 1. Back up

```powershell
pg_dump "<your session pooler URL>" --format=custom --file "$HOME\Downloads\duesk-before-042.dump"
```

## 2. Pre-flight checks (Supabase SQL Editor, one statement per run)

**Check A.** The rules batch 2 replaces are still as they were in the 13 Nov dump. Must return `true`.

```sql
select bool_and(md5(regexp_replace(prosrc, '\s+', '', 'g')) = case proname
         when 'email_accounts_guard_verified' then 'be679a9933d8d28fd53b57a768b0ea63'
         when 'firm_members' then 'ffdce3fb6c2cbf6a519f954aa4e3d4f4'
         when 'my_signup_state' then '4324a25dffe5065b12a7850d07c0370f'
         when 'protect_profiles' then '4f87fe744a76f40d48481e3b4c23100d' end)
       and count(*) = 4 as unchanged_since_dump
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('email_accounts_guard_verified', 'firm_members', 'my_signup_state', 'protect_profiles');
```

**Check B.** Duesk's own mailbox, which emails the ownership codes. At least one row must show `is_active = true` and `connection_tested = true`.

```sql
select a.email_address, a.is_active, a.verified_at is not null as connection_tested
from public.email_accounts a
where a.org_id = (select support_org_id from public.platform_config where id);
```

If it returns no rows, connect a mailbox in the Oddlambda workspace (Inbox → Connected Accounts) and test it before going on. Without it, **Confirm address** shows "Duesk could not send the confirmation code".

## 3. Create a branch and extract the zip

```powershell
cd C:\Users\Chait\Downloads\practice-manager-next
git status
git checkout main
git pull
git checkout -b batch-2-security
Expand-Archive -Path "$HOME\Downloads\duesk-batch-2.zip" -DestinationPath . -Force
git status
```

`git status` should list 19 modified files and 12 new ones (including `CHANGES.md` and `APPLY.md`, which replace batch 1's). No files are deleted, so there is nothing to `git rm`.

## 4. Check the build

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npx tsc --noEmit
npm run build
```

Both must finish without errors.

## 5. Run the migrations

In the SQL Editor, open each file from `supabase\migrations\`, paste the whole file and run it, in this order: **042, 043, 044, 045, 046**. Each is wrapped in begin/commit, so an error leaves the database as it was; if one fails, stop and send me the message. Each can be run again safely.

You do **not** need to run 041 again now; step 7 uses it.

After each one, run its check (also in the comment at the end of each file):

**042.** Your two Finetax mailboxes should show `ownership_confirmed = true`.

```sql
select o.slug, a.email_address, a.is_active, a.verified_at is not null as connection_tested,
       a.ownership_confirmed_at is not null as ownership_confirmed
from public.email_accounts a join public.organizations o on o.id = a.org_id
order by 1, 2;
```

**043.** Each mailbox lists the non-admin staff who had the Firm inbox module. Administrators are not listed; they always have access.

```sql
select o.slug, a.email_address, count(m.user_id) as staff_with_access,
       string_agg(p.name, ', ' order by p.name) as staff
from public.email_accounts a
join public.organizations o on o.id = a.org_id
left join public.email_account_members m on m.account_id = a.id
left join public.profiles p on p.id = m.user_id
group by 1, 2 order by 1, 2;
```

**044.** `active_without_acceptance` must be 0 for every firm.

```sql
select o.slug,
       count(*) filter (where m.accepted_at is not null) as members,
       count(*) filter (where m.accepted_at is null and not m.is_active) as invitations_waiting,
       count(*) filter (where m.accepted_at is null and m.is_active) as active_without_acceptance
from public.memberships m join public.organizations o on o.id = m.org_id
group by 1 order by 1;
```

**045.** Expect 0 in every row. A number above 0 is existing work already given to someone outside that firm; it is left alone and can be reassigned from the page.

```sql
select 'tasks.assigned_to' as field, count(*) as outside_firm from public.tasks t
 where t.assigned_to is not null and not exists (select 1 from public.memberships m where m.user_id = t.assigned_to and m.org_id = t.org_id)
union all
select 'tasks.reviewer_id', count(*) from public.tasks t
 where t.reviewer_id is not null and not exists (select 1 from public.memberships m where m.user_id = t.reviewer_id and m.org_id = t.org_id)
union all
select 'leads.assigned_to', count(*) from public.leads l
 where l.assigned_to is not null and not exists (select 1 from public.memberships m where m.user_id = l.assigned_to and m.org_id = l.org_id)
union all
select 'clients.assigned_to', count(*) from public.clients c
 where c.assigned_to is not null and not exists (select 1 from public.memberships m where m.user_id = c.assigned_to and m.org_id = c.org_id);
```

**046.** Expect `delete_guards = 5` and `package_fk_rule = r`.

```sql
select (select count(*) from pg_trigger where not tgisinternal and tgname in
         ('tasks_before_delete', 'email_accounts_before_delete', 'quotations_before_delete',
          'proposals_before_delete', 'service_packages_before_delete')) as delete_guards,
       (select confdeltype from pg_constraint where conname = 'client_packages_package_id_fkey') as package_fk_rule;
```

## 6. Deploy

```powershell
git add -A
git commit -m "Batch 2: mailbox ownership and access, invitation consent, firm-scoped people, delete protections (S-02, S-12, S-06, S-21, S-22, D-05)"
git push -u origin batch-2-security
```

Test on the Vercel preview for the branch (checklist below), then merge:

```powershell
git checkout main
git merge batch-2-security
git push
```

Until `main` is deployed, the live site runs the old code on the new database. In that gap, **don't remove a mailbox or delete a package** on the live site. The old code deletes a mailbox's emails, or a package's service list, before the step the database now refuses.

## 7. Fix the invoice without a place of supply (INV/2026-27/0001, N.Z.I.E)

041 leaves the place of supply empty when the client record has no state, or when the client's state contradicts the tax already charged. Run this to see which it is:

```sql
select i.invoice_number, i.is_inter_state, i.cgst, i.sgst, i.igst,
       c.organization_name, c.state, c.gstin, c.address,
       public.gst_place_of_supply(c.gstin, c.state) as client_state_code
from public.invoices i join public.clients c on c.id = i.client_id
where i.status not in ('Draft', 'Cancelled') and i.place_of_supply is null;
```

- **`client_state_code` is empty** (most likely): the client has no state on record.
  1. On the Clients page, set the society's state. If CGST + SGST was charged and the society is in Delhi, that is Delhi.
  2. In the SQL Editor, run the whole of `supabase\migrations\041_invoice_issue_gst.sql` from this zip once more. It fills the place of supply on that invoice and changes nothing else; the amounts and the payment stay as they are.
  3. Re-run the batch 1 check query: `issued_without_place_of_supply` should be 0.
- **`client_state_code` has a value:** the client's state disagrees with the tax charged, for example CGST + SGST on a client outside Delhi. That is a tax-head question, not a data gap, so Duesk should not paper over it. Send me the row and tell me how you want it treated (for example, credit note and fresh invoice), and I'll fold it into the next batch.

## 8. Test checklist

Use the test firm (`sharma-and-associates`) and a second login you control where you can.

1. **Confirmed mailboxes.** Inbox → Connected Accounts as a Finetax admin: both mailboxes show "Address confirmed".
2. **Confirm an address.** In Sharma, connect a mailbox you can read and test it: it shows "Address not confirmed" with a note. Click **Confirm address** → **Email me a code**. The code arrives from Duesk's mailbox. Enter a wrong code: it is refused. Enter the right code: "Address confirmed".
3. **Webhook.** If you forward mail to Duesk, mail to an unconfirmed address no longer appears in the inbox; after confirming, it does.
4. **Who can use it.** As a Finetax admin, open **Who can use it** on a mailbox and untick a staff member. Signed in as that staff member: the mailbox and its emails are gone from the inbox, and the other mailboxes are still there. Tick them again: it comes back.
5. **Remove a mailbox with emails.** It is refused with "This mailbox has emails in Duesk…". **Disable** still works.
6. **Invite an existing login.** From Sharma, invite an email that already uses Duesk in Finetax. The toast says "Invitation sent… They join your firm once they accept." Sharma's Team page shows them as pending, under the name you typed.
7. **Decline, then accept.** Sign in as that person: a bar shows the invitation. **Decline**: it disappears, and so does the pending row on Sharma's Team page. Invite again and **Accept**: the bar offers to open Sharma, and the firm switcher lists both firms.
8. **Pending has no say.** Before they accept, Login security on that pending row in Sharma does nothing to their login (the person is reported as not found).
9. **Invite a new email.** Works as before: they receive the set-password email.
10. **People per firm.** As the person in both firms, while working in Sharma, task assignee and reviewer lists show only Sharma people. Switch to Finetax: only Finetax people.
11. **Task delete.** Delete a task with time logged: refused, with the reason. Delete a new empty task: works.
12. **Quotation delete.** Only draft quotations show Delete.
13. **Package delete.** A package any client is or was on shows no Delete button; Archive works. A new unused package can be deleted.
14. **Batch 1 still fine.** Issue a draft invoice: it gets the next number.

## 9. How to undo

Code:

```powershell
git checkout main
git revert HEAD
git push
```

This works while the batch 2 commit is the latest one on `main`; otherwise use `git log --oneline` to find it and `git revert <its id>`.

Database: paste `supabase\undo\042_046_security_undo.sql` into the SQL Editor and run it. It restores the previous rules exactly. The new tables and columns stay, unused, so no data is lost. Invitations still waiting for an answer become inactive members; cancel them from the Team page. If two firms have tested the same mailbox address by then, the undo stops and changes nothing, naming the address; send me that message.

Undo the code and the database together.
