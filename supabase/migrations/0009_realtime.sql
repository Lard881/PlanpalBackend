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
