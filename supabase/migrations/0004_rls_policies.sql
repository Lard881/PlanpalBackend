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
