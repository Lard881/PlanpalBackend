# How to Run ONE_PASTE_SETUP.sql

Follow these steps to set up the complete PlanPal database schema in Supabase.

---

## Step 1: Enable pg_net Extension

**Before running the SQL file**, you need to enable the `pg_net` extension:

1. Open your Supabase Dashboard
2. Go to **Database** > **Extensions**
3. Search for **pg_net**
4. Click the toggle to **enable** it

---

## Step 2: Run the SQL File

1. Open Supabase Dashboard
2. Go to **SQL Editor**
3. Click **New query**
4. Open the file `supabase/ONE_PASTE_SETUP.sql` on your computer
5. Copy **the entire contents** of the file
6. Paste it into the SQL Editor
7. Click **Run** (or press Ctrl/Cmd + Enter)

The script will take 10-30 seconds to complete.

---

## Step 3: Verify Success

### A successful run shows:
- The query completes without errors
- You see "Success. No rows returned" or similar message
- The Results panel shows completion

### Check that everything was created:

**1. Check Tables (Database > Table Editor):**
You should see these tables:
- profiles
- workspaces
- workspace_members
- invite_codes
- labels
- files
- tasks
- subtasks
- task_comments
- task_attachments
- events
- event_attendees
- channels
- channel_members
- messages
- folders
- documents
- notifications
- device_tokens

**2. Check Storage (Storage):**
- You should see a bucket named **planpal-files**
- It should be marked as **Private**

**3. Test Profile & Workspace Creation:**
1. Go to **Authentication** > **Users**
2. Click **Add user** > **Create new user**
3. Enter a test email (e.g., `test@example.com`) and password
4. Click **Create user**
5. Go to **Table Editor** > **profiles**
6. You should see a new profile row for that user
7. Go to **Table Editor** > **workspaces**
8. You should see a new workspace named **"Personal"** for that user
9. Go to **Table Editor** > **workspace_members**
10. You should see the user as an **admin** of their Personal workspace

---

## Step 4: Configure Authentication Settings

The SQL file creates the database schema only. You also need to configure auth settings in the Supabase Dashboard:

### Email Authentication Settings:

1. Go to **Authentication** > **Providers** > **Email**
2. Make sure **Enable Email provider** is ON
3. **Enable Custom SMTP** (optional but recommended for production):
   - Use your Resend API key as configured previously

### Email Templates (Optional):

1. Go to **Authentication** > **Email Templates**
2. Customize **Confirm signup** and **Reset password** templates
3. Change the 6-digit code expiry to **10 minutes** (600 seconds)

### Password Requirements:

1. Go to **Authentication** > **Policies**
2. Set **Minimum password length** to **8**

### Google OAuth (Optional):

1. Go to **Authentication** > **Providers** > **Google**
2. Enable Google provider
3. Add your Google OAuth Client ID and Secret from Google Cloud Console
4. Add redirect URL: `https://your-project.supabase.co/auth/v1/callback`

---

## Troubleshooting

### If you see errors:

**Common Error: "extension 'pg_net' does not exist"**
- Solution: Go to Dashboard > Database > Extensions and enable pg_net first (see Step 1)

**Common Error: "type workspace_type already exists"**
- This is fine! The script is idempotent and handles existing objects safely
- Continue running, it will skip what already exists

**Common Error: "relation 'profiles' already exists"**
- This means some tables were already created
- The script is safe to run again—it will skip existing tables

### If partial setup occurred:

The script is designed to be safe to run multiple times. Just run it again and it will:
- Skip what already exists
- Create what's missing
- Update functions and policies to the latest version

### If you need to start completely fresh:

**⚠️ WARNING: This deletes ALL data**

1. Go to SQL Editor
2. Run this command to drop all tables:
```sql
drop schema public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
```
3. Then run `ONE_PASTE_SETUP.sql` again

---

## Next Steps

After successful setup:

1. ✅ Database schema is complete
2. ✅ Storage bucket is ready
3. ✅ Row Level Security is enabled
4. ✅ Triggers and functions are active
5. ✅ Scheduled jobs are running (reminders, cleanup)

You can now:
- Test the backend API endpoints
- Start building the Flutter app
- Create test data to verify everything works

---

## Notes

- The SQL file is **idempotent**: safe to run multiple times
- No data is ever deleted (no DROP TABLE, TRUNCATE, or DELETE)
- All **create** statements use **if not exists** or **create or replace**
- Types, triggers, and policies are guarded against re-creation
- The Vault secrets for pg_cron jobs will be set up later in Stage 11

---

## Questions?

If something doesn't work as expected:
1. Check the error message carefully
2. Verify you completed Step 1 (enable pg_net)
3. Verify all tables exist in Table Editor
4. Check that a test user creates a profile and Personal workspace
5. Document any errors in QUESTIONS.md
