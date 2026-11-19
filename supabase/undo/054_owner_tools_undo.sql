-- Undo for 054_owner_tools.sql. Run this one first.
-- Removes firm health, support access and "What's new". Deletes every support grant and update note.

begin;

drop index if exists public.task_checklist_items_open_idx;
drop index if exists public.documents_org_created_idx;
drop index if exists public.email_messages_org_received_idx;
drop index if exists public.invoices_client_date_idx;
drop index if exists public.invoices_org_date_idx;
drop function if exists public.support_diagnostics(uuid);
drop function if exists public.platform_firm_health();
drop table if exists public.platform_updates;
drop table if exists public.support_access_grants;

commit;
