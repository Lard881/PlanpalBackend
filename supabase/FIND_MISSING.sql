-- Find which functions exist
SELECT 
  'EXISTING FUNCTIONS' as status,
  proname as function_name
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

-- Show what cron jobs exist
SELECT 
  'EXISTING CRON JOBS' as status,
  jobname as function_name
FROM cron.job
ORDER BY jobname;
