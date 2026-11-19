-- 051_compliance_and_checklists.sql
-- Batch 10, compliance work.
--   1. Clients: TAN and GST filing scheme, so Duesk can tell which returns a client needs.
--   2. Task types: who they apply to (applies_to) and a document checklist.
--      install_compliance_library() adds the standard Indian returns a firm doesn't have yet.
--   3. compliance_suggestions() / apply_compliance_plan(): set up a client's recurring returns in one go.
--   4. extend_statutory_due_date(): when a due date is extended, every open task for that return and period moves.
--   5. task_checklist_items: per-task checklist, filled from the task type when a task is created.
--   6. email_attachments: where the file is stored and the vault document it was saved as (B-22).
-- Safe to run more than once. No data is dropped or deleted.

begin;

-- ---------------------------------------------------------------- 1. Client registrations
alter table public.clients add column if not exists tan text;
alter table public.clients add column if not exists gst_scheme text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_tan_check') then
    alter table public.clients add constraint clients_tan_check check (tan is null or tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clients_gst_scheme_check') then
    alter table public.clients add constraint clients_gst_scheme_check
      check (gst_scheme is null or gst_scheme in ('monthly', 'qrmp', 'composition')) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------- 2. Task types: audience and checklist
alter table public.task_types add column if not exists applies_to text;
alter table public.task_types add column if not exists checklist jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'task_types_applies_to_check') then
    alter table public.task_types add constraint task_types_applies_to_check
      check (applies_to is null or applies_to in ('gst_monthly', 'gst_qrmp', 'gst_any', 'gst_composition', 'tds', 'company', 'llp', 'individual', 'audit_entity', 'everyone'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'task_types_checklist_check') then
    alter table public.task_types add constraint task_types_checklist_check
      check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 30);
  end if;
end $$;

-- What kind of entity a client is, from the type the firm recorded
create or replace function public.client_entity(p_type text)
returns text
language sql immutable set search_path = public
as $$
  select case
    when p_type ilike any (array['%private limited%', '%public limited%', '%company%', '%opc%', '%pvt%']) then 'company'
    when p_type ilike '%llp%' then 'llp'
    when p_type ilike any (array['%individual%', '%huf%', '%proprietor%']) then 'individual'
    else 'other'
  end;
$$;

-- Standard Indian compliance, with deadlines as of 2026. A firm can change any rule afterwards.
create or replace function public.install_compliance_library()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_added int := 0;
  r record;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can add task types.';
  end if;

  for r in select * from (values
    ('GSTR-1 filing', 'GST', 'Monthly', 11, 1, 3, 'gst_monthly', '["Sales register", "Credit and debit notes", "E-invoice and e-way bill data"]'),
    ('GSTR-3B filing', 'GST', 'Monthly', 20, 1, 3, 'gst_monthly', '["Purchase register", "GSTR-2B reconciliation", "Tax payment challan"]'),
    ('GSTR-1 (QRMP)', 'GST', 'Quarterly', 13, 1, 3, 'gst_qrmp', '["Sales register", "Credit and debit notes"]'),
    ('GSTR-3B (QRMP)', 'GST', 'Quarterly', 22, 1, 3, 'gst_qrmp', '["Purchase register", "GSTR-2B reconciliation", "Tax payment challan"]'),
    ('CMP-08 (composition)', 'GST', 'Quarterly', 18, 1, 3, 'gst_composition', '["Turnover for the quarter"]'),
    ('GSTR-9 annual return', 'GST', 'Yearly', 31, 9, 15, 'gst_any', '["Books of accounts", "GSTR-1 and 3B for the year", "ITC reconciliation"]'),
    ('TDS payment', 'TDS', 'Monthly', 7, 1, 2, 'tds', '["Salary and vendor payments for the month"]'),
    ('TDS return (24Q/26Q)', 'TDS', 'Quarterly', 31, 1, 7, 'tds', '["Deduction details", "Challans paid", "PAN of deductees"]'),
    ('ITR filing', 'Income Tax', 'Yearly', 31, 4, 10, 'individual', '["Form 16", "AIS and 26AS", "Bank statements", "Capital gains statement", "Investment proofs (80C, 80D)"]'),
    ('ITR filing (audit cases)', 'Income Tax', 'Yearly', 31, 7, 10, 'audit_entity', '["Audited financial statements", "Tax audit report", "AIS and 26AS"]'),
    ('ROC annual filing (AOC-4)', 'ROC', 'Yearly', 30, 7, 10, 'company', '["Audited financial statements", "Board report", "AGM date"]'),
    ('ROC annual return (MGT-7)', 'ROC', 'Yearly', 29, 8, 10, 'company', '["List of shareholders", "Director details"]'),
    ('DIR-3 KYC', 'ROC', 'Yearly', 30, 6, 7, 'company', '["Director PAN and Aadhaar", "Mobile and email OTP"]'),
    ('LLP Form 11', 'ROC', 'Yearly', 30, 2, 7, 'llp', '["Partner contribution details"]'),
    ('LLP Form 8', 'ROC', 'Yearly', 30, 7, 10, 'llp', '["Statement of accounts and solvency"]')
  ) as t(name, category, rec, sday, soff, buffer, applies, checklist)
  loop
    if not exists (select 1 from public.task_types where org_id = v_org and lower(trim(name)) = lower(r.name)) then
      insert into public.task_types (org_id, name, category, default_recurrence, statutory_day, statutory_month_offset,
                                     internal_buffer_days, is_active, applies_to, checklist)
      values (v_org, r.name, r.category, r.rec, r.sday, r.soff, r.buffer, true, r.applies, r.checklist::jsonb);
      v_added := v_added + 1;
    else
      -- An existing type of the same name keeps its rule; it only learns who it applies to
      update public.task_types
         set applies_to = coalesce(applies_to, r.applies),
             checklist = case when jsonb_array_length(checklist) = 0 then r.checklist::jsonb else checklist end
       where org_id = v_org and lower(trim(name)) = lower(r.name);
    end if;
  end loop;
  return v_added;
