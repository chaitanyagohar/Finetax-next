-- Undo for 050_payments.sql. Run the undo files from 054 down to 050.
-- Puts back the single-rate invoice calculation and removes Razorpay. Saved Razorpay keys are deleted from
-- Vault, payment links are forgotten, and invoice_payments.gateway_payment_id is dropped (the payments
-- themselves stay). Invoices saved with per-line GST rates keep their stored totals.

begin;

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
  v_sub numeric := 0;
  v_gst numeric;
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
    if coalesce(new.gst_rate, 0) > 0 and v_firm_state is null then
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

drop table if exists public.invoice_payment_links;
drop table if exists public.payment_gateways;
drop function if exists public.payment_gateway_status();
drop function if exists public.get_payment_gateway_secrets(uuid);
drop function if exists public.payment_gateways_protect_secret();
drop function if exists public.payment_gateways_cleanup_secret();
drop index if exists public.invoice_payments_gateway_payment_uidx;
alter table public.invoice_payments drop column if exists gateway_payment_id;

commit;
