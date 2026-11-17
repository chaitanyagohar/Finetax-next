-- 045_firm_scoped_people.sql
-- S-21: an administrator can change only people in the firm they are working in.
-- S-22: people are visible, and can be given work, only within the firm being worked in.
-- Safe to run more than once. No data is dropped or deleted.

begin;

-- Past and present members of the caller's current firm. People with an unanswered invitation are not included.
create or replace function public.in_current_firm(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = p_user
      and m.org_id = public.current_org_id()
      and m.accepted_at is not null)
$$;
revoke all on function public.in_current_firm(uuid) from public, anon;
grant execute on function public.in_current_firm(uuid) to authenticated, service_role;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = (select auth.uid()) or public.in_current_firm(id) or (select public.is_platform_admin()));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = (select auth.uid()) or ((select public.is_admin()) and public.in_current_firm(id)))
  with check (id = (select auth.uid()) or ((select public.is_admin()) and public.in_current_firm(id)));

create or replace function public.protect_profiles()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Server routes (service role) and the SQL Editor have no logged-in user: allow
  if auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Team members can only be removed from the Team page.';
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Team members can only be created from the Team page.';
  end if;

  -- UPDATE
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'Login emails can only be changed with "Change login email" on the Team page.';
  end if;

  if public.is_admin() then
    if new.id = auth.uid() and (new.role::text <> 'admin' or coalesce(new.is_active, true) = false) then
      raise exception 'You cannot remove your own admin access or disable your own account.';
    end if;
    if new.id <> auth.uid() and not public.in_current_firm(new.id) then
      raise exception 'You can only change people who belong to your firm.';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
     or new.is_reviewer is distinct from old.is_reviewer
     or new.is_active is distinct from old.is_active
     or new.module_access is distinct from old.module_access then
    raise exception 'Only administrators can change roles or access.';
  end if;

  return new;
end;
$$;

-- Work can be given only to an active member of the record's own firm. The columns to check
-- are the trigger arguments. A person choosing someone outside the firm gets an error; a
-- system-generated record (a recurring task, a billing or reminder job) is left unassigned
-- instead, so the job never fails because someone has left the firm.
create or replace function public.check_assignee_in_firm()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_col text;
  v_new uuid;
  v_old uuid;
begin
  if new.org_id is null then
    return new;
  end if;

  foreach v_col in array tg_argv loop
    v_new := (to_jsonb(new) ->> v_col)::uuid;
    v_old := case when tg_op = 'UPDATE' then (to_jsonb(old) ->> v_col)::uuid end;
    if v_new is null or v_new is not distinct from v_old or public.is_org_member(v_new, new.org_id) then
      continue;
    end if;
    if auth.uid() is not null and pg_trigger_depth() = 1 then
      raise exception 'Choose someone who is an active member of this firm.';
    end if;
    new := jsonb_populate_record(new, jsonb_build_object(v_col, null));
  end loop;
  return new;
end $$;

-- Named to run after zz_inherit_org, which settles org_id
drop trigger if exists zzz_assignee_in_firm on public.tasks;
create trigger zzz_assignee_in_firm before insert or update of assigned_to, reviewer_id on public.tasks
  for each row execute function public.check_assignee_in_firm('assigned_to', 'reviewer_id');

drop trigger if exists zzz_assignee_in_firm on public.leads;
create trigger zzz_assignee_in_firm before insert or update of assigned_to on public.leads
  for each row execute function public.check_assignee_in_firm('assigned_to');

drop trigger if exists zzz_assignee_in_firm on public.clients;
create trigger zzz_assignee_in_firm before insert or update of assigned_to on public.clients
  for each row execute function public.check_assignee_in_firm('assigned_to');

commit;

-- Verification (one statement):
--
-- select 'tasks.assigned_to' as field, count(*) as outside_firm from public.tasks t
--  where t.assigned_to is not null and not exists (select 1 from public.memberships m where m.user_id = t.assigned_to and m.org_id = t.org_id)
-- union all
-- select 'tasks.reviewer_id', count(*) from public.tasks t
--  where t.reviewer_id is not null and not exists (select 1 from public.memberships m where m.user_id = t.reviewer_id and m.org_id = t.org_id)
-- union all
-- select 'leads.assigned_to', count(*) from public.leads l
--  where l.assigned_to is not null and not exists (select 1 from public.memberships m where m.user_id = l.assigned_to and m.org_id = l.org_id)
-- union all
-- select 'clients.assigned_to', count(*) from public.clients c
--  where c.assigned_to is not null and not exists (select 1 from public.memberships m where m.user_id = c.assigned_to and m.org_id = c.org_id);
--
-- Expected: 0 in every row. A number above 0 is existing work already given to someone outside the firm;
-- it is left as it is, and can be reassigned from the page.
