-- 060_security_and_email.sql
-- Batch 12, before launch.
--   1. Two-step sign-in (TOTP). Once a person has set it up, every session must be verified with a code
--      before any firm data opens. This is checked in the database, not just the app. A firm can also
--      require it for its administrators.
--   2. Signed-out visitors (the anon role) lose every table and function grant. Row-level security
--      already hid all rows from them; this closes the door as well.
--   3. Server-side activity log (S-09): invoices, payments, team changes, client deletion, firm settings,
--      payment keys, mailboxes, branches, roles and support access are logged by the database itself,
--      so an entry can't be skipped by the browser.
--   4. Email log: every email Duesk tries to send, with the result. Firm admins see their own; the Duesk
--      owner sees health per firm (counts and errors only, never subjects or recipients).
--   5. Support access: the Duesk owner is notified when a firm grants it.
--   6. Getting-started progress for photo, logo, branches, roles and two-step sign-in.
-- Safe to run more than once. No data is dropped or deleted.

begin;

-- ---------------------------------------------------------------- 1. Two-step sign-in
alter table public.firm_settings add column if not exists require_mfa_admins boolean not null default false;

-- True when this session may open data: either the person has no verified second step, or this session used it
create or replace function public.mfa_ok()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;
revoke execute on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated, service_role;

-- Every org_isolation policy runs through this, so an unverified session sees no firm at all
create or replace function public.current_org_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select case when public.mfa_ok() then coalesce(
    (select u.org_id
       from public.user_active_org u
      where u.user_id = auth.uid()
        and u.org_id in (select public.my_org_ids())),
    (select m.org_id
       from public.memberships m
       join public.organizations o on o.id = m.org_id
      where m.user_id = auth.uid()
        and m.is_active
        and o.status in ('trial', 'active')
      order by m.joined_at, m.org_id
      limit 1)
  ) end
$$;

create or replace function public.is_platform_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.mfa_ok() and exists (select 1 from public.platform_admins where user_id = auth.uid() and role = 'owner')
$$;

-- Administrator rights need a verified session when the firm asks for it
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = public.current_org_id()
      and m.is_active
      and m.role = 'admin'
  )
  and (coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
       or not coalesce((select f.require_mfa_admins from public.firm_settings f where f.org_id = public.current_org_id()), false))
$$;

-- What the app needs to steer the person: has a second step, this session verified, firm requires it of admins
create or replace function public.my_security()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'has_mfa', exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'),
    'session_verified', coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2',
    'firm_requires_for_admins', coalesce((select f.require_mfa_admins from public.firm_settings f
                                            join public.memberships m on m.org_id = f.org_id and m.user_id = auth.uid() and m.is_active and m.role = 'admin'
                                           order by m.joined_at limit 1), false)
  );
$$;
revoke execute on function public.my_security() from public, anon;
grant execute on function public.my_security() to authenticated;

-- ---------------------------------------------------------------- 2. Nothing for signed-out visitors
do $$
declare
  r record;
begin
  execute 'revoke all on all tables in schema public from anon';
  execute 'revoke all on all sequences in schema public from anon';
  -- Functions: take execute away from PUBLIC (which anon inherits) and give it back to signed-in users,
  -- except functions that belong to extensions
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- Only used inside other database functions
revoke execute on function public.default_branch(uuid) from authenticated;

-- ---------------------------------------------------------------- 3. Activity log written by the database
-- tg_argv: 0 = area shown in Logs, 1 = action word, 2 = column that identifies the record
create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_org uuid;
  k text;
begin
  v_org := coalesce((v_row ->> 'org_id')::uuid, public.current_org_id());
  -- Nothing to log against when the whole firm is being removed
  if v_org is null or not exists (select 1 from public.organizations where id = v_org) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    for k in select key from jsonb_each(v_new) loop
      continue when k in ('updated_at', 'last_synced_at', 'last_uid', 'uid_validity', 'sync_locked_until', 'last_event_at', 'search_vector');
      if v_old -> k is distinct from v_new -> k then
        v_changes := v_changes || jsonb_build_object(k,
          case when k ~ '(pass|secret|token|key_id)' then '"changed"'::jsonb
               else jsonb_build_object('from', v_old -> k, 'to', v_new -> k) end);
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  end if;
  insert into public.audit_logs (org_id, user_id, action, entity, entity_id, metadata)
  values (v_org, auth.uid(),
          tg_argv[1] || case tg_op when 'INSERT' then '_CREATED' when 'UPDATE' then '_UPDATED' else '_DELETED' end,
          tg_argv[0],
          case when (v_row ->> tg_argv[2]) ~ '^[0-9a-f-]{36}$' then (v_row ->> tg_argv[2])::uuid end,
          jsonb_build_object('source', 'database')
            || case when tg_op = 'UPDATE' then jsonb_build_object('changes', v_changes) else '{}'::jsonb end
            || case when tg_argv[0] = 'INVOICES' then jsonb_build_object('number', v_row ->> 'invoice_number', 'status', v_row ->> 'status', 'total', v_row -> 'total')
                    when tg_argv[0] = 'PAYMENTS' then jsonb_build_object('amount', v_row -> 'amount', 'invoice_id', v_row ->> 'invoice_id')
                    when tg_argv[0] = 'CLIENTS' then jsonb_build_object('name', v_row ->> 'name')
                    when tg_argv[0] = 'TEAM' then jsonb_build_object('user_id', v_row ->> 'user_id', 'role', v_row ->> 'role')
                    else '{}'::jsonb end);
  return null;
