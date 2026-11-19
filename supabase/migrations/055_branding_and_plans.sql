-- 055_branding_and_plans.sql
-- Batch 11, pictures and plan controls.
--   1. Pictures: profiles.avatar_url, firm_settings.logo_url and brand_color, and a public "brand-assets"
--      storage bucket. The server writes these after checking the file; the browser never uploads directly.
--   2. Plans: feature switches (plans.features) and limits for storage, audit history and portal clients.
--      Firms already on Duesk keep the features they use today, as extras the owner can remove.
--   3. org_feature_overrides: the Duesk owner gives one firm a feature (or takes one away), optionally until a date.
--   4. has_feature() / my_features(): what the signed-in firm may use (overrides first, then its plan).
--   5. upgrade_requests: a firm asks for a locked feature; the Duesk owner is notified.
--   6. Enforced in the database: storage limit on documents, reviewers (maker-checker), enquiries and
--      retainer packages.
-- Safe to run more than once. No data is dropped or deleted.

begin;

-- ---------------------------------------------------------------- 1. Pictures
alter table public.profiles add column if not exists avatar_url text;
alter table public.firm_settings add column if not exists logo_url text;
alter table public.firm_settings add column if not exists brand_color text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_url_check') then
    alter table public.profiles add constraint profiles_avatar_url_check check (avatar_url is null or avatar_url ~ '^https://') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'firm_settings_logo_url_check') then
    alter table public.firm_settings add constraint firm_settings_logo_url_check check (logo_url is null or logo_url ~ '^https://') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'firm_settings_brand_color_check') then
    alter table public.firm_settings add constraint firm_settings_brand_color_check check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$') not valid;
  end if;
  -- Logos and photos are meant to be seen (PDFs, emails, the portal), so this bucket is public.
  -- File names are random, and only the server writes to it.
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('brand-assets', 'brand-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];
  end if;
end $$;

-- ---------------------------------------------------------------- 2. Plan switches and limits
alter table public.plans add column if not exists features jsonb not null default '{}'::jsonb;
alter table public.plans add column if not exists max_storage_mb int;
alter table public.plans add column if not exists audit_days int;
alter table public.plans add column if not exists max_portal_clients int;
alter table public.plans add column if not exists price_note text;

-- Starting placement, agreed 19/11/2026; the owner changes it from the console afterwards
update public.plans set
  features = '{"maker_checker": false, "leads_crm": false, "bulk_actions": false, "email_attachments": false, "insights": false,
               "morning_digest": false, "client_portal": false, "kpi_scorecards": false, "kpi_custom_weights": false, "inbox": false,
               "attendance": false, "attendance_reports": false, "escalation_levels": false, "must_acknowledge": false,
               "branches": false, "custom_roles": false}'::jsonb,
  max_storage_mb = coalesce(max_storage_mb, 2048), audit_days = coalesce(audit_days, 90), max_portal_clients = coalesce(max_portal_clients, 0)
 where id = 'starter' and features = '{}'::jsonb;
update public.plans set
  features = '{"maker_checker": true, "leads_crm": true, "bulk_actions": true, "email_attachments": true, "insights": true,
               "morning_digest": true, "client_portal": true, "kpi_scorecards": true, "kpi_custom_weights": false, "inbox": true,
               "attendance": true, "attendance_reports": false, "escalation_levels": true, "must_acknowledge": false,
               "branches": false, "custom_roles": false}'::jsonb,
  max_storage_mb = coalesce(max_storage_mb, 20480), audit_days = coalesce(audit_days, 365), max_portal_clients = coalesce(max_portal_clients, 50)
 where id = 'professional' and features = '{}'::jsonb;
update public.plans set
  features = '{"maker_checker": true, "leads_crm": true, "bulk_actions": true, "email_attachments": true, "insights": true,
               "morning_digest": true, "client_portal": true, "kpi_scorecards": true, "kpi_custom_weights": true, "inbox": true,
               "attendance": true, "attendance_reports": true, "escalation_levels": true, "must_acknowledge": true,
               "branches": true, "custom_roles": true}'::jsonb,
  max_storage_mb = coalesce(max_storage_mb, 102400)
 where id = 'firm' and features = '{}'::jsonb;

-- ---------------------------------------------------------------- 3. Per-firm extras
create table if not exists public.org_feature_overrides (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  feature    text not null check (feature ~ '^[a-z_]{2,40}$'),
  enabled    boolean not null,
  expires_at timestamptz,
  note       text check (note is null or length(note) <= 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (org_id, feature)
);
alter table public.org_feature_overrides enable row level security;
revoke all on public.org_feature_overrides from anon, authenticated;
grant select on public.org_feature_overrides to authenticated;
grant all on public.org_feature_overrides to service_role;
drop policy if exists org_isolation on public.org_feature_overrides;
create policy org_isolation on public.org_feature_overrides as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()));
drop policy if exists org_feature_overrides_read on public.org_feature_overrides;
create policy org_feature_overrides_read on public.org_feature_overrides for select to authenticated using ((select public.is_active_user()));

