# Duesk batch 1: GST correctness for invoices

Built on `duesk-src-v2.zip` (current main) and tested against `supabase/schema_2026-11-13.sql`. This replaces the first `duesk-batch-1.zip`; discard that one.

Findings fixed: **B-02**, **B-05**, **B-25**, **B-29**. Part of **P-04** (the GST state map and GSTIN/PAN checks now live in one module).

## What changes for users

- A draft invoice has no number. It takes the next number in the firm's series when it is issued (Issue invoice, Email, Approve & send, or the billing run).
- On issue, the invoice keeps the date typed on the draft. If that date is in the future, in an earlier financial year, or earlier than the last invoice already issued in the series, the invoice is dated today instead. If the due date would then fall before the new invoice date, it moves to the invoice date.
- Each invoice stores its place of supply. It defaults to the state in the client's GSTIN, otherwise the state on the client record. An administrator can change it on a draft. IGST or CGST + SGST is worked out from it by the database; the manual GST type choice is gone.
- An invoice cannot be issued until the client has a state, and (when it charges GST) the firm has a GSTIN in Settings.
- When an invoice is issued, the buyer's name, contact, address, GSTIN, PAN and state are copied onto it. Reprints use that copy, so editing or merging a client no longer changes past invoices.
- State is now a required choice on the client form. CSV import warns about a missing or unrecognised state but still imports the row.
- A payment cannot be recorded against a draft. The page already hid the button; the database now refuses it too, because a paid invoice must have a number.
- The "Issue your first invoice" step in Getting started is ticked when an invoice is issued, not when a draft is saved.
- After a failed email, the Invoices and Quotations pages reload, so a document the server has already issued no longer shows as Draft.

## Files

| File | Status | Reason |
|---|---|---|
| `supabase/migrations/041_invoice_issue_gst.sql` | NEW | Number on issue, stored place of supply, buyer copy on issue, tax split decided in the database (B-02, B-05, B-25) |
| `supabase/undo/041_invoice_issue_gst_undo.sql` | NEW | Tested rollback for migration 041 |
| `src/lib/gst.ts` | NEW | One GST state list, GSTIN/PAN formats and the place-of-supply default (P-04, B-05) |
| `src/app/invoices/page.tsx` | MODIFIED | Drafts shown without a number, place of supply field, issue and cancel wording, reload after a send error, redundant browser status update removed (B-02, B-05, B-29) |
| `src/lib/pdf/firmDocuments.tsx` | MODIFIED | Invoice PDF prints the stored buyer details and place of supply; a draft prints "Assigned on issue" instead of a number (B-05, B-25) |
| `src/lib/billing/invoiceMailer.ts` | MODIFIED | Reloads a bill after issuing it, so the email carries the new number, date and tax (B-02) |
| `src/app/api/invoices/send/route.ts` | MODIFIED | Success message names the invoice and recipient |
| `src/app/api/invoices/route.ts` | MODIFIED | Comment and audit entry no longer refer to a number at draft stage (B-02) |
| `src/app/quotations/page.tsx` | MODIFIED | Reload after a send error, redundant browser status update removed, wording for a converted draft invoice (B-29, B-02) |
| `src/app/clients/page.tsx` | MODIFIED | State is a required choice from the standard list; import normalises state names; shared GST module (B-05, P-04) |
| `src/app/settings/page.tsx` | MODIFIED | Uses the shared GST module (P-04) |
| `src/app/setup/page.tsx` | MODIFIED | Uses the shared GST module (P-04) |
| `src/app/api/admin/firm-settings/route.ts` | MODIFIED | Uses the shared GSTIN/PAN formats (P-04) |
| `src/components/packages/SubscriptionBilling.tsx` | MODIFIED | Draft bills show "Draft" in the number column (B-02) |
| `src/app/page.tsx` | MODIFIED | Dashboard shows "Draft" for an invoice without a number (B-02) |
| `src/lib/onboarding/tours.ts` | MODIFIED | Two invoice tour lines now describe the new behaviour (B-02, B-05) |

No files deleted. No dependency changes; `package.json` and `package-lock.json` are untouched.

## Overlap with fixes already on main

All 13 modified files were byte-for-byte the same in v2 as the copy I had reviewed, so the fixes on main are in the base and my changes sit on top of them. The files that carry one of those fixes:

