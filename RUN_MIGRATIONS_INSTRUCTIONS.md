# Test Database Migration Instructions

## EASIEST METHOD: Copy/Paste in Supabase Dashboard

### Step 1: Open SQL Editor
1. Go to: https://supabase.com/dashboard/project/raqxkjvpoowaiiqnlzqv
2. Click **"SQL Editor"** in the left sidebar
3. Click **"+ New query"**

### Step 2: Run Each Migration (in order)

Copy the ENTIRE contents of each file below, paste into SQL Editor, and click **"Run"**.

Wait for "Success. No rows returned" before moving to the next one.

#### Migration 1: Types (30 seconds)
**File**: `supabase/migrations/0001_types.sql`
- Creates database types (enums)
- Should complete instantly

#### Migration 2: Core Tables (30 seconds)
**File**: `supabase/migrations/0002_core_tables.sql`
- Creates all main tables
- ~18 tables total

#### Migration 3: Helper Functions (10 seconds)
**File**: `supabase/migrations/0003_helper_functions.sql`
- Creates RLS helper functions

#### Migration 4: RLS Policies (30 seconds)
**File**: `supabase/migrations/0004_rls_policies.sql`
- Enables Row Level Security
- Creates all security policies

#### Migration 5: Triggers (20 seconds)
**File**: `supabase/migrations/0005_triggers_functions.sql`
- Business logic triggers
- New user setup, workspace creation

#### Migration 6: Search (10 seconds)
**File**: `supabase/migrations/0006_search.sql`
- Full-text search setup

#### Migration 7: Analytics (10 seconds)
**File**: `supabase/migrations/0007_analytics.sql`
- Analytics views and functions

#### Migration 8: Reminders (10 seconds)
**File**: `supabase/migrations/0008_pg_cron_reminders.sql`
- Scheduled reminder jobs

#### Migration 9: Realtime (10 seconds)
**File**: `supabase/migrations/0009_realtime.sql`
- Enables realtime subscriptions

---

## Total Time: ~3-5 minutes

### How to Know It Worked:
After migration 9, go to **Database** → **Tables** in Supabase dashboard.

You should see these tables:
- ✅ profiles
- ✅ workspaces
- ✅ workspace_members
- ✅ tasks
- ✅ labels
- ✅ events
- ✅ channels
- ✅ messages
- ✅ notifications
- ✅ device_tokens
- Plus more...

---

## What to Do After:

Once all migrations complete:

```powershell
cd "c:\Users\lardg\Desktop\TASK APP\BACKEND"
npm test
```

This will run all 106 tests against your TEST database (not production).

---

## Troubleshooting:

### If a migration fails:
1. Note which one failed (e.g., migration 4)
2. Check the error message
3. Go to Supabase **Database** → **Logs** to see details
4. Tell me the error and I'll fix it

### Common issues:
- **"relation already exists"**: Table was already created, skip that migration
- **"permission denied"**: You're not using the service role key
- **"syntax error"**: Copy/paste error, try again

---

## Alternative: Use Supabase CLI (For Advanced Users)

If you prefer command-line:

```powershell
# Install CLI
npm install -g supabase

# Login
supabase login

# Link project
supabase link --project-ref raqxkjvpoowaiiqnlzqv

# Push migrations
supabase db push
```

This runs all 9 migrations automatically.
