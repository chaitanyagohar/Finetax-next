-- 048_dashboard_totals.sql
-- B-04: totals worked out in the database, so they stay right however many rows a firm has.
--   dashboard_finance(from, to): billed, collected, receivables, aging and the 6-month trend.
--   dashboard_crm(): open leads, follow-ups, win rate figures, quotation pipeline, client counts.
--   client_balances(): balance due per client for the Clients page.
-- All three run with the caller's rights, so the usual firm and module rules decide what is counted.
-- Also adds indexes for the lists that now load in pages.
-- Safe to run more than once. No data is dropped or deleted.

begin;

-- Older lead rows keep follow-up dates as text; a bad value must not break the dashboard.
create or replace function public.try_date(p_value text)
returns date
language plpgsql immutable set search_path = public
as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;
  return substr(p_value, 1, 10)::date;
exception when others then
  return null;
end;
$$;
revoke all on function public.try_date(text) from public, anon;
grant execute on function public.try_date(text) to authenticated, service_role;

-- p_from inclusive, p_to exclusive; both null means all time.
create or replace function public.dashboard_finance(p_from date default null, p_to date default null)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with today as (
    select (now() at time zone 'Asia/Kolkata')::date as d
  ),
  issued as (
    select coalesce(i.total, 0) as total,
           coalesce(i.date, i.issue_date, (i.created_at at time zone 'Asia/Kolkata')::date) as inv_date,
           i.due_date,
           greatest(coalesce(i.total, 0) - coalesce(i.amount_paid, 0), 0) as balance
    from public.invoices i
    where coalesce(i.status, 'Draft') not in ('Draft', 'Cancelled')
  ),
  in_period as (
    select * from issued
    where (p_from is null or inv_date >= p_from) and (p_to is null or inv_date < p_to)
  ),
  pays as (
    select p.amount, p.paid_on from public.invoice_payments p
  ),
  pays_in_period as (
    select * from pays
    where (p_from is null or paid_on >= p_from) and (p_to is null or paid_on < p_to)
  ),
  due as (
    select balance,
           coalesce((select d from today) - coalesce(due_date, inv_date), 0) as days_late
    from issued
    where balance > 0.009
  ),
  aging as (
    select case when days_late <= 0 then 0
                when days_late <= 30 then 1
                when days_late <= 60 then 2
                when days_late <= 90 then 3
                else 4 end as bucket,
           count(*) as n,
           sum(balance) as amount
    from due
    group by 1
  ),
  months as (
    select to_char(m, 'YYYY-MM') as key
    from generate_series(date_trunc('month', (select d from today)) - interval '5 months',
                         date_trunc('month', (select d from today)),
                         interval '1 month') as m
  ),
  billed_by_month as (
    select to_char(inv_date, 'YYYY-MM') as key, sum(total) as amount from issued group by 1
  ),
  collected_by_month as (
    select to_char(paid_on, 'YYYY-MM') as key, sum(amount) as amount from pays group by 1
  )
  select jsonb_build_object(
    'billed',            coalesce((select sum(total) from in_period), 0),
    'billed_count',      (select count(*) from in_period),
    'collected',         coalesce((select sum(amount) from pays_in_period), 0),
    'payments_count',    (select count(*) from pays_in_period),
    'outstanding',       coalesce((select sum(balance) from due), 0),
    'outstanding_count', (select count(*) from due),
    'aging', (
      select jsonb_agg(jsonb_build_object('bucket', b, 'count', coalesce(a.n, 0), 'amount', coalesce(a.amount, 0)) order by b)
      from generate_series(0, 4) as b
      left join aging a on a.bucket = b
    ),
    'trend', (
      select jsonb_agg(jsonb_build_object('month', m.key, 'billed', coalesce(bm.amount, 0), 'collected', coalesce(cm.amount, 0)) order by m.key)
      from months m
      left join billed_by_month bm on bm.key = m.key
      left join collected_by_month cm on cm.key = m.key
    ),
    'has_activity', exists (select 1 from issued) or exists (select 1 from pays)
  )
