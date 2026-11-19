-- Undo for 059_support_view_fix.sql: puts back the batch 10 version (which fails on the activity log).

begin;

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

commit;
