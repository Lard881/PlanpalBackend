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
