-- ============================================================================
-- 0001_types.sql
-- ============================================================================

-- ============================================================================
-- Migration 0001: PostgreSQL Extensions and Custom Types
-- ============================================================================
-- Description: Sets up required PostgreSQL extensions and creates custom enum
--              types used throughout the database schema.
-- Run this in Supabase SQL Editor or via CLI: supabase db push
-- ============================================================================

-- Enable required PostgreSQL extensions
create extension if not exists "pgcrypto";      -- For gen_random_uuid()
create extension if not exists "pg_trgm";       -- For fuzzy text search (similarity)
create extension if not exists "pg_cron";       -- For scheduled jobs (reminders)

-- Workspace Types: personal (one per user) or team (collaborative)
create type workspace_type as enum ('personal', 'team');

-- Member Roles: admin (full control), member (standard access), guest (limited)
create type member_role as enum ('admin', 'member', 'guest');

-- Task Status: workflow states
create type task_status as enum ('todo', 'in_progress', 'completed');

-- Task Priority: importance levels
create type task_priority as enum ('high', 'medium', 'low');

-- Channel Kind: regular channel or direct message
create type channel_kind as enum ('channel', 'dm');

-- Document Kind: uploaded file or written document (Quill editor)
create type document_kind as enum ('file', 'written');

-- Notification Types: all possible notification categories
create type notification_type as enum (
  'task_assigned',          -- Task assigned to you
  'task_updated',           -- Task you're involved with changed
  'task_comment',           -- New comment on your task
  'mention',                -- Someone @mentioned you
  'deadline_approaching',   -- Task due within 24 hours
  'task_overdue',           -- Task past due date
  'event_reminder',         -- Calendar event starting soon
  'chat_message',           -- New chat message
  'member_joined',          -- New member joined workspace
  'system'                  -- System notifications
);

-- Note: Overdue status is NOT stored in the database.
-- A task is overdue when: status <> 'completed' AND due_at < now()


-- ============================================================================
-- 0002_core_tables.sql
-- ============================================================================

-- ============================================================================
-- Migration 0002: Core Tables
-- ============================================================================
-- Creates all core tables: profiles, workspaces, workspace_members, invite_codes,
-- labels, files, tasks, subtasks, task_comments, task_attachments, events,
-- event_attendees, channels, channel_members, messages, folders, documents,
-- notifications, device_tokens
-- ============================================================================

-- Sets updated_at on the server for every insert/update (used for offline sync, last write wins)
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  avatar_url text,
  timezone text not null default 'UTC',
  language text not null default 'en'
    check (language in ('en','es','fr','zh','ko')),
  theme text not null default 'system'
    check (theme in ('light','dark','system')),
  personal_workspace_id uuid,             -- filled by trigger in section 6
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  type workspace_type not null default 'team',
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table profiles
  add constraint profiles_personal_ws_fk
  foreign key (personal_workspace_id) references workspaces(id);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role member_role not null default 'member',
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on workspace_members (user_id);

create table invite_codes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  code text not null unique,                     -- 8 chars, A-Z and 2-9, no look-alike letters
  role member_role not null default 'member',    -- role given to whoever joins with it
  max_uses int,                                  -- null = unlimited
  use_count int not null default 0,
  expires_at timestamptz,                        -- null = never
  revoked_at timestamptz,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);
create index on invite_codes (workspace_id);

create table labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#3B82F6',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, name)
);

create table files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  uploaded_by uuid not null references profiles(id),
  storage_path text not null unique,             -- {workspace_id}/{file_id}/{original_name}
  name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on files (workspace_id);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  status task_status not null default 'todo',
  priority task_priority not null default 'medium',
  due_at timestamptz,
  assignee_id uuid references profiles(id) on delete set null,
  label_id uuid references labels(id) on delete set null,
  created_by uuid not null references profiles(id),
  completed_at timestamptz,
  reminder_minutes_before int,                   -- null = default reminder rules
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,''))
  ) stored
);
create index on tasks (workspace_id, status);
create index on tasks (assignee_id, due_at);
create index on tasks (workspace_id, updated_at);
create index tasks_search_idx on tasks using gin (search);
create index tasks_title_trgm on tasks using gin (title gin_trgm_ops);

-- Keeps completed_at correct whenever status changes
create or replace function tasks_completed_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_at = now();
  elsif new.status <> 'completed' then
    new.completed_at = null;
  end if;
  return new;
