/**
 * Task Links Routes
 * 
 * Endpoints for URL/link attachment management
 * Stores references to external resources (Figma, Google Docs, etc.)
 */

import express from 'express';
import { adminClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validation.js';
import { z } from 'zod';

const router = express.Router();

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const createLinkSchema = z.object({
  body: z.object({
    url: z.string().url('Must be a valid URL'),
    title: z.string().max(255).optional().nullable(),
    description: z.string().max(1000).optional().nullable(),
    favicon_url: z.string().url().optional().nullable(),
  }),
  params: z.object({
    taskId: z.string().uuid(),
  }),
});

const updateLinkSchema = z.object({
  body: z.object({
    title: z.string().max(255).optional().nullable(),
    description: z.string().max(1000).optional().nullable(),
    favicon_url: z.string().url().optional().nullable(),
  }),
  params: z.object({
    linkId: z.string().uuid(),
  }),
});

const linkIdSchema = z.object({
  params: z.object({
    linkId: z.string().uuid(),
  }),
});

const taskIdSchema = z.object({
  params: z.object({
    taskId: z.string().uuid(),
  }),
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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

/**
 * Extract domain from URL for display
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return null;
  }
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /tasks/:taskId/links
 * Add a link attachment to a task
 */
router.post(
  '/tasks/:taskId/links',
  requireAuth,
  validateRequest(createLinkSchema),
  async (req, res) => {
    try {
      const { taskId } = req.params;
      const { url, title, description, favicon_url } = req.body;
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

      // Extract domain for display if title not provided
      const domain = extractDomain(url);
      const linkTitle = title || domain || 'Link';

      // Create link record in database
      const { data: link, error: dbError } = await adminClient
        .from('task_links')
        .insert({
          task_id: taskId,
          workspace_id: workspaceId,
          added_by: userId,
          url: url,
          title: linkTitle,
          description: description || null,
          favicon_url: favicon_url || null,
        })
        .select()
        .single();

      if (dbError) {
        console.error('Database insert error:', dbError);
        return res.status(500).json({
          error: 'Database error',
          message: 'Failed to create link',
          details: dbError.message,
        });
      }

      res.status(201).json({
        message: 'Link added successfully',
        link,
      });
    } catch (error) {
      console.error('Create link error:', error);
      res.status(500).json({
        error: 'Server error',
        message: error.message,
      });
    }
  }
);

/**
 * GET /tasks/:taskId/links
 * Get all links for a task
 */
router.get(
  '/tasks/:taskId/links',
  requireAuth,
  validateRequest(taskIdSchema),
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

      // Get all links for task
      const { data: links, error } = await adminClient
        .from('task_links')
        .select('*')
        .eq('task_id', taskId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      res.json({
        links: links || [],
        count: links?.length || 0,
      });
    } catch (error) {
      console.error('Get links error:', error);
      res.status(500).json({
        error: 'Server error',
        message: error.message,
      });
    }
  }
);

/**
 * GET /links/:linkId
 * Get a single link with metadata
 */
router.get(
  '/links/:linkId',
  requireAuth,
  validateRequest(linkIdSchema),
  async (req, res) => {
    try {
      const { linkId } = req.params;
      const userId = req.user.id;

      // Get link
      const { data: link, error: linkError } = await adminClient
        .from('task_links')
        .select('*, tasks!inner(workspace_id)')
        .eq('id', linkId)
        .is('deleted_at', null)
        .single();

      if (linkError || !link) {
        return res.status(404).json({
          error: 'Link not found',
        });
      }

      const workspaceId = link.tasks.workspace_id;
      const hasAccess = await checkWorkspaceAccess(userId, workspaceId);
      
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
        });
      }

      res.json({ link });
    } catch (error) {
      console.error('Get link error:', error);
      res.status(500).json({
        error: 'Server error',
        message: error.message,
      });
    }
  }
);

