-- 052_practice_insights.sql
-- Batch 10, partner insights.
--   1. member_rates: each person's billing rate and cost per hour (admins only).
--   2. time_logs.invoice_id: billable time that has been invoiced. Billed time can't be changed, and
--      cancelling the invoice releases it again.
--   3. unbilled_time() / invoice_unbilled_time(): turn billable hours into a draft invoice.
--   4. practice_profitability(): revenue, collections, time cost and margin per client and per person.
--   5. review_flow(): how long work waits for review, per reviewer.
--   6. firm_settings.remind_all_invoices / morning_digest, and firm_daily_digest() for the morning email.
-- Safe to run more than once. No data is dropped or deleted.

begin;

-- ---------------------------------------------------------------- 1. Rates
create table if not exists public.member_rates (
  org_id     uuid not null default public.default_org_id() references public.organizations(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  bill_rate  numeric(12, 2) not null default 0 check (bill_rate >= 0 and bill_rate <= 1000000),
  cost_rate  numeric(12, 2) not null default 0 check (cost_rate >= 0 and cost_rate <= 1000000),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
alter table public.member_rates enable row level security;
revoke all on public.member_rates from anon;
grant select, insert, update, delete on public.member_rates to authenticated;
grant all on public.member_rates to service_role;
drop policy if exists org_isolation on public.member_rates;
create policy org_isolation on public.member_rates as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));
drop policy if exists member_rates_admin on public.member_rates;
create policy member_rates_admin on public.member_rates for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()) and exists (
    select 1 from public.memberships m where m.org_id = member_rates.org_id and m.user_id = member_rates.user_id));

-- ---------------------------------------------------------------- 2. Billed time
alter table public.time_logs add column if not exists invoice_id uuid references public.invoices(id) on delete set null;
create index if not exists time_logs_invoice_idx on public.time_logs (invoice_id) where invoice_id is not null;
create index if not exists time_logs_unbilled_idx on public.time_logs (org_id, client_id, log_date) where invoice_id is null and is_billable;

create or replace function public.time_logs_billed_guard()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.invoice_id is not null then
      raise exception 'This time is billed on an invoice. Cancel that invoice first.';
    end if;
    return old;
  end if;
  if old.invoice_id is not null and new.invoice_id is not distinct from old.invoice_id and (
       new.hours is distinct from old.hours or new.client_id is distinct from old.client_id
    or new.is_billable is distinct from old.is_billable or new.log_date is distinct from old.log_date) then
    raise exception 'This time is billed on an invoice and can''t be changed.';
  end if;
  return new;
end $$;
drop trigger if exists time_logs_billed_guard on public.time_logs;
create trigger time_logs_billed_guard before update or delete on public.time_logs
  for each row execute function public.time_logs_billed_guard();
revoke execute on function public.time_logs_billed_guard() from public, anon, authenticated;

create or replace function public.invoices_release_time()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then
    update public.time_logs set invoice_id = null where invoice_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists invoices_release_time on public.invoices;
create trigger invoices_release_time after update of status on public.invoices
  for each row when (coalesce(current_setting('app.bulk_move', true), 'off') <> 'on')
  execute function public.invoices_release_time();
