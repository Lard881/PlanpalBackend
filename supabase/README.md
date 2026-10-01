# Supabase Storage Configuration

This directory contains setup scripts and documentation for Supabase Storage configuration.

## Files

- `storage_setup.sql` - SQL script for storage policies and helper functions
- `../scripts/setup-storage.js` - Node.js script to create and configure storage bucket

## Quick Start

### Option 1: Automated Setup (Recommended)

```bash
# 1. Ensure environment variables are set in .env
SUPABASE_URL=your-project-url
SUPABASE_SERVICE_KEY=your-service-key

# 2. Run the setup script
node scripts/setup-storage.js

# 3. Apply storage policies
# Copy and run storage_setup.sql in Supabase SQL Editor
```

### Option 2: Manual Setup via Dashboard

**Step 1: Create Bucket**
1. Go to Supabase Dashboard → Storage
2. Click "New Bucket"
3. Configure:
   - **Name**: `task-attachments`
   - **Public**: OFF (unchecked)
   - **File size limit**: `52428800` (50MB)
   - **Allowed MIME types**: See list below

**Step 2: Apply Storage Policies**
1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `storage_setup.sql`
3. Click "Run" to execute

**Step 3: Verify**
```sql
-- Check bucket exists
SELECT * FROM storage.buckets WHERE id = 'task-attachments';

-- Check policies
SELECT * FROM pg_policies WHERE schemaname = 'storage';
```

## Storage Structure

### Folder Organization

```
task-attachments/
├── workspace-{workspace_id}/
│   ├── task-{task_id}/
│   │   ├── {file_uuid}.pdf
│   │   ├── {file_uuid}.jpg
│   │   └── thumbs/
│   │       └── {file_uuid}_thumb.jpg
│   └── task-{another_task_id}/
│       └── ...
└── workspace-{another_workspace_id}/
    └── ...
```

### Example Paths

```
workspace-abc123/task-def456/file-789xyz.pdf
workspace-abc123/task-def456/image-111aaa.jpg
workspace-abc123/task-def456/thumbs/image-111aaa_thumb.jpg
```

## Allowed File Types

### Images (6 types)
- `image/jpeg`, `image/jpg`
- `image/png`
- `image/gif`
- `image/webp`
- `image/svg+xml`

### Documents (7 types)
- `application/pdf` - PDF documents
- `application/msword` - Word (.doc)
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` - Word (.docx)
- `application/vnd.ms-excel` - Excel (.xls)
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` - Excel (.xlsx)
- `application/vnd.ms-powerpoint` - PowerPoint (.ppt)
- `application/vnd.openxmlformats-officedocument.presentationml.presentation` - PowerPoint (.pptx)

### Text & Data (3 types)
- `text/plain` - Plain text
- `text/csv` - CSV files
- `application/json` - JSON files

### Archives (2 types)
- `application/zip`
- `application/x-zip-compressed`

**Total**: 18 allowed MIME types

## File Size Limits

- **Per file**: 50MB (52,428,800 bytes)
- **Per workspace**: No hard limit (monitor usage)
- **Recommended workspace limit**: 5GB

## Storage Policies

### 1. SELECT (View Files)
- Users can view files in workspaces they are members of
- Checks `workspace_members` table
- Respects soft deletes (`deleted_at IS NULL`)

### 2. INSERT (Upload Files)
- Users can upload to workspace folders they belong to
- Files must be in `workspace-{id}/` structure
- Owner is set to `auth.uid()`

### 3. UPDATE (Modify Files)
- Users can only update files they uploaded
- Checks `owner = auth.uid()`

### 4. DELETE (Remove Files)
- Users can delete their own files
- Workspace owners/admins can delete any file in their workspace
- Soft-deleted attachments trigger automatic storage deletion

## Helper Functions

### Get Storage Statistics

```sql
SELECT * FROM get_workspace_storage_stats('workspace-id-here');
```

Returns:
- `total_files` - Number of attachments
- `total_size` - Total storage used (bytes)
- `total_images` - Count of image files
- `total_documents` - Count of document files
- `total_other` - Count of other file types

### Clean Up Orphaned Files

```sql
SELECT cleanup_orphaned_storage_files();
```

Removes files from storage that don't have a corresponding `task_attachments` record.

**Note**: Run this periodically (e.g., weekly) or trigger it after bulk deletions.

## Security Features

### Authentication
- All files require authentication
- No public URLs without signed access
- Signed URLs expire after 1 hour

### Authorization
- Workspace-scoped access control
- Users only see files in their workspaces
- Role-based deletion (admins can delete any file)

