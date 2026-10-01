import express from 'express';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { validate } from '../lib/validation.js';
import { z } from 'zod';

const router = express.Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const createActivitySchema = z.object({
  body: z.object({
    id: z.string().uuid().optional(),
    entity_type: z.enum(['task', 'project', 'workspace', 'comment']),
    entity_id: z.string().uuid(),
    action: z.enum([
      'created',
      'updated',
      'deleted',
      'completed',
      'reopened',
      'assigned',
      'unassigned',
      'status_changed',
      'priority_changed',
      'due_date_changed',
      'moved',
      'commented',
      'mentioned',
    ]),
    workspace_id: z.string().uuid(),
    changes: z.record(z.any()).optional(),
    metadata: z.record(z.any()).optional(),
  }),
});

const activityQuerySchema = z.object({
  query: z.object({
    workspace_id: z.string().uuid().optional(),
    entity_type: z.enum(['task', 'project', 'workspace', 'comment']).optional(),
    entity_id: z.string().uuid().optional(),
    user_id: z.string().uuid().optional(),
    action: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    updated_since: z.string().datetime().optional(),
  }),
});

// ============================================================================
// GET /activities - List activities with filters
// ============================================================================

router.get('/', validate(activityQuerySchema), async (req, res, next) => {
  try {
    const {
      workspace_id,
      entity_type,
      entity_id,
      user_id,
      action,
      page,
      limit,
      updated_since,
    } = req.query;

    const workspaceId = workspace_id || req.workspaceId;
    const offset = (page - 1) * limit;

    // Verify workspace access
    const { data: member } = await req.supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', req.userId)
      .single();

    if (!member) {
      throw new AppError('FORBIDDEN', 'Access denied to workspace', 403);
    }

    // Build query
    let query = req.supabase
      .from('activities')
      .select(`
        *,
        user:profiles!activities_user_id_fkey(id,name,avatar_url,email),
        task:tasks(id,title,status),
        project:projects(id,name,color),
        workspace:workspaces(id,name)
      `, { count: 'exact' })
      .eq('workspace_id', workspaceId);

    // Filters
    if (entity_type) query = query.eq('entity_type', entity_type);
    if (entity_id) query = query.eq('entity_id', entity_id);
    if (user_id) query = query.eq('user_id', user_id);
    if (action) query = query.eq('action', action);

    // Incremental sync support
    if (updated_since) {
      query = query.gte('created_at', updated_since);
    }

    // Sort by created date (newest first)
    query = query.order('created_at', { ascending: false });

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data: activities, error, count } = await query;

    if (error) throw error;

    res.json({
      activities: activities || [],
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
// POST /activities - Create a new activity log
// ============================================================================

router.post('/', validate(createActivitySchema), async (req, res, next) => {
  try {
    const {
      id,
      entity_type,
      entity_id,
      action,
      workspace_id,
      changes,
      metadata,
    } = req.body;

    // Verify workspace access
    const { data: member } = await req.supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspace_id)
      .eq('user_id', req.userId)
      .single();

    if (!member) {
      throw new AppError('FORBIDDEN', 'Access denied to workspace', 403);
    }

    const activityData = {
      id,
      entity_type,
      entity_id,
      action,
      workspace_id,
      user_id: req.userId,
      changes: changes || {},
      metadata: metadata || {},
    };

    // Check for duplicate (idempotency)
    if (id) {
      const { data: existing } = await req.supabase
        .from('activities')
        .select('*')
        .eq('id', id)
        .single();

      if (existing) {
        logger.info(`Activity ${id} already exists, returning existing`);
        return res.status(200).json({ activity: existing });
      }
    }

    // Create activity
    const { data: activity, error } = await req.supabase
      .from('activities')
      .insert(activityData)
      .select(`
        *,
        user:profiles!activities_user_id_fkey(id,name,avatar_url,email)
      `)
      .single();

    if (error) throw error;

    logger.info(`Activity logged: ${activity.action} on ${entity_type} ${entity_id} by ${req.userId}`);

    res.status(201).json({ activity });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /activities/:id - Get single activity
// ============================================================================

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: activity, error } = await req.supabase
      .from('activities')
      .select(`
        *,
        user:profiles!activities_user_id_fkey(id,name,avatar_url,email),
        task:tasks(id,title,status),
        project:projects(id,name,color),
        workspace:workspaces(id,name)
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new AppError('NOT_FOUND', 'Activity not found', 404);
      }
      throw error;
    }

    // Verify workspace access
    const { data: member } = await req.supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', activity.workspace_id)
      .eq('user_id', req.userId)
      .single();

    if (!member) {
      throw new AppError('FORBIDDEN', 'Access denied', 403);
    }

    res.json({ activity });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /activities/task/:task_id - Get activity timeline for a task
// ============================================================================

router.get('/task/:task_id', async (req, res, next) => {
  try {
    const { task_id } = req.params;
    const { limit = 50 } = req.query;

    // Verify task exists and user has access
    const { data: task } = await req.supabase
      .from('tasks')
      .select('workspace_id, title')
      .eq('id', task_id)
      .single();

    if (!task) {
      throw new AppError('NOT_FOUND', 'Task not found', 404);
    }

    // Check workspace membership
    const { data: member } = await req.supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', task.workspace_id)
      .eq('user_id', req.userId)
      .single();

    if (!member) {
      throw new AppError('FORBIDDEN', 'Access denied', 403);
    }

    // Get activities for the task
    const { data: activities, error } = await req.supabase
      .from('activities')
      .select(`
        *,
        user:profiles!activities_user_id_fkey(id,name,avatar_url,email)
      `)
      .eq('entity_type', 'task')
      .eq('entity_id', task_id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json({
      activities: activities || [],
      task: {
        id: task_id,
        title: task.title,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /activities/workspace/:workspace_id/feed - Get workspace activity feed
// ============================================================================

router.get('/workspace/:workspace_id/feed', async (req, res, next) => {
  try {
    const { workspace_id } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    // Verify workspace access
    const { data: member } = await req.supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspace_id)
      .eq('user_id', req.userId)
      .single();

    if (!member) {
      throw new AppError('FORBIDDEN', 'Access denied to workspace', 403);
    }

    // Get recent activities
    const { data: activities, error, count } = await req.supabase
      .from('activities')
      .select(`
        *,
        user:profiles!activities_user_id_fkey(id,name,avatar_url,email),
        task:tasks(id,title,status),
        project:projects(id,name,color)
      `, { count: 'exact' })
      .eq('workspace_id', workspace_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      activities: activities || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DELETE /activities/:id - Delete an activity (admin only)
// ============================================================================

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Get activity
    const { data: activity } = await req.supabase
      .from('activities')
      .select('workspace_id')
      .eq('id', id)
      .single();

    if (!activity) {
      throw new AppError('NOT_FOUND', 'Activity not found', 404);
    }

    // Check if user is workspace admin
    const { data: member } = await req.supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', activity.workspace_id)
      .eq('user_id', req.userId)
      .single();

    if (!member || (member.role !== 'admin' && member.role !== 'owner')) {
      throw new AppError('FORBIDDEN', 'Only workspace admins can delete activities', 403);
    }

    // Delete activity
    const { error } = await req.supabase
      .from('activities')
      .delete()
      .eq('id', id);

    if (error) throw error;

    logger.info(`Activity deleted: ${id} by ${req.userId}`);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
