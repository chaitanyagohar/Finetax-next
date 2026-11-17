-- Stand-ins for the parts of Supabase a plain Postgres doesn't have, so a schema-only dump of the
-- live database can be loaded locally. auth.uid() returns the "signed-in user" set with
--   select set_config('test.uid', '<user id>', false);
-- Run once on an empty database, before the schema dump.

do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role','supabase_admin','supabase_auth_admin','authenticator','dashboard_user','pgbouncer'] loop
    if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I', r); end if;
  end loop; end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now(), last_sign_in_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'service_role') $$;
create schema if not exists extensions;
create schema if not exists vault;
create schema if not exists storage;
grant usage on schema auth to public;
