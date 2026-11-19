-- 057_attendance_and_capacity.sql
-- Batch 11, attendance and workload.
--   1. Firm settings: quiet period before the away question (15 min), daily declared-time limit before
--      approval is needed (120 min), and grace for late arrival (15 min).
--   2. user_activity_days: in office or remote (from the office internet address), start/end of day,
--      and the day's declared, break and unaccounted minutes.
--   3. away_periods: each time someone came back after the quiet period and what they said they were
--      doing. Work above the daily limit waits for approval by someone allowed to approve time.
--   4. leave_requests and holidays.
--   5. attendance_report() and capacity_report(), limited to the people the caller may see.
-- No internet address is ever stored; only "in office" and which branch.
-- Safe to run more than once. No data is dropped or deleted.

begin;

-- ---------------------------------------------------------------- 1. Settings
alter table public.firm_settings add column if not exists away_quiet_minutes int not null default 15 check (away_quiet_minutes between 5 and 120);
alter table public.firm_settings add column if not exists declared_approval_minutes int not null default 120 check (declared_approval_minutes between 0 and 600);
alter table public.firm_settings add column if not exists late_grace_minutes int not null default 15 check (late_grace_minutes between 0 and 120);

-- ---------------------------------------------------------------- 2. Each person's day
alter table public.user_activity_days add column if not exists in_office boolean not null default false;
alter table public.user_activity_days add column if not exists office_branch_id uuid references public.branches(id) on delete set null;
alter table public.user_activity_days add column if not exists day_started_at timestamptz;
alter table public.user_activity_days add column if not exists day_ended_at timestamptz;
alter table public.user_activity_days add column if not exists declared_minutes int not null default 0;
alter table public.user_activity_days add column if not exists break_minutes int not null default 0;
alter table public.user_activity_days add column if not exists unaccounted_minutes int not null default 0;

