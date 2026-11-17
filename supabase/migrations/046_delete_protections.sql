-- 046_delete_protections.sql
-- D-05: deletes that would erase a firm's records are refused, for everyone including server
-- code. Each message names what to do instead.
-- Safe to run more than once. No data is dropped or deleted.

begin;

create or replace function public.tasks_before_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from public.time_logs where task_id = old.id)
     or exists (select 1 from public.time_timers where task_id = old.id) then
    raise exception 'This task has time recorded against it, so it cannot be deleted.';
  end if;
  if exists (select 1 from public.chat_messages m
               join public.chat_channels c on c.id = m.channel_id
              where c.task_id = old.id) then
    raise exception 'This task has messages in its discussion, so it cannot be deleted.';
  end if;
  return old;
end $$;

drop trigger if exists tasks_before_delete on public.tasks;
create trigger tasks_before_delete before delete on public.tasks
  for each row execute function public.tasks_before_delete();

create or replace function public.email_accounts_before_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from public.email_messages where account_id = old.id) then
    raise exception 'This mailbox has emails in Duesk, so it cannot be removed. Disable it instead; its emails stay in your records.';
  end if;
  return old;
end $$;

drop trigger if exists email_accounts_before_delete on public.email_accounts;
create trigger email_accounts_before_delete before delete on public.email_accounts
  for each row execute function public.email_accounts_before_delete();

create or replace function public.quotations_before_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.status is distinct from 'Draft' then
    raise exception 'Only a draft quotation can be deleted. Change its status instead, so the quotation series stays complete.';
  end if;
  if exists (select 1 from public.invoices where quotation_id = old.id) then
    raise exception 'This quotation has an invoice made from it, so it cannot be deleted.';
  end if;
  return old;
end $$;

drop trigger if exists quotations_before_delete on public.quotations;
create trigger quotations_before_delete before delete on public.quotations
  for each row execute function public.quotations_before_delete();

create or replace function public.proposals_before_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.status is distinct from 'Draft' then
    raise exception 'Only a draft engagement letter can be deleted. Withdraw it instead; sent and accepted letters are permanent records.';
  end if;
  return old;
end $$;

drop trigger if exists proposals_before_delete on public.proposals;
create trigger proposals_before_delete before delete on public.proposals
  for each row execute function public.proposals_before_delete();

create or replace function public.service_packages_before_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from public.client_packages where package_id = old.id) then
    raise exception 'Clients are, or have been, on this package, so it cannot be deleted. Archive it instead.';
  end if;
  return old;
end $$;

drop trigger if exists service_packages_before_delete on public.service_packages;
create trigger service_packages_before_delete before delete on public.service_packages
  for each row execute function public.service_packages_before_delete();

-- The database itself must not remove a client's retainer when a package is deleted
do $$
begin
  if exists (select 1 from pg_constraint
              where conname = 'client_packages_package_id_fkey'
                and conrelid = 'public.client_packages'::regclass and confdeltype <> 'r') then
    alter table public.client_packages drop constraint client_packages_package_id_fkey;
    alter table public.client_packages add constraint client_packages_package_id_fkey
      foreign key (package_id) references public.service_packages(id) on delete restrict;
  end if;
end $$;

commit;

-- Verification (one statement):
--
-- select (select count(*) from pg_trigger where not tgisinternal and tgname in
--          ('tasks_before_delete', 'email_accounts_before_delete', 'quotations_before_delete',
--           'proposals_before_delete', 'service_packages_before_delete')) as delete_guards,
--        (select confdeltype from pg_constraint where conname = 'client_packages_package_id_fkey') as package_fk_rule;
--
-- Expected: delete_guards = 5, package_fk_rule = r.
