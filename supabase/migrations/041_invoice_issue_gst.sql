-- 041_invoice_issue_gst.sql
-- GST correctness for invoices:
--   B-02  the invoice number is allocated when the invoice is issued, not when the draft is saved
--   B-05  the place of supply is stored on the invoice and decides IGST or CGST + SGST
--   B-25  the buyer's details are copied onto the invoice when it is issued and never change afterwards
-- Safe to run more than once. Nothing is dropped or deleted.

begin;

-- 1. New columns
alter table public.invoices
  add column if not exists place_of_supply  text,
  add column if not exists buyer_name       text,
  add column if not exists buyer_contact    text,
  add column if not exists buyer_address    text,
  add column if not exists buyer_gstin      text,
  add column if not exists buyer_pan        text,
  add column if not exists buyer_state_code text,
  add column if not exists issued_at        timestamptz;

alter table public.invoices drop constraint if exists invoices_place_of_supply_check;
alter table public.invoices add constraint invoices_place_of_supply_check
  check (place_of_supply is null or place_of_supply ~ '^[0-9]{2}$');

-- 2. State codes (same list as src/lib/gst.ts)
create or replace function public.gst_state_code(p_state text)
returns text
language sql immutable set search_path = public
as $$
  select s.code
  from (values
    ('01', 'jammuandkashmir'), ('01', 'jammukashmir'), ('02', 'himachalpradesh'), ('03', 'punjab'), ('04', 'chandigarh'),
    ('05', 'uttarakhand'), ('05', 'uttaranchal'), ('06', 'haryana'), ('07', 'delhi'), ('07', 'newdelhi'), ('07', 'nctofdelhi'),
    ('08', 'rajasthan'), ('09', 'uttarpradesh'), ('10', 'bihar'), ('11', 'sikkim'), ('12', 'arunachalpradesh'),
    ('13', 'nagaland'), ('14', 'manipur'), ('15', 'mizoram'), ('16', 'tripura'), ('17', 'meghalaya'), ('18', 'assam'),
    ('19', 'westbengal'), ('20', 'jharkhand'), ('21', 'odisha'), ('21', 'orissa'), ('22', 'chhattisgarh'), ('22', 'chattisgarh'),
    ('23', 'madhyapradesh'), ('24', 'gujarat'), ('26', 'dadraandnagarhavelianddamananddiu'), ('26', 'dadraandnagarhaveli'),
    ('26', 'damananddiu'), ('27', 'maharashtra'), ('29', 'karnataka'), ('30', 'goa'), ('31', 'lakshadweep'), ('32', 'kerala'),
    ('33', 'tamilnadu'), ('34', 'puducherry'), ('34', 'pondicherry'), ('35', 'andamanandnicobarislands'),
    ('35', 'andamanandnicobar'), ('36', 'telangana'), ('37', 'andhrapradesh'), ('38', 'ladakh'), ('97', 'otherterritory'),
    -- two-digit codes are accepted as typed; 25 and 28 only survive in old GSTINs
    ('01', '01'), ('02', '02'), ('03', '03'), ('04', '04'), ('05', '05'), ('06', '06'), ('07', '07'), ('08', '08'), ('09', '09'),
    ('10', '10'), ('11', '11'), ('12', '12'), ('13', '13'), ('14', '14'), ('15', '15'), ('16', '16'), ('17', '17'), ('18', '18'),
    ('19', '19'), ('20', '20'), ('21', '21'), ('22', '22'), ('23', '23'), ('24', '24'), ('26', '25'), ('26', '26'), ('27', '27'),
    ('37', '28'), ('29', '29'), ('30', '30'), ('31', '31'), ('32', '32'), ('33', '33'), ('34', '34'), ('35', '35'), ('36', '36'),
    ('37', '37'), ('38', '38'), ('97', '97')
  ) as s(code, key)
  where s.key = regexp_replace(replace(lower(coalesce(p_state, '')), '&', 'and'), '[^a-z0-9]', '', 'g')
  limit 1
$$;

-- Default place of supply for a client: the GSTIN's state, otherwise the state on record
create or replace function public.gst_place_of_supply(p_gstin text, p_state text)
returns text
language sql immutable set search_path = public
as $$
  select coalesce(
    case when upper(trim(coalesce(p_gstin, ''))) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
         then public.gst_state_code(left(trim(p_gstin), 2)) end,
    public.gst_state_code(p_state))
$$;

revoke all on function public.gst_state_code(text) from public, anon, authenticated;
revoke all on function public.gst_place_of_supply(text, text) from public, anon, authenticated;
grant execute on function public.gst_state_code(text) to service_role;
grant execute on function public.gst_place_of_supply(text, text) to service_role;

-- 3. Existing data. The invoice trigger keeps numbers and issued invoices fixed, so it is
--    switched off for these statements only; the table is locked until commit.
alter table public.invoices disable trigger user;

