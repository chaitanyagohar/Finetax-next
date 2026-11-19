-- Undo for 060_security_and_email.sql
-- Puts back the batch 11 firm, admin and owner checks (no two-step check in the database), removes the
-- database activity log triggers, the email log and the support-access notice. Activity entries and email
-- log rows already written are kept in audit_logs; the email log table is dropped.
-- Signed-out visitors stay without table and function rights: re-opening them would only weaken security.

begin;

create or replace function public.current_org_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select coalesce(
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
  )
$$;

create or replace function public.is_platform_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid() and role = 'owner')
$$;

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
$$;

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
      'invoice',  exists (select 1 from public.invoices i, ctx where i.org_id = ctx.org and i.invoice_number is not null)
    )
  )
$$;

drop trigger if exists zz_audit_invoices on public.invoices;
drop trigger if exists zz_audit_payments on public.invoice_payments;
drop trigger if exists zz_audit_memberships on public.memberships;
drop trigger if exists zz_audit_clients on public.clients;
drop trigger if exists zz_audit_firm_settings on public.firm_settings;
drop trigger if exists zz_audit_payment_gateways on public.payment_gateways;
drop trigger if exists zz_audit_email_accounts on public.email_accounts;
drop trigger if exists zz_audit_branches on public.branches;
drop trigger if exists zz_audit_roles on public.roles;
drop trigger if exists zz_audit_support_access on public.support_access_grants;
drop function if exists public.audit_row_change();

drop trigger if exists support_access_notify on public.support_access_grants;
drop function if exists public.support_access_notify();
drop function if exists public.platform_email_health();
drop table if exists public.email_log;
drop function if exists public.my_security();
drop function if exists public.mfa_ok();
alter table public.firm_settings drop column if exists require_mfa_admins;

commit;
