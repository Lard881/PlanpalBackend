-- ============================================================================
-- SUPABASE SETUP VERIFICATION SCRIPT
-- ============================================================================
-- Run this in Supabase SQL Editor to verify Stage 1 is complete
-- Copy the results and paste them back to verify everything is correct
-- ============================================================================

-- 1. CHECK EXTENSIONS
SELECT 'EXTENSIONS CHECK' as check_type, '' as name, '' as status;
SELECT 
  'Extension' as check_type,
  extname as name,
  CASE WHEN extname IS NOT NULL THEN '✓ Installed' ELSE '✗ Missing' END as status
FROM pg_extension
WHERE extname IN ('pgcrypto', 'pg_trgm', 'pg_cron')
ORDER BY extname;

-- 2. CHECK CUSTOM TYPES
SELECT '' as check_type, '' as name, '' as status;
SELECT 'TYPES CHECK' as check_type, '' as name, '' as status;
SELECT 
  'Type' as check_type,
  typname as name,
  CASE WHEN typname IS NOT NULL THEN '✓ Exists' ELSE '✗ Missing' END as status
FROM pg_type
WHERE typname IN ('workspace_type', 'member_role', 'task_status', 'task_priority', 'channel_kind', 'document_kind', 'notification_type')
ORDER BY typname;

-- 3. CHECK TABLES (Expected: 19 tables)
SELECT '' as check_type, '' as name, '' as status;
SELECT 'TABLES CHECK (Expected: 19)' as check_type, '' as name, '' as status;
SELECT 
  'Table' as check_type,
  tablename as name,
  CASE 
    WHEN rowsecurity THEN '✓ RLS Enabled' 
    ELSE '✗ RLS DISABLED' 
  END as status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename NOT IN ('schema_migrations')
ORDER BY tablename;

-- Count check
SELECT 
  'Table Count' as check_type,
  COUNT(*)::text as name,
  CASE 
    WHEN COUNT(*) >= 19 THEN '✓ Correct (19+)' 
    ELSE '✗ Missing tables (expected 19)' 
  END as status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename NOT IN ('schema_migrations');

-- 4. CHECK KEY FUNCTIONS
SELECT '' as check_type, '' as name, '' as status;
SELECT 'FUNCTIONS CHECK' as check_type, '' as name, '' as status;
SELECT 
  'Function' as check_type,
  proname as name,
  '✓ Exists' as status
FROM pg_proc
WHERE proname IN (
  'set_updated_at',
  'create_profile_for_new_user',
  'create_new_team_workspace',
  'prevent_last_admin_change',
  'join_workspace',
  'move_task_to_workspace',
  'get_or_create_dm',
  'search_all',
  'get_task_analytics',
  'get_member_activity',
  'get_workspace_overview',
  'claim_unpushed_notifications',
  'create_deadline_notifications',
  'create_event_reminders'
)
ORDER BY proname;

-- Count check
SELECT 
  'Function Count' as check_type,
  COUNT(*)::text as name,
  CASE 
    WHEN COUNT(*) >= 14 THEN '✓ All present (14+)' 
    ELSE '✗ Missing functions' 
  END as status
FROM pg_proc
WHERE proname IN (
  'set_updated_at',
  'create_profile_for_new_user',
  'create_new_team_workspace',
  'prevent_last_admin_change',
  'join_workspace',
  'move_task_to_workspace',
  'get_or_create_dm',
  'search_all',
  'get_task_analytics',
  'get_member_activity',
  'get_workspace_overview',
  'claim_unpushed_notifications',
  'create_deadline_notifications',
  'create_event_reminders'
);

-- 5. CHECK TRIGGERS
SELECT '' as check_type, '' as name, '' as status;
SELECT 'TRIGGERS CHECK' as check_type, '' as name, '' as status;
SELECT 
  'Trigger' as check_type,
  tgname as name,
  '✓ Active on ' || c.relname as status
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE tgname IN (
  'set_updated_at_profiles',
  'set_updated_at_workspaces',
  'set_updated_at_workspace_members',
  'set_updated_at_tasks',
  'set_updated_at_subtasks',
  'set_updated_at_task_comments',
  'set_updated_at_labels',
  'set_updated_at_files',
  'set_updated_at_events',
  'set_updated_at_folders',
  'set_updated_at_documents',
  'set_updated_at_channels',
  'set_updated_at_messages',
  'create_profile_trigger',
  'create_team_workspace_trigger',
  'tasks_completed_at_trg',
  'prevent_last_admin_update',
  'prevent_last_admin_delete'
)
ORDER BY tgname;

-- 6. CHECK RLS POLICIES (Sample check)
SELECT '' as check_type, '' as name, '' as status;
SELECT 'RLS POLICIES CHECK (Sample)' as check_type, '' as name, '' as status;
SELECT 
  'Policy' as check_type,
  schemaname || '.' || tablename || '.' || policyname as name,
  '✓ ' || cmd as status
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname
LIMIT 20;

