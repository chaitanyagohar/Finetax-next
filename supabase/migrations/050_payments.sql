-- 050_payments.sql
-- Batch 10, payments.
--   1. Invoices: each line can carry its own GST rate (items[].gst_rate). Tax is worked out per rate,
--      each rate rounded once, so an invoice with one rate gives exactly the same figures as before.
--   2. Razorpay, connected by each firm with its own keys (payment_gateways). The key secret and the
--      webhook secret go into Supabase Vault and can never be read back from the browser.
--   3. Payment links per invoice (invoice_payment_links), written by the server only.
--   4. invoice_payments.gateway_payment_id, so a payment Razorpay reports twice is recorded once.
-- Safe to run more than once. No data is dropped or deleted.

begin;

-- ---------------------------------------------------------------- 1. Per-line GST
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


-- ---------------------------------------------------------------- 2. Razorpay connection per firm
create table if not exists public.payment_gateways (
  org_id            uuid primary key default public.default_org_id() references public.organizations(id) on delete cascade,
  provider          text not null default 'razorpay' check (provider = 'razorpay'),
  key_id            text not null check (key_id ~ '^rzp_(test|live)_[A-Za-z0-9]{8,32}$'),
  mode              text generated always as (case when key_id like 'rzp_live_%' then 'live' else 'test' end) stored,
  -- Write-only: the trigger moves these into Vault and blanks them
  key_secret        text,
  webhook_secret    text,
  key_secret_id     uuid,
  webhook_secret_id uuid,
  is_active         boolean not null default true,
  connected_by      uuid default auth.uid(),
  connected_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_event_at     timestamptz,
  last_error        text
);

create or replace function public.payment_gateways_protect_secret()
returns trigger
language plpgsql security definer set search_path = public, vault
as $$
begin
  new.key_id := trim(new.key_id);
  new.updated_at := now();

  if tg_op = 'UPDATE' then
    new.org_id := old.org_id;
    new.connected_at := old.connected_at;
    new.connected_by := old.connected_by;
    if auth.uid() is not null then
      new.last_event_at := old.last_event_at;
      new.last_error := old.last_error;
    end if;
  else
    new.connected_by := coalesce(auth.uid(), new.connected_by);
    new.last_event_at := null;
    new.last_error := null;
  end if;

  -- Key secret: a new value replaces the stored one; a changed key ID without one clears it
  if nullif(trim(new.key_secret), '') is not null then
    if tg_op = 'UPDATE' and old.key_secret_id is not null then
      perform vault.update_secret(old.key_secret_id, trim(new.key_secret));
      new.key_secret_id := old.key_secret_id;
    else
      new.key_secret_id := vault.create_secret(trim(new.key_secret), 'razorpay_key_' || new.org_id::text, 'Razorpay key secret');
    end if;
  elsif tg_op = 'UPDATE' then
    if new.key_id is distinct from old.key_id then
      if old.key_secret_id is not null then
        delete from vault.secrets where id = old.key_secret_id;
      end if;
      new.key_secret_id := null;
    else
      new.key_secret_id := old.key_secret_id;
    end if;
  else
    new.key_secret_id := null;
  end if;

  if nullif(trim(new.webhook_secret), '') is not null then
    if tg_op = 'UPDATE' and old.webhook_secret_id is not null then
      perform vault.update_secret(old.webhook_secret_id, trim(new.webhook_secret));
      new.webhook_secret_id := old.webhook_secret_id;
    else
      new.webhook_secret_id := vault.create_secret(trim(new.webhook_secret), 'razorpay_webhook_' || new.org_id::text, 'Razorpay webhook secret');
    end if;
  elsif tg_op = 'UPDATE' then
    new.webhook_secret_id := old.webhook_secret_id;
  else
    new.webhook_secret_id := null;
  end if;

  if new.key_secret_id is null then
    raise exception 'Enter the Razorpay key secret.';
  end if;

  new.key_secret := null;
  new.webhook_secret := null;
  return new;
end $$;

create or replace function public.payment_gateways_cleanup_secret()
returns trigger
language plpgsql security definer set search_path = public, vault
as $$
begin
  delete from vault.secrets where id in (old.key_secret_id, old.webhook_secret_id);
  return old;
end $$;

