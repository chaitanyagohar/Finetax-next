--
-- PostgreSQL database dump
--

\restrict 1o1qCRsC6zLYfwsEkr2mqfBG2uhRnhjQm31Gzba6cl6XklXKF5ujyWuuQ1jWdSh

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: accept_proposal_online(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_proposal_online(p_id uuid, p_name text, p_designation text, p_ip text, p_ua text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  pr public.proposals%rowtype;
  v_res jsonb;
  v_client text;
  v_pkg text;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_start date;
  v_moved text := '';
  a record;
begin
  select * into pr from public.proposals where id = p_id for update;
  if not found then
    raise exception 'This engagement letter was not found.';
  end if;
  perform public.set_org_context(pr.org_id);

  if pr.status not in ('Sent', 'Viewed') then
    raise exception 'This engagement letter can no longer be accepted.';
  end if;
  if pr.expires_at is not null and pr.expires_at < v_today then
    raise exception 'This proposal has expired. Please contact us for an updated letter.';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Please enter your full name.';
  end if;

  v_start := greatest(pr.start_date, v_today);
  if v_start <> pr.start_date then
    v_moved := ' Start date moved from ' || to_char(pr.start_date, 'DD/MM/YYYY') || ' to ' || to_char(v_start, 'DD/MM/YYYY') || '.';
  end if;

  v_res := public.internal_onboard(pr.client_id, pr.package_id, v_start, pr.reviewer_id, jsonb_build_object(
    'price', pr.price, 'billing_cycle', pr.billing_cycle, 'gst_rate', pr.gst_rate, 'bill_day', pr.bill_day,
    'due_days', pr.due_days, 'late_fee_percent', pr.late_fee_percent, 'late_fee_min', pr.late_fee_min,
    'prorate_first', pr.prorate_first, 'auto_send', pr.auto_send, 'proposal_id', pr.id));

  update public.proposals
  set status = 'Accepted', accepted_at = now(), accepted_name = left(trim(p_name), 120),
      accepted_designation = nullif(left(trim(coalesce(p_designation, '')), 120), ''), accepted_method = 'online',
      accepted_ip = left(coalesce(p_ip, ''), 64), accepted_user_agent = left(coalesce(p_ua, ''), 300),
      client_package_id = (v_res ->> 'subscription_id')::uuid,
      original_start_date = case when v_start <> pr.start_date then pr.start_date else original_start_date end,
      start_date = v_start
  where id = p_id;

  select coalesce(nullif(trim(organization_name), ''), name) into v_client from public.clients where id = pr.client_id;
  select name into v_pkg from public.service_packages where id = pr.package_id;
  for a in select u as id from public.org_admin_ids(pr.org_id) u loop
    perform public.push_notification(a.id, 'proposal_accepted', 'Engagement accepted: ' || coalesce(v_client, 'Client') || ' · ' || coalesce(v_pkg, ''),
      'Accepted online by ' || trim(p_name) || '. ' || coalesce(v_res ->> 'tasks_created', '0') || ' tasks created; monthly billing is on.' || v_moved,
      '/packages?tab=proposals', 'proposal', p_id, 'important');
  end loop;

  return v_res || jsonb_build_object('start_moved_from', case when v_moved <> '' then pr.start_date end);
end $$;


--
-- Name: advance_period(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.advance_period(p text, p_recurrence text) RETURNS text
    LANGUAGE plpgsql STABLE
    AS $_$
declare
  v_months int;
  v_year int;
  v_q int;
begin
  if p is null then
    return null;
  end if;
  v_months := case p_recurrence when 'Monthly' then 1 when 'Quarterly' then 3 when 'Yearly' then 12 else 0 end;
  if v_months = 0 then
    return null;
  end if;

  if p ~ '^[A-Za-z]{3} [0-9]{4}$' then
    return to_char(to_date('01 ' || p, 'DD Mon YYYY') + make_interval(months => v_months), 'Mon YYYY');
  elsif p ~ '^FY [0-9]{4}-[0-9]{2}$' and v_months = 12 then
    v_year := substring(p from 4 for 4)::int + 1;
    return 'FY ' || v_year || '-' || lpad(((v_year + 1) % 100)::text, 2, '0');
  elsif p ~ '^Q[1-4] FY [0-9]{4}-[0-9]{2}$' and v_months = 3 then
    v_q := substring(p from 2 for 1)::int;
    v_year := substring(p from 7 for 4)::int;
    if v_q = 4 then
      v_q := 1;
      v_year := v_year + 1;
    else
      v_q := v_q + 1;
    end if;
    return 'Q' || v_q || ' FY ' || v_year || '-' || lpad(((v_year + 1) % 100)::text, 2, '0');
  end if;
  return null;
end;
$_$;


--
-- Name: allocate_document_number(text, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.allocate_document_number(p_table text, p_column text, p_prefix text, p_pad integer) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return public.allocate_document_number(public.default_org_id(), p_table, p_column, p_prefix, p_pad);
end $$;


--
-- Name: allocate_document_number(uuid, text, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.allocate_document_number(p_org uuid, p_table text, p_column text, p_prefix text, p_pad integer) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_scope text := p_table || ':' || p_prefix;
  v_seed  int := 0;
  v_next  int;
begin
  if p_org is null then
    raise exception 'Firm is missing for document numbering.';
  end if;
  if (p_table, p_column) not in (
       ('invoices', 'invoice_number'),
       ('quotations', 'quote_number'),
       ('proposals', 'number'),
       ('support_tickets', 'number')) then
    raise exception 'Invalid document type.';
  end if;

  -- First use of this prefix in this firm: continue after the firm's highest existing number
  if not exists (select 1 from public.document_counters where org_id = p_org and scope = v_scope) then
    execute format(
      'select coalesce(max((substring(%1$I from %2$s))::int), 0) from public.%3$I
        where org_id = $1 and left(%1$I, %4$s) = %5$L and substring(%1$I from %2$s) ~ ''^[0-9]+$''',
      p_column, length(p_prefix) + 1, p_table, length(p_prefix), p_prefix
    ) into v_seed using p_org;
  end if;

  insert into public.document_counters (org_id, scope, last_value)
  values (p_org, v_scope, v_seed + 1)
  on conflict (org_id, scope) do update
    set last_value = public.document_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;

  return p_prefix || lpad(v_next::text, greatest(p_pad, length(v_next::text)), '0');
end $_$;


--
-- Name: announcements_before_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.announcements_before_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.created_at := now();
  new.title := trim(coalesce(new.title, ''));
  if new.title = '' then
    raise exception 'Announcement title is required.';
  end if;
  return new;
end;
$$;


--
-- Name: announcements_fan_out(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.announcements_fan_out() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.notifications (org_id, user_id, type, title, body, link, entity, entity_id, priority, actor_id)
  select new.org_id, m.user_id, 'announcement', left(new.title, 200), left(new.body, 1000), '/', 'announcement', new.id,
         case when new.requires_ack or new.priority = 'important' then 'important' else 'normal' end,
         new.created_by
  from public.memberships m
  where m.org_id = new.org_id and m.is_active and m.user_id is distinct from new.created_by;
  return new;
end $$;


--
-- Name: audit_logs_set_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_logs_set_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new."timestamp" := now();
  return new;
end;
$$;


--
-- Name: audit_logs_stamp_actor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_logs_stamp_actor() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || jsonb_build_object('actor_name', coalesce((select name from public.profiles where id = auth.uid()), 'Unknown'));
  end if;
  return new;
end $$;


--
-- Name: auth_email_status(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_email_status(p_email text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (select jsonb_build_object(
              'exists', true,
              'user_id', u.id,
              'confirmed', u.email_confirmed_at is not null,
              'has_membership', exists (select 1 from public.memberships m where m.user_id = u.id))
       from auth.users u
      where lower(u.email) = lower(trim(p_email))
      limit 1),
    jsonb_build_object('exists', false))
$$;


--
-- Name: bump_answer_stat(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_answer_stat(p_id text, p_field text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.support_answer_stats (answer_id, shown, solved, not_solved)
  values (p_id,
          case when p_field = 'shown' then 1 else 0 end,
          case when p_field = 'solved' then 1 else 0 end,
          case when p_field = 'not_solved' then 1 else 0 end)
  on conflict (answer_id) do update
  set shown = support_answer_stats.shown + excluded.shown,
      solved = support_answer_stats.solved + excluded.solved,
      not_solved = support_answer_stats.not_solved + excluded.not_solved,
      updated_at = now();
end;
$$;


--
-- Name: can_manage_task(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_manage_task(p_task uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and t.org_id = public.current_org_id()
      and (public.is_admin() or t.reviewer_id = auth.uid() or t.assigned_by = auth.uid())
  );
$$;


--
-- Name: cancel_task_transfer(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_task_transfer(p_transfer uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  tr public.task_transfers%rowtype;
begin
  select * into tr from public.task_transfers where id = p_transfer for update;
  if not found or tr.status <> 'pending' then
    raise exception 'This request is no longer pending.';
  end if;
  if tr.requested_by is distinct from auth.uid() then
    raise exception 'Only the person who requested the transfer can withdraw it.';
  end if;
  update public.task_transfers set status = 'cancelled', decided_by = auth.uid(), decided_at = now() where id = p_transfer;
  perform public.task_audit(tr.task_id, jsonb_build_object('transfer_withdrawn', true));
end;
$$;


--
-- Name: chat_add_members(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_add_members(p_channel uuid, p_users uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.chat_channels
  where id = p_channel and kind = 'channel' and archived_at is null;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'Members can only be added to channels.';
  end if;
  if not exists (select 1 from public.chat_members where channel_id = p_channel and user_id = auth.uid()) then
    raise exception 'Only members can add people to this channel.';
  end if;
  insert into public.chat_members (org_id, channel_id, user_id)
  select v_org, p_channel, m.user_id from public.memberships m
  where m.org_id = v_org and m.is_active and m.user_id = any(coalesce(p_users, '{}'::uuid[]))
  on conflict do nothing;
end $$;


--
-- Name: chat_archive(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_archive(p_channel uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  c public.chat_channels%rowtype;
begin
  select * into c from public.chat_channels where id = p_channel and org_id = public.current_org_id();
  if not found or c.kind <> 'channel' then
    raise exception 'Only channels can be archived.';
  end if;
  if c.name = 'general' then
    raise exception '#general can''t be archived.';
  end if;
  if not (public.is_admin() or exists (
    select 1 from public.chat_members where channel_id = p_channel and user_id = auth.uid() and role = 'owner'
  )) then
    raise exception 'Only the channel owner or an administrator can archive it.';
  end if;
  update public.chat_channels set archived_at = now() where id = p_channel;
end $$;


--
-- Name: chat_can_access(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_can_access(p_channel uuid, p_user uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.chat_channels c
    join public.memberships m on m.org_id = c.org_id and m.user_id = p_user and m.is_active
    where c.id = p_channel
      and (
        (c.kind = 'channel' and not c.is_private)
        or exists (select 1 from public.chat_members cm where cm.channel_id = c.id and cm.user_id = p_user)
        or (c.kind = 'task' and exists (
              select 1 from public.tasks t
              where t.id = c.task_id
                and (m.role = 'admin' or coalesce(p_user = any(array[t.assigned_to, t.reviewer_id, t.assigned_by]), false))))
      )
  );
$$;


--
-- Name: chat_can_access_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_can_access_text(p text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return public.chat_can_access(p::uuid, auth.uid());
exception when others then
  return false;
end;
$$;


--
-- Name: chat_create_channel(text, text, boolean, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_create_channel(p_name text, p_description text, p_private boolean, p_members uuid[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v uuid;
  v_name text;
  me uuid := auth.uid();
  v_org uuid := public.current_org_id();
begin
  if v_org is null then
    raise exception 'Your account is not active.';
  end if;
  v_name := trim(both '-' from lower(regexp_replace(trim(coalesce(p_name, '')), '[^a-zA-Z0-9]+', '-', 'g')));
  if length(v_name) < 2 or length(v_name) > 40 then
    raise exception 'Channel names need 2 to 40 letters or numbers.';
  end if;
  if exists (select 1 from public.chat_channels
             where org_id = v_org and kind = 'channel' and archived_at is null and lower(name) = v_name) then
    raise exception 'A channel called #% already exists.', v_name;
  end if;

  insert into public.chat_channels (org_id, kind, name, description, is_private, created_by)
  values (v_org, 'channel', v_name, nullif(left(trim(coalesce(p_description, '')), 300), ''), coalesce(p_private, false), me)
  returning id into v;

  insert into public.chat_members (org_id, channel_id, user_id, role) values (v_org, v, me, 'owner');
  insert into public.chat_members (org_id, channel_id, user_id)
  select v_org, v, m.user_id from public.memberships m
  where m.org_id = v_org and m.is_active and m.user_id = any(coalesce(p_members, '{}'::uuid[])) and m.user_id <> me
  on conflict do nothing;
  return v;
end $$;


--
-- Name: chat_delete_message(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_delete_message(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.chat_messages
  set body = '', attachments = '[]'::jsonb, mentions = '{}', deleted_at = now()
  where id = p_id and deleted_at is null
    and org_id = public.current_org_id()
    and (sender_id = auth.uid() or public.is_admin());
  if not found then
    raise exception 'You can only delete your own messages.';
  end if;
end $$;


--
-- Name: chat_edit_message(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_edit_message(p_id uuid, p_body text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_body text := left(trim(coalesce(p_body, '')), 4000);
begin
  if v_body = '' then
    raise exception 'A message can''t be empty. Delete it instead.';
  end if;
  update public.chat_messages set body = v_body, edited_at = now()
  where id = p_id and sender_id = auth.uid() and deleted_at is null and org_id = public.current_org_id();
  if not found then
    raise exception 'You can only edit your own messages.';
  end if;
end $$;


--
-- Name: chat_join(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_join(p_channel uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.chat_channels
    where id = p_channel and org_id = public.current_org_id()
      and kind = 'channel' and not is_private and archived_at is null
  ) then
    raise exception 'You can''t join this channel.';
  end if;
  insert into public.chat_members (channel_id, user_id) values (p_channel, auth.uid()) on conflict do nothing;
end $$;


--
-- Name: chat_leave(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_leave(p_channel uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if exists (select 1 from public.chat_channels where id = p_channel and kind = 'dm') then
    raise exception 'You can''t leave a direct message.';
  end if;
  delete from public.chat_members where channel_id = p_channel and user_id = auth.uid();
end;
$$;


--
-- Name: chat_mark_read(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_mark_read(p_channel uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  c public.chat_channels%rowtype;
begin
  if not public.chat_can_access(p_channel, auth.uid()) then
    return;
  end if;
  select * into c from public.chat_channels where id = p_channel;
  if c.kind = 'task' then
    insert into public.chat_members (channel_id, user_id, last_read_at) values (p_channel, auth.uid(), now())
    on conflict (channel_id, user_id) do update set last_read_at = now();
  else
    update public.chat_members set last_read_at = now() where channel_id = p_channel and user_id = auth.uid();
  end if;
  update public.notifications set read_at = now()
  where user_id = auth.uid() and entity_id = p_channel and type in ('chat_dm', 'chat_task', 'chat_mention') and read_at is null;
end;
$$;


--
-- Name: chat_messages_after_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_messages_after_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  c public.chat_channels%rowtype;
  t public.tasks%rowtype;
  v_sender text;
  v_where text;
  v_link text;
  v_type text;
  u uuid;
begin
  perform public.set_org_context(new.org_id);

  update public.chat_channels set last_message_at = new.created_at where id = new.channel_id returning * into c;

  insert into public.chat_members (org_id, channel_id, user_id, last_read_at)
  values (new.org_id, new.channel_id, new.sender_id, new.created_at)
  on conflict (channel_id, user_id) do update set last_read_at = excluded.last_read_at;

  select name into v_sender from public.profiles where id = new.sender_id;
  v_link := '/chat?c=' || new.channel_id;

  if c.kind = 'channel' then
    v_where := '#' || c.name;
  elsif c.kind = 'dm' then
    v_where := 'a direct message';
  else
    select * into t from public.tasks where id = c.task_id;
    v_where := 'the task ' || coalesce(t.title, '') || coalesce(' · ' || nullif(trim(t.period), ''), '');
    v_link := '/tasks?task=' || c.task_id;
  end if;

  foreach u in array new.mentions loop
    perform public.push_notification(u, 'chat_mention', coalesce(v_sender, 'Someone') || ' mentioned you in ' || v_where,
      left(new.body, 200), v_link, 'chat', new.channel_id, 'normal');
  end loop;

  if c.kind in ('dm', 'task') then
    v_type := case when c.kind = 'dm' then 'chat_dm' else 'chat_task' end;
    for u in
      select distinct x from (
        select m.user_id as x from public.chat_members m where c.kind = 'dm' and m.channel_id = c.id
        union all
        select unnest(array[t.assigned_to, t.reviewer_id, t.assigned_by]) where c.kind = 'task'
      ) s
      where x is not null and x <> new.sender_id
    loop
      if not (u = any(new.mentions))
         and not exists (
           select 1 from public.notifications n
           where n.user_id = u and n.entity_id = c.id and n.type = v_type and n.read_at is null
         ) then
        perform public.push_notification(u, v_type,
          case when c.kind = 'dm' then 'New message from ' || coalesce(v_sender, 'a colleague')
               else coalesce(v_sender, 'Someone') || ' wrote in ' || v_where end,
          left(new.body, 200), v_link, 'chat', c.id, 'normal');
      end if;
    end loop;
  end if;

  return new;
end $$;


--
-- Name: chat_messages_before_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_messages_before_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_archived timestamptz;
begin
  new.sender_id := auth.uid();
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;
  new.body := left(trim(coalesce(new.body, '')), 4000);
  new.attachments := coalesce(new.attachments, '[]'::jsonb);

  if new.body = '' and jsonb_array_length(new.attachments) = 0 then
    raise exception 'Write a message first.';
  end if;
  if jsonb_array_length(new.attachments) > 5 then
    raise exception 'You can attach up to 5 files per message.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(new.attachments) a
    where coalesce(a ->> 'path', '') not like new.channel_id::text || '/%'
  ) then
    raise exception 'Invalid attachment.';
  end if;

  select archived_at into v_archived from public.chat_channels where id = new.channel_id;
  if v_archived is not null then
    raise exception 'This channel is archived.';
  end if;

  -- Keep only mentions of people who can actually open this conversation
  select coalesce(array_agg(distinct u), '{}') into new.mentions
  from unnest(coalesce(new.mentions, '{}'::uuid[])) u
  where u <> new.sender_id and public.chat_can_access(new.channel_id, u);

  return new;
end;
$$;


--
-- Name: chat_open_dm(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_open_dm(p_other uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v uuid;
  me uuid := auth.uid();
  v_org uuid := public.current_org_id();
begin
  if v_org is null then
    raise exception 'Your account is not active.';
  end if;
  if p_other is null or p_other = me then
    raise exception 'Choose a colleague.';
  end if;
  if not public.is_org_member(p_other, v_org) then
    raise exception 'That person is not an active team member.';
  end if;

  select c.id into v from public.chat_channels c
  where c.org_id = v_org and c.kind = 'dm'
    and exists (select 1 from public.chat_members m where m.channel_id = c.id and m.user_id = me)
    and exists (select 1 from public.chat_members m where m.channel_id = c.id and m.user_id = p_other)
  limit 1;
  if v is not null then
    return v;
  end if;

  insert into public.chat_channels (org_id, kind, created_by) values (v_org, 'dm', me) returning id into v;
  insert into public.chat_members (org_id, channel_id, user_id) values (v_org, v, me), (v_org, v, p_other);
  return v;
end $$;


--
-- Name: chat_open_task_thread(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_open_task_thread(p_task uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v uuid;
  t public.tasks%rowtype;
  me uuid := auth.uid();
begin
  select * into t from public.tasks where id = p_task and org_id = public.current_org_id();
  if not found then
    raise exception 'Task not found.';
  end if;
  if not (public.is_admin() or coalesce(me = any(array[t.assigned_to, t.reviewer_id, t.assigned_by]), false)) then
    raise exception 'You don''t have access to this task.';
  end if;

  insert into public.chat_channels (org_id, kind, task_id, created_by)
  values (t.org_id, 'task', p_task, me)
  on conflict (task_id) do nothing;
  select id into v from public.chat_channels where task_id = p_task;

  insert into public.chat_members (org_id, channel_id, user_id)
  select t.org_id, v, x from (select distinct x from unnest(array[me, t.assigned_to, t.reviewer_id]) x where x is not null) s
  on conflict do nothing;
  return v;
end $$;


--
-- Name: chat_unread(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.chat_unread() RETURNS TABLE(channel_id uuid, unread integer, mentions integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select m.channel_id,
         count(msg.id) filter (where msg.sender_id is distinct from m.user_id)::int,
         count(msg.id) filter (where m.user_id = any(msg.mentions))::int
  from public.chat_members m
  join public.chat_channels c on c.id = m.channel_id and c.org_id = public.current_org_id()
  join public.chat_messages msg
    on msg.channel_id = m.channel_id and msg.created_at > m.last_read_at and msg.deleted_at is null
  where m.user_id = auth.uid()
  group by m.channel_id;
$$;


--
-- Name: clamp_day(date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clamp_day(p_month date, p_day integer) RETURNS date
    LANGUAGE sql IMMUTABLE
    AS $$
  select (date_trunc('month', p_month)::date
          + (least(p_day, extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::int) - 1))::date;
$$;


--
-- Name: client_duplicate_pairs(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_duplicate_pairs(p_limit integer DEFAULT 200) RETURNS TABLE(a_id uuid, b_id uuid, reasons text[], score integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with live as (
    select id,
      upper(nullif(trim(pan), '')) pan,
      nullif(public.norm_phone(phone), '') ph,
      nullif(lower(trim(email)), '') em,
      public.norm_party_name(name) n,
      public.norm_party_name(organization_name) o
    from public.clients
    where coalesce(status, 'Active') <> 'Merged'
  ),
  cand as (
    select a.id a_id, b.id b_id from live a join live b on a.id < b.id and a.pan = b.pan
    union select a.id, b.id from live a join live b on a.id < b.id and length(a.ph) = 10 and a.ph = b.ph
    union select a.id, b.id from live a join live b on a.id < b.id and a.em = b.em
    union select a.id, b.id from live a join live b on a.id < b.id and length(a.o) >= 3 and length(b.o) >= 3 and a.o % b.o
    union select a.id, b.id from live a join live b on a.id < b.id and length(a.n) >= 3 and length(b.n) >= 3 and a.n % b.n
  ),
  scored as (
    select c.a_id, c.b_id,
      coalesce(a.pan = b.pan, false) m_pan,
      coalesce(length(a.ph) = 10 and a.ph = b.ph, false) m_phone,
      coalesce(a.em = b.em, false) m_email,
      greatest(
        case when length(a.o) >= 3 and length(b.o) >= 3 then similarity(a.o, b.o) else 0 end,
        case when length(a.n) >= 3 and length(b.n) >= 3 then similarity(a.n, b.n) else 0 end
      ) name_sim
    from cand c join live a on a.id = c.a_id join live b on b.id = c.b_id
  )
  select s.a_id, s.b_id,
    array_remove(array[
      case when s.m_pan then 'Same PAN' end,
      case when s.m_phone then 'Same mobile' end,
      case when s.m_email then 'Same email' end,
      case when s.name_sim >= 0.6 then 'Similar name (' || round(s.name_sim * 100)::int::text || '%)' end
    ], null),
    least(100,
      (case when s.m_pan then 70 else 0 end) + (case when s.m_phone then 50 else 0 end)
      + (case when s.m_email then 50 else 0 end) + round(s.name_sim * 60)::int
    )::int
  from scored s
  where (s.m_pan or s.m_phone or s.m_email or s.name_sim >= 0.6)
    and not exists (
      select 1 from public.client_duplicate_dismissals d where d.client_a = s.a_id and d.client_b = s.b_id
    )
  order by 4 desc
  limit p_limit;
$$;


--
-- Name: client_packages_defaults(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_packages_defaults() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  p public.service_packages%rowtype;
begin
  select * into p from public.service_packages where id = new.package_id;
  new.price := coalesce(new.price, p.price, 0);
  new.billing_cycle := coalesce(nullif(new.billing_cycle, ''), p.billing_cycle, 'Monthly');
  new.gst_rate := coalesce(new.gst_rate, p.gst_rate, 18);
  new.bill_day := coalesce(new.bill_day, p.bill_day, 5);
  new.due_days := coalesce(new.due_days, p.due_days, 5);
  new.late_fee_percent := coalesce(new.late_fee_percent, p.late_fee_percent, 0);
  new.late_fee_min := coalesce(new.late_fee_min, p.late_fee_min, 0);
  new.next_period_start := coalesce(new.next_period_start, new.start_date, (now() at time zone 'Asia/Kolkata')::date);
  return new;
end;
$$;


--
-- Name: clients_before_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clients_before_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  t record;
  v_found boolean;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'client_id' and c.table_name <> 'clients'
  loop
    execute format('select exists (select 1 from public.%I where client_id = $1)', t.table_name)
      into v_found using old.id;
    if v_found then
      raise exception 'This client has linked records (%). Mark the client Inactive instead of deleting.', t.table_name;
    end if;
  end loop;
  return old;
end;
$_$;


--
-- Name: clients_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clients_before_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
declare
  v_pan_changed boolean;
  v_gst_changed boolean;
begin
  new.name := trim(coalesce(new.name, ''));
  if new.name = '' then
    raise exception 'Client name is required.';
  end if;

  new.pan := nullif(upper(trim(coalesce(new.pan, ''))), '');
  new.gstin := nullif(upper(trim(coalesce(new.gstin, ''))), '');
  new.status := coalesce(nullif(trim(coalesce(new.status, '')), ''), 'Active');

  if tg_op = 'INSERT' then
    v_pan_changed := true;
    v_gst_changed := true;
  else
    v_pan_changed := new.pan is distinct from old.pan;
    v_gst_changed := new.gstin is distinct from old.gstin;
  end if;

  if v_pan_changed and new.pan is not null and new.pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'Invalid PAN "%". Expected format: ABCDE1234F.', new.pan;
  end if;

  if v_gst_changed and new.gstin is not null and new.gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'Invalid GSTIN "%". Expected format: 07ABCDE1234F1Z5.', new.gstin;
  end if;

  if (v_pan_changed or v_gst_changed) and new.pan is not null and new.gstin is not null
     and substring(new.gstin from 3 for 10) <> new.pan then
    raise exception 'GSTIN % does not belong to PAN %.', new.gstin, new.pan;
  end if;

  -- Legacy mirror
  new."assignedTo" := new.assigned_to::text;
  return new;
end;
$_$;


--
-- Name: clients_enforce_plan(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clients_enforce_plan() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_msg text;
begin
  if coalesce(new.status, 'Active') = 'Active' and (tg_op = 'INSERT' or coalesce(old.status, 'Active') <> 'Active') then
    v_msg := public.plan_limit_message(new.org_id, 'client');
    if v_msg is not null then
      raise exception '%', v_msg;
    end if;
  end if;
  return new;
end $$;


--
-- Name: clients_guard_history_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clients_guard_history_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if exists (select 1 from public.invoices where client_id = old.id)
     or exists (select 1 from public.quotations where client_id = old.id)
     or exists (select 1 from public.client_packages where client_id = old.id)
     or exists (select 1 from public.tasks where client_id = old.id)
     or exists (select 1 from public.documents where client_id = old.id) then
    raise exception 'This client has invoices, quotations, tasks, documents or a retainer, so it can''t be deleted. Mark the client Inactive instead; their history stays intact.';
  end if;
  return old;
end $$;


--
-- Name: close_timer(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_timer(p_user uuid, p_billable boolean DEFAULT true) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  t public.time_timers%rowtype;
  v_end timestamptz;
  v_secs numeric;
  v_hours numeric;
  v_flag boolean := false;
  v_id uuid;
begin
  select * into t from public.time_timers where user_id = p_user for update;
  if not found then
    return null;
  end if;

  v_end := coalesce(t.paused_at, now());
  v_secs := extract(epoch from (v_end - t.started_at)) - coalesce(t.paused_seconds, 0);
  delete from public.time_timers where user_id = p_user;

  if v_secs < 60 then
    return null;
  end if;

  v_hours := round(v_secs / 3600.0, 2);
  if v_hours > 12 then
    v_hours := 12;
    v_flag := true;
  end if;

  perform set_config('finetax.system_write', 'on', true);
  insert into public.time_logs (org_id, user_id, client_id, task_id, description, hours, log_date, is_billable,
                                source, started_at, ended_at, needs_review)
  values (t.org_id, p_user, t.client_id, t.task_id, t.description, v_hours,
          (t.started_at at time zone 'Asia/Kolkata')::date, coalesce(p_billable, true),
          coalesce(t.source, 'timer'), t.started_at, v_end, v_flag)
  returning id into v_id;
  perform set_config('finetax.system_write', 'off', true);

  return v_id;
end $$;


--
-- Name: compute_service_schedule(uuid, text, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_service_schedule(p_type_id uuid, p_recurrence text, p_start date, p_fallback_offset integer) RETURNS TABLE(period text, statutory_date date, internal_date date)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
declare
  t public.task_types%rowtype;
  v_rec text;
  v_anchor date := p_start;
  v_base date;
  v_period text;
  v_stat date;
  v_int date;
  v_fy int;
  v_q int;
  v_try int := 0;
begin
  if p_type_id is not null then
    select * into t from public.task_types where id = p_type_id;
  end if;

  if t.id is null or t.statutory_day is null then
    return query select null::text, null::date, (p_start + coalesce(p_fallback_offset, 10))::date;
    return;
  end if;

  v_rec := coalesce(nullif(p_recurrence, ''), t.default_recurrence, 'None');

  loop
    v_try := v_try + 1;
    v_fy := case when extract(month from v_anchor) >= 4 then extract(year from v_anchor)::int else extract(year from v_anchor)::int - 1 end;

    if v_rec = 'Monthly' then
      v_base := date_trunc('month', v_anchor)::date;
      v_period := to_char(v_anchor, 'Mon YYYY');
    elsif v_rec = 'Quarterly' then
      v_q := ((extract(month from v_anchor)::int - 4 + 12) % 12) / 3 + 1;
      v_base := (make_date(v_fy, 4, 1) + make_interval(months => v_q * 3 - 1))::date;
      v_period := 'Q' || v_q || ' FY ' || v_fy || '-' || lpad(((v_fy + 1) % 100)::text, 2, '0');
    elsif v_rec = 'Yearly' then
      v_base := make_date(v_fy + 1, 3, 1);
      v_period := 'FY ' || v_fy || '-' || lpad(((v_fy + 1) % 100)::text, 2, '0');
    else
      v_base := date_trunc('month', v_anchor)::date;
      v_period := null;
    end if;

    v_stat := public.clamp_day((v_base + make_interval(months => coalesce(t.statutory_month_offset, 0)))::date, t.statutory_day);
    exit when v_stat >= p_start or v_try >= 3;

    -- That period's deadline has already passed: start with the next period
    v_anchor := case v_rec
                  when 'Quarterly' then (v_anchor + interval '3 months')::date
                  when 'Yearly' then (v_anchor + interval '1 year')::date
                  else (v_anchor + interval '1 month')::date
                end;
  end loop;

  v_int := greatest(p_start, v_stat - coalesce(t.internal_buffer_days, 3));
  return query select v_period, v_stat, least(v_int, v_stat);
end;
$$;


--
-- Name: confirm_my_day(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_my_day(p_day date DEFAULT NULL::date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date);
begin
  insert into public.user_activity_days (user_id, day, confirmed_at)
  values (auth.uid(), v_day, now())
  on conflict (user_id, day) do update set confirmed_at = now();

  update public.time_logs set needs_review = false
  where user_id = auth.uid() and log_date = v_day and needs_review;
end;
$$;


--
-- Name: convert_lead_to_client(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_lead_to_client(p_lead_id uuid, p_client_type text DEFAULT 'Individual'::text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_lead public.leads%rowtype;
  v_client_id uuid;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;

  if not found then
    raise exception 'Lead not found.';
  end if;

  if v_lead.converted_client_id is not null then
    raise exception 'This lead has already been converted to a client.';
  end if;

  insert into public.clients (
    name, organization_name, type, email, phone, assigned_to,
    service_requested, lead_source, notes, status
  )
  values (
    v_lead.name,
    nullif(coalesce(v_lead.organization_name, v_lead.company), ''),
    coalesce(nullif(p_client_type, ''), 'Individual'),
    v_lead.email,
    v_lead.phone,
    v_lead.assigned_to,
    coalesce(nullif(v_lead.service_requested, ''), v_lead."serviceRequested"),
    v_lead.source,
    'Converted from lead: ' || v_lead.name || coalesce(' — ' || nullif(v_lead.notes, ''), ''),
    'Active'
  )
  returning id into v_client_id;

  update public.leads
  set status = 'Won',
      converted_client_id = v_client_id,
      conversion_date = (now() at time zone 'Asia/Kolkata')::date
  where id = p_lead_id;

  return v_client_id;
end;
$$;


--
-- Name: convert_quotation_to_invoice(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_quotation_to_invoice(p_quotation_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  q public.quotations%rowtype;
  v_client uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_due date;
  v_inv_id uuid;
  v_inv_no text;
begin
  if not public.is_active_user() then
    raise exception 'Not allowed.';
  end if;

  select * into q from public.quotations where id = p_quotation_id for update;
  if not found then
    raise exception 'Quotation not found.';
  end if;

  if q.status = 'Converted' or exists (select 1 from public.invoices where quotation_id = q.id) then
    raise exception 'This quotation has already been converted to an invoice.';
  end if;
  if q.status = 'Rejected' then
    raise exception 'Rejected quotations cannot be invoiced.';
  end if;

  v_client := q.client_id;
  if v_client is null and q.lead_id is not null then
    select converted_client_id into v_client from public.leads where id = q.lead_id;
  end if;
  if v_client is null then
    raise exception 'This quotation is for a lead. Convert the lead to a client on the Leads page first.';
  end if;

  v_due := greatest(coalesce(q.valid_until, v_today), v_today);

  insert into public.invoices (
    client_id, quotation_id, date, issue_date, due_date, "dueDate",
    items, is_inter_state, "isInterState", gst_rate, "gstRate",
    subtotal, cgst, sgst, igst, tax, total,
    notes, organisation, status, amount_paid, "amountPaid"
  )
  values (
    v_client, q.id, v_today, v_today, v_due, v_due,
    coalesce(q.items, '[]'::jsonb), coalesce(q.is_inter_state, false), coalesce(q.is_inter_state, false),
    coalesce(q.gst_rate, 0), coalesce(q.gst_rate, 0),
    coalesce(q.subtotal, 0), coalesce(q.cgst, 0), coalesce(q.sgst, 0), coalesce(q.igst, 0),
    coalesce(q.tax, 0), coalesce(q.total, 0),
    q.notes, q.organisation, 'Draft', 0, 0
  )
  returning id, invoice_number into v_inv_id, v_inv_no;

  update public.quotations
  set status = 'Converted', client_id = v_client
  where id = q.id;

  return jsonb_build_object('id', v_inv_id, 'invoice_number', v_inv_no);
end;
$$;


--
-- Name: current_org_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_org_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (select u.org_id
       from public.user_active_org u
      where u.user_id = auth.uid()
        and u.org_id in (select public.my_org_ids())),
    (select m.org_id
       from public.memberships m
       join public.organizations o on o.id = m.org_id
      where m.user_id = auth.uid()
        and m.is_active
        and o.status in ('trial', 'active')
      order by m.joined_at, m.org_id
      limit 1)
  )
$$;


--
-- Name: decide_task_transfer(uuid, boolean, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decide_task_transfer(p_transfer uuid, p_approve boolean, p_to uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  tr public.task_transfers%rowtype;
  t public.tasks%rowtype;
  v_target uuid;
  v_target_name text;
  v_me_name text;
  v_title text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into tr from public.task_transfers where id = p_transfer for update;
  if not found then
    raise exception 'Transfer request not found.';
  end if;
  if tr.status <> 'pending' then
    raise exception 'This request has already been decided.';
  end if;
  if not public.can_manage_task(tr.task_id) then
    raise exception 'Only an administrator, the task reviewer or the person who assigned it can decide.';
  end if;

  select * into t from public.tasks where id = tr.task_id for update;
  select name into v_me_name from public.profiles where id = auth.uid();
  v_title := t.title || coalesce(' · ' || nullif(trim(t.period), ''), '');

  if not p_approve then
    update public.task_transfers
    set status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
    where id = p_transfer;
    perform public.push_notification(tr.requested_by, 'transfer_declined', 'Transfer declined: ' || v_title,
      coalesce(v_note, 'Please continue with this task.') || ' · ' || coalesce(v_me_name, ''),
      '/tasks?task=' || t.id, 'task', t.id, 'important');
    perform public.task_audit(t.id, jsonb_build_object('transfer_declined', true, 'decision_note', left(coalesce(v_note, ''), 300)));
    return;
  end if;

  if t.stage = 'Approved' then
    raise exception 'Approved tasks cannot be transferred.';
  end if;
  v_target := coalesce(p_to, tr.to_user);
  if v_target is null then
    raise exception 'Choose who the task should go to.';
  end if;
  if v_target = t.assigned_to then
    raise exception 'Choose someone other than the current assignee.';
  end if;
  if v_target = t.reviewer_id then
    raise exception 'The reviewer cannot also do the work. Choose another person or change the reviewer first.';
  end if;
  if not public.is_org_member(v_target, t.org_id) then
    raise exception 'That person is not an active team member.';
  end if;

  update public.tasks set assigned_to = v_target where id = t.id;

  update public.task_transfers
  set status = 'approved', to_user = v_target, decided_by = auth.uid(), decided_at = now(), decision_note = v_note
  where id = p_transfer;

  select name into v_target_name from public.profiles where id = v_target;
  perform public.push_notification(v_target, 'task_handover', 'Handover notes: ' || v_title,
    left(tr.handover_notes, 900), '/tasks?task=' || t.id, 'task', t.id, 'normal');
  perform public.task_audit(t.id, jsonb_build_object(
    'reassigned_to', v_target_name, 'transfer_reason', left(tr.reason, 300), 'handover', left(tr.handover_notes, 500)));
end $$;


--
-- Name: decline_proposal_online(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decline_proposal_online(p_id uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  pr public.proposals%rowtype;
  v_client text;
  a record;
begin
  select * into pr from public.proposals where id = p_id for update;
  if not found or pr.status not in ('Sent', 'Viewed') then
    raise exception 'This engagement letter can no longer be changed.';
  end if;
  perform public.set_org_context(pr.org_id);

  update public.proposals set status = 'Declined', decision_note = nullif(left(trim(coalesce(p_reason, '')), 500), '') where id = p_id;

  select coalesce(nullif(trim(organization_name), ''), name) into v_client from public.clients where id = pr.client_id;
  for a in select u as id from public.org_admin_ids(pr.org_id) u loop
    perform public.push_notification(a.id, 'proposal_declined', 'Engagement declined: ' || coalesce(v_client, 'Client'),
      coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'No reason given.'), '/packages?tab=proposals', 'proposal', p_id, 'important');
  end loop;
end $$;


--
-- Name: default_org_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.default_org_id() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v text := nullif(current_setting('app.org_id', true), '');
begin
  if v is not null then
    return v::uuid;
  end if;
  return public.current_org_id();
end $$;


--
-- Name: discussions_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.discussions_before_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_dates_changed boolean;
  v_was_completed boolean := false;
begin
  new.summary := trim(coalesce(new.summary, ''));
  if new.summary = '' then
    raise exception 'A summary is required.';
  end if;
  if new.client_id is null then
    raise exception 'Please select a client.';
  end if;
  if new.date is null then
    new.date := (now() at time zone 'Asia/Kolkata')::date;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    v_dates_changed := true;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    v_was_completed := coalesce(old.follow_up_completed, false);
    v_dates_changed := new.follow_up_date is distinct from old.follow_up_date
                    or new.date is distinct from old.date;
  end if;

  if v_dates_changed and new.follow_up_date is not null and new.follow_up_date < new.date then
    raise exception 'The follow-up date cannot be before the discussion date.';
  end if;

  if coalesce(new.follow_up_completed, false) then
    if not v_was_completed then
      new.follow_up_completed_at := now();
    end if;
  else
    new.follow_up_completed := false;
    new.follow_up_completed_at := null;
  end if;

  -- Legacy mirrors (older screens read these)
  new."clientId" := new.client_id;
  new."followUpDate" := new.follow_up_date;
  new."followUpDone" := new.follow_up_completed;
  if new.handled_by is not null then
    select name into new.staff from public.profiles where id = new.handled_by;
  end if;

  return new;
end;
$$;


--
-- Name: documents_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.documents_before_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.title := trim(coalesce(new.title, ''));
  if new.title = '' then
    raise exception 'Document title is required.';
  end if;

  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
    new.created_at := now();
  else
    new.uploaded_by := old.uploaded_by;
    new.created_at := old.created_at;
    new.storage_path := old.storage_path;
    new.bucket := old.bucket;
  end if;

  new."clientId" := new.client_id;
  new."fileName" := new.file_name;
  new."sizeBytes" := new.size_bytes;
  new."storagePath" := new.storage_path;
  return new;
end;
$$;


--
-- Name: documents_check_path(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.documents_check_path() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_top text;
  v_legacy uuid;
begin
  if new.storage_path is null then
    return new;
  end if;
  if new.bucket is not null and new.bucket not in ('firm-documents', 'documents') then
    raise exception 'Invalid storage location.';
  end if;
  if new.storage_path like '/%' or new.storage_path like '%..%' or new.storage_path like '%\%' then
    raise exception 'Invalid file path.';
  end if;

  v_top := split_part(new.storage_path, '/', 1);
  if v_top = new.org_id::text then
    return new;
  end if;
  if v_top in ('client_files', 'internal') then
    select legacy_org_id into v_legacy from public.platform_config where id;
    if v_legacy = new.org_id then
      return new;
    end if;
  elsif v_top ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    if exists (select 1 from public.clients where id::text = v_top and org_id = new.org_id) then
      return new;
    end if;
  end if;

  raise exception 'This file does not belong to your firm.';
end $_$;


--
-- Name: email_accounts_cleanup_secret(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.email_accounts_cleanup_secret() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
begin
  if old.smtp_secret_id is not null then
    begin
      delete from vault.secrets where id = old.smtp_secret_id;
    exception when others then
      null;
    end;
  end if;
  return old;
end;
$$;


--
-- Name: email_accounts_guard_verified(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.email_accounts_guard_verified() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  -- Changing the address clears the proof (unless the server sets it in the same update)
  if tg_op = 'UPDATE' and new.email_address is distinct from old.email_address
     and new.verified_at is not distinct from old.verified_at then
    new.verified_at := null;
  end if;

  -- Only the server may mark a mailbox as verified
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if tg_op = 'INSERT' then
      new.verified_at := null;
    elsif new.verified_at is not null and new.verified_at is distinct from old.verified_at then
      new.verified_at := old.verified_at;
    end if;
  end if;
  return new;
end $$;


--
-- Name: email_accounts_protect_secret(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.email_accounts_protect_secret() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
declare
  v_server_changed boolean := false;
  k text;
begin
  new.email_address := lower(trim(new.email_address));

  if tg_op = 'UPDATE' then
    foreach k in array array['smtp_host', 'smtp_port', 'smtp_user', 'imap_host', 'imap_port', 'imap_user'] loop
      if (to_jsonb(new) ->> k) is distinct from (to_jsonb(old) ->> k) then
        v_server_changed := true;
      end if;
    end loop;
  end if;

  if new.smtp_pass is not null and trim(new.smtp_pass) <> '' then
    if tg_op = 'UPDATE' and old.smtp_secret_id is not null then
      perform vault.update_secret(old.smtp_secret_id, new.smtp_pass);
      new.smtp_secret_id := old.smtp_secret_id;
    else
      new.smtp_secret_id := vault.create_secret(
        new.smtp_pass,
        'email_account_' || new.id::text,
        'Mailbox password for ' || new.email_address
      );
    end if;
  elsif tg_op = 'UPDATE' then
    if v_server_changed then
      -- A new server must never receive the old password: the firm types it again
      if old.smtp_secret_id is not null then
        delete from vault.secrets where id = old.smtp_secret_id;
      end if;
      new.smtp_secret_id := null;
    else
      new.smtp_secret_id := old.smtp_secret_id; -- cannot be changed from the browser
    end if;
  end if;

  if v_server_changed then
    new.verified_at := null; -- must pass "Test connection" again
  end if;

  new.smtp_pass := null;
  return new;
end;
$$;


--
-- Name: enforce_user_limit(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_user_limit(p_org uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_max integer;
  v_removed integer := 0;
  r record;
  a record;
begin
  select p.max_users into v_max from public.plans p join public.organizations o on o.plan = p.id where o.id = p_org;
  if v_max is null then
    return 0;
  end if;

  -- Admins first (oldest first), then the most recently active people
  for r in
    select ranked.user_id
    from (
      select mm.user_id,
             row_number() over (
               order by (mm.role = 'admin') desc,
                        case when mm.role = 'admin' then mm.joined_at end asc,
                        u.last_sign_in_at desc nulls last,
                        mm.joined_at asc
             ) as rn
      from public.memberships mm
      left join auth.users u on u.id = mm.user_id
      where mm.org_id = p_org and mm.is_active
    ) ranked
    where ranked.rn > v_max
  loop
    update public.memberships set is_active = false where org_id = p_org and user_id = r.user_id;
    v_removed := v_removed + 1;
  end loop;

  if v_removed > 0 then
    perform public.set_org_context(p_org);
    for a in select u as id from public.org_admin_ids(p_org) u loop
      perform public.push_notification(a.id, 'plan_changed', v_removed || ' team member(s) lost access',
        'Your plan allows ' || v_max || ' active users. Restore anyone after upgrading or removing someone else.',
        '/team', 'plan', null, 'important');
    end loop;
  end if;
  return v_removed;
end $$;


--
-- Name: expire_trials(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_trials() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer := 0;
  v_over boolean;
  o record;
  a record;
begin
  for o in
    select * from public.organizations
    where status in ('trial', 'expired') and trial_ends_at is not null and trial_ends_at < now() and slug <> 'oddlambda'
  loop
    update public.organizations set status = 'active', plan = 'starter', updated_at = now() where id = o.id;
    v_over := public.plan_refresh_grace(o.id);
    perform public.set_org_context(o.id);
    for a in select u as id from public.org_admin_ids(o.id) u loop
      perform public.push_notification(a.id, 'plan_changed', 'Your trial has ended: your firm is now on the free Starter plan',
        case when v_over
          then 'Starter allows 3 active users and 200 active clients. Choose who keeps access within 14 days, or upgrade.'
          else 'Starter allows 3 active users and 200 active clients. Upgrade any time for more.' end,
        '/plan', 'plan', null, 'important');
    end loop;
    v_count := v_count + 1;
  end loop;

  for o in select id from public.organizations where grace_ends_at is not null and grace_ends_at < now() loop
    perform public.enforce_user_limit(o.id);
    perform public.plan_refresh_grace(o.id);  -- clears it once within limits
  end loop;

  perform public.set_org_context(null);
  return v_count;
end $$;


--
-- Name: find_client_matches(text, text, text, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_client_matches(p_name text, p_org text, p_pan text, p_gstin text, p_phone text, p_email text, p_exclude uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, name text, organization_name text, status text, reasons text[], score integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with inp as (
    select public.norm_party_name(p_name) n, public.norm_party_name(p_org) o,
           upper(trim(coalesce(p_pan, ''))) pan, upper(trim(coalesce(p_gstin, ''))) gstin,
           public.norm_phone(p_phone) ph, lower(trim(coalesce(p_email, ''))) em
  ),
  scored as (
    select c.id, c.name, c.organization_name, c.status,
      (i.gstin <> '' and upper(coalesce(c.gstin, '')) = i.gstin) as m_gstin,
      (i.pan <> '' and upper(coalesce(c.pan, '')) = i.pan) as m_pan,
      (length(i.ph) = 10 and public.norm_phone(c.phone) = i.ph) as m_phone,
      (i.em <> '' and lower(trim(coalesce(c.email, ''))) = i.em) as m_email,
      greatest(
        case when length(i.o) >= 3 and length(public.norm_party_name(c.organization_name)) >= 3
             then similarity(public.norm_party_name(c.organization_name), i.o) else 0 end,
        case when length(i.n) >= 3 and length(public.norm_party_name(c.name)) >= 3
             then similarity(public.norm_party_name(c.name), i.n) else 0 end,
        case when length(i.o) >= 3 and length(public.norm_party_name(c.name)) >= 3
             then similarity(public.norm_party_name(c.name), i.o) else 0 end,
        case when length(i.n) >= 3 and length(public.norm_party_name(c.organization_name)) >= 3
             then similarity(public.norm_party_name(c.organization_name), i.n) else 0 end
      ) as name_sim
    from public.clients c cross join inp i
    where coalesce(c.status, 'Active') <> 'Merged' and (p_exclude is null or c.id <> p_exclude)
  )
  select id, name, organization_name, status,
    array_remove(array[
      case when m_gstin then 'Same GSTIN' end,
      case when m_pan then 'Same PAN' end,
      case when m_phone then 'Same mobile' end,
      case when m_email then 'Same email' end,
      case when name_sim >= 0.55 then 'Similar name (' || round(name_sim * 100)::int::text || '%)' end
    ], null) as reasons,
    least(100,
      (case when m_gstin then 100 else 0 end) + (case when m_pan then 70 else 0 end)
      + (case when m_phone then 50 else 0 end) + (case when m_email then 50 else 0 end)
      + round(name_sim * 60)::int
    )::int as score
  from scored
  where m_gstin or m_pan or m_phone or m_email or name_sim >= 0.55
  order by score desc
  limit 8;
$$;


--
-- Name: firm_members(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.firm_members() RETURNS TABLE(id uuid, name text, email text, phone text, designation text, role text, is_reviewer boolean, is_active boolean, module_access jsonb, joined_at timestamp with time zone, invite_pending boolean, last_sign_in_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select p.id, p.name, p.email, p.phone, coalesce(m.designation, p.designation),
         m.role, m.is_reviewer, m.is_active, m.module_access, m.joined_at,
         (u.email_confirmed_at is null) as invite_pending, u.last_sign_in_at
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.org_id = public.current_org_id()
    and public.is_admin()
  order by p.name
$$;


--
-- Name: firm_settings_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.firm_settings_before_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
begin
  new.gstin := nullif(upper(trim(coalesce(new.gstin, ''))), '');
  new.pan := nullif(upper(trim(coalesce(new.pan, ''))), '');
  new.bank_ifsc := nullif(upper(trim(coalesce(new.bank_ifsc, ''))), '');

  if new.gstin is not null and new.gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'Invalid firm GSTIN.';
  end if;
  if new.pan is not null and new.pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'Invalid firm PAN.';
  end if;
  if new.pan is not null and new.gstin is not null and substring(new.gstin from 3 for 10) <> new.pan then
    raise exception 'The firm GSTIN does not belong to the firm PAN.';
  end if;
  if new.bank_ifsc is not null and new.bank_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
    raise exception 'Invalid IFSC code.';
  end if;
  if coalesce(new.default_gst_rate, 0) < 0 or coalesce(new.default_gst_rate, 0) > 100 then
    raise exception 'Default GST rate must be between 0 and 100.';
  end if;
  if trim(coalesce(new.invoice_prefix, '')) = '' then
    raise exception 'An invoice number prefix is required.';
  end if;

  new.updated_at := now();
  return new;
end;
$_$;


--
-- Name: generate_subscription_bills(date, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_subscription_bills(p_run_date date DEFAULT NULL::date, p_org uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_today date := coalesce(p_run_date, (now() at time zone 'Asia/Kolkata')::date);
  v_firm public.firm_settings%rowtype;
  v_firm_state text;
  sub record;
  od record;
  v_client public.clients%rowtype;
  v_pkg_name text;
  v_months int;
  v_start date;
  v_full_start date;
  v_end date;
  v_bill date;
  v_full_days int;
  v_days int;
  v_amount numeric;
  v_items jsonb;
  v_fees jsonb;
  v_fee numeric;
  v_inv uuid;
  v_notes text;
  v_loops int;
  v_created jsonb := '[]'::jsonb;
  v_drafts int := 0;
  v_org_drafts jsonb := '{}'::jsonb;
  f jsonb;
  a record;
  o record;
begin
  for sub in
    select cp.* from public.client_packages cp
    join public.organizations org on org.id = cp.org_id and org.status in ('trial', 'active')
    where cp.status = 'Active' and cp.billing_enabled and cp.next_period_start is not null
      and (p_org is null or cp.org_id = p_org)
    order by cp.org_id
  loop
    perform public.set_org_context(sub.org_id);
    v_firm := null;
    select * into v_firm from public.firm_settings where org_id = sub.org_id;
    v_firm_state := nullif(substring(coalesce(v_firm.gstin, '') from 1 for 2), '');

    select * into v_client from public.clients where id = sub.client_id;
    select name into v_pkg_name from public.service_packages where id = sub.package_id;
    v_months := case sub.billing_cycle when 'Quarterly' then 3 when 'Half-Yearly' then 6 when 'Yearly' then 12 else 1 end;
    v_start := sub.next_period_start;
    v_loops := 0;

    loop
      exit when v_loops >= 3;
      v_full_start := date_trunc('month', v_start)::date;
      v_end := (v_full_start + make_interval(months => v_months) - interval '1 day')::date;
      v_bill := date_trunc('month', v_end + 1)::date + (coalesce(sub.bill_day, 5) - 1);
      exit when v_bill > v_today;

      v_full_days := v_end - v_full_start + 1;
      v_days := v_end - v_start + 1;
      v_amount := coalesce(sub.price, 0);
      if v_start > v_full_start and coalesce(sub.prorate_first, true) then
        v_amount := round(v_amount * v_days / v_full_days, 2);
      end if;

      if v_amount > 0 then
        v_items := jsonb_build_array(jsonb_build_object(
          'description', coalesce(v_pkg_name, 'Professional services') || ' - services for ' || to_char(v_start, 'DD/MM/YYYY')
            || ' to ' || to_char(v_end, 'DD/MM/YYYY')
            || case when v_start > v_full_start and coalesce(sub.prorate_first, true)
                    then ' (pro-rated ' || v_days || ' of ' || v_full_days || ' days)' else '' end,
          'qty', 1, 'rate', v_amount));

        v_fees := '[]'::jsonb;
        if coalesce(sub.late_fee_percent, 0) > 0 or coalesce(sub.late_fee_min, 0) > 0 then
          for od in
            select i.* from public.invoices i
            where i.client_package_id = sub.id and i.status in ('Sent', 'Partially Paid')
              and i.due_date < v_bill and coalesce(i.total, 0) - coalesce(i.amount_paid, 0) > 0.009
          loop
            if not exists (
              select 1 from public.late_fee_charges
              where original_invoice_id = od.id and charge_month = date_trunc('month', v_bill)::date
            ) then
              v_fee := greatest(coalesce(sub.late_fee_min, 0),
                                round((coalesce(od.total, 0) - coalesce(od.amount_paid, 0)) * coalesce(sub.late_fee_percent, 0) / 100, 2));
              v_items := v_items || jsonb_build_array(jsonb_build_object(
                'description', 'Late payment charges on ' || od.invoice_number || ' (was due ' || to_char(od.due_date, 'DD/MM/YYYY') || ')',
                'qty', 1, 'rate', v_fee));
              v_fees := v_fees || jsonb_build_array(jsonb_build_object('invoice_id', od.id, 'amount', v_fee));
            end if;
          end loop;
        end if;

        v_notes := 'Billing period: ' || to_char(v_start, 'DD/MM/YYYY') || ' to ' || to_char(v_end, 'DD/MM/YYYY') || '.'
          || E'\nPayment due by ' || to_char(v_bill + coalesce(sub.due_days, 5), 'DD/MM/YYYY') || '.'
          || case when coalesce(sub.late_fee_percent, 0) > 0
                  then E'\nLate payment charges of ' || sub.late_fee_percent || '% per month (minimum Rs. ' || coalesce(sub.late_fee_min, 0)
                       || ') apply on overdue amounts.'
                  else '' end
          || case when v_firm.bank_account_no is not null
                  then E'\n\nBank: ' || coalesce(v_firm.bank_name, '') || E'\nA/C: ' || v_firm.bank_account_no
                       || E'\nIFSC: ' || coalesce(v_firm.bank_ifsc, '') || coalesce(E'\nUPI: ' || v_firm.upi_id, '')
                  else '' end;

        insert into public.invoices (
          org_id, client_id, organisation, date, issue_date, due_date, is_inter_state, gst_rate, items, notes, status,
          client_package_id, billing_period_start, billing_period_end
        )
        values (
          sub.org_id, sub.client_id, coalesce(nullif(trim(v_client.organization_name), ''), v_client.name), v_bill, v_bill,
          v_bill + coalesce(sub.due_days, 5),
          (v_firm_state is not null and length(coalesce(v_client.gstin, '')) >= 2 and substring(v_client.gstin from 1 for 2) <> v_firm_state),
          coalesce(sub.gst_rate, 18), v_items, v_notes, 'Draft', sub.id, v_start, v_end
        )
        returning id into v_inv;

        for f in select * from jsonb_array_elements(v_fees) loop
          insert into public.late_fee_charges (org_id, original_invoice_id, charged_on_invoice_id, amount, charge_month)
          values (sub.org_id, (f ->> 'invoice_id')::uuid, v_inv, (f ->> 'amount')::numeric, date_trunc('month', v_bill)::date)
          on conflict do nothing;
        end loop;

        v_created := v_created || jsonb_build_array(jsonb_build_object('invoice_id', v_inv, 'auto_send', sub.auto_send, 'org_id', sub.org_id));
        if not sub.auto_send then
          v_drafts := v_drafts + 1;
          v_org_drafts := v_org_drafts || jsonb_build_object(
            sub.org_id::text, coalesce((v_org_drafts ->> sub.org_id::text)::int, 0) + 1);
        end if;
      end if;

      v_start := v_end + 1;
      v_loops := v_loops + 1;
    end loop;

    if v_start is distinct from sub.next_period_start then
      update public.client_packages set next_period_start = v_start, last_billed_at = now() where id = sub.id;
    end if;
  end loop;

  for o in select key as org_key, value::int as drafts from jsonb_each_text(v_org_drafts) loop
    perform public.set_org_context(o.org_key::uuid);
    for a in select u as id from public.org_admin_ids(o.org_key::uuid) u loop
      perform public.push_notification(a.id, 'billing_ready', o.drafts || ' subscription bill(s) ready to review',
        'Approve and send them from Service Packages → Billing.', '/packages?tab=billing', 'billing', null, 'important');
    end loop;
  end loop;

  perform public.set_org_context(null);
  return jsonb_build_object('created', v_created, 'drafts', v_drafts, 'run_date', v_today);
end $$;


--
-- Name: get_email_account_secret(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_email_account_secret(p_account_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
declare
  v_secret text;
begin
  select ds.decrypted_secret into v_secret
  from public.email_accounts a
  join vault.decrypted_secrets ds on ds.id = a.smtp_secret_id
  where a.id = p_account_id;
  return v_secret;
end;
$$;


--
-- Name: has_module(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_module(p_module text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = public.current_org_id()
      and m.is_active
      and (
        m.role = 'admin'
        or coalesce(m.module_access, '["leads","tasks","time_tracking"]'::jsonb) ? p_module
      )
  )
$$;


--
-- Name: hit_rate_limit(text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count integer;
begin
  insert into public.rate_limits (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => greatest(p_window_seconds, 1)))
  on conflict (key) do update set
    count    = case when public.rate_limits.reset_at < now() then 1 else public.rate_limits.count + 1 end,
    reset_at = case when public.rate_limits.reset_at < now()
                    then now() + make_interval(secs => greatest(p_window_seconds, 1))
                    else public.rate_limits.reset_at end
  returning count into v_count;
  return v_count <= p_limit;
end $$;


--
-- Name: home_org_id(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.home_org_id(p_user uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (select u.org_id from public.user_active_org u
       join public.memberships m on m.org_id = u.org_id and m.user_id = u.user_id and m.is_active
      where u.user_id = p_user),
    (select m.org_id from public.memberships m
       join public.organizations o on o.id = m.org_id
      where m.user_id = p_user and m.is_active and o.status in ('trial', 'active')
      order by m.joined_at, m.org_id limit 1)
  )
$$;


--
-- Name: inherit_org_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inherit_org_id() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_fk  uuid;
  v_org uuid;
begin
  execute format('select ($1).%I', tg_argv[1]) into v_fk using new;
  if v_fk is not null then
    execute format('select org_id from public.%I where id = $1', tg_argv[0]) into v_org using v_fk;
    if v_org is not null then
      new.org_id := v_org;
    end if;
  end if;
  return new;
end $_$;


--
-- Name: internal_onboard(uuid, uuid, date, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.internal_onboard(p_client_id uuid, p_package_id uuid, p_start date, p_reviewer uuid, p_terms jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_org uuid := public.default_org_id();
  v_pkg public.service_packages%rowtype;
  v_client public.clients%rowtype;
  tt public.task_types%rowtype;
  s record;
  sch record;
  a record;
  v_sub uuid;
  v_assignee uuid;
  v_reviewer uuid;
  v_count int := 0;
  v_unassigned int := 0;
  v_unassigned_titles text[] := '{}';
  v_title text;
  v_start date := coalesce(p_start, (now() at time zone 'Asia/Kolkata')::date);
begin
  select * into v_pkg from public.service_packages where id = p_package_id and org_id = v_org;
  if not found then
    raise exception 'Package not found.';
  end if;
  if not v_pkg.is_active then
    raise exception 'This package is archived.';
  end if;
  select * into v_client from public.clients where id = p_client_id and org_id = v_org;
  if not found then
    raise exception 'Client not found.';
  end if;
  if exists (select 1 from public.client_packages
             where client_id = p_client_id and package_id = p_package_id and status = 'Active') then
    raise exception 'This client is already subscribed to this package.';
  end if;
  if p_reviewer is not null and not public.is_org_member(p_reviewer, v_org) then
    raise exception 'The reviewer is not an active team member.';
  end if;

  insert into public.client_packages (
    org_id, client_id, package_id, start_date, status, price, billing_cycle, gst_rate, bill_day, due_days,
    late_fee_percent, late_fee_min, prorate_first, auto_send, proposal_id
  )
  values (
    v_org, p_client_id, p_package_id, v_start, 'Active',
    nullif(p_terms ->> 'price', '')::numeric,
    nullif(p_terms ->> 'billing_cycle', ''),
    nullif(p_terms ->> 'gst_rate', '')::numeric,
    nullif(p_terms ->> 'bill_day', '')::int,
    nullif(p_terms ->> 'due_days', '')::int,
    nullif(p_terms ->> 'late_fee_percent', '')::numeric,
    nullif(p_terms ->> 'late_fee_min', '')::numeric,
    coalesce((p_terms ->> 'prorate_first')::boolean, v_pkg.prorate_first, true),
    coalesce((p_terms ->> 'auto_send')::boolean, false),
    nullif(p_terms ->> 'proposal_id', '')::uuid
  )
  returning id into v_sub;

  for s in select * from public.package_services
           where package_id = p_package_id and org_id = v_org
           order by days_due_offset, title loop
    tt := null;
    if s.task_type_id is not null then
      select * into tt from public.task_types where id = s.task_type_id and org_id = v_org;
    end if;
    select * into sch from public.compute_service_schedule(tt.id, s.recurrence, v_start, s.days_due_offset);

    v_title := coalesce(tt.name, s.title);
    v_assignee := coalesce(s.default_assignee_id, v_client.assigned_to);
    if v_assignee is not null and not public.is_org_member(v_assignee, v_org) then
      v_assignee := null;
    end if;
    v_reviewer := case when p_reviewer is not null and p_reviewer is distinct from v_assignee then p_reviewer else null end;
    if v_assignee is null then
      v_unassigned := v_unassigned + 1;
      v_unassigned_titles := array_append(v_unassigned_titles, v_title);
    end if;

    insert into public.tasks (
      org_id, task_type_id, title, period, client_id, organisation, category, due_date, official_due_date,
      assigned_to, reviewer_id, stage, priority, recurrence, notes
    )
    values (
      v_org, tt.id, v_title, sch.period, p_client_id, v_client.organization_name,
      coalesce(tt.category, s.category, 'Other'), sch.internal_date, sch.statutory_date,
      v_assignee, v_reviewer, 'Assigned', 'Medium',
      coalesce(nullif(s.recurrence, ''), tt.default_recurrence, 'None'),
      'Auto-generated from package: ' || v_pkg.name
    );
    v_count := v_count + 1;
  end loop;

  if v_unassigned > 0 then
    for a in select u as id from public.org_admin_ids(v_org) u loop
      perform public.push_notification(a.id, 'tasks_unassigned',
        v_unassigned || ' unassigned task(s) for ' || coalesce(nullif(trim(v_client.organization_name), ''), v_client.name),
        array_to_string(v_unassigned_titles, ', ') || '. Assign someone so the work can start.',
        '/tasks?staff=unassigned', 'task', null, 'important');
    end loop;
  end if;

  return jsonb_build_object('subscription_id', v_sub, 'tasks_created', v_count, 'unassigned', v_unassigned, 'start_date', v_start);
end $$;


--
-- Name: invoice_payments_before_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoice_payments_before_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_status text;
  v_total numeric;
  v_paid numeric;
begin
  select status, total into v_status, v_total from public.invoices where id = new.invoice_id for update;
  if not found then
    raise exception 'Invoice not found.';
  end if;
  if v_status = 'Cancelled' then
    raise exception 'Payments cannot be recorded on a cancelled invoice.';
  end if;

  select coalesce(sum(amount), 0) into v_paid from public.invoice_payments where invoice_id = new.invoice_id;
  if v_paid + new.amount > coalesce(v_total, 0) + 0.01 then
    raise exception 'This payment is more than the balance due (₹%).', round(coalesce(v_total, 0) - v_paid, 2);
  end if;

  new.recorded_by := coalesce(auth.uid(), new.recorded_by);
  new.created_at := now();
  return new;
end;
$$;


--
-- Name: invoices_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoices_before_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  e jsonb;
  v_qty numeric;
  v_rate numeric;
  v_sub numeric := 0;
  v_gst numeric;
  v_recalc boolean := false;
  v_date date;
  v_prefix text;
  v_sync boolean := coalesce(current_setting('app.payment_sync', true), 'off') = 'on';
  v_browser boolean := auth.uid() is not null;
begin
  if tg_op = 'UPDATE' then
    new.invoice_number := old.invoice_number;
    new.quotation_id := old.quotation_id;
    new.created_at := old.created_at;
    new.org_id := old.org_id;

    if not v_sync then
      new.amount_paid := old.amount_paid;
    end if;

    if old.status = 'Cancelled' and (
         new.status is distinct from old.status
      or new.items is distinct from old.items
      or new.client_id is distinct from old.client_id
      or new.gst_rate is distinct from old.gst_rate
    ) then
      raise exception 'Cancelled invoices cannot be changed.';
    end if;

    if old.status is distinct from 'Draft' and (
         new.items is distinct from old.items
      or new.gst_rate is distinct from old.gst_rate
      or new.is_inter_state is distinct from old.is_inter_state
      or new.client_id is distinct from old.client_id
      or new.date is distinct from old.date
      or new.issue_date is distinct from old.issue_date
    ) then
      raise exception 'Issued invoices cannot be edited. Cancel it and create a new invoice instead.';
    end if;

    if new.status = 'Draft' and old.status is distinct from 'Draft' then
      raise exception 'An issued invoice cannot be moved back to Draft.';
    end if;

    if new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then
      if v_browser and not public.is_admin() then
        raise exception 'Only administrators can cancel invoices.';
      end if;
      if coalesce(old.amount_paid, 0) > 0 then
        raise exception 'This invoice has recorded payments. Delete them before cancelling.';
      end if;
    end if;

    if not v_sync and new.status in ('Paid', 'Partially Paid') and new.status is distinct from old.status then
      raise exception 'Record a payment to mark this invoice as paid.';
    end if;

    v_recalc := new.items is distinct from old.items
             or new.gst_rate is distinct from old.gst_rate
             or new.is_inter_state is distinct from old.is_inter_state;
  else
    v_recalc := true;
    new.amount_paid := 0;
    new.created_at := now();
    if coalesce(new.status, '') not in ('Draft', 'Sent') then
      new.status := 'Draft';
    end if;
  end if;

  if v_recalc then
    if new.items is null or jsonb_typeof(new.items) <> 'array' or jsonb_array_length(new.items) = 0 then
      raise exception 'At least one line item is required.';
    end if;
    if jsonb_array_length(new.items) > 100 then
      raise exception 'An invoice can have at most 100 line items.';
    end if;

    for e in select value from jsonb_array_elements(new.items) loop
      if trim(coalesce(e->>'description', e->>'desc', '')) = '' then
        raise exception 'Every line item needs a description.';
      end if;
      begin
        v_qty := coalesce(nullif(e->>'qty', '')::numeric, 1);
        v_rate := coalesce(nullif(coalesce(e->>'rate', e->>'price'), '')::numeric, 0);
      exception when others then
        raise exception 'Line item quantities and rates must be numbers.';
      end;
      if v_qty <= 0 or v_rate < 0 then
        raise exception 'Line items need a quantity above zero and a rate of zero or more.';
      end if;
      v_sub := v_sub + v_qty * v_rate;
    end loop;

    v_gst := coalesce(new.gst_rate, 0);
    if v_gst < 0 or v_gst > 100 then
      raise exception 'GST rate must be between 0 and 100.';
    end if;

    new.subtotal := round(v_sub, 2);
    if coalesce(new.is_inter_state, false) then
      new.igst := round(new.subtotal * v_gst / 100, 2);
      new.cgst := 0;
      new.sgst := 0;
    else
      new.cgst := round(new.subtotal * v_gst / 200, 2);
      new.sgst := new.cgst;
      new.igst := 0;
    end if;
    new.tax := new.cgst + new.sgst + new.igst;
    new.total := new.subtotal + new.tax;
  end if;

  if v_sync and coalesce(new.status, '') <> 'Cancelled' then
    if coalesce(new.total, 0) > 0 and coalesce(new.amount_paid, 0) >= new.total - 0.01 then
      new.status := 'Paid';
    elsif coalesce(new.amount_paid, 0) > 0 then
      new.status := 'Partially Paid';
    elsif new.status in ('Paid', 'Partially Paid') then
      new.status := 'Sent';
    end if;
  end if;

  if tg_op = 'INSERT' then
    v_date := coalesce(new.date, new.issue_date, (now() at time zone 'Asia/Kolkata')::date);
    new.date := coalesce(new.date, v_date);
    new.issue_date := coalesce(new.issue_date, v_date);

    select nullif(trim(invoice_prefix), '') into v_prefix
      from public.firm_settings where org_id = new.org_id;
    v_prefix := public.resolve_doc_prefix(coalesce(v_prefix, 'INV/{FY}/'), v_date);
    new.invoice_number := public.allocate_document_number(new.org_id, 'invoices', 'invoice_number', v_prefix, 4);
  end if;

  if new.due_date is not null and new.due_date < coalesce(new.date, new.issue_date) then
    raise exception 'The due date cannot be before the invoice date.';
  end if;

  new."amountPaid" := new.amount_paid;
  new."isInterState" := new.is_inter_state;
  new."gstRate" := new.gst_rate;
  new."dueDate" := new.due_date;

  return new;
end $$;


--
-- Name: is_active_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_active_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.current_org_id() is not null
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = public.current_org_id()
      and m.is_active
      and m.role = 'admin'
  )
$$;


--
-- Name: is_org_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_org_member(p_user uuid, p_org uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.memberships
    where user_id = p_user and org_id = p_org and is_active
  )
$$;


--
-- Name: is_platform_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_platform_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;


--
-- Name: is_platform_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_platform_owner() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid() and role = 'owner')
$$;


--
-- Name: is_reviewer(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_reviewer() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = public.current_org_id()
      and m.is_active
      and (m.role in ('admin', 'reviewer') or m.is_reviewer)
  )
$$;


--
-- Name: is_support_agent(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_support_agent() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.is_platform_admin()
$$;


--
-- Name: mail_host_ok(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mail_host_ok(h text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$
  select h is null or (
    lower(h) ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    and lower(h) !~ '(^localhost$|\.local$|\.internal$|\.localhost$)'
    and h !~ '^[0-9.]+$'
  )
$_$;


--
-- Name: mark_onboarding(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_onboarding(p_patch jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if pg_column_size(coalesce(p_patch, '{}'::jsonb)) > 4000 then
    raise exception 'Onboarding data is too large.';
  end if;
  update public.memberships
  set onboarding = coalesce(onboarding, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)
  where user_id = auth.uid() and org_id = public.current_org_id();
end $$;


--
-- Name: mark_proposal_viewed(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_proposal_viewed(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.proposals set status = 'Viewed', viewed_at = now()
  where id = p_id and status = 'Sent';
end;
$$;


--
-- Name: memberships_enforce_plan(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.memberships_enforce_plan() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_msg text;
begin
  if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    v_msg := public.plan_limit_message(new.org_id, 'user');
    if v_msg is not null then
      raise exception '%', v_msg;
    end if;
  end if;
  return new;
end $$;


--
-- Name: memberships_join_general(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.memberships_join_general() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.is_active then
    insert into public.chat_members (org_id, channel_id, user_id)
    select c.org_id, c.id, new.user_id
    from public.chat_channels c
    where c.org_id = new.org_id
      and c.kind = 'channel'
      and c.name = 'general'
      and c.archived_at is null
    on conflict do nothing;
  end if;
  return new;
end $$;


--
-- Name: merge_clients(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_clients(p_keep uuid, p_remove uuid, p_fields jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_org uuid := public.current_org_id();
  r record;
  k text;
  v_count int;
  v_moved jsonb := '{}'::jsonb;
  v_remove public.clients%rowtype;
  v_set text := '';
  v_allowed text[] := array['name', 'organization_name', 'type', 'pan', 'gstin', 'email', 'phone', 'state', 'address', 'notes', 'assigned_to'];
  v_locked text[] := array['invoices', 'quotations', 'tasks'];
begin
  if not public.is_admin() then
    raise exception 'Only administrators can merge clients.';
  end if;
  if p_keep = p_remove then
    raise exception 'Choose two different clients.';
  end if;
  perform 1 from public.clients where id = p_keep and org_id = v_org for update;
  if not found then
    raise exception 'The client to keep was not found.';
  end if;
  select * into v_remove from public.clients where id = p_remove and org_id = v_org for update;
  if not found then
    raise exception 'The client to merge was not found.';
  end if;
  if coalesce(v_remove.status, '') = 'Merged' then
    raise exception 'That client has already been merged.';
  end if;

  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.column_name in ('client_id', 'clientId', 'converted_client_id')
      and c.udt_name = 'uuid'
      and c.table_name not in ('clients', 'client_duplicate_dismissals')
  loop
    if r.table_name = any(v_locked) then
      execute format('alter table public.%I disable trigger user', r.table_name);
    end if;

    execute format('update public.%I set %I = $1 where %I = $2', r.table_name, r.column_name, r.column_name)
      using p_keep, p_remove;
    get diagnostics v_count = row_count;

    if r.table_name = any(v_locked) then
      execute format('alter table public.%I enable trigger user', r.table_name);
    end if;

    if v_count > 0 then
      v_moved := v_moved || jsonb_build_object(r.table_name, coalesce((v_moved ->> r.table_name)::int, 0) + v_count);
    end if;
  end loop;

  update public.clients
  set status = 'Merged', merged_into = p_keep, merged_at = now(), gstin = null
  where id = p_remove;

  for k in select jsonb_object_keys(coalesce(p_fields, '{}'::jsonb)) loop
    if k = any(v_allowed) then
      if k = 'name' and coalesce(trim(p_fields ->> k), '') = '' then
        continue;
      end if;
      v_set := v_set || format('%I = %s, ', k,
        case
          when coalesce(p_fields ->> k, '') = '' then 'NULL'
          when k = 'assigned_to' then quote_literal(p_fields ->> k) || '::uuid'
          else quote_literal(p_fields ->> k)
        end);
    end if;
  end loop;
  if v_set <> '' then
    execute 'update public.clients set ' || left(v_set, length(v_set) - 2) || ' where id = $1' using p_keep;
  end if;

  delete from public.client_duplicate_dismissals where client_a = p_remove or client_b = p_remove;

  return jsonb_build_object('kept', p_keep, 'removed', p_remove, 'moved', v_moved);
end $_$;


--
-- Name: merge_task_types(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_task_types(p_from uuid, p_into uuid) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can merge task types.';
  end if;
  if p_from = p_into then
    raise exception 'Choose a different task type to merge into.';
  end if;
  if not exists (select 1 from public.task_types where id = p_into) then
    raise exception 'Target task type not found.';
  end if;

  update public.tasks set task_type_id = p_into where task_type_id = p_from and stage <> 'Approved';
  get diagnostics v_count = row_count;
  update public.task_types set is_active = false where id = p_from;
  return v_count;
end;
$$;


--
-- Name: my_access(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_access() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'org_id', m.org_id,
    'org_name', o.name,
    'org_slug', o.slug,
    'org_status', o.status,
    'trial_ends_at', o.trial_ends_at,
    'role', m.role,
    'is_reviewer', m.is_reviewer,
    'is_support_agent', public.is_platform_admin(),
    'module_access', m.module_access,
    'designation', m.designation,
    'is_platform_admin', public.is_platform_admin(),
    'is_platform_owner', public.is_platform_owner()
  )
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid()
    and m.org_id = public.current_org_id()
$$;


--
-- Name: my_blocked_firm(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_blocked_firm() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'org_name', o.name,
    'status', o.status,
    'trial_ends_at', o.trial_ends_at,
    'is_admin', m.role = 'admin'
  )
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid() and m.is_active
  order by (o.id = (select u.org_id from public.user_active_org u where u.user_id = auth.uid())) desc nulls last,
           m.joined_at
  limit 1
$$;


--
-- Name: my_firms(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_firms() RETURNS TABLE(org_id uuid, name text, role text, is_current boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select o.id, o.name, m.role, o.id = public.current_org_id()
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid() and m.is_active and o.status in ('trial', 'active')
  order by o.name
$$;


--
-- Name: my_onboarding(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_onboarding() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with ctx as (select public.current_org_id() as org)
  select jsonb_build_object(
    'setup_completed', coalesce((select o.setup_completed_at is not null from public.organizations o, ctx where o.id = ctx.org), false),
    'onboarding', coalesce((select m.onboarding from public.memberships m, ctx where m.org_id = ctx.org and m.user_id = auth.uid()), '{}'::jsonb),
    'progress', jsonb_build_object(
      'team',     (select count(*) > 1 from public.memberships m, ctx where m.org_id = ctx.org and m.is_active),
      'mailbox',  exists (select 1 from public.email_accounts e, ctx where e.org_id = ctx.org),
      'client',   exists (select 1 from public.clients c, ctx where c.org_id = ctx.org),
      'package',  exists (select 1 from public.service_packages s, ctx where s.org_id = ctx.org),
      'proposal', exists (select 1 from public.proposals p, ctx where p.org_id = ctx.org and p.status <> 'Draft'),
      'task',     exists (select 1 from public.tasks t, ctx where t.org_id = ctx.org),
      'time',     exists (select 1 from public.time_logs l, ctx where l.org_id = ctx.org),
      'invoice',  exists (select 1 from public.invoices i, ctx where i.org_id = ctx.org and i.invoice_number is not null)
    )
  )
$$;


--
-- Name: my_org_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_org_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select m.org_id
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid()
    and m.is_active
    and o.status in ('trial', 'active')
$$;


--
-- Name: my_plan(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_plan() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'plan', p.id, 'plan_name', p.name, 'max_users', p.max_users, 'max_clients', p.max_clients,
    'status', o.status, 'trial_ends_at', o.trial_ends_at, 'grace_ends_at', o.grace_ends_at,
    'users', (select count(*) from public.memberships m where m.org_id = o.id and m.is_active),
    'clients', (select count(*) from public.clients c where c.org_id = o.id and coalesce(c.status, 'Active') = 'Active')
  )
  from public.organizations o
  join public.plans p on p.id = o.plan
  where o.id = public.current_org_id()
$$;


--
-- Name: my_signup_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_signup_state() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'has_membership', exists (select 1 from public.memberships where user_id = auth.uid()),
    'email_confirmed', exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null)
  )
$$;


--
-- Name: next_document_number(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_document_number(p_scope text, p_seed integer DEFAULT 0) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_org  uuid := public.default_org_id();
  v_next integer;
begin
  if v_org is null then
    raise exception 'Firm is missing for document numbering.';
  end if;
  insert into public.document_counters (org_id, scope, last_value)
  values (v_org, p_scope, greatest(p_seed, 0) + 1)
  on conflict (org_id, scope) do update
    set last_value = public.document_counters.last_value + 1,
        updated_at = now()
  returning last_value into v_next;
  return v_next;
end $$;


--
-- Name: norm_party_name(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.norm_party_name(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select trim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(p, '')), '[^a-z0-9 ]', ' ', 'g'),
      '\m(m s|ms|pvt|private|ltd|limited|llp|inc|co|company|corp|corporation|the|and)\M', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;


--
-- Name: norm_phone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.norm_phone(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
$$;


--
-- Name: notifications_before_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notifications_before_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.id := old.id;
  new.user_id := old.user_id;
  new.type := old.type;
  new.title := old.title;
  new.body := old.body;
  new.link := old.link;
  new.entity := old.entity;
  new.entity_id := old.entity_id;
  new.priority := old.priority;
  new.actor_id := old.actor_id;
  new.created_at := old.created_at;
  return new;
end;
$$;


--
-- Name: notify_platform_support(text, text, text, text, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_platform_support(p_type text, p_title text, p_body text, p_link text, p_entity_id uuid, p_priority text DEFAULT 'normal'::text, p_only uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.notifications (org_id, user_id, type, title, body, link, entity, entity_id, priority, actor_id)
  select h.org, pa.user_id, p_type, left(p_title, 200), left(p_body, 1000), p_link, 'support', p_entity_id,
         coalesce(p_priority, 'normal'), auth.uid()
  from public.platform_admins pa
  cross join lateral (select public.home_org_id(pa.user_id) as org) h
  where h.org is not null
    and pa.user_id is distinct from auth.uid()
    and (p_only is null or pa.user_id = p_only);
end $$;


--
-- Name: onboard_client_package(uuid, uuid, date, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.onboard_client_package(p_client_id uuid, p_package_id uuid, p_start date, p_reviewer uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_org uuid := public.current_org_id();
begin
  if not public.is_admin() then
    raise exception 'Only administrators can onboard clients to packages.';
  end if;
  if v_org is null then
    raise exception 'Firm could not be identified.';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id and org_id = v_org) then
    raise exception 'Client not found.';
  end if;
  if not exists (select 1 from public.service_packages where id = p_package_id and org_id = v_org) then
    raise exception 'Package not found.';
  end if;
  if p_reviewer is not null and not public.is_org_member(p_reviewer, v_org) then
    raise exception 'The reviewer is not an active member of this firm.';
  end if;
  return public.internal_onboard(p_client_id, p_package_id, p_start, p_reviewer, '{}'::jsonb);
end $$;


--
-- Name: org_admin_ids(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.org_admin_ids(p_org uuid) RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select user_id from public.memberships
  where org_id = p_org and is_active and role = 'admin'
$$;


--
-- Name: organizations_normalize_plan(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.organizations_normalize_plan() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.plan is null or not exists (select 1 from public.plans where id = new.plan) then
    new.plan := 'professional';   -- e.g. new signups, which start on a Professional trial
  end if;
  if tg_op = 'UPDATE' and new.plan is distinct from old.plan then
    new.plan_changed_at := now();
  end if;
  return new;
end $$;


--
-- Name: package_schedule_preview(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.package_schedule_preview(p_package_id uuid, p_start date) RETURNS TABLE(service_id uuid, title text, period text, internal_date date, statutory_date date)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select s.id, coalesce(tt.name, s.title), sch.period, sch.internal_date, sch.statutory_date
  from public.package_services s
  left join public.task_types tt on tt.id = s.task_type_id and tt.org_id = s.org_id
  cross join lateral public.compute_service_schedule(tt.id, s.recurrence, p_start, s.days_due_offset) sch
  where s.package_id = p_package_id
    and s.org_id = public.current_org_id()
    and public.is_admin()
  order by sch.internal_date, 2;
$$;


--
-- Name: pause_timer(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pause_timer(p_since timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.time_timers
  set paused_at = greatest(started_at, least(coalesce(p_since, now()), now()))
  where user_id = auth.uid() and paused_at is null;
end;
$$;


--
-- Name: plan_limit_message(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.plan_limit_message(p_org uuid, p_kind text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_plan public.plans%rowtype;
  v_used integer;
begin
  select p.* into v_plan from public.plans p join public.organizations o on o.plan = p.id where o.id = p_org;
  if not found then
    return null;
  end if;
  if p_kind = 'user' and v_plan.max_users is not null then
    select count(*) into v_used from public.memberships where org_id = p_org and is_active;
    if v_used >= v_plan.max_users then
      return format('Your %s plan allows up to %s active users. Remove someone''s access or upgrade your plan to add more.', v_plan.name, v_plan.max_users);
    end if;
  elsif p_kind = 'client' and v_plan.max_clients is not null then
    select count(*) into v_used from public.clients where org_id = p_org and coalesce(status, 'Active') = 'Active';
    if v_used >= v_plan.max_clients then
      return format('Your %s plan allows up to %s active clients. Mark old clients inactive or upgrade your plan to add more.', v_plan.name, v_plan.max_clients);
    end if;
  end if;
  return null;
end $$;


--
-- Name: plan_refresh_grace(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.plan_refresh_grace(p_org uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_plan public.plans%rowtype;
  v_users integer;
  v_clients integer;
  v_over boolean;
begin
  select p.* into v_plan from public.plans p join public.organizations o on o.plan = p.id where o.id = p_org;
  if not found then
    return false;
  end if;
  select count(*) into v_users from public.memberships where org_id = p_org and is_active;
  select count(*) into v_clients from public.clients where org_id = p_org and coalesce(status, 'Active') = 'Active';
  v_over := (v_plan.max_users is not null and v_users > v_plan.max_users)
         or (v_plan.max_clients is not null and v_clients > v_plan.max_clients);
  update public.organizations
  set grace_ends_at = case when v_over then coalesce(grace_ends_at, now() + interval '14 days') else null end
  where id = p_org;
  return v_over;
end $$;


--
-- Name: platform_add_staff(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.platform_add_staff(p_email text, p_name text, p_role text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
declare
  v_user  uuid;
  v_org   uuid;
  v_email text := lower(trim(p_email));
begin
  if p_role not in ('owner', 'support') then
    raise exception 'Role must be owner or support.';
  end if;
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is null then
    raise exception 'No login found for %. Create it first under Authentication → Users.', v_email;
  end if;
  select id into v_org from public.organizations where slug = 'oddlambda';

  insert into public.profiles (id, name, email, role, is_active)
  values (v_user, coalesce(nullif(trim(p_name), ''), split_part(v_email, '@', 1)), v_email,
          case when p_role = 'owner' then 'admin' else 'staff' end, true)
  on conflict (id) do nothing;

  insert into public.memberships (org_id, user_id, role, module_access, is_active)
  values (v_org, v_user, case when p_role = 'owner' then 'admin' else 'staff' end, '[]'::jsonb, true)
  on conflict (org_id, user_id) do update set is_active = true, role = excluded.role;

  if not exists (select 1 from public.user_active_org where user_id = v_user) then
    insert into public.user_active_org (user_id, org_id) values (v_user, v_org);
  end if;

  insert into public.platform_admins (user_id, role) values (v_user, p_role)
  on conflict (user_id) do update set role = excluded.role;

  return 'Done: ' || v_email || ' is now a Duesk ' || p_role || '.';
end $$;


--
-- Name: platform_create_firm(text, text, uuid, text, integer, boolean, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.platform_create_firm(p_name text, p_slug text, p_admin uuid, p_status text, p_trial_days integer, p_copy_lists boolean, p_created_by uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_org      uuid;
  v_template uuid;
begin
  if p_status not in ('trial', 'active') then
    raise exception 'Status must be trial or active.';
  end if;

  insert into public.organizations (name, slug, status, plan, trial_ends_at, created_by)
  values (trim(p_name), lower(trim(p_slug)), p_status, 'standard',
          case when p_status = 'trial' then now() + make_interval(days => greatest(coalesce(p_trial_days, 14), 1)) end,
          p_created_by)
  returning id into v_org;

  select legacy_org_id into v_template from public.platform_config where id;
  perform public.platform_seed_firm(v_org, trim(p_name), v_template, coalesce(p_copy_lists, true));

  insert into public.memberships (org_id, user_id, role, is_active, invited_by)
  values (v_org, p_admin, 'admin', true, p_created_by);

  insert into public.user_active_org (user_id, org_id) values (p_admin, v_org)
  on conflict (user_id) do nothing;

  return v_org;
end $$;


--
-- Name: platform_firm_overview(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.platform_firm_overview() RETURNS TABLE(id uuid, name text, slug text, status text, plan text, created_at timestamp with time zone, trial_ends_at timestamp with time zone, members integer, active_members integer, admin_emails text, clients integer, open_tasks integer, last_active timestamp with time zone, open_tickets integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select o.id, o.name, o.slug, o.status, o.plan, o.created_at, o.trial_ends_at,
    (select count(*) from public.memberships m where m.org_id = o.id)::int,
    (select count(*) from public.memberships m where m.org_id = o.id and m.is_active)::int,
    (select string_agg(p.email, ', ') from public.memberships m join public.profiles p on p.id = m.user_id
      where m.org_id = o.id and m.role = 'admin' and m.is_active),
    (select count(*) from public.clients c where c.org_id = o.id and coalesce(c.status, 'Active') <> 'Merged')::int,
    (select count(*) from public.tasks t where t.org_id = o.id and t.stage <> 'Approved')::int,
    (select max(d.last_seen) from public.user_activity_days d where d.org_id = o.id),
    (select count(*) from public.support_tickets s where s.org_id = o.id and s.status in ('waiting', 'open'))::int
  from public.organizations o
  order by o.created_at;
$$;


--
-- Name: platform_seed_firm(uuid, text, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.platform_seed_firm(p_org uuid, p_name text, p_copy_from uuid, p_copy_lists boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.firm_settings (org_id, firm_name, invoice_prefix, quotation_prefix, default_gst_rate)
  values (p_org, p_name, 'INV/{FY}/', 'QUO/{YYYY}/', 18)
  on conflict (org_id) do nothing;

  insert into public.engagement_settings (org_id, termination_notice_days)
  values (p_org, 30)
  on conflict (org_id) do nothing;

  insert into public.kpi_settings (org_id, w_timeliness, w_quality, w_volume, w_activeness, working_days_per_week)
  values (p_org, 35, 30, 20, 15, 6)
  on conflict (org_id) do nothing;

  insert into public.reminder_settings (org_id, enabled, not_started_hours, due_soon_days, escalate_assigner, overdue_daily,
                                        statutory_alert_days, review_waiting_hours, work_start, work_end, skip_sundays)
  values (p_org, true, 24, 3, true, true, 7, 24, time '10:00', time '19:00', true)
  on conflict (org_id) do nothing;

  if not exists (select 1 from public.chat_channels where org_id = p_org and kind = 'channel' and name = 'general') then
    insert into public.chat_channels (org_id, kind, name, description, is_private)
    values (p_org, 'channel', 'general', 'Announcements and conversation for the whole firm', false);
  end if;

  -- Optional: start with the template firm's Task List and categories
  if coalesce(p_copy_lists, false) and p_copy_from is not null then
    insert into public.task_categories (org_id, name, color, sort_order, is_active)
    select p_org, name, color, sort_order, is_active
    from public.task_categories where org_id = p_copy_from and is_active
    on conflict do nothing;

    insert into public.task_types (org_id, name, category, default_recurrence, statutory_day, statutory_month_offset,
                                   internal_buffer_days, is_active, default_estimate_minutes)
    select p_org, name, category, default_recurrence, statutory_day, statutory_month_offset,
           internal_buffer_days, true, default_estimate_minutes
    from public.task_types where org_id = p_copy_from and is_active
    on conflict do nothing;
  end if;
end $$;


--
-- Name: presence_heartbeat(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.presence_heartbeat(p_active boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null or not public.is_active_user() then
    return;
  end if;

  insert into public.user_activity_days (user_id, day, first_seen, last_seen, active_minutes)
  values (auth.uid(), v_day, now(), now(), 0)
  on conflict (user_id, day) do update
  set active_minutes = public.user_activity_days.active_minutes
        + case
            when p_active and now() - public.user_activity_days.last_seen <= interval '10 minutes'
              then round(extract(epoch from (now() - public.user_activity_days.last_seen)) / 60)::int
            else 0
          end,
      last_seen = now();

  if p_active then
    update public.time_timers set last_seen_at = now() where user_id = auth.uid() and paused_at is null;
  end if;
end;
$$;


--
-- Name: profiles_guard_support_flag(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profiles_guard_support_flag() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.is_support_agent is distinct from old.is_support_agent
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only administrators can change support access.';
  end if;
  return new;
end;
$$;


--
-- Name: profiles_join_general(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profiles_join_general() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.chat_members (channel_id, user_id)
  select id, new.id from public.chat_channels where kind = 'channel' and name = 'general'
  on conflict do nothing;
  return new;
end;
$$;


--
-- Name: profiles_sync_membership(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.profiles_sync_membership() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_org uuid := coalesce(nullif(current_setting('app.org_id', true), '')::uuid, public.current_org_id());
begin
  -- Server routes have no logged-in user: use the person's only firm, if they have exactly one
  if v_org is null then
    if (select count(*) from public.memberships where user_id = new.id) = 1 then
      select org_id into v_org from public.memberships where user_id = new.id;
    else
      return new;
    end if;
  end if;

  update public.memberships set
    role             = coalesce(new.role, 'staff'),
    is_reviewer      = coalesce(new.is_reviewer, false),
    is_support_agent = coalesce(new.is_support_agent, false),
    module_access    = new.module_access,
    designation      = new.designation,
    is_active        = coalesce(new.is_active, true),
    updated_at       = now()
  where org_id = v_org and user_id = new.id;

  return new;
end $$;


--
-- Name: proposals_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.proposals_before_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
  v_fy     int;
  v_prefix text;
begin
  if tg_op = 'INSERT' then
    v_fy := case when extract(month from v_today) >= 4
                 then extract(year from v_today)::int
                 else extract(year from v_today)::int - 1 end;
    v_prefix := 'EL/' || v_fy || '-' || lpad(((v_fy + 1) % 100)::text, 2, '0') || '/';
    new.number := public.allocate_document_number(new.org_id, 'proposals', 'number', v_prefix, 3);
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    if new.services is null or new.services = '[]'::jsonb then
      select coalesce(jsonb_agg(jsonb_build_object('title', title, 'category', category, 'recurrence', recurrence,
                                                   'days_due_offset', days_due_offset)
                                order by days_due_offset, title), '[]'::jsonb)
        into new.services
      from public.package_services
      where package_id = new.package_id and org_id = new.org_id;
    end if;
  else
    new.number := old.number;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if old.status = 'Accepted' then
      raise exception 'An accepted engagement letter cannot be changed.';
    end if;
  end if;
  return new;
end $$;


--
-- Name: protect_profiles(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_profiles() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- Server routes (service role) and the SQL Editor have no logged-in user: allow
  if auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Team members can only be removed from the Team page.';
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Team members can only be created from the Team page.';
  end if;

  -- UPDATE
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'Login emails can only be changed with "Change login email" on the Team page.';
  end if;

  if public.is_admin() then
    if new.id = auth.uid() and (new.role::text <> 'admin' or coalesce(new.is_active, true) = false) then
      raise exception 'You cannot remove your own admin access or disable your own account.';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
     or new.is_reviewer is distinct from old.is_reviewer
     or new.is_active is distinct from old.is_active
     or new.module_access is distinct from old.module_access then
    raise exception 'Only administrators can change roles or access.';
  end if;

  return new;
end;
$$;


--
-- Name: push_notification(uuid, text, text, text, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.push_notification(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_entity text, p_entity_id uuid, p_priority text DEFAULT 'normal'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_org uuid := public.default_org_id();
begin
  if p_user is null or p_user = auth.uid() then
    return; -- never notify people about their own actions
  end if;
  if v_org is null or not public.is_org_member(p_user, v_org) then
    return; -- not an active member of this firm
  end if;
  insert into public.notifications
    (org_id, user_id, type, title, body, link, entity, entity_id, priority, actor_id)
  values
    (v_org, p_user, p_type, left(p_title, 200), left(p_body, 1000), p_link, p_entity, p_entity_id,
     coalesce(p_priority, 'normal'), auth.uid());
end $$;


--
-- Name: quotations_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.quotations_before_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  e jsonb;
  v_qty numeric;
  v_rate numeric;
  v_sub numeric := 0;
  v_gst numeric;
  v_recalc boolean;
  v_date date;
  v_prefix text;
begin
  if tg_op = 'UPDATE' then
    new.quote_number := old.quote_number;
    new.quotation_number := old.quotation_number;
    new.created_at := old.created_at;
    new.org_id := old.org_id;

    if old.status = 'Converted' and (
         new.items is distinct from old.items
      or new.gst_rate is distinct from old.gst_rate
      or new.is_inter_state is distinct from old.is_inter_state
      or new.client_id is distinct from old.client_id
      or new.status is distinct from old.status
    ) then
      raise exception 'This quotation has been converted to an invoice and can no longer be changed.';
    end if;

    v_recalc := new.items is distinct from old.items
             or new.gst_rate is distinct from old.gst_rate
             or new.is_inter_state is distinct from old.is_inter_state;
  else
    v_recalc := true;
  end if;

  if v_recalc then
    if new.items is null or jsonb_typeof(new.items) <> 'array' or jsonb_array_length(new.items) = 0 then
      raise exception 'At least one line item is required.';
    end if;
    if jsonb_array_length(new.items) > 100 then
      raise exception 'A quotation can have at most 100 line items.';
    end if;

    for e in select value from jsonb_array_elements(new.items) loop
      if trim(coalesce(e->>'description', e->>'desc', '')) = '' then
        raise exception 'Every line item needs a description.';
      end if;
      begin
        v_qty := coalesce(nullif(e->>'qty', '')::numeric, 1);
        v_rate := coalesce(nullif(coalesce(e->>'rate', e->>'price'), '')::numeric, 0);
      exception when others then
        raise exception 'Line item quantities and rates must be numbers.';
      end;
      if v_qty <= 0 or v_rate < 0 then
        raise exception 'Line items need a quantity above zero and a rate of zero or more.';
      end if;
      v_sub := v_sub + v_qty * v_rate;
    end loop;

    v_gst := coalesce(new.gst_rate, 0);
    if v_gst < 0 or v_gst > 100 then
      raise exception 'GST rate must be between 0 and 100.';
    end if;

    new.subtotal := round(v_sub, 2);
    if coalesce(new.is_inter_state, false) then
      new.igst := round(new.subtotal * v_gst / 100, 2);
      new.cgst := 0;
      new.sgst := 0;
    else
      new.cgst := round(new.subtotal * v_gst / 200, 2);
      new.sgst := new.cgst;
      new.igst := 0;
    end if;
    new.tax := new.cgst + new.sgst + new.igst;
    new.total := new.subtotal + new.tax;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    if coalesce(new.status, '') = '' then
      new.status := 'Draft';
    end if;
    if coalesce(new.date, '') = '' then
      new.date := ((now() at time zone 'Asia/Kolkata')::date)::text;
    end if;

    begin
      v_date := left(new.date, 10)::date;
    exception when others then
      v_date := (now() at time zone 'Asia/Kolkata')::date;
    end;

    select nullif(trim(quotation_prefix), '') into v_prefix
      from public.firm_settings where org_id = new.org_id;
    v_prefix := public.resolve_doc_prefix(coalesce(v_prefix, 'QUO/{YYYY}/'), v_date);

    new.quote_number := public.allocate_document_number(new.org_id, 'quotations', 'quote_number', v_prefix, 3);
    new.quotation_number := new.quote_number;
  end if;

  return new;
end $$;


--
-- Name: record_proposal_acceptance(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_proposal_acceptance(p_id uuid, p_name text, p_designation text DEFAULT NULL::text, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  pr public.proposals%rowtype;
  v_res jsonb;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_start date;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can record an acceptance.';
  end if;
  select * into pr from public.proposals where id = p_id and org_id = public.current_org_id() for update;
  if not found then
    raise exception 'Proposal not found.';
  end if;
  if pr.status in ('Accepted', 'Declined', 'Withdrawn') then
    raise exception 'This proposal is already %.', lower(pr.status);
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Enter the name of the person who accepted.';
  end if;

  v_start := greatest(pr.start_date, v_today);
  v_res := public.internal_onboard(pr.client_id, pr.package_id, v_start, pr.reviewer_id, jsonb_build_object(
    'price', pr.price, 'billing_cycle', pr.billing_cycle, 'gst_rate', pr.gst_rate, 'bill_day', pr.bill_day,
    'due_days', pr.due_days, 'late_fee_percent', pr.late_fee_percent, 'late_fee_min', pr.late_fee_min,
    'prorate_first', pr.prorate_first, 'auto_send', pr.auto_send, 'proposal_id', pr.id));

  update public.proposals
  set status = 'Accepted', accepted_at = now(), accepted_name = trim(p_name),
      accepted_designation = nullif(trim(coalesce(p_designation, '')), ''), accepted_method = 'recorded',
      decision_note = nullif(trim(coalesce(p_note, '')), ''), client_package_id = (v_res ->> 'subscription_id')::uuid,
      original_start_date = case when v_start <> pr.start_date then pr.start_date else original_start_date end,
      start_date = v_start
  where id = p_id;

  return v_res || jsonb_build_object('start_moved_from', case when v_start <> pr.start_date then pr.start_date end);
end $$;


--
-- Name: reminder_once(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reminder_once(p_task uuid, p_user uuid, p_kind text, p_key text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_user is null then
    return false;
  end if;
  insert into public.reminder_log (task_id, user_id, kind, period_key)
  values (p_task, p_user, p_kind, p_key)
  on conflict do nothing;
  return found;
end;
$$;


--
-- Name: rename_task_category(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rename_task_category(p_id uuid, p_new_name text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_org uuid := public.current_org_id();
  v_old text;
  v_new text := trim(coalesce(p_new_name, ''));
  v_count int := 0;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can rename categories.';
  end if;
  if v_new = '' then
    raise exception 'Category name is required.';
  end if;

  select name into v_old from public.task_categories where id = p_id and org_id = v_org for update;
  if not found then
    raise exception 'Category not found.';
  end if;
  if exists (select 1 from public.task_categories
             where org_id = v_org and lower(trim(name)) = lower(v_new) and id <> p_id) then
    raise exception 'A category named "%" already exists.', v_new;
  end if;

  update public.task_categories set name = v_new where id = p_id;
  if v_old = v_new then
    return 0;
  end if;

  alter table public.tasks disable trigger user;
  update public.tasks set category = v_new where org_id = v_org and category = v_old;
  get diagnostics v_count = row_count;
  alter table public.tasks enable trigger user;

  update public.task_types set category = v_new where org_id = v_org and category = v_old;
  update public.package_services set category = v_new where org_id = v_org and category = v_old;
  update public.compliance_events set category = v_new where org_id = v_org and category = v_old;

  return v_count;
end $$;


--
-- Name: request_task_transfer(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_task_transfer(p_task uuid, p_to uuid, p_reason text, p_handover text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  t public.tasks%rowtype;
  v_me uuid := auth.uid();
  v_me_name text;
  v_title text;
  v_id uuid;
  r record;
begin
  if not public.is_active_user() then
    raise exception 'Your account is not active.';
  end if;
  select * into t from public.tasks where id = p_task and org_id = public.current_org_id() for update;
  if not found then
    raise exception 'Task not found.';
  end if;
  if t.assigned_to is distinct from v_me then
    raise exception 'Only the person assigned to this task can request a transfer.';
  end if;
  if t.stage = 'Approved' then
    raise exception 'Approved tasks cannot be transferred.';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please give a reason for the transfer.';
  end if;
  if length(trim(coalesce(p_handover, ''))) < 10 then
    raise exception 'Please write handover notes so the next person knows exactly where things stand.';
  end if;
  if p_to is not null then
    if p_to = v_me then
      raise exception 'Suggest someone other than yourself.';
    end if;
    if p_to = t.reviewer_id then
      raise exception 'The reviewer of this task cannot also do the work (maker-checker rule).';
    end if;
    if not public.is_org_member(p_to, t.org_id) then
      raise exception 'The suggested person is not an active team member.';
    end if;
  end if;
  if exists (select 1 from public.task_transfers where task_id = p_task and status = 'pending') then
    raise exception 'A transfer request for this task is already pending.';
  end if;

  insert into public.task_transfers (org_id, task_id, from_user, to_user, requested_by, kind, status, reason, handover_notes)
  values (t.org_id, p_task, v_me, p_to, v_me, 'request', 'pending', trim(p_reason), trim(p_handover))
  returning id into v_id;

  select name into v_me_name from public.profiles where id = v_me;
  v_title := t.title || coalesce(' · ' || nullif(trim(t.period), ''), '');

  for r in
    select distinct x as id from (
      select u as x from public.org_admin_ids(t.org_id) u
      union select t.reviewer_id
      union select t.assigned_by
    ) s
    where x is not null and x <> v_me
  loop
    perform public.push_notification(r.id, 'transfer_request', 'Transfer requested: ' || v_title,
      coalesce(v_me_name, 'A team member') || ': ' || left(trim(p_reason), 300),
      '/tasks?task=' || p_task, 'task', p_task, 'important');
  end loop;

  perform public.task_audit(p_task, jsonb_build_object('transfer_requested', true, 'transfer_reason', left(trim(p_reason), 300)));
  return v_id;
end $$;


--
-- Name: reset_work_queue(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_work_queue(p_user uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_org uuid := public.current_org_id();
begin
  if not public.is_admin() then
    raise exception 'Only administrators can change the work order.';
  end if;
  if not public.is_org_member(p_user, v_org) then
    raise exception 'That person is not in your firm.';
  end if;
  update public.tasks set queue_rank = null
  where org_id = v_org and assigned_to = p_user and stage <> 'Approved' and queue_rank is not null;
  perform public.push_notification(p_user, 'queue_changed', 'Your work order is now automatic',
    'Tasks are ordered by statutory deadline, then priority.', '/tasks?view=queue', 'queue', null, 'normal');
end $$;


--
-- Name: resolve_doc_prefix(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_doc_prefix(p_prefix text, p_date date) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select replace(replace(replace(coalesce(p_prefix, ''),
    '{FY}',
      (case when extract(month from p_date) >= 4 then extract(year from p_date)::int else extract(year from p_date)::int - 1 end)::text
      || '-' ||
      right(((case when extract(month from p_date) >= 4 then extract(year from p_date)::int else extract(year from p_date)::int - 1 end) + 1)::text, 2)),
    '{YYYY}', extract(year from p_date)::int::text),
    '{YY}', right(extract(year from p_date)::int::text, 2));
$$;


--
-- Name: resume_timer(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resume_timer(p_keep_away_time boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.time_timers
  set paused_seconds = paused_seconds
        + case when p_keep_away_time then 0 else greatest(0, extract(epoch from (now() - paused_at)))::int end,
      paused_at = null,
      last_seen_at = now()
  where user_id = auth.uid() and paused_at is not null;
end;
$$;


--
-- Name: run_reminders(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.run_reminders() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  s public.reminder_settings%rowtype;
  v_ist timestamp := now() at time zone 'Asia/Kolkata';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_time time := (now() at time zone 'Asia/Kolkata')::time;
  r record;
  a record;
  v_title text;
  v_who text;
  v_log uuid;
  v_snoozes int := 0;
  v_sent int := 0;
  v_firms int := 0;
begin
  -- 1. Snoozed popups that are due (all firms)
  for r in
    select * from public.notifications
    where snoozed_until is not null and snoozed_until <= now() and read_at is null
  loop
    insert into public.notifications (org_id, user_id, type, title, body, link, entity, entity_id, priority, actor_id)
    values (r.org_id, r.user_id, r.type, left('Reminder: ' || regexp_replace(r.title, '^Reminder: ', ''), 200),
            r.body, r.link, r.entity, r.entity_id, 'important', null);
    update public.notifications set snoozed_until = null, read_at = now() where id = r.id;
    v_snoozes := v_snoozes + 1;
  end loop;

  -- 2. Forgotten timers: pause at the last sign of activity (all firms)
  update public.time_timers
  set paused_at = greatest(started_at, coalesce(last_seen_at, started_at))
  where paused_at is null and coalesce(last_seen_at, started_at) < now() - interval '30 minutes';

  -- 3. Overnight clean-up (all firms)
  if v_time >= time '23:00' then
    for r in
      select user_id, org_id from public.time_timers
      where coalesce(last_seen_at, started_at) < now() - interval '1 hour'
    loop
      perform public.set_org_context(r.org_id);
      v_log := public.close_timer(r.user_id, true);
      if v_log is not null then
        update public.time_logs set needs_review = true where id = v_log;
        perform public.push_notification(r.user_id, 'timer_auto_stopped', 'Your timer was stopped overnight',
          'Time up to your last activity was saved and marked for your day review.', '/time-tracking', 'time', v_log, 'normal');
      end if;
    end loop;
  end if;

  -- 4-8. Task reminders, firm by firm
  for s in
    select rs.* from public.reminder_settings rs
    join public.organizations o on o.id = rs.org_id and o.status in ('trial', 'active')
  loop
    continue when not s.enabled;
    continue when v_time < s.work_start or v_time > s.work_end
               or (s.skip_sundays and extract(isodow from v_today) = 7);

    perform public.set_org_context(s.org_id);
    v_firms := v_firms + 1;

    -- 4. Not started after N hours
    for r in
      select * from public.tasks
      where org_id = s.org_id and stage = 'Assigned' and assigned_to is not null and assigned_at is not null
        and assigned_at <= now() - make_interval(hours => s.not_started_hours)
    loop
      if public.reminder_once(r.id, r.assigned_to, 'not_started', 'once') then
        v_title := r.title || coalesce(' · ' || nullif(trim(r.period), ''), '');
        perform public.push_notification(r.assigned_to, 'task_not_started', 'Not started yet: ' || v_title,
          'Assigned ' || round(extract(epoch from (now() - r.assigned_at)) / 3600) || ' hours ago · Internal deadline '
            || coalesce(to_char(r.due_date, 'DD/MM/YYYY'), '—'),
          '/tasks?task=' || r.id, 'task', r.id, 'important');
        v_sent := v_sent + 1;
      end if;
    end loop;

    -- 5. Internal deadline approaching and still not started
    for r in
      select * from public.tasks
      where org_id = s.org_id and stage in ('Assigned', 'Changes Required') and assigned_to is not null
        and due_date is not null and due_date >= v_today and due_date <= v_today + s.due_soon_days
    loop
      v_title := r.title || coalesce(' · ' || nullif(trim(r.period), ''), '');
      if public.reminder_once(r.id, r.assigned_to, 'due_soon', v_today::text) then
        perform public.push_notification(r.assigned_to, 'task_due_soon', 'Deadline approaching: ' || v_title,
          'Internal deadline ' || to_char(r.due_date, 'DD/MM/YYYY')
            || case when r.due_date = v_today then ' (today)' else ' (in ' || (r.due_date - v_today) || ' days)' end
            || ' and work has not started.',
          '/tasks?task=' || r.id, 'task', r.id, 'important');
        v_sent := v_sent + 1;
      end if;
      if s.escalate_assigner then
        select name into v_who from public.profiles where id = r.assigned_to;
        for a in
          select x as id from (
            select r.assigned_by as x where r.assigned_by is not null
            union
            select u from public.org_admin_ids(s.org_id) u where r.assigned_by is null
          ) q
          where x <> r.assigned_to
        loop
          if public.reminder_once(r.id, a.id, 'due_soon_escalate', 'once') then
            perform public.push_notification(a.id, 'task_due_soon', coalesce(v_who, 'Assignee') || ' has not started: ' || v_title,
              'Internal deadline ' || to_char(r.due_date, 'DD/MM/YYYY') || '.', '/tasks?task=' || r.id, 'task', r.id, 'normal');
            v_sent := v_sent + 1;
          end if;
        end loop;
      end if;
    end loop;

    -- 6. Internal deadline passed, not yet submitted
    for r in
      select * from public.tasks
      where org_id = s.org_id and stage in ('Assigned', 'In Progress', 'Changes Required') and assigned_to is not null
        and due_date is not null and due_date < v_today
    loop
      v_title := r.title || coalesce(' · ' || nullif(trim(r.period), ''), '');
      if s.overdue_daily and public.reminder_once(r.id, r.assigned_to, 'overdue', v_today::text) then
        perform public.push_notification(r.assigned_to, 'task_overdue', 'Overdue: ' || v_title,
          'Internal deadline was ' || to_char(r.due_date, 'DD/MM/YYYY') || ' (' || (v_today - r.due_date) || ' days ago)'
            || coalesce(' · Statutory ' || to_char(r.official_due_date, 'DD/MM/YYYY'), ''),
          '/tasks?task=' || r.id, 'task', r.id, 'important');
        v_sent := v_sent + 1;
      end if;
      if s.escalate_assigner then
        select name into v_who from public.profiles where id = r.assigned_to;
        for a in
          select x as id from (
            select r.assigned_by as x where r.assigned_by is not null
            union
            select u from public.org_admin_ids(s.org_id) u where r.assigned_by is null
          ) q
          where x <> r.assigned_to
        loop
          if public.reminder_once(r.id, a.id, 'overdue_escalate', 'once') then
            perform public.push_notification(a.id, 'task_overdue', 'Overdue with ' || coalesce(v_who, 'assignee') || ': ' || v_title,
              'Internal deadline was ' || to_char(r.due_date, 'DD/MM/YYYY') || '.', '/tasks?task=' || r.id, 'task', r.id, 'normal');
            v_sent := v_sent + 1;
          end if;
        end loop;
      end if;
    end loop;

    -- 7. Statutory deadline at risk / breached -> this firm's admins
    for r in
      select * from public.tasks
      where org_id = s.org_id and stage not in ('Submitted for Review', 'Approved') and official_due_date is not null
        and official_due_date <= v_today + s.statutory_alert_days
    loop
      v_title := r.title || coalesce(' · ' || nullif(trim(r.period), ''), '');
      select name into v_who from public.profiles where id = r.assigned_to;
      for a in select u as id from public.org_admin_ids(s.org_id) u loop
        if r.official_due_date < v_today then
          if public.reminder_once(r.id, a.id, 'statutory_breached', 'once') then
            perform public.push_notification(a.id, 'statutory_risk', 'Statutory deadline breached: ' || v_title,
              'Was due ' || to_char(r.official_due_date, 'DD/MM/YYYY') || ' · ' || r.stage || ' · with ' || coalesce(v_who, 'nobody (unassigned)'),
              '/tasks?task=' || r.id, 'task', r.id, 'important');
            v_sent := v_sent + 1;
          end if;
        elsif public.reminder_once(r.id, a.id, 'statutory_risk', v_today::text) then
          perform public.push_notification(a.id, 'statutory_risk', 'Statutory deadline at risk: ' || v_title,
            'Due ' || to_char(r.official_due_date, 'DD/MM/YYYY')
              || case when r.official_due_date = v_today then ' (today)' else ' (in ' || (r.official_due_date - v_today) || ' days)' end
              || ' · ' || r.stage || ' · with ' || coalesce(v_who, 'nobody (unassigned)'),
            '/tasks?task=' || r.id, 'task', r.id, 'important');
          v_sent := v_sent + 1;
        end if;
      end loop;
    end loop;

    -- 8. Waiting too long for review
    for r in
      select * from public.tasks
      where org_id = s.org_id and stage = 'Submitted for Review' and reviewer_id is not null and stage_changed_at is not null
        and stage_changed_at <= now() - make_interval(hours => s.review_waiting_hours)
    loop
      if public.reminder_once(r.id, r.reviewer_id, 'review_waiting', v_today::text) then
        select name into v_who from public.profiles where id = r.assigned_to;
        perform public.push_notification(r.reviewer_id, 'review_waiting',
          'Waiting for your review: ' || r.title || coalesce(' · ' || nullif(trim(r.period), ''), ''),
          'Submitted ' || round(extract(epoch from (now() - r.stage_changed_at)) / 3600) || ' hours ago by ' || coalesce(v_who, 'staff'),
          '/reviewer-queue?tab=pending', 'task', r.id, 'normal');
        v_sent := v_sent + 1;
      end if;
    end loop;
  end loop;

  perform public.set_org_context(null);
  return jsonb_build_object('snoozes', v_snoozes, 'reminders_sent', v_sent, 'firms_checked', v_firms, 'ran_at', v_ist);
end $$;


--
-- Name: run_reminders_now(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.run_reminders_now() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can run the reminder check.';
  end if;
  return public.run_reminders();
end;
$$;


--
-- Name: save_firm_setup(jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_firm_setup(p_answers jsonb, p_complete boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_org uuid := public.current_org_id();
  v_name text;
begin
  if v_org is null or not public.is_admin() then
    raise exception 'Only firm administrators can change the firm setup.';
  end if;
  if pg_column_size(coalesce(p_answers, '{}'::jsonb)) > 4000 then
    raise exception 'Setup answers are too large.';
  end if;

  v_name := nullif(trim(coalesce(p_answers ->> 'org_name', '')), '');

  update public.organizations
  set setup = setup || (coalesce(p_answers, '{}'::jsonb) - 'org_name'),
      name = coalesce(left(v_name, 200), name),
      setup_completed_at = case when p_complete then coalesce(setup_completed_at, now()) else setup_completed_at end,
      updated_at = now()
  where id = v_org;
end $$;


--
-- Name: set_active_org(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_active_org(p_org uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_org is null or p_org not in (select public.my_org_ids()) then
    raise exception 'You are not an active member of this firm';
  end if;
  insert into public.user_active_org (user_id, org_id, updated_at)
  values (auth.uid(), p_org, now())
  on conflict (user_id) do update set org_id = excluded.org_id, updated_at = now();
end $$;


--
-- Name: set_org_context(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_org_context(p_org uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform set_config('app.org_id', coalesce(p_org::text, ''), true);
end $$;


--
-- Name: set_work_queue(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_work_queue(p_user uuid, p_task_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_org uuid := public.current_org_id();
  v_old_first uuid;
  v_new_first uuid;
  v_top text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can set the work order.';
  end if;
  if not public.is_org_member(p_user, v_org) then
    raise exception 'That person is not in your firm.';
  end if;

  select id into v_old_first from public.tasks
  where org_id = v_org and assigned_to = p_user and stage <> 'Approved'
  order by (queue_rank is not null), queue_rank,
           least(coalesce(official_due_date, date '9999-12-31'), coalesce(due_date, date '9999-12-31')),
           case priority when 'High' then 0 when 'Medium' then 1 else 2 end, due_date nulls last
  limit 1;

  update public.tasks t
  set queue_rank = x.ord::int
  from unnest(p_task_ids) with ordinality as x(id, ord)
  where t.id = x.id and t.org_id = v_org and t.assigned_to = p_user and t.stage <> 'Approved';

  select id into v_new_first from public.tasks
  where org_id = v_org and assigned_to = p_user and stage <> 'Approved'
  order by (queue_rank is not null), queue_rank,
           least(coalesce(official_due_date, date '9999-12-31'), coalesce(due_date, date '9999-12-31')),
           case priority when 'High' then 0 when 'Medium' then 1 else 2 end, due_date nulls last
  limit 1;

  select string_agg('#' || rn || ' ' || title || coalesce(' · ' || nullif(trim(period), ''), ''), '   ')
    into v_top
  from (
    select title, period, row_number() over (
      order by (queue_rank is not null), queue_rank,
               least(coalesce(official_due_date, date '9999-12-31'), coalesce(due_date, date '9999-12-31')),
               case priority when 'High' then 0 when 'Medium' then 1 else 2 end, due_date nulls last
    ) as rn
    from public.tasks
    where org_id = v_org and assigned_to = p_user and stage <> 'Approved'
  ) s
  where rn <= 3;

  perform public.push_notification(p_user, 'queue_changed',
    case when v_new_first is distinct from v_old_first then 'Your top priority changed' else 'Your work order was updated' end,
    coalesce(v_top, ''), '/tasks?view=queue', 'queue', null,
    case when v_new_first is distinct from v_old_first then 'important' else 'normal' end);
end $$;


--
-- Name: shares_org_with(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shares_org_with(target uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.memberships a
    join public.memberships b on b.org_id = a.org_id
    where a.user_id = auth.uid()
      and a.is_active
      and b.user_id = target
      and b.is_active
  )
$$;


--
-- Name: snooze_notification(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.snooze_notification(p_id uuid, p_until timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if p_until is null or p_until < now() + interval '5 minutes' or p_until > now() + interval '7 days' then
    raise exception 'Choose a time between 5 minutes and 7 days from now.';
  end if;
  update public.notifications
  set snoozed_until = p_until, popup_dismissed_at = now()
  where id = p_id and user_id = auth.uid();
  if not found then
    raise exception 'Notification not found.';
  end if;
end;
$$;


--
-- Name: stop_time_timer(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stop_time_timer(p_billable boolean DEFAULT true) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from public.time_timers where user_id = auth.uid()) then
    raise exception 'No timer is running.';
  end if;
  return public.close_timer(auth.uid(), coalesce(p_billable, true));
end;
$$;


--
-- Name: storage_folder_allowed(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.storage_folder_allowed(p_name text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
  select coalesce((
    select case
      when x.f = public.current_org_id()::text then true
      when x.f in ('client_files', 'internal')
        then public.current_org_id() = (select legacy_org_id from public.platform_config where id)
      when x.f ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then exists (select 1 from public.clients c
                     where c.id::text = x.f and c.org_id = public.current_org_id())
      else false
    end
    from (select (storage.foldername(p_name))[1] as f) x
  ), false)
$_$;


--
-- Name: support_file_allowed(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.support_file_allowed(p_folder text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_owner uuid;
begin
  begin
    v_owner := p_folder::uuid;
  exception when others then
    return false;
  end;
  return v_owner = auth.uid() or public.is_platform_admin();
end $$;


--
-- Name: support_messages_after_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.support_messages_after_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  t public.support_tickets%rowtype;
begin
  update public.support_tickets
  set last_message_at = new.created_at,
      updated_at = now(),
      first_response_at = case when new.role = 'agent' and first_response_at is null then now() else first_response_at end
  where id = new.ticket_id
  returning * into t;

  if new.role = 'agent' then
    -- Reply reaches the user inside their own firm
    perform public.set_org_context(t.org_id);
    perform public.push_notification(t.user_id, 'support_reply', 'Support replied · ' || t.number,
      left(new.body, 240), '/help?ticket=' || t.id, 'support', t.id, 'important');
  elsif new.role = 'user' and t.status in ('waiting', 'open') then
    perform public.notify_platform_support('support_message', t.number || ': new message',
      left(new.body, 240), '/support?ticket=' || t.id, t.id, 'normal', t.assigned_to);
  end if;
  return new;
end $$;


--
-- Name: support_tickets_before_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.support_tickets_before_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  new.number := 'SUP-' || lpad(nextval('public.support_ticket_seq')::text, 4, '0');
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;


--
-- Name: support_tickets_notify(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.support_tickets_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_name text;
  v_firm text;
begin
  if new.status = 'waiting' and (tg_op = 'INSERT' or old.status is distinct from 'waiting') then
    select name into v_name from public.profiles where id = new.user_id;
    select name into v_firm from public.organizations where id = new.org_id;
    perform public.notify_platform_support(
      case when new.kind = 'feedback' then 'support_feedback' else 'support_request' end,
      case when new.kind = 'feedback' then 'New feedback · ' else 'Support request · ' end
        || new.number || ' · ' || coalesce(v_name, '') || coalesce(' (' || v_firm || ')', ''),
      left(coalesce(new.ai_summary, new.subject), 240),
      '/support?ticket=' || new.id, new.id,
      case when new.kind = 'feedback' then 'normal' else 'important' end);
  end if;
  return new;
end $$;


--
-- Name: sync_invoice_paid(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_invoice_paid() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
  v_sum numeric;
begin
  select coalesce(sum(amount), 0) into v_sum from public.invoice_payments where invoice_id = v_invoice;
  perform set_config('app.payment_sync', 'on', true);
  update public.invoices set amount_paid = v_sum where id = v_invoice;
  perform set_config('app.payment_sync', 'off', true);
  return null;
end;
$$;


--
-- Name: sync_task_time(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_task_time() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_task uuid;
begin
  for v_task in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.task_id end,
      case when tg_op <> 'DELETE' then new.task_id end
    ]) as x
    where x is not null
  loop
    perform set_config('app.time_sync', 'on', true);
    update public.tasks
    set time_spent_minutes = coalesce((select round(sum(hours) * 60) from public.time_logs where task_id = v_task), 0)
    where id = v_task;
    perform set_config('app.time_sync', 'off', true);
  end loop;
  return null;
end;
$$;


--
-- Name: task_audit(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.task_audit(p_task uuid, p_meta jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_actor text;
begin
  select name into v_actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (user_id, action, entity, entity_id, metadata)
  values (auth.uid(), 'UPDATE_TASK', 'TASKS', p_task,
          coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('actor_name', coalesce(v_actor, 'System')));
end;
$$;


--
-- Name: task_types_after_rename(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.task_types_after_rename() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if new.name is distinct from old.name then
    update public.tasks set title = new.name where task_type_id = new.id and stage <> 'Approved';
  end if;
  return new;
end;
$$;


--
-- Name: tasks_after_approve(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tasks_after_approve() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_interval interval;
  v_series uuid;
  v_next_due date;
  v_next_official date;
begin
  if new.stage = 'Approved' and old.stage is distinct from 'Approved'
     and coalesce(new.recurrence, 'None') <> 'None' and new.due_date is not null then

    v_interval := case new.recurrence
      when 'Weekly' then interval '7 days'
      when 'Monthly' then interval '1 month'
      when 'Quarterly' then interval '3 months'
      when 'Yearly' then interval '1 year'
      else null
    end;
    if v_interval is null then
      return null;
    end if;

    v_series := coalesce(new."seriesId", new.id);
    v_next_due := (new.due_date + v_interval)::date;
    v_next_official := case when new.official_due_date is null then null else (new.official_due_date + v_interval)::date end;

    if not exists (select 1 from public.tasks where "seriesId" = v_series and due_date = v_next_due and id <> new.id) then
      perform set_config('app.task_system', 'on', true);
      insert into public.tasks (
        org_id, title, client_id, organisation, category, priority, recurrence, "seriesId",
        assigned_to, reviewer_id, stage, due_date, official_due_date, notes
      )
      values (
        new.org_id, new.title, new.client_id, new.organisation, new.category, new.priority, new.recurrence, v_series,
        new.assigned_to, new.reviewer_id, 'Assigned', v_next_due, v_next_official, new.notes
      );
      perform set_config('app.task_system', 'off', true);
    end if;
  end if;
  return null;
end $$;


--
-- Name: tasks_assignment_meta(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tasks_assignment_meta() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.queue_rank := null;
    new.stage_changed_at := now();
    new.return_count := 0;
    new.submitted_at := case when new.stage = 'Submitted for Review' then now() else null end;
    new.started_at := case when new.stage = 'In Progress' then now() else null end;
    if new.assigned_to is not null then
      new.assigned_by := coalesce(auth.uid(), new.assigned_by);
      new.assigned_at := now();
    else
      new.assigned_by := null;
      new.assigned_at := null;
    end if;
  else
    -- protected values: only the system changes them
    new.started_at := old.started_at;
    new.submitted_at := old.submitted_at;
    new.return_count := old.return_count;

    if new.assigned_to is distinct from old.assigned_to then
      new.assigned_by := coalesce(auth.uid(), old.assigned_by);
      new.assigned_at := case when new.assigned_to is null then null else now() end;
      new.queue_rank := null;
      new.started_at := null; -- the new person has not started yet
    else
      new.assigned_by := old.assigned_by;
      new.assigned_at := old.assigned_at;
    end if;

    if new.stage is distinct from old.stage then
      new.stage_changed_at := now();
      if new.stage = 'In Progress' and new.started_at is null then
        new.started_at := now();
      elsif new.stage = 'Submitted for Review' then
        new.submitted_at := now();
      elsif new.stage = 'Changes Required' then
        new.return_count := old.return_count + 1;
      end if;
    else
      new.stage_changed_at := old.stage_changed_at;
    end if;

    if new.stage = 'Approved' then
      new.queue_rank := null;
    end if;
  end if;

  if new.estimated_minutes is null and new.task_type_id is not null then
    select default_estimate_minutes into new.estimated_minutes from public.task_types where id = new.task_type_id;
  end if;
  return new;
end;
$$;


--
-- Name: tasks_auto_timer(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tasks_auto_timer() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_existing public.time_timers%rowtype;
begin
  -- Leaving "In Progress", or task handed to someone else: save the running timer on this task
  if (old.stage = 'In Progress' and new.stage is distinct from 'In Progress')
     or (new.assigned_to is distinct from old.assigned_to) then
    if old.assigned_to is not null
       and exists (select 1 from public.time_timers where user_id = old.assigned_to and task_id = new.id) then
      perform public.close_timer(old.assigned_to, true);
    end if;
  end if;

  -- The assignee starts the task themselves: start the timer (one timer at a time)
  if new.stage = 'In Progress' and old.stage is distinct from 'In Progress'
     and new.assigned_to is not null and new.assigned_to = auth.uid() then
    select * into v_existing from public.time_timers where user_id = auth.uid();
    if found and v_existing.task_id is distinct from new.id then
      perform public.close_timer(auth.uid(), true);
    end if;
    if not exists (select 1 from public.time_timers where user_id = auth.uid()) then
      insert into public.time_timers (user_id, description, client_id, task_id, source, last_seen_at)
      values (auth.uid(), left(new.title || coalesce(' · ' || nullif(trim(new.period), ''), ''), 300),
              new.client_id, new.id, 'auto', now());
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: tasks_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tasks_before_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := false;
  v_time_sync boolean := coalesce(current_setting('app.time_sync', true), 'off') = 'on';
  v_system boolean := coalesce(current_setting('app.task_system', true), 'off') = 'on';
  v_is_reviewer boolean;
  v_is_assignee boolean;
  v_dates_changed boolean;
begin
  if v_uid is not null then
    v_admin := public.is_admin();
  end if;

  new.title := trim(coalesce(new.title, ''));
  if new.title = '' then
    raise exception 'Task title is required.';
  end if;

  if coalesce(new.stage, '') not in ('Assigned', 'In Progress', 'Submitted for Review', 'Changes Required', 'Approved') then
    raise exception 'Invalid workflow stage.';
  end if;

  if new.reviewer_id is not null and new.reviewer_id = new.assigned_to then
    raise exception 'The reviewer must be a different person from the assignee (maker-checker rule).';
  end if;

  if tg_op = 'INSERT' then
    if new.due_date is null then
      raise exception 'An internal deadline is required.';
    end if;
    new.time_spent_minutes := 0; -- totals come from the time-log ledger
    new.created_at := now();
    if coalesce(new.recurrence, 'None') <> 'None' then
      new."seriesId" := coalesce(new."seriesId", new.id);
    end if;
    v_dates_changed := true;
  else
    new.created_at := old.created_at;

    -- Only the time-log ledger may change the time total
    if not v_time_sync then
      new.time_spent_minutes := old.time_spent_minutes;
    end if;

    if v_uid is not null and not v_admin and not v_system and not v_time_sync then
      v_is_reviewer := old.reviewer_id is not distinct from v_uid;
      v_is_assignee := old.assigned_to is not distinct from v_uid;

      if not v_is_reviewer and not v_is_assignee then
        raise exception 'You can only update tasks assigned to you or that you review.';
      end if;

      if not v_is_reviewer then
        if new.title is distinct from old.title
           or new.client_id is distinct from old.client_id
           or new.organisation is distinct from old.organisation
           or new.category is distinct from old.category
           or new.due_date is distinct from old.due_date
           or new.official_due_date is distinct from old.official_due_date
           or new.assigned_to is distinct from old.assigned_to
           or new.reviewer_id is distinct from old.reviewer_id
           or new.priority is distinct from old.priority
           or new.recurrence is distinct from old.recurrence
           or new.review_comments is distinct from old.review_comments then
          raise exception 'Only the reviewer or an administrator can change task details.';
        end if;

        if new.stage is distinct from old.stage and not (
             (old.stage in ('Assigned', 'Changes Required') and new.stage in ('In Progress', 'Submitted for Review'))
          or (old.stage = 'In Progress' and new.stage = 'Submitted for Review')
        ) then
          raise exception 'You cannot move this task from "%" to "%".', old.stage, new.stage;
        end if;
      end if;
    end if;

    if new.stage = 'Changes Required' and new.stage is distinct from old.stage
       and trim(coalesce(new.review_comments, '')) = '' then
      raise exception 'Please add reviewer feedback before sending the task back for changes.';
    end if;

    if new.stage = 'Approved' and old.stage is distinct from 'Approved'
       and old.stage <> 'Submitted for Review' and not v_admin and v_uid is not null then
      raise exception 'Only tasks submitted for review can be approved.';
    end if;

    if coalesce(new.recurrence, 'None') <> 'None' and new."seriesId" is null then
      new."seriesId" := new.id;
    end if;

    v_dates_changed := new.due_date is distinct from old.due_date
                    or new.official_due_date is distinct from old.official_due_date;
  end if;

  if v_dates_changed and new.official_due_date is not null and new.due_date is not null
     and new.due_date > new.official_due_date then
    raise exception 'The internal deadline must be on or before the statutory deadline.';
  end if;

  -- Legacy mirror
  new.status := case when new.stage = 'Approved' then 'Completed' else 'Pending' end;

  return new;
end;
$$;


--
-- Name: tasks_carry_period(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tasks_carry_period() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_prev text;
begin
  if new."seriesId" is not null and pg_trigger_depth() > 1 then
    select period into v_prev
    from public.tasks
    where "seriesId" = new."seriesId" and period is not null and id <> new.id
    order by due_date desc nulls last
    limit 1;
    if v_prev is not null and (new.period is null or new.period = v_prev) then
      new.period := public.advance_period(v_prev, new.recurrence);
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: tasks_notify(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tasks_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_title text := new.title || coalesce(' · ' || nullif(trim(new.period), ''), '');
  v_link text := '/tasks?task=' || new.id;
  v_client text;
  v_dates text;
  v_actor text;
  v_prio text := case when pg_trigger_depth() > 1 then 'normal' else 'important' end;
  v_assignee_name text;
begin
  perform public.set_org_context(new.org_id);

  select case
           when nullif(trim(organization_name), '') is not null and trim(organization_name) <> trim(name)
             then trim(organization_name) || ' — ' || name
           else coalesce(nullif(trim(organization_name), ''), name)
         end
    into v_client
  from public.clients where id = new.client_id;
  v_client := coalesce(v_client, 'Internal');

  v_dates := 'Internal ' || coalesce(to_char(new.due_date, 'DD/MM/YYYY'), '—')
             || coalesce(' · Statutory ' || to_char(new.official_due_date, 'DD/MM/YYYY'), '');
  select name into v_actor from public.profiles where id = auth.uid();
  v_actor := coalesce(v_actor, 'System');

  if tg_op = 'INSERT' then
    perform public.push_notification(new.assigned_to, 'task_assigned', 'New task: ' || v_title,
      v_client || ' · ' || v_dates || ' · ' || coalesce(new.priority, 'Medium') || ' priority',
      v_link, 'task', new.id, v_prio);
    perform public.push_notification(new.reviewer_id, 'task_reviewer', 'You will review: ' || v_title,
      v_client || ' · assigned by ' || v_actor, v_link, 'task', new.id, 'normal');
    return new;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    perform public.push_notification(new.assigned_to, 'task_assigned', 'Task assigned to you: ' || v_title,
      v_client || ' · ' || v_dates || ' · by ' || v_actor, v_link, 'task', new.id, v_prio);
    select name into v_assignee_name from public.profiles where id = new.assigned_to;
    perform public.push_notification(old.assigned_to, 'task_reassigned',
      'Moved to ' || coalesce(v_assignee_name, 'someone else') || ': ' || v_title,
      'Reassigned by ' || v_actor, v_link, 'task', new.id, 'normal');
  end if;

  if new.reviewer_id is distinct from old.reviewer_id then
    perform public.push_notification(new.reviewer_id, 'task_reviewer', 'You will review: ' || v_title,
      v_client || ' · set by ' || v_actor, v_link, 'task', new.id, 'normal');
  end if;

  if new.stage is distinct from old.stage then
    if new.stage = 'Submitted for Review' then
      perform public.push_notification(new.reviewer_id, 'task_submitted', 'Ready for your review: ' || v_title,
        v_client || ' · submitted by ' || v_actor, '/reviewer-queue?tab=pending', 'task', new.id, 'important');
    elsif new.stage = 'Changes Required' then
      perform public.push_notification(new.assigned_to, 'task_changes', 'Changes requested: ' || v_title,
        coalesce(left(nullif(trim(new.review_comments), ''), 300), 'See the reviewer feedback.'),
        v_link, 'task', new.id, 'important');
    elsif new.stage = 'Approved' then
      perform public.push_notification(new.assigned_to, 'task_approved', 'Approved: ' || v_title,
        'Signed off by ' || v_actor, v_link, 'task', new.id, 'normal');
    end if;
  end if;

  if (new.due_date is distinct from old.due_date or new.official_due_date is distinct from old.official_due_date)
     and new.assigned_to is not distinct from old.assigned_to then
    perform public.push_notification(new.assigned_to, 'task_deadline', 'Deadline changed: ' || v_title,
      v_dates, v_link, 'task', new.id, 'normal');
  end if;

  return new;
end $$;


--
-- Name: tasks_task_type_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tasks_task_type_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_type public.task_types%rowtype;
begin
  new.title := trim(coalesce(new.title, ''));
  new.period := nullif(trim(coalesce(new.period, '')), '');

  if new.task_type_id is not null then
    select * into v_type from public.task_types
     where id = new.task_type_id and org_id = new.org_id;
    if found then
      new.title := v_type.name;
    else
      raise exception 'Task type not found.';
    end if;
  else
    select * into v_type from public.task_types
     where org_id = new.org_id and lower(trim(name)) = lower(new.title)
     limit 1;
    if found then
      new.task_type_id := v_type.id;
    end if;
  end if;

  if auth.uid() is not null
     and pg_trigger_depth() = 1
     and not public.is_admin()
     and (tg_op = 'INSERT' or new.title is distinct from old.title)
     and (v_type.id is null or not v_type.is_active) then
    raise exception 'Choose a task from the task list. Only administrators can add new task types.';
  end if;

  return new;
end $$;


--
-- Name: team_scorecards(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.team_scorecards(p_from date, p_to date) RETURNS TABLE(user_id uuid, name text, assigned integer, completed integer, open_now integer, overdue_now integer, submitted_total integer, submitted_on_time integer, on_time_rate numeric, statutory_due integer, statutory_breached integer, first_pass integer, first_pass_rate numeric, avg_rounds numeric, avg_start_hours numeric, avg_cycle_hours numeric, logged_minutes integer, billable_minutes integer, est_minutes integer, actual_minutes integer, active_days integer, active_minutes integer, working_days integer, confirmed_days integer, weighted_volume integer, score_timeliness numeric, score_quality numeric, score_volume numeric, score_activeness numeric, score numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
#variable_conflict use_column
declare
  v_me uuid := auth.uid();
  v_org uuid := public.current_org_id();
  v_admin boolean := public.is_admin();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_working int;
  w public.kpi_settings%rowtype;
begin
  if v_org is null then
    raise exception 'Your account is not active.';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 370 then
    raise exception 'Choose a period of up to one year.';
  end if;

  select * into w from public.kpi_settings where org_id = v_org;

  select count(*)::int into v_working
  from generate_series(p_from::timestamp, least(p_to, v_today)::timestamp, interval '1 day') d
  where extract(isodow from d) <= coalesce(w.working_days_per_week, 6);

  return query
  with ppl as (
    select p.id as uid, p.name as uname
    from public.profiles p
    join public.memberships m on m.user_id = p.id and m.org_id = v_org and m.is_active
  ),
  base as (
    select
      p.uid,
      p.uname,
      (select count(*) from public.tasks t where t.org_id = v_org and t.assigned_to = p.uid
         and (t.assigned_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::int as b_assigned,
      (select count(*) from public.tasks t where t.org_id = v_org and t.assigned_to = p.uid and t.stage = 'Approved'
         and (t.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::int as b_completed,
      (select count(*) from public.tasks t where t.org_id = v_org and t.assigned_to = p.uid and t.stage <> 'Approved')::int as b_open,
      (select count(*) from public.tasks t where t.org_id = v_org and t.assigned_to = p.uid
         and t.stage not in ('Approved', 'Submitted for Review') and t.due_date < v_today)::int as b_overdue,
      (select count(*) from public.tasks t where t.org_id = v_org and t.assigned_to = p.uid and t.submitted_at is not null
         and (t.submitted_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::int as b_sub_total,
      (select count(*) from public.tasks t where t.org_id = v_org and t.assigned_to = p.uid and t.submitted_at is not null
         and (t.submitted_at at time zone 'Asia/Kolkata')::date between p_from and p_to
         and (t.due_date is null or (t.submitted_at at time zone 'Asia/Kolkata')::date <= t.due_date))::int as b_sub_ontime,
      (select count(*) from public.tasks t where t.org_id = v_org and t.assigned_to = p.uid
         and t.official_due_date between p_from and least(p_to, v_today))::int as b_stat_due,
      (select count(*) from public.tasks t where t.org_id = v_org and t.assigned_to = p.uid
         and t.official_due_date between p_from and least(p_to, v_today)
         and ((t.stage <> 'Approved' and t.official_due_date < v_today)
              or (t.stage = 'Approved' and (t.stage_changed_at at time zone 'Asia/Kolkata')::date > t.official_due_date)))::int as b_stat_breach,
      (select count(*) from public.tasks t where t.org_id = v_org and t.assigned_to = p.uid and t.stage = 'Approved' and t.return_count = 0
         and (t.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::int as b_first_pass,
      (select avg(t.return_count) from public.tasks t where t.org_id = v_org and t.assigned_to = p.uid and t.stage = 'Approved'
         and (t.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to) as b_rounds,
      (select avg(extract(epoch from (t.started_at - t.assigned_at)) / 3600) from public.tasks t
         where t.org_id = v_org and t.assigned_to = p.uid and t.started_at is not null and t.assigned_at is not null
         and t.started_at >= t.assigned_at
         and (t.assigned_at at time zone 'Asia/Kolkata')::date between p_from and p_to) as b_start_h,
      (select avg(extract(epoch from (t.submitted_at - coalesce(t.started_at, t.assigned_at))) / 3600) from public.tasks t
         where t.org_id = v_org and t.assigned_to = p.uid and t.stage = 'Approved' and t.submitted_at is not null
         and coalesce(t.started_at, t.assigned_at) is not null and t.submitted_at >= coalesce(t.started_at, t.assigned_at)
         and (t.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to) as b_cycle_h,
      (select coalesce(sum(l.hours), 0) * 60 from public.time_logs l
         where l.org_id = v_org and l.user_id = p.uid and l.log_date between p_from and p_to)::int as b_logged,
      (select coalesce(sum(l.hours), 0) * 60 from public.time_logs l
         where l.org_id = v_org and l.user_id = p.uid and l.log_date between p_from and p_to and l.is_billable is not false)::int as b_billable,
      (select coalesce(sum(t.estimated_minutes), 0) from public.tasks t where t.org_id = v_org and t.assigned_to = p.uid and t.stage = 'Approved'
         and t.estimated_minutes > 0 and (t.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::int as b_est,
      (select coalesce(sum(t.time_spent_minutes), 0) from public.tasks t where t.org_id = v_org and t.assigned_to = p.uid and t.stage = 'Approved'
         and t.estimated_minutes > 0 and (t.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::int as b_actual,
      (select count(*) from public.user_activity_days d
         where d.org_id = v_org and d.user_id = p.uid and d.day between p_from and p_to and d.active_minutes > 0)::int as b_active_days,
      (select coalesce(sum(d.active_minutes), 0) from public.user_activity_days d
         where d.org_id = v_org and d.user_id = p.uid and d.day between p_from and p_to)::int as b_active_min,
      (select count(*) from public.user_activity_days d
         where d.org_id = v_org and d.user_id = p.uid and d.day between p_from and p_to and d.confirmed_at is not null)::int as b_confirmed,
      (select coalesce(sum(coalesce(t.estimated_minutes, 60)), 0) from public.tasks t where t.org_id = v_org and t.assigned_to = p.uid and t.stage = 'Approved'
         and (t.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::int as b_volume
    from ppl p
  ),
  scored as (
    select
      b.*,
      case when b.b_sub_total > 0 then round(100.0 * b.b_sub_ontime / b.b_sub_total, 1) end as r_ontime,
      case when b.b_completed > 0 then round(100.0 * b.b_first_pass / b.b_completed, 1) end as r_firstpass,
      case when b.b_sub_total > 0 or b.b_stat_due > 0
        then greatest(0, coalesce(100.0 * b.b_sub_ontime / nullif(b.b_sub_total, 0), 100) - 15 * b.b_stat_breach) end as s_time,
      case when b.b_completed > 0 then 100.0 * b.b_first_pass / b.b_completed end as s_quality,
      case when max(b.b_volume) over () > 0 then 100.0 * b.b_volume / max(b.b_volume) over () end as s_volume,
      case when v_working > 0 then least(100, 100.0 * b.b_active_days / v_working) end as s_active
    from base b
  )
  select
    s.uid, s.uname, s.b_assigned, s.b_completed, s.b_open, s.b_overdue, s.b_sub_total, s.b_sub_ontime, s.r_ontime,
    s.b_stat_due, s.b_stat_breach, s.b_first_pass, s.r_firstpass,
    round(s.b_rounds, 2), round(s.b_start_h, 1), round(s.b_cycle_h, 1),
    s.b_logged, s.b_billable, s.b_est, s.b_actual, s.b_active_days, s.b_active_min, v_working, s.b_confirmed, s.b_volume,
    round(s.s_time, 1), round(s.s_quality, 1), round(s.s_volume, 1), round(s.s_active, 1),
    round(
      (coalesce(w.w_timeliness * s.s_time, 0) + coalesce(w.w_quality * s.s_quality, 0)
        + coalesce(w.w_volume * s.s_volume, 0) + coalesce(w.w_activeness * s.s_active, 0))
      / nullif(
          (case when s.s_time is not null then w.w_timeliness else 0 end)
          + (case when s.s_quality is not null then w.w_quality else 0 end)
          + (case when s.s_volume is not null then w.w_volume else 0 end)
          + (case when s.s_active is not null then w.w_activeness else 0 end), 0), 1)
  from scored s
  where v_admin or s.uid = v_me
  order by s.uname;
end $$;


--
-- Name: time_logs_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.time_logs_before_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := false;
  v_system boolean := coalesce(current_setting('finetax.system_write', true), '') = 'on';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_lock_days int := 7;   -- staff cannot add/edit/delete entries older than this
  v_day_total numeric;
begin
  if v_uid is not null then
    v_admin := public.is_admin();
  end if;

  if tg_op = 'DELETE' then
    if v_uid is not null and not v_admin and not v_system then
      if old.user_id is distinct from v_uid then
        raise exception 'You can only delete your own time entries.';
      end if;
      if old.log_date < v_today - v_lock_days then
        raise exception 'Entries older than % days are locked. Please ask an administrator.', v_lock_days;
      end if;
    end if;
    return old;
  end if;

  new.description := trim(coalesce(new.description, ''));
  if new.description = '' then
    raise exception 'Please describe the work done.';
  end if;
  if new.log_date is null then
    new.log_date := v_today;
  end if;
  if coalesce(new.hours, 0) <= 0 or new.hours > 24 then
    raise exception 'Hours must be more than 0 and at most 24.';
  end if;
  if new.log_date > v_today then
    raise exception 'Time cannot be logged for a future date.';
  end if;
  new.source := coalesce(nullif(new.source, ''), 'manual');

  if v_system then
    null; -- automatic entries: the system sets the owner and source
  elsif v_uid is not null and not v_admin then
    if tg_op = 'INSERT' then
      new.user_id := v_uid;
      new.source := 'manual';        -- people cannot create entries that look automatic
      new.needs_review := false;
      new.started_at := null;
      new.ended_at := null;
    else
      if old.user_id is distinct from v_uid then
        raise exception 'You can only edit your own time entries.';
      end if;
      new.user_id := old.user_id;
      new.source := old.source;
      new.started_at := old.started_at;
      new.ended_at := old.ended_at;
      if old.log_date < v_today - v_lock_days then
        raise exception 'Entries older than % days are locked. Please ask an administrator.', v_lock_days;
      end if;
    end if;
    if new.log_date < v_today - v_lock_days then
      raise exception 'Time older than % days cannot be logged. Please ask an administrator.', v_lock_days;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.hours is distinct from old.hours then
    new.edited_at := now();
  end if;

  if new.user_id is null then
    new.user_id := v_uid;
  end if;

  if new.task_id is not null and new.client_id is null then
    select client_id into new.client_id from public.tasks where id = new.task_id;
  end if;

  select coalesce(sum(hours), 0) into v_day_total
  from public.time_logs
  where user_id = new.user_id and log_date = new.log_date and id is distinct from new.id;

  if v_day_total + new.hours > 24 then
    if v_system then
      new.needs_review := true; -- never block a workflow step; flag it for the day review instead
    else
      raise exception 'This would exceed 24 hours logged on %.', to_char(new.log_date, 'DD/MM/YYYY');
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
  end if;
  return new;
end;
$$;


--
-- Name: time_timers_before_write(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.time_timers_before_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op = 'INSERT' then
    new.started_at := now();                 -- server clock only
    new.user_id := coalesce(auth.uid(), new.user_id);
  else
    new.started_at := old.started_at;
    new.user_id := old.user_id;
  end if;

  new.description := trim(coalesce(new.description, ''));
  if new.description = '' then
    raise exception 'Please describe what you are working on.';
  end if;

  if new.task_id is not null and new.client_id is null then
    select client_id into new.client_id from public.tasks where id = new.task_id;
  end if;
  return new;
end;
$$;


--
-- Name: transfer_task(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transfer_task(p_task uuid, p_to uuid, p_reason text, p_handover text DEFAULT ''::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  t public.tasks%rowtype;
  v_id uuid;
  v_title text;
  v_target_name text;
  v_handover text := trim(coalesce(p_handover, ''));
begin
  if not public.can_manage_task(p_task) then
    raise exception 'Only an administrator, the task reviewer or the person who assigned it can transfer this task. Use "Request transfer" instead.';
  end if;
  select * into t from public.tasks where id = p_task for update;
  if not found then
    raise exception 'Task not found.';
  end if;
  if t.stage = 'Approved' then
    raise exception 'Approved tasks cannot be transferred.';
  end if;
  if p_to is null then
    raise exception 'Choose who the task should go to.';
  end if;
  if p_to = t.assigned_to then
    raise exception 'Choose someone other than the current assignee.';
  end if;
  if p_to = t.reviewer_id then
    raise exception 'The reviewer cannot also do the work. Choose another person or change the reviewer first.';
  end if;
  if not public.is_org_member(p_to, t.org_id) then
    raise exception 'That person is not an active team member.';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please give a reason for the transfer.';
  end if;

  update public.tasks set assigned_to = p_to where id = p_task;

  update public.task_transfers
  set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_note = 'Replaced by a direct transfer'
  where task_id = p_task and status = 'pending';

  insert into public.task_transfers (org_id, task_id, from_user, to_user, requested_by, kind, status, reason, handover_notes, decided_by, decided_at)
  values (t.org_id, p_task, t.assigned_to, p_to, auth.uid(), 'direct', 'completed', trim(p_reason), v_handover, auth.uid(), now())
  returning id into v_id;

  v_title := t.title || coalesce(' · ' || nullif(trim(t.period), ''), '');
  if v_handover <> '' then
    perform public.push_notification(p_to, 'task_handover', 'Handover notes: ' || v_title,
      left(v_handover, 900), '/tasks?task=' || p_task, 'task', p_task, 'normal');
  end if;

  select name into v_target_name from public.profiles where id = p_to;
  perform public.task_audit(p_task, jsonb_build_object(
    'reassigned_to', v_target_name, 'transfer_reason', left(trim(p_reason), 300), 'handover', left(v_handover, 500)));
  return v_id;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: announcement_acks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcement_acks (
    announcement_id uuid NOT NULL,
    user_id uuid NOT NULL,
    acked_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    requires_ack boolean DEFAULT false NOT NULL,
    expires_at date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT announcements_priority_check CHECK ((priority = ANY (ARRAY['normal'::text, 'important'::text])))
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    "timestamp" timestamp with time zone DEFAULT now(),
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: chat_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    name text,
    description text,
    is_private boolean DEFAULT false NOT NULL,
    task_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT chat_channels_check CHECK (((kind <> 'channel'::text) OR (name IS NOT NULL))),
    CONSTRAINT chat_channels_check1 CHECK (((kind <> 'task'::text) OR (task_id IS NOT NULL))),
    CONSTRAINT chat_channels_kind_check CHECK ((kind = ANY (ARRAY['channel'::text, 'dm'::text, 'task'::text])))
);


--
-- Name: chat_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_members (
    channel_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT chat_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text])))
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id uuid NOT NULL,
    sender_id uuid,
    body text DEFAULT ''::text NOT NULL,
    mentions uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: client_duplicate_dismissals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_duplicate_dismissals (
    client_a uuid NOT NULL,
    client_b uuid NOT NULL,
    dismissed_by uuid DEFAULT auth.uid(),
    dismissed_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT client_duplicate_dismissals_check CHECK ((client_a < client_b))
);


--
-- Name: client_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    package_id uuid,
    start_date date DEFAULT CURRENT_DATE,
    status text DEFAULT 'Active'::text,
    created_at timestamp with time zone DEFAULT now(),
    end_date date,
    price numeric,
    billing_cycle text,
    gst_rate numeric,
    bill_day integer,
    due_days integer,
    late_fee_percent numeric,
    late_fee_min numeric,
    prorate_first boolean DEFAULT true NOT NULL,
    auto_send boolean DEFAULT false NOT NULL,
    billing_enabled boolean DEFAULT true NOT NULL,
    next_period_start date,
    last_billed_at timestamp with time zone,
    proposal_id uuid,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT client_packages_bill_day_check CHECK (((bill_day >= 1) AND (bill_day <= 28))),
    CONSTRAINT client_packages_due_days_check CHECK (((due_days >= 0) AND (due_days <= 90))),
    CONSTRAINT client_packages_late_fee_min_check CHECK ((late_fee_min >= (0)::numeric)),
    CONSTRAINT client_packages_late_fee_percent_check CHECK (((late_fee_percent >= (0)::numeric) AND (late_fee_percent <= (10)::numeric)))
);


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT timezone('utc'::text, now()),
    name text NOT NULL,
    type text DEFAULT 'Individual'::text,
    pan text,
    gstin text,
    email text,
    phone text,
    state text,
    status text DEFAULT 'Active'::text,
    address text,
    notes text,
    "assignedTo" text,
    assigned_to uuid,
    created_at timestamp with time zone DEFAULT now(),
    risk_level text DEFAULT 'Low'::text,
    total_revenue numeric DEFAULT 0,
    pending_revenue numeric DEFAULT 0,
    service_requested text,
    lead_source text,
    organization_name text,
    merged_into uuid,
    merged_at timestamp with time zone,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: compliance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    category text DEFAULT 'GST'::text,
    due_date date NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: discussions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discussions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT timezone('utc'::text, now()),
    "clientId" uuid,
    date date NOT NULL,
    summary text NOT NULL,
    notes text,
    staff text,
    "followUpDate" date,
    "followUpDone" boolean DEFAULT false,
    client_id uuid,
    follow_up_date date,
    follow_up_completed boolean DEFAULT false NOT NULL,
    follow_up_completed_at timestamp with time zone,
    handled_by uuid,
    mode text DEFAULT 'Call'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: document_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_counters (
    scope text NOT NULL,
    last_value integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "uploadedAt" timestamp with time zone DEFAULT timezone('utc'::text, now()),
    "clientId" uuid,
    category text,
    description text,
    "fileName" text,
    "sizeBytes" bigint,
    "uploadedBy" text,
    "storagePath" text,
    title text,
    client_id uuid,
    task_id uuid,
    uploaded_by uuid,
    file_url text,
    file_size text,
    created_at timestamp with time zone DEFAULT now(),
    storage_path text,
    bucket text DEFAULT 'firm-documents'::text,
    file_name text,
    size_bytes bigint,
    mime_type text,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: email_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email_address text NOT NULL,
    display_name text NOT NULL,
    smtp_host text,
    smtp_port integer,
    smtp_user text,
    smtp_pass text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    smtp_secret_id uuid,
    imap_host text,
    imap_port integer,
    last_uid bigint,
    uid_validity bigint,
    last_synced_at timestamp with time zone,
    last_sync_error text,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    verified_at timestamp with time zone,
    CONSTRAINT email_accounts_hosts_ok CHECK ((public.mail_host_ok(smtp_host) AND public.mail_host_ok(imap_host) AND ((smtp_port IS NULL) OR ((smtp_port)::text = ANY (ARRAY['25'::text, '465'::text, '587'::text, '2525'::text]))) AND ((imap_port IS NULL) OR ((imap_port)::text = '993'::text))))
);


--
-- Name: email_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid,
    file_name text NOT NULL,
    file_url text NOT NULL,
    file_size text,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: email_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid,
    client_id uuid,
    direction text NOT NULL,
    from_address text NOT NULL,
    to_address text NOT NULL,
    subject text,
    body_text text,
    body_html text,
    is_read boolean DEFAULT false,
    received_at timestamp with time zone DEFAULT now(),
    message_id text,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: engagement_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_settings (
    id integer NOT NULL,
    signatory_name text,
    signatory_designation text DEFAULT 'Partner'::text,
    firm_registration_no text,
    membership_no text,
    termination_notice_days integer DEFAULT 30 NOT NULL,
    jurisdiction text DEFAULT 'New Delhi'::text,
    standard_terms text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT engagement_settings_termination_notice_days_check CHECK (((termination_notice_days >= 0) AND (termination_notice_days <= 365)))
);


--
-- Name: engagement_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.engagement_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: engagement_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.engagement_settings_id_seq OWNED BY public.engagement_settings.id;


--
-- Name: firm_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.firm_settings (
    id integer NOT NULL,
    firm_name text DEFAULT 'My Practice'::text,
    email text,
    phone text,
    website text,
    address text,
    gstin text,
    pan text,
    updated_at timestamp with time zone DEFAULT now(),
    invoice_prefix text DEFAULT 'INV-2026-'::text,
    quotation_prefix text DEFAULT 'QUO-2026-'::text,
    default_gst_rate numeric DEFAULT 18,
    payment_terms text DEFAULT 'Due on Receipt'::text,
    bank_name text,
    bank_account_no text,
    bank_ifsc text,
    upi_id text,
    enable_email_alerts boolean DEFAULT true,
    default_task_priority text DEFAULT 'Medium'::text,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: firm_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.firm_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: firm_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.firm_settings_id_seq OWNED BY public.firm_settings.id;


--
-- Name: invoice_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    paid_on date DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata'::text))::date NOT NULL,
    mode text DEFAULT 'Bank Transfer'::text NOT NULL,
    reference text,
    notes text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT invoice_payments_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: invoice_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_reminders (
    invoice_id uuid NOT NULL,
    kind text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT timezone('utc'::text, now()),
    organisation text,
    date date,
    "dueDate" date,
    "isInterState" boolean DEFAULT false,
    "gstRate" numeric,
    status text DEFAULT 'Draft'::text,
    notes text,
    "amountPaid" numeric DEFAULT 0,
    total numeric DEFAULT 0,
    items jsonb DEFAULT '[]'::jsonb,
    amount_paid numeric DEFAULT 0,
    subtotal numeric DEFAULT 0,
    tax numeric DEFAULT 0,
    is_inter_state boolean DEFAULT false,
    gst_rate numeric DEFAULT 18,
    client_id uuid,
    invoice_number text,
    issue_date date,
    due_date date,
    cgst numeric DEFAULT 0,
    sgst numeric DEFAULT 0,
    igst numeric DEFAULT 0,
    pdf_url text,
    email_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    quotation_id uuid,
    client_package_id uuid,
    billing_period_start date,
    billing_period_end date,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: kpi_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    reviewer_id uuid DEFAULT auth.uid(),
    period_from date NOT NULL,
    period_to date NOT NULL,
    rating integer,
    strengths text,
    improvements text,
    goals text,
    score_snapshot numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT kpi_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: kpi_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_settings (
    id integer NOT NULL,
    w_timeliness integer DEFAULT 35 NOT NULL,
    w_quality integer DEFAULT 30 NOT NULL,
    w_volume integer DEFAULT 20 NOT NULL,
    w_activeness integer DEFAULT 15 NOT NULL,
    working_days_per_week integer DEFAULT 6 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT kpi_settings_w_activeness_check CHECK (((w_activeness >= 0) AND (w_activeness <= 100))),
    CONSTRAINT kpi_settings_w_quality_check CHECK (((w_quality >= 0) AND (w_quality <= 100))),
    CONSTRAINT kpi_settings_w_timeliness_check CHECK (((w_timeliness >= 0) AND (w_timeliness <= 100))),
    CONSTRAINT kpi_settings_w_volume_check CHECK (((w_volume >= 0) AND (w_volume <= 100))),
    CONSTRAINT kpi_settings_working_days_per_week_check CHECK (((working_days_per_week >= 5) AND (working_days_per_week <= 7)))
);


--
-- Name: kpi_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kpi_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kpi_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kpi_settings_id_seq OWNED BY public.kpi_settings.id;


--
-- Name: late_fee_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.late_fee_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    original_invoice_id uuid NOT NULL,
    charged_on_invoice_id uuid,
    amount numeric NOT NULL,
    charge_month date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text NOT NULL,
    email text,
    "serviceRequested" text,
    status text,
    "assignedTo" text,
    "followUpDate" text,
    notes text,
    "createdAt" text,
    "createdBy" text,
    assigned_to uuid,
    company text,
    source text DEFAULT 'Referral'::text,
    estimated_value numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    "estimatedValue" numeric DEFAULT 0,
    converted_client_id uuid,
    referring_client_id uuid,
    organization_name text,
    referred_by text,
    service_requested text,
    conversion_date date,
    follow_up_date date,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memberships (
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'staff'::text NOT NULL,
    is_reviewer boolean DEFAULT false NOT NULL,
    is_support_agent boolean DEFAULT false NOT NULL,
    module_access jsonb,
    designation text,
    is_active boolean DEFAULT true NOT NULL,
    invited_by uuid,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    onboarding jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    entity text,
    entity_id uuid,
    priority text DEFAULT 'normal'::text NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    popup_dismissed_at timestamp with time zone,
    snoozed_until timestamp with time zone,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT notifications_priority_check CHECK ((priority = ANY (ARRAY['normal'::text, 'important'::text])))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    plan text DEFAULT 'professional'::text NOT NULL,
    trial_ends_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    setup jsonb DEFAULT '{}'::jsonb NOT NULL,
    setup_completed_at timestamp with time zone,
    grace_ends_at timestamp with time zone,
    plan_changed_at timestamp with time zone,
    CONSTRAINT organizations_name_check CHECK (((length(TRIM(BOTH FROM name)) >= 2) AND (length(TRIM(BOTH FROM name)) <= 200))),
    CONSTRAINT organizations_slug_check CHECK ((slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'::text)),
    CONSTRAINT organizations_status_check CHECK ((status = ANY (ARRAY['trial'::text, 'active'::text, 'suspended'::text, 'cancelled'::text, 'expired'::text])))
);


--
-- Name: package_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.package_services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    package_id uuid,
    title text NOT NULL,
    category text DEFAULT 'GST'::text,
    days_due_offset integer DEFAULT 10,
    recurrence text DEFAULT 'Monthly'::text,
    default_assignee_id uuid,
    task_type_id uuid,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id text NOT NULL,
    name text NOT NULL,
    max_users integer,
    max_clients integer,
    sort integer DEFAULT 0 NOT NULL
);


--
-- Name: platform_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_admins (
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    role text DEFAULT 'support'::text NOT NULL,
    CONSTRAINT platform_admins_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'support'::text])))
);


--
-- Name: platform_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_config (
    id boolean DEFAULT true NOT NULL,
    legacy_org_id uuid,
    support_org_id uuid,
    CONSTRAINT platform_config_id_check CHECK (id)
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'staff'::text,
    permissions jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    is_reviewer boolean DEFAULT false,
    module_access jsonb DEFAULT '["leads", "tasks", "time_tracking"]'::jsonb,
    phone text,
    designation text,
    is_active boolean DEFAULT true,
    status text DEFAULT 'Active'::text,
    is_support_agent boolean DEFAULT false NOT NULL,
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'staff'::text, 'reviewer'::text])))
);


--
-- Name: proposal_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.proposal_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text,
    client_id uuid NOT NULL,
    package_id uuid NOT NULL,
    status text DEFAULT 'Draft'::text NOT NULL,
    start_date date NOT NULL,
    price numeric NOT NULL,
    billing_cycle text DEFAULT 'Monthly'::text NOT NULL,
    gst_rate numeric DEFAULT 18 NOT NULL,
    bill_day integer DEFAULT 5 NOT NULL,
    due_days integer DEFAULT 5 NOT NULL,
    late_fee_percent numeric DEFAULT 1.5 NOT NULL,
    late_fee_min numeric DEFAULT 100 NOT NULL,
    prorate_first boolean DEFAULT true NOT NULL,
    auto_send boolean DEFAULT false NOT NULL,
    reviewer_id uuid,
    services jsonb DEFAULT '[]'::jsonb NOT NULL,
    scope_of_work text,
    exclusions text,
    client_responsibilities text,
    special_terms text,
    recipient_email text,
    cover_message text,
    expires_at date,
    sent_at timestamp with time zone,
    viewed_at timestamp with time zone,
    accepted_at timestamp with time zone,
    accepted_name text,
    accepted_designation text,
    accepted_method text,
    accepted_ip text,
    accepted_user_agent text,
    decision_note text,
    public_token_hash text,
    client_package_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    original_start_date date,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT proposals_bill_day_check CHECK (((bill_day >= 1) AND (bill_day <= 28))),
    CONSTRAINT proposals_due_days_check CHECK (((due_days >= 0) AND (due_days <= 90))),
    CONSTRAINT proposals_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT proposals_status_check CHECK ((status = ANY (ARRAY['Draft'::text, 'Sent'::text, 'Viewed'::text, 'Accepted'::text, 'Declined'::text, 'Withdrawn'::text])))
);


--
-- Name: quotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text,
    email text,
    date text,
    "validUntil" text,
    items jsonb,
    subtotal numeric,
    tax numeric,
    total numeric,
    status text,
    "createdBy" text,
    client_id uuid,
    quotation_number text,
    valid_until date,
    is_inter_state boolean DEFAULT false,
    gst_rate numeric DEFAULT 18,
    organisation text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    lead_id uuid,
    quote_number text,
    recipient_email text,
    recipient_phone text,
    recipient_name text,
    cgst numeric DEFAULT 0,
    sgst numeric DEFAULT 0,
    igst numeric DEFAULT 0,
    pdf_url text,
    email_sent_at timestamp with time zone,
    address text,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limits (
    key text NOT NULL,
    count integer NOT NULL,
    reset_at timestamp with time zone NOT NULL
);


--
-- Name: reminder_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminder_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    period_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: reminder_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminder_settings (
    id integer NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    not_started_hours integer DEFAULT 24 NOT NULL,
    due_soon_days integer DEFAULT 2 NOT NULL,
    escalate_assigner boolean DEFAULT true NOT NULL,
    overdue_daily boolean DEFAULT true NOT NULL,
    statutory_alert_days integer DEFAULT 2 NOT NULL,
    review_waiting_hours integer DEFAULT 24 NOT NULL,
    work_start time without time zone DEFAULT '09:30:00'::time without time zone NOT NULL,
    work_end time without time zone DEFAULT '19:00:00'::time without time zone NOT NULL,
    skip_sundays boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT reminder_settings_due_soon_days_check CHECK (((due_soon_days >= 0) AND (due_soon_days <= 14))),
    CONSTRAINT reminder_settings_not_started_hours_check CHECK (((not_started_hours >= 1) AND (not_started_hours <= 168))),
    CONSTRAINT reminder_settings_review_waiting_hours_check CHECK (((review_waiting_hours >= 1) AND (review_waiting_hours <= 168))),
    CONSTRAINT reminder_settings_statutory_alert_days_check CHECK (((statutory_alert_days >= 0) AND (statutory_alert_days <= 30)))
);


--
-- Name: reminder_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reminder_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reminder_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reminder_settings_id_seq OWNED BY public.reminder_settings.id;


--
-- Name: service_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    billing_cycle text DEFAULT 'Monthly'::text,
    price numeric(10,2) DEFAULT 0.00,
    created_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true NOT NULL,
    scope_of_work text,
    exclusions text,
    client_responsibilities text,
    special_terms text,
    gst_rate numeric DEFAULT 18 NOT NULL,
    bill_day integer DEFAULT 5 NOT NULL,
    due_days integer DEFAULT 5 NOT NULL,
    late_fee_percent numeric DEFAULT 1.5 NOT NULL,
    late_fee_min numeric DEFAULT 100 NOT NULL,
    prorate_first boolean DEFAULT true NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT service_packages_bill_day_check CHECK (((bill_day >= 1) AND (bill_day <= 28))),
    CONSTRAINT service_packages_due_days_check CHECK (((due_days >= 0) AND (due_days <= 90))),
    CONSTRAINT service_packages_gst_rate_check CHECK (((gst_rate >= (0)::numeric) AND (gst_rate <= (100)::numeric))),
    CONSTRAINT service_packages_late_fee_min_check CHECK ((late_fee_min >= (0)::numeric)),
    CONSTRAINT service_packages_late_fee_percent_check CHECK (((late_fee_percent >= (0)::numeric) AND (late_fee_percent <= (10)::numeric)))
);


--
-- Name: support_answer_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_answer_stats (
    answer_id text NOT NULL,
    shown integer DEFAULT 0 NOT NULL,
    solved integer DEFAULT 0 NOT NULL,
    not_solved integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: support_kb; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_kb (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    area text DEFAULT 'Other'::text NOT NULL,
    phrases text[] DEFAULT '{}'::text[] NOT NULL,
    keywords text[] DEFAULT '{}'::text[] NOT NULL,
    pages text[] DEFAULT '{}'::text[] NOT NULL,
    solution text NOT NULL,
    admin_only boolean DEFAULT false NOT NULL,
    staff_note text,
    escalate boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: support_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    sender_id uuid,
    role text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT support_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'agent'::text, 'system'::text, 'note'::text])))
);


--
-- Name: support_ticket_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_ticket_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text,
    user_id uuid NOT NULL,
    kind text DEFAULT 'help'::text NOT NULL,
    category text,
    subject text NOT NULL,
    status text DEFAULT 'ai'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    assigned_to uuid,
    page_path text,
    user_agent text,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    ai_summary text,
    rating integer,
    rating_comment text,
    escalated_at timestamp with time zone,
    first_response_at timestamp with time zone,
    resolved_at timestamp with time zone,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT support_tickets_kind_check CHECK ((kind = ANY (ARRAY['help'::text, 'feedback'::text]))),
    CONSTRAINT support_tickets_priority_check CHECK ((priority = ANY (ARRAY['normal'::text, 'urgent'::text]))),
    CONSTRAINT support_tickets_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT support_tickets_status_check CHECK ((status = ANY (ARRAY['ai'::text, 'waiting'::text, 'open'::text, 'resolved'::text, 'closed'::text])))
);


--
-- Name: task_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    color text DEFAULT 'slate'::text NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT task_categories_color_check CHECK ((color = ANY (ARRAY['slate'::text, 'blue'::text, 'emerald'::text, 'amber'::text, 'rose'::text, 'violet'::text, 'cyan'::text, 'orange'::text, 'lime'::text, 'pink'::text])))
);


--
-- Name: task_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    from_user uuid,
    to_user uuid,
    requested_by uuid,
    kind text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reason text NOT NULL,
    handover_notes text DEFAULT ''::text NOT NULL,
    decision_note text,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT task_transfers_kind_check CHECK ((kind = ANY (ARRAY['request'::text, 'direct'::text]))),
    CONSTRAINT task_transfers_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text, 'cancelled'::text, 'completed'::text])))
);


--
-- Name: task_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    category text DEFAULT 'Other'::text NOT NULL,
    default_recurrence text DEFAULT 'None'::text NOT NULL,
    statutory_day integer,
    statutory_month_offset integer DEFAULT 0 NOT NULL,
    internal_buffer_days integer DEFAULT 3 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    default_estimate_minutes integer,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT task_types_default_estimate_minutes_check CHECK (((default_estimate_minutes IS NULL) OR ((default_estimate_minutes >= 0) AND (default_estimate_minutes <= 100000)))),
    CONSTRAINT task_types_internal_buffer_days_check CHECK (((internal_buffer_days >= 0) AND (internal_buffer_days <= 60))),
    CONSTRAINT task_types_statutory_day_check CHECK (((statutory_day >= 1) AND (statutory_day <= 31))),
    CONSTRAINT task_types_statutory_month_offset_check CHECK (((statutory_month_offset >= 0) AND (statutory_month_offset <= 12)))
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT timezone('utc'::text, now()),
    title text NOT NULL,
    category text,
    priority text DEFAULT 'Medium'::text,
    status text DEFAULT 'Pending'::text,
    notes text,
    recurrence text DEFAULT 'None'::text,
    "seriesId" uuid,
    assigned_to uuid,
    reviewer_id uuid,
    stage text DEFAULT 'Assigned'::text,
    review_comments text,
    client_id uuid,
    due_date date,
    created_at timestamp with time zone DEFAULT now(),
    time_spent_minutes integer DEFAULT 0,
    official_due_date date,
    organisation text,
    period text,
    task_type_id uuid,
    estimated_minutes integer,
    queue_rank integer,
    assigned_by uuid,
    assigned_at timestamp with time zone,
    stage_changed_at timestamp with time zone,
    started_at timestamp with time zone,
    submitted_at timestamp with time zone,
    return_count integer DEFAULT 0 NOT NULL,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT tasks_estimated_minutes_check CHECK (((estimated_minutes IS NULL) OR ((estimated_minutes >= 0) AND (estimated_minutes <= 100000))))
);


--
-- Name: time_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    client_id uuid,
    task_id uuid,
    description text NOT NULL,
    hours numeric(5,2) DEFAULT 0.00 NOT NULL,
    log_date date DEFAULT CURRENT_DATE,
    is_billable boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    source text DEFAULT 'manual'::text NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    needs_review boolean DEFAULT false NOT NULL,
    edited_at timestamp with time zone,
    org_id uuid DEFAULT public.default_org_id() NOT NULL,
    CONSTRAINT time_logs_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'timer'::text, 'auto'::text])))
);


--
-- Name: time_timers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_timers (
    user_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    description text NOT NULL,
    client_id uuid,
    task_id uuid,
    source text DEFAULT 'timer'::text NOT NULL,
    paused_at timestamp with time zone,
    paused_seconds integer DEFAULT 0 NOT NULL,
    last_seen_at timestamp with time zone,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: user_active_org; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_active_org (
    user_id uuid NOT NULL,
    org_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_activity_days; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_activity_days (
    user_id uuid NOT NULL,
    day date NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    active_minutes integer DEFAULT 0 NOT NULL,
    confirmed_at timestamp with time zone,
    org_id uuid DEFAULT public.default_org_id() NOT NULL
);


--
-- Name: zz_legacy_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zz_legacy_counters (
    id text NOT NULL,
    prefix text,
    year integer,
    seq integer DEFAULT 0
);


--
-- Name: zz_legacy_email_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zz_legacy_email_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_email text NOT NULL,
    subject text NOT NULL,
    body_html text NOT NULL,
    status text DEFAULT 'pending'::text,
    error_message text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: zz_legacy_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zz_legacy_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    permissions jsonb DEFAULT '[]'::jsonb
);


--
-- Name: zz_legacy_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zz_legacy_settings (
    id text NOT NULL,
    "firmName" text,
    "firmAddress" text,
    "firmPAN" text,
    "firmGSTIN" text,
    "firmEmail" text,
    "firmPhone" text,
    "invoicePrefix" text DEFAULT 'INV'::text,
    "defaultGSTRate" numeric DEFAULT 18,
    "firmLogoFile" text,
    "smtpHost" text,
    "smtpPort" integer,
    "smtpUser" text,
    "smtpPass" text,
    "smtpFromName" text,
    "smtpSecure" boolean,
    "imapHost" text,
    "imapPort" integer,
    "imapUser" text,
    "imapPass" text,
    "imapTls" boolean
);


--
-- Name: engagement_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_settings ALTER COLUMN id SET DEFAULT nextval('public.engagement_settings_id_seq'::regclass);


--
-- Name: firm_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_settings ALTER COLUMN id SET DEFAULT nextval('public.firm_settings_id_seq'::regclass);


--
-- Name: kpi_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_settings ALTER COLUMN id SET DEFAULT nextval('public.kpi_settings_id_seq'::regclass);


--
-- Name: reminder_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_settings ALTER COLUMN id SET DEFAULT nextval('public.reminder_settings_id_seq'::regclass);


--
-- Name: announcement_acks announcement_acks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_acks
    ADD CONSTRAINT announcement_acks_pkey PRIMARY KEY (announcement_id, user_id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: chat_channels chat_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_pkey PRIMARY KEY (id);


--
-- Name: chat_channels chat_channels_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_task_id_key UNIQUE (task_id);


--
-- Name: chat_members chat_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT chat_members_pkey PRIMARY KEY (channel_id, user_id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: client_duplicate_dismissals client_duplicate_dismissals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_duplicate_dismissals
    ADD CONSTRAINT client_duplicate_dismissals_pkey PRIMARY KEY (client_a, client_b);


--
-- Name: client_packages client_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_packages
    ADD CONSTRAINT client_packages_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: compliance_events compliance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_events
    ADD CONSTRAINT compliance_events_pkey PRIMARY KEY (id);


--
-- Name: zz_legacy_counters counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zz_legacy_counters
    ADD CONSTRAINT counters_pkey PRIMARY KEY (id);


--
-- Name: discussions discussions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussions
    ADD CONSTRAINT discussions_pkey PRIMARY KEY (id);


--
-- Name: document_counters document_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_counters
    ADD CONSTRAINT document_counters_pkey PRIMARY KEY (org_id, scope);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: email_accounts email_accounts_org_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_org_email_key UNIQUE (org_id, email_address);


--
-- Name: email_accounts email_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_pkey PRIMARY KEY (id);


--
-- Name: email_attachments email_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_pkey PRIMARY KEY (id);


--
-- Name: email_messages email_messages_org_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_org_message_id_key UNIQUE (org_id, message_id);


--
-- Name: email_messages email_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_pkey PRIMARY KEY (id);


--
-- Name: zz_legacy_email_queue email_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zz_legacy_email_queue
    ADD CONSTRAINT email_queue_pkey PRIMARY KEY (id);


--
-- Name: engagement_settings engagement_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_settings
    ADD CONSTRAINT engagement_settings_pkey PRIMARY KEY (id);


--
-- Name: firm_settings firm_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_settings
    ADD CONSTRAINT firm_settings_pkey PRIMARY KEY (id);


--
-- Name: invoice_payments invoice_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_pkey PRIMARY KEY (id);


--
-- Name: invoice_reminders invoice_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_reminders
    ADD CONSTRAINT invoice_reminders_pkey PRIMARY KEY (invoice_id, kind);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: kpi_reviews kpi_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_reviews
    ADD CONSTRAINT kpi_reviews_pkey PRIMARY KEY (id);


--
-- Name: kpi_settings kpi_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_settings
    ADD CONSTRAINT kpi_settings_pkey PRIMARY KEY (id);


--
-- Name: late_fee_charges late_fee_charges_original_invoice_id_charge_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.late_fee_charges
    ADD CONSTRAINT late_fee_charges_original_invoice_id_charge_month_key UNIQUE (original_invoice_id, charge_month);


--
-- Name: late_fee_charges late_fee_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.late_fee_charges
    ADD CONSTRAINT late_fee_charges_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (org_id, user_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: package_services package_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_services
    ADD CONSTRAINT package_services_pkey PRIMARY KEY (id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: platform_admins platform_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (user_id);


--
-- Name: platform_config platform_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_config
    ADD CONSTRAINT platform_config_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_email_key UNIQUE (email);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: proposals proposals_org_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_org_number_key UNIQUE (org_id, number);


--
-- Name: proposals proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_pkey PRIMARY KEY (id);


--
-- Name: quotations quotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_pkey PRIMARY KEY (id);


--
-- Name: rate_limits rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (key);


--
-- Name: reminder_log reminder_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_log
    ADD CONSTRAINT reminder_log_pkey PRIMARY KEY (id);


--
-- Name: reminder_log reminder_log_task_id_user_id_kind_period_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_log
    ADD CONSTRAINT reminder_log_task_id_user_id_kind_period_key_key UNIQUE (task_id, user_id, kind, period_key);


--
-- Name: reminder_settings reminder_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_settings
    ADD CONSTRAINT reminder_settings_pkey PRIMARY KEY (id);


--
-- Name: zz_legacy_roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zz_legacy_roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: service_packages service_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_packages
    ADD CONSTRAINT service_packages_pkey PRIMARY KEY (id);


--
-- Name: zz_legacy_settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zz_legacy_settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: support_answer_stats support_answer_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_answer_stats
    ADD CONSTRAINT support_answer_stats_pkey PRIMARY KEY (answer_id);


--
-- Name: support_kb support_kb_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_kb
    ADD CONSTRAINT support_kb_pkey PRIMARY KEY (id);


--
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_number_key UNIQUE (number);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: task_categories task_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_categories
    ADD CONSTRAINT task_categories_pkey PRIMARY KEY (id);


--
-- Name: task_transfers task_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_transfers
    ADD CONSTRAINT task_transfers_pkey PRIMARY KEY (id);


--
-- Name: task_types task_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_types
    ADD CONSTRAINT task_types_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: time_logs time_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_logs
    ADD CONSTRAINT time_logs_pkey PRIMARY KEY (id);


--
-- Name: time_timers time_timers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_timers
    ADD CONSTRAINT time_timers_pkey PRIMARY KEY (user_id);


--
-- Name: user_active_org user_active_org_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_active_org
    ADD CONSTRAINT user_active_org_pkey PRIMARY KEY (user_id);


--
-- Name: user_activity_days user_activity_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_days
    ADD CONSTRAINT user_activity_days_pkey PRIMARY KEY (user_id, day);


--
-- Name: announcement_acks_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX announcement_acks_org_id_idx ON public.announcement_acks USING btree (org_id);


--
-- Name: announcements_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX announcements_org_id_idx ON public.announcements USING btree (org_id);


--
-- Name: audit_logs_entity_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_entity_ts_idx ON public.audit_logs USING btree (entity_id, "timestamp" DESC);


--
-- Name: audit_logs_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_org_id_idx ON public.audit_logs USING btree (org_id);


--
-- Name: audit_logs_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_ts_idx ON public.audit_logs USING btree ("timestamp" DESC);


--
-- Name: audit_logs_user_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_user_ts_idx ON public.audit_logs USING btree (user_id, "timestamp" DESC);


--
-- Name: chat_channels_name_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX chat_channels_name_uidx ON public.chat_channels USING btree (org_id, lower(name)) WHERE ((kind = 'channel'::text) AND (archived_at IS NULL));


--
-- Name: chat_channels_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_channels_org_id_idx ON public.chat_channels USING btree (org_id);


--
-- Name: chat_members_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_members_org_id_idx ON public.chat_members USING btree (org_id);


--
-- Name: chat_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_members_user_idx ON public.chat_members USING btree (user_id);


--
-- Name: chat_messages_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_channel_idx ON public.chat_messages USING btree (channel_id, created_at DESC);


--
-- Name: chat_messages_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_org_id_idx ON public.chat_messages USING btree (org_id);


--
-- Name: client_duplicate_dismissals_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_duplicate_dismissals_org_id_idx ON public.client_duplicate_dismissals USING btree (org_id);


--
-- Name: client_packages_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_packages_org_id_idx ON public.client_packages USING btree (org_id);


--
-- Name: client_packages_pkg_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_packages_pkg_idx ON public.client_packages USING btree (package_id, status);


--
-- Name: clients_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_name_idx ON public.clients USING btree (name);


--
-- Name: clients_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_org_id_idx ON public.clients USING btree (org_id);


--
-- Name: clients_pan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_pan_idx ON public.clients USING btree (pan);


--
-- Name: clients_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_status_idx ON public.clients USING btree (status);


--
-- Name: compliance_events_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_events_due_idx ON public.compliance_events USING btree (due_date);


--
-- Name: compliance_events_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compliance_events_org_id_idx ON public.compliance_events USING btree (org_id);


--
-- Name: discussions_client_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discussions_client_date_idx ON public.discussions USING btree (client_id, date DESC);


--
-- Name: discussions_followup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discussions_followup_idx ON public.discussions USING btree (follow_up_date) WHERE (follow_up_completed = false);


--
-- Name: discussions_handled_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discussions_handled_by_idx ON public.discussions USING btree (handled_by);


--
-- Name: discussions_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discussions_org_id_idx ON public.discussions USING btree (org_id);


--
-- Name: document_counters_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_counters_org_id_idx ON public.document_counters USING btree (org_id);


--
-- Name: documents_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_client_idx ON public.documents USING btree (client_id, created_at DESC);


--
-- Name: documents_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_org_id_idx ON public.documents USING btree (org_id);


--
-- Name: documents_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_task_idx ON public.documents USING btree (task_id);


--
-- Name: email_accounts_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_accounts_org_id_idx ON public.email_accounts USING btree (org_id);


--
-- Name: email_accounts_verified_address_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX email_accounts_verified_address_uidx ON public.email_accounts USING btree (lower(email_address)) WHERE (verified_at IS NOT NULL);


--
-- Name: email_attachments_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_attachments_org_id_idx ON public.email_attachments USING btree (org_id);


--
-- Name: email_messages_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_messages_account_idx ON public.email_messages USING btree (account_id, direction, received_at DESC);


--
-- Name: email_messages_list_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_messages_list_idx ON public.email_messages USING btree (direction, received_at DESC);


--
-- Name: email_messages_msgid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_messages_msgid_idx ON public.email_messages USING btree (message_id);


--
-- Name: email_messages_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_messages_org_id_idx ON public.email_messages USING btree (org_id);


--
-- Name: engagement_settings_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX engagement_settings_org_id_idx ON public.engagement_settings USING btree (org_id);


--
-- Name: engagement_settings_org_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX engagement_settings_org_uidx ON public.engagement_settings USING btree (org_id);


--
-- Name: firm_settings_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX firm_settings_org_id_idx ON public.firm_settings USING btree (org_id);


--
-- Name: firm_settings_org_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX firm_settings_org_uidx ON public.firm_settings USING btree (org_id);


--
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_entity ON public.audit_logs USING btree (entity, entity_id);


--
-- Name: idx_tasks_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_due_date ON public.tasks USING btree (due_date);


--
-- Name: idx_tasks_official_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_official_due_date ON public.tasks USING btree (official_due_date);


--
-- Name: invoice_payments_invoice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_payments_invoice_idx ON public.invoice_payments USING btree (invoice_id, paid_on DESC);


--
-- Name: invoice_payments_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_payments_org_id_idx ON public.invoice_payments USING btree (org_id);


--
-- Name: invoice_reminders_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_reminders_org_id_idx ON public.invoice_reminders USING btree (org_id);


--
-- Name: invoices_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_client_idx ON public.invoices USING btree (client_id);


--
-- Name: invoices_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_created_at_idx ON public.invoices USING btree (created_at DESC);


--
-- Name: invoices_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_org_id_idx ON public.invoices USING btree (org_id);


--
-- Name: invoices_org_number_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoices_org_number_uidx ON public.invoices USING btree (org_id, invoice_number) WHERE (invoice_number IS NOT NULL);


--
-- Name: invoices_quotation_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoices_quotation_id_unique ON public.invoices USING btree (quotation_id) WHERE (quotation_id IS NOT NULL);


--
-- Name: invoices_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_status_idx ON public.invoices USING btree (status);


--
-- Name: invoices_subscription_period_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoices_subscription_period_uidx ON public.invoices USING btree (client_package_id, billing_period_start) WHERE ((client_package_id IS NOT NULL) AND (status <> 'Cancelled'::text));


--
-- Name: kpi_reviews_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kpi_reviews_org_id_idx ON public.kpi_reviews USING btree (org_id);


--
-- Name: kpi_reviews_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kpi_reviews_user_idx ON public.kpi_reviews USING btree (user_id, created_at DESC);


--
-- Name: kpi_settings_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kpi_settings_org_id_idx ON public.kpi_settings USING btree (org_id);


--
-- Name: kpi_settings_org_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX kpi_settings_org_uidx ON public.kpi_settings USING btree (org_id);


--
-- Name: late_fee_charges_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX late_fee_charges_org_id_idx ON public.late_fee_charges USING btree (org_id);


--
-- Name: leads_assigned_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_assigned_to_idx ON public.leads USING btree (assigned_to);


--
-- Name: leads_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_created_at_idx ON public.leads USING btree (created_at DESC);


--
-- Name: leads_follow_up_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_follow_up_idx ON public.leads USING btree (follow_up_date);


--
-- Name: leads_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_org_id_idx ON public.leads USING btree (org_id);


--
-- Name: leads_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_status_idx ON public.leads USING btree (status);


--
-- Name: memberships_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memberships_user_idx ON public.memberships USING btree (user_id);


--
-- Name: notifications_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_org_id_idx ON public.notifications USING btree (org_id);


--
-- Name: notifications_snooze_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_snooze_idx ON public.notifications USING btree (snoozed_until) WHERE (snoozed_until IS NOT NULL);


--
-- Name: notifications_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_unread_idx ON public.notifications USING btree (user_id) WHERE (read_at IS NULL);


--
-- Name: notifications_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_idx ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: package_services_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX package_services_org_id_idx ON public.package_services USING btree (org_id);


--
-- Name: package_services_pkg_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX package_services_pkg_idx ON public.package_services USING btree (package_id);


--
-- Name: proposals_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX proposals_client_idx ON public.proposals USING btree (client_id, created_at DESC);


--
-- Name: proposals_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX proposals_org_id_idx ON public.proposals USING btree (org_id);


--
-- Name: quotations_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotations_created_at_idx ON public.quotations USING btree (created_at DESC);


--
-- Name: quotations_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotations_org_id_idx ON public.quotations USING btree (org_id);


--
-- Name: quotations_org_number_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quotations_org_number_uidx ON public.quotations USING btree (org_id, quote_number) WHERE (quote_number IS NOT NULL);


--
-- Name: quotations_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotations_status_idx ON public.quotations USING btree (status);


--
-- Name: reminder_log_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminder_log_org_id_idx ON public.reminder_log USING btree (org_id);


--
-- Name: reminder_settings_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminder_settings_org_id_idx ON public.reminder_settings USING btree (org_id);


--
-- Name: reminder_settings_org_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reminder_settings_org_uidx ON public.reminder_settings USING btree (org_id);


--
-- Name: service_packages_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_packages_org_id_idx ON public.service_packages USING btree (org_id);


--
-- Name: support_messages_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_messages_org_id_idx ON public.support_messages USING btree (org_id);


--
-- Name: support_messages_ticket_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_messages_ticket_idx ON public.support_messages USING btree (ticket_id, created_at);


--
-- Name: support_tickets_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_tickets_org_id_idx ON public.support_tickets USING btree (org_id);


--
-- Name: support_tickets_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_tickets_status_idx ON public.support_tickets USING btree (status, last_message_at DESC);


--
-- Name: support_tickets_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_tickets_user_idx ON public.support_tickets USING btree (user_id, updated_at DESC);


--
-- Name: task_categories_name_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX task_categories_name_uidx ON public.task_categories USING btree (org_id, lower(TRIM(BOTH FROM name)));


--
-- Name: task_categories_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_categories_org_id_idx ON public.task_categories USING btree (org_id);


--
-- Name: task_transfers_one_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX task_transfers_one_pending ON public.task_transfers USING btree (task_id) WHERE (status = 'pending'::text);


--
-- Name: task_transfers_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_transfers_org_id_idx ON public.task_transfers USING btree (org_id);


--
-- Name: task_transfers_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_transfers_task_idx ON public.task_transfers USING btree (task_id, created_at DESC);


--
-- Name: task_types_name_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX task_types_name_uidx ON public.task_types USING btree (org_id, lower(TRIM(BOTH FROM name)));


--
-- Name: task_types_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_types_org_id_idx ON public.task_types USING btree (org_id);


--
-- Name: tasks_assigned_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_assigned_to_idx ON public.tasks USING btree (assigned_to);


--
-- Name: tasks_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_client_idx ON public.tasks USING btree (client_id);


--
-- Name: tasks_due_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_due_date_idx ON public.tasks USING btree (due_date);


--
-- Name: tasks_official_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_official_due_idx ON public.tasks USING btree (official_due_date);


--
-- Name: tasks_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_org_id_idx ON public.tasks USING btree (org_id);


--
-- Name: tasks_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_queue_idx ON public.tasks USING btree (assigned_to, queue_rank) WHERE (stage <> 'Approved'::text);


--
-- Name: tasks_reviewer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_reviewer_idx ON public.tasks USING btree (reviewer_id);


--
-- Name: tasks_series_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_series_idx ON public.tasks USING btree ("seriesId", due_date);


--
-- Name: tasks_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_stage_idx ON public.tasks USING btree (stage);


--
-- Name: tasks_task_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_task_type_idx ON public.tasks USING btree (task_type_id);


--
-- Name: time_logs_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_logs_client_idx ON public.time_logs USING btree (client_id);


--
-- Name: time_logs_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_logs_date_idx ON public.time_logs USING btree (log_date DESC);


--
-- Name: time_logs_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_logs_org_id_idx ON public.time_logs USING btree (org_id);


--
-- Name: time_logs_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_logs_task_idx ON public.time_logs USING btree (task_id);


--
-- Name: time_logs_user_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_logs_user_date_idx ON public.time_logs USING btree (user_id, log_date DESC);


--
-- Name: time_timers_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_timers_org_id_idx ON public.time_timers USING btree (org_id);


--
-- Name: user_activity_days_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_activity_days_org_id_idx ON public.user_activity_days USING btree (org_id);


--
-- Name: announcements announcements_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER announcements_before_insert BEFORE INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.announcements_before_insert();


--
-- Name: announcements announcements_fan_out; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER announcements_fan_out AFTER INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.announcements_fan_out();


--
-- Name: audit_logs audit_logs_set_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_logs_set_timestamp BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.audit_logs_set_timestamp();


--
-- Name: audit_logs audit_logs_stamp_actor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_logs_stamp_actor BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.audit_logs_stamp_actor();


--
-- Name: chat_messages chat_messages_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER chat_messages_after_insert AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.chat_messages_after_insert();


--
-- Name: chat_messages chat_messages_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER chat_messages_before_insert BEFORE INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.chat_messages_before_insert();


--
-- Name: client_packages client_packages_defaults; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER client_packages_defaults BEFORE INSERT ON public.client_packages FOR EACH ROW EXECUTE FUNCTION public.client_packages_defaults();


--
-- Name: clients clients_before_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER clients_before_delete BEFORE DELETE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.clients_before_delete();


--
-- Name: clients clients_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER clients_before_write BEFORE INSERT OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.clients_before_write();


--
-- Name: clients clients_enforce_plan; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER clients_enforce_plan BEFORE INSERT OR UPDATE OF status ON public.clients FOR EACH ROW EXECUTE FUNCTION public.clients_enforce_plan();


--
-- Name: clients clients_guard_history_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER clients_guard_history_delete BEFORE DELETE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.clients_guard_history_delete();


--
-- Name: discussions discussions_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER discussions_before_write BEFORE INSERT OR UPDATE ON public.discussions FOR EACH ROW EXECUTE FUNCTION public.discussions_before_write();


--
-- Name: documents documents_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documents_before_write BEFORE INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.documents_before_write();


--
-- Name: documents documents_check_path; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER documents_check_path BEFORE INSERT OR UPDATE OF storage_path, bucket, org_id ON public.documents FOR EACH ROW EXECUTE FUNCTION public.documents_check_path();


--
-- Name: email_accounts email_accounts_cleanup_secret; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER email_accounts_cleanup_secret AFTER DELETE ON public.email_accounts FOR EACH ROW EXECUTE FUNCTION public.email_accounts_cleanup_secret();


--
-- Name: email_accounts email_accounts_guard_verified; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER email_accounts_guard_verified BEFORE INSERT OR UPDATE ON public.email_accounts FOR EACH ROW EXECUTE FUNCTION public.email_accounts_guard_verified();


--
-- Name: email_accounts email_accounts_protect_secret; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER email_accounts_protect_secret BEFORE INSERT OR UPDATE ON public.email_accounts FOR EACH ROW EXECUTE FUNCTION public.email_accounts_protect_secret();


--
-- Name: firm_settings firm_settings_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER firm_settings_before_write BEFORE UPDATE ON public.firm_settings FOR EACH ROW EXECUTE FUNCTION public.firm_settings_before_write();


--
-- Name: invoice_payments invoice_payments_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invoice_payments_before_insert BEFORE INSERT ON public.invoice_payments FOR EACH ROW EXECUTE FUNCTION public.invoice_payments_before_insert();


--
-- Name: invoice_payments invoice_payments_sync; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invoice_payments_sync AFTER INSERT OR DELETE ON public.invoice_payments FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_paid();


--
-- Name: invoices invoices_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invoices_before_write BEFORE INSERT OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.invoices_before_write();


--
-- Name: memberships memberships_enforce_plan; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER memberships_enforce_plan BEFORE INSERT OR UPDATE OF is_active ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.memberships_enforce_plan();


--
-- Name: memberships memberships_join_general; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER memberships_join_general AFTER INSERT ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.memberships_join_general();


--
-- Name: notifications notifications_before_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notifications_before_update BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.notifications_before_update();


--
-- Name: organizations organizations_normalize_plan; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organizations_normalize_plan BEFORE INSERT OR UPDATE OF plan ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.organizations_normalize_plan();


--
-- Name: profiles profiles_guard_support_flag; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_guard_support_flag BEFORE UPDATE OF is_support_agent ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_support_flag();


--
-- Name: profiles profiles_sync_membership; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_sync_membership AFTER UPDATE OF role, is_reviewer, is_support_agent, module_access, designation, is_active ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_sync_membership();


--
-- Name: proposals proposals_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER proposals_before_write BEFORE INSERT OR UPDATE ON public.proposals FOR EACH ROW EXECUTE FUNCTION public.proposals_before_write();


--
-- Name: profiles protect_profiles_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER protect_profiles_trigger BEFORE INSERT OR DELETE OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profiles();


--
-- Name: quotations quotations_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER quotations_before_write BEFORE INSERT OR UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.quotations_before_write();


--
-- Name: support_messages support_messages_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER support_messages_after_insert AFTER INSERT ON public.support_messages FOR EACH ROW EXECUTE FUNCTION public.support_messages_after_insert();


--
-- Name: support_tickets support_tickets_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER support_tickets_before_insert BEFORE INSERT ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.support_tickets_before_insert();


--
-- Name: support_tickets support_tickets_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER support_tickets_notify AFTER INSERT OR UPDATE OF status ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.support_tickets_notify();


--
-- Name: task_types task_types_after_rename; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER task_types_after_rename AFTER UPDATE OF name ON public.task_types FOR EACH ROW EXECUTE FUNCTION public.task_types_after_rename();


--
-- Name: tasks tasks_after_approve; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tasks_after_approve AFTER UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tasks_after_approve();


--
-- Name: tasks tasks_assignment_meta; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tasks_assignment_meta BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tasks_assignment_meta();


--
-- Name: tasks tasks_auto_timer; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tasks_auto_timer AFTER UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tasks_auto_timer();


--
-- Name: tasks tasks_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tasks_before_write BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tasks_before_write();


--
-- Name: tasks tasks_carry_period; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tasks_carry_period BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tasks_carry_period();


--
-- Name: tasks tasks_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tasks_notify AFTER INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tasks_notify();


--
-- Name: tasks tasks_task_type_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tasks_task_type_guard BEFORE INSERT OR UPDATE OF title, task_type_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tasks_task_type_guard();


--
-- Name: time_logs time_logs_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER time_logs_before_write BEFORE INSERT OR DELETE OR UPDATE ON public.time_logs FOR EACH ROW EXECUTE FUNCTION public.time_logs_before_write();


--
-- Name: time_logs time_logs_sync_task; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER time_logs_sync_task AFTER INSERT OR DELETE OR UPDATE ON public.time_logs FOR EACH ROW EXECUTE FUNCTION public.sync_task_time();


--
-- Name: time_timers time_timers_before_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER time_timers_before_write BEFORE INSERT OR UPDATE ON public.time_timers FOR EACH ROW EXECUTE FUNCTION public.time_timers_before_write();


--
-- Name: announcement_acks zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF announcement_id ON public.announcement_acks FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('announcements', 'announcement_id');


--
-- Name: chat_members zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF channel_id ON public.chat_members FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('chat_channels', 'channel_id');


--
-- Name: chat_messages zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF channel_id ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('chat_channels', 'channel_id');


--
-- Name: client_packages zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF client_id ON public.client_packages FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('clients', 'client_id');


--
-- Name: discussions zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF client_id ON public.discussions FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('clients', 'client_id');


--
-- Name: documents zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF client_id ON public.documents FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('clients', 'client_id');


--
-- Name: email_attachments zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF message_id ON public.email_attachments FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('email_messages', 'message_id');


--
-- Name: email_messages zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF account_id ON public.email_messages FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('email_accounts', 'account_id');


--
-- Name: invoice_payments zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF invoice_id ON public.invoice_payments FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('invoices', 'invoice_id');


--
-- Name: invoice_reminders zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF invoice_id ON public.invoice_reminders FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('invoices', 'invoice_id');


--
-- Name: invoices zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF client_id ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('clients', 'client_id');


--
-- Name: late_fee_charges zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF original_invoice_id ON public.late_fee_charges FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('invoices', 'original_invoice_id');


--
-- Name: package_services zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF package_id ON public.package_services FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('service_packages', 'package_id');


--
-- Name: proposals zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF client_id ON public.proposals FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('clients', 'client_id');


--
-- Name: quotations zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF client_id ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('clients', 'client_id');


--
-- Name: reminder_log zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF task_id ON public.reminder_log FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('tasks', 'task_id');


--
-- Name: support_messages zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF ticket_id ON public.support_messages FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('support_tickets', 'ticket_id');


--
-- Name: task_transfers zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF task_id ON public.task_transfers FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('tasks', 'task_id');


--
-- Name: tasks zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF client_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('clients', 'client_id');


--
-- Name: time_logs zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF task_id ON public.time_logs FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('tasks', 'task_id');


--
-- Name: time_timers zz_inherit_org; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER zz_inherit_org BEFORE INSERT OR UPDATE OF task_id ON public.time_timers FOR EACH ROW EXECUTE FUNCTION public.inherit_org_id('tasks', 'task_id');


--
-- Name: announcement_acks announcement_acks_announcement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_acks
    ADD CONSTRAINT announcement_acks_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE;


--
-- Name: announcement_acks announcement_acks_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_acks
    ADD CONSTRAINT announcement_acks_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: announcement_acks announcement_acks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_acks
    ADD CONSTRAINT announcement_acks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: announcements announcements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: announcements announcements_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: audit_logs audit_logs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: chat_channels chat_channels_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: chat_channels chat_channels_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: chat_channels chat_channels_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: chat_members chat_members_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT chat_members_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON DELETE CASCADE;


--
-- Name: chat_members chat_members_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT chat_members_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: chat_members chat_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT chat_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: chat_messages chat_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: client_duplicate_dismissals client_duplicate_dismissals_client_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_duplicate_dismissals
    ADD CONSTRAINT client_duplicate_dismissals_client_a_fkey FOREIGN KEY (client_a) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_duplicate_dismissals client_duplicate_dismissals_client_b_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_duplicate_dismissals
    ADD CONSTRAINT client_duplicate_dismissals_client_b_fkey FOREIGN KEY (client_b) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_duplicate_dismissals client_duplicate_dismissals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_duplicate_dismissals
    ADD CONSTRAINT client_duplicate_dismissals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: client_packages client_packages_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_packages
    ADD CONSTRAINT client_packages_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: client_packages client_packages_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_packages
    ADD CONSTRAINT client_packages_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: client_packages client_packages_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_packages
    ADD CONSTRAINT client_packages_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.service_packages(id) ON DELETE CASCADE;


--
-- Name: clients clients_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id);


--
-- Name: clients clients_merged_into_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES public.clients(id);


--
-- Name: clients clients_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: compliance_events compliance_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_events
    ADD CONSTRAINT compliance_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: discussions discussions_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussions
    ADD CONSTRAINT "discussions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: discussions discussions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussions
    ADD CONSTRAINT discussions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: discussions discussions_handled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussions
    ADD CONSTRAINT discussions_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: discussions discussions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussions
    ADD CONSTRAINT discussions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: document_counters document_counters_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_counters
    ADD CONSTRAINT document_counters_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: documents documents_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT "documents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: documents documents_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: documents documents_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: documents documents_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: documents documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: email_accounts email_accounts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: email_attachments email_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.email_messages(id) ON DELETE CASCADE;


--
-- Name: email_attachments email_attachments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_attachments
    ADD CONSTRAINT email_attachments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: email_messages email_messages_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.email_accounts(id) ON DELETE CASCADE;


--
-- Name: email_messages email_messages_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: email_messages email_messages_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: engagement_settings engagement_settings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_settings
    ADD CONSTRAINT engagement_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: firm_settings firm_settings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.firm_settings
    ADD CONSTRAINT firm_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: invoice_payments invoice_payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_payments invoice_payments_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: invoice_reminders invoice_reminders_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_reminders
    ADD CONSTRAINT invoice_reminders_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_reminders invoice_reminders_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_reminders
    ADD CONSTRAINT invoice_reminders_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: invoices invoices_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: invoices invoices_client_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_client_package_id_fkey FOREIGN KEY (client_package_id) REFERENCES public.client_packages(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: invoices invoices_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES public.quotations(id) ON DELETE SET NULL;


--
-- Name: kpi_reviews kpi_reviews_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_reviews
    ADD CONSTRAINT kpi_reviews_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: kpi_reviews kpi_reviews_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_reviews
    ADD CONSTRAINT kpi_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: kpi_reviews kpi_reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_reviews
    ADD CONSTRAINT kpi_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: kpi_settings kpi_settings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_settings
    ADD CONSTRAINT kpi_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: late_fee_charges late_fee_charges_charged_on_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.late_fee_charges
    ADD CONSTRAINT late_fee_charges_charged_on_invoice_id_fkey FOREIGN KEY (charged_on_invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: late_fee_charges late_fee_charges_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.late_fee_charges
    ADD CONSTRAINT late_fee_charges_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: late_fee_charges late_fee_charges_original_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.late_fee_charges
    ADD CONSTRAINT late_fee_charges_original_invoice_id_fkey FOREIGN KEY (original_invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: leads leads_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: leads leads_converted_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_converted_client_id_fkey FOREIGN KEY (converted_client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: leads leads_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: leads leads_referring_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_referring_client_id_fkey FOREIGN KEY (referring_client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: memberships memberships_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: memberships memberships_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: organizations organizations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: package_services package_services_default_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_services
    ADD CONSTRAINT package_services_default_assignee_id_fkey FOREIGN KEY (default_assignee_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: package_services package_services_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_services
    ADD CONSTRAINT package_services_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: package_services package_services_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_services
    ADD CONSTRAINT package_services_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.service_packages(id) ON DELETE CASCADE;


--
-- Name: package_services package_services_task_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_services
    ADD CONSTRAINT package_services_task_type_id_fkey FOREIGN KEY (task_type_id) REFERENCES public.task_types(id) ON DELETE SET NULL;


--
-- Name: platform_admins platform_admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: platform_config platform_config_legacy_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_config
    ADD CONSTRAINT platform_config_legacy_org_id_fkey FOREIGN KEY (legacy_org_id) REFERENCES public.organizations(id);


--
-- Name: platform_config platform_config_support_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_config
    ADD CONSTRAINT platform_config_support_org_id_fkey FOREIGN KEY (support_org_id) REFERENCES public.organizations(id);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: proposals proposals_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: proposals proposals_client_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_client_package_id_fkey FOREIGN KEY (client_package_id) REFERENCES public.client_packages(id) ON DELETE SET NULL;


--
-- Name: proposals proposals_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: proposals proposals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: proposals proposals_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.service_packages(id);


--
-- Name: proposals proposals_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: quotations quotations_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: quotations quotations_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: quotations quotations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: reminder_log reminder_log_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_log
    ADD CONSTRAINT reminder_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: reminder_log reminder_log_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_log
    ADD CONSTRAINT reminder_log_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: reminder_log reminder_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_log
    ADD CONSTRAINT reminder_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: reminder_settings reminder_settings_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_settings
    ADD CONSTRAINT reminder_settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: service_packages service_packages_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_packages
    ADD CONSTRAINT service_packages_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: support_kb support_kb_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_kb
    ADD CONSTRAINT support_kb_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: support_messages support_messages_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: support_messages support_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: support_messages support_messages_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: support_tickets support_tickets_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: support_tickets support_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: task_categories task_categories_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_categories
    ADD CONSTRAINT task_categories_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: task_transfers task_transfers_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_transfers
    ADD CONSTRAINT task_transfers_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: task_transfers task_transfers_from_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_transfers
    ADD CONSTRAINT task_transfers_from_user_fkey FOREIGN KEY (from_user) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: task_transfers task_transfers_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_transfers
    ADD CONSTRAINT task_transfers_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: task_transfers task_transfers_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_transfers
    ADD CONSTRAINT task_transfers_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: task_transfers task_transfers_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_transfers
    ADD CONSTRAINT task_transfers_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_transfers task_transfers_to_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_transfers
    ADD CONSTRAINT task_transfers_to_user_fkey FOREIGN KEY (to_user) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: task_types task_types_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_types
    ADD CONSTRAINT task_types_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: tasks tasks_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: tasks tasks_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_task_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_task_type_id_fkey FOREIGN KEY (task_type_id) REFERENCES public.task_types(id) ON DELETE SET NULL;


--
-- Name: time_logs time_logs_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_logs
    ADD CONSTRAINT time_logs_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: time_logs time_logs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_logs
    ADD CONSTRAINT time_logs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: time_logs time_logs_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_logs
    ADD CONSTRAINT time_logs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: time_logs time_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_logs
    ADD CONSTRAINT time_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: time_timers time_timers_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_timers
    ADD CONSTRAINT time_timers_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: time_timers time_timers_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_timers
    ADD CONSTRAINT time_timers_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: time_timers time_timers_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_timers
    ADD CONSTRAINT time_timers_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: time_timers time_timers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_timers
    ADD CONSTRAINT time_timers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_active_org user_active_org_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_active_org
    ADD CONSTRAINT user_active_org_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: user_active_org user_active_org_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_active_org
    ADD CONSTRAINT user_active_org_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_activity_days user_activity_days_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_days
    ADD CONSTRAINT user_activity_days_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;


--
-- Name: user_activity_days user_activity_days_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity_days
    ADD CONSTRAINT user_activity_days_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: announcement_acks acks_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acks_insert_own ON public.announcement_acks FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT public.is_active_user() AS is_active_user)));


--
-- Name: announcement_acks acks_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY acks_select_own_or_admin ON public.announcement_acks FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));


--
-- Name: user_activity_days activity_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activity_select_own_or_admin ON public.user_activity_days FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));


--
-- Name: announcement_acks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.announcement_acks ENABLE ROW LEVEL SECURITY;

--
-- Name: announcements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

--
-- Name: announcements announcements_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcements_select_active ON public.announcements FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: announcements announcements_write_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcements_write_admin ON public.announcements TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs audit_logs_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_logs_insert_own ON public.audit_logs FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_active_user() AS is_active_user) AND (user_id = ( SELECT auth.uid() AS uid))));


--
-- Name: audit_logs audit_logs_read_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_logs_read_scoped ON public.audit_logs FOR SELECT TO authenticated USING ((( SELECT public.is_admin() AS is_admin) OR ((entity = 'TASKS'::text) AND (( SELECT public.has_module('tasks'::text) AS has_module) OR ( SELECT public.is_reviewer() AS is_reviewer))) OR ((entity = ANY (ARRAY['LEADS'::text, 'LEAD_DISCUSSION'::text])) AND ( SELECT public.has_module('leads'::text) AS has_module))));


--
-- Name: email_attachments baseline_active_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY baseline_active_staff ON public.email_attachments TO authenticated USING (( SELECT public.is_active_user() AS is_active_user)) WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: zz_legacy_counters baseline_active_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY baseline_active_staff ON public.zz_legacy_counters TO authenticated USING (( SELECT public.is_active_user() AS is_active_user)) WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: zz_legacy_email_queue baseline_active_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY baseline_active_staff ON public.zz_legacy_email_queue TO authenticated USING (( SELECT public.is_active_user() AS is_active_user)) WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: chat_channels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_channels chat_channels_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_channels_select ON public.chat_channels FOR SELECT TO authenticated USING (( SELECT public.chat_can_access(chat_channels.id) AS chat_can_access));


--
-- Name: chat_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_members ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_members chat_members_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_members_select ON public.chat_members FOR SELECT TO authenticated USING (( SELECT public.chat_can_access(chat_members.channel_id) AS chat_can_access));


--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages chat_messages_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_messages_insert ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (((sender_id = ( SELECT auth.uid() AS uid)) AND ( SELECT public.chat_can_access(chat_messages.channel_id) AS chat_can_access)));


--
-- Name: chat_messages chat_messages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_messages_select ON public.chat_messages FOR SELECT TO authenticated USING (( SELECT public.chat_can_access(chat_messages.channel_id) AS chat_can_access));


--
-- Name: client_duplicate_dismissals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_duplicate_dismissals ENABLE ROW LEVEL SECURITY;

--
-- Name: client_packages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_packages ENABLE ROW LEVEL SECURITY;

--
-- Name: client_packages client_packages_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_packages_select_active ON public.client_packages FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: client_packages client_packages_write_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_packages_write_admin ON public.client_packages TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

--
-- Name: clients clients_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_delete_admin ON public.clients FOR DELETE TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: clients clients_insert_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_insert_active ON public.clients FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: clients clients_insert_module_gate; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_insert_module_gate ON public.clients AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (( SELECT public.has_module('leads'::text) AS has_module));


--
-- Name: clients clients_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_select_active ON public.clients FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: clients clients_update_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_update_active ON public.clients FOR UPDATE TO authenticated USING (( SELECT public.is_active_user() AS is_active_user)) WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: clients clients_update_module_gate; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_update_module_gate ON public.clients AS RESTRICTIVE FOR UPDATE TO authenticated USING (( SELECT public.has_module('leads'::text) AS has_module)) WITH CHECK (( SELECT public.has_module('leads'::text) AS has_module));


--
-- Name: compliance_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_events ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_events compliance_events_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_events_delete_admin ON public.compliance_events FOR DELETE TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: compliance_events compliance_events_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_events_insert_admin ON public.compliance_events FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: compliance_events compliance_events_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_events_select_active ON public.compliance_events FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: compliance_events compliance_events_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_events_update_admin ON public.compliance_events FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: firm_settings config_read_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_read_active ON public.firm_settings FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: package_services config_read_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_read_active ON public.package_services FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: service_packages config_read_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_read_active ON public.service_packages FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: zz_legacy_roles config_read_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_read_active ON public.zz_legacy_roles FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: zz_legacy_settings config_read_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_read_active ON public.zz_legacy_settings FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: package_services config_write_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_write_admin ON public.package_services TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: service_packages config_write_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_write_admin ON public.service_packages TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: zz_legacy_roles config_write_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_write_admin ON public.zz_legacy_roles TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: zz_legacy_settings config_write_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_write_admin ON public.zz_legacy_settings TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: discussions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discussions ENABLE ROW LEVEL SECURITY;

--
-- Name: discussions discussions_delete_owner_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discussions_delete_owner_or_admin ON public.discussions FOR DELETE TO authenticated USING ((( SELECT public.is_admin() AS is_admin) OR (created_by = ( SELECT auth.uid() AS uid))));


--
-- Name: discussions discussions_insert_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discussions_insert_active ON public.discussions FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: discussions discussions_module_gate; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discussions_module_gate ON public.discussions AS RESTRICTIVE TO authenticated USING (( SELECT public.has_module('discussions'::text) AS has_module)) WITH CHECK (( SELECT public.has_module('discussions'::text) AS has_module));


--
-- Name: discussions discussions_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discussions_select_active ON public.discussions FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: discussions discussions_update_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discussions_update_active ON public.discussions FOR UPDATE TO authenticated USING (( SELECT public.is_active_user() AS is_active_user)) WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: document_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: documents documents_delete_owner_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_delete_owner_or_admin ON public.documents FOR DELETE TO authenticated USING ((( SELECT public.is_admin() AS is_admin) OR (uploaded_by = ( SELECT auth.uid() AS uid))));


--
-- Name: documents documents_insert_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_insert_active ON public.documents FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: documents documents_module_gate; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_module_gate ON public.documents AS RESTRICTIVE TO authenticated USING (( SELECT public.has_module('documents'::text) AS has_module)) WITH CHECK (( SELECT public.has_module('documents'::text) AS has_module));


--
-- Name: documents documents_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_select_active ON public.documents FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: documents documents_update_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_update_active ON public.documents FOR UPDATE TO authenticated USING (( SELECT public.is_active_user() AS is_active_user)) WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: client_duplicate_dismissals dup_dismissals_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dup_dismissals_admin ON public.client_duplicate_dismissals TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: email_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: email_accounts email_accounts_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_accounts_admin_delete ON public.email_accounts FOR DELETE TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: email_accounts email_accounts_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_accounts_admin_insert ON public.email_accounts FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: email_accounts email_accounts_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_accounts_admin_update ON public.email_accounts FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: email_accounts email_accounts_module_gate; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_accounts_module_gate ON public.email_accounts AS RESTRICTIVE TO authenticated USING (( SELECT public.has_module('dashboard'::text) AS has_module)) WITH CHECK (( SELECT public.has_module('dashboard'::text) AS has_module));


--
-- Name: email_accounts email_accounts_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_accounts_select_active ON public.email_accounts FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: email_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: email_attachments email_attachments_module_gate; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_attachments_module_gate ON public.email_attachments AS RESTRICTIVE TO authenticated USING (( SELECT public.has_module('dashboard'::text) AS has_module)) WITH CHECK (( SELECT public.has_module('dashboard'::text) AS has_module));


--
-- Name: email_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: email_messages email_messages_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_messages_delete_admin ON public.email_messages FOR DELETE TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: email_messages email_messages_insert_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_messages_insert_active ON public.email_messages FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: email_messages email_messages_module_gate; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_messages_module_gate ON public.email_messages AS RESTRICTIVE TO authenticated USING (( SELECT public.has_module('dashboard'::text) AS has_module)) WITH CHECK (( SELECT public.has_module('dashboard'::text) AS has_module));


--
-- Name: email_messages email_messages_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_messages_select_active ON public.email_messages FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: email_messages email_messages_update_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_messages_update_active ON public.email_messages FOR UPDATE TO authenticated USING (( SELECT public.is_active_user() AS is_active_user)) WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: engagement_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_settings engagement_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_settings_select ON public.engagement_settings FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: engagement_settings engagement_settings_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY engagement_settings_update_admin ON public.engagement_settings FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: firm_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.firm_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_payments invoice_payments_module_gate; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoice_payments_module_gate ON public.invoice_payments AS RESTRICTIVE TO authenticated USING (public.has_module('invoices'::text)) WITH CHECK (public.has_module('invoices'::text));


--
-- Name: invoice_reminders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_reminders ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices invoices_insert_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoices_insert_active ON public.invoices FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: invoices invoices_module_gate; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoices_module_gate ON public.invoices AS RESTRICTIVE TO authenticated USING (public.has_module('invoices'::text)) WITH CHECK (public.has_module('invoices'::text));


--
-- Name: invoices invoices_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoices_select_active ON public.invoices FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: invoices invoices_update_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoices_update_active ON public.invoices FOR UPDATE TO authenticated USING (( SELECT public.is_active_user() AS is_active_user)) WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: kpi_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kpi_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: kpi_reviews kpi_reviews_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kpi_reviews_delete_admin ON public.kpi_reviews FOR DELETE TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: kpi_reviews kpi_reviews_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kpi_reviews_insert_admin ON public.kpi_reviews FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_admin() AS is_admin) AND (reviewer_id = ( SELECT auth.uid() AS uid))));


--
-- Name: kpi_reviews kpi_reviews_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kpi_reviews_select ON public.kpi_reviews FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));


--
-- Name: kpi_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kpi_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: kpi_settings kpi_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kpi_settings_select ON public.kpi_settings FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: kpi_settings kpi_settings_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kpi_settings_update_admin ON public.kpi_settings FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: late_fee_charges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.late_fee_charges ENABLE ROW LEVEL SECURITY;

--
-- Name: late_fee_charges late_fees_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY late_fees_admin_read ON public.late_fee_charges FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

--
-- Name: leads leads_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_delete_admin ON public.leads FOR DELETE TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: leads leads_insert_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_insert_active ON public.leads FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: leads leads_module_gate; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_module_gate ON public.leads AS RESTRICTIVE TO authenticated USING (public.has_module('leads'::text)) WITH CHECK (public.has_module('leads'::text));


--
-- Name: leads leads_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_select_active ON public.leads FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: leads leads_update_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_update_active ON public.leads FOR UPDATE TO authenticated USING (( SELECT public.is_active_user() AS is_active_user)) WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: memberships memberships_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY memberships_select ON public.memberships FOR SELECT TO authenticated USING (((org_id IN ( SELECT public.my_org_ids() AS my_org_ids)) OR ( SELECT public.is_platform_owner() AS is_platform_owner)));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_delete_own ON public.notifications FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: notifications notifications_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: notifications notifications_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: announcement_acks org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.announcement_acks AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: announcements org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.announcements AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: audit_logs org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.audit_logs AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: chat_channels org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.chat_channels AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: chat_members org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.chat_members AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: chat_messages org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.chat_messages AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: client_duplicate_dismissals org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.client_duplicate_dismissals AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: client_packages org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.client_packages AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: clients org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.clients AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: compliance_events org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.compliance_events AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: discussions org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.discussions AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: document_counters org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.document_counters AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: documents org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.documents AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: email_accounts org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.email_accounts AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: email_attachments org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.email_attachments AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: email_messages org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.email_messages AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: engagement_settings org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.engagement_settings AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: firm_settings org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.firm_settings AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: invoice_payments org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.invoice_payments AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: invoice_reminders org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.invoice_reminders AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: invoices org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.invoices AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: kpi_reviews org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.kpi_reviews AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: kpi_settings org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.kpi_settings AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: late_fee_charges org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.late_fee_charges AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: leads org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.leads AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: notifications org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.notifications AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: package_services org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.package_services AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: proposals org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.proposals AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: quotations org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.quotations AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: reminder_log org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.reminder_log AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: reminder_settings org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.reminder_settings AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: service_packages org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.service_packages AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: support_messages org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.support_messages AS RESTRICTIVE TO authenticated USING (((org_id = ( SELECT public.current_org_id() AS current_org_id)) OR ( SELECT public.is_platform_admin() AS is_platform_admin))) WITH CHECK (((org_id = ( SELECT public.current_org_id() AS current_org_id)) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));


--
-- Name: support_tickets org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.support_tickets AS RESTRICTIVE TO authenticated USING (((org_id = ( SELECT public.current_org_id() AS current_org_id)) OR ( SELECT public.is_platform_admin() AS is_platform_admin))) WITH CHECK (((org_id = ( SELECT public.current_org_id() AS current_org_id)) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));


--
-- Name: task_categories org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.task_categories AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: task_transfers org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.task_transfers AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: task_types org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.task_types AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: tasks org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.tasks AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: time_logs org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.time_logs AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: time_timers org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.time_timers AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: user_activity_days org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.user_activity_days AS RESTRICTIVE TO authenticated USING ((org_id = ( SELECT public.current_org_id() AS current_org_id))) WITH CHECK ((org_id = ( SELECT public.current_org_id() AS current_org_id)));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations organizations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_select ON public.organizations FOR SELECT TO authenticated USING (((id IN ( SELECT public.my_org_ids() AS my_org_ids)) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));


--
-- Name: package_services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.package_services ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_payments payments_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_delete_admin ON public.invoice_payments FOR DELETE TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: invoice_payments payments_insert_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_insert_active ON public.invoice_payments FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: invoice_payments payments_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_select_active ON public.invoice_payments FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

--
-- Name: plans plans_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY plans_read ON public.plans FOR SELECT TO authenticated USING (true);


--
-- Name: platform_admins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_admins platform_admins_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_admins_select_own ON public.platform_admins FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: platform_admins platform_admins_select_team; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_admins_select_team ON public.platform_admins FOR SELECT TO authenticated USING (( SELECT public.is_platform_admin() AS is_platform_admin));


--
-- Name: platform_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING (((id = ( SELECT auth.uid() AS uid)) OR public.shares_org_with(id) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));


--
-- Name: profiles profiles_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING (((id = ( SELECT auth.uid() AS uid)) OR (( SELECT public.is_admin() AS is_admin) AND public.shares_org_with(id)))) WITH CHECK (((id = ( SELECT auth.uid() AS uid)) OR (( SELECT public.is_admin() AS is_admin) AND public.shares_org_with(id))));


--
-- Name: proposals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

--
-- Name: proposals proposals_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY proposals_admin_all ON public.proposals TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: quotations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;

--
-- Name: quotations quotations_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quotations_delete_admin ON public.quotations FOR DELETE TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: quotations quotations_insert_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quotations_insert_active ON public.quotations FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: quotations quotations_module_gate; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quotations_module_gate ON public.quotations AS RESTRICTIVE TO authenticated USING (public.has_module('quotations'::text)) WITH CHECK (public.has_module('quotations'::text));


--
-- Name: quotations quotations_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quotations_select_active ON public.quotations FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: quotations quotations_update_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quotations_update_active ON public.quotations FOR UPDATE TO authenticated USING (( SELECT public.is_active_user() AS is_active_user)) WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reminder_log ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_log reminder_log_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reminder_log_admin_read ON public.reminder_log FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: reminder_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reminder_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_settings reminder_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reminder_settings_select ON public.reminder_settings FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: reminder_settings reminder_settings_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reminder_settings_update_admin ON public.reminder_settings FOR UPDATE TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: invoice_reminders reminders_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reminders_admin_read ON public.invoice_reminders FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: service_packages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_packages ENABLE ROW LEVEL SECURITY;

--
-- Name: support_answer_stats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_answer_stats ENABLE ROW LEVEL SECURITY;

--
-- Name: support_kb; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_kb ENABLE ROW LEVEL SECURITY;

--
-- Name: support_kb support_kb_agents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY support_kb_agents ON public.support_kb TO authenticated USING (( SELECT public.is_support_agent() AS is_support_agent)) WITH CHECK (( SELECT public.is_support_agent() AS is_support_agent));


--
-- Name: support_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: support_messages support_messages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY support_messages_select ON public.support_messages FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.support_tickets t
  WHERE ((t.id = support_messages.ticket_id) AND ((t.user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_support_agent() AS is_support_agent))))) AND ((role <> 'note'::text) OR ( SELECT public.is_support_agent() AS is_support_agent))));


--
-- Name: support_answer_stats support_stats_agents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY support_stats_agents ON public.support_answer_stats FOR SELECT TO authenticated USING (( SELECT public.is_support_agent() AS is_support_agent));


--
-- Name: support_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: support_tickets support_tickets_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY support_tickets_select ON public.support_tickets FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_support_agent() AS is_support_agent)));


--
-- Name: task_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: task_categories task_categories_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_categories_select_active ON public.task_categories FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: task_categories task_categories_write_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_categories_write_admin ON public.task_categories TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: task_transfers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_transfers ENABLE ROW LEVEL SECURITY;

--
-- Name: task_transfers task_transfers_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_transfers_select ON public.task_transfers FOR SELECT TO authenticated USING ((( SELECT public.is_active_user() AS is_active_user) AND (( SELECT public.is_admin() AS is_admin) OR ((((( SELECT auth.uid() AS uid) = from_user) OR (( SELECT auth.uid() AS uid) = to_user)) OR (( SELECT auth.uid() AS uid) = requested_by)) OR (( SELECT auth.uid() AS uid) = decided_by)) OR (EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = task_transfers.task_id) AND ((t.reviewer_id = ( SELECT auth.uid() AS uid)) OR (t.assigned_by = ( SELECT auth.uid() AS uid)) OR (t.assigned_to = ( SELECT auth.uid() AS uid)))))))));


--
-- Name: task_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_types ENABLE ROW LEVEL SECURITY;

--
-- Name: task_types task_types_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_types_select_active ON public.task_types FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: task_types task_types_write_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_types_write_admin ON public.task_types TO authenticated USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks tasks_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_delete_admin ON public.tasks FOR DELETE TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: tasks tasks_insert_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_insert_active ON public.tasks FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: tasks tasks_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_select_active ON public.tasks FOR SELECT TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: tasks tasks_update_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_update_active ON public.tasks FOR UPDATE TO authenticated USING (( SELECT public.is_active_user() AS is_active_user)) WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: time_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.time_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: time_logs time_logs_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY time_logs_delete ON public.time_logs FOR DELETE TO authenticated USING (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: time_logs time_logs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY time_logs_insert ON public.time_logs FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: time_logs time_logs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY time_logs_select ON public.time_logs FOR SELECT TO authenticated USING ((( SELECT public.is_active_user() AS is_active_user) AND (( SELECT public.is_admin() AS is_admin) OR (user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.id = time_logs.task_id) AND ((t.assigned_to = ( SELECT auth.uid() AS uid)) OR (t.reviewer_id = ( SELECT auth.uid() AS uid)))))))));


--
-- Name: time_logs time_logs_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY time_logs_update ON public.time_logs FOR UPDATE TO authenticated USING (( SELECT public.is_active_user() AS is_active_user)) WITH CHECK (( SELECT public.is_active_user() AS is_active_user));


--
-- Name: time_timers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.time_timers ENABLE ROW LEVEL SECURITY;

--
-- Name: time_timers timers_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY timers_delete ON public.time_timers FOR DELETE TO authenticated USING ((( SELECT public.is_admin() AS is_admin) OR (user_id = ( SELECT auth.uid() AS uid))));


--
-- Name: time_timers timers_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY timers_insert_own ON public.time_timers FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_active_user() AS is_active_user) AND (user_id = ( SELECT auth.uid() AS uid))));


--
-- Name: time_timers timers_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY timers_select ON public.time_timers FOR SELECT TO authenticated USING ((( SELECT public.is_admin() AS is_admin) OR (user_id = ( SELECT auth.uid() AS uid))));


--
-- Name: user_active_org; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_active_org ENABLE ROW LEVEL SECURITY;

--
-- Name: user_active_org user_active_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_active_org_select ON public.user_active_org FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: user_activity_days; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_activity_days ENABLE ROW LEVEL SECURITY;

--
-- Name: zz_legacy_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.zz_legacy_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: zz_legacy_email_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.zz_legacy_email_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: zz_legacy_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.zz_legacy_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: zz_legacy_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.zz_legacy_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION accept_proposal_online(p_id uuid, p_name text, p_designation text, p_ip text, p_ua text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.accept_proposal_online(p_id uuid, p_name text, p_designation text, p_ip text, p_ua text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.accept_proposal_online(p_id uuid, p_name text, p_designation text, p_ip text, p_ua text) TO service_role;


--
-- Name: FUNCTION advance_period(p text, p_recurrence text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.advance_period(p text, p_recurrence text) TO anon;
GRANT ALL ON FUNCTION public.advance_period(p text, p_recurrence text) TO authenticated;
GRANT ALL ON FUNCTION public.advance_period(p text, p_recurrence text) TO service_role;


--
-- Name: FUNCTION allocate_document_number(p_table text, p_column text, p_prefix text, p_pad integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.allocate_document_number(p_table text, p_column text, p_prefix text, p_pad integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.allocate_document_number(p_table text, p_column text, p_prefix text, p_pad integer) TO service_role;


--
-- Name: FUNCTION allocate_document_number(p_org uuid, p_table text, p_column text, p_prefix text, p_pad integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.allocate_document_number(p_org uuid, p_table text, p_column text, p_prefix text, p_pad integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.allocate_document_number(p_org uuid, p_table text, p_column text, p_prefix text, p_pad integer) TO service_role;


--
-- Name: FUNCTION announcements_before_insert(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.announcements_before_insert() TO anon;
GRANT ALL ON FUNCTION public.announcements_before_insert() TO authenticated;
GRANT ALL ON FUNCTION public.announcements_before_insert() TO service_role;


--
-- Name: FUNCTION announcements_fan_out(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.announcements_fan_out() TO anon;
GRANT ALL ON FUNCTION public.announcements_fan_out() TO authenticated;
GRANT ALL ON FUNCTION public.announcements_fan_out() TO service_role;


--
-- Name: FUNCTION audit_logs_set_timestamp(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.audit_logs_set_timestamp() TO anon;
GRANT ALL ON FUNCTION public.audit_logs_set_timestamp() TO authenticated;
GRANT ALL ON FUNCTION public.audit_logs_set_timestamp() TO service_role;


--
-- Name: FUNCTION audit_logs_stamp_actor(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.audit_logs_stamp_actor() TO anon;
GRANT ALL ON FUNCTION public.audit_logs_stamp_actor() TO authenticated;
GRANT ALL ON FUNCTION public.audit_logs_stamp_actor() TO service_role;


--
-- Name: FUNCTION auth_email_status(p_email text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.auth_email_status(p_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.auth_email_status(p_email text) TO service_role;


--
-- Name: FUNCTION bump_answer_stat(p_id text, p_field text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.bump_answer_stat(p_id text, p_field text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.bump_answer_stat(p_id text, p_field text) TO service_role;


--
-- Name: FUNCTION can_manage_task(p_task uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_manage_task(p_task uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_manage_task(p_task uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_manage_task(p_task uuid) TO service_role;


--
-- Name: FUNCTION cancel_task_transfer(p_transfer uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_task_transfer(p_transfer uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_task_transfer(p_transfer uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_task_transfer(p_transfer uuid) TO service_role;


--
-- Name: FUNCTION chat_add_members(p_channel uuid, p_users uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.chat_add_members(p_channel uuid, p_users uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_add_members(p_channel uuid, p_users uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.chat_add_members(p_channel uuid, p_users uuid[]) TO service_role;


--
-- Name: FUNCTION chat_archive(p_channel uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.chat_archive(p_channel uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_archive(p_channel uuid) TO authenticated;
GRANT ALL ON FUNCTION public.chat_archive(p_channel uuid) TO service_role;


--
-- Name: FUNCTION chat_can_access(p_channel uuid, p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.chat_can_access(p_channel uuid, p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_can_access(p_channel uuid, p_user uuid) TO authenticated;
GRANT ALL ON FUNCTION public.chat_can_access(p_channel uuid, p_user uuid) TO service_role;


--
-- Name: FUNCTION chat_can_access_text(p text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.chat_can_access_text(p text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_can_access_text(p text) TO authenticated;
GRANT ALL ON FUNCTION public.chat_can_access_text(p text) TO service_role;


--
-- Name: FUNCTION chat_create_channel(p_name text, p_description text, p_private boolean, p_members uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.chat_create_channel(p_name text, p_description text, p_private boolean, p_members uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_create_channel(p_name text, p_description text, p_private boolean, p_members uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.chat_create_channel(p_name text, p_description text, p_private boolean, p_members uuid[]) TO service_role;


--
-- Name: FUNCTION chat_delete_message(p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.chat_delete_message(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_delete_message(p_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.chat_delete_message(p_id uuid) TO service_role;


--
-- Name: FUNCTION chat_edit_message(p_id uuid, p_body text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.chat_edit_message(p_id uuid, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_edit_message(p_id uuid, p_body text) TO authenticated;
GRANT ALL ON FUNCTION public.chat_edit_message(p_id uuid, p_body text) TO service_role;


--
-- Name: FUNCTION chat_join(p_channel uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.chat_join(p_channel uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_join(p_channel uuid) TO authenticated;
GRANT ALL ON FUNCTION public.chat_join(p_channel uuid) TO service_role;


--
-- Name: FUNCTION chat_leave(p_channel uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.chat_leave(p_channel uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_leave(p_channel uuid) TO authenticated;
GRANT ALL ON FUNCTION public.chat_leave(p_channel uuid) TO service_role;


--
-- Name: FUNCTION chat_mark_read(p_channel uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.chat_mark_read(p_channel uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_mark_read(p_channel uuid) TO authenticated;
GRANT ALL ON FUNCTION public.chat_mark_read(p_channel uuid) TO service_role;


--
-- Name: FUNCTION chat_messages_after_insert(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.chat_messages_after_insert() TO anon;
GRANT ALL ON FUNCTION public.chat_messages_after_insert() TO authenticated;
GRANT ALL ON FUNCTION public.chat_messages_after_insert() TO service_role;


--
-- Name: FUNCTION chat_messages_before_insert(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.chat_messages_before_insert() TO anon;
GRANT ALL ON FUNCTION public.chat_messages_before_insert() TO authenticated;
GRANT ALL ON FUNCTION public.chat_messages_before_insert() TO service_role;


--
-- Name: FUNCTION chat_open_dm(p_other uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.chat_open_dm(p_other uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_open_dm(p_other uuid) TO authenticated;
GRANT ALL ON FUNCTION public.chat_open_dm(p_other uuid) TO service_role;


--
-- Name: FUNCTION chat_open_task_thread(p_task uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.chat_open_task_thread(p_task uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_open_task_thread(p_task uuid) TO authenticated;
GRANT ALL ON FUNCTION public.chat_open_task_thread(p_task uuid) TO service_role;


--
-- Name: FUNCTION chat_unread(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.chat_unread() FROM PUBLIC;
GRANT ALL ON FUNCTION public.chat_unread() TO authenticated;
GRANT ALL ON FUNCTION public.chat_unread() TO service_role;


--
-- Name: FUNCTION clamp_day(p_month date, p_day integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.clamp_day(p_month date, p_day integer) TO anon;
GRANT ALL ON FUNCTION public.clamp_day(p_month date, p_day integer) TO authenticated;
GRANT ALL ON FUNCTION public.clamp_day(p_month date, p_day integer) TO service_role;


--
-- Name: FUNCTION client_duplicate_pairs(p_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.client_duplicate_pairs(p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.client_duplicate_pairs(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.client_duplicate_pairs(p_limit integer) TO service_role;


--
-- Name: FUNCTION client_packages_defaults(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.client_packages_defaults() TO anon;
GRANT ALL ON FUNCTION public.client_packages_defaults() TO authenticated;
GRANT ALL ON FUNCTION public.client_packages_defaults() TO service_role;


--
-- Name: FUNCTION clients_before_delete(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.clients_before_delete() TO anon;
GRANT ALL ON FUNCTION public.clients_before_delete() TO authenticated;
GRANT ALL ON FUNCTION public.clients_before_delete() TO service_role;


--
-- Name: FUNCTION clients_before_write(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.clients_before_write() TO anon;
GRANT ALL ON FUNCTION public.clients_before_write() TO authenticated;
GRANT ALL ON FUNCTION public.clients_before_write() TO service_role;


--
-- Name: FUNCTION clients_enforce_plan(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.clients_enforce_plan() TO authenticated;
GRANT ALL ON FUNCTION public.clients_enforce_plan() TO service_role;


--
-- Name: FUNCTION clients_guard_history_delete(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.clients_guard_history_delete() FROM PUBLIC;
GRANT ALL ON FUNCTION public.clients_guard_history_delete() TO service_role;


--
-- Name: FUNCTION close_timer(p_user uuid, p_billable boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.close_timer(p_user uuid, p_billable boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.close_timer(p_user uuid, p_billable boolean) TO service_role;


--
-- Name: FUNCTION compute_service_schedule(p_type_id uuid, p_recurrence text, p_start date, p_fallback_offset integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.compute_service_schedule(p_type_id uuid, p_recurrence text, p_start date, p_fallback_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.compute_service_schedule(p_type_id uuid, p_recurrence text, p_start date, p_fallback_offset integer) TO service_role;


--
-- Name: FUNCTION confirm_my_day(p_day date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_my_day(p_day date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_my_day(p_day date) TO authenticated;
GRANT ALL ON FUNCTION public.confirm_my_day(p_day date) TO service_role;


--
-- Name: FUNCTION convert_lead_to_client(p_lead_id uuid, p_client_type text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.convert_lead_to_client(p_lead_id uuid, p_client_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.convert_lead_to_client(p_lead_id uuid, p_client_type text) TO authenticated;
GRANT ALL ON FUNCTION public.convert_lead_to_client(p_lead_id uuid, p_client_type text) TO service_role;


--
-- Name: FUNCTION convert_quotation_to_invoice(p_quotation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.convert_quotation_to_invoice(p_quotation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.convert_quotation_to_invoice(p_quotation_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.convert_quotation_to_invoice(p_quotation_id uuid) TO service_role;


--
-- Name: FUNCTION current_org_id(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_org_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_org_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_org_id() TO service_role;


--
-- Name: FUNCTION decide_task_transfer(p_transfer uuid, p_approve boolean, p_to uuid, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.decide_task_transfer(p_transfer uuid, p_approve boolean, p_to uuid, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decide_task_transfer(p_transfer uuid, p_approve boolean, p_to uuid, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.decide_task_transfer(p_transfer uuid, p_approve boolean, p_to uuid, p_note text) TO service_role;


--
-- Name: FUNCTION decline_proposal_online(p_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.decline_proposal_online(p_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decline_proposal_online(p_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION default_org_id(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.default_org_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.default_org_id() TO authenticated;
GRANT ALL ON FUNCTION public.default_org_id() TO service_role;


--
-- Name: FUNCTION discussions_before_write(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.discussions_before_write() TO anon;
GRANT ALL ON FUNCTION public.discussions_before_write() TO authenticated;
GRANT ALL ON FUNCTION public.discussions_before_write() TO service_role;


--
-- Name: FUNCTION documents_before_write(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.documents_before_write() TO anon;
GRANT ALL ON FUNCTION public.documents_before_write() TO authenticated;
GRANT ALL ON FUNCTION public.documents_before_write() TO service_role;


--
-- Name: FUNCTION documents_check_path(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.documents_check_path() TO authenticated;
GRANT ALL ON FUNCTION public.documents_check_path() TO service_role;


--
-- Name: FUNCTION email_accounts_cleanup_secret(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.email_accounts_cleanup_secret() TO anon;
GRANT ALL ON FUNCTION public.email_accounts_cleanup_secret() TO authenticated;
GRANT ALL ON FUNCTION public.email_accounts_cleanup_secret() TO service_role;


--
-- Name: FUNCTION email_accounts_guard_verified(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.email_accounts_guard_verified() TO authenticated;
GRANT ALL ON FUNCTION public.email_accounts_guard_verified() TO service_role;


--
-- Name: FUNCTION email_accounts_protect_secret(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.email_accounts_protect_secret() TO anon;
GRANT ALL ON FUNCTION public.email_accounts_protect_secret() TO authenticated;
GRANT ALL ON FUNCTION public.email_accounts_protect_secret() TO service_role;


--
-- Name: FUNCTION enforce_user_limit(p_org uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_user_limit(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_user_limit(p_org uuid) TO service_role;


--
-- Name: FUNCTION expire_trials(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.expire_trials() FROM PUBLIC;
GRANT ALL ON FUNCTION public.expire_trials() TO service_role;


--
-- Name: FUNCTION find_client_matches(p_name text, p_org text, p_pan text, p_gstin text, p_phone text, p_email text, p_exclude uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.find_client_matches(p_name text, p_org text, p_pan text, p_gstin text, p_phone text, p_email text, p_exclude uuid) TO anon;
GRANT ALL ON FUNCTION public.find_client_matches(p_name text, p_org text, p_pan text, p_gstin text, p_phone text, p_email text, p_exclude uuid) TO authenticated;
GRANT ALL ON FUNCTION public.find_client_matches(p_name text, p_org text, p_pan text, p_gstin text, p_phone text, p_email text, p_exclude uuid) TO service_role;


--
-- Name: FUNCTION firm_members(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.firm_members() FROM PUBLIC;
GRANT ALL ON FUNCTION public.firm_members() TO authenticated;
GRANT ALL ON FUNCTION public.firm_members() TO service_role;


--
-- Name: FUNCTION firm_settings_before_write(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.firm_settings_before_write() TO anon;
GRANT ALL ON FUNCTION public.firm_settings_before_write() TO authenticated;
GRANT ALL ON FUNCTION public.firm_settings_before_write() TO service_role;


--
-- Name: FUNCTION generate_subscription_bills(p_run_date date, p_org uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.generate_subscription_bills(p_run_date date, p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.generate_subscription_bills(p_run_date date, p_org uuid) TO service_role;


--
-- Name: FUNCTION get_email_account_secret(p_account_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_email_account_secret(p_account_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_email_account_secret(p_account_id uuid) TO service_role;


--
-- Name: FUNCTION has_module(p_module text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.has_module(p_module text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_module(p_module text) TO authenticated;
GRANT ALL ON FUNCTION public.has_module(p_module text) TO service_role;


--
-- Name: FUNCTION hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer) TO service_role;


--
-- Name: FUNCTION home_org_id(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.home_org_id(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.home_org_id(p_user uuid) TO service_role;


--
-- Name: FUNCTION inherit_org_id(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.inherit_org_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.inherit_org_id() TO service_role;


--
-- Name: FUNCTION internal_onboard(p_client_id uuid, p_package_id uuid, p_start date, p_reviewer uuid, p_terms jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.internal_onboard(p_client_id uuid, p_package_id uuid, p_start date, p_reviewer uuid, p_terms jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.internal_onboard(p_client_id uuid, p_package_id uuid, p_start date, p_reviewer uuid, p_terms jsonb) TO service_role;


--
-- Name: FUNCTION invoice_payments_before_insert(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.invoice_payments_before_insert() TO anon;
GRANT ALL ON FUNCTION public.invoice_payments_before_insert() TO authenticated;
GRANT ALL ON FUNCTION public.invoice_payments_before_insert() TO service_role;


--
-- Name: FUNCTION invoices_before_write(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.invoices_before_write() TO anon;
GRANT ALL ON FUNCTION public.invoices_before_write() TO authenticated;
GRANT ALL ON FUNCTION public.invoices_before_write() TO service_role;


--
-- Name: FUNCTION is_active_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_active_user() TO authenticated;
GRANT ALL ON FUNCTION public.is_active_user() TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION is_org_member(p_user uuid, p_org uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_org_member(p_user uuid, p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_org_member(p_user uuid, p_org uuid) TO service_role;


--
-- Name: FUNCTION is_platform_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_platform_admin() TO service_role;


--
-- Name: FUNCTION is_platform_owner(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_platform_owner() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_platform_owner() TO authenticated;
GRANT ALL ON FUNCTION public.is_platform_owner() TO service_role;


--
-- Name: FUNCTION is_reviewer(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_reviewer() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_reviewer() TO authenticated;
GRANT ALL ON FUNCTION public.is_reviewer() TO service_role;


--
-- Name: FUNCTION is_support_agent(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_support_agent() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_support_agent() TO authenticated;
GRANT ALL ON FUNCTION public.is_support_agent() TO service_role;


--
-- Name: FUNCTION mail_host_ok(h text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.mail_host_ok(h text) TO authenticated;
GRANT ALL ON FUNCTION public.mail_host_ok(h text) TO service_role;


--
-- Name: FUNCTION mark_onboarding(p_patch jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_onboarding(p_patch jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_onboarding(p_patch jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.mark_onboarding(p_patch jsonb) TO service_role;


--
-- Name: FUNCTION mark_proposal_viewed(p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_proposal_viewed(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_proposal_viewed(p_id uuid) TO service_role;


--
-- Name: FUNCTION memberships_enforce_plan(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.memberships_enforce_plan() TO authenticated;
GRANT ALL ON FUNCTION public.memberships_enforce_plan() TO service_role;


--
-- Name: FUNCTION memberships_join_general(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.memberships_join_general() TO anon;
GRANT ALL ON FUNCTION public.memberships_join_general() TO authenticated;
GRANT ALL ON FUNCTION public.memberships_join_general() TO service_role;


--
-- Name: FUNCTION merge_clients(p_keep uuid, p_remove uuid, p_fields jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.merge_clients(p_keep uuid, p_remove uuid, p_fields jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.merge_clients(p_keep uuid, p_remove uuid, p_fields jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.merge_clients(p_keep uuid, p_remove uuid, p_fields jsonb) TO service_role;


--
-- Name: FUNCTION merge_task_types(p_from uuid, p_into uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.merge_task_types(p_from uuid, p_into uuid) TO anon;
GRANT ALL ON FUNCTION public.merge_task_types(p_from uuid, p_into uuid) TO authenticated;
GRANT ALL ON FUNCTION public.merge_task_types(p_from uuid, p_into uuid) TO service_role;


--
-- Name: FUNCTION my_access(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_access() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_access() TO authenticated;
GRANT ALL ON FUNCTION public.my_access() TO service_role;


--
-- Name: FUNCTION my_blocked_firm(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_blocked_firm() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_blocked_firm() TO authenticated;
GRANT ALL ON FUNCTION public.my_blocked_firm() TO service_role;


--
-- Name: FUNCTION my_firms(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_firms() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_firms() TO authenticated;
GRANT ALL ON FUNCTION public.my_firms() TO service_role;


--
-- Name: FUNCTION my_onboarding(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_onboarding() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_onboarding() TO authenticated;
GRANT ALL ON FUNCTION public.my_onboarding() TO service_role;


--
-- Name: FUNCTION my_org_ids(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_org_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_org_ids() TO authenticated;
GRANT ALL ON FUNCTION public.my_org_ids() TO service_role;


--
-- Name: FUNCTION my_plan(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_plan() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_plan() TO authenticated;
GRANT ALL ON FUNCTION public.my_plan() TO service_role;


--
-- Name: FUNCTION my_signup_state(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_signup_state() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_signup_state() TO authenticated;
GRANT ALL ON FUNCTION public.my_signup_state() TO service_role;


--
-- Name: FUNCTION next_document_number(p_scope text, p_seed integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.next_document_number(p_scope text, p_seed integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.next_document_number(p_scope text, p_seed integer) TO service_role;


--
-- Name: FUNCTION norm_party_name(p text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.norm_party_name(p text) TO anon;
GRANT ALL ON FUNCTION public.norm_party_name(p text) TO authenticated;
GRANT ALL ON FUNCTION public.norm_party_name(p text) TO service_role;


--
-- Name: FUNCTION norm_phone(p text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.norm_phone(p text) TO anon;
GRANT ALL ON FUNCTION public.norm_phone(p text) TO authenticated;
GRANT ALL ON FUNCTION public.norm_phone(p text) TO service_role;


--
-- Name: FUNCTION notifications_before_update(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notifications_before_update() TO anon;
GRANT ALL ON FUNCTION public.notifications_before_update() TO authenticated;
GRANT ALL ON FUNCTION public.notifications_before_update() TO service_role;


--
-- Name: FUNCTION notify_platform_support(p_type text, p_title text, p_body text, p_link text, p_entity_id uuid, p_priority text, p_only uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_platform_support(p_type text, p_title text, p_body text, p_link text, p_entity_id uuid, p_priority text, p_only uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_platform_support(p_type text, p_title text, p_body text, p_link text, p_entity_id uuid, p_priority text, p_only uuid) TO service_role;


--
-- Name: FUNCTION onboard_client_package(p_client_id uuid, p_package_id uuid, p_start date, p_reviewer uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.onboard_client_package(p_client_id uuid, p_package_id uuid, p_start date, p_reviewer uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.onboard_client_package(p_client_id uuid, p_package_id uuid, p_start date, p_reviewer uuid) TO authenticated;
GRANT ALL ON FUNCTION public.onboard_client_package(p_client_id uuid, p_package_id uuid, p_start date, p_reviewer uuid) TO service_role;


--
-- Name: FUNCTION org_admin_ids(p_org uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.org_admin_ids(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.org_admin_ids(p_org uuid) TO service_role;


--
-- Name: FUNCTION organizations_normalize_plan(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.organizations_normalize_plan() TO authenticated;
GRANT ALL ON FUNCTION public.organizations_normalize_plan() TO service_role;


--
-- Name: FUNCTION package_schedule_preview(p_package_id uuid, p_start date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.package_schedule_preview(p_package_id uuid, p_start date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.package_schedule_preview(p_package_id uuid, p_start date) TO authenticated;
GRANT ALL ON FUNCTION public.package_schedule_preview(p_package_id uuid, p_start date) TO service_role;


--
-- Name: FUNCTION pause_timer(p_since timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pause_timer(p_since timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pause_timer(p_since timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.pause_timer(p_since timestamp with time zone) TO service_role;


--
-- Name: FUNCTION plan_limit_message(p_org uuid, p_kind text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.plan_limit_message(p_org uuid, p_kind text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.plan_limit_message(p_org uuid, p_kind text) TO service_role;


--
-- Name: FUNCTION plan_refresh_grace(p_org uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.plan_refresh_grace(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.plan_refresh_grace(p_org uuid) TO service_role;


--
-- Name: FUNCTION platform_add_staff(p_email text, p_name text, p_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.platform_add_staff(p_email text, p_name text, p_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_add_staff(p_email text, p_name text, p_role text) TO service_role;


--
-- Name: FUNCTION platform_create_firm(p_name text, p_slug text, p_admin uuid, p_status text, p_trial_days integer, p_copy_lists boolean, p_created_by uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.platform_create_firm(p_name text, p_slug text, p_admin uuid, p_status text, p_trial_days integer, p_copy_lists boolean, p_created_by uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_create_firm(p_name text, p_slug text, p_admin uuid, p_status text, p_trial_days integer, p_copy_lists boolean, p_created_by uuid) TO service_role;


--
-- Name: FUNCTION platform_firm_overview(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.platform_firm_overview() FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_firm_overview() TO service_role;


--
-- Name: FUNCTION platform_seed_firm(p_org uuid, p_name text, p_copy_from uuid, p_copy_lists boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.platform_seed_firm(p_org uuid, p_name text, p_copy_from uuid, p_copy_lists boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.platform_seed_firm(p_org uuid, p_name text, p_copy_from uuid, p_copy_lists boolean) TO service_role;


--
-- Name: FUNCTION presence_heartbeat(p_active boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.presence_heartbeat(p_active boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.presence_heartbeat(p_active boolean) TO authenticated;
GRANT ALL ON FUNCTION public.presence_heartbeat(p_active boolean) TO service_role;


--
-- Name: FUNCTION profiles_guard_support_flag(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.profiles_guard_support_flag() TO anon;
GRANT ALL ON FUNCTION public.profiles_guard_support_flag() TO authenticated;
GRANT ALL ON FUNCTION public.profiles_guard_support_flag() TO service_role;


--
-- Name: FUNCTION profiles_join_general(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.profiles_join_general() TO anon;
GRANT ALL ON FUNCTION public.profiles_join_general() TO authenticated;
GRANT ALL ON FUNCTION public.profiles_join_general() TO service_role;


--
-- Name: FUNCTION profiles_sync_membership(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.profiles_sync_membership() TO anon;
GRANT ALL ON FUNCTION public.profiles_sync_membership() TO authenticated;
GRANT ALL ON FUNCTION public.profiles_sync_membership() TO service_role;


--
-- Name: FUNCTION proposals_before_write(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.proposals_before_write() TO anon;
GRANT ALL ON FUNCTION public.proposals_before_write() TO authenticated;
GRANT ALL ON FUNCTION public.proposals_before_write() TO service_role;


--
-- Name: FUNCTION protect_profiles(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.protect_profiles() TO anon;
GRANT ALL ON FUNCTION public.protect_profiles() TO authenticated;
GRANT ALL ON FUNCTION public.protect_profiles() TO service_role;


--
-- Name: FUNCTION push_notification(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_entity text, p_entity_id uuid, p_priority text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.push_notification(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_entity text, p_entity_id uuid, p_priority text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.push_notification(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_entity text, p_entity_id uuid, p_priority text) TO service_role;


--
-- Name: FUNCTION quotations_before_write(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.quotations_before_write() TO anon;
GRANT ALL ON FUNCTION public.quotations_before_write() TO authenticated;
GRANT ALL ON FUNCTION public.quotations_before_write() TO service_role;


--
-- Name: FUNCTION record_proposal_acceptance(p_id uuid, p_name text, p_designation text, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_proposal_acceptance(p_id uuid, p_name text, p_designation text, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_proposal_acceptance(p_id uuid, p_name text, p_designation text, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.record_proposal_acceptance(p_id uuid, p_name text, p_designation text, p_note text) TO service_role;


--
-- Name: FUNCTION reminder_once(p_task uuid, p_user uuid, p_kind text, p_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reminder_once(p_task uuid, p_user uuid, p_kind text, p_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reminder_once(p_task uuid, p_user uuid, p_kind text, p_key text) TO service_role;


--
-- Name: FUNCTION rename_task_category(p_id uuid, p_new_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rename_task_category(p_id uuid, p_new_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rename_task_category(p_id uuid, p_new_name text) TO authenticated;
GRANT ALL ON FUNCTION public.rename_task_category(p_id uuid, p_new_name text) TO service_role;


--
-- Name: FUNCTION request_task_transfer(p_task uuid, p_to uuid, p_reason text, p_handover text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_task_transfer(p_task uuid, p_to uuid, p_reason text, p_handover text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_task_transfer(p_task uuid, p_to uuid, p_reason text, p_handover text) TO authenticated;
GRANT ALL ON FUNCTION public.request_task_transfer(p_task uuid, p_to uuid, p_reason text, p_handover text) TO service_role;


--
-- Name: FUNCTION reset_work_queue(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reset_work_queue(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reset_work_queue(p_user uuid) TO authenticated;
GRANT ALL ON FUNCTION public.reset_work_queue(p_user uuid) TO service_role;


--
-- Name: FUNCTION resolve_doc_prefix(p_prefix text, p_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.resolve_doc_prefix(p_prefix text, p_date date) TO anon;
GRANT ALL ON FUNCTION public.resolve_doc_prefix(p_prefix text, p_date date) TO authenticated;
GRANT ALL ON FUNCTION public.resolve_doc_prefix(p_prefix text, p_date date) TO service_role;


--
-- Name: FUNCTION resume_timer(p_keep_away_time boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resume_timer(p_keep_away_time boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resume_timer(p_keep_away_time boolean) TO authenticated;
GRANT ALL ON FUNCTION public.resume_timer(p_keep_away_time boolean) TO service_role;


--
-- Name: FUNCTION run_reminders(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.run_reminders() FROM PUBLIC;
GRANT ALL ON FUNCTION public.run_reminders() TO service_role;


--
-- Name: FUNCTION run_reminders_now(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.run_reminders_now() FROM PUBLIC;
GRANT ALL ON FUNCTION public.run_reminders_now() TO authenticated;
GRANT ALL ON FUNCTION public.run_reminders_now() TO service_role;


--
-- Name: FUNCTION save_firm_setup(p_answers jsonb, p_complete boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_firm_setup(p_answers jsonb, p_complete boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_firm_setup(p_answers jsonb, p_complete boolean) TO authenticated;
GRANT ALL ON FUNCTION public.save_firm_setup(p_answers jsonb, p_complete boolean) TO service_role;


--
-- Name: FUNCTION set_active_org(p_org uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_active_org(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_active_org(p_org uuid) TO authenticated;
GRANT ALL ON FUNCTION public.set_active_org(p_org uuid) TO service_role;


--
-- Name: FUNCTION set_org_context(p_org uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_org_context(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_org_context(p_org uuid) TO service_role;


--
-- Name: FUNCTION set_work_queue(p_user uuid, p_task_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_work_queue(p_user uuid, p_task_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_work_queue(p_user uuid, p_task_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.set_work_queue(p_user uuid, p_task_ids uuid[]) TO service_role;


--
-- Name: FUNCTION shares_org_with(target uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.shares_org_with(target uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.shares_org_with(target uuid) TO authenticated;
GRANT ALL ON FUNCTION public.shares_org_with(target uuid) TO service_role;


--
-- Name: FUNCTION snooze_notification(p_id uuid, p_until timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.snooze_notification(p_id uuid, p_until timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.snooze_notification(p_id uuid, p_until timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.snooze_notification(p_id uuid, p_until timestamp with time zone) TO service_role;


--
-- Name: FUNCTION stop_time_timer(p_billable boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.stop_time_timer(p_billable boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.stop_time_timer(p_billable boolean) TO authenticated;
GRANT ALL ON FUNCTION public.stop_time_timer(p_billable boolean) TO service_role;


--
-- Name: FUNCTION storage_folder_allowed(p_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.storage_folder_allowed(p_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.storage_folder_allowed(p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.storage_folder_allowed(p_name text) TO service_role;


--
-- Name: FUNCTION support_file_allowed(p_folder text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.support_file_allowed(p_folder text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.support_file_allowed(p_folder text) TO authenticated;
GRANT ALL ON FUNCTION public.support_file_allowed(p_folder text) TO service_role;


--
-- Name: FUNCTION support_messages_after_insert(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.support_messages_after_insert() TO anon;
GRANT ALL ON FUNCTION public.support_messages_after_insert() TO authenticated;
GRANT ALL ON FUNCTION public.support_messages_after_insert() TO service_role;


--
-- Name: FUNCTION support_tickets_before_insert(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.support_tickets_before_insert() TO anon;
GRANT ALL ON FUNCTION public.support_tickets_before_insert() TO authenticated;
GRANT ALL ON FUNCTION public.support_tickets_before_insert() TO service_role;


--
-- Name: FUNCTION support_tickets_notify(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.support_tickets_notify() TO anon;
GRANT ALL ON FUNCTION public.support_tickets_notify() TO authenticated;
GRANT ALL ON FUNCTION public.support_tickets_notify() TO service_role;


--
-- Name: FUNCTION sync_invoice_paid(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_invoice_paid() TO anon;
GRANT ALL ON FUNCTION public.sync_invoice_paid() TO authenticated;
GRANT ALL ON FUNCTION public.sync_invoice_paid() TO service_role;


--
-- Name: FUNCTION sync_task_time(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_task_time() TO anon;
GRANT ALL ON FUNCTION public.sync_task_time() TO authenticated;
GRANT ALL ON FUNCTION public.sync_task_time() TO service_role;


--
-- Name: FUNCTION task_audit(p_task uuid, p_meta jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.task_audit(p_task uuid, p_meta jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.task_audit(p_task uuid, p_meta jsonb) TO service_role;


--
-- Name: FUNCTION task_types_after_rename(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.task_types_after_rename() TO anon;
GRANT ALL ON FUNCTION public.task_types_after_rename() TO authenticated;
GRANT ALL ON FUNCTION public.task_types_after_rename() TO service_role;


--
-- Name: FUNCTION tasks_after_approve(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tasks_after_approve() TO anon;
GRANT ALL ON FUNCTION public.tasks_after_approve() TO authenticated;
GRANT ALL ON FUNCTION public.tasks_after_approve() TO service_role;


--
-- Name: FUNCTION tasks_assignment_meta(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tasks_assignment_meta() TO anon;
GRANT ALL ON FUNCTION public.tasks_assignment_meta() TO authenticated;
GRANT ALL ON FUNCTION public.tasks_assignment_meta() TO service_role;


--
-- Name: FUNCTION tasks_auto_timer(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tasks_auto_timer() TO anon;
GRANT ALL ON FUNCTION public.tasks_auto_timer() TO authenticated;
GRANT ALL ON FUNCTION public.tasks_auto_timer() TO service_role;


--
-- Name: FUNCTION tasks_before_write(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tasks_before_write() TO anon;
GRANT ALL ON FUNCTION public.tasks_before_write() TO authenticated;
GRANT ALL ON FUNCTION public.tasks_before_write() TO service_role;


--
-- Name: FUNCTION tasks_carry_period(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tasks_carry_period() TO anon;
GRANT ALL ON FUNCTION public.tasks_carry_period() TO authenticated;
GRANT ALL ON FUNCTION public.tasks_carry_period() TO service_role;


--
-- Name: FUNCTION tasks_notify(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tasks_notify() TO anon;
GRANT ALL ON FUNCTION public.tasks_notify() TO authenticated;
GRANT ALL ON FUNCTION public.tasks_notify() TO service_role;


--
-- Name: FUNCTION tasks_task_type_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tasks_task_type_guard() TO anon;
GRANT ALL ON FUNCTION public.tasks_task_type_guard() TO authenticated;
GRANT ALL ON FUNCTION public.tasks_task_type_guard() TO service_role;


--
-- Name: FUNCTION team_scorecards(p_from date, p_to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.team_scorecards(p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.team_scorecards(p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.team_scorecards(p_from date, p_to date) TO service_role;


--
-- Name: FUNCTION time_logs_before_write(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.time_logs_before_write() TO anon;
GRANT ALL ON FUNCTION public.time_logs_before_write() TO authenticated;
GRANT ALL ON FUNCTION public.time_logs_before_write() TO service_role;


--
-- Name: FUNCTION time_timers_before_write(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.time_timers_before_write() TO anon;
GRANT ALL ON FUNCTION public.time_timers_before_write() TO authenticated;
GRANT ALL ON FUNCTION public.time_timers_before_write() TO service_role;


--
-- Name: FUNCTION transfer_task(p_task uuid, p_to uuid, p_reason text, p_handover text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.transfer_task(p_task uuid, p_to uuid, p_reason text, p_handover text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.transfer_task(p_task uuid, p_to uuid, p_reason text, p_handover text) TO authenticated;
GRANT ALL ON FUNCTION public.transfer_task(p_task uuid, p_to uuid, p_reason text, p_handover text) TO service_role;


--
-- Name: TABLE announcement_acks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.announcement_acks TO anon;
GRANT ALL ON TABLE public.announcement_acks TO authenticated;
GRANT ALL ON TABLE public.announcement_acks TO service_role;


--
-- Name: TABLE announcements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.announcements TO anon;
GRANT ALL ON TABLE public.announcements TO authenticated;
GRANT ALL ON TABLE public.announcements TO service_role;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.audit_logs TO anon;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE chat_channels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_channels TO anon;
GRANT ALL ON TABLE public.chat_channels TO authenticated;
GRANT ALL ON TABLE public.chat_channels TO service_role;


--
-- Name: TABLE chat_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_members TO anon;
GRANT ALL ON TABLE public.chat_members TO authenticated;
GRANT ALL ON TABLE public.chat_members TO service_role;


--
-- Name: TABLE chat_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_messages TO anon;
GRANT ALL ON TABLE public.chat_messages TO authenticated;
GRANT ALL ON TABLE public.chat_messages TO service_role;


--
-- Name: TABLE client_duplicate_dismissals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_duplicate_dismissals TO anon;
GRANT ALL ON TABLE public.client_duplicate_dismissals TO authenticated;
GRANT ALL ON TABLE public.client_duplicate_dismissals TO service_role;


--
-- Name: TABLE client_packages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_packages TO anon;
GRANT ALL ON TABLE public.client_packages TO authenticated;
GRANT ALL ON TABLE public.client_packages TO service_role;


--
-- Name: TABLE clients; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.clients TO anon;
GRANT ALL ON TABLE public.clients TO authenticated;
GRANT ALL ON TABLE public.clients TO service_role;


--
-- Name: TABLE compliance_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.compliance_events TO anon;
GRANT ALL ON TABLE public.compliance_events TO authenticated;
GRANT ALL ON TABLE public.compliance_events TO service_role;


--
-- Name: TABLE discussions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.discussions TO anon;
GRANT ALL ON TABLE public.discussions TO authenticated;
GRANT ALL ON TABLE public.discussions TO service_role;


--
-- Name: TABLE document_counters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.document_counters TO anon;
GRANT ALL ON TABLE public.document_counters TO authenticated;
GRANT ALL ON TABLE public.document_counters TO service_role;


--
-- Name: TABLE documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.documents TO anon;
GRANT ALL ON TABLE public.documents TO authenticated;
GRANT ALL ON TABLE public.documents TO service_role;


--
-- Name: TABLE email_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_accounts TO anon;
GRANT ALL ON TABLE public.email_accounts TO authenticated;
GRANT ALL ON TABLE public.email_accounts TO service_role;


--
-- Name: TABLE email_attachments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_attachments TO anon;
GRANT ALL ON TABLE public.email_attachments TO authenticated;
GRANT ALL ON TABLE public.email_attachments TO service_role;


--
-- Name: TABLE email_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_messages TO anon;
GRANT ALL ON TABLE public.email_messages TO authenticated;
GRANT ALL ON TABLE public.email_messages TO service_role;


--
-- Name: TABLE engagement_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.engagement_settings TO anon;
GRANT ALL ON TABLE public.engagement_settings TO authenticated;
GRANT ALL ON TABLE public.engagement_settings TO service_role;


--
-- Name: SEQUENCE engagement_settings_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.engagement_settings_id_seq TO anon;
GRANT ALL ON SEQUENCE public.engagement_settings_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.engagement_settings_id_seq TO service_role;


--
-- Name: TABLE firm_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.firm_settings TO anon;
GRANT ALL ON TABLE public.firm_settings TO authenticated;
GRANT ALL ON TABLE public.firm_settings TO service_role;


--
-- Name: SEQUENCE firm_settings_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.firm_settings_id_seq TO anon;
GRANT ALL ON SEQUENCE public.firm_settings_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.firm_settings_id_seq TO service_role;


--
-- Name: TABLE invoice_payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoice_payments TO anon;
GRANT ALL ON TABLE public.invoice_payments TO authenticated;
GRANT ALL ON TABLE public.invoice_payments TO service_role;


--
-- Name: TABLE invoice_reminders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoice_reminders TO anon;
GRANT ALL ON TABLE public.invoice_reminders TO authenticated;
GRANT ALL ON TABLE public.invoice_reminders TO service_role;


--
-- Name: TABLE invoices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoices TO anon;
GRANT ALL ON TABLE public.invoices TO authenticated;
GRANT ALL ON TABLE public.invoices TO service_role;


--
-- Name: TABLE kpi_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kpi_reviews TO anon;
GRANT ALL ON TABLE public.kpi_reviews TO authenticated;
GRANT ALL ON TABLE public.kpi_reviews TO service_role;


--
-- Name: TABLE kpi_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kpi_settings TO anon;
GRANT ALL ON TABLE public.kpi_settings TO authenticated;
GRANT ALL ON TABLE public.kpi_settings TO service_role;


--
-- Name: SEQUENCE kpi_settings_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.kpi_settings_id_seq TO anon;
GRANT ALL ON SEQUENCE public.kpi_settings_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.kpi_settings_id_seq TO service_role;


--
-- Name: TABLE late_fee_charges; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.late_fee_charges TO anon;
GRANT ALL ON TABLE public.late_fee_charges TO authenticated;
GRANT ALL ON TABLE public.late_fee_charges TO service_role;


--
-- Name: TABLE leads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.leads TO anon;
GRANT ALL ON TABLE public.leads TO authenticated;
GRANT ALL ON TABLE public.leads TO service_role;


--
-- Name: TABLE memberships; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.memberships TO anon;
GRANT ALL ON TABLE public.memberships TO authenticated;
GRANT ALL ON TABLE public.memberships TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE organizations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.organizations TO anon;
GRANT ALL ON TABLE public.organizations TO authenticated;
GRANT ALL ON TABLE public.organizations TO service_role;


--
-- Name: TABLE package_services; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.package_services TO anon;
GRANT ALL ON TABLE public.package_services TO authenticated;
GRANT ALL ON TABLE public.package_services TO service_role;


--
-- Name: TABLE plans; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.plans TO anon;
GRANT ALL ON TABLE public.plans TO authenticated;
GRANT ALL ON TABLE public.plans TO service_role;


--
-- Name: TABLE platform_admins; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.platform_admins TO anon;
GRANT ALL ON TABLE public.platform_admins TO authenticated;
GRANT ALL ON TABLE public.platform_admins TO service_role;


--
-- Name: TABLE platform_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.platform_config TO anon;
GRANT ALL ON TABLE public.platform_config TO authenticated;
GRANT ALL ON TABLE public.platform_config TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: SEQUENCE proposal_number_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.proposal_number_seq TO anon;
GRANT ALL ON SEQUENCE public.proposal_number_seq TO authenticated;
GRANT ALL ON SEQUENCE public.proposal_number_seq TO service_role;


--
-- Name: TABLE proposals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.proposals TO anon;
GRANT ALL ON TABLE public.proposals TO authenticated;
GRANT ALL ON TABLE public.proposals TO service_role;


--
-- Name: TABLE quotations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.quotations TO anon;
GRANT ALL ON TABLE public.quotations TO authenticated;
GRANT ALL ON TABLE public.quotations TO service_role;


--
-- Name: TABLE rate_limits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rate_limits TO anon;
GRANT ALL ON TABLE public.rate_limits TO authenticated;
GRANT ALL ON TABLE public.rate_limits TO service_role;


--
-- Name: TABLE reminder_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reminder_log TO anon;
GRANT ALL ON TABLE public.reminder_log TO authenticated;
GRANT ALL ON TABLE public.reminder_log TO service_role;


--
-- Name: TABLE reminder_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reminder_settings TO anon;
GRANT ALL ON TABLE public.reminder_settings TO authenticated;
GRANT ALL ON TABLE public.reminder_settings TO service_role;


--
-- Name: SEQUENCE reminder_settings_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.reminder_settings_id_seq TO anon;
GRANT ALL ON SEQUENCE public.reminder_settings_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.reminder_settings_id_seq TO service_role;


--
-- Name: TABLE service_packages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.service_packages TO anon;
GRANT ALL ON TABLE public.service_packages TO authenticated;
GRANT ALL ON TABLE public.service_packages TO service_role;


--
-- Name: TABLE support_answer_stats; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.support_answer_stats TO anon;
GRANT ALL ON TABLE public.support_answer_stats TO authenticated;
GRANT ALL ON TABLE public.support_answer_stats TO service_role;


--
-- Name: TABLE support_kb; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.support_kb TO anon;
GRANT ALL ON TABLE public.support_kb TO authenticated;
GRANT ALL ON TABLE public.support_kb TO service_role;


--
-- Name: TABLE support_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.support_messages TO anon;
GRANT ALL ON TABLE public.support_messages TO authenticated;
GRANT ALL ON TABLE public.support_messages TO service_role;


--
-- Name: SEQUENCE support_ticket_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.support_ticket_seq TO anon;
GRANT ALL ON SEQUENCE public.support_ticket_seq TO authenticated;
GRANT ALL ON SEQUENCE public.support_ticket_seq TO service_role;


--
-- Name: TABLE support_tickets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.support_tickets TO anon;
GRANT ALL ON TABLE public.support_tickets TO authenticated;
GRANT ALL ON TABLE public.support_tickets TO service_role;


--
-- Name: TABLE task_categories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.task_categories TO anon;
GRANT ALL ON TABLE public.task_categories TO authenticated;
GRANT ALL ON TABLE public.task_categories TO service_role;


--
-- Name: TABLE task_transfers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.task_transfers TO anon;
GRANT ALL ON TABLE public.task_transfers TO authenticated;
GRANT ALL ON TABLE public.task_transfers TO service_role;


--
-- Name: TABLE task_types; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.task_types TO anon;
GRANT ALL ON TABLE public.task_types TO authenticated;
GRANT ALL ON TABLE public.task_types TO service_role;


--
-- Name: TABLE tasks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tasks TO anon;
GRANT ALL ON TABLE public.tasks TO authenticated;
GRANT ALL ON TABLE public.tasks TO service_role;


--
-- Name: TABLE time_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.time_logs TO anon;
GRANT ALL ON TABLE public.time_logs TO authenticated;
GRANT ALL ON TABLE public.time_logs TO service_role;


--
-- Name: TABLE time_timers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.time_timers TO anon;
GRANT ALL ON TABLE public.time_timers TO authenticated;
GRANT ALL ON TABLE public.time_timers TO service_role;


--
-- Name: TABLE user_active_org; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_active_org TO anon;
GRANT ALL ON TABLE public.user_active_org TO authenticated;
GRANT ALL ON TABLE public.user_active_org TO service_role;


--
-- Name: TABLE user_activity_days; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_activity_days TO anon;
GRANT ALL ON TABLE public.user_activity_days TO authenticated;
GRANT ALL ON TABLE public.user_activity_days TO service_role;


--
-- Name: TABLE zz_legacy_counters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.zz_legacy_counters TO service_role;


--
-- Name: TABLE zz_legacy_email_queue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.zz_legacy_email_queue TO service_role;


--
-- Name: TABLE zz_legacy_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.zz_legacy_roles TO service_role;


--
-- Name: TABLE zz_legacy_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.zz_legacy_settings TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict 1o1qCRsC6zLYfwsEkr2mqfBG2uhRnhjQm31Gzba6cl6XklXKF5ujyWuuQ1jWdSh