-- 3a. Drafts that already hold a number give it back when every numbered draft in the
--     series sits above the last issued invoice, so the series continues without a gap.
--     Otherwise the drafts keep their numbers. Released numbers are recorded for undo.
create table if not exists public.zz_041_released_draft_numbers (
  invoice_id     uuid primary key,
  org_id         uuid not null,
  invoice_number text not null,
  released_at    timestamptz not null default now()
);
alter table public.zz_041_released_draft_numbers enable row level security;
revoke all on public.zz_041_released_draft_numbers from anon, authenticated;

create temporary table tmp_041_series on commit drop as
with numbered as (
  select id, org_id, status,
         substring(invoice_number from '^(.*?)[0-9]+$') as prefix,
         substring(invoice_number from '([0-9]+)$')::bigint as seq
  from public.invoices
  where invoice_number ~ '[0-9]{1,9}$'
)
select n.org_id, n.prefix,
       coalesce(max(n.seq) filter (where n.status is distinct from 'Draft'), 0) as last_issued
from numbered n
join public.document_counters c on c.org_id = n.org_id and c.scope = 'invoices:' || n.prefix
group by n.org_id, n.prefix
having min(n.seq) filter (where n.status = 'Draft')
     > coalesce(max(n.seq) filter (where n.status is distinct from 'Draft'), 0);

insert into public.zz_041_released_draft_numbers (invoice_id, org_id, invoice_number)
select i.id, i.org_id, i.invoice_number
from public.invoices i
join tmp_041_series s
  on s.org_id = i.org_id and s.prefix = substring(i.invoice_number from '^(.*?)[0-9]+$')
where i.status = 'Draft'
on conflict (invoice_id) do nothing;

update public.invoices i
   set invoice_number = null
  from tmp_041_series s
 where i.status = 'Draft'
   and s.org_id = i.org_id
   and s.prefix = substring(i.invoice_number from '^(.*?)[0-9]+$');

update public.document_counters c
   set last_value = s.last_issued, updated_at = now()
  from tmp_041_series s
 where c.org_id = s.org_id
   and c.scope = 'invoices:' || s.prefix
   and c.last_value > s.last_issued;

-- 3b. Invoices issued before this migration take the buyer's details from the client record as it is today
update public.invoices i
   set buyer_name       = coalesce(nullif(trim(i.organisation), ''), nullif(trim(c.organization_name), ''), c.name),
       buyer_contact    = case when c.name is distinct from
                                    coalesce(nullif(trim(i.organisation), ''), nullif(trim(c.organization_name), ''), c.name)
                               then c.name end,
       buyer_address    = nullif(trim(c.address), ''),
       buyer_gstin      = upper(nullif(trim(c.gstin), '')),
       buyer_pan        = upper(nullif(trim(c.pan), '')),
       buyer_state_code = public.gst_place_of_supply(c.gstin, c.state)
  from public.clients c
 where c.id = i.client_id
   and i.status is distinct from 'Draft'
   and i.buyer_name is null;

-- 3c. ...and a place of supply, but only where it agrees with the tax already charged
update public.invoices i
   set place_of_supply = x.pos
  from (
    select i2.id,
           public.gst_place_of_supply(c.gstin, c.state) as pos,
           public.gst_place_of_supply(f.gstin, null) as firm_state
    from public.invoices i2
    join public.clients c on c.id = i2.client_id
    left join public.firm_settings f on f.org_id = i2.org_id
  ) x
 where x.id = i.id
   and i.status is distinct from 'Draft'
   and i.place_of_supply is null
   and x.pos is not null
   and (x.firm_state is null or (x.pos <> x.firm_state) = coalesce(i.is_inter_state, false));

alter table public.invoices enable trigger user;

-- 4. Invoice rules
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
end $$;

-- 5. An issued invoice always has a number
alter table public.invoices drop constraint if exists invoices_issued_has_number;
alter table public.invoices add constraint invoices_issued_has_number
  check (invoice_number is not null or status in ('Draft', 'Cancelled'));

commit;

-- Verification (run after the migration; one statement):
--
-- select o.slug,
--        count(*) filter (where i.status = 'Draft' and i.invoice_number is null)                 as drafts_without_number,
--        count(*) filter (where i.status = 'Draft' and i.invoice_number is not null)             as drafts_keeping_old_number,
--        count(*) filter (where i.status not in ('Draft', 'Cancelled') and i.invoice_number is null) as issued_without_number,
--        count(*) filter (where i.status not in ('Draft', 'Cancelled') and i.buyer_name is null)   as issued_without_buyer,
--        count(*) filter (where i.status not in ('Draft', 'Cancelled') and i.place_of_supply is null) as issued_without_place_of_supply
-- from public.invoices i join public.organizations o on o.id = i.org_id
-- group by o.slug order by o.slug;
--
-- Expected: issued_without_number = 0 and issued_without_buyer = 0 for every firm.
-- drafts_keeping_old_number > 0 means those drafts sit below an issued invoice in the series and kept their numbers.
-- issued_without_place_of_supply > 0 means the client has no state, or the state disagrees with the tax charged; review those invoices.
