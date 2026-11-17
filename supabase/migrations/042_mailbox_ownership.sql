-- 042_mailbox_ownership.sql
-- S-02: a firm must prove it owns a mailbox address before mail sent to that address is
-- delivered to it by the incoming-email webhook. Proof is a code emailed to the address by
-- Duesk; a successful login to a server the firm typed in no longer counts.
-- Safe to run more than once. No data is dropped or deleted.

begin;

-- First run only: mailboxes whose connection was tested before this change keep receiving,
-- where no other firm has connected the same address. From here on, only an emailed code
-- confirms ownership.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'email_accounts'
                    and column_name = 'ownership_confirmed_at') then
    alter table public.email_accounts add column ownership_confirmed_at timestamptz;

    update public.email_accounts a
       set ownership_confirmed_at = a.verified_at
     where a.verified_at is not null
       and not exists (
         select 1 from public.email_accounts b
          where b.org_id <> a.org_id and lower(b.email_address) = lower(a.email_address));
  end if;
end $$;

-- Pending codes. Server only: no policies, so the browser can never read a code hash.
create table if not exists public.email_account_codes (
  account_id uuid primary key references public.email_accounts(id) on delete cascade,
  org_id     uuid not null,
  code_hash  text not null,
  expires_at timestamptz not null,
  attempts   integer not null default 0,
  sent_at    timestamptz not null default now()
);
alter table public.email_account_codes enable row level security;
revoke all on public.email_account_codes from anon, authenticated;

create or replace function public.email_accounts_guard_verified()
returns trigger
language plpgsql set search_path = public
as $$
begin
  -- Only the server may record a tested connection or a confirmed owner
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if tg_op = 'INSERT' then
      new.verified_at := null;
      new.ownership_confirmed_at := null;
    else
      if new.verified_at is not null and new.verified_at is distinct from old.verified_at then
        new.verified_at := old.verified_at;
      end if;
      new.ownership_confirmed_at := old.ownership_confirmed_at;
    end if;
  end if;

  -- A different address needs a new test (unless the server sets it in the same update) and a new code
  if tg_op = 'UPDATE' and lower(trim(new.email_address)) is distinct from lower(trim(old.email_address)) then
    if new.verified_at is not distinct from old.verified_at then
      new.verified_at := null;
    end if;
    new.ownership_confirmed_at := null;
  end if;
  return new;
end $$;

-- One confirmed owner per address. The older index on tested connections let whichever firm
-- logged in first block the real owner, so it goes.
create unique index if not exists email_accounts_confirmed_address_uidx
  on public.email_accounts (lower(email_address)) where ownership_confirmed_at is not null;
drop index if exists public.email_accounts_verified_address_uidx;

commit;

-- Verification (one statement):
--
-- select o.slug, a.email_address, a.is_active, a.verified_at is not null as connection_tested,
--        a.ownership_confirmed_at is not null as ownership_confirmed
-- from public.email_accounts a join public.organizations o on o.id = a.org_id
-- order by 1, 2;
--
-- Expected: your existing working mailboxes show ownership_confirmed = true.
-- Any row with false receives no webhook mail until an administrator confirms it in Inbox > Connected Accounts.
