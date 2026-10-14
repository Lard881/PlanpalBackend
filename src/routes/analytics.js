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

const RANGE_DAYS = { week: 7, '7d': 7, '30d': 30, '90d': 90 };

/** Convert a range name to the from/to values the SQL functions expect. */
function rangeBounds(range) {
  const days = RANGE_DAYS[range] ?? 7;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
  };
}

/** Table-returning functions come back as an array; the summary is the first row. */
function firstRow(data) {
  return Array.isArray(data) ? data[0] ?? {} : data ?? {};
}

function percentChange(current, previous) {
  const c = Number(current ?? 0);
  const p = Number(previous ?? 0);
  if (!p) return null;
  return Math.round(((c - p) / p) * 100);
}

function throwFirstError(results) {
  const failed = results.find(r => r.error);
  if (failed) throw failed.error;
}

/**
 * GET /workspaces/:workspaceId/analytics?range=
 * Full analytics for workspace
 */
router.get('/analytics',
  loadWorkspace,
  requireRole('admin', 'member'), // Guests blocked
  validate(analyticsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { range = '7d' } = req.query;
      const supabase = userClient(req.jwt);
      const ws = req.params.workspaceId;
      const { from, to, fromDate, toDate } = rangeBounds(range);

      const results = await Promise.all([
        supabase.rpc('analytics_summary', { p_workspace: ws, p_from: from, p_to: to }),
        supabase.rpc('analytics_weekly', { p_workspace: ws, p_from: from, p_to: to }),
        supabase.rpc('analytics_categories', { p_workspace: ws, p_from: from, p_to: to }),
        supabase.rpc('analytics_daily', { p_workspace: ws, p_from: fromDate, p_to: toDate }),
        supabase.rpc('analytics_streak', { p_workspace: ws }),
      ]);
      throwFirstError(results);

      const [summary, weekly, categories, daily, streak] = results.map(r => r.data);
      const s0 = firstRow(summary);

      res.json({
        summary: {
          ...s0,
          changeVsPrevious: percentChange(s0.completed, s0.completed_prev),
        },
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
router.get('/analytics/export.csv',
  loadWorkspace,
  requireRole('admin', 'member'),
  validate(analyticsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { range = '7d' } = req.query;
      const supabase = userClient(req.jwt);
      const { fromDate, toDate } = rangeBounds(range);

      const { data: daily, error } = await supabase.rpc('analytics_daily', {
        p_workspace: req.params.workspaceId,
        p_from: fromDate,
        p_to: toDate,
      });

      if (error) throw error;

      const headers = 'Date,Completed Tasks\n';
      const rows = (daily || []).map(row => `${row.day},${row.completed}`).join('\n');

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

      const { from, to, fromDate, toDate } = rangeBounds(range);
      const ws = req.params.workspaceId;

      const summaryRes = await supabase.rpc('analytics_summary', {
        p_workspace: ws,
        p_from: from,
        p_to: to,
      });
      if (summaryRes.error) throw summaryRes.error;
      const summary = firstRow(summaryRes.data);

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
      const dailyRes = await supabase.rpc('analytics_daily', {
        p_workspace: ws,
        p_from: fromDate,
        p_to: toDate,
      });
      if (dailyRes.error) throw dailyRes.error;
      const daily = dailyRes.data;

      res.json({
        counts: {
          // completed is limited to the chosen range, like the 'Tasks Completed' tile on Home
          completed: Number(summary.completed ?? completedCount ?? 0),
          inProgress: inProgressCount || 0,
          overdue: overdueCount || 0,
        },
        productivityPercent: Number(summary.on_time_rate ?? 0),
        dailySeries: daily || [],
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
