-- Supabase Storage Setup for Task Attachments
-- Description: Create storage bucket and policies for file attachments
-- Author: PlanPal Team
-- Date: 2026-10-01

-- ============================================================================
-- STORAGE BUCKET CREATION
-- ============================================================================

-- Note: This should be run in Supabase SQL Editor or via the Dashboard
-- Alternatively, create the bucket via Dashboard: Storage > New Bucket

-- Create the task-attachments bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-attachments',
  'task-attachments',
  false, -- Not public - requires authentication
  52428800, -- 50MB file size limit (in bytes)
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/x-zip-compressed',
    'application/json'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- STORAGE POLICIES
-- ============================================================================

-- Policy: Users can view files in their workspaces
CREATE POLICY "Users can view workspace attachments"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'task-attachments'
  AND (storage.foldername(name))[1] IN (
    SELECT 'workspace-' || workspace_id::text
    FROM workspace_members
    WHERE user_id = auth.uid()
    AND deleted_at IS NULL
  )
);

-- Policy: Users can upload files to their workspaces
CREATE POLICY "Users can upload to workspace folders"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'task-attachments'
  AND (storage.foldername(name))[1] IN (
    SELECT 'workspace-' || workspace_id::text
    FROM workspace_members
    WHERE user_id = auth.uid()
    AND deleted_at IS NULL
  )
);

-- Policy: Users can update files they uploaded
CREATE POLICY "Users can update their own files"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'task-attachments'
  AND owner = auth.uid()
)
WITH CHECK (
  bucket_id = 'task-attachments'
  AND owner = auth.uid()
);

-- Policy: Users can delete their own files OR workspace admins can delete any file
CREATE POLICY "Users can delete their files or admins can delete workspace files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'task-attachments'
  AND (
    -- User owns the file
    owner = auth.uid()
    OR
    -- User is admin/owner of the workspace
    (storage.foldername(name))[1] IN (
      SELECT 'workspace-' || workspace_id::text
      FROM workspace_members
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
      AND deleted_at IS NULL
    )
  )
);

-- ============================================================================
-- STORAGE HELPER FUNCTIONS
-- ============================================================================

-- Function: Get signed URL for file download (expires in 1 hour)
-- Note: This is called from backend, not directly from client
CREATE OR REPLACE FUNCTION get_attachment_download_url(p_storage_path TEXT)
RETURNS TEXT AS $$
DECLARE
  v_url TEXT;
BEGIN
  -- Generate signed URL valid for 1 hour
  SELECT url INTO v_url
  FROM storage.objects
  WHERE bucket_id = 'task-attachments'
  AND name = p_storage_path;
  
  -- Return the storage path (backend will use Supabase SDK to generate signed URL)
  RETURN v_url;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Clean up orphaned files (files not referenced in task_attachments)
CREATE OR REPLACE FUNCTION cleanup_orphaned_storage_files()
RETURNS INTEGER AS $$
DECLARE
  v_deleted_count INTEGER := 0;
  v_file RECORD;
BEGIN
  -- Find files in storage that don't have a corresponding task_attachments record
  FOR v_file IN
    SELECT name
    FROM storage.objects
    WHERE bucket_id = 'task-attachments'
    AND name NOT IN (
      SELECT storage_path FROM task_attachments WHERE deleted_at IS NULL
      UNION
      SELECT thumbnail_path FROM task_attachments WHERE thumbnail_path IS NOT NULL AND deleted_at IS NULL
    )
  LOOP
    -- Delete the orphaned file
    DELETE FROM storage.objects
    WHERE bucket_id = 'task-attachments'
    AND name = v_file.name;
    
    v_deleted_count := v_deleted_count + 1;
  END LOOP;
  
  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get storage statistics for a workspace
CREATE OR REPLACE FUNCTION get_workspace_storage_stats(p_workspace_id UUID)
RETURNS TABLE(
  total_files BIGINT,
  total_size BIGINT,
  total_images BIGINT,
  total_documents BIGINT,
  total_other BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_files,
    COALESCE(SUM(file_size), 0)::BIGINT as total_size,
    COUNT(*) FILTER (WHERE mime_type LIKE 'image/%')::BIGINT as total_images,
    COUNT(*) FILTER (WHERE mime_type IN (
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ))::BIGINT as total_documents,
    COUNT(*) FILTER (WHERE 
      mime_type NOT LIKE 'image/%' 
      AND mime_type NOT IN (
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      )
    )::BIGINT as total_other
  FROM task_attachments
  WHERE workspace_id = p_workspace_id
  AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- TRIGGER: Auto-delete storage files when task_attachment is soft-deleted
-- ============================================================================

CREATE OR REPLACE FUNCTION delete_storage_files_on_soft_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- When a task_attachment is soft-deleted, delete the actual files from storage
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    -- Delete main file
    DELETE FROM storage.objects
    WHERE bucket_id = 'task-attachments'
    AND name = OLD.storage_path;
    
    -- Delete thumbnail if exists
    IF OLD.thumbnail_path IS NOT NULL THEN
      DELETE FROM storage.objects
      WHERE bucket_id = 'task-attachments'
      AND name = OLD.thumbnail_path;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER task_attachments_storage_cleanup
  AFTER UPDATE ON task_attachments
  FOR EACH ROW
  EXECUTE FUNCTION delete_storage_files_on_soft_delete();

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check bucket exists
-- SELECT * FROM storage.buckets WHERE id = 'task-attachments';

-- Check storage policies
-- SELECT * FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';

-- List all files in bucket
-- SELECT * FROM storage.objects WHERE bucket_id = 'task-attachments' LIMIT 10;

-- Get storage stats for a workspace (replace UUID)
-- SELECT * FROM get_workspace_storage_stats('00000000-0000-0000-0000-000000000000');

-- Clean up orphaned files
-- SELECT cleanup_orphaned_storage_files();

-- ============================================================================
-- NOTES
-- ============================================================================

/*
STORAGE PATH STRUCTURE:
  workspace-{workspace_id}/
    task-{task_id}/
      {file_uuid}.{extension}
      thumbs/
        {file_uuid}_thumb.{extension}

EXAMPLE:
  workspace-abc123/
    task-def456/
      file-789xyz.pdf
      image-111aaa.jpg
      thumbs/
        image-111aaa_thumb.jpg

MIME TYPE RESTRICTIONS:
  - Images: JPEG, PNG, GIF, WebP, SVG
  - Documents: PDF, Word, Excel, PowerPoint
  - Text: Plain text, CSV, JSON
  - Archives: ZIP
  - Max size: 50MB per file

SECURITY NOTES:
  - All files require authentication
  - Users can only access files in their workspaces
  - Workspace admins can delete any file in their workspace
  - Files are automatically deleted when attachment is soft-deleted
  - Signed URLs expire after 1 hour

BANDWIDTH OPTIMIZATION:
  - Use thumbnails for image previews
  - Generate thumbnails on upload (client-side or backend)
  - Thumbnails stored in thumbs/ subfolder
  - Original files loaded only when user opens them
*/

-- ============================================================================
-- MANUAL BUCKET CREATION (Alternative to INSERT above)
-- ============================================================================

/*
If you prefer to create the bucket via Supabase Dashboard:

1. Go to Storage section in Supabase Dashboard
2. Click "New Bucket"
3. Settings:
   - Name: task-attachments
   - Public: OFF (unchecked)
   - File size limit: 52428800 (50MB)
   - Allowed MIME types: (see array above)
4. Click "Create Bucket"
5. Then run the storage policies above

DASHBOARD PATH:
Project > Storage > Buckets > New Bucket
*/