end $$;
revoke execute on function public.install_compliance_library() from public, anon;
grant execute on function public.install_compliance_library() to authenticated;

-- ---------------------------------------------------------------- 3. A client's compliance plan
-- The nearest deadline still ahead for a return, looking back one period first: in November the
-- annual GST return due on 31 December is for the year that ended in March, not the current one.
create or replace function public.compliance_next_due(p_type uuid, p_today date default null)
returns table (period text, statutory_date date, internal_date date)
language plpgsql stable set search_path = public
as $$
declare
  t public.task_types%rowtype;
  v_today date := coalesce(p_today, (now() at time zone 'Asia/Kolkata')::date);
  v_step interval;
  v_anchor date;
  v_fy int;
  v_q int;
  v_base date;
  v_period text;
  v_stat date;
  i int;
begin
  select * into t from public.task_types where id = p_type;
  if not found or t.statutory_day is null or coalesce(t.default_recurrence, 'None') not in ('Monthly', 'Quarterly', 'Yearly') then
    return query select null::text, null::date, (v_today + 10)::date;
    return;
  end if;

  v_step := case t.default_recurrence when 'Monthly' then interval '1 month' when 'Quarterly' then interval '3 months' else interval '1 year' end;
  for i in -1..2 loop
    v_anchor := (v_today + v_step * i)::date;
    v_fy := case when extract(month from v_anchor) >= 4 then extract(year from v_anchor)::int else extract(year from v_anchor)::int - 1 end;
    if t.default_recurrence = 'Monthly' then
      v_base := date_trunc('month', v_anchor)::date;
      v_period := to_char(v_anchor, 'Mon YYYY');
    elsif t.default_recurrence = 'Quarterly' then
      v_q := ((extract(month from v_anchor)::int - 4 + 12) % 12) / 3 + 1;
      v_base := (make_date(v_fy, 4, 1) + make_interval(months => v_q * 3 - 1))::date;
      v_period := 'Q' || v_q || ' FY ' || v_fy || '-' || lpad(((v_fy + 1) % 100)::text, 2, '0');
    else
      v_base := make_date(v_fy + 1, 3, 1);
      v_period := 'FY ' || v_fy || '-' || lpad(((v_fy + 1) % 100)::text, 2, '0');
    end if;
    v_stat := public.clamp_day((v_base + make_interval(months => coalesce(t.statutory_month_offset, 0)))::date, t.statutory_day);
    if v_stat >= v_today then
      return query select v_period, v_stat, least(v_stat, greatest(v_today, v_stat - coalesce(t.internal_buffer_days, 3)));
      return;
    end if;
  end loop;
  return query select null::text, null::date, (v_today + 10)::date;
end $$;
revoke execute on function public.compliance_next_due(uuid, date) from public, anon;
grant execute on function public.compliance_next_due(uuid, date) to authenticated, service_role;

create or replace function public.compliance_suggestions(p_client uuid)
returns table (task_type_id uuid, name text, category text, recurrence text, reason text, already_set_up boolean,
               next_period text, next_due date)