drop trigger if exists payment_gateways_protect_secret on public.payment_gateways;
create trigger payment_gateways_protect_secret before insert or update on public.payment_gateways
  for each row execute function public.payment_gateways_protect_secret();
drop trigger if exists payment_gateways_cleanup_secret on public.payment_gateways;
create trigger payment_gateways_cleanup_secret after delete on public.payment_gateways
  for each row execute function public.payment_gateways_cleanup_secret();
revoke execute on function public.payment_gateways_protect_secret() from public, anon, authenticated;
revoke execute on function public.payment_gateways_cleanup_secret() from public, anon, authenticated;

alter table public.payment_gateways enable row level security;
revoke all on public.payment_gateways from anon;
grant select, insert, update, delete on public.payment_gateways to authenticated;
grant all on public.payment_gateways to service_role;

drop policy if exists org_isolation on public.payment_gateways;
create policy org_isolation on public.payment_gateways as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));
drop policy if exists payment_gateways_admin on public.payment_gateways;
create policy payment_gateways_admin on public.payment_gateways for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Anyone in the firm may know whether online payment is on (to show "Payment link"), not the keys
create or replace function public.payment_gateway_status()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('connected', g.is_active and g.key_secret_id is not null, 'mode', g.mode,
                               'webhook', g.webhook_secret_id is not null, 'last_event_at', g.last_event_at)
       from public.payment_gateways g
      where g.org_id = public.current_org_id() and public.is_active_user()),
    jsonb_build_object('connected', false));
$$;
revoke execute on function public.payment_gateway_status() from public, anon;
grant execute on function public.payment_gateway_status() to authenticated, service_role;

-- Server only: the keys used to call Razorpay and to check its webhooks
create or replace function public.get_payment_gateway_secrets(p_org uuid)
returns table (key_id text, key_secret text, webhook_secret text, is_active boolean)
language sql stable security definer set search_path = public, vault
as $$
  select g.key_id,
         (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.id = g.key_secret_id),
         (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.id = g.webhook_secret_id),
         g.is_active
    from public.payment_gateways g
   where g.org_id = p_org;
$$;
revoke execute on function public.get_payment_gateway_secrets(uuid) from public, anon, authenticated;
grant execute on function public.get_payment_gateway_secrets(uuid) to service_role;

-- ---------------------------------------------------------------- 3. Payment links
create table if not exists public.invoice_payment_links (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  invoice_id       uuid not null references public.invoices(id) on delete cascade,
  provider_link_id text not null unique,
  short_url        text not null check (short_url ~ '^https://'),
  amount           numeric(14, 2) not null check (amount > 0),
  status           text not null default 'created' check (status in ('created', 'paid', 'cancelled', 'expired')),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  paid_at          timestamptz
);
create index if not exists invoice_payment_links_invoice_idx on public.invoice_payment_links (invoice_id, created_at desc);

alter table public.invoice_payment_links enable row level security;
revoke all on public.invoice_payment_links from anon;
revoke insert, update, delete on public.invoice_payment_links from authenticated;
grant select on public.invoice_payment_links to authenticated;
grant all on public.invoice_payment_links to service_role;

drop policy if exists org_isolation on public.invoice_payment_links;
create policy org_isolation on public.invoice_payment_links as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));
drop policy if exists invoice_payment_links_select on public.invoice_payment_links;
create policy invoice_payment_links_select on public.invoice_payment_links for select to authenticated
  using ((select public.is_active_user()) and (select public.has_module('invoices')));

-- ---------------------------------------------------------------- 4. One record per gateway payment
alter table public.invoice_payments add column if not exists gateway_payment_id text;
create unique index if not exists invoice_payments_gateway_payment_uidx
  on public.invoice_payments (gateway_payment_id) where gateway_payment_id is not null;

commit;

-- Verification (one statement):
--
-- select
--   (select count(*) from pg_proc where proname = 'invoices_before_write' and prosrc like '%v_groups%') as line_gst,
--   (select count(*) from information_schema.tables where table_schema = 'public'
--      and table_name in ('payment_gateways', 'invoice_payment_links')) as new_tables,
--   (select count(*) from information_schema.columns where table_name = 'invoice_payments' and column_name = 'gateway_payment_id') as new_column,
--   (select has_function_privilege('authenticated', 'public.get_payment_gateway_secrets(uuid)', 'execute')) as secrets_open_to_browser;
--
-- Expected: 1, 2, 1, false.
