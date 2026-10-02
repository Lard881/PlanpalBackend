-- ============================================================================
-- ONE-PASTE SETUP for PlanPal
-- ============================================================================
-- This file contains the complete database schema for PlanPal.
-- It combines migrations 0001 through 0009 plus storage bucket setup.
--
-- SAFE TO RUN MULTIPLE TIMES:
-- - All create statements use "if not exists" or "create or replace"
-- - Types, triggers, and policies are guarded against re-creation
-- - No data is deleted (no DROP TABLE, TRUNCATE, or DELETE)
--
-- HOW TO USE:
-- 1. Open Supabase Dashboard > SQL Editor > New query
-- 2. Paste this entire file
-- 3. Press "Run" once
-- 4. See HOW_TO_RUN.md for verification steps
--
-- ORDER OF EXECUTION:
-- 1. Extensions (pgcrypto, pg_trgm, pg_cron, pg_net)
-- 2. Custom types (workspace_type, member_role, task_status, etc.)
-- 3. Helper function (set_updated_at)
-- 4. Core tables (profiles, workspaces, tasks, etc.)
-- 5. Helper functions for RLS
-- 6. RLS policies and guards
-- 7. Triggers and functions (profile creation, workspace setup, etc.)
-- 8. Search indexes
-- 9. Analytics functions
-- 10. pg_cron reminder jobs
-- 11. Realtime publication
-- 12. Storage bucket
--
-- NOTE: Vault secrets for CRON must be set separately (see bottom of file)
-- ============================================================================

-- ===== 0001_types =====

-- Enable required PostgreSQL extensions
-- Note: pg_net must be enabled in Dashboard > Database > Extensions first
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "pg_cron";
-- create extension if not exists "pg_net";  -- Enable this in Supabase Dashboard first

-- Custom types (idempotent creation)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'workspace_type') then
    create type workspace_type as enum ('personal', 'team');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'member_role') then
    create type member_role as enum ('admin', 'member', 'guest');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type task_status as enum ('todo', 'in_progress', 'completed');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'task_priority') then
    create type task_priority as enum ('high', 'medium', 'low');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'channel_kind') then
    create type channel_kind as enum ('channel', 'dm');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'document_kind') then
    create type document_kind as enum ('file', 'written');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'notification_type') then
    create type notification_type as enum (
      'task_assigned',
      'task_updated',
      'task_comment',
      'mention',
      'deadline_approaching',
      'task_overdue',
      'event_reminder',
      'chat_message',
      'member_joined',
      'system'
    );
  end if;
end $$;

-- ===== 0002_core_tables =====

-- Helper function for updated_at
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- profiles
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  avatar_path text,
  timezone text not null default 'UTC',
  language text not null default 'en'
    check (language in ('en','es','fr','zh','ko')),
  theme text not null default 'system'
    check (theme in ('light','dark','system')),
  personal_workspace_id uuid,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- workspaces
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  type workspace_type not null default 'team',
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Add foreign key from profiles to workspaces if not exists
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'profiles_personal_ws_fk'
  ) then
    alter table profiles
      add constraint profiles_personal_ws_fk
      foreign key (personal_workspace_id) references workspaces(id);
  end if;
end $$;

-- workspace_members
create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role member_role not null default 'member',
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_id_idx on workspace_members (user_id);

-- invite_codes
create table if not exists invite_codes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  code text not null unique,
  role member_role not null default 'member',
  max_uses int,
  use_count int not null default 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists invite_codes_workspace_id_idx on invite_codes (workspace_id);

-- labels
create table if not exists labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#3B82F6',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, name)
);

-- files
create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  uploaded_by uuid not null references profiles(id),
  storage_path text not null unique,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists files_workspace_id_idx on files (workspace_id);

-- tasks
create table if not exists tasks (
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
  reminder_minutes_before int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,''))
  ) stored
);
create index if not exists tasks_workspace_status_idx on tasks (workspace_id, status);
create index if not exists tasks_assignee_due_idx on tasks (assignee_id, due_at);
create index if not exists tasks_workspace_updated_idx on tasks (workspace_id, updated_at);
create index if not exists tasks_search_idx on tasks using gin (search);
create index if not exists tasks_title_trgm on tasks using gin (title gin_trgm_ops);

-- tasks completed_at trigger function
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

