-- Two-firm isolation checks. Each line prints "ok ..." or the run stops at the first failure.
-- Needs 00_supabase_stubs.sql, the schema dump and 01_two_firms.sql loaded first.
\set ON_ERROR_STOP on
\set A '''a0000000-0000-0000-0000-00000000000a'''
\set B '''b0000000-0000-0000-0000-00000000000b'''
\set A_ADMIN '''a0000000-0000-0000-0000-0000000000a1'''
\set A_STAFF '''a0000000-0000-0000-0000-0000000000a2'''
\set B_ADMIN '''b0000000-0000-0000-0000-0000000000b1'''

drop schema if exists t cascade;
create schema t;
grant usage on schema t to anon, authenticated;
create function t.ok(p_name text, p_ok boolean) returns text language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAILED: %', p_name; end if;
  return 'ok   ' || p_name;
end $$;
create function t.as_user(p uuid) returns text language sql as $$ select set_config('test.uid', coalesce(p::text, ''), false) $$;
grant execute on all functions in schema t to anon, authenticated;

-- Every firm table, as a list the checks below loop over
create table t.firm_tables as
select c.relname as name, c.relrowsecurity as rls
from pg_class c
join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r';
grant select on t.firm_tables to anon, authenticated;

-- How many rows firm B really has in each table (as the database owner, so nothing is hidden)
create table t.b_rows (name text primary key, n bigint);
do $$
declare r record; v bigint;
begin
  for r in select name from t.firm_tables loop
    execute format('select count(*) from public.%I where org_id = %L', r.name, 'b0000000-0000-0000-0000-00000000000b') into v;
    insert into t.b_rows values (r.name, v);
  end loop;
end $$;
grant select on t.b_rows to anon, authenticated;

-- ===== Structure
select t.ok('S1 every firm table has row-level security on',
  not exists (select 1 from t.firm_tables where not rls));
-- Exceptions: tables nobody can read from the app (no policies at all), and the two per-person tables
-- (memberships, user_active_org), which R1-R4 below still check row by row.
select t.ok('S2 every other firm table has a RESTRICTIVE org_isolation policy: ' || coalesce((
    select string_agg(ft.name, ', ') from t.firm_tables ft
    where ft.name not in ('memberships', 'user_active_org')
      and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = ft.name)
      and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = ft.name
                        and p.policyname = 'org_isolation' and p.permissive = 'RESTRICTIVE')), ''),
  not exists (
    select 1 from t.firm_tables ft
    where ft.name not in ('memberships', 'user_active_org')
      and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = ft.name)
      and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = ft.name
                        and p.policyname = 'org_isolation' and p.permissive = 'RESTRICTIVE')));
select t.ok('S3 the seed gave firm B rows in at least 8 tables', (select count(*) from t.b_rows where n > 0) >= 8);

-- Reads every firm table as the current role and fails if any firm B row is visible
create function t.visible_b_rows() returns text language plpgsql as $$
declare r record; v bigint; leaks text := '';
begin
  for r in select b.name from t.b_rows b where b.n > 0 loop
    begin
      execute format('select count(*) from public.%I where org_id = %L', r.name, 'b0000000-0000-0000-0000-00000000000b') into v;
    exception when insufficient_privilege then
      v := 0;
    end;
    if v > 0 then leaks := leaks || r.name || ' (' || v || ') '; end if;
  end loop;
  return leaks;
end $$;
grant execute on function t.visible_b_rows() to anon, authenticated;

-- ===== Reads
select t.as_user(:A_ADMIN) as _ \gset
set role authenticated;
select t.ok('R1 firm A admin sees no firm B row in any table: ' || t.visible_b_rows(), t.visible_b_rows() = '');
select t.ok('R2 firm A admin still sees its own client', exists (select 1 from clients where name = 'Client of firm A'));
reset role;

select t.as_user(:A_STAFF) as _ \gset
set role authenticated;
select t.ok('R3 firm A staff sees no firm B row in any table: ' || t.visible_b_rows(), t.visible_b_rows() = '');
reset role;