-- Firms already using Duesk keep every feature they had before plans had switches, as extras the
-- owner can see and remove on the owner dashboard. Features new in this batch are not given.
-- Done once: the table's comment records that it has happened, so a re-run never gives them back.
do $$
begin
  if obj_description('public.org_feature_overrides'::regclass, 'pg_class') is distinct from 'Per-firm feature extras' then
    insert into public.org_feature_overrides (org_id, feature, enabled, note)
    select o.id, f.k, true, 'Kept from before plans had feature switches'
      from public.organizations o
      cross join unnest(array['maker_checker', 'leads_crm', 'bulk_actions', 'email_attachments', 'insights', 'morning_digest',
                              'client_portal', 'kpi_scorecards', 'kpi_custom_weights', 'inbox']) f(k)
      left join public.plans p on p.id = o.plan
     where o.slug <> 'oddlambda'
       and coalesce((p.features ->> f.k)::boolean, false) = false
    on conflict (org_id, feature) do nothing;
    comment on table public.org_feature_overrides is 'Per-firm feature extras';
  end if;
end $$;

-- ---------------------------------------------------------------- 4. What a firm may use
create or replace function public.org_has_feature(p_org uuid, p_feature text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when (select slug from public.organizations where id = p_org) = 'oddlambda' then true
    else coalesce(
      (select o.enabled from public.org_feature_overrides o
        where o.org_id = p_org and o.feature = p_feature and (o.expires_at is null or o.expires_at > now())),
      (select (p.features ->> p_feature)::boolean from public.organizations g join public.plans p on p.id = g.plan where g.id = p_org),
      false)
  end;
$$;
revoke execute on function public.org_has_feature(uuid, text) from public, anon, authenticated;
grant execute on function public.org_has_feature(uuid, text) to service_role;

create or replace function public.has_feature(p_feature text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.org_has_feature(public.current_org_id(), p_feature);
$$;
revoke execute on function public.has_feature(text) from public, anon;
grant execute on function public.has_feature(text) to authenticated, service_role;

create or replace function public.my_features()
returns jsonb
language sql stable security definer set search_path = public
as $$
  with o as (select g.id, g.slug, g.plan, g.status, p.name as plan_name, p.features, p.max_users, p.max_clients,
                    p.max_storage_mb, p.audit_days, p.max_portal_clients
               from public.organizations g join public.plans p on p.id = g.plan
              where g.id = public.current_org_id())
  select jsonb_build_object(
    'plan', o.plan, 'plan_name', o.plan_name, 'status', o.status,
    'features', case when o.slug = 'oddlambda'
                  then (select jsonb_object_agg(k, true) from jsonb_object_keys(o.features) k)
                  else o.features || coalesce((select jsonb_object_agg(x.feature, x.enabled) from public.org_feature_overrides x
                                                where x.org_id = o.id and (x.expires_at is null or x.expires_at > now())), '{}'::jsonb)
                end,
    'limits', jsonb_build_object('users', o.max_users, 'clients', o.max_clients, 'storage_mb', o.max_storage_mb,
                                 'audit_days', o.audit_days, 'portal_clients', o.max_portal_clients),
    'storage_used_mb', (select round(coalesce(sum(size_bytes), 0) / 1048576.0, 1) from public.documents where org_id = o.id)
  ) from o;
$$;
revoke execute on function public.my_features() from public, anon;
grant execute on function public.my_features() to authenticated;

create or replace function public.require_feature(p_feature text, p_label text)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  -- Server jobs (no signed-in user) are never blocked
  if auth.uid() is not null and not public.has_feature(p_feature) then
    raise exception '% is not part of your plan. An administrator can ask for it from the Plan page.', p_label
      using errcode = 'P0001', hint = 'feature:' || p_feature;
  end if;
end $$;
revoke execute on function public.require_feature(text, text) from public, anon;
grant execute on function public.require_feature(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- 5. Upgrade requests
create table if not exists public.upgrade_requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null default public.default_org_id() references public.organizations(id) on delete cascade,
  requested_by uuid default auth.uid() references public.profiles(id) on delete set null,
  feature      text check (feature is null or feature ~ '^[a-z_]{2,40}$'),
  plan_wanted  text references public.plans(id),
  message      text check (message is null or length(message) <= 500),
  status       text not null default 'open' check (status in ('open', 'done', 'declined')),
  created_at   timestamptz not null default now(),
  handled_at   timestamptz,
  handled_by   uuid
);
create index if not exists upgrade_requests_open_idx on public.upgrade_requests (status, created_at desc);
alter table public.upgrade_requests enable row level security;
revoke all on public.upgrade_requests from anon;
grant select, insert on public.upgrade_requests to authenticated;
grant all on public.upgrade_requests to service_role;
drop policy if exists org_isolation on public.upgrade_requests;
create policy org_isolation on public.upgrade_requests as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));
drop policy if exists upgrade_requests_admin on public.upgrade_requests;
create policy upgrade_requests_admin on public.upgrade_requests for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()) and status = 'open');

