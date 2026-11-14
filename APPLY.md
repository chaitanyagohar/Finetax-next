# Applying Duesk batch 1

Preview and Production share one database, so the migration takes effect for the live site the moment it runs. Do the steps in this order, in one sitting, and not between 08:45 and 09:15 IST (the daily billing run is at 09:00).

## 1. Back up

```powershell
pg_dump "<your session pooler URL>" --format=custom --file "$HOME\Downloads\duesk-before-041.dump"
```

## 2. Pre-flight check (Supabase SQL Editor)

The schema dump already answered the questions about the other functions. This one query confirms the invoice rules have not changed since the dump of 13 Nov. It must return `true`; if it returns `false`, stop and tell me.

```sql
select md5(regexp_replace(prosrc, '\s+', '', 'g')) = '2115e029fea7b3acb32151e3e8e50eef' as invoice_rules_unchanged
from pg_proc where oid = 'public.invoices_before_write'::regproc;
```

## 3. Create a branch and extract the zip

```powershell
cd C:\Users\Chait\Downloads\practice-manager-next
git status
git checkout main
git pull
git checkout -b batch-1-gst
Expand-Archive -Path "$HOME\Downloads\duesk-batch-1.zip" -DestinationPath . -Force
git status
```

`git status` should list 13 modified files and 5 new ones (`CHANGES.md`, `APPLY.md`, `src/lib/gst.ts`, `supabase/migrations/041_invoice_issue_gst.sql`, `supabase/undo/041_invoice_issue_gst_undo.sql`). No files are deleted in this batch, so there is nothing to `git rm`.

If your repository already has a file numbered 041, tell me and I will renumber.

## 4. Check the build

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npx tsc --noEmit
npm run build
```

Both must finish without errors. `package-lock.json` is not in the zip; no dependency changed.

## 5. Run the migration

Open `supabase\migrations\041_invoice_issue_gst.sql`, paste the whole file into the Supabase SQL Editor and run it once. It is wrapped in begin/commit, so an error leaves the database as it was.

Then run this check:

```sql
select o.slug,
       count(*) filter (where i.status = 'Draft' and i.invoice_number is null)                      as drafts_without_number,
       count(*) filter (where i.status = 'Draft' and i.invoice_number is not null)                  as drafts_keeping_old_number,
       count(*) filter (where i.status not in ('Draft', 'Cancelled') and i.invoice_number is null)  as issued_without_number,
       count(*) filter (where i.status not in ('Draft', 'Cancelled') and i.buyer_name is null)       as issued_without_buyer,
       count(*) filter (where i.status not in ('Draft', 'Cancelled') and i.place_of_supply is null) as issued_without_place_of_supply
from public.invoices i join public.organizations o on o.id = i.org_id
group by o.slug order by o.slug;
```

- `issued_without_number` and `issued_without_buyer` must be 0 for every firm.
- For Finetax, expect the three drafts under either `drafts_without_number` (numbers released, the next issue continues the series) or `drafts_keeping_old_number` (a later number is already issued, so they kept theirs).
- `issued_without_place_of_supply` above 0 means that client has no state, or the state disagrees with the tax charged. Those invoices still print as before; look at them when convenient.

Clients that cannot be invoiced until a state is added (run once per firm you care about, or as is for all):

```sql
select o.slug, c.name, c.organization_name, c.state
from public.clients c join public.organizations o on o.id = c.org_id
where public.gst_place_of_supply(c.gstin, c.state) is null and coalesce(c.status, 'Active') = 'Active'
order by 1, 2;
```

Add a state to any client on a retainer before the next billing run, or that client's bill will stay a draft.

## 6. Deploy

```powershell
git add -A
git commit -m "Batch 1: invoice number on issue, stored place of supply, buyer snapshot (B-02, B-05, B-25, B-29)"
git push -u origin batch-1-gst
```

Test on the Vercel preview for the branch (checklist below), then merge:

```powershell
git checkout main
git merge batch-1-gst
git push
```

Until `main` is deployed, the live site runs the old code on the new database. Creating and viewing invoices still works, but do not email or approve a draft from the live site in that gap: the old code would send it without reloading the new number.

## 7. Test checklist

Use the test firm (`sharma-and-associates`) where you can.

1. **Client state.** Open a client without a state, try to save: it asks for a state. Choose one and save.
2. **New draft.** Invoices → New Invoice for a client in your own state. The list shows "Draft" in the number column, and the PDF says "No. Assigned on issue" with a DRAFT watermark.
3. **Tax split.** In the editor, the hint under Place of supply says CGST + SGST for a client in your state and IGST for a client in another state, including a client with no GSTIN. The totals box matches.
4. **Override.** As an administrator, change the place of supply on a draft and save: the tax split follows it. As a staff member with the Invoices module, the field is read-only.
5. **Issue.** Open a draft → Issue invoice. The toast shows the new number and date. The number is the next one in the series.
6. **Date order.** Create a draft dated before your last issued invoice, with a due date also in the past, and issue it: both dates become today.
7. **No state.** Create a draft for a client created from a lead (no state) and try to issue: it is refused with "Add the client's state on the Clients page before issuing this invoice." No number is used up.
8. **Email a draft.** Email a draft: the client receives a PDF with a number and no watermark, and the list shows it as Sent.
9. **Send error (B-29).** Disconnect the test firm's mailbox, or use a firm with none, and email a draft: the error says the invoice was issued but not emailed, and the list already shows it as Sent with its number.
10. **Buyer copy (B-25).** Note an issued invoice's Bill To block. Edit that client's address and organisation name. Reopen the invoice PDF: unchanged. A new draft for the same client shows the new details.
11. **Cancel.** Cancel a draft: the message says no number is affected. Cancel an issued invoice with no payments: its number stays.
12. **Quotation.** Convert a quotation: the message says a draft invoice was created, and the quotation row shows "Draft invoice" until it is issued.
13. **Retainer bill.** Packages → Billing → Run billing now (test firm). A draft bill shows "Draft"; Approve & send issues it and the email subject carries the number.
14. **Payments.** Record a part payment and a full payment on an issued invoice: Partially Paid, then Paid, as before.

## 8. How to undo

Code:

```powershell
git checkout main
git revert HEAD
git push
```

This works while the batch 1 commit is the latest one on `main`; otherwise use `git log --oneline` to find it and `git revert <its id>`. If the branch was not merged yet, `git checkout main` then `git branch -D batch-1-gst` is enough.

Database: paste `supabase\undo\041_invoice_issue_gst_undo.sql` into the SQL Editor and run it. It gives released numbers back to their drafts, numbers any draft created since, and restores the previous invoice rules. The new columns stay, unused. If a released number has since been used by a newly issued invoice, the script stops with a duplicate-number error and changes nothing; in that case tell me and I will write a forward fix instead.

Undo the code and the database together. The old code does not work correctly with the new rules, and the new code needs the new columns.
