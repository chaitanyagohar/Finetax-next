-- Undo for 055_branding_and_plans.sql. Run 058, 057 and 056 undo first.
-- Removes plan feature switches, firm extras, upgrade requests, photos and the firm logo.
-- Every firm then has every feature again, as before batch 11. Uploaded pictures stay in the
-- brand-assets bucket; empty it from Storage if you also want them gone.

begin;

drop trigger if exists documents_storage_limit on public.documents;
drop trigger if exists kpi_settings_plan_guard on public.kpi_settings;
drop trigger if exists leads_plan_guard on public.leads;
drop trigger if exists member_rates_plan_guard on public.member_rates;
drop trigger if exists service_packages_plan_guard on public.service_packages;
drop trigger if exists tasks_plan_guard on public.tasks;
drop trigger if exists upgrade_requests_notify on public.upgrade_requests;

drop function if exists public.documents_storage_limit();
drop function if exists public.feature_insert_guard();
drop function if exists public.tasks_plan_guard();
drop function if exists public.upgrade_requests_notify();
drop function if exists public.my_features();
drop function if exists public.require_feature(text, text);
drop function if exists public.has_feature(text);
drop function if exists public.org_has_feature(uuid, text);

drop table if exists public.upgrade_requests;
drop table if exists public.org_feature_overrides;

alter table public.plans drop column if exists features;
alter table public.plans drop column if exists max_storage_mb;
alter table public.plans drop column if exists audit_days;
alter table public.plans drop column if exists max_portal_clients;
alter table public.plans drop column if exists price_note;
alter table public.firm_settings drop column if exists logo_url;
alter table public.firm_settings drop column if exists brand_color;
alter table public.profiles drop column if exists avatar_url;

commit;
