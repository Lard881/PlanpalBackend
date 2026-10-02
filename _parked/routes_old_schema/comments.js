import express from 'express';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { validate } from '../lib/validation.js';
import { z } from 'zod';

const router = express.Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const createCommentSchema = z.object({
  body: z.object({
    id: z.string().uuid().optional(),
    task_id: z.string().uuid(),
    content: z.string().min(1).max(5000),
    parent_id: z.string().uuid().optional().nullable(),
    mentions: z.array(z.string().uuid()).optional(),
  }),
});

const updateCommentSchema = z.object({
  body: z.object({
    content: z.string().min(1).max(5000),
  }),
});

const commentQuerySchema = z.object({
  query: z.object({
    task_id: z.string().uuid().optional(),
    author_id: z.string().uuid().optional(),
    parent_id: z.string().uuid().optional().nullable(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    updated_since: z.string().datetime().optional(),
  }),
});

// ============================================================================
// GET /comments - List comments with filters
// ============================================================================

router.get('/', validate(commentQuerySchema), async (req, res, next) => {
  try {
    const {
      task_id,
      author_id,
      parent_id,
      page,
      limit,
      updated_since,
    } = req.query;

    const offset = (page - 1) * limit;

    // Build query
    let query = req.supabase
      .from('comments')
      .select(`
        *,
        author:profiles!comments_author_id_fkey(id,name,avatar_url,email),
        task:tasks!comments_task_id_fkey(id,title,workspace_id),
        replies:comments!parent_id(count)
      `, { count: 'exact' })
      .is('deleted_at', null);

    // Filters
    if (task_id) {
      query = query.eq('task_id', task_id);
      
      // Verify user has access to task's workspace
      const { data: task } = await req.supabase
        .from('tasks')
        .select('workspace_id')
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
    }

    if (author_id) query = query.eq('author_id', author_id);
    
    // parent_id filter - if null, get top-level comments only
    if (parent_id === null || parent_id === 'null') {
      query = query.is('parent_id', null);
    } else if (parent_id) {
      query = query.eq('parent_id', parent_id);
    }

    // Incremental sync support
    if (updated_since) {
      query = query.gte('updated_at', updated_since);
    }

    // Sort by created date (newest first by default)
    query = query.order('created_at', { ascending: false });

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data: comments, error, count } = await query;

    if (error) throw error;

    res.json({
      comments: comments || [],
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
// POST /comments - Create a new comment
// ============================================================================

router.post('/', validate(createCommentSchema), async (req, res, next) => {
  try {
    const { task_id, content, parent_id, mentions, id } = req.body;

    // Verify task exists and user has access
    const { data: task, error: taskError } = await req.supabase
      .from('tasks')
      .select('id, workspace_id, title')
      .eq('id', task_id)
      .is('deleted_at', null)
      .single();

    if (taskError || !task) {
      throw new AppError('NOT_FOUND', 'Task not found', 404);
    }

    // Check workspace membership
    const { data: member } = await req.supabase
      .from('workspace_members')
      .select('id, role')
      .eq('workspace_id', task.workspace_id)
      .eq('user_id', req.userId)
      .single();

    if (!member) {
      throw new AppError('FORBIDDEN', 'You are not a member of this workspace', 403);
    }

    // If parent_id provided, verify it exists
    if (parent_id) {
      const { data: parentComment } = await req.supabase
        .from('comments')
        .select('id, task_id')
        .eq('id', parent_id)
        .is('deleted_at', null)
        .single();

      if (!parentComment) {
        throw new AppError('NOT_FOUND', 'Parent comment not found', 404);
      }

      if (parentComment.task_id !== task_id) {
        throw new AppError('BAD_REQUEST', 'Parent comment belongs to a different task', 400);
      }
    }

    const commentData = {
      id,
      task_id,
      author_id: req.userId,
      content,
      parent_id: parent_id || null,
      mentions: mentions || [],
    };

    // Check for duplicate (idempotency)
    if (id) {
      const { data: existing } = await req.supabase
        .from('comments')
        .select('*')
        .eq('id', id)
        .single();

      if (existing) {
        logger.info(`Comment ${id} already exists, returning existing`);
        return res.status(200).json({ comment: existing });
      }
    }

    // Create comment
    const { data: comment, error } = await req.supabase
      .from('comments')
      .insert(commentData)
      .select(`
        *,
        author:profiles!comments_author_id_fkey(id,name,avatar_url,email),
        task:tasks!comments_task_id_fkey(id,title,workspace_id)
      `)
      .single();

    if (error) throw error;

    logger.info(`Comment created: ${comment.id} on task ${task_id} by ${req.userId}`);

    // TODO: Send notifications for mentions
    // This will be handled in a later task

    res.status(201).json({ comment });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /comments/:id - Get single comment
// ============================================================================

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: comment, error } = await req.supabase
      .from('comments')
      .select(`
        *,
        author:profiles!comments_author_id_fkey(id,name,avatar_url,email),
        task:tasks!comments_task_id_fkey(id,title,workspace_id),
        parent:comments!parent_id(id,content,author:profiles(id,name)),
        replies:comments!parent_id(
          id,
          content,
          created_at,
          author:profiles(id,name,avatar_url)
        )
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new AppError('NOT_FOUND', 'Comment not found', 404);
      }
      throw error;
    }

    // Verify access to task's workspace
    const { data: member } = await req.supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', comment.task.workspace_id)
      .eq('user_id', req.userId)
      .single();

    if (!member) {
      throw new AppError('FORBIDDEN', 'Access denied', 403);
    }

    res.json({ comment });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PATCH /comments/:id - Update a comment
// ============================================================================

router.patch('/:id', validate(updateCommentSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    // Check if comment exists and user is the author
    const { data: existing, error: fetchError } = await req.supabase
      .from('comments')
      .select('author_id, task_id, task:tasks(workspace_id)')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (fetchError || !existing) {
      throw new AppError('NOT_FOUND', 'Comment not found', 404);
    }

    // Only author can edit their own comment
    if (existing.author_id !== req.userId) {
      throw new AppError('FORBIDDEN', 'You can only edit your own comments', 403);
    }

    // Update comment
    const { data: comment, error } = await req.supabase
      .from('comments')
      .update({
        content,
        updated_at: new Date().toISOString(),
        edited_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(`
        *,
        author:profiles!comments_author_id_fkey(id,name,avatar_url,email),
        task:tasks!comments_task_id_fkey(id,title,workspace_id)
      `)
      .single();

    if (error) throw error;

    logger.info(`Comment updated: ${id} by ${req.userId}`);

    res.json({ comment });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DELETE /comments/:id - Soft delete a comment
// ============================================================================

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if comment exists and user is the author or workspace admin
    const { data: existing, error: fetchError } = await req.supabase
      .from('comments')
      .select('author_id, task_id, task:tasks(workspace_id)')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (fetchError || !existing) {
      throw new AppError('NOT_FOUND', 'Comment not found', 404);
    }

    // Check if user is author or workspace admin
    const { data: member } = await req.supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', existing.task.workspace_id)
      .eq('user_id', req.userId)
      .single();

    const canDelete = existing.author_id === req.userId || 
                     member?.role === 'admin' || 
                     member?.role === 'owner';

    if (!canDelete) {
      throw new AppError('FORBIDDEN', 'You can only delete your own comments or must be a workspace admin', 403);
    }

    // Soft delete
    const { error } = await req.supabase
      .from('comments')
      .update({ 
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw error;

    logger.info(`Comment deleted: ${id} by ${req.userId}`);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /comments/task/:task_id - Get all comments for a task (with threading)
// ============================================================================

router.get('/task/:task_id', async (req, res, next) => {
  try {
    const { task_id } = req.params;

    // Verify task exists and user has access
    const { data: task } = await req.supabase
      .from('tasks')
      .select('workspace_id')
      .eq('id', task_id)
      .is('deleted_at', null)
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

    // Get all comments for the task (both top-level and replies)
    const { data: comments, error } = await req.supabase
      .from('comments')
      .select(`
        *,
        author:profiles!comments_author_id_fkey(id,name,avatar_url,email)
      `)
      .eq('task_id', task_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Build threaded structure
    const commentMap = {};
    const topLevelComments = [];

    // First pass: create map
    comments.forEach(comment => {
      commentMap[comment.id] = { ...comment, replies: [] };
    });

    // Second pass: build tree
    comments.forEach(comment => {
      if (comment.parent_id) {
        // This is a reply
        if (commentMap[comment.parent_id]) {
          commentMap[comment.parent_id].replies.push(commentMap[comment.id]);
        }
      } else {
        // This is a top-level comment
        topLevelComments.push(commentMap[comment.id]);
      }
    });

    res.json({
      comments: topLevelComments,
      total: comments.length,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