| File | Fix on main | How it was kept |
|---|---|---|
| `src/app/api/invoices/send/route.ts` | B-03: issue the draft on the server, reload, then render the PDF; 0% GST wording | Only the success message changed. The issue, reload and PDF order is untouched, and it is what makes the emailed PDF carry the new number. |
| `src/lib/billing/invoiceMailer.ts` | Used by `api/billing/run` (S-04, B-06) and `api/billing/send` | Same signature and return shape. It now reloads the bill after issuing, mirroring the B-03 pattern, because the number no longer exists before issue. `api/billing/run` and `api/billing/send` are not modified. |
| `src/app/quotations/page.tsx` | Works with the B-03 fix in `api/quotations/send` | The browser no longer repeats the status update the server already makes; it reloads instead. The API route is not modified. |
| `src/app/invoices/page.tsx` | Works with the B-03 fix in `api/invoices/send` | Same as above for invoices. |
| `src/components/packages/SubscriptionBilling.tsx` | Calls the firm-scoped billing run (S-04) | One display cell changed; the calls are untouched. |

Not touched at all: `api/billing/run`, `api/send-email` (S-01), `login` (S-03), `api/admin/update-member`, `layout.tsx`, `package.json`, `package-lock.json`.

## Database functions checked against drafts with no number

Read from the schema dump and run on a local copy of it:

- `convert_quotation_to_invoice`: inserts a draft and returns its number, which is now empty. No change needed. The quotations page shows "Draft invoice" until it is issued. The trigger recalculates the tax from the place of supply, so a quotation marked intra-state for an out-of-state client becomes an IGST draft.
- `generate_subscription_bills(p_run_date, p_org)`: inserts drafts and never reads the new draft's number. Its late fee line quotes the number of an overdue invoice, which is always issued and so always numbered. No change needed. Its own GSTIN-only inter-state test is now overridden by the trigger, which also covers clients without a GSTIN.
- `merge_clients`: moves invoices to the kept client with triggers off. Issued invoices keep their stored buyer details, which is the point of B-25.
- `invoice_payments_before_insert` / `sync_invoice_paid`: unchanged; they now meet the new rule that a draft cannot take a payment.
- `my_onboarding`: counts invoices that have a number, so the step now means "issued".

## What migration 041 does

1. Adds columns to `invoices`: `place_of_supply`, `buyer_name`, `buyer_contact`, `buyer_address`, `buyer_gstin`, `buyer_pan`, `buyer_state_code`, `issued_at`.
2. Adds two helper functions, `gst_state_code` and `gst_place_of_supply` (not callable from the browser).
3. Existing drafts that hold a number: where every numbered draft sits above the last issued invoice in its series, the numbers are released and the counter is wound back, so the series continues with no gap. Released numbers are recorded in `zz_041_released_draft_numbers`. Where a draft sits below an issued invoice, it keeps its number.
4. Invoices already issued get the buyer details from the client record as it is today, and a place of supply where it agrees with the tax already charged. Their amounts are not touched.
5. Replaces `invoices_before_write` with the new rules. Everything it enforced before is kept. No other function is changed.
6. Adds a check that an issued invoice always has a number.

## Decisions applied

As you confirmed: (1) numbered drafts release their numbers where safe, otherwise keep them; (2) the draft's date stands if it is in order, otherwise today; (3) a client without a state can be drafted but not issued; (4) only administrators can override the place of supply; (5) already-issued invoices are filled from today's client record. Quotations keep their current numbering.

## Known limits

- SEZ supplies and exports are not handled; that belongs with B-18.
- Dashboard and Invoices totals are still computed in the browser (B-04, batch 3).
- `UUID_RE`, `EMAIL_RE`, `inr` and `dmy` duplicates are left for batch 4, to keep this batch to GST files.
- `npm ci` passes on Windows but fails on Linux for this lock file ("Missing: @emnapi/runtime, @emnapi/core from lock file"). It does not affect this batch; I have added it to batch 5 with the font and `npm audit` work.

## How it was checked

- `npx tsc --noEmit`: 0 errors, on a fresh copy of v2 with this zip extracted over it.
- `npm run build`: passes, 63 routes. Google Fonts cannot be reached from the build sandbox, so the two font downloads were stubbed for the check; no source file was changed for this.
- Schema: `supabase/schema_2026-11-13.sql` was loaded into a local PostgreSQL 16 (your database is 17; the only load errors were two PostgreSQL 17-only privilege grants). Two firms, clients, old-style numbered drafts, a retainer and a quotation were added with the live triggers in place.
- Migration 041 was run twice on that copy, then 49 checks passed: numbering, date order, financial year, due date, IGST for an unregistered out-of-state client, buyer copy and locks, administrator-only override, staff working through row-level security, payments, `convert_quotation_to_invoice`, two `generate_subscription_bills` runs including a late fee line, `merge_clients`, and a server insert with no firm context.
- The undo script was run on a second copy and restored the previous rules and numbers.
- Sample invoice PDFs (issued, draft, pre-041) were rendered and read back.
- ESLint on the touched files: no new problems (136 before, 136 after).
- Not checked: the migration against your real data, and the pages in a browser. The test checklist in `APPLY.md` covers the browser side.