revoke execute on function public.invoices_release_time() from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. Unbilled time
create or replace function public.unbilled_time(p_client uuid default null)
returns table (id uuid, client_id uuid, client_label text, user_id uuid, person text, task_id uuid, task_title text,
               period text, log_date date, description text, hours numeric, bill_rate numeric, value numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can see unbilled time.';
  end if;
  return query
  select l.id, l.client_id, coalesce(nullif(trim(c.organization_name), ''), c.name), l.user_id, coalesce(p.name, 'Former member'),
         l.task_id, t.title, t.period, l.log_date, l.description, l.hours, coalesce(r.bill_rate, 0),
         round(l.hours * coalesce(r.bill_rate, 0), 2)
    from public.time_logs l
    join public.clients c on c.id = l.client_id
    left join public.profiles p on p.id = l.user_id
    left join public.tasks t on t.id = l.task_id
    left join public.member_rates r on r.org_id = l.org_id and r.user_id = l.user_id
   where l.org_id = public.current_org_id() and l.is_billable and l.invoice_id is null
     and l.log_date >= (now() at time zone 'Asia/Kolkata')::date - 365
     and (p_client is null or l.client_id = p_client)
   order by 3, l.log_date;
end $$;
revoke execute on function public.unbilled_time(uuid) from public, anon;
grant execute on function public.unbilled_time(uuid) to authenticated;

-- p_detail: 'task' gives one line per task and rate, 'summary' one line for everything
create or replace function public.invoice_unbilled_time(p_client uuid, p_log_ids uuid[], p_detail text default 'task')
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_items jsonb;
  v_invoice uuid;
  v_firm public.firm_settings%rowtype;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_count int;
  v_from date;
  v_to date;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can invoice time.';
  end if;
  if not exists (select 1 from public.clients where id = p_client and org_id = v_org) then
    raise exception 'Client not found.';
  end if;

  perform 1 from public.time_logs
   where id = any(p_log_ids) and org_id = v_org and client_id = p_client and is_billable and invoice_id is null
   for update;
  select count(*), min(log_date), max(log_date) into v_count, v_from, v_to from public.time_logs
   where id = any(p_log_ids) and org_id = v_org and client_id = p_client and is_billable and invoice_id is null;
  if v_count = 0 then
    raise exception 'Choose unbilled time for this client.';
  end if;
  select * into v_firm from public.firm_settings where org_id = v_org;

  if p_detail = 'summary' then
    select jsonb_build_array(jsonb_build_object(
             'description', 'Professional services, ' || to_char(v_from, 'DD/MM/YYYY') || ' to ' || to_char(v_to, 'DD/MM/YYYY'),
             'qty', 1,
             'rate', round(sum(l.hours * coalesce(r.bill_rate, 0)), 2))
             || case when v_firm.default_sac is not null then jsonb_build_object('sac', v_firm.default_sac) else '{}'::jsonb end)
      into v_items
      from public.time_logs l
      left join public.member_rates r on r.org_id = l.org_id and r.user_id = l.user_id
     where l.id = any(p_log_ids) and l.org_id = v_org and l.client_id = p_client and l.is_billable and l.invoice_id is null;
  else
    select jsonb_agg(x.item order by x.label) into v_items
      from (
        select coalesce(t.title || coalesce(' (' || t.period || ')', ''), 'Professional services') as label,
               jsonb_build_object(
                 'description', coalesce(t.title || coalesce(' (' || t.period || ')', ''), 'Professional services')
                                || ' · ' || trim(to_char(sum(l.hours), 'FM9999990.##')) || ' h',
                 'qty', round(sum(l.hours), 2),
                 'rate', coalesce(r.bill_rate, 0))
               || case when v_firm.default_sac is not null then jsonb_build_object('sac', v_firm.default_sac) else '{}'::jsonb end as item
          from public.time_logs l
          left join public.tasks t on t.id = l.task_id
          left join public.member_rates r on r.org_id = l.org_id and r.user_id = l.user_id
         where l.id = any(p_log_ids) and l.org_id = v_org and l.client_id = p_client and l.is_billable and l.invoice_id is null
         group by t.id, t.title, t.period, r.bill_rate
      ) x;
  end if;

  insert into public.invoices (org_id, client_id, status, gst_rate, items, date, issue_date, due_date, notes)
  values (v_org, p_client, 'Draft', coalesce(v_firm.default_gst_rate, 18), v_items, v_today, v_today, v_today + 15,
          coalesce('Payment Terms: ' || nullif(trim(v_firm.payment_terms), ''), ''))
  returning id into v_invoice;

  update public.time_logs set invoice_id = v_invoice
   where id = any(p_log_ids) and org_id = v_org and client_id = p_client and is_billable and invoice_id is null;
  return v_invoice;
end $$;
revoke execute on function public.invoice_unbilled_time(uuid, uuid[], text) from public, anon;
grant execute on function public.invoice_unbilled_time(uuid, uuid[], text) to authenticated;

-- A deleted draft gives its time back (the foreign key clears invoice_id)

-- ---------------------------------------------------------------- 4. Profitability
create or replace function public.practice_profitability(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_clients jsonb;
  v_staff jsonb;
  v_working int;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can see profitability.';
  end if;

  with inv as (
    select client_id, sum(subtotal) as revenue
      from public.invoices
     where org_id = v_org and status not in ('Draft', 'Cancelled') and date between p_from and p_to
     group by client_id
  ), paid as (
    select i.client_id, sum(p.amount) as collected
      from public.invoice_payments p join public.invoices i on i.id = p.invoice_id
     where p.org_id = v_org and p.paid_on between p_from and p_to
     group by i.client_id
  ), tl as (
    select l.client_id, sum(l.hours) as hours,
           sum(l.hours * coalesce(r.cost_rate, 0)) as cost,
           sum(case when l.is_billable then l.hours * coalesce(r.bill_rate, 0) else 0 end) as billable_value
      from public.time_logs l
      left join public.member_rates r on r.org_id = l.org_id and r.user_id = l.user_id
     where l.org_id = v_org and l.log_date between p_from and p_to and l.client_id is not null
     group by l.client_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'client_id', c.id,
           'client', coalesce(nullif(trim(c.organization_name), ''), c.name),
           'revenue', coalesce(inv.revenue, 0),
           'collected', coalesce(paid.collected, 0),
           'hours', round(coalesce(tl.hours, 0), 2),
           'cost', round(coalesce(tl.cost, 0), 2),
           'billable_value', round(coalesce(tl.billable_value, 0), 2),
           'margin', round(coalesce(inv.revenue, 0) - coalesce(tl.cost, 0), 2)
         ) order by coalesce(inv.revenue, 0) - coalesce(tl.cost, 0) desc), '[]'::jsonb)
    into v_clients
    from public.clients c
    left join inv on inv.client_id = c.id
    left join paid on paid.client_id = c.id
    left join tl on tl.client_id = c.id
   where c.org_id = v_org and (inv.client_id is not null or paid.client_id is not null or tl.client_id is not null);

  select count(*) into v_working from generate_series(p_from, p_to, interval '1 day') d where extract(isodow from d) < 7;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', m.user_id,
           'name', coalesce(p.name, m.invited_name, 'Member'),
           'hours', round(coalesce(s.hours, 0), 2),
           'billable_hours', round(coalesce(s.billable, 0), 2),
           'bill_rate', coalesce(r.bill_rate, 0),
           'cost_rate', coalesce(r.cost_rate, 0),
           'cost', round(coalesce(s.hours, 0) * coalesce(r.cost_rate, 0), 2),
           'billable_value', round(coalesce(s.billable, 0) * coalesce(r.bill_rate, 0), 2),
           'billed_value', round(coalesce(s.billed, 0) * coalesce(r.bill_rate, 0), 2),
           'available_hours', v_working * 8
         ) order by coalesce(s.hours, 0) desc), '[]'::jsonb)
    into v_staff
    from public.memberships m
    left join public.profiles p on p.id = m.user_id
    left join public.member_rates r on r.org_id = m.org_id and r.user_id = m.user_id
    left join (
      select user_id, sum(hours) as hours,
             sum(case when is_billable then hours else 0 end) as billable,
             sum(case when invoice_id is not null then hours else 0 end) as billed
        from public.time_logs
       where org_id = v_org and log_date between p_from and p_to
       group by user_id
    ) s on s.user_id = m.user_id
   where m.org_id = v_org and (m.is_active or s.hours is not null);

  return jsonb_build_object('clients', v_clients, 'staff', v_staff, 'working_days', v_working);