end $$;
create trigger tasks_completed_at_trg before insert or update on tasks
  for each row execute function tasks_completed_at();

create table subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  is_done boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on subtasks (task_id);

create table task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on task_comments (task_id, created_at);

create table task_attachments (
  task_id uuid not null references tasks(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (task_id, file_id)
);

create table events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  color text not null default '#3B82F6',
  task_id uuid references tasks(id) on delete set null,
  reminder_minutes_before int not null default 15,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_at >= starts_at)
);
create index on events (workspace_id, starts_at);

create table event_attendees (
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (event_id, user_id)
);

create table channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind channel_kind not null default 'channel',
  name text,                                     -- null for direct messages
  description text not null default '',
  is_private boolean not null default false,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (kind = 'dm' or name is not null)
);

create table channel_members (
  channel_id uuid not null references channels(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  primary key (channel_id, user_id)
);
create index on channel_members (user_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  sender_id uuid not null references profiles(id),
  body text not null default '' check (char_length(body) <= 4000),
  file_id uuid references files(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (char_length(body) > 0 or file_id is not null)
);
create index on messages (channel_id, created_at desc);

create table folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  parent_id uuid references folders(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on folders (workspace_id, parent_id);

create table documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  folder_id uuid references folders(id) on delete set null,
  kind document_kind not null,
  title text not null check (char_length(title) between 1 and 200),
  file_id uuid references files(id) on delete set null,
  content jsonb,
  content_text text not null default '',
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((kind = 'file' and file_id is not null) or (kind = 'written')),
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content_text,''))
  ) stored
);
create index on documents (workspace_id, folder_id);
create index documents_search_idx on documents using gin (search);
create index documents_title_trgm on documents using gin (title gin_trgm_ops);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete cascade,
  type notification_type not null,
  title text not null,
  body text not null default '',
  entity_type text,
  entity_id uuid,
  dedupe_key text unique,
  read_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);
create index on notifications (user_id) where read_at is null;

