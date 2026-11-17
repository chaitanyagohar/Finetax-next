-- Two firms with the same kinds of data, for the isolation checks in 10_isolation.sql.
-- Firm A: admin + staff.  Firm B: admin + staff.  Run once, after the schema dump.
\set ON_ERROR_STOP on

insert into plans (id, name, max_users, max_clients, sort) values
  ('starter', 'Starter', 3, 200, 1), ('professional', 'Professional', 15, null, 2), ('firm', 'Firm', null, null, 3)
  on conflict do nothing;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000a1', 'admin@firm-a.test'), ('a0000000-0000-0000-0000-0000000000a2', 'staff@firm-a.test'),
  ('b0000000-0000-0000-0000-0000000000b1', 'admin@firm-b.test'), ('b0000000-0000-0000-0000-0000000000b2', 'staff@firm-b.test');
insert into organizations (id, name, slug, status, plan) values
  ('a0000000-0000-0000-0000-00000000000a', 'Firm A', 'firm-a', 'active', 'firm'),
  ('b0000000-0000-0000-0000-00000000000b', 'Firm B', 'firm-b', 'active', 'firm');
insert into profiles (id, name, email, is_active) values
  ('a0000000-0000-0000-0000-0000000000a1', 'A Admin', 'admin@firm-a.test', true), ('a0000000-0000-0000-0000-0000000000a2', 'A Staff', 'staff@firm-a.test', true),
  ('b0000000-0000-0000-0000-0000000000b1', 'B Admin', 'admin@firm-b.test', true), ('b0000000-0000-0000-0000-0000000000b2', 'B Staff', 'staff@firm-b.test', true)
  on conflict (id) do nothing;
insert into memberships (org_id, user_id, role, is_active, module_access) values
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000a1', 'admin', true, null),
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000a2', 'staff', true, '["dashboard","invoices","quotations","leads","tasks","documents","discussions","time_tracking","calendar"]'),
  ('b0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-0000000000b1', 'admin', true, null),
  ('b0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-0000000000b2', 'staff', true, '["dashboard","invoices","quotations","leads","tasks","documents","discussions","time_tracking","calendar"]');
insert into firm_settings (org_id, firm_name, gstin, invoice_prefix, quotation_prefix) values
  ('a0000000-0000-0000-0000-00000000000a', 'Firm A', '07AQMPK4640C1Z0', 'INV/{FY}/', 'QUO/{YYYY}/'),
  ('b0000000-0000-0000-0000-00000000000b', 'Firm B', '27ABCDE1234F1Z5', 'INV/{FY}/', 'QUO/{YYYY}/')
  on conflict (org_id) do update set gstin = excluded.gstin;

-- The same rows in each firm
do $$
declare
  f record;
begin
  for f in select * from (values
      ('a0000000-0000-0000-0000-00000000000a'::uuid, 'a0000000-0000-0000-0000-0000000000a1'::uuid, 'a0000000-0000-0000-0000-0000000000a2'::uuid, 'A'),
      ('b0000000-0000-0000-0000-00000000000b'::uuid, 'b0000000-0000-0000-0000-0000000000b1'::uuid, 'b0000000-0000-0000-0000-0000000000b2'::uuid, 'B')) as v(org, adm, stf, tag)
  loop
    perform set_org_context(f.org);
    perform set_config('test.uid', f.adm::text, false);
    insert into clients (id, org_id, name, state, email, phone)
      values (('c' || substr(f.org::text, 2))::uuid, f.org, 'Client of firm ' || f.tag, 'Delhi', lower(f.tag) || '@client.test', '9810000000');
    insert into task_types (org_id, name, category, default_recurrence, is_active) values (f.org, 'Isolation check', 'Other', 'None', true);
    insert into tasks (org_id, title, client_id, due_date, stage, assigned_to, reviewer_id)
      values (f.org, 'Isolation check', ('c' || substr(f.org::text, 2))::uuid, current_date + 7, 'Assigned', f.stf, f.adm);
    insert into invoices (org_id, client_id, date, items, gst_rate, status)
      values (f.org, ('c' || substr(f.org::text, 2))::uuid, current_date, '[{"description":"Fee","qty":1,"rate":1000}]', 18, 'Sent');
    insert into quotations (org_id, client_id, date, items, gst_rate, status)
      values (f.org, ('c' || substr(f.org::text, 2))::uuid, current_date, '[{"description":"Fee","qty":1,"rate":1000}]', 18, 'Draft');
    insert into leads (org_id, name, phone, status) values (f.org, 'Lead of firm ' || f.tag, '9810000001', 'New');
    insert into discussions (org_id, client_id, date, summary) values (f.org, ('c' || substr(f.org::text, 2))::uuid, current_date, 'Call with firm ' || f.tag);
    insert into time_logs (org_id, user_id, log_date, hours, description) values (f.org, f.stf, current_date, 1, 'Work for firm ' || f.tag);
    insert into notifications (org_id, user_id, type, title) values (f.org, f.stf, 'x', 'Note for firm ' || f.tag);
  end loop;
  perform set_config('test.uid', '', false);
end $$;