end $$;
revoke execute on function public.audit_row_change() from public, anon, authenticated;

drop trigger if exists zz_audit_invoices on public.invoices;
create trigger zz_audit_invoices after update of status, invoice_number, client_id, total or delete on public.invoices
  for each row when (coalesce(current_setting('app.bulk_move', true), 'off') <> 'on')
  execute function public.audit_row_change('INVOICES', 'INVOICE', 'id');
drop trigger if exists zz_audit_payments on public.invoice_payments;
create trigger zz_audit_payments after insert or delete on public.invoice_payments
  for each row execute function public.audit_row_change('PAYMENTS', 'PAYMENT', 'id');
drop trigger if exists zz_audit_memberships on public.memberships;
create trigger zz_audit_memberships after insert or update of role, is_active, module_access, is_reviewer, role_id, branch_id or delete on public.memberships
  for each row execute function public.audit_row_change('TEAM', 'MEMBER', 'user_id');
drop trigger if exists zz_audit_clients on public.clients;
create trigger zz_audit_clients after delete on public.clients
  for each row execute function public.audit_row_change('CLIENTS', 'CLIENT', 'id');
drop trigger if exists zz_audit_firm_settings on public.firm_settings;
create trigger zz_audit_firm_settings after update on public.firm_settings
  for each row execute function public.audit_row_change('SETTINGS', 'FIRM_SETTINGS', 'org_id');
drop trigger if exists zz_audit_payment_gateways on public.payment_gateways;
create trigger zz_audit_payment_gateways after insert or update or delete on public.payment_gateways
  for each row execute function public.audit_row_change('SETTINGS', 'PAYMENT_KEYS', 'org_id');
drop trigger if exists zz_audit_email_accounts on public.email_accounts;
create trigger zz_audit_email_accounts after insert or update of smtp_host, smtp_port, smtp_user, smtp_secret_id, email_address, is_active or delete on public.email_accounts
  for each row execute function public.audit_row_change('EMAIL_ACCOUNTS', 'MAILBOX', 'id');
drop trigger if exists zz_audit_branches on public.branches;
create trigger zz_audit_branches after insert or update or delete on public.branches
  for each row execute function public.audit_row_change('SETTINGS', 'BRANCH', 'id');
drop trigger if exists zz_audit_roles on public.roles;
create trigger zz_audit_roles after insert or update or delete on public.roles
  for each row execute function public.audit_row_change('TEAM', 'ROLE', 'id');
drop trigger if exists zz_audit_support_access on public.support_access_grants;
create trigger zz_audit_support_access after insert or update on public.support_access_grants
  for each row execute function public.audit_row_change('SETTINGS', 'SUPPORT_ACCESS', 'id');

-- ---------------------------------------------------------------- 4. Email log
create table if not exists public.email_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  kind        text not null default 'other' check (kind ~ '^[a-z_]{2,30}$'),
  from_address text,
  recipients  text[] not null default '{}',
  subject     text,
  status      text not null check (status in ('sent', 'failed')),
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists email_log_org_idx on public.email_log (org_id, created_at desc);
alter table public.email_log enable row level security;
revoke all on public.email_log from anon, authenticated;
grant select on public.email_log to authenticated;
grant all on public.email_log to service_role;
drop policy if exists org_isolation on public.email_log;
create policy org_isolation on public.email_log as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()));
drop policy if exists email_log_admin on public.email_log;
create policy email_log_admin on public.email_log for select to authenticated using ((select public.is_admin()));

