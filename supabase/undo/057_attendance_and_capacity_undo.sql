-- Undo for 057_attendance_and_capacity.sql. Run 058 undo first.
-- Removes away answers, leave requests, holidays and the attendance reports. Deletes those records.
-- Activity per day (first seen, last seen, active minutes) stays as before batch 11.

begin;

drop function if exists public.attendance_report(date, date, uuid);
drop function if exists public.capacity_report(date, uuid);
drop function if exists public.working_days(uuid, uuid, date, date);
drop function if exists public.decide_away(uuid, boolean);
drop function if exists public.record_away(timestamptz, text, uuid, text);
drop function if exists public.refresh_day_totals(uuid, date);
drop function if exists public.time_approvers(uuid);
drop function if exists public.mark_my_day(text);
drop function if exists public.mark_office_presence(uuid, uuid, text);

drop trigger if exists leave_requests_before_write on public.leave_requests;
drop function if exists public.leave_requests_before_write();

drop table if exists public.away_periods;
drop table if exists public.leave_requests;
drop table if exists public.holidays;

alter table public.user_activity_days drop column if exists in_office;
alter table public.user_activity_days drop column if exists office_branch_id;
alter table public.user_activity_days drop column if exists day_started_at;
alter table public.user_activity_days drop column if exists day_ended_at;
alter table public.user_activity_days drop column if exists declared_minutes;
alter table public.user_activity_days drop column if exists break_minutes;
alter table public.user_activity_days drop column if exists unaccounted_minutes;
alter table public.firm_settings drop column if exists away_quiet_minutes;
alter table public.firm_settings drop column if exists declared_approval_minutes;
alter table public.firm_settings drop column if exists late_grace_minutes;

commit;