drop trigger if exists tasks_completed_at_trg on tasks;
create trigger tasks_completed_at_trg before insert or update on tasks
  for each row execute function tasks_completed_at();

-- subtasks
create table if not exists subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  is_done boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists subtasks_task_id_idx on subtasks (task_id);

-- task_comments
create table if not exists task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  author_id uuid not null references profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists task_comments_task_created_idx on task_comments (task_id, created_at);

-- task_attachments
create table if not exists task_attachments (
  task_id uuid not null references tasks(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (task_id, file_id)
);

-- events
create table if not exists events (
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
create index if not exists events_workspace_starts_idx on events (workspace_id, starts_at);

-- event_attendees
create table if not exists event_attendees (
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (event_id, user_id)
);

-- channels
create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind channel_kind not null default 'channel',
  name text,
  description text not null default '',
  is_private boolean not null default false,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (kind = 'dm' or name is not null)
);

-- channel_members
create table if not exists channel_members (
  channel_id uuid not null references channels(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  primary key (channel_id, user_id)
);
create index if not exists channel_members_user_id_idx on channel_members (user_id);

-- messages
create table if not exists messages (
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
create index if not exists messages_channel_created_idx on messages (channel_id, created_at desc);

-- folders
create table if not exists folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  parent_id uuid references folders(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists folders_workspace_parent_idx on folders (workspace_id, parent_id);

-- documents
create table if not exists documents (
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
create index if not exists documents_workspace_folder_idx on documents (workspace_id, folder_id);
create index if not exists documents_search_idx on documents using gin (search);
create index if not exists documents_title_trgm on documents using gin (title gin_trgm_ops);

-- notifications
create table if not exists notifications (
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
create index if not exists notifications_user_created_idx on notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx on notifications (user_id) where read_at is null;

-- device_tokens
create table if not exists device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('android','ios','windows','macos')),
  updated_at timestamptz not null default now()
);
create index if not exists device_tokens_user_id_idx on device_tokens (user_id);

-- Create updated_at triggers for all tables
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','workspaces','workspace_members','labels','files','tasks','subtasks',
    'task_comments','task_attachments','events','event_attendees','channels','messages',
    'folders','documents','notifications','device_tokens'
  ] loop
    execute format('drop trigger if exists %I_set_updated_at on %I', t, t);
    execute format('create trigger %I_set_updated_at before insert or update on %I
      for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- ===== 0003_helper_functions =====

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

-- ===== 0004_rls_policies =====

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

-- Profiles policies
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (
  id = auth.uid() or exists (
    select 1 from workspace_members a join workspace_members b
      on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = profiles.id)
);

drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Workspaces policies
drop policy if exists ws_select on workspaces;
create policy ws_select on workspaces for select using (is_member(id) or created_by = auth.uid());

drop policy if exists ws_insert on workspaces;
create policy ws_insert on workspaces for insert
  with check (created_by = auth.uid() and type = 'team');

drop policy if exists ws_update on workspaces;
create policy ws_update on workspaces for update
  using (is_admin(id)) with check (is_admin(id));

drop policy if exists ws_delete on workspaces;
create policy ws_delete on workspaces for delete using (is_admin(id) and type = 'team');

-- Workspace members policies
drop policy if exists wm_select on workspace_members;
create policy wm_select on workspace_members for select using (
  is_member(workspace_id) and (
    is_full_member(workspace_id) or user_id = auth.uid() or role = 'admin')
);

drop policy if exists wm_update on workspace_members;
create policy wm_update on workspace_members for update
  using (is_admin(workspace_id) and not is_personal(workspace_id))
  with check (is_admin(workspace_id));

drop policy if exists wm_delete on workspace_members;
create policy wm_delete on workspace_members for delete using (
  (is_admin(workspace_id) and not is_personal(workspace_id))
  or (user_id = auth.uid() and not is_personal(workspace_id))
);

-- Invite codes policies
drop policy if exists ic_all on invite_codes;
create policy ic_all on invite_codes for all
  using (is_admin(workspace_id) and not is_personal(workspace_id))
  with check (is_admin(workspace_id) and not is_personal(workspace_id));

-- Labels policies
drop policy if exists labels_select on labels;
create policy labels_select on labels for select using (is_member(workspace_id));

drop policy if exists labels_write on labels;
create policy labels_write on labels for all
  using (is_full_member(workspace_id)) with check (is_full_member(workspace_id));

-- Files policies
drop policy if exists files_select on files;
create policy files_select on files for select using (
  is_full_member(workspace_id)
  or exists (select 1 from task_attachments ta join tasks t on t.id = ta.task_id
             where ta.file_id = files.id and t.assignee_id = auth.uid())
);

drop policy if exists files_insert on files;
create policy files_insert on files for insert
  with check (is_full_member(workspace_id) and uploaded_by = auth.uid());

drop policy if exists files_update on files;
create policy files_update on files for update
  using (is_admin(workspace_id) or uploaded_by = auth.uid());

-- Tasks policies
drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select using (
  is_full_member(workspace_id) or (is_member(workspace_id) and assignee_id = auth.uid())
);

drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks for insert
  with check (is_full_member(workspace_id) and created_by = auth.uid());

drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks for update using (
  is_admin(workspace_id)
  or (is_full_member(workspace_id) and (created_by = auth.uid() or assignee_id = auth.uid()))
  or (is_member(workspace_id) and assignee_id = auth.uid())
) with check (
  is_member(workspace_id)
);

-- Tasks guard function
create or replace function tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    if not (is_admin(old.workspace_id) or old.created_by = auth.uid()) then
      raise exception 'permission denied';
    end if;
  end if;
  if new.workspace_id <> old.workspace_id then
    raise exception 'use move_task_to_workspace()';
  end if;
  if is_member(old.workspace_id) and member_role_in(old.workspace_id) = 'guest'
     and old.assignee_id = auth.uid() then
    if new.status <> old.status and
       new.title = old.title and
       new.description = old.description and
       new.priority = old.priority and
       new.due_at is not distinct from old.due_at and
       new.assignee_id = old.assignee_id and
       new.label_id is not distinct from old.label_id and
       new.reminder_minutes_before is not distinct from old.reminder_minutes_before and
       new.deleted_at is null then
      return new;
    else
      raise exception 'guests can only change status';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tasks_guard_trg on tasks;
create trigger tasks_guard_trg before update on tasks
  for each row execute function tasks_guard();

-- Subtasks policies
drop policy if exists subtasks_all on subtasks;
create policy subtasks_all on subtasks for all
  using (is_member(task_workspace(task_id)))
  with check (is_member(task_workspace(task_id)));

-- Task comments policies
drop policy if exists tc_select on task_comments;
create policy tc_select on task_comments for select
  using (is_member(task_workspace(task_id)));

drop policy if exists tc_insert on task_comments;
create policy tc_insert on task_comments for insert
  with check (is_member(task_workspace(task_id)) and author_id = auth.uid());

drop policy if exists tc_update on task_comments;
create policy tc_update on task_comments for update
  using (author_id = auth.uid() or is_admin(task_workspace(task_id)));

-- Task attachments policies
drop policy if exists ta_all on task_attachments;
create policy ta_all on task_attachments for all
  using (is_member(task_workspace(task_id)))
  with check (is_member(task_workspace(task_id)));

-- Events policies
drop policy if exists events_all on events;
create policy events_all on events for all
  using (is_member(workspace_id))
  with check (is_member(workspace_id) and created_by = auth.uid());

-- Event attendees policies
drop policy if exists ea_all on event_attendees;
create policy ea_all on event_attendees for all
  using (exists (select 1 from events e where e.id = event_id and is_member(e.workspace_id)))
  with check (exists (select 1 from events e where e.id = event_id and is_member(e.workspace_id)));

-- Channels policies
drop policy if exists ch_select on channels;
create policy ch_select on channels for select using (
  (is_member(workspace_id) and not is_private) or is_channel_member(id)
);

drop policy if exists ch_insert on channels;
create policy ch_insert on channels for insert
  with check (is_member(workspace_id) and created_by = auth.uid() and not is_personal(workspace_id));

drop policy if exists ch_update on channels;
create policy ch_update on channels for update
  using (is_admin(workspace_id) or created_by = auth.uid());

-- Channel members policies
drop policy if exists cm_all on channel_members;
create policy cm_all on channel_members for all
  using (is_member(channel_workspace(channel_id)))
  with check (is_member(channel_workspace(channel_id)));

-- Messages policies
drop policy if exists msg_select on messages;
create policy msg_select on messages for select
  using (is_channel_member(channel_id));

drop policy if exists msg_insert on messages;
create policy msg_insert on messages for insert
  with check (is_channel_member(channel_id) and sender_id = auth.uid());

drop policy if exists msg_update on messages;
create policy msg_update on messages for update
  using (sender_id = auth.uid());

-- Folders policies
drop policy if exists folders_all on folders;
create policy folders_all on folders for all
  using (is_member(workspace_id))
  with check (is_member(workspace_id) and created_by = auth.uid());

-- Documents policies
drop policy if exists docs_select on documents;
create policy docs_select on documents for select using (is_member(workspace_id));

drop policy if exists docs_write on documents;
create policy docs_write on documents for all
  using (is_full_member(workspace_id))
  with check (is_full_member(workspace_id) and created_by = auth.uid());

-- Notifications policies
drop policy if exists notif_all on notifications;
create policy notif_all on notifications for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Device tokens policies
drop policy if exists dt_all on device_tokens;
create policy dt_all on device_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===== 0005_triggers_functions =====

-- Create profile and personal workspace on signup
create or replace function create_profile_and_workspace() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ws_id uuid;
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;

  insert into workspaces (name, type, created_by)
  values ('Personal', 'personal', new.id)
  returning id into ws_id;

  update profiles set personal_workspace_id = ws_id where id = new.id;

  insert into workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'admin');

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function create_profile_and_workspace();

-- Create admin membership and #general channel on team workspace creation
create or replace function setup_team_workspace() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  gen_ch_id uuid;
begin
  if new.type = 'team' then
    insert into workspace_members (workspace_id, user_id, role)
    values (new.id, new.created_by, 'admin')
    on conflict do nothing;

    insert into channels (workspace_id, kind, name, description, is_private, created_by)
    values (new.id, 'channel', 'general', 'Default channel for everyone', false, new.created_by)
    returning id into gen_ch_id;

    insert into channel_members (channel_id, user_id)
    values (gen_ch_id, new.created_by);
  end if;
  return new;
end $$;

drop trigger if exists setup_team_workspace_trg on workspaces;
create trigger setup_team_workspace_trg
  after insert on workspaces
  for each row execute function setup_team_workspace();

-- Last admin protection
create or replace function protect_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  admin_count int;
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.role <> 'admin') then
    select count(*) into admin_count
    from workspace_members
    where workspace_id = coalesce(new.workspace_id, old.workspace_id)
      and role = 'admin';

    if admin_count <= 1 then
      raise exception using
        errcode = 'P0001',
        message = 'cannot remove or demote the last admin';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists protect_last_admin_trg on workspace_members;
create trigger protect_last_admin_trg
  before update or delete on workspace_members
  for each row execute function protect_last_admin();

-- Auto-add new team members to #general
create or replace function add_member_to_general() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  gen_ch_id uuid;
  ws_type workspace_type;
begin
  select type into ws_type from workspaces where id = new.workspace_id;
  if ws_type = 'team' then
    select id into gen_ch_id from channels
    where workspace_id = new.workspace_id and kind = 'channel' and name = 'general'
    limit 1;

    if gen_ch_id is not null then
      insert into channel_members (channel_id, user_id)
      values (gen_ch_id, new.user_id)
      on conflict do nothing;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists add_member_to_general_trg on workspace_members;
create trigger add_member_to_general_trg
  after insert on workspace_members
  for each row execute function add_member_to_general();

-- Join workspace function
create or replace function join_workspace(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv record;
  ws_id uuid;
begin
  select * into inv from invite_codes where code = p_code;

  if not found then
    raise exception using errcode = 'P0002', message = 'INVALID_CODE';
  end if;
  if inv.revoked_at is not null then
    raise exception using errcode = 'P0002', message = 'CODE_REVOKED';
  end if;
  if inv.expires_at is not null and inv.expires_at < now() then
    raise exception using errcode = 'P0002', message = 'CODE_EXPIRED';
  end if;
  if inv.max_uses is not null and inv.use_count >= inv.max_uses then
    raise exception using errcode = 'P0002', message = 'CODE_USED_UP';
  end if;
  if exists (select 1 from workspace_members where workspace_id = inv.workspace_id and user_id = auth.uid()) then
    raise exception using errcode = 'P0002', message = 'ALREADY_MEMBER';
  end if;

  ws_id := inv.workspace_id;

  insert into workspace_members (workspace_id, user_id, role)
  values (ws_id, auth.uid(), inv.role);

  update invite_codes set use_count = use_count + 1 where id = inv.id;

  return ws_id;
end $$;

-- Move task to workspace function
create or replace function move_task_to_workspace(p_task uuid, p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  old_ws uuid;
begin
  select workspace_id into old_ws from tasks where id = p_task;
  if not is_admin(old_ws) or not is_admin(p_target) then
    raise exception 'permission denied';
  end if;
  update tasks set workspace_id = p_target where id = p_task;
end $$;

-- Claim unpushed notifications (for push service)
create or replace function claim_unpushed_notifications(p_limit int default 100)
returns table (
  id uuid,
  user_id uuid,
  title text,
  body text,
  entity_type text,
  entity_id uuid,
  workspace_id uuid
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  update notifications n
  set pushed_at = now()
  where n.id in (
    select n2.id from notifications n2
    where n2.pushed_at is null
    order by n2.created_at
    limit p_limit
    for update skip locked
  )
  returning n.id, n.user_id, n.title, n.body, n.entity_type, n.entity_id, n.workspace_id;
end $$;

-- ===== 0006_search =====

-- Combined search function
create or replace function search_all(
  p_workspace_id uuid,
  p_query text,
  p_limit int default 20
)
returns table (
  result_type text,
  id uuid,
  title text,
  snippet text,
  rank real
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  select 'task'::text, t.id, t.title, left(t.description, 100), ts_rank(t.search, websearch_to_tsquery('simple', p_query))
  from tasks t
  where t.workspace_id = p_workspace_id
    and t.deleted_at is null
    and t.search @@ websearch_to_tsquery('simple', p_query)
  order by ts_rank(t.search, websearch_to_tsquery('simple', p_query)) desc
  limit p_limit;
end $$;

-- Fuzzy title search for tasks
create or replace function fuzzy_search_tasks(
  p_workspace_id uuid,
  p_query text,
  p_limit int default 10
)
returns table (
  id uuid,
  title text,
  similarity_score real
)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, similarity(t.title, p_query) as similarity_score
  from tasks t
  where t.workspace_id = p_workspace_id
    and t.deleted_at is null
    and t.title % p_query
  order by similarity_score desc
  limit p_limit;
$$;

-- ===== 0007_analytics =====

-- Task counts by status
create or replace function task_counts_by_status(p_workspace_id uuid)
returns table (status task_status, count bigint)
language sql stable security definer set search_path = public as $$
  select t.status, count(*)
  from tasks t
  where t.workspace_id = p_workspace_id and t.deleted_at is null
  group by t.status;
$$;

-- Overdue tasks count
create or replace function overdue_tasks_count(p_workspace_id uuid)
returns bigint
language sql stable security definer set search_path = public as $$
  select count(*)
  from tasks t
  where t.workspace_id = p_workspace_id
    and t.deleted_at is null
    and t.status <> 'completed'
    and t.due_at < now();
$$;

-- ===== 0008_pg_cron_reminders =====

-- Create deadline notifications for tasks due within 24 hours
create or replace function create_deadline_notifications() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, workspace_id, type, title, body, entity_type, entity_id, dedupe_key)
  select
    t.assignee_id,
    t.workspace_id,
    'deadline_approaching'::notification_type,
    'Task due soon: ' || t.title,
    'Due at ' || to_char(t.due_at, 'YYYY-MM-DD HH24:MI'),
    'task',
    t.id,
    'deadline_' || t.id::text
  from tasks t
  where t.assignee_id is not null
    and t.status <> 'completed'
    and t.due_at between now() and now() + interval '24 hours'
    and t.deleted_at is null
  on conflict (dedupe_key) do nothing;
end $$;

-- Create overdue notifications for tasks past due
create or replace function create_overdue_notifications() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, workspace_id, type, title, body, entity_type, entity_id, dedupe_key)
  select
    t.assignee_id,
    t.workspace_id,
    'task_overdue'::notification_type,
    'Task overdue: ' || t.title,
    'Was due at ' || to_char(t.due_at, 'YYYY-MM-DD HH24:MI'),
    'task',
    t.id,
    'overdue_' || t.id::text
  from tasks t
  where t.assignee_id is not null
    and t.status <> 'completed'
    and t.due_at < now()
    and t.deleted_at is null
  on conflict (dedupe_key) do nothing;
end $$;

-- Create event reminder notifications
create or replace function create_event_reminders() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, workspace_id, type, title, body, entity_type, entity_id, dedupe_key)
  select
    ea.user_id,
    e.workspace_id,
    'event_reminder'::notification_type,
    'Event starting soon: ' || e.title,
    'Starts at ' || to_char(e.starts_at, 'YYYY-MM-DD HH24:MI'),
    'event',
    e.id,
    'event_reminder_' || e.id::text || '_' || ea.user_id::text
  from events e
  join event_attendees ea on ea.event_id = e.id
  where e.starts_at between now() and now() + interval '1 minute' * e.reminder_minutes_before
    and e.deleted_at is null
  on conflict (dedupe_key) do nothing;
end $$;

-- Weekly cleanup: delete old read notifications
create or replace function cleanup_old_notifications() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from notifications
  where read_at is not null
    and read_at < now() - interval '30 days';
end $$;

-- Schedule cron jobs (idempotent)
do $$
begin
  -- Unschedule if exists
  perform cron.unschedule('planpal_deadline_reminders') where exists (
    select 1 from cron.job where jobname = 'planpal_deadline_reminders'
  );
  perform cron.unschedule('planpal_overdue_notifications') where exists (
    select 1 from cron.job where jobname = 'planpal_overdue_notifications'
  );
  perform cron.unschedule('planpal_event_reminders') where exists (
    select 1 from cron.job where jobname = 'planpal_event_reminders'
  );
  perform cron.unschedule('planpal_weekly_cleanup') where exists (
    select 1 from cron.job where jobname = 'planpal_weekly_cleanup'
  );

  -- Schedule jobs
  perform cron.schedule('planpal_deadline_reminders', '*/15 * * * *', 'select create_deadline_notifications()');
  perform cron.schedule('planpal_overdue_notifications', '0 9 * * *', 'select create_overdue_notifications()');
  perform cron.schedule('planpal_event_reminders', '* * * * *', 'select create_event_reminders()');
  perform cron.schedule('planpal_weekly_cleanup', '0 2 * * 0', 'select cleanup_old_notifications()');
end $$;

-- ===== 0009_realtime =====

-- Add workspace tables to realtime publication (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table tasks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'subtasks'
  ) then
    alter publication supabase_realtime add table subtasks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_comments'
  ) then
    alter publication supabase_realtime add table task_comments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_members'
  ) then
    alter publication supabase_realtime add table workspace_members;
  end if;
end $$;

-- ===== STORAGE_BUCKET_SETUP =====

-- Create storage bucket for planpal files
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'planpal-files',
  'planpal-files',
  false,
  26214400, -- 25 MB
  array[
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
  ]
)
on conflict (id) do nothing;

