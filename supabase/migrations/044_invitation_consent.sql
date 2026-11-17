-- 044_invitation_consent.sql
-- S-06: someone who already has a Duesk login joins another firm only after accepting its
-- invitation. Until then the membership is pending: inactive, not counted against the plan,
-- and invisible to every access check.
-- Safe to run more than once. No data is dropped or deleted.

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'memberships' and column_name = 'accepted_at') then
    alter table public.memberships add column accepted_at timestamptz;
    -- Everyone already in a firm has, in effect, accepted
    update public.memberships set accepted_at = joined_at;
    alter table public.memberships alter column accepted_at set default now();
  end if;
end $$;

-- The name the inviting administrator typed. The Team page shows it until the person accepts,
-- so an invitation never reveals the details of someone else's Duesk login.
alter table public.memberships add column if not exists invited_name text;

-- Nobody is active in a firm they have not agreed to join
alter table public.memberships drop constraint if exists memberships_active_needs_acceptance;
alter table public.memberships add constraint memberships_active_needs_acceptance
  check (accepted_at is not null or not is_active);

comment on column public.memberships.accepted_at is
  'When the person joined or accepted. Null with is_active = false means an invitation awaiting their answer.';

-- Invitations waiting for the signed-in person
create or replace function public.my_invitations()
returns table (org_id uuid, org_name text, role text, invited_by_name text, invited_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select o.id, o.name, m.role, p.name, m.joined_at
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  left join public.profiles p on p.id = m.invited_by
  where m.user_id = auth.uid()
    and m.accepted_at is null
    and not m.is_active
    and o.status in ('trial', 'active')
  order by m.joined_at
$$;

create or replace function public.respond_to_invitation(p_org uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  perform 1 from public.memberships
   where org_id = p_org and user_id = v_user and accepted_at is null and not is_active
     for update;
  if not found then
    raise exception 'This invitation is no longer available.';
  end if;

  if not coalesce(p_accept, false) then
    delete from public.memberships where org_id = p_org and user_id = v_user;
    return 'declined';
  end if;

  -- memberships_enforce_plan refuses this if the firm has no free seat
  update public.memberships
     set is_active = true, accepted_at = now(), joined_at = now(), updated_at = now()
   where org_id = p_org and user_id = v_user;

  -- memberships_join_general only runs on insert, when the invitation was still inactive
  insert into public.chat_members (org_id, channel_id, user_id)
  select c.org_id, c.id, v_user
  from public.chat_channels c
  where c.org_id = p_org and c.kind = 'channel' and c.name = 'general' and c.archived_at is null
  on conflict do nothing;

  return 'accepted';
end $$;

revoke all on function public.my_invitations() from public, anon;
revoke all on function public.respond_to_invitation(uuid, boolean) from public, anon;
grant execute on function public.my_invitations() to authenticated, service_role;
grant execute on function public.respond_to_invitation(uuid, boolean) to authenticated, service_role;

-- An unanswered invitation is not yet a membership: a new signup who has one still sets up their own firm
create or replace function public.my_signup_state()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'has_membership', exists (select 1 from public.memberships where user_id = auth.uid() and accepted_at is not null),
    'email_confirmed', exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null)
  )
$$;

-- The Team page lists an unanswered invitation as pending, like an unconfirmed new login
create or replace function public.firm_members()
returns table (id uuid, name text, email text, phone text, designation text, role text, is_reviewer boolean,
               is_active boolean, module_access jsonb, joined_at timestamptz, invite_pending boolean,
               last_sign_in_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select p.id,
         case when m.accepted_at is null then coalesce(m.invited_name, p.email) else p.name end,
         p.email,
         case when m.accepted_at is null then null else p.phone end,
         case when m.accepted_at is null then m.designation else coalesce(m.designation, p.designation) end,
         m.role, m.is_reviewer, m.is_active, m.module_access, m.joined_at,
         (u.email_confirmed_at is null or m.accepted_at is null) as invite_pending,
         case when m.accepted_at is null then null else u.last_sign_in_at end
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.org_id = public.current_org_id()
    and public.is_admin()
  order by p.name
$$;

commit;

-- Verification (one statement):
--
-- select o.slug,
--        count(*) filter (where m.accepted_at is not null) as members,
--        count(*) filter (where m.accepted_at is null and not m.is_active) as invitations_waiting,
--        count(*) filter (where m.accepted_at is null and m.is_active) as active_without_acceptance
-- from public.memberships m join public.organizations o on o.id = m.org_id
-- group by 1 order by 1;
--
-- Expected: active_without_acceptance = 0 for every firm; invitations_waiting = 0 straight after the migration.
