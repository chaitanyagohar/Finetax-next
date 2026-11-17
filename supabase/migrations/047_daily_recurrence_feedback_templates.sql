-- 047_daily_recurrence_feedback_templates.sql
-- Team requests from daily use:
--   Daily recurrence for tasks, Task List entries and package services. When a daily task is approved,
--   the next one falls on the next working day of the firm (kpi_settings.working_days_per_week:
--   6 = Monday to Saturday, 5 = Monday to Friday, the same rule the KPI scorecards use).
--   Reusable feedback templates per firm, shown as one-click lines above the reviewer feedback
--   and execution notes boxes.
--   search_tasks(): task search for the task pickers, so they no longer load every task.
-- Safe to run more than once. No data is dropped or deleted.

begin;

-- 1. Working days
create or replace function public.next_working_day(p_org uuid, p_after date)
returns date
language plpgsql stable security definer set search_path = public
as $$
declare
  v_days int;
  v_day date := p_after + 1;
begin
  select least(greatest(coalesce(working_days_per_week, 6), 1), 7) into v_days
    from public.kpi_settings where org_id = p_org;
  v_days := coalesce(v_days, 6);
  while extract(isodow from v_day) > v_days loop
    v_day := v_day + 1;
  end loop;
  return v_day;
end $$;
revoke all on function public.next_working_day(uuid, date) from public, anon, authenticated;
grant execute on function public.next_working_day(uuid, date) to service_role;

-- 2. Next occurrence on approval. Same as before, plus Daily.
create or replace function public.tasks_after_approve()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_interval interval;
  v_series uuid;
  v_next_due date;
  v_next_official date;
  v_next_period text;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.stage = 'Approved' and old.stage is distinct from 'Approved'
     and coalesce(new.recurrence, 'None') <> 'None' and new.due_date is not null then

    v_series := coalesce(new."seriesId", new.id);

    if new.recurrence = 'Daily' then
      -- A daily task approved late continues from today, not from its old due date
      v_next_due := public.next_working_day(new.org_id, greatest(new.due_date, v_today));
      v_next_official := case when new.official_due_date is null then null
                              else v_next_due + (new.official_due_date - new.due_date) end;
      v_next_period := case when new.period is null then null else to_char(v_next_due, 'DD Mon YYYY') end;
    else
      v_interval := case new.recurrence
        when 'Weekly' then interval '7 days'
        when 'Monthly' then interval '1 month'
        when 'Quarterly' then interval '3 months'
        when 'Yearly' then interval '1 year'
        else null
      end;
      if v_interval is null then
        return null;
      end if;
      v_next_due := (new.due_date + v_interval)::date;
      v_next_official := case when new.official_due_date is null then null else (new.official_due_date + v_interval)::date end;
      -- tasks_carry_period moves the period forward for these
      v_next_period := null;
    end if;

    if not exists (select 1 from public.tasks where "seriesId" = v_series and due_date = v_next_due and id <> new.id) then
      perform set_config('app.task_system', 'on', true);
      insert into public.tasks (
        org_id, title, client_id, organisation, category, priority, recurrence, "seriesId",
        assigned_to, reviewer_id, stage, due_date, official_due_date, notes, period
      )
      values (
        new.org_id, new.title, new.client_id, new.organisation, new.category, new.priority, new.recurrence, v_series,
        new.assigned_to, new.reviewer_id, 'Assigned', v_next_due, v_next_official, new.notes, v_next_period
      );
      perform set_config('app.task_system', 'off', true);
    end if;
  end if;
  return null;
end $$;

-- 3. Package services: a daily service starts on the first working day from the start date
create or replace function public.compute_service_schedule(p_type_id uuid, p_recurrence text, p_start date, p_fallback_offset integer)
returns table(period text, statutory_date date, internal_date date)
language plpgsql stable set search_path = public
as $$
declare
  t public.task_types%rowtype;
  v_rec text;
  v_anchor date := p_start;
  v_base date;
  v_period text;
  v_stat date;
  v_int date;
  v_fy int;
  v_q int;
  v_try int := 0;
  v_day date;
