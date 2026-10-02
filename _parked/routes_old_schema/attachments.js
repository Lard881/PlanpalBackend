/**
 * Task Attachments Routes
 * 
 * Endpoints for file upload, download, and management
 * Files are stored in Supabase Storage bucket 'task-attachments'
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { userClient, adminClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validation.js';
import { z } from 'zod';

const router = express.Router();

// ============================================================================
// MULTER CONFIGURATION
// ============================================================================

// Configure multer for memory storage (we'll upload to Supabase, not local disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allowed MIME types
    const allowedMimeTypes = [
      // Images
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      // Documents
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // Text & Data
      'text/plain',
      'text/csv',
      'application/json',
      // Archives
      'application/zip',
      'application/x-zip-compressed',
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`), false);
    }
  },
});

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const uploadSchema = z.object({
  task_id: z.string().uuid(),
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get file extension from filename
 */
function getFileExtension(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

/**
 * Generate storage path for file
 */
function generateStoragePath(workspaceId, taskId, fileUuid, extension) {
  return `workspace-${workspaceId}/task-${taskId}/${fileUuid}.${extension}`;
}

/**
 * Generate thumbnail storage path
 */
function generateThumbnailPath(workspaceId, taskId, fileUuid, extension) {
  return `workspace-${workspaceId}/task-${taskId}/thumbs/${fileUuid}_thumb.${extension}`;
}

/**
 * Check if user has access to workspace
 */
async function checkWorkspaceAccess(userId, workspaceId) {
  const { data, error } = await adminClient
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single();

  if (error || !data) {
    return false;
  }

  return true;
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /tasks/:taskId/attachments
 * Upload a file attachment to a task
 */
router.post(
  '/tasks/:taskId/attachments',
  requireAuth,
  upload.single('file'),
  validateRequest({ params: uploadSchema }),
  async (req, res) => {
    try {
      const { taskId } = req.params;
      const userId = req.user.id;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          error: 'No file provided',
          message: 'Please upload a file',
        });
      }

      // Get task and verify workspace access
      const { data: task, error: taskError } = await adminClient
        .from('tasks')
        .select('workspace_id')
        .eq('id', taskId)
        .is('deleted_at', null)
        .single();

      if (taskError || !task) {
        return res.status(404).json({
          error: 'Task not found',
          message: 'The specified task does not exist',
        });
      }

      const workspaceId = task.workspace_id;

      // Check user has access to workspace
      const hasAccess = await checkWorkspaceAccess(userId, workspaceId);
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have access to this workspace',
        });
      }

      // Generate unique file ID and storage path
      const fileUuid = uuidv4();
      const extension = getFileExtension(file.originalname);
      const storagePath = generateStoragePath(workspaceId, taskId, fileUuid, extension);

      // Upload file to Supabase Storage
      const { data: uploadData, error: uploadError } = await adminClient.storage
        .from('task-attachments')
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        console.error('Storage upload error:', uploadError);
        return res.status(500).json({
          error: 'Upload failed',
          message: 'Failed to upload file to storage',
          details: uploadError.message,
        });
      }

      // Create attachment record in database
      const { data: attachment, error: dbError } = await adminClient
        .from('task_attachments')
        .insert({
          task_id: taskId,
          workspace_id: workspaceId,
          uploaded_by: userId,
          file_name: file.originalname,
          file_size: file.size,
          mime_type: file.mimetype,
          storage_path: storagePath,
        })
        .select()
        .single();

      if (dbError) {
        // Rollback: delete uploaded file
        await adminClient.storage
          .from('task-attachments')
          .remove([storagePath]);

        console.error('Database insert error:', dbError);
        return res.status(500).json({
          error: 'Database error',
          message: 'Failed to create attachment record',
          details: dbError.message,
        });
      }

      res.status(201).json({
        message: 'File uploaded successfully',
        attachment,
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({
        error: 'Server error',
        message: error.message,
      });
    }
  }
);

/**
 * GET /tasks/:taskId/attachments
 * Get all attachments for a task
 */
