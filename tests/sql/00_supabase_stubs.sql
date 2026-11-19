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
-- Session claims: "aal" is aal2 only when a test sets test.aal
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object('sub', auth.uid(), 'aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal1')) $$;
create table if not exists auth.mfa_factors (id uuid primary key, user_id uuid not null, friendly_name text, factor_type text,
  status text, created_at timestamptz, updated_at timestamptz);
create schema if not exists extensions;
create schema if not exists vault;
create schema if not exists storage;
grant usage on schema auth to public;
-- Vault, for tables that keep secrets there (mailboxes, payment keys). Plain text here; Supabase encrypts it.
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), secret text, name text, description text);
create or replace view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret from vault.secrets;
create or replace function vault.create_secret(s text, n text default null, d text default null) returns uuid language sql as $$ insert into vault.secrets (secret, name, description) values (s, n, d) returning id $$;
create or replace function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret = s where id = i $$;
