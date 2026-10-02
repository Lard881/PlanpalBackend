import express from 'express';
import { adminClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /notifications
 * Get user's notifications with filters and counts
 */
router.get('/', async (req, res, next) => {
  try {
    const userId = req.userId;
    const {
      read,
      type,
      workspace_id,
      page = 1,
      limit = 50,
    } = req.query;

    let query = adminClient
      .from('notifications')
      .select(`
        *,
        workspace:workspaces(id, name, type)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    // Apply filters
    if (read !== undefined) {
      if (read === 'true') {
        query = query.not('read_at', 'is', null);
      } else {
        query = query.is('read_at', null);
      }
    }

    if (type) {
      query = query.eq('type', type);
    }

    if (workspace_id) {
      query = query.eq('workspace_id', workspace_id);
    }

    // Pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.range(offset, offset + parseInt(limit) - 1);

    const { data: notifications, error } = await query;

    if (error) throw error;

    // Get total count and unread count
    const [{ count: totalCount }, { count: unreadCount }] = await Promise.all([
      adminClient
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
      adminClient
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null),
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      notifications,
      counts: {
        total: totalCount,
        unread: unreadCount,
        read: totalCount - unreadCount,
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /notifications/counts
 * Get notification counts by type and read status
 */
router.get('/counts', async (req, res, next) => {
  try {
    const userId = req.userId;
    const { workspace_id } = req.query;

    let query = adminClient
      .from('notifications')
      .select('type, read_at')
      .eq('user_id', userId);

    if (workspace_id) {
      query = query.eq('workspace_id', workspace_id);
    }

    const { data: notifications, error } = await query;

    if (error) throw error;

    // Count by type and read status
    const counts = {
      total: notifications.length,
      unread: notifications.filter(n => !n.read_at).length,
      byType: {},
    };

    // Count by notification type
    notifications.forEach(n => {
      if (!counts.byType[n.type]) {
        counts.byType[n.type] = { total: 0, unread: 0 };
      }
      counts.byType[n.type].total++;
      if (!n.read_at) {
        counts.byType[n.type].unread++;
      }
    });

    res.json(counts);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /notifications/:id/read
 * Mark notification as read
 */
router.patch('/:id/read', async (req, res, next) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    // Verify ownership and update
    const { data: updated, error } = await adminClient
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .is('read_at', null) // Only update if not already read
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          error: {
            code: 'NOTIFICATION_NOT_FOUND',
            message: 'Notification not found or already read',
          },
        });
      }
      throw error;
    }

    res.json({ notification: updated });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /notifications/:id/unread
 * Mark notification as unread
 */
router.patch('/:id/unread', async (req, res, next) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    // Verify ownership and update
    const { data: updated, error } = await adminClient
      .from('notifications')
      .update({ read_at: null })
      .eq('id', id)
      .eq('user_id', userId)
      .not('read_at', 'is', null) // Only update if already read
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          error: {
            code: 'NOTIFICATION_NOT_FOUND',
            message: 'Notification not found or already unread',
          },
        });
      }
      throw error;
    }

    res.json({ notification: updated });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /notifications/mark-all-read
 * Mark all notifications as read
 */
router.post('/mark-all-read', async (req, res, next) => {
  try {
    const userId = req.userId;
    const { workspace_id } = req.body;

    let query = adminClient
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);

    if (workspace_id) {
      query = query.eq('workspace_id', workspace_id);
    }

    const { data, error } = await query.select();

    if (error) throw error;

    res.json({
      count: data.length,
      message: `Marked ${data.length} notifications as read`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /notifications/:id
 * Delete a notification
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    // Delete with ownership check
    const { error } = await adminClient
      .from('notifications')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /notifications/bulk-delete
 * Delete multiple notifications
 */
router.post('/bulk-delete', async (req, res, next) => {
  try {
    const userId = req.userId;
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'ids must be a non-empty array',
        },
      });
    }

    // Delete with ownership check
    const { data, error } = await adminClient
      .from('notifications')
      .delete()
      .in('id', ids)
      .eq('user_id', userId)
      .select('id');

    if (error) throw error;

    res.json({
      deleted: data.length,
      message: `Deleted ${data.length} notifications`,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
