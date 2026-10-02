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