-- Called by the server with the address the request came from; only the result is kept
create or replace function public.mark_office_presence(p_user uuid, p_org uuid, p_ip text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
  v_branch uuid;
begin
  begin
    select b.id into v_branch from public.branches b
     where b.org_id = p_org and exists (select 1 from unnest(b.office_ips) x where p_ip::inet <<= x::cidr)
     limit 1;
  exception when others then
    v_branch := null;
  end;
  insert into public.user_activity_days (user_id, org_id, day, first_seen, last_seen, active_minutes, in_office, office_branch_id)
  values (p_user, p_org, v_day, now(), now(), 0, v_branch is not null, v_branch)
  on conflict (user_id, day) do update
     set in_office = public.user_activity_days.in_office or excluded.in_office,
         office_branch_id = coalesce(public.user_activity_days.office_branch_id, excluded.office_branch_id);
  return jsonb_build_object('in_office', v_branch is not null, 'branch_id', v_branch);
end $$;
revoke execute on function public.mark_office_presence(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_office_presence(uuid, uuid, text) to service_role;

create or replace function public.mark_my_day(p_action text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null or not public.is_active_user() then
    return;
  end if;
  insert into public.user_activity_days (user_id, day, first_seen, last_seen, active_minutes)
  values (auth.uid(), v_day, now(), now(), 0)
  on conflict (user_id, day) do nothing;
  if p_action = 'start' then
    update public.user_activity_days set day_started_at = coalesce(day_started_at, now()), day_ended_at = null where user_id = auth.uid() and day = v_day;
  elsif p_action = 'end' then
    update public.user_activity_days set day_ended_at = now() where user_id = auth.uid() and day = v_day;
  else
    raise exception 'Unknown action.';
  end if;
end $$;
revoke execute on function public.mark_my_day(text) from public, anon;
grant execute on function public.mark_my_day(text) to authenticated;

-- ---------------------------------------------------------------- 3. Away periods
create table if not exists public.away_periods (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.default_org_id() references public.organizations(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  day         date not null,
  started_at  timestamptz not null,
  ended_at    timestamptz not null,
  minutes     int not null check (minutes >= 0),
  kind        text not null check (kind in ('task', 'tally_excel', 'portal', 'call_meeting', 'other_work', 'break', 'unanswered')),
  task_id     uuid references public.tasks(id) on delete set null,
  note        text check (note is null or length(note) <= 300),
  status      text not null default 'counted' check (status in ('counted', 'pending', 'approved', 'rejected')),
  decided_by  uuid,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (ended_at > started_at)
);
create index if not exists away_periods_user_day_idx on public.away_periods (user_id, day);
create index if not exists away_periods_pending_idx on public.away_periods (org_id, status) where status = 'pending';

alter table public.away_periods enable row level security;
revoke all on public.away_periods from anon;
revoke insert, update, delete on public.away_periods from authenticated;
grant select on public.away_periods to authenticated;
grant all on public.away_periods to service_role;
drop policy if exists org_isolation on public.away_periods;
create policy org_isolation on public.away_periods as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()));
drop policy if exists away_periods_read on public.away_periods;
create policy away_periods_read on public.away_periods for select to authenticated
  using (user_id = auth.uid()
         or ((select public.has_permission('view_attendance')) or (select public.has_permission('approve_time'))) and public.user_in_scope(user_id));

-- Totals on the day, kept in step with the periods
create or replace function public.refresh_day_totals(p_user uuid, p_day date)
returns void
language sql security definer set search_path = public
as $$
  update public.user_activity_days d
     set declared_minutes = coalesce((select sum(minutes) from public.away_periods a where a.user_id = p_user and a.day = p_day
                                       and a.kind not in ('break', 'unanswered') and a.status in ('counted', 'approved')), 0),
         break_minutes = coalesce((select sum(minutes) from public.away_periods a where a.user_id = p_user and a.day = p_day and a.kind = 'break'), 0),
         unaccounted_minutes = coalesce((select sum(minutes) from public.away_periods a where a.user_id = p_user and a.day = p_day
                                          and (a.kind = 'unanswered' or a.status = 'rejected')), 0)
   where d.user_id = p_user and d.day = p_day;
$$;
revoke execute on function public.refresh_day_totals(uuid, date) from public, anon, authenticated;

-- Who can approve this person's time and leave: admins, and roles with that right that can see them
create or replace function public.time_approvers(p_user uuid)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select m.user_id
    from public.memberships m
    left join public.roles r on r.id = m.role_id
    join public.memberships them on them.user_id = p_user and them.org_id = m.org_id
   where m.org_id = public.current_org_id() and m.is_active and m.user_id <> p_user
     and (m.role = 'admin'
          or ('approve_time' = any(r.permissions)
              and (r.scope = 'firm' or (r.scope = 'branch' and m.branch_id is not distinct from them.branch_id))));
$$;
revoke execute on function public.time_approvers(uuid) from public, anon, authenticated;

-- The answer to "you were away; what were you doing?"
create or replace function public.record_away(p_started timestamptz, p_kind text, p_task uuid default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_end timestamptz := now();
  v_start timestamptz := greatest(p_started, now() - interval '10 hours');
  v_day date := (v_start at time zone 'Asia/Kolkata')::date;
  v_minutes int;
  v_limit int;
  v_declared int;
  v_status text := 'counted';
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'Not signed in.';
  end if;
  perform public.require_feature('attendance', 'Attendance');
  if p_kind not in ('task', 'tally_excel', 'portal', 'call_meeting', 'other_work', 'break', 'unanswered') then
    raise exception 'Unknown answer.';
  end if;
  v_minutes := floor(extract(epoch from (v_end - v_start)) / 60);
  if v_minutes < 1 then
    return jsonb_build_object('minutes', 0);
  end if;
  -- The same stretch of time is never answered twice
  if exists (select 1 from public.away_periods where user_id = auth.uid() and tstzrange(started_at, ended_at) && tstzrange(v_start, v_end)) then
    return jsonb_build_object('minutes', 0, 'duplicate', true);
  end if;

  if p_kind not in ('break', 'unanswered') then
    select declared_approval_minutes into v_limit from public.firm_settings where org_id = v_org;
    select coalesce(sum(minutes), 0) into v_declared from public.away_periods
     where user_id = auth.uid() and day = v_day and kind not in ('break', 'unanswered') and status <> 'rejected';
    if coalesce(v_limit, 120) > 0 and v_declared + v_minutes > coalesce(v_limit, 120) then
      v_status := 'pending';
    end if;
  end if;

  insert into public.user_activity_days (user_id, org_id, day, first_seen, last_seen, active_minutes)
  values (auth.uid(), v_org, v_day, v_start, v_end, 0)
  on conflict (user_id, day) do nothing;

  insert into public.away_periods (org_id, user_id, day, started_at, ended_at, minutes, kind, task_id, note, status)
  values (v_org, auth.uid(), v_day, v_start, v_end, v_minutes, p_kind,
          (select t.id from public.tasks t where t.id = p_task and t.org_id = v_org), nullif(trim(p_note), ''), v_status);
  perform public.refresh_day_totals(auth.uid(), v_day);
  if v_status = 'pending' then
    perform public.push_notification(a.id, 'time_approval',
              coalesce((select name from public.profiles where id = auth.uid()), 'Someone') || ' needs approval for ' || v_minutes || ' min away for work',
              'Above today''s limit for time away from the screen.', '/attendance?tab=approvals', 'attendance', null, 'normal')
       from public.time_approvers(auth.uid()) a(id);
  end if;
  return jsonb_build_object('minutes', v_minutes, 'status', v_status);
end $$;
revoke execute on function public.record_away(timestamptz, text, uuid, text) from public, anon;
grant execute on function public.record_away(timestamptz, text, uuid, text) to authenticated;

create or replace function public.decide_away(p_id uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a public.away_periods%rowtype;
begin
  select * into a from public.away_periods where id = p_id and org_id = public.current_org_id();
  if not found then
    raise exception 'Not found.';
  end if;
  if not public.has_permission('approve_time') or not public.user_in_scope(a.user_id) or a.user_id = auth.uid() then
    raise exception 'You can''t approve this time.';
  end if;
  update public.away_periods set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
  perform public.refresh_day_totals(a.user_id, a.day);
end $$;
revoke execute on function public.decide_away(uuid, boolean) from public, anon;
grant execute on function public.decide_away(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- 4. Leave and holidays
create table if not exists public.leave_requests (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.default_org_id() references public.organizations(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  from_date   date not null,
  to_date     date not null,
  half_day    boolean not null default false,
  kind        text not null default 'casual' check (kind in ('casual', 'sick', 'earned', 'unpaid', 'other')),
  reason      text check (reason is null or length(reason) <= 500),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by  uuid,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (to_date >= from_date and to_date - from_date <= 60),
  check (not half_day or from_date = to_date)
);
create index if not exists leave_requests_user_idx on public.leave_requests (user_id, from_date);

create table if not exists public.holidays (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null default public.default_org_id() references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  day       date not null,
  name      text not null check (length(trim(name)) between 1 and 80),
  unique (org_id, branch_id, day)
);

alter table public.leave_requests enable row level security;
alter table public.holidays enable row level security;
revoke all on public.leave_requests, public.holidays from anon;
grant select, insert, update on public.leave_requests to authenticated;
grant select, insert, update, delete on public.holidays to authenticated;
grant all on public.leave_requests, public.holidays to service_role;
drop policy if exists org_isolation on public.leave_requests;
create policy org_isolation on public.leave_requests as restrictive for all to authenticated
  using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()));
drop policy if exists leave_requests_access on public.leave_requests;
create policy leave_requests_access on public.leave_requests for all to authenticated
  using (user_id = auth.uid() or ((select public.has_permission('approve_time')) or (select public.has_permission('view_attendance'))) and public.user_in_scope(user_id))
  with check (user_id = auth.uid() or (select public.has_permission('approve_time')) and public.user_in_scope(user_id));
drop policy if exists org_isolation on public.holidays;
create policy org_isolation on public.holidays as restrictive for all to authenticated
  using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()));
drop policy if exists holidays_read on public.holidays;
create policy holidays_read on public.holidays for select to authenticated using ((select public.is_active_user()));
drop policy if exists holidays_admin on public.holidays;
create policy holidays_admin on public.holidays for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop trigger if exists holidays_branch_check on public.holidays;
create trigger holidays_branch_check before insert or update of branch_id on public.holidays
  for each row execute function public.branch_belongs_to_firm();

-- People apply and may cancel their own; only an approver decides
create or replace function public.leave_requests_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform public.require_feature('attendance', 'Leave requests');
    new.status := 'pending';
    new.decided_by := null;
    new.decided_at := null;
    perform public.push_notification(a.id, 'leave_request',
              coalesce((select name from public.profiles where id = new.user_id), 'Someone') || ' asked for leave',
              to_char(new.from_date, 'DD/MM/YYYY') || case when new.to_date <> new.from_date then ' to ' || to_char(new.to_date, 'DD/MM/YYYY') else '' end
                || coalesce(' · ' || new.reason, ''),
              '/attendance?tab=approvals', 'leave', new.id, 'normal')
       from public.time_approvers(new.user_id) a(id);
    return new;
  end if;
  new.user_id := old.user_id;
  new.org_id := old.org_id;
  if new.status is distinct from old.status then
    if new.status = 'cancelled' and old.user_id = auth.uid() and old.status in ('pending', 'approved') then
      null;
    elsif new.status in ('approved', 'rejected') and old.status = 'pending' and old.user_id <> auth.uid()
          and public.has_permission('approve_time') and public.user_in_scope(old.user_id) then
      new.decided_by := auth.uid();
      new.decided_at := now();
      perform public.push_notification(old.user_id, 'leave_request', 'Your leave was ' || new.status,
                to_char(old.from_date, 'DD/MM/YYYY') || case when old.to_date <> old.from_date then ' to ' || to_char(old.to_date, 'DD/MM/YYYY') else '' end,
                '/attendance', 'leave', old.id, 'normal');
    else
      raise exception 'You can''t change this leave request.';
    end if;
  elsif old.status <> 'pending' or old.user_id <> auth.uid() then
    raise exception 'Only a pending request can be edited, by the person who made it.';
  end if;
  return new;
end $$;
drop trigger if exists leave_requests_before_write on public.leave_requests;
create trigger leave_requests_before_write before insert or update on public.leave_requests
  for each row execute function public.leave_requests_before_write();
revoke execute on function public.leave_requests_before_write() from public, anon, authenticated;

-- ---------------------------------------------------------------- 5. Reports
-- Working days for a person: not a weekly off, not a holiday of their firm or branch
create or replace function public.working_days(p_org uuid, p_branch uuid, p_from date, p_to date)
returns setof date
language sql stable security definer set search_path = public
as $$
  select d::date
    from generate_series(p_from, p_to, interval '1 day') d
   where extract(isodow from d) <= coalesce((select working_days_per_week from public.kpi_settings where org_id = p_org), 6)
     and not exists (select 1 from public.holidays h where h.org_id = p_org and h.day = d::date and (h.branch_id is null or h.branch_id = p_branch));
$$;
revoke execute on function public.working_days(uuid, uuid, date, date) from public, anon, authenticated;

create or replace function public.attendance_report(p_from date, p_to date, p_branch uuid default null)
returns table (user_id uuid, name text, branch text, working_days int, present_days int, leave_days numeric, absent_days int,
               late_days int, early_days int, office_days int, remote_days int, active_hours numeric, declared_hours numeric,
               pending_hours numeric, break_hours numeric, unaccounted_hours numeric)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_grace int;
begin
  if not (public.has_permission('view_attendance') or public.has_permission('approve_time')) then
    raise exception 'You can''t see attendance.';
  end if;
  perform public.require_feature('attendance_reports', 'Attendance reports');
  if p_to < p_from or p_to - p_from > 92 then
    raise exception 'Choose up to three months.';
  end if;
  select late_grace_minutes into v_grace from public.firm_settings where org_id = v_org;

  return query
  with people as (
    select m.user_id, coalesce(p.name, m.invited_name, 'Member') as name, m.branch_id, b.name as branch,
           coalesce(b.work_start, rs.work_start, time '10:00') as ws, coalesce(b.work_end, rs.work_end, time '19:00') as we
      from public.memberships m
      left join public.profiles p on p.id = m.user_id
      left join public.branches b on b.id = m.branch_id
      left join public.reminder_settings rs on rs.org_id = m.org_id
     where m.org_id = v_org and m.is_active and m.accepted_at is not null
       and (p_branch is null or m.branch_id = p_branch)
       and public.user_in_scope(m.user_id)
  ), wd as (
    select pe.user_id, w.d from people pe cross join lateral public.working_days(v_org, pe.branch_id, p_from, least(p_to, (now() at time zone 'Asia/Kolkata')::date)) w(d)
  ), lv as (
    select l.user_id, w.d, case when l.half_day then 0.5 else 1 end as part
      from public.leave_requests l join wd w on w.user_id = l.user_id and w.d between l.from_date and l.to_date
     where l.org_id = v_org and l.status = 'approved'
  ), days as (
    select a.* from public.user_activity_days a join people pe on pe.user_id = a.user_id where a.day between p_from and p_to
  )
  select pe.user_id, pe.name, pe.branch,
         (select count(*)::int from wd where wd.user_id = pe.user_id),
         (select count(*)::int from days where days.user_id = pe.user_id and days.active_minutes + days.declared_minutes > 0),
         coalesce((select sum(part) from lv where lv.user_id = pe.user_id), 0),
         (select count(*)::int from wd where wd.user_id = pe.user_id
            and not exists (select 1 from days where days.user_id = pe.user_id and days.day = wd.d and days.active_minutes + days.declared_minutes > 0)
            and not exists (select 1 from lv where lv.user_id = pe.user_id and lv.d = wd.d)),
         (select count(*)::int from days where days.user_id = pe.user_id
            and (coalesce(days.day_started_at, days.first_seen) at time zone 'Asia/Kolkata')::time > pe.ws + make_interval(mins => coalesce(v_grace, 15))),
         (select count(*)::int from days where days.user_id = pe.user_id and days.day < (now() at time zone 'Asia/Kolkata')::date
            and (coalesce(days.day_ended_at, days.last_seen) at time zone 'Asia/Kolkata')::time < pe.we - interval '30 minutes'),
         (select count(*)::int from days where days.user_id = pe.user_id and days.in_office),
         (select count(*)::int from days where days.user_id = pe.user_id and not days.in_office and days.active_minutes > 0),
         round(coalesce((select sum(active_minutes) from days where days.user_id = pe.user_id), 0) / 60.0, 1),
         round(coalesce((select sum(declared_minutes) from days where days.user_id = pe.user_id), 0) / 60.0, 1),
         round(coalesce((select sum(minutes) from public.away_periods ap where ap.user_id = pe.user_id and ap.day between p_from and p_to and ap.status = 'pending'), 0) / 60.0, 1),
         round(coalesce((select sum(break_minutes) from days where days.user_id = pe.user_id), 0) / 60.0, 1),
         round(coalesce((select sum(unaccounted_minutes) from days where days.user_id = pe.user_id), 0) / 60.0, 1)
    from people pe
   order by pe.branch nulls first, pe.name;
end $$;
revoke execute on function public.attendance_report(date, date, uuid) from public, anon;
grant execute on function public.attendance_report(date, date, uuid) to authenticated;

-- Hours of work assigned against hours available, from today to p_to
create or replace function public.capacity_report(p_to date, p_branch uuid default null)
returns table (user_id uuid, name text, branch text, available_minutes int, assigned_minutes int, open_tasks int, overdue_tasks int)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not (public.is_admin() or public.has_permission('view_attendance')) then
    raise exception 'You can''t see capacity.';
  end if;
  return query
  with people as (
    select m.user_id, coalesce(p.name, m.invited_name, 'Member') as name, m.branch_id, b.name as branch,
           greatest(60, extract(epoch from (coalesce(b.work_end, rs.work_end, time '19:00') - coalesce(b.work_start, rs.work_start, time '10:00'))) / 60 - 60)::int as daily
      from public.memberships m
      left join public.profiles p on p.id = m.user_id
      left join public.branches b on b.id = m.branch_id
      left join public.reminder_settings rs on rs.org_id = m.org_id
     where m.org_id = v_org and m.is_active and m.accepted_at is not null
       and (p_branch is null or m.branch_id = p_branch)
       and public.user_in_scope(m.user_id)
  )
  select pe.user_id, pe.name, pe.branch,
         (pe.daily * ((select count(*) from public.working_days(v_org, pe.branch_id, v_today, p_to) w(d))
                      - coalesce((select sum(case when l.half_day then 0.5 else 1 end) from public.leave_requests l
                                   cross join lateral public.working_days(v_org, pe.branch_id, greatest(l.from_date, v_today), least(l.to_date, p_to)) w(d)
                                   where l.user_id = pe.user_id and l.status = 'approved' and l.to_date >= v_today and l.from_date <= p_to), 0)))::int,
         coalesce((select sum(greatest(coalesce(t.estimated_minutes, 60) - coalesce(t.time_spent_minutes, 0), 15))
                     from public.tasks t where t.org_id = v_org and t.assigned_to = pe.user_id and t.stage <> 'Approved'
                      and coalesce(t.due_date, p_to) <= p_to), 0)::int,
         (select count(*)::int from public.tasks t where t.org_id = v_org and t.assigned_to = pe.user_id and t.stage <> 'Approved' and coalesce(t.due_date, p_to) <= p_to),
         (select count(*)::int from public.tasks t where t.org_id = v_org and t.assigned_to = pe.user_id and t.stage <> 'Approved' and t.due_date < v_today)
    from people pe
   order by pe.name;
end $$;
revoke execute on function public.capacity_report(date, uuid) from public, anon;
grant execute on function public.capacity_report(date, uuid) to authenticated;

commit;

-- Verification (one statement):
--
-- select
--   (select count(*) from information_schema.tables where table_name in ('away_periods', 'leave_requests', 'holidays')) as new_tables,
--   (select count(*) from information_schema.columns where (table_name, column_name) in
--     (('user_activity_days', 'in_office'), ('user_activity_days', 'declared_minutes'), ('firm_settings', 'away_quiet_minutes'))) as new_columns,
--   (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
--     ('record_away', 'decide_away', 'mark_office_presence', 'attendance_report', 'capacity_report', 'mark_my_day')) as new_functions,
--   (select has_function_privilege('authenticated', 'public.mark_office_presence(uuid, uuid, text)', 'execute')) as office_check_open_to_browser;
--
-- Expected: 3, 3, 6, false.