router.get(
  '/tasks/:taskId/attachments',
  requireAuth,
  validateRequest({ params: uploadSchema }),
  async (req, res) => {
    try {
      const { taskId } = req.params;
      const userId = req.user.id;

      // Get task and verify workspace access
      const { data: task, error: taskError } = await adminClient
        .from('tasks')
        .select('workspace_id')
        .eq('id', taskId)
        .is('deleted_at', null)
        .single();

      if (taskError || !task) {
        return res.status(404).json({
          error: 'Task not found',
        });
      }

      const workspaceId = task.workspace_id;
      const hasAccess = await checkWorkspaceAccess(userId, workspaceId);
      
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
        });
      }

      // Get all attachments for task
      const { data: attachments, error } = await adminClient
        .from('task_attachments')
        .select('*')
        .eq('task_id', taskId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      res.json({
        attachments: attachments || [],
        count: attachments?.length || 0,
      });
    } catch (error) {
      console.error('Get attachments error:', error);
      res.status(500).json({
        error: 'Server error',
        message: error.message,
      });
    }
  }
);

/**
 * GET /attachments/:attachmentId
 * Get a single attachment with metadata
 */
router.get(
  '/attachments/:attachmentId',
  requireAuth,
  async (req, res) => {
    try {
      const { attachmentId } = req.params;
      const userId = req.user.id;

      // Get attachment
      const { data: attachment, error: attachmentError } = await adminClient
        .from('task_attachments')
        .select('*, tasks!inner(workspace_id)')
        .eq('id', attachmentId)
        .is('deleted_at', null)
        .single();

      if (attachmentError || !attachment) {
        return res.status(404).json({
          error: 'Attachment not found',
        });
      }

      const workspaceId = attachment.tasks.workspace_id;
      const hasAccess = await checkWorkspaceAccess(userId, workspaceId);
      
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
        });
      }

      res.json({ attachment });
    } catch (error) {
      console.error('Get attachment error:', error);
      res.status(500).json({
        error: 'Server error',
        message: error.message,
      });
    }
  }
);

/**
 * GET /attachments/:attachmentId/download
 * Get a signed URL for downloading an attachment
 */
router.get(
  '/attachments/:attachmentId/download',
  requireAuth,
  async (req, res) => {
    try {
      const { attachmentId } = req.params;
      const userId = req.user.id;

      // Get attachment
      const { data: attachment, error: attachmentError } = await adminClient
        .from('task_attachments')
        .select('*, tasks!inner(workspace_id)')
        .eq('id', attachmentId)
        .is('deleted_at', null)
        .single();

      if (attachmentError || !attachment) {
        return res.status(404).json({
          error: 'Attachment not found',
        });
      }

      const workspaceId = attachment.tasks.workspace_id;
      const hasAccess = await checkWorkspaceAccess(userId, workspaceId);
      
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
        });
      }

      // Generate signed URL (expires in 1 hour)
      const { data: signedUrlData, error: urlError } = await supabaseAdmin.storage
        .from('task-attachments')
        .createSignedUrl(attachment.storage_path, 3600);

      if (urlError) {
        console.error('Signed URL error:', urlError);
        return res.status(500).json({
          error: 'Failed to generate download URL',
          message: urlError.message,
        });
      }

      res.json({
        download_url: signedUrlData.signedUrl,
        expires_in: 3600,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        file_size: attachment.file_size,
      });
    } catch (error) {
      console.error('Download error:', error);
      res.status(500).json({
        error: 'Server error',
        message: error.message,
      });
    }
  }
);

/**
 * DELETE /attachments/:attachmentId
 * Delete an attachment (soft delete in DB, hard delete in storage)
 */
router.delete(
  '/attachments/:attachmentId',
  requireAuth,
  async (req, res) => {
    try {
      const { attachmentId } = req.params;
      const userId = req.user.id;

      // Get attachment
      const { data: attachment, error: attachmentError } = await adminClient
        .from('task_attachments')
        .select('*, tasks!inner(workspace_id)')
        .eq('id', attachmentId)
        .is('deleted_at', null)
        .single();

      if (attachmentError || !attachment) {
        return res.status(404).json({
          error: 'Attachment not found',
        });
      }

      const workspaceId = attachment.tasks.workspace_id;

      // Check if user is the uploader or workspace admin
      const { data: member } = await adminClient
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .single();

      const canDelete = 
        attachment.uploaded_by === userId || 
        member?.role === 'owner' || 
        member?.role === 'admin';

      if (!canDelete) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only delete your own attachments',
        });
      }

      // Soft delete in database (trigger will handle storage deletion)
      const { error: deleteError } = await adminClient
        .from('task_attachments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', attachmentId);

      if (deleteError) {
        throw deleteError;
      }

      res.json({
        message: 'Attachment deleted successfully',
      });
    } catch (error) {
      console.error('Delete error:', error);
      res.status(500).json({
        error: 'Server error',
        message: error.message,
      });
    }
  }
);

export default router;
