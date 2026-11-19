-- 058_escalations_and_announcements.sql
-- Batch 11, escalation levels and stronger announcements.
--   1. reminder_settings: level 2 (overdue N days: the reviewer and the person who assigned it),
--      level 3 (overdue N days, or statutory date within N days and not submitted: the partners),
--      and the time of the partners' daily escalation list.
--   2. escalation_list(): what is on the partners' list today. run_escalations() sends the levels and
--      the daily list, and reminds people who have not acknowledged an announcement. run_reminders()
--      calls it at the end, so the existing schedule needs no change.
--   3. announcements: must_acknowledge (pinned on every page until read), branch_id (only that branch),
--      remind_every_hours. announcement_ack_status() for the read list and its export, and
--      remind_unacknowledged() for "remind now".
-- Safe to run more than once. No data is dropped or deleted.

begin;

-- ---------------------------------------------------------------- 1. Settings
alter table public.reminder_settings add column if not exists level2_days int not null default 1 check (level2_days between 0 and 30);
alter table public.reminder_settings add column if not exists level3_days int not null default 3 check (level3_days between 1 and 60);
alter table public.reminder_settings add column if not exists level3_statutory_days int not null default 2 check (level3_statutory_days between 0 and 30);
alter table public.reminder_settings add column if not exists partner_list_at time not null default time '10:00';

-- ---------------------------------------------------------------- 2. Escalations
create or replace function public.escalation_list_for(p_org uuid)
returns table (task_id uuid, title text, client text, assignee text, due_date date, official_due_date date, stage text, reason text, days_late int)
language sql stable security definer set search_path = public
as $$
  with s as (select * from public.reminder_settings where org_id = p_org),
       t as (select (now() at time zone 'Asia/Kolkata')::date as today)
  select k.id, k.title || coalesce(' · ' || nullif(trim(k.period), ''), ''), c.name, p.name, k.due_date, k.official_due_date, k.stage,
         case when k.official_due_date is not null and k.official_due_date < t.today then 'Statutory date passed'
              when k.official_due_date is not null and k.official_due_date <= t.today + s.level3_statutory_days then 'Statutory date close'
              else 'Overdue' end,
         greatest(0, t.today - coalesce(k.due_date, t.today))
    from public.tasks k
    cross join s cross join t
    left join public.clients c on c.id = k.client_id
    left join public.profiles p on p.id = k.assigned_to
   where k.org_id = p_org
     and k.stage not in ('Submitted for Review', 'Approved')
     and ((k.due_date is not null and k.due_date <= t.today - s.level3_days)
          or (k.official_due_date is not null and k.official_due_date <= t.today + s.level3_statutory_days))
   order by coalesce(k.official_due_date, k.due_date), k.title
   limit 200;
$$;
revoke execute on function public.escalation_list_for(uuid) from public, anon, authenticated;

create or replace function public.escalation_list()
returns table (task_id uuid, title text, client text, assignee text, due_date date, official_due_date date, stage text, reason text, days_late int)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only partners see the escalation list.';
  end if;
  perform public.require_feature('escalation_levels', 'Escalation levels');
  return query select * from public.escalation_list_for(public.current_org_id());
end $$;
revoke execute on function public.escalation_list() from public, anon;
grant execute on function public.escalation_list() to authenticated;

