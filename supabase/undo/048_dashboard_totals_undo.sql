-- Undo for 048_dashboard_totals.sql. Run only after rolling the app back to batch 3,
-- because the batch 4 dashboard and Clients page call these functions.
-- Drops only functions and indexes; no table data is touched.

begin;

drop function if exists public.dashboard_finance(date, date);
drop function if exists public.dashboard_crm();
drop function if exists public.client_balances();
drop function if exists public.try_date(text);

drop index if exists public.tasks_org_stage_due_idx;
drop index if exists public.tasks_org_approved_idx;
drop index if exists public.clients_org_name_idx;
drop index if exists public.invoices_org_created_idx;
drop index if exists public.invoice_payments_org_paid_idx;
drop index if exists public.leads_org_created_idx;
drop index if exists public.discussions_org_date_idx;

commit;
