import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { createNotifications } from '../lib/notifications.js';
import { loadWorkspace } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();

// Validation schemas
const taskQuerySchema = z.object({
  status: z.enum(['todo', 'in_progress', 'completed']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  assigneeId: z.string().uuid().optional(),
  labelId: z.string().uuid().optional(),
  dueFrom: z.string().datetime().optional(),
  dueTo: z.string().datetime().optional(),
  q: z.string().optional(),
  view: z.enum(['today', 'week', 'overdue', 'all']).optional(),
  sort: z.enum(['due_at', 'priority', 'created_at', 'updated_at', 'title']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

const createTaskSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  dueAt: z.string().datetime().optional(),
  reminderMinutesBefore: z.number().int().min(5).nullable().optional(),
  assigneeId: z.string().uuid().optional(),
  labelId: z.string().uuid().optional(),
  subtasks: z.array(z.object({
    id: z.string().uuid().optional(),
    title: z.string().min(1).max(500),
  })).optional(),
  attachmentFileIds: z.array(z.string().uuid()).optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional().nullable(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  status: z.enum(['todo', 'in_progress', 'completed']).optional(),
  dueAt: z.string().datetime().optional().nullable(),
  reminderMinutesBefore: z.number().int().min(5).nullable().optional(),
  assigneeId: z.string().uuid().optional().nullable(),
  labelId: z.string().uuid().optional().nullable(),
});

const bulkActionSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  action: z.enum(['complete', 'delete']),
});

const moveTaskSchema = z.object({
  targetWorkspaceId: z.string().uuid(),
});

const createSubtaskSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(500),
});

const updateSubtaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  done: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
}).refine(data => data.title !== undefined || data.done !== undefined || data.position !== undefined, {
  message: 'At least one field must be provided',
});

const createCommentSchema = z.object({
  id: z.string().uuid().optional(),
  body: z.string().min(1).max(2000),
});

const createAttachmentSchema = z.object({
  fileId: z.string().uuid(),
});

function encodeTaskCursor(task, sort, order) {
  return Buffer.from(
    JSON.stringify({ value: task[sort], id: task.id, sort, order }),
  ).toString('base64url');
}

function decodeTaskCursor(cursor, sort, order) {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      typeof decoded.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded.id) ||
      !(decoded.value === null || typeof decoded.value === 'string') ||
      decoded.sort !== sort ||
      decoded.order !== order
    ) {
      throw new Error('Malformed cursor');
    }
    return decoded;
  } catch {
    throw new AppError(
      ErrorCodes.VALIDATION_FAILED,
      'Invalid task cursor',
      400,
    );
  }
}

function escapePostgrestValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * GET /workspaces/:workspaceId/tasks
 * List tasks with filtering and pagination
 */
