-- ============================================================================
-- Migration 0005: Triggers and Business Logic Functions
-- ============================================================================
-- Handles: new user setup, workspace creation, member joining, last admin protection,
-- join_workspace, move_task_to_workspace, get_or_create_dm
-- ============================================================================

-- 6.1 New user: create profile, Personal workspace and membership
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  insert into profiles (id, email, full_name, avatar_url)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    new.raw_user_meta_data->>'avatar_url');

  insert into workspaces (name, type, created_by)
  values ('Personal', 'personal', new.id) returning id into ws;

  insert into workspace_members (workspace_id, user_id, role) values (ws, new.id, 'admin');
  update profiles set personal_workspace_id = ws where id = new.id;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- 6.2 New team workspace: creator becomes admin, #general channel is created
create or replace function handle_new_team_workspace() returns trigger
language plpgsql security definer set search_path = public as $$
declare ch uuid;
begin
  if new.type = 'team' then
    insert into workspace_members (workspace_id, user_id, role)
    values (new.id, new.created_by, 'admin');
    insert into channels (workspace_id, kind, name, description, created_by)
    values (new.id, 'channel', 'general', 'Default workspace discussion hub', new.created_by)
    returning id into ch;
    insert into channel_members (channel_id, user_id) values (ch, new.created_by);
  end if;
  return new;
end $$;
create trigger on_workspace_created after insert on workspaces
  for each row execute function handle_new_team_workspace();

-- 6.3 Someone joins a team: add them to #general (guests are not auto-added)
create or replace function handle_member_joined() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role in ('admin','member') then
    insert into channel_members (channel_id, user_id)
    select c.id, new.user_id from channels c
    where c.workspace_id = new.workspace_id and c.kind = 'channel' and c.name = 'general'
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger on_member_joined after insert on workspace_members
  for each row execute function handle_member_joined();

-- 6.4 Never remove or demote the last admin of a team
create or replace function protect_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare remaining int;
begin
  if (tg_op = 'DELETE' and old.role = 'admin')
     or (tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin') then
    select count(*) into remaining from workspace_members
      where workspace_id = old.workspace_id and role = 'admin' and user_id <> old.user_id;
    if remaining = 0 and exists (select 1 from workspaces w where w.id = old.workspace_id
                                 and w.type = 'team' and w.deleted_at is null) then
      raise exception 'a team workspace must keep at least one admin' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger protect_last_admin_trg before update or delete on workspace_members
  for each row execute function protect_last_admin();

-- 6.5 Join with an invite code (atomic). Called through Express as the user.
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
  if exists (select 1 from workspace_members
             where workspace_id = ic.workspace_id and user_id = auth.uid()) then
    raise exception 'ALREADY_MEMBER' using errcode = 'P0002'; end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (ic.workspace_id, auth.uid(), ic.role);
  update invite_codes set use_count = use_count + 1 where id = ic.id;
  return ic.workspace_id;
end $$;

-- 6.6 Move a task from one workspace to another (for example Personal to Team)
create or replace function move_task_to_workspace(p_task uuid, p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t tasks%rowtype;
begin
  select * into t from tasks where id = p_task and deleted_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (t.created_by = auth.uid() or is_admin(t.workspace_id)) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from workspace_members where workspace_id = p_target
                 and user_id = auth.uid() and role in ('admin','member')) then
    raise exception 'not a member of the target workspace' using errcode = '42501'; end if;

  perform set_config('planpal.moving', '1', true);
  update tasks set
    workspace_id = p_target,
    label_id = null,
    assignee_id = case when exists (select 1 from workspace_members
        where workspace_id = p_target and user_id = t.assignee_id) then t.assignee_id else null end
  where id = p_task;
  update files set workspace_id = p_target
  where id in (select file_id from task_attachments where task_id = p_task);
end $$;

-- 6.7 Open or create a direct message channel between two members of a team
create or replace function get_or_create_dm(p_workspace uuid, p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare ch uuid;
begin
  if not (is_full_member(p_workspace) and exists (select 1 from workspace_members
      where workspace_id = p_workspace and user_id = p_other and role in ('admin','member'))) then
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