-- Each new request lands in the Duesk owner's notifications
create or replace function public.upgrade_requests_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_home uuid;
  v_firm text;
begin
  select id into v_home from public.organizations where slug = 'oddlambda';
  select name into v_firm from public.organizations where id = new.org_id;
  if v_home is not null then
    insert into public.notifications (org_id, user_id, type, title, body, link, entity, entity_id, priority)
    select v_home, m.user_id, 'upgrade_request', v_firm || ' asked for ' || coalesce(replace(new.feature, '_', ' '), new.plan_wanted, 'an upgrade'),
           left(coalesce(new.message, ''), 300), '/owner', 'upgrade_requests', new.id, 'high'
      from public.memberships m
     where m.org_id = v_home and m.is_active and m.role = 'admin';
  end if;
  return null;
end $$;
drop trigger if exists upgrade_requests_notify on public.upgrade_requests;
create trigger upgrade_requests_notify after insert on public.upgrade_requests
  for each row execute function public.upgrade_requests_notify();
revoke execute on function public.upgrade_requests_notify() from public, anon, authenticated;

-- ---------------------------------------------------------------- 6. Enforced in the database
create or replace function public.documents_storage_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_limit int;
  v_used bigint;
begin
  select p.max_storage_mb into v_limit from public.organizations o join public.plans p on p.id = o.plan where o.id = new.org_id;
  if v_limit is null or coalesce(new.size_bytes, 0) = 0 then
    return new;
  end if;
  select coalesce(sum(size_bytes), 0) into v_used from public.documents where org_id = new.org_id;
  if v_used + new.size_bytes > v_limit::bigint * 1048576 then
    raise exception 'Document storage is full (% MB on your plan). Delete old files or ask for a bigger plan.', v_limit
      using hint = 'feature:storage';
  end if;
  return new;
end $$;
drop trigger if exists documents_storage_limit on public.documents;
create trigger documents_storage_limit before insert on public.documents
  for each row execute function public.documents_storage_limit();
revoke execute on function public.documents_storage_limit() from public, anon, authenticated;

create or replace function public.tasks_plan_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.reviewer_id is not null and (tg_op = 'INSERT' or new.reviewer_id is distinct from old.reviewer_id) then
    perform public.require_feature('maker_checker', 'Review by a second person');
  end if;
  return new;
end $$;
drop trigger if exists tasks_plan_guard on public.tasks;
create trigger tasks_plan_guard before insert or update of reviewer_id on public.tasks
  for each row when (coalesce(current_setting('app.bulk_move', true), 'off') <> 'on')
  execute function public.tasks_plan_guard();
revoke execute on function public.tasks_plan_guard() from public, anon, authenticated;

create or replace function public.feature_insert_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_feature(tg_argv[0], tg_argv[1]);
  return new;
end $$;
revoke execute on function public.feature_insert_guard() from public, anon, authenticated;
drop trigger if exists leads_plan_guard on public.leads;
create trigger leads_plan_guard before insert on public.leads
  for each row execute function public.feature_insert_guard('leads_crm', 'Enquiries');
drop trigger if exists service_packages_plan_guard on public.service_packages;
create trigger service_packages_plan_guard before insert on public.service_packages
  for each row execute function public.feature_insert_guard('leads_crm', 'Retainer packages');
drop trigger if exists member_rates_plan_guard on public.member_rates;
create trigger member_rates_plan_guard before insert or update on public.member_rates
  for each row execute function public.feature_insert_guard('insights', 'Practice insights');
drop trigger if exists kpi_settings_plan_guard on public.kpi_settings;
create trigger kpi_settings_plan_guard before update on public.kpi_settings
  for each row execute function public.feature_insert_guard('kpi_custom_weights', 'Custom KPI weights');

commit;

-- Verification (one statement):
--
-- select
--   (select count(*) from information_schema.columns where (table_name, column_name) in
--     (('profiles', 'avatar_url'), ('firm_settings', 'logo_url'), ('plans', 'features'), ('plans', 'max_storage_mb'))) as new_columns,
--   (select count(*) from public.plans where features <> '{}'::jsonb) as plans_with_switches,
--   (select count(*) from information_schema.tables where table_name in ('org_feature_overrides', 'upgrade_requests')) as new_tables,
--   (select has_function_privilege('authenticated', 'public.org_has_feature(uuid, text)', 'execute')) as org_check_open_to_browser;
--
-- Expected: 4, 3, 2, false.