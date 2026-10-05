-- ============================================================================
-- ONE QUERY CHECK - All results in single table
-- ============================================================================

WITH checks AS (
  SELECT 1 as ord, '📦 EXTENSIONS' as component,
    (SELECT COUNT(*)::text || '/3' FROM pg_extension WHERE extname IN ('pgcrypto', 'pg_trgm', 'pg_cron')) as count,
    CASE WHEN (SELECT COUNT(*) FROM pg_extension WHERE extname IN ('pgcrypto', 'pg_trgm', 'pg_cron')) = 3 
      THEN '✅ PASS' ELSE '❌ FAIL' END as status
  
  UNION ALL
  SELECT 2, '🏷️  CUSTOM TYPES',
    (SELECT COUNT(*)::text || '/7' FROM pg_type WHERE typname IN ('workspace_type', 'member_role', 'task_status', 'task_priority', 'channel_kind', 'document_kind', 'notification_type')),
    CASE WHEN (SELECT COUNT(*) FROM pg_type WHERE typname IN ('workspace_type', 'member_role', 'task_status', 'task_priority', 'channel_kind', 'document_kind', 'notification_type')) = 7 
      THEN '✅ PASS' ELSE '❌ FAIL' END
  
  UNION ALL
  SELECT 3, '📋 TABLES',
    (SELECT COUNT(*)::text || '/19' FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations')),
    CASE WHEN (SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations')) = 19 
      THEN '✅ PASS' ELSE '❌ FAIL' END
  
  UNION ALL
  SELECT 4, '⚙️  FUNCTIONS',
    (SELECT COUNT(*)::text || '/14' FROM pg_proc WHERE proname IN ('set_updated_at', 'create_profile_for_new_user', 'create_new_team_workspace', 'prevent_last_admin_change', 'join_workspace', 'move_task_to_workspace', 'get_or_create_dm', 'search_all', 'get_task_analytics', 'get_member_activity', 'get_workspace_overview', 'claim_unpushed_notifications', 'create_deadline_notifications', 'create_event_reminders')),
    CASE WHEN (SELECT COUNT(*) FROM pg_proc WHERE proname IN ('set_updated_at', 'create_profile_for_new_user', 'create_new_team_workspace', 'prevent_last_admin_change', 'join_workspace', 'move_task_to_workspace', 'get_or_create_dm', 'search_all', 'get_task_analytics', 'get_member_activity', 'get_workspace_overview', 'claim_unpushed_notifications', 'create_deadline_notifications', 'create_event_reminders')) >= 14 
      THEN '✅ PASS' ELSE '❌ FAIL' END
  
  UNION ALL
  SELECT 5, '🔒 RLS POLICIES',
    (SELECT COUNT(*)::text FROM pg_policies WHERE schemaname = 'public'),
    CASE WHEN (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') >= 50 
      THEN '✅ PASS' ELSE '⚠️  LOW (need 50+)' END
  
  UNION ALL
  SELECT 6, '⏰ CRON JOBS',
    (SELECT COUNT(*)::text || '/2' FROM cron.job WHERE jobname IN ('run_reminders_and_push', 'purge_old_rows')),
    CASE WHEN (SELECT COUNT(*) FROM cron.job WHERE jobname IN ('run_reminders_and_push', 'purge_old_rows')) = 2 
      THEN '✅ PASS' ELSE '❌ FAIL' END
  
  UNION ALL
  SELECT 7, '🗄️  STORAGE BUCKET',
    CASE WHEN (SELECT COUNT(*) FROM storage.buckets WHERE name = 'planpal-files' AND public = false) = 1 
      THEN 'planpal-files (private)' ELSE 'MISSING or PUBLIC' END,
    CASE WHEN (SELECT COUNT(*) FROM storage.buckets WHERE name = 'planpal-files' AND public = false) = 1 
      THEN '✅ PASS' ELSE '❌ FAIL' END
  
  UNION ALL
  SELECT 8, '═══════════════════', '═══════════════', '═══════════════════'
  
  UNION ALL
  SELECT 9, '🎯 OVERALL STATUS', '',
    CASE WHEN (
      (SELECT COUNT(*) FROM pg_extension WHERE extname IN ('pgcrypto', 'pg_trgm', 'pg_cron')) = 3 AND
      (SELECT COUNT(*) FROM pg_type WHERE typname IN ('workspace_type', 'member_role', 'task_status', 'task_priority', 'channel_kind', 'document_kind', 'notification_type')) = 7 AND
      (SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations')) = 19 AND
      (SELECT COUNT(*) FROM pg_proc WHERE proname IN ('set_updated_at', 'create_profile_for_new_user', 'create_new_team_workspace', 'prevent_last_admin_change', 'join_workspace', 'move_task_to_workspace', 'get_or_create_dm', 'search_all', 'get_task_analytics', 'get_member_activity', 'get_workspace_overview', 'claim_unpushed_notifications', 'create_deadline_notifications', 'create_event_reminders')) >= 14 AND
      (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') >= 50 AND
      (SELECT COUNT(*) FROM cron.job WHERE jobname IN ('run_reminders_and_push', 'purge_old_rows')) = 2 AND
      (SELECT COUNT(*) FROM storage.buckets WHERE name = 'planpal-files' AND public = false) = 1
    ) THEN '✅ STAGE 1 COMPLETE'
    ELSE '❌ STAGE 1 INCOMPLETE'
    END
)
SELECT component, count, status
FROM checks
ORDER BY ord;
