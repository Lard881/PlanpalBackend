# Database Migrations

This directory contains SQL migration files for the PlanPal database schema.

## Migration Files

- `004_create_attachments_and_links.sql` - Task attachments and links tables

## How to Apply Migrations

### Option 1: Supabase Dashboard (Recommended for Development)

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy and paste the entire contents of the migration file
5. Click **Run** to execute the migration
6. Verify success in the **Table Editor**

### Option 2: Supabase CLI (Recommended for Production)

```bash
# Initialize Supabase CLI (first time only)
supabase init

# Link to your project
supabase link --project-ref your-project-ref

# Apply migration
supabase db push

# Or apply specific migration file
psql -h your-db-host -U postgres -d postgres -f migrations/004_create_attachments_and_links.sql
```

### Option 3: Direct psql Connection

```bash
psql "postgresql://postgres:[password]@[host]:5432/postgres" -f migrations/004_create_attachments_and_links.sql
```

## Migration 004: Attachments and Links

### What it Creates

**Tables:**
- `task_attachments` - File attachments with cloud storage references
- `task_links` - URL/link attachments with metadata

**Indexes:**
- Performance indexes on foreign keys and timestamps
- Soft-delete indexes for efficient queries

**RLS Policies:**
- Workspace-scoped access control
- Users can only access attachments/links in their workspaces
- Users can delete their own attachments
- Admins/owners can delete any attachment in their workspace

**Helper Functions:**
- `get_task_attachment_count(task_id)` - Count attachments for a task
- `get_task_link_count(task_id)` - Count links for a task
- `get_workspace_storage_used(workspace_id)` - Total storage used by workspace

### After Migration

1. **Configure Supabase Storage:**
   - Create bucket named `task-attachments`
   - Set up storage policies (see migration file comments)
   - Configure file size limits (50MB recommended)

2. **Update Backend:**
   - Add file upload endpoints
   - Add link management endpoints
   - Configure multer or similar for multipart uploads

3. **Update Frontend:**
   - Implement file upload UI
   - Implement link attachment UI
   - Add thumbnail generation

## Verification

After applying the migration, verify with these SQL queries:

```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('task_attachments', 'task_links');

-- Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('task_attachments', 'task_links');

-- Check policies exist
SELECT tablename, policyname FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename IN ('task_attachments', 'task_links');

-- Test helper functions
SELECT get_task_attachment_count('00000000-0000-0000-0000-000000000000');
SELECT get_task_link_count('00000000-0000-0000-0000-000000000000');
SELECT get_workspace_storage_used('00000000-0000-0000-0000-000000000000');
```

## Rollback

If you need to rollback this migration:

```sql
-- Drop tables (cascades to policies and indexes)
DROP TABLE IF EXISTS task_links CASCADE;
DROP TABLE IF EXISTS task_attachments CASCADE;

-- Drop helper functions
DROP FUNCTION IF EXISTS get_task_attachment_count(UUID);
DROP FUNCTION IF EXISTS get_task_link_count(UUID);
DROP FUNCTION IF EXISTS get_workspace_storage_used(UUID);

-- Drop triggers
DROP TRIGGER IF EXISTS task_attachments_updated_at ON task_attachments;
DROP TRIGGER IF EXISTS task_links_updated_at ON task_links;
DROP FUNCTION IF EXISTS update_task_attachments_updated_at();
DROP FUNCTION IF EXISTS update_task_links_updated_at();
```

## Notes

- Always backup your database before applying migrations
- Test migrations in a development environment first
- Migrations are designed to be idempotent (safe to run multiple times)
- Use transactions when applying multiple migrations

## Support

For issues or questions:
- Check Supabase logs in dashboard
- Review RLS policies if access issues occur
- Ensure workspace_members table has correct data
