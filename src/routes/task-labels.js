import { Router } from 'express';
import { supabase } from '../lib/supabase.js';

const router = Router();

/**
 * @route   POST /api/v1/tasks/:taskId/labels
 * @desc    Add a label to a task
 * @access  Private
 */
router.post('/:taskId/labels', async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { labelId } = req.body;
    const userId = req.user.id;

    if (!labelId) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'labelId is required',
        },
      });
    }

    // Verify task exists and user has access
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('id, workspace_id')
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      return res.status(404).json({
        error: {
          code: 'TASK_NOT_FOUND',
          message: 'Task not found',
        },
      });
    }

    // Verify user has access to workspace
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', task.workspace_id)
      .eq('user_id', userId)
      .single();

    if (!membership) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have access to this task',
        },
      });
    }

    // Verify label exists and belongs to workspace
    const { data: label, error: labelError } = await supabase
      .from('labels')
      .select('id, name, color')
      .eq('id', labelId)
      .eq('workspace_id', task.workspace_id)
      .single();

    if (labelError || !label) {
      return res.status(404).json({
        error: {
          code: 'LABEL_NOT_FOUND',
          message: 'Label not found in this workspace',
        },
      });
    }

    // Check if association already exists
    const { data: existing } = await supabase
      .from('task_labels')
      .select('*')
      .eq('task_id', taskId)
      .eq('label_id', labelId)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({ data: label });
    }

    // Create association
    const { data: association, error: createError } = await supabase
      .from('task_labels')
      .insert({
        task_id: taskId,
        label_id: labelId,
      })
      .select()
      .single();

    if (createError) {
      throw createError;
    }

    // Log activity
    await supabase.from('activities').insert({
      entity_type: 'task',
      entity_id: taskId,
      action: 'label_added',
      workspace_id: task.workspace_id,
      user_id: userId,
      metadata: {
        label_id: labelId,
        label_name: label.name,
        label_color: label.color,
      },
    });

    res.status(201).json({ data: label });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   DELETE /api/v1/tasks/:taskId/labels/:labelId
 * @desc    Remove a label from a task
 * @access  Private
 */
router.delete('/:taskId/labels/:labelId', async (req, res, next) => {
  try {
    const { taskId, labelId } = req.params;
    const userId = req.user.id;

    // Verify task exists and user has access
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('id, workspace_id')
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      return res.status(404).json({
        error: {
          code: 'TASK_NOT_FOUND',
          message: 'Task not found',
        },
      });
    }

    // Verify user has access to workspace
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', task.workspace_id)
      .eq('user_id', userId)
      .single();

    if (!membership) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have access to this task',
        },
      });
    }

    // Get label info before deletion for activity log
    const { data: label } = await supabase
      .from('labels')
      .select('name, color')
      .eq('id', labelId)
      .single();

    // Delete association
    const { error: deleteError } = await supabase
      .from('task_labels')
      .delete()
      .eq('task_id', taskId)
      .eq('label_id', labelId);

    if (deleteError) {
      throw deleteError;
    }

    // Log activity
    if (label) {
      await supabase.from('activities').insert({
        entity_type: 'task',
        entity_id: taskId,
        action: 'label_removed',
        workspace_id: task.workspace_id,
        user_id: userId,
        metadata: {
          label_id: labelId,
          label_name: label.name,
          label_color: label.color,
        },
      });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/v1/tasks/:taskId/labels
 * @desc    Get all labels for a task
 * @access  Private
 */
router.get('/:taskId/labels', async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;

    // Verify task exists and user has access
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('id, workspace_id')
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      return res.status(404).json({
        error: {
          code: 'TASK_NOT_FOUND',
          message: 'Task not found',
        },
      });
    }

    // Verify user has access to workspace
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', task.workspace_id)
      .eq('user_id', userId)
      .single();

    if (!membership) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have access to this task',
        },
      });
    }

    // Get labels
    const { data: taskLabels, error: labelsError } = await supabase
      .from('task_labels')
      .select(`
        label_id,
        labels (
          id,
          name,
          color,
          workspace_id,
          created_at,
          updated_at
        )
      `)
      .eq('task_id', taskId);

    if (labelsError) {
      throw labelsError;
    }

    // Extract and flatten labels
    const labels = (taskLabels || [])
      .map(tl => tl.labels)
      .filter(Boolean);

    res.json({ data: labels });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PUT /api/v1/tasks/:taskId/labels
 * @desc    Replace all labels for a task
 * @access  Private
 */
router.put('/:taskId/labels', async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { labelIds } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(labelIds)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'labelIds must be an array',
        },
      });
    }

    // Verify task exists and user has access
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('id, workspace_id')
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      return res.status(404).json({
        error: {
          code: 'TASK_NOT_FOUND',
          message: 'Task not found',
        },
      });
    }

    // Verify user has access to workspace
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', task.workspace_id)
      .eq('user_id', userId)
      .single();

    if (!membership) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have access to this task',
        },
      });
    }

    // Verify all labels exist and belong to workspace
    if (labelIds.length > 0) {
      const { data: labels, error: labelsError } = await supabase
        .from('labels')
        .select('id')
        .in('id', labelIds)
        .eq('workspace_id', task.workspace_id);

      if (labelsError || !labels || labels.length !== labelIds.length) {
        return res.status(400).json({
          error: {
            code: 'INVALID_LABELS',
            message: 'One or more labels are invalid or not in this workspace',
          },
        });
      }
    }

    // Delete all existing associations
    await supabase
      .from('task_labels')
      .delete()
      .eq('task_id', taskId);

    // Create new associations
    if (labelIds.length > 0) {
      const associations = labelIds.map(labelId => ({
        task_id: taskId,
        label_id: labelId,
      }));

      const { error: insertError } = await supabase
        .from('task_labels')
        .insert(associations);

      if (insertError) {
        throw insertError;
      }
    }

    // Log activity
    await supabase.from('activities').insert({
      entity_type: 'task',
      entity_id: taskId,
      action: 'labels_updated',
      workspace_id: task.workspace_id,
      user_id: userId,
      metadata: {
        label_ids: labelIds,
      },
    });

    // Fetch and return updated labels
    const { data: updatedLabels } = await supabase
      .from('task_labels')
      .select(`
        labels (
          id,
          name,
          color,
          workspace_id,
          created_at,
          updated_at
        )
      `)
      .eq('task_id', taskId);

    const labels = (updatedLabels || [])
      .map(tl => tl.labels)
      .filter(Boolean);

    res.json({ data: labels });
  } catch (error) {
    next(error);
  }
});

export default router;