-- The Duesk owner's view: where email is working, never what was sent or to whom
create or replace function public.platform_email_health()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_support uuid;
begin
  if not public.is_platform_owner() then
    raise exception 'Only the Duesk owner can see this.';
  end if;
  select support_org_id into v_support from public.platform_config limit 1;
  return jsonb_build_object(
    'platform_sender', jsonb_build_object(
      'org_id', v_support,
      'org_name', (select name from public.organizations where id = v_support),
      'mailboxes', (select coalesce(jsonb_agg(jsonb_build_object('address', e.email_address, 'active', e.is_active,
                       'last_sync_error', e.last_sync_error) order by e.created_at), '[]'::jsonb)
                      from public.email_accounts e where e.org_id = v_support)),
    'firms', (select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) from (
      select jsonb_build_object(
        'org_id', o.id, 'name', o.name,
        'mailboxes', (select count(*) from public.email_accounts e where e.org_id = o.id and e.is_active),
        'sent_7d', (select count(*) from public.email_log l where l.org_id = o.id and l.status = 'sent' and l.created_at > now() - interval '7 days'),
        'failed_7d', (select count(*) from public.email_log l where l.org_id = o.id and l.status = 'failed' and l.created_at > now() - interval '7 days'),
        'last_error', (select l.error from public.email_log l where l.org_id = o.id and l.status = 'failed' order by l.created_at desc limit 1),
        'last_error_at', (select max(l.created_at) from public.email_log l where l.org_id = o.id and l.status = 'failed'),
        'last_sent_at', (select max(l.created_at) from public.email_log l where l.org_id = o.id and l.status = 'sent')) as x,
        o.name
      from public.organizations o where o.status in ('trial', 'active')) q)
  );
end $$;
revoke execute on function public.platform_email_health() from public, anon;
grant execute on function public.platform_email_health() to authenticated;

-- ---------------------------------------------------------------- 5. Support access tells the Duesk owner
create or replace function public.support_access_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_firm text;
  v_who text;
begin
  select name into v_firm from public.organizations where id = new.org_id;
  select name into v_who from public.profiles where id = coalesce(new.granted_by, auth.uid());
  insert into public.notifications (org_id, user_id, type, title, body, link, entity, entity_id, priority, actor_id)
  select coalesce(m.org_id, new.org_id), pa.user_id, 'support_request',
         left(coalesce(v_firm, 'A firm') || ' gave support access', 200),
         left(coalesce(v_who, 'An administrator') || ' allowed Duesk support until '
              || to_char(new.expires_at at time zone 'Asia/Kolkata', 'DD/MM/YYYY HH24:MI') || coalesce('. Reason: ' || new.reason, ''), 1000),
         '/owner?support=' || new.org_id, 'support', new.id, 'important', auth.uid()
    from public.platform_admins pa
    left join lateral (select mm.org_id from public.memberships mm join public.organizations o on o.id = mm.org_id
                        where mm.user_id = pa.user_id and mm.is_active and o.slug = 'oddlambda' limit 1) m on true
   where pa.role = 'owner' and m.org_id is not null;
  return null;
end $$;
revoke execute on function public.support_access_notify() from public, anon, authenticated;
drop trigger if exists support_access_notify on public.support_access_grants;
create trigger support_access_notify after insert on public.support_access_grants
  for each row execute function public.support_access_notify();

-- ---------------------------------------------------------------- 6. Getting started
create or replace function public.my_onboarding()
returns jsonb
language sql stable security definer set search_path = public
as $$
  with ctx as (select public.current_org_id() as org)
  select jsonb_build_object(
    'setup_completed', coalesce((select o.setup_completed_at is not null from public.organizations o, ctx where o.id = ctx.org), false),
    'onboarding', coalesce((select m.onboarding from public.memberships m, ctx where m.org_id = ctx.org and m.user_id = auth.uid()), '{}'::jsonb),
    'progress', jsonb_build_object(
      'team',     (select count(*) > 1 from public.memberships m, ctx where m.org_id = ctx.org and m.is_active),
      'mailbox',  exists (select 1 from public.email_accounts e, ctx where e.org_id = ctx.org),
      'client',   exists (select 1 from public.clients c, ctx where c.org_id = ctx.org),
      'package',  exists (select 1 from public.service_packages s, ctx where s.org_id = ctx.org),
      'proposal', exists (select 1 from public.proposals p, ctx where p.org_id = ctx.org and p.status <> 'Draft'),
      'task',     exists (select 1 from public.tasks t, ctx where t.org_id = ctx.org),
      'time',     exists (select 1 from public.time_logs l, ctx where l.org_id = ctx.org),
      'invoice',  exists (select 1 from public.invoices i, ctx where i.org_id = ctx.org and i.invoice_number is not null),
      'photo',    exists (select 1 from public.profiles p where p.id = auth.uid() and p.avatar_url is not null),
      'logo',     exists (select 1 from public.firm_settings f, ctx where f.org_id = ctx.org and f.logo_url is not null),
      'branches', (select count(*) > 1 from public.branches b, ctx where b.org_id = ctx.org),
      'roles',    exists (select 1 from public.roles r, ctx where r.org_id = ctx.org),
      'attendance', exists (select 1 from public.holidays h, ctx where h.org_id = ctx.org),
      'mfa',      exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
    )
  )
$$;

commit;

-- Verification (one statement):
--
-- select
--   (select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public') as anon_table_grants,
--   (select count(*) from pg_trigger where tgname like 'zz_audit_%') as audit_triggers,
--   (select count(*) from information_schema.tables where table_name = 'email_log') as email_log,
--   (select prosrc like '%mfa_ok%' from pg_proc where proname = 'current_org_id') as two_step_enforced;
--
-- Expected: 0, 10, 1, true.
