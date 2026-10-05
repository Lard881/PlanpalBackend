-- List ALL custom functions in the database
SELECT 
  proname as function_name,
  pg_get_function_identity_arguments(oid) as arguments
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prokind = 'f'  -- functions only, not aggregates
ORDER BY proname;