create table device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('android','ios','windows','macos')),
  updated_at timestamptz not null default now()
);
create index on device_tokens (user_id);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','workspaces','workspace_members','labels','files','tasks','subtasks',
    'task_comments','task_attachments','events','event_attendees','channels','messages',
    'folders','documents','notifications','device_tokens'
  ] loop
    execute format('create trigger %I_set_updated_at before insert or update on %I
      for each row execute function set_updated_at()', t, t);
  end loop;
end $$;


-- ============================================================================
-- 0003_helper_functions.sql
-- ============================================================================

-- ============================================================================
-- Migration 0003: Helper Functions (used by RLS)
-- ============================================================================
-- Security definer functions that read membership without triggering RLS recursion.
-- Always set search_path for security.
-- ============================================================================

create or replace function is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members
                 where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function member_role_in(ws uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select role from workspace_members where workspace_id = ws and user_id = auth.uid();
$$;

create or replace function is_admin(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(member_role_in(ws) = 'admin', false);
$$;

create or replace function is_full_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(member_role_in(ws) in ('admin','member'), false);
$$;

create or replace function task_workspace(t uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from tasks where id = t;
$$;

create or replace function is_channel_member(ch uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from channel_members where channel_id = ch and user_id = auth.uid());
$$;

create or replace function channel_workspace(ch uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from channels where id = ch;
$$;

create or replace function is_personal(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspaces where id = ws and type = 'personal');
$$;


-- ============================================================================
-- 0004_rls_policies.sql
-- ============================================================================

-- ============================================================================
-- Migration 0004: Row Level Security (RLS) Policies
-- ============================================================================
-- Enable RLS on every table and define policies.
-- Express user client obeys these; admin client bypasses them.
-- ============================================================================

-- Enable RLS on all tables
alter table profiles enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table invite_codes enable row level security;
alter table labels enable row level security;
alter table files enable row level security;
alter table tasks enable row level security;
alter table subtasks enable row level security;
alter table task_comments enable row level security;
alter table task_attachments enable row level security;
alter table events enable row level security;
alter table event_attendees enable row level security;
alter table channels enable row level security;
alter table channel_members enable row level security;
alter table messages enable row level security;
alter table folders enable row level security;
alter table documents enable row level security;
alter table notifications enable row level security;
alter table device_tokens enable row level security;

-- profiles: see yourself and anyone who shares a workspace with you; edit only yourself
create policy profiles_select on profiles for select using (
  id = auth.uid() or exists (
    select 1 from workspace_members a join workspace_members b
      on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = profiles.id)
);
create policy profiles_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- workspaces
create policy ws_select on workspaces for select using (is_member(id) or created_by = auth.uid());
create policy ws_insert on workspaces for insert
  with check (created_by = auth.uid() and type = 'team');
create policy ws_update on workspaces for update
  using (is_admin(id)) with check (is_admin(id));
create policy ws_delete on workspaces for delete using (is_admin(id) and type = 'team');

-- workspace_members
create policy wm_select on workspace_members for select using (
  is_member(workspace_id) and (
    is_full_member(workspace_id) or user_id = auth.uid() or role = 'admin')
);
create policy wm_update on workspace_members for update
  using (is_admin(workspace_id) and not is_personal(workspace_id))
  with check (is_admin(workspace_id));
create policy wm_delete on workspace_members for delete using (
  (is_admin(workspace_id) and not is_personal(workspace_id))
  or (user_id = auth.uid() and not is_personal(workspace_id))
);

-- invite_codes: admins only, team workspaces only
create policy ic_all on invite_codes for all
  using (is_admin(workspace_id) and not is_personal(workspace_id))
  with check (is_admin(workspace_id) and not is_personal(workspace_id));

-- labels
create policy labels_select on labels for select using (is_member(workspace_id));
create policy labels_write on labels for all
  using (is_full_member(workspace_id)) with check (is_full_member(workspace_id));

-- files: full members see and create; guests see files on tasks assigned to them
create policy files_select on files for select using (
  is_full_member(workspace_id)
  or exists (select 1 from task_attachments ta join tasks t on t.id = ta.task_id
             where ta.file_id = files.id and t.assignee_id = auth.uid())
);
create policy files_insert on files for insert
  with check (is_full_member(workspace_id) and uploaded_by = auth.uid());
create policy files_update on files for update
  using (is_admin(workspace_id) or uploaded_by = auth.uid());

-- tasks
create policy tasks_select on tasks for select using (
  is_full_member(workspace_id) or (is_member(workspace_id) and assignee_id = auth.uid())
);
create policy tasks_insert on tasks for insert
  with check (is_full_member(workspace_id) and created_by = auth.uid());
create policy tasks_update on tasks for update using (
  is_admin(workspace_id)
  or (is_full_member(workspace_id) and (created_by = auth.uid() or assignee_id = auth.uid()))
  or (is_member(workspace_id) and assignee_id = auth.uid())
) with check (
  is_member(workspace_id)
);

-- tasks_guard: enforces delete permission, guest restrictions, and workspace move rules
create or replace function tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    if not (is_admin(old.workspace_id) or old.created_by = auth.uid()) then
      raise exception 'not allowed to delete this task' using errcode = '42501';
    end if;
  end if;
  if member_role_in(old.workspace_id) = 'guest' then
    if new.title <> old.title or new.description <> old.description or new.priority <> old.priority
       or new.due_at is distinct from old.due_at or new.assignee_id is distinct from old.assignee_id
       or new.workspace_id <> old.workspace_id then
      raise exception 'guests can only change task status' using errcode = '42501';
    end if;
  end if;
  if new.workspace_id <> old.workspace_id
     and coalesce(current_setting('planpal.moving', true), '') <> '1' then
    raise exception 'use move_task_to_workspace()' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tasks_guard_trg before update on tasks
  for each row execute function tasks_guard();

-- subtasks
create policy subtasks_select on subtasks for select using (
  exists (select 1 from tasks t where t.id = subtasks.task_id));
create policy subtasks_write on subtasks for all using (
  exists (select 1 from tasks t where t.id = subtasks.task_id
          and (is_full_member(t.workspace_id) or t.assignee_id = auth.uid()))
) with check (
  exists (select 1 from tasks t where t.id = subtasks.task_id
          and (is_full_member(t.workspace_id) or t.assignee_id = auth.uid()))
);

-- task_comments
create policy comments_select on task_comments for select using (
  exists (select 1 from tasks t where t.id = task_comments.task_id));
create policy comments_insert on task_comments for insert with check (
  author_id = auth.uid()
  and exists (select 1 from tasks t where t.id = task_comments.task_id));
create policy comments_update on task_comments for update using (
  author_id = auth.uid() or is_admin(task_workspace(task_id)));

-- task_attachments
create policy attach_select on task_attachments for select using (
  exists (select 1 from tasks t where t.id = task_attachments.task_id));
create policy attach_write on task_attachments for all using (
  exists (select 1 from tasks t where t.id = task_attachments.task_id
          and (is_full_member(t.workspace_id)))
) with check (
  exists (select 1 from tasks t where t.id = task_attachments.task_id
          and (is_full_member(t.workspace_id)))
);

-- events
create policy events_select on events for select using (
  is_full_member(workspace_id)
  or exists (select 1 from event_attendees ea
             where ea.event_id = events.id and ea.user_id = auth.uid() and ea.deleted_at is null)
);
create policy events_write on events for all
  using (is_full_member(workspace_id)) with check (is_full_member(workspace_id));

-- event_attendees
create policy attendees_select on event_attendees for select using (
  exists (select 1 from events e where e.id = event_attendees.event_id));
create policy attendees_write on event_attendees for all using (
  exists (select 1 from events e where e.id = event_attendees.event_id
          and is_full_member(e.workspace_id))
) with check (
  exists (select 1 from events e where e.id = event_attendees.event_id
          and is_full_member(e.workspace_id))
);

-- channels and chat (team workspaces only)
create policy ch_select on channels for select using (
  (kind = 'channel' and is_full_member(workspace_id) and not is_private)
  or is_channel_member(id)
);
create policy ch_insert on channels for insert with check (
  is_full_member(workspace_id) and not is_personal(workspace_id) and created_by = auth.uid()
);
create policy ch_update on channels for update
  using (is_admin(workspace_id) or created_by = auth.uid());

-- channel_members
create policy cm_select on channel_members for select using (
  user_id = auth.uid() or is_channel_member(channel_id));
create policy cm_insert on channel_members for insert with check (
  (user_id = auth.uid() and exists (select 1 from channels c where c.id = channel_id
     and c.kind = 'channel' and not c.is_private and is_full_member(c.workspace_id)))
  or is_admin(channel_workspace(channel_id))
  or exists (select 1 from channels c where c.id = channel_id and c.created_by = auth.uid())
);
create policy cm_update on channel_members for update using (user_id = auth.uid());
create policy cm_delete on channel_members for delete using (
  user_id = auth.uid() or is_admin(channel_workspace(channel_id)));

-- messages
create policy msg_select on messages for select using (
  is_channel_member(channel_id)
  or exists (select 1 from channels c where c.id = messages.channel_id
             and c.kind = 'channel' and not c.is_private and is_full_member(c.workspace_id)));
create policy msg_insert on messages for insert with check (
  sender_id = auth.uid() and is_channel_member(channel_id));
create policy msg_update on messages for update using (sender_id = auth.uid());

-- folders and documents: full members only
create policy folders_all on folders for all
  using (is_full_member(workspace_id)) with check (is_full_member(workspace_id));
create policy docs_select on documents for select using (is_full_member(workspace_id));
create policy docs_insert on documents for insert
  with check (is_full_member(workspace_id) and created_by = auth.uid());
create policy docs_update on documents for update using (
  is_admin(workspace_id) or created_by = auth.uid());

-- notifications and device tokens: strictly your own
create policy notif_select on notifications for select using (user_id = auth.uid());
create policy notif_update on notifications for update using (user_id = auth.uid());
create policy dt_all on device_tokens for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ============================================================================
-- 0005_triggers_functions.sql
-- ============================================================================

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


-- ============================================================================
-- 0006_search.sql
-- ============================================================================

-- ============================================================================
-- Migration 0006: Global Search
-- ============================================================================
-- Searches tasks, documents, and people. RLS applies (security invoker).
-- ============================================================================

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
     and (p_workspace is null or wm.workspace_id = p_workspace)
     and (p.full_name ilike '%' || q.raw || '%' or p.email ilike '%' || q.raw || '%')
  order by 6 desc
  limit p_limit;
$$;


-- ============================================================================
-- 0007_analytics.sql
-- ============================================================================

-- ============================================================================
-- Migration 0007: Analytics Functions
-- ============================================================================
-- All functions are security invoker (RLS applies).
-- Analytics are per workspace.
-- ============================================================================

-- Summary cards on the Analytics page and Home "Overview"
create or replace function analytics_summary(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (
  completed int, in_progress int, overdue int,
  avg_completion_days numeric, completed_prev int,
  on_time_rate numeric
) language sql stable security invoker set search_path = public as $$
  with cur as (
    select * from tasks where workspace_id = p_workspace and deleted_at is null),
  prev as (
    select count(*)::int c from cur
     where status = 'completed'
       and completed_at >= p_from - (p_to - p_from) and completed_at < p_from)
  select
    count(*) filter (where status = 'completed' and completed_at between p_from and p_to)::int,
    count(*) filter (where status = 'in_progress')::int,
    count(*) filter (where status <> 'completed' and due_at < now())::int,
    round(avg(extract(epoch from (completed_at - created_at)) / 86400.0)
      filter (where status = 'completed' and completed_at between p_from and p_to)::numeric, 1),
    (select c from prev),
    round(100.0 * count(*) filter (where status = 'completed'
        and completed_at between p_from and p_to and (due_at is null or completed_at <= due_at))
      / nullif(count(*) filter (where status = 'completed'
        and completed_at between p_from and p_to), 0), 0)
  from cur;
$$;

-- Weekly Task Output bars: completed tasks per weekday
create or replace function analytics_weekly(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (weekday int, completed int)
language sql stable security invoker set search_path = public as $$
  select d.dow, count(t.id)::int
    from generate_series(1, 7) as d(dow)
    left join tasks t
      on extract(isodow from t.completed_at) = d.dow
     and t.workspace_id = p_workspace and t.deleted_at is null
     and t.status = 'completed' and t.completed_at between p_from and p_to
   group by d.dow order by d.dow;
$$;

-- Category Mix donut: completed-or-open tasks by label
create or replace function analytics_categories(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (label text, color text, total int)
language sql stable security invoker set search_path = public as $$
  select coalesce(l.name, 'No label'), coalesce(l.color, '#94A3B8'), count(*)::int
    from tasks t left join labels l on l.id = t.label_id
   where t.workspace_id = p_workspace and t.deleted_at is null
     and t.created_at between p_from and p_to
   group by 1, 2 order by 3 desc;
$$;

-- Home "Overview" line chart: tasks completed per day
create or replace function analytics_daily(p_workspace uuid, p_from date, p_to date)
returns table (day date, completed int)
language sql stable security invoker set search_path = public as $$
  select g::date, count(t.id)::int
    from generate_series(p_from, p_to, interval '1 day') g
    left join tasks t on t.completed_at::date = g::date
     and t.workspace_id = p_workspace and t.deleted_at is null and t.status = 'completed'
   group by 1 order by 1;
$$;

-- Productive streak: consecutive days, ending today or yesterday, with at least one completed task
create or replace function analytics_streak(p_workspace uuid) returns int
language sql stable security invoker set search_path = public as $$
  with days as (
    select distinct completed_at::date d from tasks
     where workspace_id = p_workspace and deleted_at is null and status = 'completed'),
  islands as (
    select d, d - (row_number() over (order by d))::int as grp from days)
  select coalesce((select count(*)::int from islands
          where grp = (select grp from islands order by d desc limit 1)
            and (select max(d) from islands) >= current_date - 1), 0);
$$;


-- ============================================================================
-- 0008_pg_cron_reminders.sql
-- ============================================================================

-- ============================================================================
-- Migration 0008: Scheduled Reminders and Push (pg_cron + pg_net)
-- ============================================================================
-- Runs every 5 minutes inside Supabase (always on).
-- Creates notification rows, then wakes Express to send pushes.
-- Free-tier safe: no timers inside Express.
-- ============================================================================

-- Create deadline and event reminder notifications
create or replace function create_deadline_notifications() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- due within 24 hours
  insert into notifications (user_id, workspace_id, type, title, body, entity_type, entity_id, dedupe_key)
  select t.assignee_id, t.workspace_id, 'deadline_approaching', 'Deadline approaching',
         'Task "' || t.title || '" is due soon.', 'task', t.id,
         'deadline24:' || t.id || ':' || extract(epoch from t.due_at)::bigint
    from tasks t
   where t.deleted_at is null and t.status <> 'completed' and t.assignee_id is not null
     and t.due_at between now() and now() + interval '24 hours'
  on conflict (dedupe_key) do nothing;

  -- overdue
  insert into notifications (user_id, workspace_id, type, title, body, entity_type, entity_id, dedupe_key)
  select t.assignee_id, t.workspace_id, 'task_overdue', 'Task overdue',
         'Task "' || t.title || '" is overdue.', 'task', t.id,
         'overdue:' || t.id || ':' || extract(epoch from t.due_at)::bigint
    from tasks t
   where t.deleted_at is null and t.status <> 'completed' and t.assignee_id is not null
     and t.due_at < now()
  on conflict (dedupe_key) do nothing;

  -- event reminders for attendees
  insert into notifications (user_id, workspace_id, type, title, body, entity_type, entity_id, dedupe_key)
  select ea.user_id, e.workspace_id, 'event_reminder', e.title,
         'Starts at ' || to_char(e.starts_at at time zone 'UTC', 'HH24:MI') || ' UTC',
         'event', e.id, 'event:' || e.id || ':' || ea.user_id || ':' || extract(epoch from e.starts_at)::bigint
    from events e join event_attendees ea on ea.event_id = e.id and ea.deleted_at is null
   where e.deleted_at is null
     and e.starts_at between now() and now() + make_interval(mins => e.reminder_minutes_before)
  on conflict (dedupe_key) do nothing;
end $$;

-- Add push_attempts column to notifications
alter table notifications add column if not exists push_attempts int not null default 0;

-- Claims a batch of unsent notifications (two workers never send the same one)
create or replace function claim_unpushed_notifications(p_limit int default 100)
returns setof notifications
language sql security definer set search_path = public as $$
  update notifications n
     set pushed_at = now(), push_attempts = n.push_attempts + 1
   where n.id in (
     select id from notifications
      where pushed_at is null and push_attempts < 3
        and created_at > now() - interval '1 day'
      order by created_at
      for update skip locked
      limit p_limit)
  returning n.*;
$$;
revoke all on function claim_unpushed_notifications(int) from public, anon, authenticated;
grant execute on function claim_unpushed_notifications(int) to service_role;

-- Enable pg_net for calling Express
create extension if not exists pg_net;

-- Wakes Render server and tells it to send pending pushes
create or replace function run_reminders_and_push() returns void
language plpgsql security definer set search_path = public as $$
declare api_url text; cron_secret text;
begin
  perform create_deadline_notifications();

  select decrypted_secret into api_url from vault.decrypted_secrets where name = 'planpal_api_url';
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'planpal_cron_secret';
  if api_url is not null and cron_secret is not null then
    perform net.http_post(
      url := api_url || '/internal/push/run',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', cron_secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000);
  end if;
end $$;

-- Schedule: run every 5 minutes
select cron.schedule('planpal-reminders', '*/5 * * * *', $$select run_reminders_and_push()$$);

-- Weekly cleanup (Sunday 03:00 UTC) to stay inside free-tier storage
create or replace function purge_old_rows() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from notifications where created_at < now() - interval '90 days';
  delete from messages       where deleted_at < now() - interval '60 days';
  delete from task_comments  where deleted_at < now() - interval '60 days';
  delete from subtasks       where deleted_at < now() - interval '60 days';
  delete from tasks          where deleted_at < now() - interval '60 days';
  delete from events         where deleted_at < now() - interval '60 days';
end $$;
select cron.schedule('planpal-cleanup', '0 3 * * 0', $$select purge_old_rows()$$);

-- MANUAL SETUP REQUIRED (run once in Supabase SQL Editor with actual values):
-- select vault.create_secret('https://your-service.onrender.com', 'planpal_api_url');
-- select vault.create_secret('<same value as CRON_SECRET on Render>', 'planpal_cron_secret');


-- ============================================================================
-- 0009_realtime.sql
-- ============================================================================

-- ============================================================================
-- Migration 0009: Supabase Realtime Configuration
-- ============================================================================
-- Enable Realtime for tables that the app listens to.
-- RLS still applies to each change.
-- ============================================================================

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table notifications;
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table task_comments;
alter publication supabase_realtime add table channel_members;
alter publication supabase_realtime add table workspace_members;

-- Presence (who is online) uses Realtime Presence on channel 'workspace:{id}'.
-- Only write profiles.last_seen_at occasionally (app close), not every few seconds.


