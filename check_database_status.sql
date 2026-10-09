-- ==================================================
-- PlanPal Database Status Check
-- Run this in Supabase SQL Editor to see what's installed
-- ==================================================

-- 1. Check Custom Types (from 0001_types.sql)
SELECT 
    'Custom Types' as category,
    typname as name,
    'EXISTS' as status
FROM pg_type 
WHERE typname IN (
    'workspace_type',
    'member_role', 
    'task_priority',
    'task_status',
    'notification_type',
    'attachment_type',
    'comment_type',
    'recurrence_frequency',
    'activity_action'
)
ORDER BY typname;

-- 2. Check Extensions (from 0001_types.sql)
SELECT 
    'Extensions' as category,
    extname as name,
    'INSTALLED' as status
FROM pg_extension
WHERE extname IN ('pgcrypto', 'pg_trgm', 'pg_cron')
ORDER BY extname;

-- 3. Check Main Tables (from 0002_core_tables.sql)
SELECT 
    'Main Tables' as category,
    table_name as name,
    'EXISTS' as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
    'workspaces',
    'workspace_members',
    'projects',
    'tasks',
    'task_dependencies',
    'tags',
    'task_tags',
    'comments',
    'attachments',
    'notifications',
    'activities'
)
ORDER BY table_name;

-- 4. Check Functions (from 0003_helper_functions.sql)
SELECT 
    'Helper Functions' as category,
    routine_name as name,
    'EXISTS' as status
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN (
    'get_user_workspaces',
    'get_workspace_members',
    'is_workspace_member',
    'get_user_role_in_workspace'
)
ORDER BY routine_name;

-- 5. Check RLS Policies (from 0004_rls_policies.sql)
SELECT 
    'RLS Policies' as category,
    tablename || '.' || policyname as name,
    'EXISTS' as status
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 6. Check Triggers (from 0005_triggers_functions.sql)
SELECT 
    'Triggers' as category,
    trigger_name as name,
    event_object_table as "on_table"
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- 7. Check Search Function (from 0006_search.sql)
SELECT 
    'Search Function' as category,
    routine_name as name,
    'EXISTS' as status
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name = 'global_search';

-- 8. Check Analytics Functions (from 0007_analytics.sql)
SELECT 
    'Analytics Functions' as category,
    routine_name as name,
    'EXISTS' as status
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN (
    'get_task_summary',
    'get_weekly_activity',
    'get_task_category_distribution',
    'get_daily_task_completion',
    'get_task_completion_streak'
)
ORDER BY routine_name;

-- 9. Check pg_cron Jobs (from 0008_scheduled_reminders.sql)
SELECT 
    'Scheduled Jobs' as category,
    jobname as name,
    'SCHEDULED' as status
FROM cron.job
WHERE jobname LIKE '%planpal%'
ORDER BY jobname;

-- 10. Check Realtime Publications (from 0009_realtime.sql)
SELECT 
    'Realtime Publications' as category,
    tablename as name,
    'ENABLED' as status
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
AND schemaname = 'public'
ORDER BY tablename;

-- ==================================================
-- SUMMARY: Count what exists
-- ==================================================
SELECT 
    'SUMMARY' as section,
    (SELECT COUNT(*) FROM pg_type WHERE typname IN ('workspace_type','member_role','task_priority','task_status','notification_type','attachment_type','comment_type','recurrence_frequency','activity_action')) as custom_types,
    (SELECT COUNT(*) FROM pg_extension WHERE extname IN ('pgcrypto', 'pg_trgm', 'pg_cron')) as extensions,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('workspaces','workspace_members','projects','tasks','task_dependencies','tags','task_tags','comments','attachments','notifications','activities')) as main_tables,
    (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name IN ('get_user_workspaces','get_workspace_members','is_workspace_member','get_user_role_in_workspace')) as helper_functions,
    (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') as rls_policies,
    (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = 'public') as triggers,
    (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name = 'global_search') as search_function,
    (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name IN ('get_task_summary','get_weekly_activity','get_task_category_distribution','get_daily_task_completion','get_task_completion_streak')) as analytics_functions,
    (SELECT COUNT(*) FROM cron.job WHERE jobname LIKE '%planpal%') as scheduled_jobs,
    (SELECT COUNT(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public') as realtime_tables;

-- ==================================================
-- Expected counts (if all migrations are applied):
-- - custom_types: 9
-- - extensions: 3
-- - main_tables: 11
-- - helper_functions: 4
-- - rls_policies: ~40-50 (varies by table)
-- - triggers: ~11 (updated_at triggers)
-- - search_function: 1
-- - analytics_functions: 5
-- - scheduled_jobs: 1-2
-- - realtime_tables: ~11
-- ==================================================
