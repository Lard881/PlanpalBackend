import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /labels
 * Get all labels for a workspace
 */
router.get('/', async (req, res, next) => {
  try {
    const { workspace_id, updated_since } = req.query;

    if (!workspace_id) {
      return res.status(400).json({ error: { message: 'workspace_id is required' } });
    }

    // Verify user has access to workspace
    const { data: member } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspace_id)
      .eq('user_id', req.user.id)
      .single();

    if (!member) {
      return res.status(403).json({ error: { message: 'Access denied to workspace' } });
    }

    let query = supabase
      .from('labels')
      .select('*')
      .eq('workspace_id', workspace_id)
      .order('name', { ascending: true });

    // Incremental sync support
    if (updated_since) {
      query = query.gte('updated_at', updated_since);
    }

    const { data: labels, error } = await query;

    if (error) throw error;

    res.json({ labels });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /labels/:id
 * Get a single label
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: label, error } = await supabase
      .from('labels')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !label) {
      return res.status(404).json({ error: { message: 'Label not found' } });
    }

    // Verify workspace access
    const { data: member } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', label.workspace_id)
      .eq('user_id', req.user.id)
      .single();

    if (!member) {
      return res.status(403).json({ error: { message: 'Access denied' } });
    }

    res.json({ label });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /labels
 * Create a new label
 */
router.post('/', async (req, res, next) => {
  try {
    const { name, color, workspace_id } = req.body;

    // Validation
    if (!name || !color || !workspace_id) {
      return res.status(400).json({
        error: { message: 'name, color, and workspace_id are required' },
      });
    }

    // Verify workspace access
    const { data: member } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspace_id)
      .eq('user_id', req.user.id)
      .single();

    if (!member) {
      return res.status(403).json({ error: { message: 'Access denied to workspace' } });
    }

    // Check for duplicate name in workspace
    const { data: existing } = await supabase
      .from('labels')
      .select('id')
      .eq('workspace_id', workspace_id)
      .eq('name', name)
      .single();

    if (existing) {
      return res.status(400).json({
        error: { message: 'Label with this name already exists in workspace' },
      });
    }

    // Create label
    const { data: label, error } = await supabase
      .from('labels')
      .insert({
        name,
        color,
        workspace_id,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ label });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /labels/:id
 * Update a label
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, color } = req.body;

    // Get existing label
    const { data: label, error: fetchError } = await supabase
      .from('labels')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !label) {
      return res.status(404).json({ error: { message: 'Label not found' } });
    }

    // Verify workspace access
    const { data: member } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', label.workspace_id)
      .eq('user_id', req.user.id)
      .single();

    if (!member) {
      return res.status(403).json({ error: { message: 'Access denied' } });
    }

    // Check for duplicate name if changing name
    if (name && name !== label.name) {
      const { data: existing } = await supabase
        .from('labels')
        .select('id')
        .eq('workspace_id', label.workspace_id)
        .eq('name', name)
        .neq('id', id)
        .single();

      if (existing) {
        return res.status(400).json({
          error: { message: 'Label with this name already exists in workspace' },
        });
      }
    }

    // Update label
    const updateData = {};
    if (name) updateData.name = name;
    if (color) updateData.color = color;
    updateData.updated_at = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
      .from('labels')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ label: updated });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /labels/:id
 * Delete a label (also removes from all tasks)
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Get existing label
    const { data: label, error: fetchError } = await supabase
      .from('labels')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !label) {
      return res.status(404).json({ error: { message: 'Label not found' } });
    }

    // Verify workspace access (admin or owner only)
    const { data: member } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', label.workspace_id)
      .eq('user_id', req.user.id)
      .single();

    if (!member || (member.role !== 'admin' && member.role !== 'owner')) {
      return res.status(403).json({
        error: { message: 'Only admins can delete labels' },
      });
    }

    // Delete task-label associations first (cascade should handle this, but explicit is better)
    await supabase
      .from('task_labels')
      .delete()
      .eq('label_id', id);

    // Delete label
    const { error: deleteError } = await supabase
      .from('labels')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
