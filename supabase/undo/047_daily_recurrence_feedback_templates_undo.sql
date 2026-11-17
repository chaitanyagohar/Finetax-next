-- 047_daily_recurrence_feedback_templates_undo.sql
-- Puts back the task recurrence, package schedule and new-firm set-up as they were before migration 047 (batch 3).
-- Run it only to roll batch 3 back, together with the previous version of the code.
-- The feedback templates table and its rows stay in place, unused. Nothing is deleted.
-- Tasks already set to repeat Daily stop repeating; change them to another recurrence afterwards.

begin;

drop function if exists public.search_tasks(text, uuid, boolean, boolean, int);

CREATE OR REPLACE FUNCTION public.tasks_after_approve()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_interval interval;
  v_series uuid;
  v_next_due date;
  v_next_official date;
begin
  if new.stage = 'Approved' and old.stage is distinct from 'Approved'
     and coalesce(new.recurrence, 'None') <> 'None' and new.due_date is not null then

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

    v_series := coalesce(new."seriesId", new.id);
    v_next_due := (new.due_date + v_interval)::date;
    v_next_official := case when new.official_due_date is null then null else (new.official_due_date + v_interval)::date end;

    if not exists (select 1 from public.tasks where "seriesId" = v_series and due_date = v_next_due and id <> new.id) then
      perform set_config('app.task_system', 'on', true);
      insert into public.tasks (
        org_id, title, client_id, organisation, category, priority, recurrence, "seriesId",
        assigned_to, reviewer_id, stage, due_date, official_due_date, notes
      )
      values (
        new.org_id, new.title, new.client_id, new.organisation, new.category, new.priority, new.recurrence, v_series,
        new.assigned_to, new.reviewer_id, 'Assigned', v_next_due, v_next_official, new.notes
      );
      perform set_config('app.task_system', 'off', true);
    end if;
  end if;
  return null;
end$function$;

CREATE OR REPLACE FUNCTION public.compute_service_schedule(p_type_id uuid, p_recurrence text, p_start date, p_fallback_offset integer)
 RETURNS TABLE(period text, statutory_date date, internal_date date)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
begin
  if p_type_id is not null then
    select * into t from public.task_types where id = p_type_id;
  end if;

  if t.id is null or t.statutory_day is null then
    return query select null::text, null::date, (p_start + coalesce(p_fallback_offset, 10))::date;
    return;
  end if;

  v_rec := coalesce(nullif(p_recurrence, ''), t.default_recurrence, 'None');

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
end;$function$;

CREATE OR REPLACE FUNCTION public.platform_seed_firm(p_org uuid, p_name text, p_copy_from uuid, p_copy_lists boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end$function$;

drop function if exists public.next_working_day(uuid, date);

commit;

-- Verification (one statement):
-- select to_regprocedure('public.search_tasks(text,uuid,boolean,boolean,integer)') is null as search_removed,
--        to_regprocedure('public.next_working_day(uuid,date)') is null as working_day_removed;
-- Expected: true, true.
