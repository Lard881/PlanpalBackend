import express from 'express';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { validate } from '../lib/validation.js';
import { z } from 'zod';
import { getOnlineUsersInWorkspace } from '../lib/realtime-helpers.js';

const router = express.Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const workspaceMetricsSchema = z.object({
  params: z.object({
    workspace_id: z.string().uuid(),
  }),
  query: z.object({
    period: z.enum(['7d', '14d', '30d', '90d']).default('30d'),
  }),
});

const memberStatsSchema = z.object({
  params: z.object({
    workspace_id: z.string().uuid(),
  }),
  query: z.object({
    period: z.enum(['7d', '14d', '30d', '90d']).default('30d'),
    sort_by: z.enum(['tasks_completed', 'comments', 'activity_count']).default('tasks_completed'),
  }),
});

const taskTrendsSchema = z.object({
  params: z.object({
    workspace_id: z.string().uuid(),
  }),
  query: z.object({
    period: z.enum(['7d', '14d', '30d', '90d']).default('30d'),
    granularity: z.enum(['day', 'week']).default('day'),
  }),
});

const projectHealthSchema = z.object({
  params: z.object({
    workspace_id: z.string().uuid(),
  }),
});

// ============================================================================
// GET /team-dashboard/:workspace_id/overview - Get dashboard overview
// ============================================================================

