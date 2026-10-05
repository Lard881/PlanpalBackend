-- Check what cron jobs actually exist
SELECT 
  jobname,
  schedule,
  command,
  active,
  database
FROM cron.job
ORDER BY jobname;

-- If nothing shows, cron extension might not be enabled or jobs not created
-- Expected: planpal-reminders and planpal-cleanup