/**
 * PATCH /links/:linkId
 * Update link metadata (title, description, favicon)
 */
router.patch(
  '/links/:linkId',
  requireAuth,
  validateRequest(updateLinkSchema),
  async (req, res) => {
    try {
      const { linkId } = req.params;
      const { title, description, favicon_url } = req.body;
      const userId = req.user.id;

      // Get link
      const { data: link, error: linkError } = await adminClient
        .from('task_links')
        .select('*, tasks!inner(workspace_id)')
        .eq('id', linkId)
        .is('deleted_at', null)
        .single();

      if (linkError || !link) {
        return res.status(404).json({
          error: 'Link not found',
        });
      }

      const workspaceId = link.tasks.workspace_id;
      const hasAccess = await checkWorkspaceAccess(userId, workspaceId);
      
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Access denied',
        });
      }

      // Build update object (only include provided fields)
      const updates = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (favicon_url !== undefined) updates.favicon_url = favicon_url;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          error: 'No updates provided',
          message: 'At least one field must be provided',
        });
      }

      // Update link
      const { data: updatedLink, error: updateError } = await adminClient
        .from('task_links')
        .update(updates)
        .eq('id', linkId)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      res.json({
        message: 'Link updated successfully',
        link: updatedLink,
      });
    } catch (error) {
      console.error('Update link error:', error);
      res.status(500).json({
        error: 'Server error',
        message: error.message,
      });
    }
  }
);

/**
 * DELETE /links/:linkId
 * Delete a link (soft delete)
 */
router.delete(
  '/links/:linkId',
  requireAuth,
  validateRequest(linkIdSchema),
  async (req, res) => {
    try {
      const { linkId } = req.params;
      const userId = req.user.id;

      // Get link
      const { data: link, error: linkError } = await adminClient
        .from('task_links')
        .select('*, tasks!inner(workspace_id)')
        .eq('id', linkId)
        .is('deleted_at', null)
        .single();

      if (linkError || !link) {
        return res.status(404).json({
          error: 'Link not found',
        });
      }

      const workspaceId = link.tasks.workspace_id;

      // Check if user is the creator or workspace admin
      const { data: member } = await adminClient
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .single();

      const canDelete = 
        link.added_by === userId || 
        member?.role === 'owner' || 
        member?.role === 'admin';

      if (!canDelete) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only delete your own links',
        });
      }

      // Soft delete link
      const { error: deleteError } = await adminClient
        .from('task_links')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', linkId);

      if (deleteError) {
        throw deleteError;
      }

      res.json({
        message: 'Link deleted successfully',
      });
    } catch (error) {
      console.error('Delete link error:', error);
      res.status(500).json({
        error: 'Server error',
        message: error.message,
      });
    }
  }
);

/**
 * POST /links/fetch-metadata
 * Fetch metadata (title, description, favicon) from a URL
 * This is a helper endpoint for the frontend to fetch metadata
 */
router.post(
  '/links/fetch-metadata',
  requireAuth,
  async (req, res) => {
    try {
      const { url } = req.body;

      if (!url) {
        return res.status(400).json({
          error: 'URL required',
          message: 'Please provide a URL to fetch metadata from',
        });
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        return res.status(400).json({
          error: 'Invalid URL',
          message: 'Please provide a valid URL',
        });
      }

      // Extract domain
      const domain = extractDomain(url);

      // In a production app, you'd use a service like:
      // - Open Graph scraping
      // - Microlink API
      // - LinkPreview API
      // For now, we'll return basic metadata
      
      const metadata = {
        url: url,
        title: domain || 'Link',
        description: null,
        favicon_url: domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : null,
        domain: domain,
      };

      res.json({
        metadata,
        message: 'Metadata fetched successfully',
      });
    } catch (error) {
      console.error('Fetch metadata error:', error);
      res.status(500).json({
        error: 'Server error',
        message: error.message,
      });
    }
  }
);

export default router;
