-- Undo for 058_escalations_and_announcements.sql
-- Puts run_reminders, the announcement triggers and the announcement read policy back as they were, and removes
-- the new functions and columns. Must-read flags, branch targets and reminder settings for levels are lost.

begin;

CREATE OR REPLACE FUNCTION public.run_reminders(p_org uuid DEFAULT NULL::uuid)
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
  -- 1. Snoozed popups that are due (all firms, or only p_org)
  for r in
    select * from public.notifications
    where snoozed_until is not null and snoozed_until <= now() and read_at is null
      and (p_org is null or org_id = p_org)
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
  where paused_at is null and coalesce(last_seen_at, started_at) < now() - interval '30 minutes'
    and (p_org is null or org_id = p_org);

  -- 3. Overnight clean-up (all firms)
  if v_time >= time '23:00' then
    for r in
      select user_id, org_id from public.time_timers
      where coalesce(last_seen_at, started_at) < now() - interval '1 hour'
        and (p_org is null or org_id = p_org)
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
    where p_org is null or rs.org_id = p_org
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
revoke all on function public.run_reminders(uuid) from public, anon, authenticated;
grant execute on function public.run_reminders(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.announcements_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.created_at := now();
  new.title := trim(coalesce(new.title, ''));
  if new.title = '' then
    raise exception 'Announcement title is required.';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.announcements_fan_out()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.notifications (org_id, user_id, type, title, body, link, entity, entity_id, priority, actor_id)
  select new.org_id, m.user_id, 'announcement', left(new.title, 200), left(new.body, 1000), '/', 'announcement', new.id,
         case when new.requires_ack or new.priority = 'important' then 'important' else 'normal' end,
         new.created_by
  from public.memberships m
  where m.org_id = new.org_id and m.is_active and m.user_id is distinct from new.created_by;
  return new;
end $function$;

drop policy if exists announcements_select_active on public.announcements;
create policy announcements_select_active on public.announcements for select to authenticated
  using ((select public.is_active_user()));

drop function if exists public.run_escalations(uuid);
drop function if exists public.escalation_list();
drop function if exists public.escalation_list_for(uuid);
drop function if exists public.my_unread_must_reads();
drop function if exists public.announcement_ack_status(uuid);
drop function if exists public.remind_unacknowledged(uuid);
drop function if exists public.announcement_remind(uuid, boolean);
drop function if exists public.announcement_audience(uuid);

alter table public.announcements drop column if exists must_acknowledge;
alter table public.announcements drop column if exists branch_id;
alter table public.announcements drop column if exists remind_every_hours;
alter table public.reminder_settings drop column if exists level2_days;
alter table public.reminder_settings drop column if exists level3_days;
alter table public.reminder_settings drop column if exists level3_statutory_days;
alter table public.reminder_settings drop column if exists partner_list_at;

commit;