language plpgsql stable security invoker set search_path = public
as $$
declare
  c public.clients%rowtype;
  v_entity text;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into c from public.clients where id = p_client;
  if not found then
    raise exception 'Client not found.';
  end if;
  v_entity := public.client_entity(c.type);

  return query
  select t.id, t.name, t.category, t.default_recurrence,
         case t.applies_to
           when 'gst_monthly' then 'Has a GSTIN, files monthly'
           when 'gst_qrmp' then 'Has a GSTIN, QRMP scheme'
           when 'gst_composition' then 'Composition dealer'
           when 'gst_any' then 'Has a GSTIN'
           when 'tds' then 'Has a TAN'
           when 'company' then 'Company'
           when 'llp' then 'LLP'
           when 'individual' then 'Individual, HUF or proprietor'
           when 'audit_entity' then 'Company or LLP'
           else 'Every client'
         end,
         exists (select 1 from public.tasks x where x.client_id = c.id and x.task_type_id = t.id and x.stage <> 'Approved'),
         s.period, s.statutory_date
    from public.task_types t
    cross join lateral public.compliance_next_due(t.id, v_today) s
   where t.org_id = c.org_id and t.is_active and t.applies_to is not null
     and case t.applies_to
           when 'gst_monthly' then nullif(trim(c.gstin), '') is not null and coalesce(c.gst_scheme, 'monthly') = 'monthly'
           when 'gst_qrmp' then nullif(trim(c.gstin), '') is not null and c.gst_scheme = 'qrmp'
           when 'gst_composition' then nullif(trim(c.gstin), '') is not null and c.gst_scheme = 'composition'
           when 'gst_any' then nullif(trim(c.gstin), '') is not null and coalesce(c.gst_scheme, 'monthly') <> 'composition'
           when 'tds' then nullif(trim(c.tan), '') is not null
           when 'company' then v_entity = 'company'
           when 'llp' then v_entity = 'llp'
           when 'individual' then v_entity = 'individual'
           when 'audit_entity' then v_entity in ('company', 'llp')
           else true
         end
   order by t.category, t.name;
end $$;
revoke execute on function public.compliance_suggestions(uuid) from public, anon;
grant execute on function public.compliance_suggestions(uuid) to authenticated;

-- Creates the next due task of each chosen return; each repeats from then on like any recurring task
create or replace function public.apply_compliance_plan(p_client uuid, p_type_ids uuid[], p_assignee uuid, p_reviewer uuid default null)
returns int
language plpgsql security invoker set search_path = public
as $$
declare
  c public.clients%rowtype;
  t public.task_types%rowtype;
  s record;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_count int := 0;
begin
  select * into c from public.clients where id = p_client;
  if not found then
    raise exception 'Client not found.';
  end if;
  if p_assignee is null then
    raise exception 'Choose who will do the work.';
  end if;

  for t in select * from public.task_types where id = any(p_type_ids) and org_id = c.org_id and is_active loop
    continue when exists (select 1 from public.tasks x where x.client_id = c.id and x.task_type_id = t.id and x.stage <> 'Approved');
    select * into s from public.compliance_next_due(t.id, v_today);
    insert into public.tasks (org_id, client_id, task_type_id, title, category, recurrence, period, official_due_date, due_date,
                              assigned_to, reviewer_id, stage, status, priority, estimated_minutes)
    values (c.org_id, c.id, t.id, t.name, t.category, coalesce(t.default_recurrence, 'None'), s.period, s.statutory_date,
            coalesce(s.internal_date, v_today + 7), p_assignee, p_reviewer, 'Assigned', 'Pending', 'Medium', t.default_estimate_minutes);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke execute on function public.apply_compliance_plan(uuid, uuid[], uuid, uuid) from public, anon;
