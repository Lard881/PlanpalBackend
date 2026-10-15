-- Custom task reminder intervals, applied by the existing five-minute cron job.
create or replace function create_deadline_notifications() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Use the selected interval, or the existing 24-hour default when unset.
  insert into notifications (user_id, workspace_id, type, title, body, entity_type, entity_id, dedupe_key)
  select t.assignee_id, t.workspace_id, 'deadline_approaching', 'Deadline approaching',
         'Task "' || t.title || '" is due soon.', 'task', t.id,
         'deadline:' || t.id || ':' || extract(epoch from t.due_at)::bigint || ':' || coalesce(t.reminder_minutes_before, 1440)
    from tasks t
   where t.deleted_at is null and t.status <> 'completed' and t.assignee_id is not null
     and t.due_at is not null and t.due_at > now()
     and t.due_at - make_interval(mins => coalesce(t.reminder_minutes_before, 1440)) <= now()
  on conflict (dedupe_key) do nothing;

  -- Preserve the existing overdue notification behavior.
  insert into notifications (user_id, workspace_id, type, title, body, entity_type, entity_id, dedupe_key)
  select t.assignee_id, t.workspace_id, 'task_overdue', 'Task overdue',
         'Task "' || t.title || '" is overdue.', 'task', t.id,
         'overdue:' || t.id || ':' || extract(epoch from t.due_at)::bigint
    from tasks t
   where t.deleted_at is null and t.status <> 'completed' and t.assignee_id is not null
     and t.due_at < now()
  on conflict (dedupe_key) do nothing;

  -- Preserve event reminder behavior.
  insert into notifications (user_id, workspace_id, type, title, body, entity_type, entity_id, dedupe_key)
  select ea.user_id, e.workspace_id, 'event_reminder', e.title,
         'Starts at ' || to_char(e.starts_at at time zone 'UTC', 'HH24:MI') || ' UTC',
         'event', e.id, 'event:' || e.id || ':' || ea.user_id || ':' || extract(epoch from e.starts_at)::bigint
    from events e join event_attendees ea on ea.event_id = e.id and ea.deleted_at is null
   where e.deleted_at is null
     and e.starts_at between now() and now() + make_interval(mins => e.reminder_minutes_before)
  on conflict (dedupe_key) do nothing;
end $$;