$$;
revoke all on function public.dashboard_finance(date, date) from public, anon;
grant execute on function public.dashboard_finance(date, date) to authenticated, service_role;

create or replace function public.dashboard_crm()
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with today as (
    select (now() at time zone 'Asia/Kolkata')::date as d
  ),
  l as (
    select lower(coalesce(status, '')) as s,
           converted_client_id,
           coalesce(follow_up_date, public.try_date("followUpDate")) as follow_up
    from public.leads
  ),
  q as (
    select coalesce(total, 0) as total
    from public.quotations
    where lower(coalesce(status, 'Draft')) in ('draft', 'sent')
      and coalesce(valid_until, public.try_date("validUntil"), (select d from today)) >= (select d from today)
  )
  select jsonb_build_object(
    'open_leads',           (select count(*) from l where s not in ('won', 'lost', 'converted', 'closed')),
    'lead_followups_due',   (select count(*) from l where s not in ('won', 'lost', 'converted', 'closed')
                                                     and follow_up <= (select d from today)),
    'won_leads',            (select count(*) from l where s = 'won' or converted_client_id is not null),
    'lost_leads',           (select count(*) from l where s = 'lost'),
    'open_quotes',          (select count(*) from q),
    'pipeline_value',       coalesce((select sum(total) from q), 0),
    'active_clients',       (select count(*) from public.clients where status is null or lower(status) = 'active'),
    'client_master',        (select count(*) from public.clients where status is distinct from 'Merged'),
    'discussion_followups', (select count(*) from public.discussions
                              where follow_up_date <= (select d from today) and not follow_up_completed)
  )
$$;
revoke all on function public.dashboard_crm() from public, anon;
grant execute on function public.dashboard_crm() to authenticated, service_role;

create or replace function public.client_balances()
returns table (client_id uuid, balance numeric)
language sql stable security invoker set search_path = public
as $$
  select i.client_id, sum(coalesce(i.total, 0) - coalesce(i.amount_paid, 0))
  from public.invoices i
  where i.client_id is not null
    and coalesce(i.status, 'Draft') not in ('Draft', 'Cancelled')
    and coalesce(i.total, 0) - coalesce(i.amount_paid, 0) > 0.009
  group by i.client_id
$$;
revoke all on function public.client_balances() from public, anon;
grant execute on function public.client_balances() to authenticated, service_role;

-- Indexes for the paged lists and the open-task loads
create index if not exists tasks_org_stage_due_idx on public.tasks (org_id, stage, due_date);
create index if not exists tasks_org_approved_idx on public.tasks (org_id, stage_changed_at desc) where stage = 'Approved';
create index if not exists clients_org_name_idx on public.clients (org_id, name);
create index if not exists invoices_org_created_idx on public.invoices (org_id, created_at desc);
create index if not exists invoice_payments_org_paid_idx on public.invoice_payments (org_id, paid_on);
create index if not exists leads_org_created_idx on public.leads (org_id, created_at desc);
create index if not exists discussions_org_date_idx on public.discussions (org_id, date desc);

commit;

-- Verification (one statement):
--
-- select public.dashboard_finance(null, null) ->> 'outstanding' as outstanding_all_firms,
--        (select count(*) from pg_indexes where schemaname = 'public' and indexname in
--          ('tasks_org_stage_due_idx', 'tasks_org_approved_idx', 'clients_org_name_idx', 'invoices_org_created_idx',
--           'invoice_payments_org_paid_idx', 'leads_org_created_idx', 'discussions_org_date_idx')) as new_indexes,
--        (select count(*) from pg_proc where proname in ('dashboard_finance', 'dashboard_crm', 'client_balances', 'try_date')) as new_functions;
--
-- Expected: new_indexes = 7 and new_functions = 4. In the SQL Editor you run as the owner, so
-- outstanding_all_firms adds up every firm; inside the app each firm sees only its own figure.
