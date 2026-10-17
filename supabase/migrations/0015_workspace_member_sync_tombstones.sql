-- Keep membership removals available to sync clients without granting access.
alter table workspace_members
  add column deleted_at timestamptz;

create or replace function is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members
     where workspace_id = ws and user_id = auth.uid() and deleted_at is null
  );
$$;

create or replace function member_role_in(ws uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select role from workspace_members
   where workspace_id = ws and user_id = auth.uid() and deleted_at is null;
$$;

create or replace function is_channel_member(ch uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from channel_members cm
      join channels c on c.id = cm.channel_id
     where cm.channel_id = ch
       and cm.user_id = auth.uid()
       and exists (
         select 1 from workspace_members wm
          where wm.workspace_id = c.workspace_id
            and wm.user_id = auth.uid()
            and wm.deleted_at is null
       )
  );
$$;

create or replace function event_workspace(p_event_id uuid) returns uuid
language sql stable security definer
set search_path = public
set row_security = off as $$
  select e.workspace_id
    from events e
   where e.id = p_event_id
     and (
       is_full_member(e.workspace_id)
       or exists (
         select 1
           from event_attendees ea
          where ea.event_id = p_event_id
            and ea.user_id = auth.uid()
            and ea.deleted_at is null
            and is_member(e.workspace_id)
       )
     );
$$;

create or replace function is_event_attendee(p_event_id uuid) returns boolean
language sql stable security definer
set search_path = public
set row_security = off as $$
  select exists (
    select 1
      from event_attendees ea
      join events e on e.id = ea.event_id
     where ea.event_id = p_event_id
       and ea.user_id = auth.uid()
       and ea.deleted_at is null
       and is_member(e.workspace_id)
  );
$$;

drop policy profiles_select on profiles;
create policy profiles_select on profiles for select using (
  id = auth.uid() or exists (
    select 1
      from workspace_members a
      join workspace_members b on a.workspace_id = b.workspace_id
     where a.user_id = auth.uid()
       and a.deleted_at is null
       and b.user_id = profiles.id
       and b.deleted_at is null
  )
);

drop policy wm_select on workspace_members;
create policy wm_select on workspace_members for select using (
  is_member(workspace_id) and (
    is_full_member(workspace_id) or user_id = auth.uid() or role = 'admin'
  )
);

drop policy wm_update on workspace_members;
create policy wm_update on workspace_members for update
  using (is_admin(workspace_id) and not is_personal(workspace_id) and deleted_at is null)
  with check (is_admin(workspace_id) and not is_personal(workspace_id));

create policy wm_leave on workspace_members for update
  using (user_id = auth.uid() and not is_personal(workspace_id) and deleted_at is null)
  with check (user_id = auth.uid() and not is_personal(workspace_id) and deleted_at is not null);

drop policy wm_delete on workspace_members;

create or replace function protect_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare remaining int;
begin
  if (tg_op = 'DELETE' and old.role = 'admin' and old.deleted_at is null)
     or (tg_op = 'UPDATE' and old.deleted_at is null and old.role = 'admin'
         and (new.role <> 'admin' or new.deleted_at is not null)) then
    select count(*) into remaining from workspace_members
      where workspace_id = old.workspace_id
        and role = 'admin'
        and user_id <> old.user_id
        and deleted_at is null;
    if remaining = 0 and exists (
      select 1 from workspaces
       where id = old.workspace_id and type = 'team' and deleted_at is null
    ) then
      raise exception 'a team workspace must keep at least one admin' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create or replace function handle_member_joined() returns trigger
language plpgsql security definer set search_path = public as $$
declare should_add_to_general boolean;
begin
  if tg_op = 'INSERT' then
    should_add_to_general := true;
  else
    should_add_to_general := old.deleted_at is not null or old.role is distinct from new.role;
  end if;
  if new.deleted_at is null and new.role in ('admin','member') and should_add_to_general then
    insert into channel_members (channel_id, user_id)
    select c.id, new.user_id from channels c
     where c.workspace_id = new.workspace_id and c.kind = 'channel' and c.name = 'general'
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger on_member_joined on workspace_members;
create trigger on_member_joined after insert or update of role, deleted_at on workspace_members
  for each row execute function handle_member_joined();

create or replace function join_workspace(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ic invite_codes%rowtype;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into ic from invite_codes where code = upper(trim(p_code)) for update;
  if not found then raise exception 'INVALID_CODE' using errcode = 'P0002'; end if;
  if ic.revoked_at is not null then raise exception 'CODE_REVOKED' using errcode = 'P0002'; end if;
  if ic.expires_at is not null and ic.expires_at < now() then
    raise exception 'CODE_EXPIRED' using errcode = 'P0002'; end if;
  if ic.max_uses is not null and ic.use_count >= ic.max_uses then
    raise exception 'CODE_USED_UP' using errcode = 'P0002'; end if;
  if exists (
    select 1 from workspace_members
     where workspace_id = ic.workspace_id and user_id = auth.uid() and deleted_at is null
  ) then
    raise exception 'ALREADY_MEMBER' using errcode = 'P0002'; end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (ic.workspace_id, auth.uid(), ic.role)
  on conflict (workspace_id, user_id) do update
    set role = excluded.role, joined_at = now(), deleted_at = null;
  update invite_codes set use_count = use_count + 1 where id = ic.id;
  return ic.workspace_id;
end $$;

create or replace function move_task_to_workspace(p_task uuid, p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks%rowtype;
begin
  select * into t from tasks where id = p_task and deleted_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (t.created_by = auth.uid() or is_admin(t.workspace_id)) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (
    select 1 from workspace_members
     where workspace_id = p_target and user_id = auth.uid()
       and role in ('admin','member') and deleted_at is null
  ) then
    raise exception 'not a member of the target workspace' using errcode = '42501'; end if;

  perform set_config('planpal.moving', '1', true);
  update tasks set
    workspace_id = p_target,
    label_id = null,
    assignee_id = case when exists (
      select 1 from workspace_members
       where workspace_id = p_target and user_id = t.assignee_id and deleted_at is null
    ) then t.assignee_id else null end
  where id = p_task;
  update files set workspace_id = p_target
   where id in (select file_id from task_attachments where task_id = p_task);
end $$;

create or replace function get_or_create_dm(p_workspace uuid, p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare ch uuid;
begin
  if not (is_full_member(p_workspace) and exists (
    select 1 from workspace_members
     where workspace_id = p_workspace and user_id = p_other
       and role in ('admin','member') and deleted_at is null
  )) then
    raise exception 'both people must be members of this workspace' using errcode = '42501';
  end if;
  select c.id into ch from channels c
   where c.workspace_id = p_workspace and c.kind = 'dm'
     and exists (select 1 from channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
     and exists (select 1 from channel_members m where m.channel_id = c.id and m.user_id = p_other)
   limit 1;
  if ch is null then
    insert into channels (workspace_id, kind, is_private, created_by)
    values (p_workspace, 'dm', true, auth.uid()) returning id into ch;
    insert into channel_members (channel_id, user_id) values (ch, auth.uid()), (ch, p_other);
  end if;
  return ch;
end $$;

create or replace function search_all(p_query text, p_workspace uuid default null, p_limit int default 20)
returns table (kind text, id uuid, workspace_id uuid, title text, subtitle text, score real, at timestamptz)
language sql stable security invoker set search_path = public as $$
  with q as (select websearch_to_tsquery('simple', p_query) as tsq, p_query as raw)
  select 'task', t.id, t.workspace_id, t.title, t.priority::text,
         (ts_rank(t.search, q.tsq) + similarity(t.title, q.raw))::real, t.due_at
    from tasks t, q
   where t.deleted_at is null
     and (p_workspace is null or t.workspace_id = p_workspace)
     and (t.search @@ q.tsq or t.title % q.raw or t.title ilike '%' || q.raw || '%')
  union all
  select 'document', d.id, d.workspace_id, d.title, d.kind::text,
         (ts_rank(d.search, q.tsq) + similarity(d.title, q.raw))::real, d.updated_at
    from documents d, q
   where d.deleted_at is null
     and (p_workspace is null or d.workspace_id = p_workspace)
     and (d.search @@ q.tsq or d.title % q.raw or d.title ilike '%' || q.raw || '%')
  union all
  select 'person', p.id, wm.workspace_id, p.full_name, p.email,
         similarity(p.full_name, q.raw)::real, null
    from profiles p
    join workspace_members wm on wm.user_id = p.id, q
   where p.deleted_at is null
     and wm.deleted_at is null
     and (p_workspace is null or wm.workspace_id = p_workspace)
     and (p.full_name ilike '%' || q.raw || '%' or p.email ilike '%' || q.raw || '%')
  order by 6 desc
  limit p_limit;
$$;
