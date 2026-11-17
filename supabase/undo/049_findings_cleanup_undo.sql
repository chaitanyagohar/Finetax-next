-- Undo for 049_findings_cleanup.sql: puts back the earlier versions exactly (from the 13/11 dump plus 041-048).
-- Data changes are not reversed: the copied discussions.client_id values stay, and late fees already billed stay billed.

begin;

CREATE OR REPLACE FUNCTION public.chat_can_access(p_channel uuid, p_user uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.chat_channels c
    join public.memberships m on m.org_id = c.org_id and m.user_id = p_user and m.is_active
    where c.id = p_channel
      and (
        (c.kind = 'channel' and not c.is_private)
        or exists (select 1 from public.chat_members cm where cm.channel_id = c.id and cm.user_id = p_user)
        or (c.kind = 'task' and exists (
              select 1 from public.tasks t
              where t.id = c.task_id
                and (m.role = 'admin' or coalesce(p_user = any(array[t.assigned_to, t.reviewer_id, t.assigned_by]), false))))
      )
  );
$function$;

drop function if exists public.run_reminders(uuid);
CREATE OR REPLACE FUNCTION public.run_reminders()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.reminder_settings%rowtype;
  v_ist timestamp := now() at time zone 'Asia/Kolkata';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_time time := (now() at time zone 'Asia/Kolkata')::time;
  r record;
  a record;
  v_title text;
  v_who text;
  v_log uuid;
  v_snoozes int := 0;
  v_sent int := 0;
  v_firms int := 0;
