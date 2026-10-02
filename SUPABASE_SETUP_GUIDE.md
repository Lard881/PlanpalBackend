# Supabase Setup Guide for PlanPal

## Overview
This guide walks through setting up a Supabase project for PlanPal, including running migrations, configuring storage, Auth settings, and pg_cron jobs.

## Prerequisites
- Supabase account (free tier works)
- Supabase CLI installed (optional, can use dashboard)
- PlanPal backend code

## Step 1: Create Supabase Project
1. Go to https://supabase.com/dashboard
2. Click "New Project"
3. Choose organization and project name (e.g., "planpal-prod")
4. Set a strong database password
5. Choose a region close to your users
6. Wait for project provisioning (~2 minutes)

## Step 2: Run Database Migrations
Run these migrations IN ORDER in the Supabase SQL Editor (Dashboard > SQL Editor > New Query):

### Migration 0001: Extensions and Types
```sql
-- Paste contents of: supabase/migrations/0001_types.sql
```

### Migration 0002: Core Tables
```sql
-- Paste contents of: supabase/migrations/0002_core_tables.sql
```

### Migration 0003: Helper Functions
```sql
-- Paste contents of: supabase/migrations/0003_helper_functions.sql
```

### Migration 0004: RLS Policies
```sql
-- Paste contents of: supabase/migrations/0004_rls_policies.sql
```

### Migration 0005: Triggers and Functions
```sql
-- Paste contents of: supabase/migrations/0005_triggers_functions.sql
```

### Migration 0006: Search
```sql
-- Paste contents of: supabase/migrations/0006_search.sql
```

### Migration 0007: Analytics
```sql
-- Paste contents of: supabase/migrations/0007_analytics.sql
```

### Migration 0008: pg_cron Reminders
```sql
-- Paste contents of: supabase/migrations/0008_pg_cron_reminders.sql
```

### Migration 0009: Realtime
```sql
-- Paste contents of: supabase/migrations/0009_realtime.sql
```

## Step 3: Create Storage Bucket
1. Go to Dashboard > Storage
2. Click "Create new bucket"
3. Bucket name: `planpal-files`
4. Set to **Private** (not public)
5. Do NOT add any policies for `authenticated` role
6. Click "Create bucket"

## Step 4: Configure Vault Secrets (for pg_cron)
Run in SQL Editor:

```sql
-- Store your Render API URL
select vault.create_secret('https://your-service.onrender.com', 'planpal_api_url');

-- Store the CRON_SECRET (same value you'll use in Render env vars)
select vault.create_secret('your-long-random-secret-here', 'planpal_cron_secret');
```

**Generate a strong CRON_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Step 5: Configure Auth Settings
Dashboard > Authentication > Settings:

### Email Auth
- Enable Email provider: ✅
- Confirm email: ✅ (recommended for production)
- Minimum password length: 8

### Google OAuth
- Enable Google provider: ✅
- Add Client ID and Client Secret from Google Cloud Console
- Add authorized redirect URLs:
  - For development: `http://localhost:3000/auth/callback`
  - For production: `https://your-app.com/auth/callback`
  - Mobile deep link: `com.planpal.app://login-callback`

### Email OTP
- OTP expiry: 3600 seconds (1 hour)
- OTP length: 6 digits

### Custom SMTP (Resend)
Dashboard > Authentication > Settings > SMTP Settings:
- Enable Custom SMTP: ✅
- Host: `smtp.resend.com`
- Port: 465
- Username: `resend`
- Password: Your Resend API key
- Sender email: `noreply@yourdomain.com`
- Sender name: `PlanPal`

### Email Templates
Dashboard > Authentication > Email Templates:

**Confirm signup:**
```
<h2>Confirm your signup</h2>
<p>Enter this code in the app:</p>
<h1>{{ .Token }}</h1>
<p>This code expires in 1 hour.</p>
```

**Reset password:**
```
<h2>Reset your password</h2>
<p>Enter this code in the app:</p>
<h1>{{ .Token }}</h1>
<p>This code expires in 1 hour.</p>
```

## Step 6: Verify Setup

### Test User Creation
1. Create a test user via Dashboard > Authentication > Users > Add User
2. Check that:
   - A `profiles` row was created
   - A Personal `workspaces` row was created
   - A `workspace_members` row was created

### Test RLS
Run the RLS test suite:
```bash
cd backend
TEST_SUPABASE_URL=your-project-url \
TEST_SUPABASE_ANON_KEY=your-anon-key \
TEST_SUPABASE_SERVICE_KEY=your-service-key \
npm test tests/rls-isolation.test.js
```

### Verify pg_cron Jobs
Check that cron jobs are scheduled:
```sql
select * from cron.job;
```

You should see two jobs:
- `planpal-reminders` - runs every 5 minutes
- `planpal-cleanup` - runs weekly on Sunday at 03:00 UTC

## Step 7: Get API Keys
Dashboard > Settings > API:
- **Project URL**: Copy this (e.g., `https://abc123.supabase.co`)
- **anon/public key**: Copy this (safe to ship in Flutter app)
- **service_role key**: Copy this (NEVER ship in Flutter, only use in backend)

Add these to your backend `.env`:
```
SUPABASE_URL=https://abc123.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

## Step 8: Monitor Usage (Free Tier)
Dashboard > Settings > Usage:
- Database size: 500 MB limit
- Bandwidth: 5 GB limit
- Storage: 1 GB limit
- Realtime connections: 200 concurrent

Keep an eye on these limits. The cleanup job helps stay within them.

## Troubleshooting

### Migration Errors
- Run migrations one at a time
- Check error messages in SQL Editor
- Verify extensions are enabled: `select * from pg_available_extensions;`

### RLS Test Failures
- Ensure all migrations ran successfully
- Check that RLS is enabled: `select tablename, rowsecurity from pg_tables where schemaname = 'public';`
- Verify helper functions exist: `\df is_member`

### pg_cron Not Running
- Verify Vault secrets are set: `select name from vault.decrypted_secrets;`
- Check cron logs: `select * from cron.job_run_details order by start_time desc limit 10;`
- Ensure pg_cron and pg_net extensions are enabled

### Storage Upload Fails
- Verify bucket `planpal-files` exists and is private
- Check that NO RLS policies exist on the bucket for `authenticated` role
- Signed URLs are created by Express, not directly by client

## Next Steps
Once Supabase is configured:
1. Deploy backend to Render with Supabase credentials
2. Set up UptimeRobot monitors for `/health` and `/health/db`
3. Test end-to-end: signup, create task, join workspace with invite code
4. Configure Firebase for push notifications
5. Start building Flutter UI

## Additional Resources
- Supabase Documentation: https://supabase.com/docs
- pg_cron Documentation: https://github.com/citusdata/pg_cron
- Vault Documentation: https://supabase.com/docs/guides/database/vault
