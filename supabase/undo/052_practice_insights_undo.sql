-- Undo for 052_practice_insights.sql. Run after the undo files for 054 and 053.
-- Removes rates, billed-time tracking, insights and the morning email. Deletes every saved rate and
-- forgets which time was invoiced (the invoices themselves stay).

begin;

drop function if exists public.firm_daily_digest(uuid);
alter table public.firm_settings drop column if exists morning_digest;
alter table public.firm_settings drop column if exists remind_all_invoices;
drop function if exists public.review_flow(date, date);
drop function if exists public.practice_profitability(date, date);
drop function if exists public.invoice_unbilled_time(uuid, uuid[], text);
drop function if exists public.unbilled_time(uuid);
drop trigger if exists invoices_release_time on public.invoices;
drop function if exists public.invoices_release_time();
drop trigger if exists time_logs_billed_guard on public.time_logs;
drop function if exists public.time_logs_billed_guard();
drop index if exists public.time_logs_unbilled_idx;
drop index if exists public.time_logs_invoice_idx;
alter table public.time_logs drop column if exists invoice_id;
drop table if exists public.member_rates;

commit;