begin
  if p_type_id is not null then
    select * into t from public.task_types where id = p_type_id;
  end if;

  v_rec := coalesce(nullif(p_recurrence, ''), t.default_recurrence, 'None');
  if v_rec = 'Daily' then
    v_day := public.next_working_day(coalesce(t.org_id, public.default_org_id()), p_start - 1);
    return query select to_char(v_day, 'DD Mon YYYY'), null::date, v_day;
    return;
  end if;

  if t.id is null or t.statutory_day is null then
    return query select null::text, null::date, (p_start + coalesce(p_fallback_offset, 10))::date;
    return;
  end if;

  loop
    v_try := v_try + 1;
    v_fy := case when extract(month from v_anchor) >= 4 then extract(year from v_anchor)::int else extract(year from v_anchor)::int - 1 end;

    if v_rec = 'Monthly' then
      v_base := date_trunc('month', v_anchor)::date;
      v_period := to_char(v_anchor, 'Mon YYYY');
    elsif v_rec = 'Quarterly' then
      v_q := ((extract(month from v_anchor)::int - 4 + 12) % 12) / 3 + 1;
      v_base := (make_date(v_fy, 4, 1) + make_interval(months => v_q * 3 - 1))::date;
      v_period := 'Q' || v_q || ' FY ' || v_fy || '-' || lpad(((v_fy + 1) % 100)::text, 2, '0');
    elsif v_rec = 'Yearly' then
      v_base := make_date(v_fy + 1, 3, 1);
      v_period := 'FY ' || v_fy || '-' || lpad(((v_fy + 1) % 100)::text, 2, '0');
    else
      v_base := date_trunc('month', v_anchor)::date;
      v_period := null;
    end if;

    v_stat := public.clamp_day((v_base + make_interval(months => coalesce(t.statutory_month_offset, 0)))::date, t.statutory_day);
    exit when v_stat >= p_start or v_try >= 3;

    -- That period's deadline has already passed: start with the next period
    v_anchor := case v_rec
                  when 'Quarterly' then (v_anchor + interval '3 months')::date
                  when 'Yearly' then (v_anchor + interval '1 year')::date
                  else (v_anchor + interval '1 month')::date
                end;
  end loop;

  v_int := greatest(p_start, v_stat - coalesce(t.internal_buffer_days, 3));
  return query select v_period, v_stat, least(v_int, v_stat);
end $$;

-- 4. Feedback templates
do $$
begin
  if to_regclass('public.feedback_templates') is null then
    create table public.feedback_templates (
      id           uuid primary key default gen_random_uuid(),
      org_id       uuid not null default public.default_org_id() references public.organizations(id) on delete cascade,
      body         text not null check (length(trim(body)) between 1 and 300),
      used_for     text not null default 'both' check (used_for in ('both', 'feedback', 'notes')),
      task_type_id uuid references public.task_types(id) on delete set null,
      sort_order   int not null default 0,
      created_by   uuid default auth.uid(),
      created_at   timestamptz not null default now()
    );

    -- First run only: every firm starts with the same examples, which it can edit or delete
    insert into public.feedback_templates (org_id, body, sort_order)
    select o.id, e.body, e.sort_order
    from public.organizations o
    cross join (values
      ('Compile the documents.', 1),
      ('Save in Google Drive.', 2),
      ('Put documents in the respective file.', 3),
      ('Generate invoice as per the approved quotation and send the payment link.', 4),
      ('Follow up on payment.', 5)
    ) as e(body, sort_order)
    where o.slug <> 'oddlambda';
  end if;
end $$;

create index if not exists feedback_templates_org_idx on public.feedback_templates (org_id, sort_order);

alter table public.feedback_templates enable row level security;
revoke all on public.feedback_templates from anon;
grant select, insert, update, delete on public.feedback_templates to authenticated;
grant all on public.feedback_templates to service_role;

drop policy if exists org_isolation on public.feedback_templates;
create policy org_isolation on public.feedback_templates as restrictive for all
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

drop policy if exists feedback_templates_select on public.feedback_templates;
create policy feedback_templates_select on public.feedback_templates for select
  using ((select public.is_active_user()));

drop policy if exists feedback_templates_write_admin on public.feedback_templates;
create policy feedback_templates_write_admin on public.feedback_templates for all
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- A task type belongs to the template's own firm
create or replace function public.feedback_templates_check_type()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.task_type_id is not null
     and not exists (select 1 from public.task_types where id = new.task_type_id and org_id = new.org_id) then
    raise exception 'Choose a task from your own Task List.';
  end if;
  return new;
end $$;
revoke all on function public.feedback_templates_check_type() from public, anon, authenticated;

drop trigger if exists feedback_templates_check_type on public.feedback_templates;
create trigger feedback_templates_check_type before insert or update of task_type_id, org_id on public.feedback_templates
  for each row execute function public.feedback_templates_check_type();

