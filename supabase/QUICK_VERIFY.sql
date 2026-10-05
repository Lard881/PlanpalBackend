-- ============================================================================
-- QUICK VERIFICATION - Run this in Supabase SQL Editor
-- ============================================================================
-- This gives you a simple YES/NO answer if Stage 1 setup is complete
-- ============================================================================

DO $$
DECLARE
  v_tables int;
  v_functions int;
  v_policies int;
  v_cron_jobs int;
  v_bucket int;
  v_extensions int;
  v_types int;
  v_result text := E'\n🔍 PLANPAL STAGE 1 VERIFICATION\n' || repeat('=', 50) || E'\n\n';
BEGIN
  -- Check extensions
  SELECT COUNT(*) INTO v_extensions
  FROM pg_extension
  WHERE extname IN ('pgcrypto', 'pg_trgm', 'pg_cron');
  
  v_result := v_result || '📦 Extensions: ' || v_extensions || '/3 ' || 
    CASE WHEN v_extensions = 3 THEN '✅' ELSE '❌' END || E'\n';
  
  -- Check custom types
  SELECT COUNT(*) INTO v_types
  FROM pg_type
  WHERE typname IN ('workspace_type', 'member_role', 'task_status', 'task_priority', 'channel_kind', 'document_kind', 'notification_type');
  
  v_result := v_result || '🏷️  Custom Types: ' || v_types || '/7 ' || 
    CASE WHEN v_types = 7 THEN '✅' ELSE '❌' END || E'\n';
  
  -- Check tables
  SELECT COUNT(*) INTO v_tables
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations');
  
  v_result := v_result || '📋 Tables: ' || v_tables || '/19 ' || 
    CASE WHEN v_tables >= 19 THEN '✅' ELSE '❌' END || E'\n';
  
  -- Check functions
  SELECT COUNT(*) INTO v_functions
  FROM pg_proc
  WHERE proname IN (
    'set_updated_at', 'create_profile_for_new_user', 'create_new_team_workspace',
    'prevent_last_admin_change', 'join_workspace', 'move_task_to_workspace',
    'get_or_create_dm', 'search_all', 'get_task_analytics', 'get_member_activity',
    'get_workspace_overview', 'claim_unpushed_notifications', 
    'create_deadline_notifications', 'create_event_reminders'
  );
  
  v_result := v_result || '⚙️  Functions: ' || v_functions || '/14 ' || 
    CASE WHEN v_functions >= 14 THEN '✅' ELSE '❌' END || E'\n';
  
  -- Check RLS policies
  SELECT COUNT(*) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'public';
  
  v_result := v_result || '🔒 RLS Policies: ' || v_policies || ' ' || 
    CASE WHEN v_policies >= 50 THEN '✅' ELSE '⚠️ (expected 50+)' END || E'\n';
  
  -- Check cron jobs
  SELECT COUNT(*) INTO v_cron_jobs
  FROM cron.job
  WHERE jobname IN ('run_reminders_and_push', 'purge_old_rows');
  
  v_result := v_result || '⏰ Cron Jobs: ' || v_cron_jobs || '/2 ' || 
    CASE WHEN v_cron_jobs = 2 THEN '✅' ELSE '❌' END || E'\n';
  
  -- Check storage bucket
  SELECT COUNT(*) INTO v_bucket
  FROM storage.buckets
  WHERE name = 'planpal-files' AND public = false;
  
  v_result := v_result || '🗄️  Storage Bucket: ' || 
    CASE WHEN v_bucket = 1 THEN '✅ planpal-files (private)' ELSE '❌ missing or public' END || E'\n';
  
  v_result := v_result || E'\n' || repeat('=', 50) || E'\n';
  
  -- Overall status
  IF v_extensions = 3 AND v_types = 7 AND v_tables >= 19 AND v_functions >= 14 AND v_policies >= 50 AND v_cron_jobs = 2 AND v_bucket = 1 THEN
    v_result := v_result || E'✅ STAGE 1 COMPLETE - All checks passed!\n\n';
    v_result := v_result || E'Next: Run test by creating a new Auth user in Supabase Dashboard.\n';
    v_result := v_result || E'Expected: Profile + Personal workspace auto-created.\n';
  ELSE
    v_result := v_result || E'❌ STAGE 1 INCOMPLETE - See issues above\n\n';
    v_result := v_result || E'Action: Run migrations 0001-0009 from supabase/migrations/\n';
    v_result := v_result || E'Then create storage bucket "planpal-files" (private) in Supabase Dashboard\n';
  END IF;
  
  RAISE NOTICE '%', v_result;
END $$;

-- Show detailed list of tables
SELECT 
  '📋 TABLE DETAILS' as info,
  '' as table_name,
  '' as rls_status;

SELECT 
  '' as info,
  tablename as table_name,
  CASE WHEN rowsecurity THEN '✅ RLS ON' ELSE '❌ RLS OFF' END as rls_status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename NOT IN ('schema_migrations')
ORDER BY tablename;
