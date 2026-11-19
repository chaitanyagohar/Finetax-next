-- Undo for 056_branches_and_roles.sql. Run 058 and 057 undo first.
-- Removes branches, firm roles and what each person may see. Everyone sees the whole firm again, as
-- before batch 11. Invoices keep their numbers and GSTIN as issued; new invoices use the firm's.
-- Sections people have stay as they are now.

begin;

drop policy if exists scope_visibility on public.clients;
drop policy if exists scope_visibility on public.tasks;
drop policy if exists scope_visibility on public.invoices;
drop policy if exists scope_visibility on public.invoice_payments;
drop policy if exists scope_visibility on public.quotations;
drop policy if exists scope_visibility on public.leads;
drop policy if exists scope_visibility on public.documents;
drop policy if exists scope_visibility on public.time_logs;
drop policy if exists scope_visibility on public.discussions;

-- Invoices: back to the batch 10 version (050_payments)
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

-- Practice insights: admins only again
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
  if not public.is_admin() then
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
  if not public.is_admin() then
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
  if not public.is_admin() then
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

drop trigger if exists clients_branch_check on public.clients;
drop trigger if exists leads_branch_check on public.leads;
drop trigger if exists memberships_branch_check on public.memberships;
drop trigger if exists invoices_branch_check on public.invoices;
drop function if exists public.branch_belongs_to_firm();
drop trigger if exists organizations_head_office on public.organizations;
drop function if exists public.organizations_head_office();
drop trigger if exists clients_scope_defaults on public.clients;
drop trigger if exists leads_scope_defaults on public.leads;
drop trigger if exists memberships_apply_role on public.memberships;
drop trigger if exists roles_before_write on public.roles;
drop trigger if exists roles_sync_members on public.roles;
drop trigger if exists branches_before_write on public.branches;
drop trigger if exists branches_keep_default on public.branches;

drop function if exists public.my_permissions();
drop function if exists public.scope_defaults();
drop function if exists public.memberships_apply_role();
drop function if exists public.roles_sync_members();
drop function if exists public.roles_before_write();
drop function if exists public.branches_before_write();
drop function if exists public.branches_keep_default();
drop function if exists public.invoice_in_scope(uuid);
drop function if exists public.user_in_scope(uuid);
drop function if exists public.client_in_scope(uuid);
drop function if exists public.has_permission(text);
drop function if exists public.my_branch();
drop function if exists public.my_scope();
drop function if exists public.default_branch(uuid);

alter table public.memberships drop column if exists role_id;
alter table public.memberships drop column if exists branch_id;
alter table public.clients drop column if exists branch_id;
alter table public.invoices drop column if exists branch_id;
alter table public.leads drop column if exists branch_id;

drop table if exists public.roles;
drop table if exists public.branches;

commit;