router.get(
  '/workspaces/:workspaceId/tasks',
  loadWorkspace,
  validate(taskQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const supabase = userClient(req.jwt);
      const {
        status,
        priority,
        assigneeId,
        labelId,
        dueFrom,
        dueTo,
        q,
        view,
        sort = 'created_at',
        order,
        limit = 30,
        cursor,
      } = req.query;
      const sortOrder =
        order ?? (sort === 'due_at' || sort === 'title' ? 'asc' : 'desc');

      let query = supabase
        .from('tasks')
        .select(`
          id, workspace_id, created_by, assignee_id, label_id, completed_at,
          title, description, status, priority, due_at, reminder_minutes_before,
          created_at, updated_at,
          assignee:profiles!assignee_id(id, full_name, avatar_url),
          label:labels(id, name, color)
        `, { count: 'exact' })
        .eq('workspace_id', req.params.workspaceId)
        .is('deleted_at', null);

      // Apply filters
      if (status) query = query.eq('status', status);
      if (priority) query = query.eq('priority', priority);
      if (assigneeId) query = query.eq('assignee_id', assigneeId);
      if (labelId) query = query.eq('label_id', labelId);
      if (dueFrom) query = query.gte('due_at', dueFrom);
      if (dueTo) query = query.lte('due_at', dueTo);
      if (q) query = query.ilike('title', `%${q}%`);

      // Apply view filters
      if (view === 'today') {
        const today = new Date().toISOString().split('T')[0];
        query = query.gte('due_at', `${today}T00:00:00Z`)
          .lte('due_at', `${today}T23:59:59Z`);
      } else if (view === 'week') {
        const now = new Date();
        const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        query = query.gte('due_at', now.toISOString())
          .lte('due_at', weekFromNow.toISOString());
      } else if (view === 'overdue') {
        query = query.lt('due_at', new Date().toISOString())
          .neq('status', 'completed');
      }

      // Cursor pagination
      if (cursor) {
        const { value, id } = decodeTaskCursor(cursor, sort, sortOrder);
        const operator = sortOrder === 'asc' ? 'gt' : 'lt';
        if (value === null) {
          query = query.or(`and(${sort}.is.null,id.${operator}.${id})`);
        } else {
          const escapedValue = escapePostgrestValue(value);
          query = query.or([
            `${sort}.${operator}.${escapedValue}`,
            `and(${sort}.eq.${escapedValue},id.${operator}.${id})`,
            `${sort}.is.null`,
          ].join(','));
        }
      }

      // Sorting
      query = query
        .order(sort, { ascending: sortOrder === 'asc', nullsFirst: false })
        .order('id', { ascending: sortOrder === 'asc' })
        .limit(limit + 1); // Fetch one extra to determine if there are more

      const { data: tasks, error, count } = await query;
      if (error) throw error;

      // Check if there are more results
      const hasMore = tasks.length > limit;
      const results = hasMore ? tasks.slice(0, limit) : tasks;
      const nextCursor = hasMore
        ? encodeTaskCursor(results[results.length - 1], sort, sortOrder)
        : null;

      // Get subtask counts for each task
      const taskIds = results.map(t => t.id);
      const { data: subtaskCounts } = await supabase
        .from('subtasks')
        .select('task_id, is_done')
        .in('task_id', taskIds)
        .is('deleted_at', null);

      // Aggregate subtask counts
      const countsByTask = {};
      (subtaskCounts || []).forEach(s => {
        if (!countsByTask[s.task_id]) {
          countsByTask[s.task_id] = { done: 0, total: 0 };
        }
        countsByTask[s.task_id].total++;
        if (s.is_done) countsByTask[s.task_id].done++;
      });

      // Attach counts to tasks
      results.forEach(task => {
        task.subtaskCounts = countsByTask[task.id] || { done: 0, total: 0 };
      });

      res.json({
        tasks: results,
        nextCursor,
        totalCount: count,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /workspaces/:workspaceId/tasks
 * Create a new task
 */
router.post(
  '/workspaces/:workspaceId/tasks',
  loadWorkspace,
  validate(createTaskSchema),
  async (req, res, next) => {
    try {
      const {
        id,
        title,
        description,
        priority = 'medium',
        dueAt,
        reminderMinutesBefore,
        assigneeId,
        labelId,
        subtasks,
        attachmentFileIds,
      } = req.body;
      const supabase = userClient(req.jwt);

      // Validate assignee is workspace member if provided
      if (assigneeId) {
        const { data: member } = await supabase
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', req.params.workspaceId)
          .eq('user_id', assigneeId)
          .single();

        if (!member) {
          throw new AppError(
            ErrorCodes.FORBIDDEN,
            'Assignee must be a workspace member',
            400
          );
        }
      }

      let task;
      if (id) {
        const { data: existing, error: lookupError } = await supabase
          .from('tasks')
          .select()
          .eq('id', id)
          .maybeSingle();
        if (lookupError) throw lookupError;

        if (existing) {
          if (
            existing.workspace_id !== req.params.workspaceId ||
            existing.created_by !== req.user.id ||
            existing.title !== title
          ) {
            throw new AppError(
              ErrorCodes.CONFLICT,
              'This task ID is already used by another operation',
              409,
            );
          }
          task = existing;
        }
      }

      // Client-supplied task IDs make offline retries idempotent.
      if (!task) {
        const { data: createdTask, error: taskError } = await supabase
          .from('tasks')
          .insert({
            ...(id && { id }),
            workspace_id: req.params.workspaceId,
            title,
            description,
            priority,
            due_at: dueAt,
            reminder_minutes_before: reminderMinutesBefore,
            assignee_id: assigneeId,
            label_id: labelId,
            created_by: req.user.id,
          })
          .select()
          .single();

        if (taskError) throw taskError;
        task = createdTask;
      }

      // Create subtasks if provided
      if (subtasks && subtasks.length > 0) {
        for (const [index, subtask] of subtasks.entries()) {
          if (subtask.id) {
            const { data: existing, error: lookupError } = await supabase
              .from('subtasks')
              .select()
              .eq('id', subtask.id)
              .maybeSingle();
            if (lookupError) throw lookupError;
            if (existing) {
              if (
                existing.task_id !== task.id ||
                existing.title !== subtask.title
              ) {
                throw new AppError(
                  ErrorCodes.CONFLICT,
                  'This subtask ID is already used by another operation',
                  409,
                );
              }
              continue;
            }
          }

          const { error: subtaskError } = await supabase
            .from('subtasks')
            .insert({
              ...(subtask.id ? { id: subtask.id } : {}),
              task_id: task.id,
              title: subtask.title,
              position: index,
            });
          if (subtaskError) throw subtaskError;
        }
      }

      // Attach files if provided
      if (attachmentFileIds && attachmentFileIds.length > 0) {
        const attachmentInserts = attachmentFileIds.map(fileId => ({
          task_id: task.id,
          file_id: fileId,
        }));

        await supabase.from('task_attachments').insert(attachmentInserts);
      }

      // B4/2C fix: use adminClient with title/body
      if (assigneeId && assigneeId !== req.user.id) {
        await createNotifications([{
          user_id: assigneeId,
          type: 'task_assigned',
          title: 'Task assigned to you',
          body: `"${title}"`,
          entity_type: 'task',
          entity_id: task.id,
          workspace_id: req.params.workspaceId,
          dedupe_key: `task_assigned:${task.id}:${assigneeId}`,
        }]);
      }

      res.status(201).json({ task });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /tasks/:taskId
 * Get full task details
 */
router.get('/tasks/:taskId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    // Get task with related data
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select(`
        *,
        assignee:profiles!assignee_id(id, full_name, email, avatar_url),
        label:labels(id, name, color),
        subtasks(id, task_id, title, is_done, position, created_at),
        task_attachments(file_id, files(id, name, mime_type, size_bytes, storage_path, created_at))
      `)
      .eq('id', req.params.taskId)
      .single();

    if (taskError) throw taskError;

    // Get latest 20 comments
    const { data: comments } = await supabase
      .from('task_comments')
      .select(`
        id, task_id, author_id, body, created_at, updated_at,
        author:profiles!author_id(id, full_name, avatar_url)
      `)
      .eq('task_id', req.params.taskId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20);

    task.comments = comments || [];

    res.json({ task });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /tasks/:taskId
 * Update a task
 */
router.patch(
  '/tasks/:taskId',
  validate(updateTaskSchema),
  async (req, res, next) => {
    try {
      const supabase = userClient(req.jwt);

      // Get current task state
      const { data: currentTask, error: currentTaskError } = await supabase
        .from('tasks')
        .select('assignee_id, status, created_by, workspace_id')
        .eq('id', req.params.taskId)
        .single();
      if (currentTaskError) throw currentTaskError;

      // Update task
      const {
        dueAt,
        reminderMinutesBefore,
        assigneeId,
        labelId,
        ...updates
      } = req.body;
      if (dueAt !== undefined) updates.due_at = dueAt;
      if (reminderMinutesBefore !== undefined) {
        updates.reminder_minutes_before = reminderMinutesBefore;
      }
      if (assigneeId !== undefined) {
        if (assigneeId !== null) {
          const { data: member, error: memberError } = await supabase
            .from('workspace_members')
            .select('user_id')
            .eq('workspace_id', currentTask.workspace_id)
            .eq('user_id', assigneeId)
            .maybeSingle();
          if (memberError) throw memberError;
          if (!member) {
            throw new AppError(
              ErrorCodes.FORBIDDEN,
              'Assignee must be a workspace member',
              400,
            );
          }
        }
        updates.assignee_id = assigneeId;
      }
      if (labelId !== undefined) updates.label_id = labelId;

      const { data: task, error } = await supabase
        .from('tasks')
        .update(updates)
        .eq('id', req.params.taskId)
        .select()
        .single();

      if (error) throw error;

      // Detect changes and create notifications
      if (req.body.assigneeId !== undefined && req.body.assigneeId !== currentTask.assignee_id) {
        // Assignee changed — B4/2C fix
        if (req.body.assigneeId && req.body.assigneeId !== req.user.id) {
          await createNotifications([{
            user_id: req.body.assigneeId,
            type: 'task_assigned',
            title: 'Task assigned to you',
            body: `"${task.title}"`,
            entity_type: 'task',
            entity_id: task.id,
            workspace_id: task.workspace_id,
            dedupe_key: `task_assigned:${task.id}:${req.body.assigneeId}`,
          }]);
        }
      }

      if (req.body.status !== undefined && req.body.status !== currentTask.status) {
        // Status changed — B4/2C fix
        if (currentTask.created_by !== req.user.id) {
          await createNotifications([{
            user_id: currentTask.created_by,
            type: 'task_updated',
            title: 'Task updated',
            body: `Status changed to ${req.body.status}`,
            entity_type: 'task',
            entity_id: task.id,
            workspace_id: task.workspace_id,
            dedupe_key: `task_updated:${task.id}:${currentTask.created_by}:${req.body.status}`,
          }]);
        }
      }

      res.json({ task });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /tasks/:taskId
 * Soft delete a task
 */
router.delete('/tasks/:taskId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { data: deletedTask, error } = await supabase
      .from('tasks')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.taskId)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!deletedTask) {
      throw new AppError(ErrorCodes.TASK_NOT_FOUND, 'Task not found', 404);
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * POST /tasks/bulk
 * Bulk complete or delete tasks
 */
router.post('/tasks/bulk', validate(bulkActionSchema), async (req, res, next) => {
  try {
    const { ids, action } = req.body;
    const supabase = userClient(req.jwt);

    const succeeded = [];
    const failed = [];

    for (const id of ids) {
      try {
        if (action === 'complete') {
          const { data: task, error } = await supabase
            .from('tasks')
            .update({ status: 'completed' })
            .eq('id', id)
            .select('id')
            .maybeSingle();

          if (error) throw error;
          if (!task) throw new AppError(ErrorCodes.TASK_NOT_FOUND, 'Task not found', 404);
        } else if (action === 'delete') {
          const { data: task, error } = await supabase
            .from('tasks')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', id)
            .select('id')
            .maybeSingle();

          if (error) throw error;
          if (!task) throw new AppError(ErrorCodes.TASK_NOT_FOUND, 'Task not found', 404);
        }

        succeeded.push(id);
      } catch {
        failed.push({ id, code: 'OPERATION_FAILED' });
      }
    }

    res.json({ succeeded, failed });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /tasks/:taskId/move
 * Move task to another workspace
 */
router.post(
  '/tasks/:taskId/move',
  validate(moveTaskSchema),
  async (req, res, next) => {
    try {
      const { targetWorkspaceId } = req.body;
      const supabase = userClient(req.jwt);

      // move_task_to_workspace returns void, so load the updated task afterwards
      const { error } = await supabase.rpc('move_task_to_workspace', {
        p_task: req.params.taskId,
        p_target: targetWorkspaceId,
      });

      if (error) throw error;

      const { data: task, error: loadError } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', req.params.taskId)
        .single();

      if (loadError) throw loadError;

      res.json({ task });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /tasks/:taskId/subtasks
 * Create a subtask
 */
router.post(
  '/tasks/:taskId/subtasks',
  validate(createSubtaskSchema),
  async (req, res, next) => {
    try {
      const { id, title } = req.body;
      const supabase = userClient(req.jwt);

      if (id) {
        const { data: existing, error: lookupError } = await supabase
          .from('subtasks')
          .select()
          .eq('id', id)
          .maybeSingle();
        if (lookupError) throw lookupError;
        if (existing) {
          if (existing.task_id !== req.params.taskId || existing.title !== title) {
            throw new AppError(
              ErrorCodes.CONFLICT,
              'This subtask ID is already used by another operation',
              409,
            );
          }
          return res.status(201).json({ subtask: existing });
        }
      }

      // Get max position
      const { data: maxPos } = await supabase
        .from('subtasks')
        .select('position')
        .eq('task_id', req.params.taskId)
        .order('position', { ascending: false })
        .limit(1)
        .single();

      const position = (maxPos?.position || -1) + 1;

      const { data: subtask, error } = await supabase
        .from('subtasks')
        .insert({
          ...(id ? { id } : {}),
          task_id: req.params.taskId,
          title,
          position,
        })
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({ subtask });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /subtasks/:subtaskId
 * Update a subtask
 */
router.patch(
  '/subtasks/:subtaskId',
  validate(updateSubtaskSchema),
  async (req, res, next) => {
    try {
      const supabase = userClient(req.jwt);

      const { done, ...updates } = req.body;
      if (done !== undefined) updates.is_done = done;

      const { data: subtask, error } = await supabase
        .from('subtasks')
        .update(updates)
        .eq('id', req.params.subtaskId)
        .select()
        .single();

      if (error) throw error;

      res.json({ subtask });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /subtasks/:subtaskId
 * Delete a subtask
 */
router.delete('/subtasks/:subtaskId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { error } = await supabase
      .from('subtasks')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.subtaskId);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * GET /tasks/:taskId/comments
 * List task comments with pagination
 */
router.get('/tasks/:taskId/comments', async (req, res, next) => {
  try {
    const { cursor, limit = 20 } = req.query;
    const supabase = userClient(req.jwt);

    let query = supabase
      .from('task_comments')
      .select(`
        id, body, created_at, updated_at,
        author:profiles!author_id(id, full_name, avatar_url)
      `)
      .eq('task_id', req.params.taskId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit) + 1);

    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data: comments, error } = await query;
    if (error) throw error;

    const hasMore = comments.length > limit;
    const results = hasMore ? comments.slice(0, limit) : comments;
    const nextCursor = hasMore ? results[results.length - 1].created_at : null;

    res.json({ comments: results, nextCursor });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /tasks/:taskId/comments
 * Create a comment
 */
router.post(
  '/tasks/:taskId/comments',
  validate(createCommentSchema),
  async (req, res, next) => {
    try {
      const { id, body } = req.body;
      const supabase = userClient(req.jwt);

      if (id) {
        const { data: existing, error: lookupError } = await supabase
          .from('task_comments')
          .select()
          .eq('id', id)
          .maybeSingle();
        if (lookupError) throw lookupError;
        if (existing) {
          if (
            existing.task_id !== req.params.taskId ||
            existing.author_id !== req.user.id ||
            existing.body !== body
          ) {
            throw new AppError(
              ErrorCodes.CONFLICT,
              'This comment ID is already used by another operation',
              409,
            );
          }
          return res.status(201).json({ comment: existing });
        }
      }

      // Get task info
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .select('assignee_id, created_by, workspace_id')
        .eq('id', req.params.taskId)
        .single();
      if (taskError) throw taskError;

      // Create comment
      const { data: comment, error } = await supabase
        .from('task_comments')
        .insert({
          ...(id ? { id } : {}),
          task_id: req.params.taskId,
          author_id: req.user.id,
          body,
        })
        .select()
        .single();

      if (error) throw error;

      // B4/2C fix: use adminClient with title/body, batch upsert
      const toNotify = new Set([task.assignee_id, task.created_by].filter(Boolean));
      toNotify.delete(req.user.id);

      if (toNotify.size > 0) {
        const notifs = [...toNotify].map(userId => ({
          user_id: userId,
          type: 'task_comment',
          title: 'New comment on a task',
          body: body.substring(0, 200),
          entity_type: 'task',
          entity_id: req.params.taskId,
          workspace_id: task.workspace_id,
          dedupe_key: `task_comment:${comment.id}:${userId}`,
        }));
        await createNotifications(notifs);
      }

      // B4/2C fix: @mentions with adminClient and title/body
      const mentionRegex = /@\[([^\]]+)\]\(user:([a-f0-9-]+)\)/g;
      let match;
      const mentionNotifs = [];
      while ((match = mentionRegex.exec(body)) !== null) {
        const mentionedUserId = match[2];
        if (mentionedUserId !== req.user.id) {
          mentionNotifs.push({
            user_id: mentionedUserId,
            type: 'mention',
            title: 'You were mentioned',
            body: `Mentioned you in a task comment`,
            entity_type: 'task',
            entity_id: req.params.taskId,
            workspace_id: task.workspace_id,
            dedupe_key: `mention:${comment.id}:${mentionedUserId}`,
          });
        }
      }
      if (mentionNotifs.length > 0) {
        await createNotifications(mentionNotifs);
      }

      res.status(201).json({ comment });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /comments/:commentId
 * Update a comment (author only)
 */
router.patch('/comments/:commentId', validate(createCommentSchema), async (req, res, next) => {
  try {
    const { body } = req.body;
    const supabase = userClient(req.jwt);

    const { data: comment, error } = await supabase
      .from('task_comments')
      .update({ body })
      .eq('id', req.params.commentId)
      .eq('author_id', req.user.id) // Author only
      .select()
      .single();

    if (error) throw error;

    res.json({ comment });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /comments/:commentId
 * Delete a comment (author or admin)
 */
router.delete('/comments/:commentId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    // Try to delete as author first
    let { error } = await supabase
      .from('task_comments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.commentId)
      .eq('author_id', req.user.id);

    // If failed and user is admin, allow anyway (RLS handles this)
    if (error) {
      ({ error } = await supabase
        .from('task_comments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', req.params.commentId));
    }

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * POST /tasks/:taskId/attachments
 * Attach a file to a task
 */
router.post(
  '/tasks/:taskId/attachments',
  validate(createAttachmentSchema),
  async (req, res, next) => {
    try {
      const { fileId } = req.body;
      const supabase = userClient(req.jwt);

      // Verify file exists and belongs to same workspace
      const { data: task } = await supabase
        .from('tasks')
        .select('workspace_id')
        .eq('id', req.params.taskId)
        .single();

      const { data: file } = await supabase
        .from('files')
        .select('workspace_id')
        .eq('id', fileId)
        .single();

      if (file.workspace_id !== task.workspace_id) {
        throw new AppError(
          ErrorCodes.FORBIDDEN,
          'File must belong to the same workspace',
          403
        );
      }

      const { data: attachment, error } = await supabase
        .from('task_attachments')
        .insert({
          task_id: req.params.taskId,
          file_id: fileId,
        })
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({ attachment });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /tasks/:taskId/attachments/:fileId
 * Remove an attachment from a task
 */
router.delete('/tasks/:taskId/attachments/:fileId', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { error } = await supabase
      .from('task_attachments')
      .delete()
      .eq('task_id', req.params.taskId)
      .eq('file_id', req.params.fileId);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
