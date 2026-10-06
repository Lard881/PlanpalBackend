import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { loadWorkspace, requireRole } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';

const router = express.Router({ mergeParams: true });

const analyticsQuerySchema = z.object({
  range: z.enum(['7d', '30d', '90d']).optional(),
});

const overviewQuerySchema = z.object({
  range: z.enum(['week', '7d', '30d']).optional(),
});

/**
 * GET /workspaces/:workspaceId/analytics?range=
 * Full analytics for workspace
 */
router.get(
  '/',
  loadWorkspace,
  requireRole('admin', 'member'), // Guests blocked
  validate(analyticsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { range = '7d' } = req.query;
      const supabase = userClient(req.jwt);

      // Call all analytics functions in parallel
      const [
        { data: summary },
        { data: weekly },
        { data: categories },
        { data: daily },
        { data: streak },
      ] = await Promise.all([
        supabase.rpc('analytics_summary', {
          p_workspace_id: req.params.workspaceId,
          p_range: range,
        }),
        supabase.rpc('analytics_weekly', {
          p_workspace_id: req.params.workspaceId,
        }),
        supabase.rpc('analytics_by_category', {
          p_workspace_id: req.params.workspaceId,
          p_range: range,
        }),
        supabase.rpc('analytics_daily_completion', {
          p_workspace_id: req.params.workspaceId,
          p_range: range,
        }),
        supabase.rpc('get_completion_streak', {
          p_workspace_id: req.params.workspaceId,
        }),
      ]);

      res.json({
        summary: summary || {},
        weekly: weekly || [],
        categories: categories || [],
        daily: daily || [],
        streak: streak || 0,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /workspaces/:workspaceId/analytics/export.csv?range=
 * Export analytics as CSV
 */
router.get(
  '/export.csv',
  loadWorkspace,
  requireRole('admin', 'full'),
  validate(analyticsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { range = '7d' } = req.query;
      const supabase = userClient(req.jwt);

      // Get daily completion data
      const { data: daily, error } = await supabase.rpc('analytics_daily_completion', {
        p_workspace_id: req.params.workspaceId,
        p_range: range,
      });

      if (error) throw error;

      // Generate CSV
      const headers = 'Date,Completed Tasks,Created Tasks,Completion Rate\n';
      const rows = (daily || []).map(row => 
        `${row.date},${row.completed},${row.created},${row.completion_rate || 0}`
      ).join('\n');

      const csv = headers + rows;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="analytics-${range}.csv"`);
      res.send(csv);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /workspaces/:workspaceId/overview?range=
 * Dashboard overview (lighter version for home screen)
 */
router.get(
  '/overview',
  loadWorkspace,
  validate(overviewQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { range = 'week' } = req.query;
      const supabase = userClient(req.jwt);

      // Get summary
      const { data: summary } = await supabase.rpc('analytics_summary', {
        p_workspace_id: req.params.workspaceId,
        p_range: range === 'week' ? '7d' : range,
      });

      // Get task counts
      const [
        { count: completedCount },
        { count: inProgressCount },
        { count: overdueCount },
      ] = await Promise.all([
        supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', req.params.workspaceId)
          .eq('status', 'completed')
          .is('deleted_at', null),
        supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', req.params.workspaceId)
          .eq('status', 'in_progress')
          .is('deleted_at', null),
        supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', req.params.workspaceId)
          .neq('status', 'completed')
          .lt('due_at', new Date().toISOString())
          .is('deleted_at', null),
      ]);

      // Get daily series
      const { data: daily } = await supabase.rpc('analytics_daily_completion', {
        p_workspace_id: req.params.workspaceId,
        p_range: range === 'week' ? '7d' : range,
      });

      res.json({
        counts: {
          completed: completedCount || 0,
          inProgress: inProgressCount || 0,
          overdue: overdueCount || 0,
        },
        productivityPercent: summary?.on_time_rate || 0,
        dailySeries: daily || [],
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