grant execute on function public.apply_compliance_plan(uuid, uuid[], uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- 4. Due date extensions
create or replace function public.extend_statutory_due_date(p_type uuid, p_period text, p_new_date date, p_note text default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_count int;
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can extend due dates.';
  end if;
  if p_new_date is null then
    raise exception 'Choose the new due date.';
  end if;
  select name into v_name from public.task_types where id = p_type and org_id = v_org;
  if v_name is null then
    raise exception 'Task type not found.';
  end if;

  -- The internal deadline moves by as many days as the statutory one
  update public.tasks t
     set due_date = case when t.official_due_date is not null and t.due_date is not null
                         then least(p_new_date, t.due_date + (p_new_date - t.official_due_date))
                         else t.due_date end,
         official_due_date = p_new_date
   where t.org_id = v_org and t.task_type_id = p_type and t.stage <> 'Approved'
     and coalesce(t.period, '') = coalesce(trim(p_period), '')
     and t.official_due_date is distinct from p_new_date;
  get diagnostics v_count = row_count;

  insert into public.audit_logs (org_id, user_id, entity, action, metadata)
  values (v_org, auth.uid(), 'TASKS', 'EXTEND_DUE_DATE',
          jsonb_build_object('task_type', v_name, 'period', p_period, 'new_date', p_new_date, 'tasks', v_count, 'note', p_note));
  return v_count;
end $$;
revoke execute on function public.extend_statutory_due_date(uuid, text, date, text) from public, anon;
grant execute on function public.extend_statutory_due_date(uuid, text, date, text) to authenticated;

-- ---------------------------------------------------------------- 5. Task checklists
create table if not exists public.task_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.default_org_id() references public.organizations(id) on delete cascade,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  label       text not null check (length(trim(label)) between 1 and 200),
  kind        text not null default 'document' check (kind in ('document', 'step')),
  status      text not null default 'pending' check (status in ('pending', 'received', 'not_needed')),
  sort_order  int not null default 0,
  document_id uuid references public.documents(id) on delete set null,
  updated_by  uuid,
  updated_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists task_checklist_items_task_idx on public.task_checklist_items (task_id, sort_order);

create or replace function public.task_checklist_items_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  select org_id into new.org_id from public.tasks where id = new.task_id;
  if new.org_id is null then
    raise exception 'Task not found.';
  end if;
  new.label := trim(new.label);
  if tg_op = 'UPDATE' then
    new.task_id := old.task_id;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists task_checklist_items_before_write on public.task_checklist_items;
create trigger task_checklist_items_before_write before insert or update on public.task_checklist_items
  for each row execute function public.task_checklist_items_before_write();
revoke execute on function public.task_checklist_items_before_write() from public, anon, authenticated;

alter table public.task_checklist_items enable row level security;
revoke all on public.task_checklist_items from anon;
grant select, insert, update, delete on public.task_checklist_items to authenticated;
grant all on public.task_checklist_items to service_role;

drop policy if exists org_isolation on public.task_checklist_items;
create policy org_isolation on public.task_checklist_items as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));
drop policy if exists task_checklist_items_access on public.task_checklist_items;
create policy task_checklist_items_access on public.task_checklist_items for all to authenticated
  using ((select public.is_active_user()) and exists (select 1 from public.tasks t where t.id = task_id))
  with check ((select public.is_active_user()) and exists (select 1 from public.tasks t where t.id = task_id));

-- A new task starts with its type's checklist
create or replace function public.tasks_seed_checklist()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.task_type_id is not null then
    insert into public.task_checklist_items (org_id, task_id, label, sort_order)
    select new.org_id, new.id, trim(x.value), x.ord
      from public.task_types tt
     cross join lateral jsonb_array_elements_text(tt.checklist) with ordinality as x(value, ord)
     where tt.id = new.task_type_id and length(trim(x.value)) > 0;
  end if;
  return null;
end $$;
drop trigger if exists tasks_seed_checklist on public.tasks;
create trigger tasks_seed_checklist after insert on public.tasks
  for each row when (coalesce(current_setting('app.bulk_move', true), 'off') <> 'on')
  execute function public.tasks_seed_checklist();
revoke execute on function public.tasks_seed_checklist() from public, anon, authenticated;

-- ---------------------------------------------------------------- 6. Email attachments (B-22)
alter table public.email_attachments add column if not exists bucket text;
alter table public.email_attachments add column if not exists storage_path text;
alter table public.email_attachments add column if not exists mime_type text;
alter table public.email_attachments add column if not exists size_bytes bigint;
alter table public.email_attachments add column if not exists document_id uuid references public.documents(id) on delete set null;
alter table public.email_attachments add column if not exists created_at timestamptz not null default now();
create index if not exists email_attachments_message_idx on public.email_attachments (message_id);

commit;

-- Verification (one statement):
--
-- select
--   (select count(*) from information_schema.columns where (table_name, column_name) in
--     (('clients', 'tan'), ('clients', 'gst_scheme'), ('task_types', 'applies_to'), ('task_types', 'checklist'),
--      ('email_attachments', 'storage_path'), ('email_attachments', 'document_id'))) as new_columns,
--   (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
--     ('install_compliance_library', 'compliance_suggestions', 'apply_compliance_plan', 'extend_statutory_due_date', 'client_entity', 'compliance_next_due')) as new_functions,
--   (select count(*) from information_schema.tables where table_name = 'task_checklist_items') as checklist_table,
--   (select count(*) from pg_trigger where tgname = 'tasks_seed_checklist') as seed_trigger;
--
-- Expected: 6, 6, 1, 1.
