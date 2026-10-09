-- ==================================================
-- Show ALL tables in your database
-- ==================================================

SELECT 
    table_name as "Table Name",
    (
        SELECT COUNT(*) 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND columns.table_name = tables.table_name
    ) as "Column Count"
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- ==================================================
-- Show ALL custom types
-- ==================================================

SELECT 
    typname as "Type Name",
    string_agg(enumlabel, ', ' ORDER BY enumsortorder) as "Enum Values"
FROM pg_type t
LEFT JOIN pg_enum e ON t.oid = e.enumtypid
WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
GROUP BY typname
ORDER BY typname;

-- ==================================================
-- Show ALL functions (not system ones)
-- ==================================================

SELECT 
    routine_name as "Function Name",
    routine_type as "Type"
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name NOT LIKE 'pg_%'
ORDER BY routine_name;
