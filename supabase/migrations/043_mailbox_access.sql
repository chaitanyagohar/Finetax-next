-- 043_mailbox_access.sql
-- S-12: access to a firm mailbox is granted per mailbox. Administrators can use every
-- mailbox; other members only the ones shared with them. The "Firm inbox" module
-- (id: dashboard) is still required as well.
-- Safe to run more than once. No data is dropped or deleted.

begin;

do $$
begin
  if to_regclass('public.email_account_members') is null then
    create table public.email_account_members (
      account_id uuid not null references public.email_accounts(id) on delete cascade,
      user_id    uuid not null references public.profiles(id) on delete cascade,
      org_id     uuid not null default public.default_org_id(),
      added_by   uuid default auth.uid(),
      created_at timestamptz not null default now(),
      primary key (account_id, user_id)
    );

    -- First run only: everyone who can read the inbox today keeps the mailboxes that exist today.
    -- Administrators then remove people mailbox by mailbox.
    insert into public.email_account_members (account_id, user_id, org_id, added_by)
    select a.id, m.user_id, a.org_id, null
    from public.email_accounts a
    join public.memberships m on m.org_id = a.org_id
    where m.is_active and m.role <> 'admin'
      and coalesce(m.module_access, '[]'::jsonb) ? 'dashboard';
  end if;
end $$;

create index if not exists email_account_members_user_idx on public.email_account_members (user_id);

drop trigger if exists zz_inherit_org on public.email_account_members;
create trigger zz_inherit_org before insert on public.email_account_members
  for each row execute function public.inherit_org_id('email_accounts', 'account_id');

create or replace function public.can_use_mailbox(p_account uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
      or exists (
           select 1
           from public.email_account_members m
           join public.email_accounts a on a.id = m.account_id
           where m.account_id = p_account
             and m.user_id = auth.uid()
             and a.org_id = public.current_org_id())
$$;
revoke all on function public.can_use_mailbox(uuid) from public, anon;
grant execute on function public.can_use_mailbox(uuid) to authenticated, service_role;

alter table public.email_account_members enable row level security;
revoke all on public.email_account_members from anon;
grant select, insert, delete on public.email_account_members to authenticated;
grant all on public.email_account_members to service_role;

drop policy if exists org_isolation on public.email_account_members;
create policy org_isolation on public.email_account_members as restrictive for all
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

drop policy if exists email_account_members_select on public.email_account_members;
create policy email_account_members_select on public.email_account_members for select
  using ((select public.is_admin()) or user_id = (select auth.uid()));

drop policy if exists email_account_members_insert_admin on public.email_account_members;
create policy email_account_members_insert_admin on public.email_account_members for insert
  with check ((select public.is_admin())
              and exists (select 1 from public.memberships m
                           where m.user_id = email_account_members.user_id
                             and m.org_id = email_account_members.org_id
                             and m.is_active));

drop policy if exists email_account_members_delete_admin on public.email_account_members;
create policy email_account_members_delete_admin on public.email_account_members for delete
  using ((select public.is_admin()));

-- Mailboxes, their messages and attachments are visible only to people who may use the mailbox.
-- The existing org_isolation and module-gate policies stay as they are.
drop policy if exists email_accounts_select_active on public.email_accounts;
drop policy if exists email_accounts_select_allowed on public.email_accounts;
create policy email_accounts_select_allowed on public.email_accounts for select
  using (public.can_use_mailbox(id));

drop policy if exists email_messages_select_active on public.email_messages;
drop policy if exists email_messages_select_allowed on public.email_messages;
create policy email_messages_select_allowed on public.email_messages for select
  using (public.can_use_mailbox(account_id));

drop policy if exists email_messages_update_active on public.email_messages;
drop policy if exists email_messages_update_allowed on public.email_messages;
create policy email_messages_update_allowed on public.email_messages for update
  using (public.can_use_mailbox(account_id))
  with check (public.can_use_mailbox(account_id));

drop policy if exists email_messages_insert_active on public.email_messages;
drop policy if exists email_messages_insert_allowed on public.email_messages;
create policy email_messages_insert_allowed on public.email_messages for insert
  with check (public.can_use_mailbox(account_id));

drop policy if exists baseline_active_staff on public.email_attachments;
drop policy if exists email_attachments_allowed on public.email_attachments;
create policy email_attachments_allowed on public.email_attachments for all
  using (exists (select 1 from public.email_messages m
                  where m.id = email_attachments.message_id and public.can_use_mailbox(m.account_id)))
  with check (exists (select 1 from public.email_messages m
                       where m.id = email_attachments.message_id and public.can_use_mailbox(m.account_id)));

commit;

-- Verification (one statement):
--
-- select o.slug, a.email_address, count(m.user_id) as staff_with_access,
--        string_agg(p.name, ', ' order by p.name) as staff
-- from public.email_accounts a
-- join public.organizations o on o.id = a.org_id
-- left join public.email_account_members m on m.account_id = a.id
-- left join public.profiles p on p.id = m.user_id
-- group by 1, 2 order by 1, 2;
--
-- Expected: each mailbox lists the non-admin staff who had the Firm inbox module before this
-- migration. Administrators are not listed; they can always use every mailbox.
