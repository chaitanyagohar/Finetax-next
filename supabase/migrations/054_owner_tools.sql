-- 054_owner_tools.sql
-- Batch 10, tools for the Duesk owner and for firm administrators.
--   1. platform_firm_health(): per firm, how far it has got in setting up and how active it is,
--      for spotting trials that need a call. Counts only, never client data.
--   2. support_access_grants: a firm administrator lets Duesk support look at the firm's setup for a
--      limited time; support_diagnostics() shows setup and error details only while a grant is open.
--   3. platform_updates: "What's new" notes written by the Duesk owner, shown to every user.
--   4. Indexes for the lists that grow fastest (invoices by date, email, documents, open checklist items).
-- Safe to run more than once. No data is dropped or deleted.

begin;

-- ---------------------------------------------------------------- 2. Support access with the firm's consent
create table if not exists public.support_access_grants (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.default_org_id() references public.organizations(id) on delete cascade,
  granted_by  uuid default auth.uid(),
  reason      text check (reason is null or length(reason) <= 300),
  expires_at  timestamptz not null check (expires_at <= now() + interval '7 days 1 minute'),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists support_access_grants_org_idx on public.support_access_grants (org_id, expires_at desc);

alter table public.support_access_grants enable row level security;
revoke all on public.support_access_grants from anon;
grant select, insert, update on public.support_access_grants to authenticated;
grant all on public.support_access_grants to service_role;
drop policy if exists org_isolation on public.support_access_grants;
create policy org_isolation on public.support_access_grants as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));
drop policy if exists support_access_grants_admin on public.support_access_grants;
create policy support_access_grants_admin on public.support_access_grants for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------- 1. Firm health
create or replace function public.platform_firm_health()
returns table (
  org_id uuid, active_users_14d int, active_days_14d int, members int, clients int, tasks int, invoices_issued int,
  mailbox boolean, payments boolean, portal_users int, compliance_types int, setup_steps int, support_until timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'Only the Duesk owner can see this.';
  end if;
  return query
  select o.id,
         (select count(distinct a.user_id)::int from public.user_activity_days a where a.org_id = o.id and a.day >= current_date - 14),
         (select count(distinct a.day)::int from public.user_activity_days a where a.org_id = o.id and a.day >= current_date - 14),
         (select count(*)::int from public.memberships m where m.org_id = o.id and m.is_active),
         (select count(*)::int from public.clients c where c.org_id = o.id and c.merged_into is null),
         (select count(*)::int from public.tasks t where t.org_id = o.id),
         (select count(*)::int from public.invoices i where i.org_id = o.id and i.status not in ('Draft', 'Cancelled')),
         exists (select 1 from public.email_accounts e where e.org_id = o.id and e.verified_at is not null),
         exists (select 1 from public.payment_gateways g where g.org_id = o.id and g.is_active),
         (select count(*)::int from public.client_portal_users p where p.org_id = o.id and p.is_active),
         (select count(*)::int from public.task_types tt where tt.org_id = o.id and tt.applies_to is not null),
         ((select count(*) from public.memberships m where m.org_id = o.id and m.is_active) > 1)::int
           + (exists (select 1 from public.clients c where c.org_id = o.id))::int
           + (exists (select 1 from public.tasks t where t.org_id = o.id))::int
           + (exists (select 1 from public.invoices i where i.org_id = o.id and i.status not in ('Draft', 'Cancelled')))::int
           + (exists (select 1 from public.email_accounts e where e.org_id = o.id and e.verified_at is not null))::int,
         (select max(g.expires_at) from public.support_access_grants g where g.org_id = o.id and g.revoked_at is null and g.expires_at > now())
    from public.organizations o;
end $$;

-- Setup and error details for a firm that has an open grant. No client records, no secrets.
create or replace function public.support_diagnostics(p_org uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_until timestamptz;
begin
  if not public.is_platform_owner() then
    raise exception 'Only the Duesk owner can see this.';
  end if;
  select max(expires_at) into v_until from public.support_access_grants
   where org_id = p_org and revoked_at is null and expires_at > now();
  if v_until is null then
    raise exception 'This firm has not given support access, or it has ended.';
  end if;

  return jsonb_build_object(
    'access_until', v_until,
    'organization', (select jsonb_build_object('name', name, 'slug', slug, 'status', status, 'plan', plan, 'trial_ends_at', trial_ends_at,
                       'setup_completed_at', setup_completed_at) from public.organizations where id = p_org),
    'settings', (select jsonb_build_object('firm_name', firm_name, 'gstin_set', gstin is not null and gstin <> '', 'invoice_prefix', invoice_prefix,
                   'quotation_prefix', quotation_prefix, 'default_gst_rate', default_gst_rate, 'upi_set', upi_id is not null and upi_id <> '',
                   'remind_all_invoices', remind_all_invoices, 'morning_digest', morning_digest)
                 from public.firm_settings where org_id = p_org),
    'mailboxes', (select coalesce(jsonb_agg(jsonb_build_object('address', email_address, 'verified', verified_at is not null,
                    'last_synced_at', last_synced_at, 'last_sync_error', last_sync_error, 'active', is_active)), '[]'::jsonb)
                  from public.email_accounts where org_id = p_org),
    'payments', (select jsonb_build_object('mode', mode, 'active', is_active, 'webhook', webhook_secret_id is not null,
                   'last_event_at', last_event_at, 'last_error', last_error) from public.payment_gateways where org_id = p_org),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('role', m.role, 'active', m.is_active, 'modules', m.module_access,
                  'joined_at', m.joined_at) order by m.joined_at), '[]'::jsonb) from public.memberships m where m.org_id = p_org),
    'counts', jsonb_build_object(
      'clients', (select count(*) from public.clients where org_id = p_org),
      'tasks_open', (select count(*) from public.tasks where org_id = p_org and stage <> 'Approved'),
      'task_types', (select count(*) from public.task_types where org_id = p_org),
      'invoices', (select count(*) from public.invoices where org_id = p_org),
      'documents', (select count(*) from public.documents where org_id = p_org),
      'portal_users', (select count(*) from public.client_portal_users where org_id = p_org and is_active)),
    'recent_actions', (select coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'entity', a.entity, 'at', a.created_at) order by a.created_at desc), '[]'::jsonb)
                       from (select action, entity, created_at from public.audit_logs where org_id = p_org order by created_at desc limit 40) a)
  );
