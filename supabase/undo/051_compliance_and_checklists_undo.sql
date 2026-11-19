-- Undo for 051_compliance_and_checklists.sql. Run after the undo files for 054 to 052.
-- Removes compliance setup and checklists. Deletes every checklist item, the TAN and GST scheme on clients,
-- who each task type applies to and its checklist, and the storage details of saved email attachments
-- (the files themselves stay in storage and in client documents).

begin;

drop trigger if exists tasks_seed_checklist on public.tasks;
drop function if exists public.tasks_seed_checklist();
drop table if exists public.task_checklist_items;
drop function if exists public.task_checklist_items_before_write();
drop function if exists public.extend_statutory_due_date(uuid, text, date, text);
drop function if exists public.apply_compliance_plan(uuid, uuid[], uuid, uuid);
drop function if exists public.compliance_suggestions(uuid);
drop function if exists public.compliance_next_due(uuid, date);
drop function if exists public.install_compliance_library();
drop function if exists public.client_entity(text);
alter table public.task_types drop constraint if exists task_types_checklist_check;
alter table public.task_types drop constraint if exists task_types_applies_to_check;
alter table public.task_types drop column if exists checklist;
alter table public.task_types drop column if exists applies_to;
alter table public.clients drop constraint if exists clients_gst_scheme_check;
alter table public.clients drop constraint if exists clients_tan_check;
alter table public.clients drop column if exists gst_scheme;
alter table public.clients drop column if exists tan;
drop index if exists public.email_attachments_message_idx;
alter table public.email_attachments drop column if exists document_id;
alter table public.email_attachments drop column if exists size_bytes;
alter table public.email_attachments drop column if exists mime_type;
alter table public.email_attachments drop column if exists storage_path;
alter table public.email_attachments drop column if exists bucket;
alter table public.email_attachments drop column if exists created_at;

commit;
