-- 056_branches_and_roles.sql
-- Batch 11, branches and custom roles.
--   1. branches: each office, with its address, office internet addresses (for attendance), working hours,
--      and optionally its own GSTIN and its own invoice numbering. Every firm gets a "Head office".
--   2. People, clients, invoices and enquiries belong to a branch (filled in for existing records).
--   3. Invoices: a branch with its own GSTIN bills under it; with its own numbering it has its own series.
--   4. roles: the firm's own roles, each with sections, permissions and how far it sees (own work,
--      its branch, or the whole firm). People with a role follow it when it changes.
--   5. Visibility is enforced by the database with restrictive policies on clients, tasks, invoices,
--      payments, quotations, enquiries, documents, time and discussions. Administrators always see the firm.
-- Safe to run more than once. No data is dropped or deleted.

begin;

-- ---------------------------------------------------------------- 1. Branches
create table if not exists public.branches (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null default public.default_org_id() references public.organizations(id) on delete cascade,
  name               text not null check (length(trim(name)) between 1 and 80),
  code               text check (code is null or code ~ '^[A-Z0-9-]{1,10}$'),
  address            text check (address is null or length(address) <= 500),
  state              text,
  gstin              text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  phone              text,
  email              text,
  office_ips         text[] not null default '{}',
  work_start         time,
  work_end           time,
  separate_numbering boolean not null default false,
  invoice_prefix     text check (invoice_prefix is null or length(invoice_prefix) <= 30),
  is_default         boolean not null default false,
  created_at         timestamptz not null default now()
);
create unique index if not exists branches_name_unique on public.branches (org_id, lower(name));
create unique index if not exists branches_one_default on public.branches (org_id) where is_default;

create or replace function public.branches_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  ip text;
begin
  new.name := trim(new.name);
  new.gstin := nullif(upper(trim(new.gstin)), '');
  new.invoice_prefix := nullif(trim(new.invoice_prefix), '');
  -- Each office address must be a valid IP address or range (e.g. 203.0.113.7 or 203.0.113.0/24)
  foreach ip in array coalesce(new.office_ips, '{}') loop
    begin
      perform ip::cidr;
    exception when others then
      raise exception '"%" is not a valid internet address.', ip;
    end;
  end loop;
  if new.separate_numbering and new.invoice_prefix is null then
    raise exception 'A branch with its own numbering needs its own invoice prefix, e.g. PV/{FY}/.';
  end if;
  if tg_op = 'INSERT' and not new.is_default then
    perform public.require_feature('branches', 'Branches');
  end if;
  if tg_op = 'UPDATE' then
    new.org_id := old.org_id;
  end if;
  return new;
end $$;
drop trigger if exists branches_before_write on public.branches;
create trigger branches_before_write before insert or update on public.branches
  for each row execute function public.branches_before_write();
revoke execute on function public.branches_before_write() from public, anon, authenticated;

alter table public.branches enable row level security;
revoke all on public.branches from anon;
grant select, insert, update, delete on public.branches to authenticated;
grant all on public.branches to service_role;
drop policy if exists org_isolation on public.branches;
create policy org_isolation on public.branches as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));
drop policy if exists branches_read on public.branches;
create policy branches_read on public.branches for select to authenticated using ((select public.is_active_user()));
drop policy if exists branches_admin on public.branches;
create policy branches_admin on public.branches for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create or replace function public.branches_keep_default()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if old.is_default and auth.uid() is not null then
    raise exception 'The head office can be renamed but not deleted.';
  end if;
  return old;
end $$;
drop trigger if exists branches_keep_default on public.branches;
create trigger branches_keep_default before delete on public.branches
  for each row execute function public.branches_keep_default();
revoke execute on function public.branches_keep_default() from public, anon, authenticated;

insert into public.branches (org_id, name, address, is_default)
select o.id, 'Head office', fs.address, true
  from public.organizations o
  left join public.firm_settings fs on fs.org_id = o.id
 where not exists (select 1 from public.branches b where b.org_id = o.id and b.is_default);

-- A record can only point at a branch of its own firm
create or replace function public.branch_belongs_to_firm()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.branch_id is not null and not exists (select 1 from public.branches b where b.id = new.branch_id and b.org_id = new.org_id) then
    raise exception 'Choose one of your own branches.';
  end if;
  return new;
end $$;
revoke execute on function public.branch_belongs_to_firm() from public, anon, authenticated;