begin
  -- 1. Snoozed popups that are due (all firms)
  for r in
    select * from public.notifications
    where snoozed_until is not null and snoozed_until <= now() and read_at is null
  loop
    insert into public.notifications (org_id, user_id, type, title, body, link, entity, entity_id, priority, actor_id)
    values (r.org_id, r.user_id, r.type, left('Reminder: ' || regexp_replace(r.title, '^Reminder: ', ''), 200),
            r.body, r.link, r.entity, r.entity_id, 'important', null);
    update public.notifications set snoozed_until = null, read_at = now() where id = r.id;
    v_snoozes := v_snoozes + 1;
  end loop;

  -- 2. Forgotten timers: pause at the last sign of activity (all firms)
  update public.time_timers
  set paused_at = greatest(started_at, coalesce(last_seen_at, started_at))
  where paused_at is null and coalesce(last_seen_at, started_at) < now() - interval '30 minutes';

  -- 3. Overnight clean-up (all firms)
  if v_time >= time '23:00' then
    for r in
      select user_id, org_id from public.time_timers
      where coalesce(last_seen_at, started_at) < now() - interval '1 hour'
    loop
      perform public.set_org_context(r.org_id);
      v_log := public.close_timer(r.user_id, true);
      if v_log is not null then
        update public.time_logs set needs_review = true where id = v_log;
        perform public.push_notification(r.user_id, 'timer_auto_stopped', 'Your timer was stopped overnight',
          'Time up to your last activity was saved and marked for your day review.', '/time-tracking', 'time', v_log, 'normal');
      end if;
    end loop;
  end if;

  -- 4-8. Task reminders, firm by firm
  for s in
    select rs.* from public.reminder_settings rs
    join public.organizations o on o.id = rs.org_id and o.status in ('trial', 'active')
  loop
    continue when not s.enabled;
    continue when v_time < s.work_start or v_time > s.work_end
               or (s.skip_sundays and extract(isodow from v_today) = 7);

    perform public.set_org_context(s.org_id);
    v_firms := v_firms + 1;

    -- 4. Not started after N hours
    for r in
      select * from public.tasks
      where org_id = s.org_id and stage = 'Assigned' and assigned_to is not null and assigned_at is not null
        and assigned_at <= now() - make_interval(hours => s.not_started_hours)
    loop
      if public.reminder_once(r.id, r.assigned_to, 'not_started', 'once') then
        v_title := r.title || coalesce(' · ' || nullif(trim(r.period), ''), '');
        perform public.push_notification(r.assigned_to, 'task_not_started', 'Not started yet: ' || v_title,
          'Assigned ' || round(extract(epoch from (now() - r.assigned_at)) / 3600) || ' hours ago · Internal deadline '
            || coalesce(to_char(r.due_date, 'DD/MM/YYYY'), '—'),
          '/tasks?task=' || r.id, 'task', r.id, 'important');
        v_sent := v_sent + 1;
      end if;
    end loop;

    -- 5. Internal deadline approaching and still not started
    for r in
      select * from public.tasks
      where org_id = s.org_id and stage in ('Assigned', 'Changes Required') and assigned_to is not null
        and due_date is not null and due_date >= v_today and due_date <= v_today + s.due_soon_days
    loop
      v_title := r.title || coalesce(' · ' || nullif(trim(r.period), ''), '');
      if public.reminder_once(r.id, r.assigned_to, 'due_soon', v_today::text) then
        perform public.push_notification(r.assigned_to, 'task_due_soon', 'Deadline approaching: ' || v_title,
          'Internal deadline ' || to_char(r.due_date, 'DD/MM/YYYY')
            || case when r.due_date = v_today then ' (today)' else ' (in ' || (r.due_date - v_today) || ' days)' end
            || ' and work has not started.',
          '/tasks?task=' || r.id, 'task', r.id, 'important');
        v_sent := v_sent + 1;
      end if;
      if s.escalate_assigner then
        select name into v_who from public.profiles where id = r.assigned_to;
        for a in
          select x as id from (
            select r.assigned_by as x where r.assigned_by is not null
            union
            select u from public.org_admin_ids(s.org_id) u where r.assigned_by is null
          ) q
          where x <> r.assigned_to
        loop
          if public.reminder_once(r.id, a.id, 'due_soon_escalate', 'once') then
            perform public.push_notification(a.id, 'task_due_soon', coalesce(v_who, 'Assignee') || ' has not started: ' || v_title,
              'Internal deadline ' || to_char(r.due_date, 'DD/MM/YYYY') || '.', '/tasks?task=' || r.id, 'task', r.id, 'normal');
            v_sent := v_sent + 1;
          end if;
        end loop;
      end if;
    end loop;

    -- 6. Internal deadline passed, not yet submitted
    for r in
      select * from public.tasks
      where org_id = s.org_id and stage in ('Assigned', 'In Progress', 'Changes Required') and assigned_to is not null
        and due_date is not null and due_date < v_today
    loop
      v_title := r.title || coalesce(' · ' || nullif(trim(r.period), ''), '');
      if s.overdue_daily and public.reminder_once(r.id, r.assigned_to, 'overdue', v_today::text) then
        perform public.push_notification(r.assigned_to, 'task_overdue', 'Overdue: ' || v_title,
          'Internal deadline was ' || to_char(r.due_date, 'DD/MM/YYYY') || ' (' || (v_today - r.due_date) || ' days ago)'
            || coalesce(' · Statutory ' || to_char(r.official_due_date, 'DD/MM/YYYY'), ''),
          '/tasks?task=' || r.id, 'task', r.id, 'important');
        v_sent := v_sent + 1;
      end if;
      if s.escalate_assigner then
        select name into v_who from public.profiles where id = r.assigned_to;
        for a in
          select x as id from (
            select r.assigned_by as x where r.assigned_by is not null
            union
            select u from public.org_admin_ids(s.org_id) u where r.assigned_by is null
          ) q
          where x <> r.assigned_to
        loop
          if public.reminder_once(r.id, a.id, 'overdue_escalate', 'once') then
            perform public.push_notification(a.id, 'task_overdue', 'Overdue with ' || coalesce(v_who, 'assignee') || ': ' || v_title,
              'Internal deadline was ' || to_char(r.due_date, 'DD/MM/YYYY') || '.', '/tasks?task=' || r.id, 'task', r.id, 'normal');
            v_sent := v_sent + 1;
          end if;
        end loop;
      end if;
    end loop;

    -- 7. Statutory deadline at risk / breached -> this firm's admins
    for r in
      select * from public.tasks
      where org_id = s.org_id and stage not in ('Submitted for Review', 'Approved') and official_due_date is not null
        and official_due_date <= v_today + s.statutory_alert_days
    loop
      v_title := r.title || coalesce(' · ' || nullif(trim(r.period), ''), '');
      select name into v_who from public.profiles where id = r.assigned_to;
      for a in select u as id from public.org_admin_ids(s.org_id) u loop
        if r.official_due_date < v_today then
          if public.reminder_once(r.id, a.id, 'statutory_breached', 'once') then
            perform public.push_notification(a.id, 'statutory_risk', 'Statutory deadline breached: ' || v_title,
              'Was due ' || to_char(r.official_due_date, 'DD/MM/YYYY') || ' · ' || r.stage || ' · with ' || coalesce(v_who, 'nobody (unassigned)'),
              '/tasks?task=' || r.id, 'task', r.id, 'important');
            v_sent := v_sent + 1;
          end if;
        elsif public.reminder_once(r.id, a.id, 'statutory_risk', v_today::text) then
          perform public.push_notification(a.id, 'statutory_risk', 'Statutory deadline at risk: ' || v_title,
            'Due ' || to_char(r.official_due_date, 'DD/MM/YYYY')
              || case when r.official_due_date = v_today then ' (today)' else ' (in ' || (r.official_due_date - v_today) || ' days)' end
              || ' · ' || r.stage || ' · with ' || coalesce(v_who, 'nobody (unassigned)'),
            '/tasks?task=' || r.id, 'task', r.id, 'important');
          v_sent := v_sent + 1;
        end if;
      end loop;
    end loop;

    -- 8. Waiting too long for review
    for r in
      select * from public.tasks
      where org_id = s.org_id and stage = 'Submitted for Review' and reviewer_id is not null and stage_changed_at is not null
        and stage_changed_at <= now() - make_interval(hours => s.review_waiting_hours)
    loop
      if public.reminder_once(r.id, r.reviewer_id, 'review_waiting', v_today::text) then
        select name into v_who from public.profiles where id = r.assigned_to;
        perform public.push_notification(r.reviewer_id, 'review_waiting',
          'Waiting for your review: ' || r.title || coalesce(' · ' || nullif(trim(r.period), ''), ''),
          'Submitted ' || round(extract(epoch from (now() - r.stage_changed_at)) / 3600) || ' hours ago by ' || coalesce(v_who, 'staff'),
          '/reviewer-queue?tab=pending', 'task', r.id, 'normal');
        v_sent := v_sent + 1;
      end if;
    end loop;
  end loop;

  perform public.set_org_context(null);
  return jsonb_build_object('snoozes', v_snoozes, 'reminders_sent', v_sent, 'firms_checked', v_firms, 'ran_at', v_ist);
