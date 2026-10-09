import express from 'express';
import { z } from 'zod';
import { userClient, adminClient } from '../lib/supabase.js';
import { loadWorkspace } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

const router = express.Router();

const uploadUrlSchema = z.object({
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().min(1).max(25 * 1024 * 1024), // 25 MB
});

// Allowed file types
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  'application/zip',
];

/**
 * Sanitize file name
 */
function sanitizeFileName(name) {
  return name
    .replace(/[/\\:*?"<>|]/g, '_') // Remove path separators and invalid chars
    // eslint-disable-next-line no-control-regex -- Removing control characters for file safety
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .substring(0, 120); // Limit to 120 characters
}

/**
 * POST /workspaces/:workspaceId/files/upload-url
 * Get signed upload URL
 */
router.post(
  '/workspaces/:workspaceId/files/upload-url',
  loadWorkspace,
  validate(uploadUrlSchema),
  async (req, res, next) => {
    try {
      const { name, mimeType, sizeBytes } = req.body;

      // Validate file type
      if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        throw new AppError(
          ErrorCodes.FILE_TYPE_NOT_ALLOWED,
          'File type not allowed',
          400
        );
      }

      // Validate size
      if (sizeBytes > 25 * 1024 * 1024) {
        throw new AppError(
          ErrorCodes.FILE_TOO_LARGE,
          'File size exceeds 25 MB limit',
          400
        );
      }

      const supabase = userClient(req.jwt);
      const fileId = crypto.randomUUID();
      const sanitizedName = sanitizeFileName(name);
      const path = `${req.params.workspaceId}/${fileId}/${sanitizedName}`;

      // Insert file record (RLS checks role)
      const { data: file, error: insertError } = await supabase
        .from('files')
        .insert({
          id: fileId,
          workspace_id: req.params.workspaceId,
          name: sanitizedName,
          mime_type: mimeType,
          size_bytes: sizeBytes,
          path,
          uploaded_by: req.user.id,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Create signed upload URL with admin client
      const { data: signedData, error: signError } = await adminClient.storage
        .from('planpal-files')
        .createSignedUploadUrl(path);

      if (signError) throw signError;

      res.json({
        fileId: file.id,
        uploadUrl: signedData.signedUrl,
        token: signedData.token,
        path: file.path,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /files/:fileId/download-url
 * Get signed download URL
 */
router.get('/files/:fileId/download-url', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    // Load file with user client (RLS enforced)
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('path')
      .eq('id', req.params.fileId)
      .single();

    if (fileError || !file) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'File not found', 404);
    }

    // Create signed download URL with admin client (5 minutes)
    const { data: signedData, error: signError } = await adminClient.storage
      .from('planpal-files')
      .createSignedUrl(file.path, 300); // 5 minutes

    if (signError) throw signError;

    res.json({ downloadUrl: signedData.signedUrl });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /files/:fileId
 * Delete file (uploader or admin)
 */
router.delete('/files/:fileId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    // Get file info
    const { data: file, error: fileError } = await supabase
      .from('files')
      .select('path, uploaded_by')
      .eq('id', req.params.fileId)
      .single();

    if (fileError) throw fileError;

    // Soft delete file record
    const { error: deleteError } = await supabase
      .from('files')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.fileId);

    if (deleteError) throw deleteError;

    // Delete from storage with admin client
    await adminClient.storage
      .from('planpal-files')
      .remove([file.path]);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
