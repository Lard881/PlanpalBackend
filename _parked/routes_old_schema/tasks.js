import express from 'express';
import {
  createTaskSchema,
  updateTaskSchema,
  taskQuerySchema,
  bulkTaskActionSchema,
  moveTaskSchema,
  validate,
} from '../lib/validation.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

// ============================================================================
// GET /tasks - List tasks with filters
// ============================================================================

router.get('/', validate(taskQuerySchema), async (req, res, next) => {
  try {
    const {
      workspace_id,
      project_id,
      assignee_id,
      status,
      priority,
      labels,
      search,
      view,
      sort,
      page,
      limit,
    } = req.query;

    const workspaceId = workspace_id || req.workspaceId;
    const offset = (page - 1) * limit;

    // Build query
    let query = req.supabase
      .from('tasks')
      .select('*, project:projects(id,name,color), assignee:profiles!tasks_assignee_id_fkey(id,name,avatar_url)', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null);

    // Filters
    if (project_id) query = query.eq('project_id', project_id);
    if (assignee_id) query = query.eq('assignee_id', assignee_id);
    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);

    // Labels filter (task must have ALL specified labels)
    if (labels) {
      const labelIds = labels.split(',').filter(Boolean);
      if (labelIds.length > 0) {
        query = query.contains('label_ids', labelIds);
      }
    }

    // Search
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // View-based filters
    const now = new Date().toISOString();
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const todayEnd = today.toISOString();
    
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    weekEnd.setHours(23, 59, 59, 999);
    const weekEndStr = weekEnd.toISOString();

    switch (view) {
      case 'today':
        query = query.lte('due_date', todayEnd).neq('status', 'completed');
        break;
      case 'week':
        query = query.lte('due_date', weekEndStr).neq('status', 'completed');
        break;
      case 'overdue':
        query = query.lt('due_date', now).neq('status', 'completed');
        break;
      case 'completed':
        query = query.eq('status', 'completed');
        break;
      // 'all' - no additional filter
    }

    // Sorting
    switch (sort) {
      case 'created_asc':
        query = query.order('created_at', { ascending: true });
        break;
      case 'created_desc':
        query = query.order('created_at', { ascending: false });
        break;
      case 'due_asc':
        query = query.order('due_date', { ascending: true, nullsFirst: false });
        break;
      case 'due_desc':
        query = query.order('due_date', { ascending: false, nullsFirst: false });
        break;
      case 'priority':
        // Custom order: urgent > high > medium > low > null
        query = query.order('priority', { ascending: false, nullsFirst: false });
        break;
      case 'title':
        query = query.order('title', { ascending: true });
        break;
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data: tasks, error, count } = await query;

    if (error) throw error;

    res.json({
      tasks: tasks || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /tasks - Create a new task
// ============================================================================

router.post('/', validate(createTaskSchema), async (req, res, next) => {
  try {
    const taskData = {
      ...req.body,
      workspace_id: req.body.workspace_id || req.workspaceId,
      created_by: req.userId,
    };

    // If client provided ID, check for conflict (idempotency)
    if (taskData.id) {
      const { data: existing } = await req.supabase
        .from('tasks')
        .select('*')
        .eq('id', taskData.id)
        .single();

      if (existing) {
        logger.info(`Task ${taskData.id} already exists, returning existing`);
        return res.status(200).json({ task: existing });
      }
    }

    // Verify assignee is a member if provided
    if (taskData.assignee_id) {
      const { data: member } = await req.supabase
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', taskData.workspace_id)
        .eq('user_id', taskData.assignee_id)
        .single();

      if (!member) {
        throw new AppError('NOT_A_MEMBER', 'Assignee is not a member of this workspace', 400);
      }
    }

    // Create task
    const { data: task, error } = await req.supabase
      .from('tasks')
      .insert(taskData)
      .select('*, project:projects(id,name,color), assignee:profiles!tasks_assignee_id_fkey(id,name,avatar_url)')
      .single();

    if (error) throw error;

    // Handle labels if provided
    if (req.body.labels && req.body.labels.length > 0) {
      const labelLinks = req.body.labels.map(labelId => ({
        task_id: task.id,
        label_id: labelId,
      }));

      await req.supabase.from('task_labels').insert(labelLinks);
    }

    logger.info(`Task created: ${task.id} in workspace ${taskData.workspace_id}`);

    res.status(201).json({ task });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /tasks/:id - Get task details
// ============================================================================

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: task, error } = await req.supabase
      .from('tasks')
      .select(`
        *,
        project:projects(id,name,color,icon),
        assignee:profiles!tasks_assignee_id_fkey(id,name,avatar_url),
        labels:task_labels(label:labels(*)),
        subtasks:tasks!parent_task_id(id,title,status,position,completed_at),
        comments:task_comments(id,content,created_at,author:profiles(id,name,avatar_url))
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new AppError('NOT_FOUND', 'Task not found', 404);
      }
      throw error;
    }

    res.json({ task });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PATCH /tasks/:id - Update a task
// ============================================================================

router.patch('/:id', validate(updateTaskSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check if task exists and user has access
    const { data: existing } = await req.supabase
      .from('tasks')
      .select('workspace_id, status')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (!existing) {
      throw new AppError('NOT_FOUND', 'Task not found', 404);
    }

    // Verify assignee is a member if changing
    if (updates.assignee_id) {
      const { data: member } = await req.supabase
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', existing.workspace_id)
        .eq('user_id', updates.assignee_id)
        .single();

      if (!member) {
        throw new AppError('NOT_A_MEMBER', 'Assignee is not a member of this workspace', 400);
      }
    }

    // If marking as completed, set completed_at
    if (updates.status === 'completed' && existing.status !== 'completed') {
      updates.completed_at = new Date().toISOString();
    } else if (updates.status && updates.status !== 'completed') {
      updates.completed_at = null;
    }

    // Update task
    const { data: task, error } = await req.supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .select('*, project:projects(id,name,color), assignee:profiles!tasks_assignee_id_fkey(id,name,avatar_url)')
      .single();

    if (error) throw error;

    logger.info(`Task updated: ${id}`);

    res.json({ task });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DELETE /tasks/:id - Soft delete a task
// ============================================================================

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Soft delete
    const { error } = await req.supabase
      .from('tasks')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) throw error;

    logger.info(`Task deleted: ${id}`);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /tasks/bulk - Bulk actions (complete or delete)
// ============================================================================

router.post('/bulk', validate(bulkTaskActionSchema), async (req, res, next) => {
  try {
    const { task_ids, action } = req.body;
    const results = [];

    for (const taskId of task_ids) {
      try {
        if (action === 'complete') {
          await req.supabase
            .from('tasks')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
            })
            .eq('id', taskId)
            .is('deleted_at', null);

          results.push({ id: taskId, success: true });
        } else if (action === 'delete') {
          await req.supabase
            .from('tasks')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', taskId)
            .is('deleted_at', null);

          results.push({ id: taskId, success: true });
        }
      } catch (error) {
        results.push({ id: taskId, success: false, error: error.message });
      }
    }

    logger.info(`Bulk ${action}: ${task_ids.length} tasks`);

    res.json({ results });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /tasks/:id/move - Move task to another workspace
// ============================================================================

router.post('/:id/move', validate(moveTaskSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { target_workspace_id, target_project_id } = req.body;

    // Verify user is member of target workspace
    const { data: targetMember } = await req.supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', target_workspace_id)
      .eq('user_id', req.userId)
      .single();

    if (!targetMember) {
      throw new AppError('NOT_A_MEMBER', 'You are not a member of the target workspace', 403);
    }

    // Move task (updates workspace_id, clears project, assignee, labels)
    const { data: task, error } = await req.supabase
      .from('tasks')
      .update({
        workspace_id: target_workspace_id,
        project_id: target_project_id || null,
        assignee_id: null, // Clear assignee when moving
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Clear task labels (different workspace = different labels)
    await req.supabase.from('task_labels').delete().eq('task_id', id);

    logger.info(`Task ${id} moved to workspace ${target_workspace_id}`);

    res.json({ task });
  } catch (error) {
    next(error);
  }
});

export default router;