end $$;
revoke execute on function public.practice_profitability(date, date) from public, anon;
grant execute on function public.practice_profitability(date, date) to authenticated;

-- ---------------------------------------------------------------- 5. Review flow
create or replace function public.review_flow(p_from date, p_to date)
returns table (reviewer_id uuid, reviewer text, waiting_now int, oldest_waiting_hours numeric, approved int,
               avg_review_hours numeric, returned_share numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can see review flow.';
  end if;
  return query
  with mine as (
    select t.* from public.tasks t where t.org_id = public.current_org_id() and t.reviewer_id is not null
  )
  select r.reviewer_id, coalesce(p.name, 'Former member'),
         count(*) filter (where r.stage = 'Submitted for Review')::int,
         round(max(extract(epoch from (now() - r.submitted_at)) / 3600) filter (where r.stage = 'Submitted for Review'), 1),
         count(*) filter (where r.stage = 'Approved' and (r.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::int,
         round(avg(extract(epoch from (r.stage_changed_at - r.submitted_at)) / 3600)
               filter (where r.stage = 'Approved' and r.submitted_at is not null
                         and (r.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to), 1),
         round(avg(case when coalesce(r.return_count, 0) > 0 then 1.0 else 0.0 end)
               filter (where r.stage = 'Approved' and (r.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to), 3)
    from mine r
    left join public.profiles p on p.id = r.reviewer_id
   group by r.reviewer_id, p.name
  having count(*) filter (where r.stage = 'Submitted for Review') > 0
      or count(*) filter (where r.stage = 'Approved' and (r.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to) > 0
   order by 3 desc, 4 desc nulls last;
end $$;
revoke execute on function public.review_flow(date, date) from public, anon;
grant execute on function public.review_flow(date, date) to authenticated;

-- ---------------------------------------------------------------- 6. Reminders and the morning email
alter table public.firm_settings add column if not exists remind_all_invoices boolean not null default false;
alter table public.firm_settings add column if not exists morning_digest boolean not null default true;

create or replace function public.firm_daily_digest(p_org uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with d as (select (now() at time zone 'Asia/Kolkata')::date as today)
  select jsonb_build_object(
    'collected_yesterday', (select coalesce(sum(p.amount), 0) from public.invoice_payments p, d where p.org_id = p_org and p.paid_on = d.today - 1),
    'payments_yesterday', (select count(*) from public.invoice_payments p, d where p.org_id = p_org and p.paid_on = d.today - 1),
    'receivables', (select coalesce(sum(greatest(coalesce(total, 0) - coalesce(amount_paid, 0), 0)), 0) from public.invoices
                     where org_id = p_org and status in ('Sent', 'Partially Paid', 'Overdue')),
    'statutory_today', (select count(*) from public.tasks t, d where t.org_id = p_org and t.stage <> 'Approved' and t.official_due_date = d.today),
    'statutory_week', (select count(*) from public.tasks t, d where t.org_id = p_org and t.stage <> 'Approved'
                         and t.official_due_date between d.today and d.today + 7),
    'overdue', (select count(*) from public.tasks t, d where t.org_id = p_org and t.stage <> 'Approved' and t.due_date < d.today),
    'awaiting_review', (select count(*) from public.tasks t where t.org_id = p_org and t.stage = 'Submitted for Review'),
    'new_leads', (select count(*) from public.leads l, d where l.org_id = p_org and (l.created_at at time zone 'Asia/Kolkata')::date = d.today - 1),
    'due_week', (select coalesce(jsonb_agg(x order by x->>'date'), '[]'::jsonb) from (
                   select jsonb_build_object('title', t.title, 'period', t.period, 'date', t.official_due_date,
                            'client', coalesce(nullif(trim(c.organization_name), ''), c.name)) as x
                     from public.tasks t left join public.clients c on c.id = t.client_id, d
                    where t.org_id = p_org and t.stage <> 'Approved' and t.official_due_date between d.today and d.today + 7
                    order by t.official_due_date limit 12) q)
  );
$$;
revoke execute on function public.firm_daily_digest(uuid) from public, anon, authenticated;
grant execute on function public.firm_daily_digest(uuid) to service_role;

commit;

-- Verification (one statement):
--
-- select
--   (select count(*) from information_schema.tables where table_name = 'member_rates') as rates_table,
--   (select count(*) from information_schema.columns where (table_name, column_name) in
--     (('time_logs', 'invoice_id'), ('firm_settings', 'remind_all_invoices'), ('firm_settings', 'morning_digest'))) as new_columns,
--   (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
--     ('unbilled_time', 'invoice_unbilled_time', 'practice_profitability', 'review_flow', 'firm_daily_digest')) as new_functions,
--   (select has_function_privilege('authenticated', 'public.firm_daily_digest(uuid)', 'execute')) as digest_open_to_browser;
--
-- Expected: 1, 3, 5, false.