-- New firms get the same examples
create or replace function public.platform_seed_firm(p_org uuid, p_name text, p_copy_from uuid, p_copy_lists boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.firm_settings (org_id, firm_name, invoice_prefix, quotation_prefix, default_gst_rate)
  values (p_org, p_name, 'INV/{FY}/', 'QUO/{YYYY}/', 18)
  on conflict (org_id) do nothing;

  insert into public.engagement_settings (org_id, termination_notice_days)
  values (p_org, 30)
  on conflict (org_id) do nothing;

  insert into public.kpi_settings (org_id, w_timeliness, w_quality, w_volume, w_activeness, working_days_per_week)
  values (p_org, 35, 30, 20, 15, 6)
  on conflict (org_id) do nothing;

  insert into public.reminder_settings (org_id, enabled, not_started_hours, due_soon_days, escalate_assigner, overdue_daily,
                                        statutory_alert_days, review_waiting_hours, work_start, work_end, skip_sundays)
  values (p_org, true, 24, 3, true, true, 7, 24, time '10:00', time '19:00', true)
  on conflict (org_id) do nothing;

  if not exists (select 1 from public.chat_channels where org_id = p_org and kind = 'channel' and name = 'general') then
    insert into public.chat_channels (org_id, kind, name, description, is_private)
    values (p_org, 'channel', 'general', 'Announcements and conversation for the whole firm', false);
  end if;

  if not exists (select 1 from public.feedback_templates where org_id = p_org) then
    insert into public.feedback_templates (org_id, body, sort_order)
    values (p_org, 'Compile the documents.', 1),
           (p_org, 'Save in Google Drive.', 2),
           (p_org, 'Put documents in the respective file.', 3),
           (p_org, 'Generate invoice as per the approved quotation and send the payment link.', 4),
           (p_org, 'Follow up on payment.', 5);
  end if;

  -- Optional: start with the template firm's Task List and categories
  if coalesce(p_copy_lists, false) and p_copy_from is not null then
    insert into public.task_categories (org_id, name, color, sort_order, is_active)
    select p_org, name, color, sort_order, is_active
    from public.task_categories where org_id = p_copy_from and is_active
    on conflict do nothing;

    insert into public.task_types (org_id, name, category, default_recurrence, statutory_day, statutory_month_offset,
                                   internal_buffer_days, is_active, default_estimate_minutes)
    select p_org, name, category, default_recurrence, statutory_day, statutory_month_offset,
           internal_buffer_days, true, default_estimate_minutes
    from public.task_types where org_id = p_copy_from and is_active
    on conflict do nothing;
  end if;
end $$;

-- 5. Task search for the pickers. Runs as the caller, so row-level security decides what is found.
--    Every word typed must match the task title, period, category, organisation or client.
create or replace function public.search_tasks(
  p_query      text default '',
  p_client     uuid default null,
  p_open_only  boolean default true,
  p_mine_only  boolean default false,
  p_limit      int default 30
)
returns table (
  id uuid,
  title text,
  period text,
  stage text,
  due_date date,
  official_due_date date,
  client_id uuid,
  client_label text,
  assigned_to uuid
)
language sql stable security invoker set search_path = public
as $$
  select t.id, t.title, t.period, t.stage, t.due_date, t.official_due_date, t.client_id,
         coalesce(nullif(trim(c.organization_name), ''), c.name, nullif(trim(t.organisation), '')) as client_label,
         t.assigned_to
  from public.tasks t
  left join public.clients c on c.id = t.client_id
  where (not p_open_only or t.stage is distinct from 'Approved')
    and (not p_mine_only or public.is_admin() or t.assigned_to = auth.uid() or t.reviewer_id = auth.uid())
    and (p_client is null or t.client_id = p_client)
    and not exists (
      select 1
      from regexp_split_to_table(lower(trim(coalesce(p_query, ''))), '\s+') as w(word)
      where w.word <> ''
        and position(w.word in lower(concat_ws(' ', t.title, t.period, t.category, t.organisation,
                                                    c.organization_name, c.name))) = 0
    )
  order by (t.stage = 'Approved'), t.due_date nulls last, t.title
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;
revoke all on function public.search_tasks(text, uuid, boolean, boolean, int) from public, anon;
grant execute on function public.search_tasks(text, uuid, boolean, boolean, int) to authenticated, service_role;

commit;

-- Verification (one statement):
--
-- select (select count(*) from public.feedback_templates) as templates,
--        (select count(distinct org_id) from public.feedback_templates) as firms_with_templates,
--        (select count(*) from public.organizations where slug <> 'oddlambda') as firms,
--        public.next_working_day((select id from public.organizations where slug = 'finetax'), date '2026-11-21') as after_saturday;
--
-- Expected: firms_with_templates = firms on the first run (5 templates each), and after_saturday = 2026-11-23
-- (the Monday) for a firm working Monday to Saturday.
