-- Run this AFTER ONE_PASTE_SETUP.sql. Every row should say OK.
select 'tables (expect 19)' as check,
       count(*)::text as found,
       case when count(*) = 19 then 'OK' else 'PROBLEM' end as status
  from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE'
union all
select 'tables with RLS on (expect 19)',
       count(*)::text,
       case when count(*) = 19 then 'OK' else 'PROBLEM' end
  from pg_tables t join pg_class c on c.relname = t.tablename
 where t.schemaname = 'public' and c.relrowsecurity
union all
select 'policies (expect 46)', count(*)::text,
       case when count(*) = 46 then 'OK' else 'PROBLEM' end
  from pg_policies where schemaname = 'public'
union all
select 'key functions (expect 10)', count(*)::text,
       case when count(*) = 10 then 'OK' else 'PROBLEM' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in (
   'join_workspace','move_task_to_workspace','get_or_create_dm','search_all',
   'analytics_summary','analytics_streak','claim_unpushed_notifications',
   'run_reminders_and_push','purge_old_rows','create_deadline_notifications')
union all
select 'signup trigger on auth.users (expect 1)', count(*)::text,
       case when count(*) = 1 then 'OK' else 'PROBLEM' end
  from pg_trigger where tgname = 'on_auth_user_created'
union all
select 'cron jobs (expect 2)', count(*)::text,
       case when count(*) = 2 then 'OK' else 'PROBLEM (enable pg_cron, then re-check)' end
  from cron.job where jobname in ('planpal-reminders','planpal-cleanup')
union all
select 'vault secrets (expect 2 after you add them)', count(*)::text,
       case when count(*) = 2 then 'OK' else 'ADD THE TWO VAULT SECRETS' end
  from vault.decrypted_secrets where name in ('planpal_api_url','planpal_cron_secret');