create or replace function public.run_escalations(p_org uuid default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  s public.reminder_settings%rowtype;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_time time := (now() at time zone 'Asia/Kolkata')::time;
  v_sent int := 0;
  v_count int;
  v_top text;
  v_who text;
  r record;
  a record;
begin
  for s in
    select rs.* from public.reminder_settings rs
    join public.organizations o on o.id = rs.org_id and o.status in ('trial', 'active')
    where (p_org is null or rs.org_id = p_org) and rs.enabled
  loop
    continue when v_time < s.work_start or v_time > s.work_end or (s.skip_sundays and extract(isodow from v_today) = 7);
    perform public.set_org_context(s.org_id);

    if public.org_has_feature(s.org_id, 'escalation_levels') then
      -- Level 2: overdue by N days, to the reviewer and whoever assigned it
      for r in
        select * from public.tasks
         where org_id = s.org_id and stage in ('Assigned', 'In Progress', 'Changes Required') and assigned_to is not null
           and due_date is not null and due_date <= v_today - greatest(s.level2_days, 1)
      loop
        select name into v_who from public.profiles where id = r.assigned_to;
        for a in
          select distinct x as id from (values (r.reviewer_id), (r.assigned_by)) v(x)
           where x is not null and x <> r.assigned_to
        loop
          if public.reminder_once(r.id, a.id, 'escalation_level2', 'once') then
            perform public.push_notification(a.id, 'task_overdue',
              'Escalated: ' || r.title || coalesce(' · ' || nullif(trim(r.period), ''), '') || ' with ' || coalesce(v_who, 'staff'),
              (v_today - r.due_date) || ' days past the internal deadline of ' || to_char(r.due_date, 'DD/MM/YYYY') || ' and not submitted.',
              '/tasks?task=' || r.id, 'task', r.id, 'important');
            v_sent := v_sent + 1;
          end if;
        end loop;
      end loop;

      -- Level 3: the partners' list, once a day after the chosen time
      if v_time >= s.partner_list_at then
        select count(*), string_agg(title, ' · ' order by rn) filter (where rn <= 3)
          into v_count, v_top
          from (select title, row_number() over () as rn from public.escalation_list_for(s.org_id)) q;
        if v_count > 0 then
          for a in select u as id from public.org_admin_ids(s.org_id) u loop
            if not exists (select 1 from public.notifications n where n.user_id = a.id and n.type = 'escalation_list'
                             and n.created_at >= (v_today::timestamp at time zone 'Asia/Kolkata')) then
              perform public.push_notification(a.id, 'escalation_list',
                v_count || case when v_count = 1 then ' task needs' else ' tasks need' end || ' a partner''s attention',
                left(v_top, 400) || case when v_count > 3 then ' and ' || (v_count - 3) || ' more' else '' end,
                '/?escalations=1', 'escalation', null, 'important');
              v_sent := v_sent + 1;
            end if;
          end loop;
        end if;
      end if;
    end if;

    -- Announcement reminders to people who have not acknowledged
    if public.org_has_feature(s.org_id, 'must_acknowledge') then
      for r in
        select an.* from public.announcements an
         where an.org_id = s.org_id and an.requires_ack and an.remind_every_hours is not null
           and (an.expires_at is null or an.expires_at >= v_today)
           and an.created_at <= now() - make_interval(hours => an.remind_every_hours)
           and an.created_at >= now() - interval '30 days'
      loop
        v_sent := v_sent + public.announcement_remind(r.id, false);
      end loop;
    end if;
  end loop;
  return v_sent;
end $$;
revoke execute on function public.run_escalations(uuid) from public, anon, authenticated;
grant execute on function public.run_escalations(uuid) to service_role;

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

  -- Batch 11: escalation levels and announcement reminders, for firms on a plan that has them
  v_sent := v_sent + public.run_escalations(p_org);

  perform public.set_org_context(null);
  return jsonb_build_object('snoozes', v_snoozes, 'reminders_sent', v_sent, 'firms_checked', v_firms, 'ran_at', v_ist);
end $function$;
revoke all on function public.run_reminders(uuid) from public, anon, authenticated;
grant execute on function public.run_reminders(uuid) to service_role;

-- ---------------------------------------------------------------- 3. Announcements
alter table public.announcements add column if not exists must_acknowledge boolean not null default false;
alter table public.announcements add column if not exists branch_id uuid references public.branches(id) on delete cascade;
alter table public.announcements add column if not exists remind_every_hours int check (remind_every_hours is null or remind_every_hours between 4 and 168);

create or replace function public.announcement_audience(p_id uuid)
returns table (user_id uuid)
language sql stable security definer set search_path = public
as $$
  select m.user_id
    from public.announcements a
    join public.memberships m on m.org_id = a.org_id and m.is_active and m.accepted_at is not null
   where a.id = p_id and m.user_id is distinct from a.created_by
     and (a.branch_id is null or m.branch_id = a.branch_id);
$$;
revoke execute on function public.announcement_audience(uuid) from public, anon, authenticated;

create or replace function public.announcements_before_insert()
returns trigger
language plpgsql
as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.created_at := now();
  new.title := trim(coalesce(new.title, ''));
  if new.title = '' then
    raise exception 'Announcement title is required.';
  end if;
  if new.must_acknowledge or new.remind_every_hours is not null then
    perform public.require_feature('must_acknowledge', 'Must-read announcements');
  end if;
  if new.must_acknowledge then
    new.requires_ack := true;
  end if;
  if not new.requires_ack then
    new.remind_every_hours := null;
  end if;
  if new.branch_id is not null and not exists (select 1 from public.branches b where b.id = new.branch_id and b.org_id = new.org_id) then
    raise exception 'Choose one of your branches.';
  end if;
  return new;
end;
$$;

create or replace function public.announcements_fan_out()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (org_id, user_id, type, title, body, link, entity, entity_id, priority, actor_id)
  select new.org_id, m.user_id, 'announcement', left(new.title, 200), left(new.body, 1000), '/', 'announcement', new.id,
         case when new.requires_ack or new.priority = 'important' then 'important' else 'normal' end,
         new.created_by
  from public.memberships m
  where m.org_id = new.org_id and m.is_active and m.user_id is distinct from new.created_by
    and (new.branch_id is null or m.branch_id = new.branch_id);
  return new;
end $$;

-- People outside the chosen branch don't see a branch announcement
drop policy if exists announcements_select_active on public.announcements;
create policy announcements_select_active on public.announcements for select to authenticated
  using ((select public.is_active_user())
         and (branch_id is null or created_by = auth.uid() or (select public.is_admin()) or branch_id = (select public.my_branch())));

-- Sends one reminder to each person who has not acknowledged; p_now skips the wait between reminders
create or replace function public.announcement_remind(p_id uuid, p_now boolean)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  a public.announcements%rowtype;
  v_sent int := 0;
  u record;
begin
  select * into a from public.announcements where id = p_id;
  if not found or not a.requires_ack then
    return 0;
  end if;
  for u in
    select x.user_id from public.announcement_audience(p_id) x
     where not exists (select 1 from public.announcement_acks k where k.announcement_id = p_id and k.user_id = x.user_id)
       and (p_now or not exists (select 1 from public.notifications n where n.user_id = x.user_id and n.entity_id = p_id
                                   and n.type = 'announcement' and n.created_at > now() - make_interval(hours => coalesce(a.remind_every_hours, 24))))
       and not exists (select 1 from public.notifications n where n.user_id = x.user_id and n.entity_id = p_id
                         and n.type = 'announcement' and n.created_at > now() - interval '1 hour')
  loop
    insert into public.notifications (org_id, user_id, type, title, body, link, entity, entity_id, priority, actor_id)
    values (a.org_id, u.user_id, 'announcement', left('Please read: ' || a.title, 200), left(a.body, 1000), '/', 'announcement', a.id, 'important', a.created_by);
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $$;
revoke execute on function public.announcement_remind(uuid, boolean) from public, anon, authenticated;

create or replace function public.remind_unacknowledged(p_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() or not exists (select 1 from public.announcements where id = p_id and org_id = public.current_org_id()) then
    raise exception 'Only admins can send reminders.';
  end if;
  return public.announcement_remind(p_id, true);
end $$;
revoke execute on function public.remind_unacknowledged(uuid) from public, anon;
grant execute on function public.remind_unacknowledged(uuid) to authenticated;

create or replace function public.announcement_ack_status(p_id uuid)
returns table (user_id uuid, name text, email text, branch text, acked_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() or not exists (select 1 from public.announcements where id = p_id and org_id = public.current_org_id()) then
    raise exception 'Only admins see who has read this.';
  end if;
  return query
  select x.user_id, coalesce(p.name, 'Member'), p.email, b.name, k.acked_at
    from public.announcement_audience(p_id) x
    left join public.profiles p on p.id = x.user_id
    left join public.memberships m on m.user_id = x.user_id and m.org_id = public.current_org_id()
    left join public.branches b on b.id = m.branch_id
    left join public.announcement_acks k on k.announcement_id = p_id and k.user_id = x.user_id
   order by k.acked_at nulls first, p.name;
end $$;
revoke execute on function public.announcement_ack_status(uuid) from public, anon;
grant execute on function public.announcement_ack_status(uuid) to authenticated;

-- What is still waiting for the signed-in person's "I've read this"
create or replace function public.my_unread_must_reads()
returns table (id uuid, title text, body text, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select a.id, a.title, a.body, a.created_at
    from public.announcements a
   where a.org_id = public.current_org_id() and a.must_acknowledge
     and (a.expires_at is null or a.expires_at >= (now() at time zone 'Asia/Kolkata')::date)
     and exists (select 1 from public.announcement_audience(a.id) x where x.user_id = auth.uid())
     and not exists (select 1 from public.announcement_acks k where k.announcement_id = a.id and k.user_id = auth.uid())
   order by a.created_at;
$$;
revoke execute on function public.my_unread_must_reads() from public, anon;
grant execute on function public.my_unread_must_reads() to authenticated;

commit;

-- Verification (one statement):
--
-- select
--   (select count(*) from information_schema.columns where (table_name, column_name) in
--     (('reminder_settings', 'level2_days'), ('reminder_settings', 'level3_days'), ('reminder_settings', 'partner_list_at'),
--      ('announcements', 'must_acknowledge'), ('announcements', 'branch_id'), ('announcements', 'remind_every_hours'))) as new_columns,
--   (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
--     ('run_escalations', 'escalation_list', 'announcement_ack_status', 'remind_unacknowledged', 'my_unread_must_reads')) as new_functions,
--   (select prosrc like '%run_escalations%' from pg_proc where oid = 'public.run_reminders(uuid)'::regprocedure) as reminders_call_escalations;
--
-- Expected: 6, 5, true.
