-- 041_invoice_issue_gst_undo.sql
-- Puts invoice numbering back to how it worked before migration 041: drafts hold numbers again.
-- Run it only if you need to roll batch 1 back, together with the previous version of the code.
-- The columns added by 041 stay in place (unused); nothing is dropped or deleted.
-- It stops with a duplicate-number error, and changes nothing, if a number released by 041
-- has since been used by another invoice.

begin;

alter table public.invoices drop constraint if exists invoices_issued_has_number;
alter table public.invoices disable trigger user;

-- Drafts that gave their number back in 041 take it again
update public.invoices i
   set invoice_number = r.invoice_number
  from public.zz_041_released_draft_numbers r
 where r.invoice_id = i.id
   and i.status = 'Draft'
   and i.invoice_number is null;

update public.document_counters c
   set last_value = m.seq, updated_at = now()
  from (
    select org_id,
           'invoices:' || substring(invoice_number from '^(.*?)[0-9]+$') as scope,
           max(substring(invoice_number from '([0-9]+)$')::bigint) as seq
    from public.invoices
    where invoice_number ~ '[0-9]{1,9}$'
    group by 1, 2
  ) m
 where c.org_id = m.org_id and c.scope = m.scope and c.last_value < m.seq;

-- Drafts created after 041 have no number yet; the old rules expect one
update public.invoices i
   set invoice_number = public.allocate_document_number(
         i.org_id, 'invoices', 'invoice_number',
         public.resolve_doc_prefix(
           coalesce((select nullif(trim(f.invoice_prefix), '') from public.firm_settings f where f.org_id = i.org_id), 'INV/{FY}/'),
           coalesce(i.date, (now() at time zone 'Asia/Kolkata')::date)),
         4)
 where i.status = 'Draft' and i.invoice_number is null;

alter table public.invoices enable trigger user;

-- The invoice rules exactly as they were in 032_multi_tenancy_numbering_settings.sql
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

commit;

-- Verification:
-- select o.slug, count(*) as drafts_without_number
-- from public.invoices i join public.organizations o on o.id = i.org_id
-- where i.status = 'Draft' and i.invoice_number is null
-- group by o.slug;
-- Expected: no rows.
