import express from 'express';
import { z } from 'zod';
import { validate } from '../lib/validation.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const mentionQuerySchema = z.object({
  query: z.object({
    workspace_id: z.string().uuid().optional(),
    is_read: z.enum(['true', 'false']).optional(),
    entity_type: z.enum(['task', 'comment']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

const markReadSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

const createMentionSchema = z.object({
  body: z.object({
    entity_type: z.enum(['task', 'comment']),
    entity_id: z.string().uuid(),
    mentioned_user_ids: z.array(z.string().uuid()).min(1).max(10),
    workspace_id: z.string().uuid().optional(),
    mention_text: z.string().optional(),
    context_snippet: z.string().max(200).optional(),
  }),
});

// ============================================================================
// GET /mentions - List mentions for current user
// ============================================================================

router.get('/', validate(mentionQuerySchema), async (req, res, next) => {
  try {
    const { workspace_id, is_read, entity_type, page, limit } = req.query;
    const userId = req.userId;
    const offset = (page - 1) * limit;

    // Build query
    let query = req.supabase
      .from('mentions')
      .select(
        `
        *,
        created_by_profile:profiles!mentions_created_by_fkey(id, name, avatar_url),
        task:tasks(id, title, workspace_id),
        comment:comments(id, content, task_id)
      `,
        { count: 'exact' }
      )
      .eq('mentioned_user_id', userId)
      .order('created_at', { ascending: false });

    // Filters
    if (workspace_id) {
      query = query.eq('workspace_id', workspace_id);
    }

    if (is_read !== undefined) {
      query = query.eq('is_read', is_read === 'true');
    }

    if (entity_type) {
      query = query.eq('entity_type', entity_type);
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data: mentions, error, count } = await query;

    if (error) throw error;

    res.json({
      mentions: mentions || [],
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
// GET /mentions/unread-count - Get unread mention count
// ============================================================================

router.get('/unread-count', async (req, res, next) => {
  try {
    const userId = req.userId;

    const { data, error } = await req.supabase.rpc('get_unread_mention_count', {
      p_user_id: userId,
    });

    if (error) throw error;

    res.json({
      count: data || 0,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /mentions - Create mention(s)
// ============================================================================

router.post('/', validate(createMentionSchema), async (req, res, next) => {
  try {
    const { entity_type, entity_id, mentioned_user_ids, workspace_id, mention_text, context_snippet } = req.body;
    const userId = req.userId;
    const workspaceId = workspace_id || req.workspaceId;

    // Get entity to validate and get context
    let entityWorkspaceId = workspaceId;
    let contextText = context_snippet;

    if (entity_type === 'task') {
      const { data: task, error } = await req.supabase
        .from('tasks')
        .select('workspace_id, title, description')
        .eq('id', entity_id)
        .single();

      if (error || !task) {
        throw new AppError('Task not found', 404, 'NOT_FOUND');
      }

      entityWorkspaceId = task.workspace_id;
      contextText = contextText || `${task.title} ${task.description || ''}`.substring(0, 200);
    } else if (entity_type === 'comment') {
      const { data: comment, error } = await req.supabase
        .from('comments')
        .select('task_id, content, tasks(workspace_id)')
        .eq('id', entity_id)
        .single();

      if (error || !comment) {
        throw new AppError('Comment not found', 404, 'NOT_FOUND');
      }

      entityWorkspaceId = comment.tasks.workspace_id;
      contextText = contextText || comment.content.substring(0, 200);
    }

    // Create mentions for each user
    const mentionsToCreate = mentioned_user_ids.map(mentionedUserId => ({
      entity_type,
      entity_id,
      mentioned_user_id: mentionedUserId,
      created_by: userId,
      workspace_id: entityWorkspaceId,
      mention_text: mention_text || `@user-${mentionedUserId}`,
      context_snippet: contextText,
    }));

    const { data: mentions, error: insertError } = await req.supabase
      .from('mentions')
      .insert(mentionsToCreate)
      .select();

    if (insertError) {
      // Handle duplicate mentions gracefully
      if (insertError.code === '23505') {
        logger.warn('Duplicate mention attempt', { entity_id, mentioned_user_ids });
        
        // Fetch existing mentions
        const { data: existing } = await req.supabase
          .from('mentions')
          .select('*')
          .eq('entity_type', entity_type)
          .eq('entity_id', entity_id)
          .in('mentioned_user_id', mentioned_user_ids);

        return res.status(200).json({
          mentions: existing || [],
          message: 'Mentions already exist',
        });
      }
      throw insertError;
    }

    // Create notifications for mentioned users
    // Note: This would integrate with the notifications system
    for (const mention of mentions || []) {
      // TODO: Create notification via notifications API
      logger.info('Mention created', {
        mention_id: mention.id,
        mentioned_user: mention.mentioned_user_id,
      });
    }

    res.status(201).json({
      mentions: mentions || [],
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PUT /mentions/:id/read - Mark mention as read
// ============================================================================

router.put('/:id/read', validate(markReadSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const { data, error } = await req.supabase.rpc('mark_mention_as_read', {
      p_mention_id: id,
      p_user_id: userId,
    });

    if (error) throw error;

    if (!data) {
      throw new AppError('Mention not found or unauthorized', 404, 'NOT_FOUND');
    }

    res.json({
      success: true,
      message: 'Mention marked as read',
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PUT /mentions/read-all - Mark all mentions as read
// ============================================================================

router.put('/read-all', async (req, res, next) => {
  try {
    const userId = req.userId;
    const { workspace_id } = req.query;

    let query = req.supabase
      .from('mentions')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('mentioned_user_id', userId)
      .eq('is_read', false);

    if (workspace_id) {
      query = query.eq('workspace_id', workspace_id);
    }

    const { error, count } = await query;

    if (error) throw error;

    res.json({
      success: true,
      count: count || 0,
      message: `${count || 0} mentions marked as read`,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DELETE /mentions/:id - Delete mention
// ============================================================================

router.delete('/:id', validate(markReadSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Can only delete mentions you created
    const { error } = await req.supabase
      .from('mentions')
      .delete()
      .eq('id', id)
      .eq('created_by', userId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Mention deleted',
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /mentions/users/search - Search users for mentions
// ============================================================================

router.get('/users/search', async (req, res, next) => {
  try {
    const { q, workspace_id } = req.query;
    const workspaceId = workspace_id || req.workspaceId;

    if (!q || q.length < 2) {
      return res.json({ users: [] });
    }

    // Search for users in workspace
    const { data: members, error } = await req.supabase
      .from('workspace_members')
      .select('user_id, profiles(id, name, email, avatar_url)')
      .eq('workspace_id', workspaceId)
      .ilike('profiles.name', `%${q}%`)
      .limit(10);

    if (error) throw error;

    const users = (members || []).map(m => m.profiles).filter(Boolean);

    res.json({
      users,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