### Automatic Cleanup
- Files auto-delete when attachment is soft-deleted
- Trigger: `task_attachments_storage_cleanup`
- Removes both main file and thumbnail

## Backend Integration

### Upload File

```javascript
const { data, error } = await supabase.storage
  .from('task-attachments')
  .upload(
    `workspace-${workspaceId}/task-${taskId}/${fileUuid}.${ext}`,
    fileBuffer,
    {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: false,
    }
  );
```

### Download File (Signed URL)

```javascript
const { data, error } = await supabase.storage
  .from('task-attachments')
  .createSignedUrl(storagePath, 3600); // 1 hour expiry

// data.signedUrl contains temporary download URL
```

### Delete File

```javascript
const { error } = await supabase.storage
  .from('task-attachments')
  .remove([storagePath, thumbnailPath]);
```

### List Files

```javascript
const { data, error } = await supabase.storage
  .from('task-attachments')
  .list(`workspace-${workspaceId}/task-${taskId}`);
```

## Frontend Integration (Flutter)

### Check Required Packages

```yaml
dependencies:
  supabase_flutter: ^2.9.2
  file_picker: ^8.1.6
  image_picker: ^1.1.2
  cached_network_image: ^3.4.1
  dio: ^5.7.0 # For upload progress
```

### Upload with Progress

```dart
final file = File(filePath);
final fileBytes = await file.readAsBytes();

await supabase.storage.from('task-attachments').uploadBinary(
  'workspace-$workspaceId/task-$taskId/$fileName',
  fileBytes,
  fileOptions: FileOptions(
    contentType: mimeType,
    upsert: false,
  ),
);
```

### Get Public URL (Signed)

```dart
final signedUrl = await supabase.storage
  .from('task-attachments')
  .createSignedUrl(storagePath, 3600); // 1 hour
```

## Monitoring & Maintenance

### Check Storage Usage

**Dashboard**: Storage → Usage tab
- View total storage used
- See file count
- Monitor bandwidth usage

**SQL Query**:
```sql
SELECT 
  workspace_id,
  COUNT(*) as file_count,
  pg_size_pretty(SUM(file_size)::bigint) as total_size
FROM task_attachments
WHERE deleted_at IS NULL
GROUP BY workspace_id
ORDER BY SUM(file_size) DESC;
```

### Performance Optimization

1. **Use Thumbnails**: Always generate and use thumbnails for image previews
2. **Cache Aggressively**: Set long cache headers for immutable files
3. **Lazy Load**: Only load files when user requests them
4. **Cleanup Regularly**: Run `cleanup_orphaned_storage_files()` weekly
5. **Monitor Quotas**: Set up alerts for storage usage thresholds

### Backup Strategy

Supabase automatically backs up storage, but for critical files:
1. Enable Point-in-Time Recovery (PITR) in Supabase Dashboard
2. Consider periodic exports for long-term archival
3. Document restoration procedures

## Troubleshooting

### "Storage bucket not found"
- Run `node scripts/setup-storage.js` to create bucket
- Verify bucket name is exactly `task-attachments`

### "Permission denied" errors
- Check RLS policies are applied (`storage_setup.sql`)
- Verify user is member of workspace
- Check `workspace_members` table has correct data

### Files not uploading
- Verify file size is under 50MB
- Check MIME type is in allowed list
- Ensure correct folder structure (`workspace-{id}/task-{id}/...`)

### Orphaned files accumulating
- Run cleanup function: `SELECT cleanup_orphaned_storage_files();`
- Check trigger is active: `SELECT * FROM pg_trigger WHERE tgname = 'task_attachments_storage_cleanup';`

### Slow downloads
- Use CDN if available (Supabase Pro plan)
- Implement client-side caching
- Use thumbnails for previews instead of full files

## Cost Optimization

**Supabase Storage Pricing** (as of 2024):
- Free tier: 1GB storage, 2GB bandwidth/month
- Pro tier: 100GB storage, 200GB bandwidth/month
- Additional: $0.021/GB/month storage, $0.09/GB bandwidth

**Tips to reduce costs**:
1. Delete old attachments when tasks are archived
2. Compress images before upload
3. Use appropriate thumbnail sizes
4. Implement file retention policies
5. Monitor and clean up orphaned files

## References

- [Supabase Storage Documentation](https://supabase.com/docs/guides/storage)
- [Storage RLS Policies](https://supabase.com/docs/guides/storage/security/access-control)
- [File Upload Best Practices](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