end $function$;
revoke all on function public.run_reminders() from public, anon, authenticated;
grant execute on function public.run_reminders() to service_role;

CREATE OR REPLACE FUNCTION public.run_reminders_now()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can run the reminder check.';
  end if;
  return public.run_reminders();
end;
$function$;

drop policy if exists legacy_admin_read on public.zz_legacy_counters;
drop policy if exists legacy_admin_read on public.zz_legacy_email_queue;
drop policy if exists baseline_active_staff on public.zz_legacy_counters;
drop policy if exists baseline_active_staff on public.zz_legacy_email_queue;
create policy baseline_active_staff on public.zz_legacy_counters to authenticated
  using ((select public.is_active_user())) with check ((select public.is_active_user()));
create policy baseline_active_staff on public.zz_legacy_email_queue to authenticated
  using ((select public.is_active_user())) with check ((select public.is_active_user()));
grant insert, update, delete on public.zz_legacy_counters, public.zz_legacy_email_queue to authenticated;
drop policy if exists email_attachments_delete_admin on public.email_attachments;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
  loop
    execute format('grant execute on function %s to public', r.fn);
  end loop;
end $$;

do $$
declare
  r record;
  v_def text;
begin
  for r in
    select t.tgname, c.relname, pg_get_triggerdef(t.oid) as def
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
      and c.relname in ('invoices', 'quotations', 'tasks')
      and pg_get_triggerdef(t.oid) like '%app.bulk_move%'
  loop
    -- 049 added the condition only to triggers that had none, so removing the whole WHEN restores them
    v_def := regexp_replace(r.def, ' WHEN \(\(COALESCE\(current_setting\(''app\.bulk_move''::text, true\), ''off''::text\) <> ''on''::text\)\) EXECUTE ', ' EXECUTE ');
    if position('app.bulk_move' in v_def) > 0 then
      raise exception 'Could not restore trigger % on %', r.tgname, r.relname;
    end if;
    execute format('drop trigger %I on public.%I', r.tgname, r.relname);
    execute v_def;
  end loop;