end $$;

-- ---------------------------------------------------------------- 3. What's new
create table if not exists public.platform_updates (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(trim(title)) between 1 and 120),
  body         text not null check (length(body) <= 2000),
  link         text check (link is null or link ~ '^(/|https://)'),
  published_at timestamptz not null default now(),
  created_by   uuid default auth.uid()
);
create index if not exists platform_updates_published_idx on public.platform_updates (published_at desc);
alter table public.platform_updates enable row level security;
revoke all on public.platform_updates from anon;
grant select, insert, update, delete on public.platform_updates to authenticated;
grant all on public.platform_updates to service_role;
drop policy if exists platform_updates_read on public.platform_updates;
create policy platform_updates_read on public.platform_updates for select to authenticated using (published_at <= now());
drop policy if exists platform_updates_owner on public.platform_updates;
create policy platform_updates_owner on public.platform_updates for all to authenticated
  using ((select public.is_platform_owner()))
  with check ((select public.is_platform_owner()));

-- ---------------------------------------------------------------- 4. Indexes for long lists
create index if not exists invoices_org_date_idx on public.invoices (org_id, date desc);
create index if not exists invoices_client_date_idx on public.invoices (client_id, date desc);
create index if not exists email_messages_org_received_idx on public.email_messages (org_id, received_at desc);
create index if not exists documents_org_created_idx on public.documents (org_id, created_at desc);
create index if not exists task_checklist_items_open_idx on public.task_checklist_items (org_id, task_id) where status = 'pending';

revoke execute on function public.platform_firm_health() from public, anon;
revoke execute on function public.support_diagnostics(uuid) from public, anon;
grant execute on function public.platform_firm_health() to authenticated, service_role;
grant execute on function public.support_diagnostics(uuid) to authenticated, service_role;

commit;

-- Verification (one statement):
--
-- select
--   (select count(*) from information_schema.tables where table_name in ('support_access_grants', 'platform_updates')) as new_tables,
--   (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('platform_firm_health', 'support_diagnostics')) as new_functions,
--   (select count(*) from pg_indexes where indexname in ('invoices_org_date_idx', 'invoices_client_date_idx', 'email_messages_org_received_idx',
--      'documents_org_created_idx', 'task_checklist_items_open_idx')) as new_indexes;
--
-- Expected: 2, 2, 5.
