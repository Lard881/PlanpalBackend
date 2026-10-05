-- ============================================================================
-- SIMPLE CHECK - Copy entire output and paste in chat
-- ============================================================================

-- Extensions Check
SELECT 
  '📦 EXTENSIONS' as component,
  COUNT(*)::text || '/3' as count,
  CASE WHEN COUNT(*) = 3 THEN '✅ PASS' ELSE '❌ FAIL' END as status
FROM pg_extension
WHERE extname IN ('pgcrypto', 'pg_trgm', 'pg_cron');

-- Types Check
SELECT 
  '🏷️  CUSTOM TYPES' as component,
  COUNT(*)::text || '/7' as count,
  CASE WHEN COUNT(*) = 7 THEN '✅ PASS' ELSE '❌ FAIL' END as status
FROM pg_type
WHERE typname IN ('workspace_type', 'member_role', 'task_status', 'task_priority', 'channel_kind', 'document_kind', 'notification_type');

-- Tables Check
SELECT 
  '📋 TABLES' as component,
  COUNT(*)::text || '/19' as count,
  CASE WHEN COUNT(*) = 19 THEN '✅ PASS' ELSE '❌ FAIL' END as status
FROM pg_tables
WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations');

-- Functions Check
SELECT 
  '⚙️  FUNCTIONS' as component,
  COUNT(*)::text || '/14' as count,
  CASE WHEN COUNT(*) >= 14 THEN '✅ PASS' ELSE '❌ FAIL' END as status
FROM pg_proc
WHERE proname IN (
  'set_updated_at', 'create_profile_for_new_user', 'create_new_team_workspace',
  'prevent_last_admin_change', 'join_workspace', 'move_task_to_workspace',
  'get_or_create_dm', 'search_all', 'get_task_analytics', 'get_member_activity',
  'get_workspace_overview', 'claim_unpushed_notifications', 
  'create_deadline_notifications', 'create_event_reminders'
);

-- RLS Policies Check
SELECT 
  '🔒 RLS POLICIES' as component,
  COUNT(*)::text as count,
  CASE WHEN COUNT(*) >= 50 THEN '✅ PASS' ELSE '⚠️  LOW' END as status
FROM pg_policies
WHERE schemaname = 'public';

-- Cron Jobs Check
SELECT 
  '⏰ CRON JOBS' as component,
  COUNT(*)::text || '/2' as count,
  CASE WHEN COUNT(*) = 2 THEN '✅ PASS' ELSE '❌ FAIL' END as status
FROM cron.job
WHERE jobname IN ('run_reminders_and_push', 'purge_old_rows');

-- Storage Bucket Check
SELECT 
  '🗄️  STORAGE BUCKET' as component,
  CASE WHEN COUNT(*) = 1 THEN 'planpal-files (private)' ELSE 'MISSING OR PUBLIC' END as count,
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END as status
FROM storage.buckets
WHERE name = 'planpal-files' AND public = false;

-- Overall Summary
SELECT 
  '🎯 OVERALL STATUS' as component,
  '' as count,
  CASE 
    WHEN (
      (SELECT COUNT(*) FROM pg_extension WHERE extname IN ('pgcrypto', 'pg_trgm', 'pg_cron')) = 3 AND
      (SELECT COUNT(*) FROM pg_type WHERE typname IN ('workspace_type', 'member_role', 'task_status', 'task_priority', 'channel_kind', 'document_kind', 'notification_type')) = 7 AND
      (SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations')) = 19 AND
      (SELECT COUNT(*) FROM pg_proc WHERE proname IN ('set_updated_at', 'create_profile_for_new_user', 'create_new_team_workspace', 'prevent_last_admin_change', 'join_workspace', 'move_task_to_workspace', 'get_or_create_dm', 'search_all', 'get_task_analytics', 'get_member_activity', 'get_workspace_overview', 'claim_unpushed_notifications', 'create_deadline_notifications', 'create_event_reminders')) >= 14 AND
      (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') >= 50 AND
      (SELECT COUNT(*) FROM cron.job WHERE jobname IN ('run_reminders_and_push', 'purge_old_rows')) = 2 AND
      (SELECT COUNT(*) FROM storage.buckets WHERE name = 'planpal-files' AND public = false) = 1
    ) THEN '✅ STAGE 1 COMPLETE'
    ELSE '❌ STAGE 1 INCOMPLETE'
  END as status;