end $$;

CREATE OR REPLACE FUNCTION public.merge_clients(p_keep uuid, p_remove uuid, p_fields jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
  r record;
  k text;
  v_count int;
  v_moved jsonb := '{}'::jsonb;
  v_remove public.clients%rowtype;
  v_set text := '';
  v_allowed text[] := array['name', 'organization_name', 'type', 'pan', 'gstin', 'email', 'phone', 'state', 'address', 'notes', 'assigned_to'];
  v_locked text[] := array['invoices', 'quotations', 'tasks'];
begin
  if not public.is_admin() then
    raise exception 'Only administrators can merge clients.';
  end if;
  if p_keep = p_remove then
    raise exception 'Choose two different clients.';
  end if;
  perform 1 from public.clients where id = p_keep and org_id = v_org for update;
  if not found then
    raise exception 'The client to keep was not found.';
  end if;
  select * into v_remove from public.clients where id = p_remove and org_id = v_org for update;
  if not found then
    raise exception 'The client to merge was not found.';
  end if;
  if coalesce(v_remove.status, '') = 'Merged' then
    raise exception 'That client has already been merged.';
  end if;

  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.column_name in ('client_id', 'clientId', 'converted_client_id')
      and c.udt_name = 'uuid'
      and c.table_name not in ('clients', 'client_duplicate_dismissals')
  loop
    if r.table_name = any(v_locked) then
      execute format('alter table public.%I disable trigger user', r.table_name);
    end if;

    execute format('update public.%I set %I = $1 where %I = $2', r.table_name, r.column_name, r.column_name)
      using p_keep, p_remove;
    get diagnostics v_count = row_count;

    if r.table_name = any(v_locked) then
      execute format('alter table public.%I enable trigger user', r.table_name);
    end if;

    if v_count > 0 then
      v_moved := v_moved || jsonb_build_object(r.table_name, coalesce((v_moved ->> r.table_name)::int, 0) + v_count);
    end if;
  end loop;

  update public.clients
  set status = 'Merged', merged_into = p_keep, merged_at = now(), gstin = null
  where id = p_remove;

  for k in select jsonb_object_keys(coalesce(p_fields, '{}'::jsonb)) loop
    if k = any(v_allowed) then
      if k = 'name' and coalesce(trim(p_fields ->> k), '') = '' then
        continue;
      end if;
      v_set := v_set || format('%I = %s, ', k,
        case
          when coalesce(p_fields ->> k, '') = '' then 'NULL'
          when k = 'assigned_to' then quote_literal(p_fields ->> k) || '::uuid'
          else quote_literal(p_fields ->> k)
        end);
    end if;
  end loop;
  if v_set <> '' then
    execute 'update public.clients set ' || left(v_set, length(v_set) - 2) || ' where id = $1' using p_keep;
  end if;

  delete from public.client_duplicate_dismissals where client_a = p_remove or client_b = p_remove;

  return jsonb_build_object('kept', p_keep, 'removed', p_remove, 'moved', v_moved);
end $function$;

CREATE OR REPLACE FUNCTION public.rename_task_category(p_id uuid, p_new_name text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
  v_old text;
  v_new text := trim(coalesce(p_new_name, ''));
  v_count int := 0;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can rename categories.';
  end if;
  if v_new = '' then
    raise exception 'Category name is required.';
  end if;

  select name into v_old from public.task_categories where id = p_id and org_id = v_org for update;
  if not found then
    raise exception 'Category not found.';
  end if;
  if exists (select 1 from public.task_categories
             where org_id = v_org and lower(trim(name)) = lower(v_new) and id <> p_id) then
    raise exception 'A category named "%" already exists.', v_new;
  end if;

  update public.task_categories set name = v_new where id = p_id;
  if v_old = v_new then
    return 0;
  end if;

  alter table public.tasks disable trigger user;
  update public.tasks set category = v_new where org_id = v_org and category = v_old;
  get diagnostics v_count = row_count;
  alter table public.tasks enable trigger user;

  update public.task_types set category = v_new where org_id = v_org and category = v_old;
  update public.package_services set category = v_new where org_id = v_org and category = v_old;
  update public.compliance_events set category = v_new where org_id = v_org and category = v_old;

  return v_count;
end $function$;

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
end $function$;

CREATE OR REPLACE FUNCTION public.generate_subscription_bills(p_run_date date DEFAULT NULL::date, p_org uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := coalesce(p_run_date, (now() at time zone 'Asia/Kolkata')::date);
  v_firm public.firm_settings%rowtype;
  v_firm_state text;
  sub record;
  od record;
  v_client public.clients%rowtype;
  v_pkg_name text;
  v_months int;
  v_start date;
  v_full_start date;
  v_end date;
  v_bill date;
  v_full_days int;
  v_days int;
  v_amount numeric;
  v_items jsonb;
  v_fees jsonb;
  v_fee numeric;
  v_inv uuid;
  v_notes text;
  v_loops int;
  v_created jsonb := '[]'::jsonb;
  v_drafts int := 0;
  v_org_drafts jsonb := '{}'::jsonb;
  f jsonb;
  a record;
  o record;
begin
  for sub in
    select cp.* from public.client_packages cp
    join public.organizations org on org.id = cp.org_id and org.status in ('trial', 'active')
    where cp.status = 'Active' and cp.billing_enabled and cp.next_period_start is not null
      and (p_org is null or cp.org_id = p_org)
    order by cp.org_id
  loop
    perform public.set_org_context(sub.org_id);
    v_firm := null;
    select * into v_firm from public.firm_settings where org_id = sub.org_id;
    v_firm_state := nullif(substring(coalesce(v_firm.gstin, '') from 1 for 2), '');

    select * into v_client from public.clients where id = sub.client_id;
    select name into v_pkg_name from public.service_packages where id = sub.package_id;
    v_months := case sub.billing_cycle when 'Quarterly' then 3 when 'Half-Yearly' then 6 when 'Yearly' then 12 else 1 end;
    v_start := sub.next_period_start;
    v_loops := 0;

    loop
      exit when v_loops >= 3;
      v_full_start := date_trunc('month', v_start)::date;
      v_end := (v_full_start + make_interval(months => v_months) - interval '1 day')::date;
      v_bill := date_trunc('month', v_end + 1)::date + (coalesce(sub.bill_day, 5) - 1);
      exit when v_bill > v_today;

      v_full_days := v_end - v_full_start + 1;
      v_days := v_end - v_start + 1;
      v_amount := coalesce(sub.price, 0);
      if v_start > v_full_start and coalesce(sub.prorate_first, true) then
        v_amount := round(v_amount * v_days / v_full_days, 2);
      end if;

      if v_amount > 0 then
        v_items := jsonb_build_array(jsonb_build_object(
          'description', coalesce(v_pkg_name, 'Professional services') || ' - services for ' || to_char(v_start, 'DD/MM/YYYY')
            || ' to ' || to_char(v_end, 'DD/MM/YYYY')
            || case when v_start > v_full_start and coalesce(sub.prorate_first, true)
                    then ' (pro-rated ' || v_days || ' of ' || v_full_days || ' days)' else '' end,
          'qty', 1, 'rate', v_amount));

        v_fees := '[]'::jsonb;
        if coalesce(sub.late_fee_percent, 0) > 0 or coalesce(sub.late_fee_min, 0) > 0 then
          for od in
            select i.* from public.invoices i
            where i.client_package_id = sub.id and i.status in ('Sent', 'Partially Paid')
              and i.due_date < v_bill and coalesce(i.total, 0) - coalesce(i.amount_paid, 0) > 0.009
          loop
            if not exists (
              select 1 from public.late_fee_charges
              where original_invoice_id = od.id and charge_month = date_trunc('month', v_bill)::date
            ) then
              v_fee := greatest(coalesce(sub.late_fee_min, 0),
                                round((coalesce(od.total, 0) - coalesce(od.amount_paid, 0)) * coalesce(sub.late_fee_percent, 0) / 100, 2));
              v_items := v_items || jsonb_build_array(jsonb_build_object(
                'description', 'Late payment charges on ' || od.invoice_number || ' (was due ' || to_char(od.due_date, 'DD/MM/YYYY') || ')',
                'qty', 1, 'rate', v_fee));
              v_fees := v_fees || jsonb_build_array(jsonb_build_object('invoice_id', od.id, 'amount', v_fee));
            end if;
          end loop;
        end if;

        v_notes := 'Billing period: ' || to_char(v_start, 'DD/MM/YYYY') || ' to ' || to_char(v_end, 'DD/MM/YYYY') || '.'
          || E'\nPayment due by ' || to_char(v_bill + coalesce(sub.due_days, 5), 'DD/MM/YYYY') || '.'
          || case when coalesce(sub.late_fee_percent, 0) > 0
                  then E'\nLate payment charges of ' || sub.late_fee_percent || '% per month (minimum Rs. ' || coalesce(sub.late_fee_min, 0)
                       || ') apply on overdue amounts.'
                  else '' end
          || case when v_firm.bank_account_no is not null
                  then E'\n\nBank: ' || coalesce(v_firm.bank_name, '') || E'\nA/C: ' || v_firm.bank_account_no
                       || E'\nIFSC: ' || coalesce(v_firm.bank_ifsc, '') || coalesce(E'\nUPI: ' || v_firm.upi_id, '')
                  else '' end;

        insert into public.invoices (
          org_id, client_id, organisation, date, issue_date, due_date, is_inter_state, gst_rate, items, notes, status,
          client_package_id, billing_period_start, billing_period_end
        )
        values (
          sub.org_id, sub.client_id, coalesce(nullif(trim(v_client.organization_name), ''), v_client.name), v_bill, v_bill,
          v_bill + coalesce(sub.due_days, 5),
          (v_firm_state is not null and length(coalesce(v_client.gstin, '')) >= 2 and substring(v_client.gstin from 1 for 2) <> v_firm_state),
          coalesce(sub.gst_rate, 18), v_items, v_notes, 'Draft', sub.id, v_start, v_end
        )
        returning id into v_inv;

        for f in select * from jsonb_array_elements(v_fees) loop
          insert into public.late_fee_charges (org_id, original_invoice_id, charged_on_invoice_id, amount, charge_month)
          values (sub.org_id, (f ->> 'invoice_id')::uuid, v_inv, (f ->> 'amount')::numeric, date_trunc('month', v_bill)::date)
          on conflict do nothing;
        end loop;

        v_created := v_created || jsonb_build_array(jsonb_build_object('invoice_id', v_inv, 'auto_send', sub.auto_send, 'org_id', sub.org_id));
        if not sub.auto_send then
          v_drafts := v_drafts + 1;
          v_org_drafts := v_org_drafts || jsonb_build_object(
            sub.org_id::text, coalesce((v_org_drafts ->> sub.org_id::text)::int, 0) + 1);
        end if;
      end if;

      v_start := v_end + 1;
      v_loops := v_loops + 1;
    end loop;

    if v_start is distinct from sub.next_period_start then
      update public.client_packages set next_period_start = v_start, last_billed_at = now() where id = sub.id;
    end if;
  end loop;

  for o in select key as org_key, value::int as drafts from jsonb_each_text(v_org_drafts) loop
    perform public.set_org_context(o.org_key::uuid);
    for a in select u as id from public.org_admin_ids(o.org_key::uuid) u loop
      perform public.push_notification(a.id, 'billing_ready', o.drafts || ' subscription bill(s) ready to review',
        'Approve and send them from Service Packages → Billing.', '/packages?tab=billing', 'billing', null, 'important');
    end loop;
  end loop;

  perform public.set_org_context(null);
  return jsonb_build_object('created', v_created, 'drafts', v_drafts, 'run_date', v_today);
end $function$;

commit;