-- Count total policies
SELECT 
  'Total RLS Policies' as check_type,
  COUNT(*)::text as name,
  CASE 
    WHEN COUNT(*) >= 50 THEN '✓ Comprehensive (50+)' 
    ELSE '⚠ May need review' 
  END as status
FROM pg_policies
WHERE schemaname = 'public';

-- 7. CHECK INDEXES (Sample)
SELECT '' as check_type, '' as name, '' as status;
SELECT 'INDEXES CHECK (Sample)' as check_type, '' as name, '' as status;
SELECT 
  'Index' as check_type,
  indexname as name,
  '✓ On ' || tablename as status
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE '%workspace%' OR indexname LIKE '%task%' OR indexname LIKE '%search%'
ORDER BY tablename, indexname
LIMIT 15;

-- 8. CHECK PG_CRON JOBS
SELECT '' as check_type, '' as name, '' as status;
SELECT 'PG_CRON JOBS CHECK' as check_type, '' as name, '' as status;
SELECT 
  'Cron Job' as check_type,
  jobname as name,
  '✓ ' || schedule || ' - ' || CASE WHEN active THEN 'Active' ELSE 'Inactive' END as status
FROM cron.job
WHERE jobname IN ('run_reminders_and_push', 'purge_old_rows')
ORDER BY jobname;

-- 9. CHECK REALTIME PUBLICATION
SELECT '' as check_type, '' as name, '' as status;
SELECT 'REALTIME PUBLICATION CHECK' as check_type, '' as name, '' as status;
SELECT 
  'Publication' as check_type,
  pubname as name,
  '✓ Exists' as status
FROM pg_publication
WHERE pubname = 'supabase_realtime';

-- Check which tables are in the publication
SELECT 
  'Realtime Table' as check_type,
  schemaname || '.' || tablename as name,
  '✓ Published' as status
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- 10. CHECK STORAGE BUCKETS (requires storage schema access)
-- Note: This requires specific permissions, may fail if not granted
SELECT '' as check_type, '' as name, '' as status;
SELECT 'STORAGE BUCKET CHECK' as check_type, '' as name, '' as status;
SELECT 
  'Bucket' as check_type,
  name as name,
  CASE 
    WHEN public THEN '⚠ PUBLIC (should be PRIVATE)' 
    ELSE '✓ Private' 
  END as status
FROM storage.buckets
WHERE name = 'planpal-files';

-- ============================================================================
-- SUMMARY COUNTS
-- ============================================================================
SELECT '' as check_type, '' as name, '' as status;
SELECT 'SUMMARY' as check_type, '' as name, '' as status;

SELECT 'Tables' as check_type, COUNT(*)::text as name, 'Expected: 19' as status
FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations');

SELECT 'Functions' as check_type, COUNT(*)::text as name, 'Expected: 14+' as status
FROM pg_proc WHERE proname IN (
  'set_updated_at', 'create_profile_for_new_user', 'create_new_team_workspace',
  'prevent_last_admin_change', 'join_workspace', 'move_task_to_workspace',
  'get_or_create_dm', 'search_all', 'get_task_analytics', 'get_member_activity',
  'get_workspace_overview', 'claim_unpushed_notifications', 
  'create_deadline_notifications', 'create_event_reminders'
);

SELECT 'RLS Policies' as check_type, COUNT(*)::text as name, 'Expected: 50+' as status
FROM pg_policies WHERE schemaname = 'public';

SELECT 'Cron Jobs' as check_type, COUNT(*)::text as name, 'Expected: 2' as status
FROM cron.job WHERE jobname IN ('run_reminders_and_push', 'purge_old_rows');

SELECT 'Storage Buckets' as check_type, COUNT(*)::text as name, 'Expected: 1 (planpal-files)' as status
FROM storage.buckets WHERE name = 'planpal-files';

-- ============================================================================
-- PROFILE + PERSONAL WORKSPACE AUTO-CREATION TEST
-- ============================================================================
SELECT '' as check_type, '' as name, '' as status;
SELECT 'AUTO-CREATION TEST' as check_type, '' as name, '' as status;
SELECT 
  'Test' as check_type,
  'Profile + Personal Workspace' as name,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      WHERE tgname = 'create_profile_trigger' AND c.relname = 'users'
    ) THEN '✓ Trigger exists on auth.users'
    ELSE '✗ Missing trigger on auth.users'
  END as status;

-- ============================================================================
-- INSTRUCTIONS
-- ============================================================================
SELECT '' as check_type, '' as name, '' as status;
SELECT 'INSTRUCTIONS' as check_type, '' as name, '' as status;
SELECT 'Next Steps' as check_type, 
       'If any items show ✗ or ⚠, migrations may not have run completely' as name,
       'Run migrations 0001-0009 in order from supabase/migrations/' as status;
