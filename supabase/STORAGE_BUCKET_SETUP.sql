-- ============================================================================
-- Supabase Storage Bucket Setup
-- ============================================================================
-- Run this in Supabase Dashboard > Storage > Create new bucket
-- OR via SQL (requires storage.buckets table access)
-- ============================================================================

-- Create private bucket
insert into storage.buckets (id, name, public)
values ('planpal-files', 'planpal-files', false)
on conflict (id) do nothing;

-- NO client access policies on the bucket for authenticated role.
-- All uploads and downloads use signed URLs created by Express after permission checks.

-- Bucket configuration:
-- - Name: planpal-files
-- - Privacy: Private (no public URLs)
-- - File size limit: 25 MB per file (enforced in Express)
-- - Allowed MIME types (enforced in Express):
--   images: image/jpeg, image/png, image/webp, image/gif
--   documents: application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document,
--              application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,
--              application/vnd.openxmlformats-officedocument.presentationml.presentation
--   text: text/plain, text/csv
--   archives: application/zip

-- Object path format: {workspace_id}/{file_id}/{original_name}
-- Permission is determined by the files table row and RLS, NOT by the storage path.

-- Avatar uploads use: {user_id}/avatar/{filename}
-- Avatar signed URLs are independent of the files table.
