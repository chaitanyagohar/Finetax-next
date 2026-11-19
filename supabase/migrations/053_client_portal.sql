-- 053_client_portal.sql
-- Batch 10, client portal.
-- Clients sign in with a one-time email link. They are not Supabase users and never query the
-- database themselves: every portal page and file goes through the server, which only ever reads
-- that one client's records. These tables are therefore closed to the browser (service role only),
-- apart from staff reading who has portal access.
--   1. client_portal_users: who may sign in for which client.
--   2. client_portal_tokens: one-time sign-in links and signed-in sessions (stored as SHA-256 hashes).
--   3. documents.shared_with_client / documents.from_client.
-- Safe to run more than once. No data is dropped or deleted.

begin;

create table if not exists public.client_portal_users (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete cascade,
  email         text not null check (email = lower(trim(email)) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  name          text check (name is null or length(name) <= 120),
  is_active     boolean not null default true,
  invited_by    uuid,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists client_portal_users_unique on public.client_portal_users (client_id, email);
create index if not exists client_portal_users_email_idx on public.client_portal_users (email) where is_active;

create table if not exists public.client_portal_tokens (
  id             uuid primary key default gen_random_uuid(),
  portal_user_id uuid not null references public.client_portal_users(id) on delete cascade,
  purpose        text not null check (purpose in ('login', 'session')),
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at     timestamptz not null,
  used_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists client_portal_tokens_user_idx on public.client_portal_tokens (portal_user_id, purpose);

alter table public.client_portal_users enable row level security;
alter table public.client_portal_tokens enable row level security;
revoke all on public.client_portal_users from anon, authenticated;
revoke all on public.client_portal_tokens from anon, authenticated;
grant select on public.client_portal_users to authenticated;
grant all on public.client_portal_users to service_role;
grant all on public.client_portal_tokens to service_role;

drop policy if exists org_isolation on public.client_portal_users;
create policy org_isolation on public.client_portal_users as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));
drop policy if exists client_portal_users_select on public.client_portal_users;
create policy client_portal_users_select on public.client_portal_users for select to authenticated
  using ((select public.is_active_user()));
-- client_portal_tokens: no policy for signed-in staff, so only the server can read it

alter table public.documents add column if not exists shared_with_client boolean not null default false;
alter table public.documents add column if not exists from_client boolean not null default false;

-- Old sign-in links and sessions are cleared once a day by the reminder job's housekeeping
create or replace function public.portal_housekeeping()
returns int
language sql security definer set search_path = public
as $$
  with gone as (
    delete from public.client_portal_tokens where expires_at < now() - interval '7 days' returning 1
  )
  select count(*)::int from gone;
$$;
revoke execute on function public.portal_housekeeping() from public, anon, authenticated;
grant execute on function public.portal_housekeeping() to service_role;

commit;

-- Verification (one statement):
--
-- select
--   (select count(*) from information_schema.tables where table_name in ('client_portal_users', 'client_portal_tokens')) as portal_tables,
--   (select count(*) from information_schema.columns where table_name = 'documents' and column_name in ('shared_with_client', 'from_client')) as new_columns,
--   (select has_table_privilege('authenticated', 'public.client_portal_tokens', 'select')) as tokens_open_to_browser;
--
-- Expected: 2, 2, false.
