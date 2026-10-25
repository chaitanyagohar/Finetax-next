-- 032_multi_tenancy_numbering_settings.sql
-- Duesk by Oddlambda: multi-tenancy Phase 2B
-- Per-firm numbering, unique rules and settings.

begin;

-- ============================================================
-- 1. Document counters: one series per firm
-- ============================================================
alter table public.document_counters drop constraint if exists document_counters_pkey;
alter table public.document_counters add primary key (org_id, scope);

create or replace function public.allocate_document_number(
  p_org uuid, p_table text, p_column text, p_prefix text, p_pad integer
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_scope text := p_table || ':' || p_prefix;
  v_seed  int := 0;
  v_next  int;
begin
  if p_org is null then
    raise exception 'Firm is missing for document numbering.';
  end if;
  if (p_table, p_column) not in (
       ('invoices', 'invoice_number'),
       ('quotations', 'quote_number'),
       ('proposals', 'number'),
       ('support_tickets', 'number')) then
    raise exception 'Invalid document type.';
  end if;

  -- First use of this prefix in this firm: continue after the firm's highest existing number
  if not exists (select 1 from public.document_counters where org_id = p_org and scope = v_scope) then
    execute format(
      'select coalesce(max((substring(%1$I from %2$s))::int), 0) from public.%3$I
        where org_id = $1 and left(%1$I, %4$s) = %5$L and substring(%1$I from %2$s) ~ ''^[0-9]+$''',
      p_column, length(p_prefix) + 1, p_table, length(p_prefix), p_prefix
    ) into v_seed using p_org;
  end if;

  insert into public.document_counters (org_id, scope, last_value)
  values (p_org, v_scope, v_seed + 1)
  on conflict (org_id, scope) do update
    set last_value = public.document_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;

  return p_prefix || lpad(v_next::text, greatest(p_pad, length(v_next::text)), '0');
end $$;

-- Old 4-argument form kept as a wrapper (uses the current firm)
create or replace function public.allocate_document_number(
  p_table text, p_column text, p_prefix text, p_pad integer
)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  return public.allocate_document_number(public.default_org_id(), p_table, p_column, p_prefix, p_pad);
end $$;

create or replace function public.next_document_number(p_scope text, p_seed integer default 0)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_org  uuid := public.default_org_id();
  v_next integer;
begin
  if v_org is null then
    raise exception 'Firm is missing for document numbering.';
  end if;
  insert into public.document_counters (org_id, scope, last_value)
  values (v_org, p_scope, greatest(p_seed, 0) + 1)
  on conflict (org_id, scope) do update
    set last_value = public.document_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;

-- ============================================================
-- 2. Engagement letters and support tickets use the per-firm counter
--    (now SECURITY DEFINER so they can call the locked-down numbering)
-- ============================================================
create or replace function public.proposals_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
  v_fy     int;
  v_prefix text;
begin
  if tg_op = 'INSERT' then
    v_fy := case when extract(month from v_today) >= 4
                 then extract(year from v_today)::int
                 else extract(year from v_today)::int - 1 end;
    v_prefix := 'EL/' || v_fy || '-' || lpad(((v_fy + 1) % 100)::text, 2, '0') || '/';
    new.number := public.allocate_document_number(new.org_id, 'proposals', 'number', v_prefix, 3);
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    if new.services is null or new.services = '[]'::jsonb then
      select coalesce(jsonb_agg(jsonb_build_object('title', title, 'category', category, 'recurrence', recurrence,
                                                   'days_due_offset', days_due_offset)
                                order by days_due_offset, title), '[]'::jsonb)
        into new.services
      from public.package_services
      where package_id = new.package_id and org_id = new.org_id;
    end if;
  else
    new.number := old.number;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if old.status = 'Accepted' then
      raise exception 'An accepted engagement letter cannot be changed.';
    end if;
  end if;
  return new;
end $$;

create or replace function public.support_tickets_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.number := public.allocate_document_number(new.org_id, 'support_tickets', 'number', 'SUP-', 4);
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

-- ============================================================
-- 3. Invoices and quotations: prefix from THIS firm's settings,
--    number from THIS firm's series (rest unchanged)
-- ============================================================
create or replace function public.invoices_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  e jsonb;
  v_qty numeric;
  v_rate numeric;
  v_sub numeric := 0;
  v_gst numeric;
  v_recalc boolean := false;
  v_date date;
  v_prefix text;
  v_sync boolean := coalesce(current_setting('app.payment_sync', true), 'off') = 'on';
  v_browser boolean := auth.uid() is not null;
begin
  if tg_op = 'UPDATE' then
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

    if old.status is distinct from 'Draft' and (
         new.items is distinct from old.items
      or new.gst_rate is distinct from old.gst_rate
      or new.is_inter_state is distinct from old.is_inter_state
      or new.client_id is distinct from old.client_id
      or new.date is distinct from old.date
      or new.issue_date is distinct from old.issue_date
    ) then
      raise exception 'Issued invoices cannot be edited. Cancel it and create a new invoice instead.';
    end if;

    if new.status = 'Draft' and old.status is distinct from 'Draft' then
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

    v_recalc := new.items is distinct from old.items
             or new.gst_rate is distinct from old.gst_rate
             or new.is_inter_state is distinct from old.is_inter_state;
  else
    v_recalc := true;
    new.amount_paid := 0;
    new.created_at := now();
    if coalesce(new.status, '') not in ('Draft', 'Sent') then
      new.status := 'Draft';
    end if;
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
      v_sub := v_sub + v_qty * v_rate;
    end loop;

    v_gst := coalesce(new.gst_rate, 0);
    if v_gst < 0 or v_gst > 100 then
      raise exception 'GST rate must be between 0 and 100.';
    end if;

    new.subtotal := round(v_sub, 2);
    if coalesce(new.is_inter_state, false) then
      new.igst := round(new.subtotal * v_gst / 100, 2);
      new.cgst := 0;
      new.sgst := 0;
    else
      new.cgst := round(new.subtotal * v_gst / 200, 2);
      new.sgst := new.cgst;
      new.igst := 0;
    end if;
    new.tax := new.cgst + new.sgst + new.igst;
    new.total := new.subtotal + new.tax;
  end if;

  if v_sync and coalesce(new.status, '') <> 'Cancelled' then
    if coalesce(new.total, 0) > 0 and coalesce(new.amount_paid, 0) >= new.total - 0.01 then
      new.status := 'Paid';
    elsif coalesce(new.amount_paid, 0) > 0 then
      new.status := 'Partially Paid';
    elsif new.status in ('Paid', 'Partially Paid') then
      new.status := 'Sent';
    end if;
  end if;

  if tg_op = 'INSERT' then
    v_date := coalesce(new.date, new.issue_date, (now() at time zone 'Asia/Kolkata')::date);
    new.date := coalesce(new.date, v_date);
    new.issue_date := coalesce(new.issue_date, v_date);

    select nullif(trim(invoice_prefix), '') into v_prefix
      from public.firm_settings where org_id = new.org_id;
    v_prefix := public.resolve_doc_prefix(coalesce(v_prefix, 'INV/{FY}/'), v_date);
    new.invoice_number := public.allocate_document_number(new.org_id, 'invoices', 'invoice_number', v_prefix, 4);
  end if;

  if new.due_date is not null and new.due_date < coalesce(new.date, new.issue_date) then
    raise exception 'The due date cannot be before the invoice date.';
  end if;

  new."amountPaid" := new.amount_paid;
  new."isInterState" := new.is_inter_state;
  new."gstRate" := new.gst_rate;
  new."dueDate" := new.due_date;

  return new;
end $$;

create or replace function public.quotations_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  e jsonb;
  v_qty numeric;
  v_rate numeric;
  v_sub numeric := 0;
  v_gst numeric;
  v_recalc boolean;
  v_date date;
  v_prefix text;
begin
  if tg_op = 'UPDATE' then
    new.quote_number := old.quote_number;
    new.quotation_number := old.quotation_number;
    new.created_at := old.created_at;
    new.org_id := old.org_id;

    if old.status = 'Converted' and (
         new.items is distinct from old.items
      or new.gst_rate is distinct from old.gst_rate
      or new.is_inter_state is distinct from old.is_inter_state
      or new.client_id is distinct from old.client_id
      or new.status is distinct from old.status
    ) then
      raise exception 'This quotation has been converted to an invoice and can no longer be changed.';
    end if;

    v_recalc := new.items is distinct from old.items
             or new.gst_rate is distinct from old.gst_rate
             or new.is_inter_state is distinct from old.is_inter_state;
  else
    v_recalc := true;
  end if;

  if v_recalc then
    if new.items is null or jsonb_typeof(new.items) <> 'array' or jsonb_array_length(new.items) = 0 then
      raise exception 'At least one line item is required.';
    end if;
    if jsonb_array_length(new.items) > 100 then
      raise exception 'A quotation can have at most 100 line items.';
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
      v_sub := v_sub + v_qty * v_rate;
    end loop;

    v_gst := coalesce(new.gst_rate, 0);
    if v_gst < 0 or v_gst > 100 then
      raise exception 'GST rate must be between 0 and 100.';
    end if;

    new.subtotal := round(v_sub, 2);
    if coalesce(new.is_inter_state, false) then
      new.igst := round(new.subtotal * v_gst / 100, 2);
      new.cgst := 0;
      new.sgst := 0;
    else
      new.cgst := round(new.subtotal * v_gst / 200, 2);
      new.sgst := new.cgst;
      new.igst := 0;
    end if;
    new.tax := new.cgst + new.sgst + new.igst;
    new.total := new.subtotal + new.tax;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    if coalesce(new.status, '') = '' then
      new.status := 'Draft';
    end if;
    if coalesce(new.date, '') = '' then
      new.date := ((now() at time zone 'Asia/Kolkata')::date)::text;
    end if;

    begin
      v_date := left(new.date, 10)::date;
    exception when others then
      v_date := (now() at time zone 'Asia/Kolkata')::date;
    end;

    select nullif(trim(quotation_prefix), '') into v_prefix
      from public.firm_settings where org_id = new.org_id;
    v_prefix := public.resolve_doc_prefix(coalesce(v_prefix, 'QUO/{YYYY}/'), v_date);

    new.quote_number := public.allocate_document_number(new.org_id, 'quotations', 'quote_number', v_prefix, 3);
    new.quotation_number := new.quote_number;
  end if;

  return new;
end $$;

-- ============================================================
-- 4. Task type lookup stays inside the firm
-- ============================================================
create or replace function public.tasks_task_type_guard()
returns trigger
language plpgsql set search_path = public
as $$
declare
  v_type public.task_types%rowtype;
begin
  new.title := trim(coalesce(new.title, ''));
  new.period := nullif(trim(coalesce(new.period, '')), '');

  if new.task_type_id is not null then
    select * into v_type from public.task_types
     where id = new.task_type_id and org_id = new.org_id;
    if found then
      new.title := v_type.name;
    else
      raise exception 'Task type not found.';
    end if;
  else
    select * into v_type from public.task_types
     where org_id = new.org_id and lower(trim(name)) = lower(new.title)
     limit 1;
    if found then
      new.task_type_id := v_type.id;
    end if;
  end if;

  if auth.uid() is not null
     and pg_trigger_depth() = 1
     and not public.is_admin()
     and (tg_op = 'INSERT' or new.title is distinct from old.title)
     and (v_type.id is null or not v_type.is_active) then
    raise exception 'Choose a task from the task list. Only administrators can add new task types.';
  end if;

  return new;
end $$;

-- ============================================================
-- 5. Unique rules become per firm
-- ============================================================
alter table public.email_accounts drop constraint if exists email_accounts_email_address_key;
alter table public.email_accounts add constraint email_accounts_org_email_key unique (org_id, email_address);

alter table public.email_messages drop constraint if exists email_messages_message_id_key;
alter table public.email_messages add constraint email_messages_org_message_id_key unique (org_id, message_id);

alter table public.proposals drop constraint if exists proposals_number_key;
alter table public.proposals add constraint proposals_org_number_key unique (org_id, number);

alter table public.support_tickets drop constraint if exists support_tickets_number_key;
alter table public.support_tickets add constraint support_tickets_org_number_key unique (org_id, number);

drop index if exists public.chat_channels_name_uidx;
create unique index chat_channels_name_uidx on public.chat_channels (org_id, lower(name))
  where kind = 'channel' and archived_at is null;

drop index if exists public.task_categories_name_uidx;
create unique index task_categories_name_uidx on public.task_categories (org_id, lower(trim(name)));

drop index if exists public.task_types_name_uidx;
create unique index task_types_name_uidx on public.task_types (org_id, lower(trim(name)));

-- New GST safety net (skipped with a notice if old duplicates exist)
do $$
begin
  if exists (select 1 from public.invoices where invoice_number is not null
             group by org_id, invoice_number having count(*) > 1) then
    raise notice 'Duplicate invoice numbers found: invoice unique rule NOT added';
  else
    create unique index if not exists invoices_org_number_uidx
      on public.invoices (org_id, invoice_number) where invoice_number is not null;
  end if;

  if exists (select 1 from public.quotations where quote_number is not null
             group by org_id, quote_number having count(*) > 1) then
    raise notice 'Duplicate quotation numbers found: quotation unique rule NOT added';
  else
    create unique index if not exists quotations_org_number_uidx
      on public.quotations (org_id, quote_number) where quote_number is not null;
  end if;
end $$;

-- ============================================================
-- 6. Settings tables: one row per firm (Finetax keeps id 1)
-- ============================================================
do $$
declare
  t     text;
  c     record;
  v_max int;
begin
  foreach t in array array['firm_settings', 'engagement_settings', 'kpi_settings', 'reminder_settings'] loop
    -- drop any "id must be 1" rule
    for c in
      select conname from pg_constraint
      where conrelid = ('public.' || t)::regclass and contype = 'c'
        and pg_get_constraintdef(oid) ~* '\mid\M\s*=\s*1\M'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;

    -- give id an automatic value for new firms
    if (select column_default from information_schema.columns
         where table_schema = 'public' and table_name = t and column_name = 'id') is null then
      execute format('create sequence if not exists public.%I owned by public.%I.id', t || '_id_seq', t);
      execute format('select coalesce(max(id), 0) from public.%I', t) into v_max;
      perform setval(('public.' || t || '_id_seq')::regclass, greatest(v_max, 1), true);
      execute format('alter table public.%I alter column id set default nextval(%L)', t, 'public.' || t || '_id_seq');
    end if;

    execute format('create unique index if not exists %I on public.%I (org_id)', t || '_org_uidx', t);
  end loop;
end $$;

-- ============================================================
-- 7. Number generators: never callable from the browser
-- ============================================================
revoke all on function public.allocate_document_number(uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.allocate_document_number(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.next_document_number(text, integer) from public, anon, authenticated;
grant execute on function public.allocate_document_number(uuid, text, text, text, integer) to service_role;
grant execute on function public.allocate_document_number(text, text, text, integer) to service_role;
grant execute on function public.next_document_number(text, integer) to service_role;

commit;