select t.as_user(null) as _ \gset
set role anon;
select t.ok('R4 signed-out visitors see no firm rows: ' || t.visible_b_rows(), t.visible_b_rows() = '');
reset role;

-- ===== Writes across firms change nothing
select t.as_user(:A_ADMIN) as _ \gset
set role authenticated;
update clients set notes = 'changed by firm A' where org_id = :B;
update tasks set title = 'changed by firm A' where org_id = :B;
update invoices set notes = 'changed by firm A' where org_id = :B;
delete from leads where org_id = :B;
delete from discussions where org_id = :B;
reset role;
select t.ok('W1 firm A could not change or delete firm B rows',
  not exists (select 1 from clients where org_id = :B and notes = 'changed by firm A')
  and not exists (select 1 from tasks where org_id = :B and title = 'changed by firm A')
  and not exists (select 1 from invoices where org_id = :B and notes = 'changed by firm A')
  and (select n from t.b_rows where name = 'leads') = (select count(*) from leads where org_id = :B)
  and (select n from t.b_rows where name = 'discussions') = (select count(*) from discussions where org_id = :B));

-- Inserting a row "for" firm B lands in firm A or is refused
select t.as_user(:A_ADMIN) as _ \gset
set role authenticated;
do $$
begin
  insert into clients (org_id, name, state) values ('b0000000-0000-0000-0000-00000000000b', 'Planted by firm A', 'Delhi');
exception when others then
  null;
end $$;
reset role;
select t.ok('W2 a client "for" firm B never ends up in firm B',
  not exists (select 1 from clients where org_id = :B and name = 'Planted by firm A'));

-- Linking firm A's task to firm B's client is refused or stays in firm A
select t.as_user(:A_ADMIN) as _ \gset
set role authenticated;
do $$
begin
  insert into tasks (title, client_id, due_date, stage, assigned_to, reviewer_id)
  values ('Isolation check', 'c0000000-0000-0000-0000-00000000000b', current_date + 3, 'Assigned',
          'a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a1');
exception when others then
  null;
end $$;
reset role;
select t.ok('W3 no firm A task points at a firm B client',
  not exists (select 1 from tasks where client_id = 'c0000000-0000-0000-0000-00000000000b' and org_id = :A));

-- Assigning work to someone outside the firm is refused
select t.as_user(:A_ADMIN) as _ \gset
set role authenticated;
do $$
begin
  insert into tasks (title, client_id, due_date, stage, assigned_to, reviewer_id)
  values ('Isolation check', 'c0000000-0000-0000-0000-00000000000a', current_date + 3, 'Assigned',
          'b0000000-0000-0000-0000-0000000000b2', 'a0000000-0000-0000-0000-0000000000a1');
exception when others then
  null;
end $$;
reset role;
select t.ok('W4 firm A cannot assign a task to firm B staff',
  not exists (select 1 from tasks where org_id = :A and assigned_to = 'b0000000-0000-0000-0000-0000000000b2'));

-- ===== Totals and people
select t.as_user(:A_ADMIN) as _ \gset
set role authenticated;
select t.ok('T1 dashboard totals count only firm A invoices',
  (public.dashboard_finance(null, null) ->> 'outstanding')::numeric
  = (select coalesce(sum(total - coalesce(amount_paid, 0)), 0) from invoices where status not in ('Draft', 'Cancelled') and total - coalesce(amount_paid, 0) > 0.009));
select t.ok('T2 client balances list only firm A clients',
  not exists (select 1 from public.client_balances() where client_id = 'c0000000-0000-0000-0000-00000000000b'));
select t.ok('T3 firm A sees no firm B people', not exists (select 1 from profiles where id in ('b0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b2')));
reset role;

-- ===== Functions only the server may run
select t.ok('F1 signed-in users cannot run the billing, reminder or scheduling jobs',
  not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('generate_subscription_bills', 'run_reminders', 'next_working_day', 'expire_trials')
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))));
select t.ok('F2 no trigger function is callable by anon or signed-in users',
  not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))));

select 'all isolation checks passed' as result;
