-- 042_046_security_undo.sql
-- Puts back the security rules as they were before migrations 042 to 046 (batch 2).
-- Run it only to roll batch 2 back, together with the previous version of the code.
-- New tables and columns stay in place, unused; nothing is dropped or deleted from your data.
-- Invitations still waiting for an answer stay as inactive members; cancel them from the Team page.

begin;

-- 046: delete protections
drop trigger if exists tasks_before_delete on public.tasks;
drop trigger if exists email_accounts_before_delete on public.email_accounts;
drop trigger if exists quotations_before_delete on public.quotations;
drop trigger if exists proposals_before_delete on public.proposals;
drop trigger if exists service_packages_before_delete on public.service_packages;
drop function if exists public.tasks_before_delete();
drop function if exists public.email_accounts_before_delete();
drop function if exists public.quotations_before_delete();
drop function if exists public.proposals_before_delete();
drop function if exists public.service_packages_before_delete();

alter table public.client_packages drop constraint if exists client_packages_package_id_fkey;
alter table public.client_packages add constraint client_packages_package_id_fkey
  foreign key (package_id) references public.service_packages(id) on delete cascade;

-- 045: firm-scoped people
drop trigger if exists zzz_assignee_in_firm on public.tasks;
drop trigger if exists zzz_assignee_in_firm on public.leads;
drop trigger if exists zzz_assignee_in_firm on public.clients;
drop function if exists public.check_assignee_in_firm();

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = (select auth.uid()) or public.shares_org_with(id) or (select public.is_platform_admin()));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = (select auth.uid()) or ((select public.is_admin()) and public.shares_org_with(id)))
  with check (id = (select auth.uid()) or ((select public.is_admin()) and public.shares_org_with(id)));

CREATE OR REPLACE FUNCTION public.protect_profiles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    return new;
  end if;

  if new.role is distinct from old.role
     or new.is_reviewer is distinct from old.is_reviewer
     or new.is_active is distinct from old.is_active
     or new.module_access is distinct from old.module_access then
    raise exception 'Only administrators can change roles or access.';
  end if;

  return new;
end;$function$;

drop function if exists public.in_current_firm(uuid);

-- 044: invitation consent
alter table public.memberships drop constraint if exists memberships_active_needs_acceptance;
drop function if exists public.my_invitations();
drop function if exists public.respond_to_invitation(uuid, boolean);

CREATE OR REPLACE FUNCTION public.my_signup_state()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'has_membership', exists (select 1 from public.memberships where user_id = auth.uid()),
    'email_confirmed', exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null)
  )$function$;

CREATE OR REPLACE FUNCTION public.firm_members()
 RETURNS TABLE(id uuid, name text, email text, phone text, designation text, role text, is_reviewer boolean, is_active boolean, module_access jsonb, joined_at timestamp with time zone, invite_pending boolean, last_sign_in_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.name, p.email, p.phone, coalesce(m.designation, p.designation),
         m.role, m.is_reviewer, m.is_active, m.module_access, m.joined_at,
         (u.email_confirmed_at is null) as invite_pending, u.last_sign_in_at
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.org_id = public.current_org_id()
    and public.is_admin()
  order by p.name$function$;

-- 043: per-mailbox access
drop policy if exists email_accounts_select_allowed on public.email_accounts;
drop policy if exists email_accounts_select_active on public.email_accounts;
create policy email_accounts_select_active on public.email_accounts for select
  using ((select public.is_active_user()));

drop policy if exists email_messages_select_allowed on public.email_messages;
drop policy if exists email_messages_select_active on public.email_messages;
create policy email_messages_select_active on public.email_messages for select
  using ((select public.is_active_user()));

drop policy if exists email_messages_update_allowed on public.email_messages;
drop policy if exists email_messages_update_active on public.email_messages;
create policy email_messages_update_active on public.email_messages for update
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

drop policy if exists email_messages_insert_allowed on public.email_messages;
drop policy if exists email_messages_insert_active on public.email_messages;
create policy email_messages_insert_active on public.email_messages for insert
  with check ((select public.is_active_user()));

drop policy if exists email_attachments_allowed on public.email_attachments;
drop policy if exists baseline_active_staff on public.email_attachments;
create policy baseline_active_staff on public.email_attachments for all
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

drop function if exists public.can_use_mailbox(uuid);

-- 042: mailbox ownership
CREATE OR REPLACE FUNCTION public.email_accounts_guard_verified()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- Changing the address clears the proof (unless the server sets it in the same update)
  if tg_op = 'UPDATE' and new.email_address is distinct from old.email_address
     and new.verified_at is not distinct from old.verified_at then
    new.verified_at := null;
  end if;

  -- Only the server may mark a mailbox as verified
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if tg_op = 'INSERT' then
      new.verified_at := null;
    elsif new.verified_at is not null and new.verified_at is distinct from old.verified_at then
      new.verified_at := old.verified_at;
    end if;
  end if;
  return new;
end$function$;

drop index if exists public.email_accounts_confirmed_address_uidx;

-- The old one-address-one-firm rule on tested connections. It cannot be put back while two firms
-- have tested the same address; the undo then stops here and changes nothing.
do $$
declare
  v_address text;
begin
  select lower(email_address) into v_address
    from public.email_accounts
   where verified_at is not null
   group by lower(email_address)
  having count(*) > 1
   limit 1;
  if v_address is not null then
    raise exception 'Undo stopped: % has a tested connection in more than one firm. Send this message to your developer.', v_address;
  end if;
end $$;
CREATE UNIQUE INDEX IF NOT EXISTS email_accounts_verified_address_uidx ON public.email_accounts USING btree (lower(email_address)) WHERE (verified_at IS NOT NULL);

commit;

-- Verification (one statement):
-- select (select count(*) from pg_trigger where not tgisinternal and tgname in
--          ('tasks_before_delete', 'email_accounts_before_delete', 'quotations_before_delete',
--           'proposals_before_delete', 'service_packages_before_delete', 'zzz_assignee_in_firm')) as batch2_triggers_left,
--        to_regprocedure('public.can_use_mailbox(uuid)') is null as mailbox_rules_removed,
--        to_regclass('public.email_accounts_verified_address_uidx') is not null as old_index_back;
-- Expected: 0, true, true.
