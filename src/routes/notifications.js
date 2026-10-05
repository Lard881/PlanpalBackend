import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();

const notificationQuerySchema = z.object({
  filter: z.enum(['all', 'unread', 'tasks', 'mentions']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/**
 * GET /notifications?filter=&cursor=
 * List user notifications
 */
router.get('/', validate(notificationQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { filter = 'all', cursor, limit = 30 } = req.query;
    const supabase = userClient(req.jwt);

    let query = supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit) + 1);

    // Apply filters
    if (filter === 'unread') {
      query = query.is('read_at', null);
    } else if (filter === 'tasks') {
      query = query.in('type', ['task_assigned', 'task_updated', 'task_comment', 'deadline_approaching', 'task_overdue']);
    } else if (filter === 'mentions') {
      query = query.eq('type', 'mention');
    }

    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data: notifications, error, count } = await query;
    if (error) throw error;

    const hasMore = notifications.length > limit;
    const results = hasMore ? notifications.slice(0, limit) : notifications;
    const nextCursor = hasMore ? results[results.length - 1].created_at : null;

    // Get counts for badges
    const { data: counts } = await supabase
      .from('notifications')
      .select('read_at')
      .eq('user_id', req.user.id);

    const unreadCount = counts?.filter(n => n.read_at === null).length || 0;

    res.json({
      notifications: results,
      nextCursor,
      unreadCount,
      totalCount: count,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /notifications/:id/read
 * Mark notification as read
 */
router.post('/:id/read', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * POST /notifications/:id/unread
 * Mark notification as unread
 */
router.post('/:id/unread', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: null })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * POST /notifications/read-all
 * Mark all notifications as read
 */
router.post('/read-all', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .is('read_at', null);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /notifications/:id
 * Dismiss notification
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
