-- Undo for 053_client_portal.sql. Run after the undo file for 054.
-- Removes the client portal. Every portal login and session is deleted, and documents forget whether
-- they were shared with or sent by the client (the documents themselves stay).

begin;

drop function if exists public.portal_housekeeping();
drop table if exists public.client_portal_tokens;
drop table if exists public.client_portal_users;
alter table public.documents drop column if exists from_client;
alter table public.documents drop column if exists shared_with_client;

commit;
