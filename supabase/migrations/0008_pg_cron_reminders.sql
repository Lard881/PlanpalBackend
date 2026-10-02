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
