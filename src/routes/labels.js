import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { loadWorkspace, requireRole } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';

const router = express.Router({ mergeParams: true }); // mergeParams for :workspaceId from parent

// Validation schemas
const createLabelSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

const updateLabelSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
}).refine(data => data.name || data.color, {
  message: 'At least one of name or color must be provided',
});

/**
 * GET /workspaces/:workspaceId/labels
 * List labels in workspace
 */
router.get('/', loadWorkspace, async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);
    
    const { data: labels, error } = await supabase
      .from('labels')
      .select('id, name, color, created_at')
      .eq('workspace_id', req.params.workspaceId)
      .is('deleted_at', null)
      .order('name', { ascending: true });
    
    if (error) throw error;
    
    res.json({ labels });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /workspaces/:workspaceId/labels
 * Create a new label
 */
router.post(
  '/',
  loadWorkspace,
  validate(createLabelSchema),
  async (req, res, next) => {
    try {
      const { name, color } = req.body;
      const supabase = userClient(req.jwt);
      
      const { data: label, error } = await supabase
        .from('labels')
        .insert({
          workspace_id: req.params.workspaceId,
          name,
          color,
        })
        .select()
        .single();
      
      if (error) throw error;
      
      res.status(201).json({ label });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /workspaces/:workspaceId/labels/:labelId
 * Update a label
 */
router.patch(
  '/:labelId',
  loadWorkspace,
  validate(updateLabelSchema),
  async (req, res, next) => {
    try {
      const updates = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.color !== undefined) updates.color = req.body.color;
      
      const supabase = userClient(req.jwt);
      
      const { data: label, error } = await supabase
        .from('labels')
        .update(updates)
        .eq('id', req.params.labelId)
        .eq('workspace_id', req.params.workspaceId)
        .select()
        .single();
      
      if (error) throw error;
      
      res.json({ label });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /workspaces/:workspaceId/labels/:labelId
 * Delete a label (admins only)
 */
router.delete(
  '/:labelId',
  loadWorkspace,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const supabase = userClient(req.jwt);
      
      const { error } = await supabase
        .from('labels')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', req.params.labelId)
        .eq('workspace_id', req.params.workspaceId);
      
      if (error) throw error;
      
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