router.get('/:workspace_id/overview', validate(workspaceMetricsSchema), async (req, res, next) => {
  try {
    const { workspace_id } = req.params;
    const { period } = req.query;

    // Verify workspace access
    const { data: member } = await req.supabase
      .from('workspace_members')
      .select('id, role')
      .eq('workspace_id', workspace_id)
      .eq('user_id', req.userId)
      .single();

    if (!member) {
      throw new AppError('FORBIDDEN', 'Access denied to workspace', 403);
    }

    const daysBack = parseInt(period.replace('d', ''));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Get workspace members count
    const { count: memberCount } = await req.supabase
      .from('workspace_members')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id);

    // Get total tasks
    const { count: totalTasks } = await req.supabase
      .from('tasks')
      .select('*, projects!inner(workspace_id)', { count: 'exact', head: true })
      .eq('projects.workspace_id', workspace_id);

    // Get completed tasks in period
    const { count: completedTasks } = await req.supabase
      .from('tasks')
      .select('*, projects!inner(workspace_id)', { count: 'exact', head: true })
      .eq('projects.workspace_id', workspace_id)
      .eq('status', 'completed')
      .gte('updated_at', startDate.toISOString());

    // Get active tasks (not completed)
    const { count: activeTasks } = await req.supabase
      .from('tasks')
      .select('*, projects!inner(workspace_id)', { count: 'exact', head: true })
      .eq('projects.workspace_id', workspace_id)
      .neq('status', 'completed');

    // Get overdue tasks
    const { count: overdueTasks } = await req.supabase
      .from('tasks')
      .select('*, projects!inner(workspace_id)', { count: 'exact', head: true })
      .eq('projects.workspace_id', workspace_id)
      .neq('status', 'completed')
      .lt('due_date', new Date().toISOString());

    // Get activity count in period
    const { count: activityCount } = await req.supabase
      .from('activities')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)
      .gte('created_at', startDate.toISOString());

    // Get comments count in period
    const { data: comments } = await req.supabase
      .from('comments')
      .select('id, tasks!inner(project_id, projects!inner(workspace_id))')
      .eq('tasks.projects.workspace_id', workspace_id)
      .gte('created_at', startDate.toISOString());

    // Get mentions count in period
    const { data: mentions } = await req.supabase
      .from('mentions')
      .select('id, tasks!inner(project_id, projects!inner(workspace_id))')
      .eq('tasks.projects.workspace_id', workspace_id)
      .gte('created_at', startDate.toISOString());

    // Get online users
    const onlineUsers = getOnlineUsersInWorkspace(workspace_id);

    // Calculate completion rate
    const completionRate = totalTasks > 0 
      ? Math.round((completedTasks / totalTasks) * 100) 
      : 0;

    res.json({
      workspace_id,
      period,
      overview: {
        members: {
          total: memberCount || 0,
          online: onlineUsers.length,
        },
        tasks: {
          total: totalTasks || 0,
          active: activeTasks || 0,
          completed: completedTasks || 0,
          overdue: overdueTasks || 0,
          completion_rate: completionRate,
        },
        engagement: {
          activities: activityCount || 0,
          comments: comments?.length || 0,
          mentions: mentions?.length || 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /team-dashboard/:workspace_id/members - Get member statistics
// ============================================================================

router.get('/:workspace_id/members', validate(memberStatsSchema), async (req, res, next) => {
  try {
    const { workspace_id } = req.params;
    const { period, sort_by } = req.query;

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

    const daysBack = parseInt(period.replace('d', ''));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Get all workspace members
    const { data: members } = await req.supabase
      .from('workspace_members')
      .select(`
        user_id,
        role,
        joined_at,
        users:profiles!workspace_members_user_id_fkey(id, name, email, avatar_url)
      `)
      .eq('workspace_id', workspace_id);

    if (!members) {
      return res.json({ members: [] });
    }

    // Get statistics for each member
    const memberStats = await Promise.all(
      members.map(async (member) => {
        const userId = member.user_id;

        // Tasks assigned
        const { count: tasksAssigned } = await req.supabase
          .from('tasks')
          .select('*, projects!inner(workspace_id)', { count: 'exact', head: true })
          .eq('projects.workspace_id', workspace_id)
          .eq('assigned_to', userId);

        // Tasks completed in period
        const { count: tasksCompleted } = await req.supabase
          .from('tasks')
          .select('*, projects!inner(workspace_id)', { count: 'exact', head: true })
          .eq('projects.workspace_id', workspace_id)
          .eq('assigned_to', userId)
          .eq('status', 'completed')
          .gte('updated_at', startDate.toISOString());

        // Tasks created in period
        const { count: tasksCreated } = await req.supabase
          .from('tasks')
          .select('*, projects!inner(workspace_id)', { count: 'exact', head: true })
          .eq('projects.workspace_id', workspace_id)
          .eq('created_by', userId)
          .gte('created_at', startDate.toISOString());

        // Comments in period
        const { data: userComments } = await req.supabase
          .from('comments')
          .select('id, tasks!inner(project_id, projects!inner(workspace_id))')
          .eq('user_id', userId)
          .eq('tasks.projects.workspace_id', workspace_id)
          .gte('created_at', startDate.toISOString());

        // Activities in period
        const { count: activityCount } = await req.supabase
          .from('activities')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', workspace_id)
          .eq('user_id', userId)
          .gte('created_at', startDate.toISOString());

        // Mentions received in period
        const { data: mentionsReceived } = await req.supabase
          .from('mentions')
          .select('id, tasks!inner(project_id, projects!inner(workspace_id))')
          .eq('mentioned_user_id', userId)
          .eq('tasks.projects.workspace_id', workspace_id)
          .gte('created_at', startDate.toISOString());

        // Check if online
        const onlineUsers = getOnlineUsersInWorkspace(workspace_id);
        const isOnline = onlineUsers.includes(userId);

        return {
          user_id: userId,
          name: member.users?.name || 'Unknown',
          email: member.users?.email,
          avatar_url: member.users?.avatar_url,
          role: member.role,
          joined_at: member.joined_at,
          is_online: isOnline,
          stats: {
            tasks_assigned: tasksAssigned || 0,
            tasks_completed: tasksCompleted || 0,
            tasks_created: tasksCreated || 0,
            comments: userComments?.length || 0,
            activity_count: activityCount || 0,
            mentions_received: mentionsReceived?.length || 0,
          },
        };
      })
    );

    // Sort by requested field
    memberStats.sort((a, b) => {
      return b.stats[sort_by] - a.stats[sort_by];
    });

    res.json({
      workspace_id,
      period,
      members: memberStats,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /team-dashboard/:workspace_id/task-trends - Get task completion trends
// ============================================================================

router.get('/:workspace_id/task-trends', validate(taskTrendsSchema), async (req, res, next) => {
  try {
    const { workspace_id } = req.params;
    const { period, granularity } = req.query;

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

    const daysBack = parseInt(period.replace('d', ''));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Get task completion data
    const { data: completedTasks } = await req.supabase
      .from('tasks')
      .select('updated_at, status, projects!inner(workspace_id)')
      .eq('projects.workspace_id', workspace_id)
      .eq('status', 'completed')
      .gte('updated_at', startDate.toISOString())
      .order('updated_at', { ascending: true });

    // Get task creation data
    const { data: createdTasks } = await req.supabase
      .from('tasks')
      .select('created_at, projects!inner(workspace_id)')
      .eq('projects.workspace_id', workspace_id)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true });

    // Group by date
    const trends = {};
    const dateFormat = granularity === 'day' ? 'YYYY-MM-DD' : 'YYYY-WW';

    // Initialize all dates
    for (let i = 0; i < daysBack; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = date.toISOString().split('T')[0];
      trends[key] = {
        date: key,
        completed: 0,
        created: 0,
      };
    }

    // Count completed tasks
    completedTasks?.forEach(task => {
      const dateKey = task.updated_at.split('T')[0];
      if (trends[dateKey]) {
        trends[dateKey].completed++;
      }
    });

    // Count created tasks
    createdTasks?.forEach(task => {
      const dateKey = task.created_at.split('T')[0];
      if (trends[dateKey]) {
        trends[dateKey].created++;
      }
    });

    // Convert to array and sort
    const trendsArray = Object.values(trends).sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    );

    res.json({
      workspace_id,
      period,
      granularity,
      trends: trendsArray,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /team-dashboard/:workspace_id/project-health - Get project health metrics
// ============================================================================

router.get('/:workspace_id/project-health', validate(projectHealthSchema), async (req, res, next) => {
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

    // Get all projects
    const { data: projects } = await req.supabase
      .from('projects')
      .select('id, name, color, created_at')
      .eq('workspace_id', workspace_id);

    if (!projects) {
      return res.json({ projects: [] });
    }

    // Get health metrics for each project
    const projectHealth = await Promise.all(
      projects.map(async (project) => {
        // Total tasks
        const { count: totalTasks } = await req.supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', project.id);

        // Completed tasks
        const { count: completedTasks } = await req.supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', project.id)
          .eq('status', 'completed');

        // Overdue tasks
        const { count: overdueTasks } = await req.supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', project.id)
          .neq('status', 'completed')
          .lt('due_date', new Date().toISOString());

        // Active tasks
        const { count: activeTasks } = await req.supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', project.id)
          .neq('status', 'completed');

        // Recent activity (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { count: recentActivity } = await req.supabase
          .from('activities')
          .select('*', { count: 'exact', head: true })
          .eq('entity_type', 'task')
          .gte('created_at', sevenDaysAgo.toISOString());

        // Calculate metrics
        const completionRate = totalTasks > 0 
          ? Math.round((completedTasks / totalTasks) * 100) 
          : 0;

        const overdueRate = totalTasks > 0
          ? Math.round((overdueTasks / totalTasks) * 100)
          : 0;

        // Health score (0-100)
        let healthScore = 100;
        healthScore -= overdueRate * 0.5; // Penalty for overdue tasks
        healthScore -= Math.max(0, 100 - completionRate) * 0.3; // Penalty for low completion
        healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

        // Health status
        let healthStatus = 'excellent';
        if (healthScore < 40) healthStatus = 'critical';
        else if (healthScore < 60) healthStatus = 'poor';
        else if (healthScore < 80) healthStatus = 'good';

        return {
          project_id: project.id,
          project_name: project.name,
          project_color: project.color,
          created_at: project.created_at,
          metrics: {
            total_tasks: totalTasks || 0,
            completed_tasks: completedTasks || 0,
            active_tasks: activeTasks || 0,
            overdue_tasks: overdueTasks || 0,
            completion_rate: completionRate,
            overdue_rate: overdueRate,
            recent_activity: recentActivity || 0,
          },
          health: {
            score: healthScore,
            status: healthStatus,
          },
        };
      })
    );

    // Sort by health score (worst first for attention)
    projectHealth.sort((a, b) => a.health.score - b.health.score);

    res.json({
      workspace_id,
      projects: projectHealth,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /team-dashboard/:workspace_id/activity-heatmap - Get activity heatmap data
// ============================================================================

router.get('/:workspace_id/activity-heatmap', validate(workspaceMetricsSchema), async (req, res, next) => {
  try {
    const { workspace_id } = req.params;
    const { period } = req.query;

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

    const daysBack = parseInt(period.replace('d', ''));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Get all activities in period
    const { data: activities } = await req.supabase
      .from('activities')
      .select('created_at, action')
      .eq('workspace_id', workspace_id)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true });

    // Initialize heatmap data structure
    const heatmap = {};
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    days.forEach(day => {
      heatmap[day] = {};
      hours.forEach(hour => {
        heatmap[day][hour] = 0;
      });
    });

    // Count activities by day of week and hour
    activities?.forEach(activity => {
      const date = new Date(activity.created_at);
      const day = days[date.getDay()];
      const hour = date.getHours();
      heatmap[day][hour]++;
    });

    // Convert to array format
    const heatmapArray = days.map(day => ({
      day,
      hours: hours.map(hour => ({
        hour,
        count: heatmap[day][hour],
      })),
    }));

    res.json({
      workspace_id,
      period,
      heatmap: heatmapArray,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /team-dashboard/:workspace_id/top-contributors - Get top contributors
// ============================================================================

router.get('/:workspace_id/top-contributors', validate(workspaceMetricsSchema), async (req, res, next) => {
  try {
    const { workspace_id } = req.params;
    const { period } = req.query;

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

    const daysBack = parseInt(period.replace('d', ''));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Get activity counts per user
    const { data: activities } = await req.supabase
      .from('activities')
      .select('user_id, action')
      .eq('workspace_id', workspace_id)
      .gte('created_at', startDate.toISOString());

    // Count by user
    const userCounts = {};
    activities?.forEach(activity => {
      if (!userCounts[activity.user_id]) {
        userCounts[activity.user_id] = 0;
      }
      userCounts[activity.user_id]++;
    });

    // Get user details and sort
    const contributors = await Promise.all(
      Object.entries(userCounts).map(async ([userId, count]) => {
        const { data: user } = await req.supabase
          .from('profiles')
          .select('id, name, email, avatar_url')
          .eq('id', userId)
          .single();

        return {
          user_id: userId,
          name: user?.name || 'Unknown',
          email: user?.email,
          avatar_url: user?.avatar_url,
          activity_count: count,
        };
      })
    );

    // Sort by activity count and take top 10
    contributors.sort((a, b) => b.activity_count - a.activity_count);
    const topContributors = contributors.slice(0, 10);

    res.json({
      workspace_id,
      period,
      contributors: topContributors,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