-- Storage policies for planpal-files bucket
drop policy if exists "Workspace members can upload files" on storage.objects;
create policy "Workspace members can upload files"
on storage.objects for insert
with check (
  bucket_id = 'planpal-files'
  and auth.uid() is not null
);

drop policy if exists "Workspace members can read files" on storage.objects;
create policy "Workspace members can read files"
on storage.objects for select
using (
  bucket_id = 'planpal-files'
  and auth.uid() is not null
);

drop policy if exists "Workspace members can delete files" on storage.objects;
create policy "Workspace members can delete files"
on storage.objects for delete
using (
  bucket_id = 'planpal-files'
  and auth.uid() is not null
);

-- ============================================================================
-- SETUP COMPLETE
-- ============================================================================
-- Next steps:
-- 1. Verify tables exist in Supabase Dashboard > Table Editor
-- 2. Verify bucket 'planpal-files' exists in Storage
-- 3. Create a test user in Authentication and verify profile + Personal workspace
-- 4. Configure auth settings in Dashboard (see HOW_TO_RUN.md)
--
-- VAULT SECRETS (run these later in Stage 11 after deploying to Render):
-- select vault.create_secret('your-render-url', 'planpal_api_url');
-- select vault.create_secret('your-cron-secret-value', 'planpal_cron_secret');
-- ============================================================================