-- New firms start with a head office too
create or replace function public.organizations_head_office()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.branches (org_id, name, is_default) values (new.id, 'Head office', true)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists organizations_head_office on public.organizations;
create trigger organizations_head_office after insert on public.organizations
  for each row execute function public.organizations_head_office();
revoke execute on function public.organizations_head_office() from public, anon, authenticated;

create or replace function public.default_branch(p_org uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.branches where org_id = p_org and is_default limit 1;
$$;
revoke execute on function public.default_branch(uuid) from public, anon;
grant execute on function public.default_branch(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- 2. Who and what belongs where
alter table public.memberships add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table public.clients add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table public.invoices add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table public.leads add column if not exists branch_id uuid references public.branches(id) on delete set null;
create index if not exists clients_branch_idx on public.clients (org_id, branch_id);
create index if not exists memberships_branch_idx on public.memberships (org_id, branch_id);

do $$
begin
  perform set_config('app.bulk_move', 'on', true);
  update public.memberships m set branch_id = public.default_branch(m.org_id) where m.branch_id is null;
  update public.clients c set branch_id = public.default_branch(c.org_id) where c.branch_id is null;
  update public.invoices i set branch_id = c.branch_id from public.clients c where c.id = i.client_id and i.branch_id is null;
  update public.leads l set branch_id = public.default_branch(l.org_id) where l.branch_id is null;
  perform set_config('app.bulk_move', 'off', true);
end $$;

-- ---------------------------------------------------------------- 3. Invoices: branch GSTIN and numbering
create or replace function public.invoices_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e jsonb;
  v_qty numeric;
  v_rate numeric;
  v_gst numeric;
  v_line_gst numeric;
  v_groups jsonb := '{}'::jsonb;
  g record;
  v_taxable numeric;
  v_recalc boolean := false;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_date date;
  v_last date;
  v_template text;
  v_prefix text;
  v_firm_gstin text;
  v_firm_state text;
  br record;
  v_default_pos text;
  v_client public.clients%rowtype;
  v_org uuid;
  v_was_draft boolean := true;
  v_issuing boolean;
  v_sync boolean := coalesce(current_setting('app.payment_sync', true), 'off') = 'on';
  v_browser boolean := auth.uid() is not null;
begin
  if tg_op = 'UPDATE' then
    v_was_draft := old.status is not distinct from 'Draft';

    new.invoice_number := old.invoice_number;
    new.quotation_id := old.quotation_id;
    new.created_at := old.created_at;
    new.org_id := old.org_id;

    if not v_sync then
      new.amount_paid := old.amount_paid;
    end if;

    if old.status = 'Cancelled' and (
         new.status is distinct from old.status
      or new.items is distinct from old.items
      or new.client_id is distinct from old.client_id
      or new.gst_rate is distinct from old.gst_rate
    ) then
      raise exception 'Cancelled invoices cannot be changed.';
    end if;

    if not v_was_draft then
      if new.items is distinct from old.items
         or new.gst_rate is distinct from old.gst_rate
         or new.is_inter_state is distinct from old.is_inter_state
         or new.place_of_supply is distinct from old.place_of_supply
         or new.client_id is distinct from old.client_id
         or new.organisation is distinct from old.organisation
         or new.date is distinct from old.date
         or new.issue_date is distinct from old.issue_date then
        raise exception 'Issued invoices cannot be edited. Cancel it and create a new invoice instead.';
      end if;
      new.buyer_name := old.buyer_name;
      new.buyer_contact := old.buyer_contact;
      new.buyer_address := old.buyer_address;
      new.buyer_gstin := old.buyer_gstin;
      new.buyer_pan := old.buyer_pan;
      new.buyer_state_code := old.buyer_state_code;
      new.issued_at := old.issued_at;
    end if;

    if new.status = 'Draft' and not v_was_draft then
      raise exception 'An issued invoice cannot be moved back to Draft.';
    end if;

    if new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then
      if v_browser and not public.is_admin() then
        raise exception 'Only administrators can cancel invoices.';
      end if;
      if coalesce(old.amount_paid, 0) > 0 then
        raise exception 'This invoice has recorded payments. Delete them before cancelling.';
      end if;
    end if;

    if not v_sync and new.status in ('Paid', 'Partially Paid') and new.status is distinct from old.status then
      raise exception 'Record a payment to mark this invoice as paid.';
    end if;
  else
    new.invoice_number := null;
    new.amount_paid := 0;
    new.created_at := now();
    if coalesce(new.status, '') not in ('Draft', 'Sent') then
      new.status := 'Draft';
    end if;
    v_date := coalesce(new.date, new.issue_date, v_today);
    new.date := coalesce(new.date, v_date);
    new.issue_date := coalesce(new.issue_date, v_date);
  end if;

  v_issuing := v_was_draft and new.status not in ('Draft', 'Cancelled');

  -- Place of supply decides the tax split for as long as the invoice is a draft
  if v_was_draft and new.status is distinct from 'Cancelled' then
    -- A server insert may arrive without org_id; zz_inherit_org then takes it from the client
    select * into v_client from public.clients
     where id = new.client_id and (new.org_id is null or org_id = new.org_id);
    v_org := coalesce(new.org_id, v_client.org_id);
    v_default_pos := public.gst_place_of_supply(v_client.gstin, v_client.state);

    new.place_of_supply := nullif(trim(new.place_of_supply), '');
    if new.place_of_supply is not null and public.gst_state_code(new.place_of_supply) is distinct from new.place_of_supply then
      raise exception 'Choose a valid state for the place of supply.';
    end if;

    if new.place_of_supply is null
       or (tg_op = 'UPDATE' and new.client_id is distinct from old.client_id
           and new.place_of_supply is not distinct from old.place_of_supply) then
      new.place_of_supply := v_default_pos;
    elsif new.place_of_supply is distinct from v_default_pos
          and (tg_op = 'INSERT' or new.place_of_supply is distinct from old.place_of_supply)
          and v_browser and not public.is_admin() then
      raise exception 'Only administrators can change the place of supply.';
    end if;

    select nullif(trim(gstin), ''), nullif(trim(invoice_prefix), '')
      into v_firm_gstin, v_template
      from public.firm_settings where org_id = v_org;

    -- A new invoice belongs to its client's branch; once issued, the branch can't change
    if tg_op = 'INSERT' and new.branch_id is null then
      select c.branch_id into new.branch_id from public.clients c where c.id = new.client_id;
    elsif tg_op = 'UPDATE' and old.status is distinct from 'Draft' then
      new.branch_id := old.branch_id;
    end if;
    -- A branch registered separately bills under its own GSTIN; with its own numbering it has its own series
    if new.branch_id is not null then
      select b.gstin, b.invoice_prefix, b.separate_numbering into br
        from public.branches b where b.id = new.branch_id and b.org_id = v_org;
      if found then
        v_firm_gstin := coalesce(nullif(trim(br.gstin), ''), v_firm_gstin);
        if br.separate_numbering and nullif(trim(br.invoice_prefix), '') is not null then
          v_template := trim(br.invoice_prefix);
        end if;
      end if;
    end if;
    v_firm_state := public.gst_place_of_supply(v_firm_gstin, null);

    new.is_inter_state := v_firm_state is not null
                      and new.place_of_supply is not null
                      and new.place_of_supply <> v_firm_state;

    new.buyer_name := null;
    new.buyer_contact := null;
    new.buyer_address := null;
    new.buyer_gstin := null;
    new.buyer_pan := null;
    new.buyer_state_code := null;
    new.issued_at := null;
  end if;

  if tg_op = 'INSERT' then
    v_recalc := true;
  else
    v_recalc := new.items is distinct from old.items
             or new.gst_rate is distinct from old.gst_rate
             or new.is_inter_state is distinct from old.is_inter_state;
  end if;

  if v_recalc then
    if new.items is null or jsonb_typeof(new.items) <> 'array' or jsonb_array_length(new.items) = 0 then
      raise exception 'At least one line item is required.';
    end if;
    if jsonb_array_length(new.items) > 100 then
      raise exception 'An invoice can have at most 100 line items.';
    end if;

    for e in select value from jsonb_array_elements(new.items) loop
      if trim(coalesce(e->>'description', e->>'desc', '')) = '' then
        raise exception 'Every line item needs a description.';
      end if;
      begin
        v_qty := coalesce(nullif(e->>'qty', '')::numeric, 1);
        v_rate := coalesce(nullif(coalesce(e->>'rate', e->>'price'), '')::numeric, 0);
      exception when others then
        raise exception 'Line item quantities and rates must be numbers.';
      end;
      if v_qty <= 0 or v_rate < 0 then
        raise exception 'Line items need a quantity above zero and a rate of zero or more.';
      end if;
      -- A line may carry its own GST rate; otherwise the invoice's rate applies
      begin
        v_line_gst := trim_scale(coalesce(nullif(e->>'gst_rate', '')::numeric, new.gst_rate, 0));
      exception when others then
        raise exception 'Line item GST rates must be numbers.';
      end;
      if v_line_gst < 0 or v_line_gst > 100 then
        raise exception 'GST rate must be between 0 and 100.';
      end if;
      v_groups := jsonb_set(v_groups, array[v_line_gst::text],
        to_jsonb(coalesce((v_groups ->> v_line_gst::text)::numeric, 0) + v_qty * v_rate));
    end loop;

    v_gst := coalesce(new.gst_rate, 0);
    if v_gst < 0 or v_gst > 100 then
      raise exception 'GST rate must be between 0 and 100.';
    end if;

    -- Each rate is rounded once on its own total, so a single rate gives the same figures as before
    new.subtotal := 0;
    new.cgst := 0;
    new.igst := 0;
    for g in select key::numeric as rate, value::numeric as amount from jsonb_each_text(v_groups) loop
      v_taxable := round(g.amount, 2);
      new.subtotal := new.subtotal + v_taxable;
      if coalesce(new.is_inter_state, false) then
        new.igst := new.igst + round(v_taxable * g.rate / 100, 2);
      else
        new.cgst := new.cgst + round(v_taxable * g.rate / 200, 2);
      end if;
    end loop;
    new.sgst := new.cgst;
    new.tax := new.cgst + new.sgst + new.igst;
    new.total := new.subtotal + new.tax;
  end if;

  if v_sync and coalesce(new.status, '') <> 'Cancelled' then
    if new.status = 'Draft' and coalesce(new.amount_paid, 0) > 0 then
      raise exception 'Issue the invoice before recording a payment.';
    end if;
    if coalesce(new.total, 0) > 0 and coalesce(new.amount_paid, 0) >= new.total - 0.01 then
      new.status := 'Paid';
    elsif coalesce(new.amount_paid, 0) > 0 then
      new.status := 'Partially Paid';
    elsif new.status in ('Paid', 'Partially Paid') then
      new.status := 'Sent';
    end if;
  end if;

  if v_issuing then
    if v_client.id is null then
      raise exception 'Choose a client before issuing this invoice.';
    end if;
    if new.place_of_supply is null then
      raise exception 'Add the client''s state on the Clients page before issuing this invoice.';
    end if;
    if v_firm_state is null and (
         coalesce(new.gst_rate, 0) > 0
      or exists (select 1 from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) x
                  where coalesce(nullif(x ->> 'gst_rate', '')::numeric, 0) > 0)) then
      raise exception 'Add your firm''s GSTIN in Settings before issuing an invoice that charges GST.';
    end if;

    -- One issue at a time per firm, so numbers and dates always rise together
    perform pg_advisory_xact_lock(hashtextextended('invoice-series:' || v_org::text, 0));

    -- The draft's date stands unless it is in the future or in an earlier financial year
    v_date := least(coalesce(new.date, v_today), v_today);
    if v_date < make_date(extract(year from v_today)::int - (extract(month from v_today) < 4)::int, 4, 1) then
      v_date := v_today;
    end if;

    -- A draft numbered before migration 041 keeps that number
    if new.invoice_number is null then
      v_template := coalesce(v_template, 'INV/{FY}/');
      v_prefix := public.resolve_doc_prefix(v_template, v_date);

      select max(date) into v_last
        from public.invoices
       where org_id = v_org and id <> new.id
         and status is distinct from 'Draft'
         and left(invoice_number, length(v_prefix)) = v_prefix;

      -- A date earlier than the last issued invoice would break the order of the series
      if v_last is not null and v_date < v_last and v_date < v_today then
        v_date := v_today;
        v_prefix := public.resolve_doc_prefix(v_template, v_date);
        select max(date) into v_last
          from public.invoices
         where org_id = v_org and id <> new.id
           and status is distinct from 'Draft'
           and left(invoice_number, length(v_prefix)) = v_prefix;
      end if;
      if v_last is not null and v_date < v_last then
        raise exception 'An invoice dated % is already issued in this series, so a new invoice cannot be dated before it.',
          to_char(v_last, 'DD/MM/YYYY');
      end if;

      new.invoice_number := public.allocate_document_number(v_org, 'invoices', 'invoice_number', v_prefix, 4);
    end if;

    -- When the date moves forward, a due date it has overtaken moves with it
    if v_date > new.date and new.due_date < v_date then
      new.due_date := v_date;
    end if;

    new.date := v_date;
    new.issue_date := v_date;
    new.issued_at := now();

    new.buyer_name := coalesce(nullif(trim(new.organisation), ''), nullif(trim(v_client.organization_name), ''), v_client.name);
    new.buyer_contact := case when v_client.name is distinct from new.buyer_name then v_client.name end;
    new.buyer_address := nullif(trim(v_client.address), '');
    new.buyer_gstin := upper(nullif(trim(v_client.gstin), ''));
    new.buyer_pan := upper(nullif(trim(v_client.pan), ''));
    new.buyer_state_code := public.gst_place_of_supply(v_client.gstin, v_client.state);
  end if;

  if new.due_date is not null and new.due_date < coalesce(new.date, new.issue_date) then
    raise exception 'The due date cannot be before the invoice date.';
  end if;

  new."amountPaid" := new.amount_paid;
  new."isInterState" := new.is_inter_state;
  new."gstRate" := new.gst_rate;
  new."dueDate" := new.due_date;

  return new;
end $function$;

-- ---------------------------------------------------------------- 4. Custom roles
create table if not exists public.roles (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default public.default_org_id() references public.organizations(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 60),
  description   text check (description is null or length(description) <= 300),
  scope         text not null default 'firm' check (scope in ('own', 'branch', 'firm')),
  module_access jsonb not null default '[]'::jsonb check (jsonb_typeof(module_access) = 'array'),
  permissions   text[] not null default '{}'
                check (permissions <@ array['approve_work', 'approve_time', 'view_attendance', 'see_profitability', 'export_data']::text[]),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists roles_name_unique on public.roles (org_id, lower(name));
alter table public.memberships add column if not exists role_id uuid references public.roles(id) on delete set null;

alter table public.roles enable row level security;
revoke all on public.roles from anon;
grant select, insert, update, delete on public.roles to authenticated;
grant all on public.roles to service_role;
drop policy if exists org_isolation on public.roles;
create policy org_isolation on public.roles as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles for select to authenticated using ((select public.is_active_user()));
drop policy if exists roles_admin on public.roles;
create policy roles_admin on public.roles for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create or replace function public.roles_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.require_feature('custom_roles', 'Custom roles');
  else
    new.org_id := old.org_id;
  end if;
  new.name := trim(new.name);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists roles_before_write on public.roles;
create trigger roles_before_write before insert or update on public.roles
  for each row execute function public.roles_before_write();
revoke execute on function public.roles_before_write() from public, anon, authenticated;

-- Everyone with a role takes its sections and reviewer right whenever the role changes
create or replace function public.roles_sync_members()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.memberships m
     set module_access = new.module_access,
         is_reviewer = 'approve_work' = any(new.permissions)
   where m.role_id = new.id and m.role <> 'admin';
  return null;
end $$;
drop trigger if exists roles_sync_members on public.roles;
create trigger roles_sync_members after insert or update on public.roles
  for each row execute function public.roles_sync_members();
revoke execute on function public.roles_sync_members() from public, anon, authenticated;

create or replace function public.memberships_apply_role()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r public.roles%rowtype;
begin
  if new.branch_id is null then
    new.branch_id := public.default_branch(new.org_id);
  end if;
  if new.role_id is not null and (tg_op = 'INSERT' or new.role_id is distinct from old.role_id) then
    select * into r from public.roles where id = new.role_id and org_id = new.org_id;
    if not found then
      raise exception 'That role belongs to another firm.';
    end if;
    if new.role <> 'admin' then
      new.module_access := r.module_access;
      new.is_reviewer := 'approve_work' = any(r.permissions);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists memberships_apply_role on public.memberships;
create trigger memberships_apply_role before insert or update of role_id, branch_id on public.memberships
  for each row execute function public.memberships_apply_role();
revoke execute on function public.memberships_apply_role() from public, anon, authenticated;

-- ---------------------------------------------------------------- 5. How far each person sees
create or replace function public.my_scope()
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when m.role = 'admin' then 'firm'
    else coalesce((select r.scope from public.roles r where r.id = m.role_id), 'firm')
  end
  from public.memberships m
  where m.user_id = auth.uid() and m.org_id = public.current_org_id();
$$;

create or replace function public.my_branch()
returns uuid
language sql stable security definer set search_path = public
as $$
  select branch_id from public.memberships where user_id = auth.uid() and org_id = public.current_org_id();
$$;

create or replace function public.has_permission(p_permission text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select m.role = 'admin'
        or (p_permission = 'approve_work' and m.is_reviewer)
        or exists (select 1 from public.roles r where r.id = m.role_id and p_permission = any(r.permissions))
      from public.memberships m
     where m.user_id = auth.uid() and m.org_id = public.current_org_id() and m.is_active), false);
$$;

create or replace function public.client_in_scope(p_client uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_scope text := public.my_scope();
begin
  if v_scope = 'firm' or p_client is null then
    return true;
  elsif v_scope = 'branch' then
    return exists (select 1 from public.clients c where c.id = p_client and (c.branch_id is null or c.branch_id = public.my_branch()));
  end if;
  return exists (select 1 from public.clients c where c.id = p_client and c.assigned_to = auth.uid())
      or exists (select 1 from public.tasks t where t.client_id = p_client and auth.uid() in (t.assigned_to, t.reviewer_id));
end $$;

create or replace function public.user_in_scope(p_user uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_scope text := public.my_scope();
begin
  if v_scope = 'firm' or p_user = auth.uid() then
    return true;
  elsif v_scope = 'branch' then
    return exists (select 1 from public.memberships m where m.user_id = p_user and m.org_id = public.current_org_id()
                     and m.branch_id is not distinct from public.my_branch());
  end if;
  return false;
end $$;

create or replace function public.invoice_in_scope(p_invoice uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_scope text := public.my_scope();
begin
  if v_scope = 'firm' then
    return true;
  end if;
  return exists (select 1 from public.invoices i where i.id = p_invoice
                   and ((v_scope = 'branch' and (i.branch_id is null or i.branch_id = public.my_branch()))
                     or (v_scope = 'own' and public.client_in_scope(i.client_id))));
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['my_scope()', 'my_branch()', 'has_permission(text)', 'client_in_scope(uuid)', 'user_in_scope(uuid)', 'invoice_in_scope(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- New clients and enquiries start in the creator's branch; someone who only sees their own work owns what they add
create or replace function public.scope_defaults()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.branch_id is null and auth.uid() is not null then
    new.branch_id := coalesce(public.my_branch(), public.default_branch(new.org_id));
  end if;
  if tg_table_name = 'clients' and new.assigned_to is null and auth.uid() is not null and public.my_scope() = 'own' then
    new.assigned_to := auth.uid();
  end if;
  return new;
end $$;
revoke execute on function public.scope_defaults() from public, anon, authenticated;
drop trigger if exists clients_scope_defaults on public.clients;
create trigger clients_scope_defaults before insert on public.clients for each row execute function public.scope_defaults();
drop trigger if exists leads_scope_defaults on public.leads;
create trigger leads_scope_defaults before insert on public.leads for each row execute function public.scope_defaults();

-- The visibility rules themselves. "firm" is checked first, so administrators and firm-wide roles pay nothing.
drop policy if exists scope_visibility on public.clients;
create policy scope_visibility on public.clients as restrictive for all to authenticated
  using ((select public.my_scope()) = 'firm' or public.client_in_scope(id))
  with check ((select public.my_scope()) = 'firm'
              or ((select public.my_scope()) = 'branch' and (branch_id is null or branch_id = (select public.my_branch())))
              or ((select public.my_scope()) = 'own' and assigned_to = auth.uid()));

drop policy if exists scope_visibility on public.tasks;
create policy scope_visibility on public.tasks as restrictive for all to authenticated
  using ((select public.my_scope()) = 'firm' or auth.uid() in (assigned_to, reviewer_id, assigned_by)
         or ((select public.my_scope()) = 'branch' and (public.client_in_scope(client_id) or public.user_in_scope(assigned_to))));

drop policy if exists scope_visibility on public.invoices;
create policy scope_visibility on public.invoices as restrictive for all to authenticated
  using ((select public.my_scope()) = 'firm'
         or ((select public.my_scope()) = 'branch' and (branch_id is null or branch_id = (select public.my_branch())))
         or ((select public.my_scope()) = 'own' and public.client_in_scope(client_id)));

drop policy if exists scope_visibility on public.invoice_payments;
create policy scope_visibility on public.invoice_payments as restrictive for all to authenticated
  using ((select public.my_scope()) = 'firm' or public.invoice_in_scope(invoice_id));

drop policy if exists scope_visibility on public.quotations;
create policy scope_visibility on public.quotations as restrictive for all to authenticated
  using ((select public.my_scope()) = 'firm' or public.client_in_scope(client_id));

drop policy if exists scope_visibility on public.leads;
create policy scope_visibility on public.leads as restrictive for all to authenticated
  using ((select public.my_scope()) = 'firm' or assigned_to = auth.uid()
         or ((select public.my_scope()) = 'branch' and (branch_id is null or branch_id = (select public.my_branch()))));

drop policy if exists scope_visibility on public.documents;
create policy scope_visibility on public.documents as restrictive for all to authenticated
  using ((select public.my_scope()) = 'firm' or uploaded_by = auth.uid() or public.client_in_scope(client_id));

drop policy if exists scope_visibility on public.time_logs;
create policy scope_visibility on public.time_logs as restrictive for all to authenticated
  using ((select public.my_scope()) = 'firm' or public.user_in_scope(user_id));

drop policy if exists scope_visibility on public.discussions;
create policy scope_visibility on public.discussions as restrictive for all to authenticated
  using ((select public.my_scope()) = 'firm' or created_by = auth.uid() or public.client_in_scope(client_id));

drop trigger if exists clients_branch_check on public.clients;
create trigger clients_branch_check before insert or update of branch_id on public.clients
  for each row execute function public.branch_belongs_to_firm();
drop trigger if exists leads_branch_check on public.leads;
create trigger leads_branch_check before insert or update of branch_id on public.leads
  for each row execute function public.branch_belongs_to_firm();
drop trigger if exists memberships_branch_check on public.memberships;
create trigger memberships_branch_check before insert or update of branch_id on public.memberships
  for each row execute function public.branch_belongs_to_firm();
drop trigger if exists invoices_branch_check on public.invoices;
create trigger invoices_branch_check before insert or update of branch_id on public.invoices
  for each row when (coalesce(current_setting('app.bulk_move', true), 'off') <> 'on')
  execute function public.branch_belongs_to_firm();

-- Roles with "see fees and profitability" can read Practice insights; changing rates and billing time stay with admins
CREATE OR REPLACE FUNCTION public.practice_profitability(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_org_id();
  v_clients jsonb;
  v_staff jsonb;
  v_working int;
begin
  if not (public.is_admin() or public.has_permission('see_profitability')) then
    raise exception 'Only administrators can see profitability.';
  end if;

  with inv as (
    select client_id, sum(subtotal) as revenue
      from public.invoices
     where org_id = v_org and status not in ('Draft', 'Cancelled') and date between p_from and p_to
     group by client_id
  ), paid as (
    select i.client_id, sum(p.amount) as collected
      from public.invoice_payments p join public.invoices i on i.id = p.invoice_id
     where p.org_id = v_org and p.paid_on between p_from and p_to
     group by i.client_id
  ), tl as (
    select l.client_id, sum(l.hours) as hours,
           sum(l.hours * coalesce(r.cost_rate, 0)) as cost,
           sum(case when l.is_billable then l.hours * coalesce(r.bill_rate, 0) else 0 end) as billable_value
      from public.time_logs l
      left join public.member_rates r on r.org_id = l.org_id and r.user_id = l.user_id
     where l.org_id = v_org and l.log_date between p_from and p_to and l.client_id is not null
     group by l.client_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'client_id', c.id,
           'client', coalesce(nullif(trim(c.organization_name), ''), c.name),
           'revenue', coalesce(inv.revenue, 0),
           'collected', coalesce(paid.collected, 0),
           'hours', round(coalesce(tl.hours, 0), 2),
           'cost', round(coalesce(tl.cost, 0), 2),
           'billable_value', round(coalesce(tl.billable_value, 0), 2),
           'margin', round(coalesce(inv.revenue, 0) - coalesce(tl.cost, 0), 2)
         ) order by coalesce(inv.revenue, 0) - coalesce(tl.cost, 0) desc), '[]'::jsonb)
    into v_clients
    from public.clients c
    left join inv on inv.client_id = c.id
    left join paid on paid.client_id = c.id
    left join tl on tl.client_id = c.id
   where c.org_id = v_org and (inv.client_id is not null or paid.client_id is not null or tl.client_id is not null);

  select count(*) into v_working from generate_series(p_from, p_to, interval '1 day') d where extract(isodow from d) < 7;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', m.user_id,
           'name', coalesce(p.name, m.invited_name, 'Member'),
           'hours', round(coalesce(s.hours, 0), 2),
           'billable_hours', round(coalesce(s.billable, 0), 2),
           'bill_rate', coalesce(r.bill_rate, 0),
           'cost_rate', coalesce(r.cost_rate, 0),
           'cost', round(coalesce(s.hours, 0) * coalesce(r.cost_rate, 0), 2),
           'billable_value', round(coalesce(s.billable, 0) * coalesce(r.bill_rate, 0), 2),
           'billed_value', round(coalesce(s.billed, 0) * coalesce(r.bill_rate, 0), 2),
           'available_hours', v_working * 8
         ) order by coalesce(s.hours, 0) desc), '[]'::jsonb)
    into v_staff
    from public.memberships m
    left join public.profiles p on p.id = m.user_id
    left join public.member_rates r on r.org_id = m.org_id and r.user_id = m.user_id
    left join (
      select user_id, sum(hours) as hours,
             sum(case when is_billable then hours else 0 end) as billable,
             sum(case when invoice_id is not null then hours else 0 end) as billed
        from public.time_logs
       where org_id = v_org and log_date between p_from and p_to
       group by user_id
    ) s on s.user_id = m.user_id
   where m.org_id = v_org and (m.is_active or s.hours is not null);

  return jsonb_build_object('clients', v_clients, 'staff', v_staff, 'working_days', v_working);
end $function$;

CREATE OR REPLACE FUNCTION public.review_flow(p_from date, p_to date)
 RETURNS TABLE(reviewer_id uuid, reviewer text, waiting_now integer, oldest_waiting_hours numeric, approved integer, avg_review_hours numeric, returned_share numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or public.has_permission('see_profitability')) then
    raise exception 'Only administrators can see review flow.';
  end if;
  return query
  with mine as (
    select t.* from public.tasks t where t.org_id = public.current_org_id() and t.reviewer_id is not null
  )
  select r.reviewer_id, coalesce(p.name, 'Former member'),
         count(*) filter (where r.stage = 'Submitted for Review')::int,
         round(max(extract(epoch from (now() - r.submitted_at)) / 3600) filter (where r.stage = 'Submitted for Review'), 1),
         count(*) filter (where r.stage = 'Approved' and (r.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::int,
         round(avg(extract(epoch from (r.stage_changed_at - r.submitted_at)) / 3600)
               filter (where r.stage = 'Approved' and r.submitted_at is not null
                         and (r.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to), 1),
         round(avg(case when coalesce(r.return_count, 0) > 0 then 1.0 else 0.0 end)
               filter (where r.stage = 'Approved' and (r.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to), 3)
    from mine r
    left join public.profiles p on p.id = r.reviewer_id
   group by r.reviewer_id, p.name
  having count(*) filter (where r.stage = 'Submitted for Review') > 0
      or count(*) filter (where r.stage = 'Approved' and (r.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to) > 0
   order by 3 desc, 4 desc nulls last;
end $function$;

CREATE OR REPLACE FUNCTION public.unbilled_time(p_client uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, client_id uuid, client_label text, user_id uuid, person text, task_id uuid, task_title text, period text, log_date date, description text, hours numeric, bill_rate numeric, value numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or public.has_permission('see_profitability')) then
    raise exception 'Only administrators can see unbilled time.';
  end if;
  return query
  select l.id, l.client_id, coalesce(nullif(trim(c.organization_name), ''), c.name), l.user_id, coalesce(p.name, 'Former member'),
         l.task_id, t.title, t.period, l.log_date, l.description, l.hours, coalesce(r.bill_rate, 0),
         round(l.hours * coalesce(r.bill_rate, 0), 2)
    from public.time_logs l
    join public.clients c on c.id = l.client_id
    left join public.profiles p on p.id = l.user_id
    left join public.tasks t on t.id = l.task_id
    left join public.member_rates r on r.org_id = l.org_id and r.user_id = l.user_id
   where l.org_id = public.current_org_id() and l.is_billable and l.invoice_id is null
     and l.log_date >= (now() at time zone 'Asia/Kolkata')::date - 365
     and (p_client is null or l.client_id = p_client)
   order by 3, l.log_date;
end $function$;

create or replace function public.my_permissions()
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(p.k), '{}')
    from unnest(array['approve_work', 'approve_time', 'view_attendance', 'see_profitability', 'export_data']) p(k)
   where public.has_permission(p.k);
$$;
revoke execute on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

commit;

-- Verification (one statement):
--
-- select
--   (select count(*) from information_schema.tables where table_name in ('branches', 'roles')) as new_tables,
--   (select count(*) from public.organizations o where not exists (select 1 from public.branches b where b.org_id = o.id and b.is_default)) as firms_without_head_office,
--   (select count(*) from pg_policy where polname = 'scope_visibility') as scope_policies,
--   (select count(*) from pg_proc where proname = 'invoices_before_write' and prosrc like '%separate_numbering%') as branch_billing;
--
-- Expected: 2, 0, 9, 1.
