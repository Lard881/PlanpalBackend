import express from 'express';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { validate } from '../lib/validation.js';
import { z } from 'zod';

const router = express.Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const getPersonalizedFeedSchema = z.object({
  query: z.object({
    workspace_id: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    include_read: z.enum(['true', 'false']).optional().transform(val => val === 'true'),
  }),
});

const getAggregatedFeedSchema = z.object({
  query: z.object({
    workspace_id: z.string().uuid(),
    entity_type: z.enum(['task', 'project', 'workspace', 'comment']).optional(),
    hours_back: z.coerce.number().int().min(1).max(720).default(24), // Max 30 days
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
});

const markReadSchema = z.object({
  body: z.object({
    activity_ids: z.array(z.string().uuid()).min(1).max(100),
  }),
});

const getUnreadCountSchema = z.object({
  query: z.object({
    workspace_id: z.string().uuid(),
  }),
});

const updatePreferencesSchema = z.object({
  params: z.object({
    workspace_id: z.string().uuid(),
  }),
  body: z.object({
    email_digest_frequency: z.enum(['none', 'hourly', 'daily', 'weekly']).optional(),
    email_digest_enabled: z.boolean().optional(),
    show_own_activities: z.boolean().optional(),
    show_mentions: z.boolean().optional(),
    show_assignments: z.boolean().optional(),
    show_comments: z.boolean().optional(),
    show_task_updates: z.boolean().optional(),
    show_project_updates: z.boolean().optional(),
    excluded_actions: z.array(z.string()).optional(),
    followed_projects: z.array(z.string().uuid()).optional(),
    excluded_projects: z.array(z.string().uuid()).optional(),
  }),
});

const getSummarySchema = z.object({
  params: z.object({
    workspace_id: z.string().uuid(),
  }),
  query: z.object({
    days_back: z.coerce.number().int().min(1).max(90).default(7),
  }),
});

// ============================================================================
// GET /feed/personalized - Get personalized activity feed
// ============================================================================

router.get('/personalized', validate(getPersonalizedFeedSchema), async (req, res, next) => {
  try {
    const { workspace_id, limit, offset, include_read } = req.query;

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

    // Get personalized feed using the database function
    const { data: activities, error } = await req.supabase
      .rpc('get_personalized_activity_feed', {
        p_user_id: req.userId,
        p_workspace_id: workspace_id,
        p_limit: limit,
        p_offset: offset,
      });

    if (error) throw error;

    // Filter by read status if requested
    let filteredActivities = activities || [];
    if (include_read === false) {
      filteredActivities = filteredActivities.filter(a => !a.is_read);
    }

    // Enrich with user and entity details
    const enrichedActivities = await Promise.all(
      filteredActivities.map(async (activity) => {
        // Get user details
        const { data: user } = await req.supabase
          .from('profiles')
          .select('id, name, email, avatar_url')
          .eq('id', activity.user_id)
          .single();

        // Get entity details based on type
        let entityDetails = null;
        if (activity.entity_type === 'task') {
          const { data: task } = await req.supabase
            .from('tasks')
            .select('id, title, status, project_id')
            .eq('id', activity.entity_id)
            .single();
          entityDetails = task;
        } else if (activity.entity_type === 'project') {
          const { data: project } = await req.supabase
            .from('projects')
            .select('id, name, color')
            .eq('id', activity.entity_id)
            .single();
          entityDetails = project;
        } else if (activity.entity_type === 'comment') {
          const { data: comment } = await req.supabase
            .from('comments')
            .select('id, content, task_id')
            .eq('id', activity.entity_id)
            .single();
          entityDetails = comment;
        }

        return {
          ...activity,
          user,
          entity_details: entityDetails,
        };
      })
    );

    res.json({
      activities: enrichedActivities,
      pagination: {
        limit,
        offset,
        has_more: enrichedActivities.length === limit,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /feed/aggregated - Get aggregated activity feed
// ============================================================================

router.get('/aggregated', validate(getAggregatedFeedSchema), async (req, res, next) => {
  try {
    const { workspace_id, entity_type, hours_back, limit } = req.query;

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

    // Calculate cutoff time
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - hours_back);

    // Query aggregated view
    let query = req.supabase
      .from('activity_feed_aggregated')
      .select('*')
      .eq('workspace_id', workspace_id)
      .gte('first_activity_at', cutoffTime.toISOString())
      .order('last_activity_at', { ascending: false })
      .limit(limit);

    if (entity_type) {
      query = query.eq('entity_type', entity_type);
    }

    const { data: aggregatedActivities, error } = await query;

    if (error) throw error;

    res.json({
      activities: aggregatedActivities || [],
      aggregation_window_hours: hours_back,
      limit,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /feed/mark-read - Mark activities as read
// ============================================================================

router.post('/mark-read', validate(markReadSchema), async (req, res, next) => {
  try {
    const { activity_ids } = req.body;

    // Call database function to mark as read
    const { data: markedCount, error } = await req.supabase
      .rpc('mark_activities_read', {
        p_user_id: req.userId,
        p_activity_ids: activity_ids,
      });

    if (error) throw error;

    logger.info(`Marked ${markedCount} activities as read for user ${req.userId}`);

    res.json({
      marked_count: markedCount,
      activity_ids,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /feed/mark-all-read - Mark all workspace activities as read
// ============================================================================

router.post('/mark-all-read', validate(getUnreadCountSchema), async (req, res, next) => {
  try {
    const { workspace_id } = req.query;

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

    // Get all unread activity IDs
    const { data: activities } = await req.supabase
      .from('activities')
      .select('id')
      .eq('workspace_id', workspace_id)
      .neq('user_id', req.userId)
      .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

    if (!activities || activities.length === 0) {
      return res.json({ marked_count: 0 });
    }

    const activityIds = activities.map(a => a.id);

    // Mark all as read
    const { data: markedCount, error } = await req.supabase
      .rpc('mark_activities_read', {
        p_user_id: req.userId,
        p_activity_ids: activityIds,
      });

    if (error) throw error;

    logger.info(`Marked all ${markedCount} activities as read for user ${req.userId} in workspace ${workspace_id}`);

    res.json({ marked_count: markedCount });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /feed/unread-count - Get unread activity count
// ============================================================================

router.get('/unread-count', validate(getUnreadCountSchema), async (req, res, next) => {
  try {
    const { workspace_id } = req.query;

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

    // Get unread count using database function
    const { data: count, error } = await req.supabase
      .rpc('get_unread_activity_count', {
        p_user_id: req.userId,
        p_workspace_id: workspace_id,
      });

    if (error) throw error;

    res.json({
      workspace_id,
      unread_count: count || 0,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /feed/preferences/:workspace_id - Get activity preferences
// ============================================================================

router.get('/preferences/:workspace_id', async (req, res, next) => {
  try {
    const { workspace_id } = req.params;

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

    // Get or create preferences
    let { data: preferences, error } = await req.supabase
      .from('activity_preferences')
      .select('*')
      .eq('user_id', req.userId)
      .eq('workspace_id', workspace_id)
      .single();

    if (error && error.code === 'PGRST116') {
      // Create default preferences
      const { data: newPrefs, error: insertError } = await req.supabase
        .from('activity_preferences')
        .insert({
          user_id: req.userId,
          workspace_id: workspace_id,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      preferences = newPrefs;
    } else if (error) {
      throw error;
    }

    res.json({ preferences });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PUT /feed/preferences/:workspace_id - Update activity preferences
// ============================================================================

router.put('/preferences/:workspace_id', validate(updatePreferencesSchema), async (req, res, next) => {
  try {
    const { workspace_id } = req.params;
    const updates = req.body;

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

    // Upsert preferences
    const { data: preferences, error } = await req.supabase
      .from('activity_preferences')
      .upsert({
        user_id: req.userId,
        workspace_id: workspace_id,
        ...updates,
      }, {
        onConflict: 'user_id,workspace_id',
      })
      .select()
      .single();

    if (error) throw error;

    logger.info(`Updated activity preferences for user ${req.userId} in workspace ${workspace_id}`);

    res.json({ preferences });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /feed/summary/:workspace_id - Get workspace activity summary
// ============================================================================

router.get('/summary/:workspace_id', validate(getSummarySchema), async (req, res, next) => {
  try {
    const { workspace_id } = req.params;
    const { days_back } = req.query;

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

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days_back);

    // Get summary from materialized view
    const { data: summary, error } = await req.supabase
      .from('workspace_activity_summary')
      .select('*')
      .eq('workspace_id', workspace_id)
      .gte('activity_date', cutoffDate.toISOString().split('T')[0])
      .order('activity_date', { ascending: false });

    if (error) throw error;

    // Aggregate by action type
    const actionSummary = {};
    const dailySummary = {};
    let totalActivities = 0;
    const uniqueUsers = new Set();
    const uniqueEntities = new Set();

    (summary || []).forEach(row => {
      totalActivities += row.activity_count;
      
      // Action summary
      if (!actionSummary[row.action]) {
        actionSummary[row.action] = 0;
      }
      actionSummary[row.action] += row.activity_count;
      
      // Daily summary
      const dateKey = row.activity_date.split('T')[0];
      if (!dailySummary[dateKey]) {
        dailySummary[dateKey] = 0;
      }
      dailySummary[dateKey] += row.activity_count;
      
      // Track unique users and entities (approximate)
      uniqueUsers.add(row.unique_users);
      uniqueEntities.add(row.unique_entities);
    });

    res.json({
      workspace_id,
      period: {
        days_back,
        start_date: cutoffDate.toISOString().split('T')[0],
        end_date: new Date().toISOString().split('T')[0],
      },
      summary: {
        total_activities: totalActivities,
        by_action: actionSummary,
        by_day: dailySummary,
      },
      raw_data: summary || [],
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /feed/refresh-summary - Refresh activity summary (admin only)
// ============================================================================

router.post('/refresh-summary', async (req, res, next) => {
  try {
    // Note: In production, this should be restricted to admin users or called via cron
    // For now, allowing any authenticated user to trigger refresh

    const { error } = await req.supabase
      .rpc('refresh_activity_summary');

    if (error) throw error;

    logger.info(`Activity summary refreshed by user ${req.userId}`);

    res.json({
      message: 'Activity summary refreshed successfully',
      refreshed_at: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
