import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { supabase } from '../config/supabase.js';

const router = Router();

// Apply authentication to all analytics routes
router.use(authenticateToken);

/**
 * POST /api/v1/analytics/events
 * Log a single analytics event
 */
router.post('/events', async (req, res) => {
  try {
    const { event_type, workspace_id, event_data } = req.body;
    const userId = req.user.id;

    // Validate event_type
    const validEventTypes = [
      'task_created',
      'task_completed',
      'task_updated',
      'task_deleted',
      'search_performed',
      'attachment_uploaded',
      'comment_added',
      'label_applied',
      'project_created',
      'workspace_joined',
      'reminder_set',
      'filter_applied',
      'export_performed',
      'notification_clicked',
      'page_viewed'
    ];

    if (!event_type || !validEventTypes.includes(event_type)) {
      return res.status(400).json({
        error: 'Invalid event_type',
        valid_types: validEventTypes
      });
    }

    // Insert event
    const { data, error } = await supabase
      .from('analytics_events')
      .insert({
        user_id: userId,
        workspace_id: workspace_id || null,
        event_type,
        event_data: event_data || {}
      })
      .select()
      .single();

    if (error) {
      console.error('Error logging analytics event:', error);
      return res.status(500).json({ error: 'Failed to log event' });
    }

    res.status(201).json({ success: true, event: data });
  } catch (error) {
    console.error('Error in POST /analytics/events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/analytics/events/batch
 * Log multiple analytics events at once
 */
router.post('/events/batch', async (req, res) => {
  try {
    const { events } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events must be a non-empty array' });
    }

    if (events.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 events per batch' });
    }

    // Validate and prepare events
    const validEventTypes = [
      'task_created',
      'task_completed',
      'task_updated',
      'task_deleted',
      'search_performed',
      'attachment_uploaded',
      'comment_added',
      'label_applied',
      'project_created',
      'workspace_joined',
      'reminder_set',
      'filter_applied',
      'export_performed',
      'notification_clicked',
      'page_viewed'
    ];

    const preparedEvents = events.map(event => {
      if (!event.event_type || !validEventTypes.includes(event.event_type)) {
        throw new Error(`Invalid event_type: ${event.event_type}`);
      }

      return {
        user_id: userId,
        workspace_id: event.workspace_id || null,
        event_type: event.event_type,
        event_data: event.event_data || {},
        created_at: event.created_at || new Date().toISOString()
      };
    });

    // Insert all events
    const { data, error } = await supabase
      .from('analytics_events')
      .insert(preparedEvents)
      .select();

    if (error) {
      console.error('Error logging batch analytics events:', error);
      return res.status(500).json({ error: 'Failed to log events' });
    }

    res.status(201).json({
      success: true,
      count: data.length,
      events: data
    });
  } catch (error) {
    console.error('Error in POST /analytics/events/batch:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/v1/analytics/dashboard
 * Get aggregated analytics dashboard data
 */
router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      workspace_id,
      start_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // Default: 30 days ago
      end_date = new Date().toISOString()
    } = req.query;

    // Validate dates
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    if (startDate > endDate) {
      return res.status(400).json({ error: 'start_date must be before end_date' });
    }

    // Get task completion metrics
    const { data: completionMetrics, error: metricsError } = await supabase
      .rpc('get_task_completion_metrics', {
        p_user_id: userId,
        p_workspace_id: workspace_id || null,
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString()
      });

    if (metricsError) {
      console.error('Error fetching completion metrics:', metricsError);
      return res.status(500).json({ error: 'Failed to fetch metrics' });
    }

    // Get event counts by type
    const { data: eventCounts, error: countsError } = await supabase
      .rpc('get_event_counts_by_type', {
        p_user_id: userId,
        p_workspace_id: workspace_id || null,
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString()
      });

    if (countsError) {
      console.error('Error fetching event counts:', countsError);
      return res.status(500).json({ error: 'Failed to fetch event counts' });
    }

    // Get daily activity
    const { data: dailyActivity, error: activityError } = await supabase
      .rpc('get_daily_activity', {
        p_user_id: userId,
        p_workspace_id: workspace_id || null,
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString()
      });

    if (activityError) {
      console.error('Error fetching daily activity:', activityError);
      return res.status(500).json({ error: 'Failed to fetch daily activity' });
    }

    // Compile dashboard data
    const dashboard = {
      period: {
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString()
      },
      task_metrics: completionMetrics?.[0] || {
        total_created: 0,
        total_completed: 0,
        completion_rate: 0,
        avg_completion_time_hours: 0
      },
      event_counts: eventCounts || [],
      daily_activity: dailyActivity || [],
      workspace_id: workspace_id || null
    };

    res.json(dashboard);
  } catch (error) {
    console.error('Error in GET /analytics/dashboard:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/analytics/workspace/:workspaceId
 * Get workspace-level analytics (admin only)
 */
router.get('/workspace/:workspaceId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { workspaceId } = req.params;
    const {
      start_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      end_date = new Date().toISOString()
    } = req.query;

    // Check if user is admin of workspace
    const { data: membership, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .single();

    if (memberError || !membership || !['admin', 'owner'].includes(membership.role)) {
      return res.status(403).json({ error: 'Access denied. Workspace admin required.' });
    }

    // Get all members of workspace
    const { data: members, error: membersError } = await supabase
      .from('workspace_members')
      .select('user_id, profiles(full_name, email)')
      .eq('workspace_id', workspaceId);

    if (membersError) {
      console.error('Error fetching workspace members:', membersError);
      return res.status(500).json({ error: 'Failed to fetch workspace members' });
    }

    // Get workspace events count
    const { count: totalEvents, error: countError } = await supabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .gte('created_at', start_date)
      .lte('created_at', end_date);

    if (countError) {
      console.error('Error counting workspace events:', countError);
    }

    // Get top contributors
    const { data: contributors, error: contributorsError } = await supabase
      .from('analytics_events')
      .select('user_id, profiles(full_name)')
      .eq('workspace_id', workspaceId)
      .gte('created_at', start_date)
      .lte('created_at', end_date);

    const contributorCounts = {};
    if (contributors) {
      contributors.forEach(event => {
        const userId = event.user_id;
        contributorCounts[userId] = (contributorCounts[userId] || 0) + 1;
      });
    }

    const topContributors = Object.entries(contributorCounts)
      .map(([user_id, count]) => ({
        user_id,
        event_count: count,
        full_name: contributors.find(c => c.user_id === user_id)?.profiles?.full_name || 'Unknown'
      }))
      .sort((a, b) => b.event_count - a.event_count)
      .slice(0, 5);

    const workspaceAnalytics = {
      workspace_id: workspaceId,
      period: {
        start_date,
        end_date
      },
      total_events: totalEvents || 0,
      total_members: members?.length || 0,
      top_contributors: topContributors
    };

    res.json(workspaceAnalytics);
  } catch (error) {
    console.error('Error in GET /analytics/workspace/:workspaceId:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/analytics/insights
 * Get productivity insights and trends
 */
router.get('/insights', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      workspace_id,
      start_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      end_date = new Date().toISOString()
    } = req.query;

    const startDate = new Date(start_date);
    const endDate = new Date(end_date);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    // Get productivity trends
    const { data: productivityTrends, error: trendsError } = await supabase
      .rpc('get_productivity_trends', {
        p_user_id: userId,
        p_workspace_id: workspace_id || null,
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString()
      });

    if (trendsError) {
      console.error('Error fetching productivity trends:', trendsError);
    }

    // Get status distribution
    const { data: statusDistribution, error: statusError } = await supabase
      .rpc('get_task_status_distribution', {
        p_user_id: userId,
        p_workspace_id: workspace_id || null
      });

    if (statusError) {
      console.error('Error fetching status distribution:', statusError);
    }

    // Get priority distribution
    const { data: priorityDistribution, error: priorityError } = await supabase
      .rpc('get_task_priority_distribution', {
        p_user_id: userId,
        p_workspace_id: workspace_id || null
      });

    if (priorityError) {
      console.error('Error fetching priority distribution:', priorityError);
    }

    // Get most active hours
    const { data: activeHours, error: hoursError } = await supabase
      .rpc('get_most_active_hours', {
        p_user_id: userId,
        p_workspace_id: workspace_id || null,
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString()
      });

    if (hoursError) {
      console.error('Error fetching active hours:', hoursError);
    }

    // Get most active days
    const { data: activeDays, error: daysError } = await supabase
      .rpc('get_most_active_days', {
        p_user_id: userId,
        p_workspace_id: workspace_id || null,
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString()
      });

    if (daysError) {
      console.error('Error fetching active days:', daysError);
    }

    // Get overdue tasks
    const { data: overdueTasks, error: overdueError } = await supabase
      .rpc('get_overdue_tasks_count', {
        p_user_id: userId,
        p_workspace_id: workspace_id || null
      });

    if (overdueError) {
      console.error('Error fetching overdue tasks:', overdueError);
    }

    // Get average tasks per day
    const { data: avgTasksPerDay, error: avgError } = await supabase
      .rpc('get_avg_tasks_per_day', {
        p_user_id: userId,
        p_workspace_id: workspace_id || null,
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString()
      });

    if (avgError) {
      console.error('Error fetching avg tasks per day:', avgError);
    }

    // Get completion streak
    const { data: completionStreak, error: streakError } = await supabase
      .rpc('get_completion_streak', {
        p_user_id: userId,
        p_workspace_id: workspace_id || null
      });

    if (streakError) {
      console.error('Error fetching completion streak:', streakError);
    }

    // Generate insights text
    const insights = [];

    // Most productive day
    if (activeDays && activeDays.length > 0) {
      const mostProductiveDay = activeDays.reduce((max, day) =>
        day.event_count > max.event_count ? day : max
      );
      insights.push({
        type: 'most_productive_day',
        title: 'Most Productive Day',
        value: mostProductiveDay.day_name,
        detail: `${mostProductiveDay.event_count} activities (${mostProductiveDay.percentage}% of total)`
      });
    }

    // Most active hour
    if (activeHours && activeHours.length > 0) {
      const mostActiveHour = activeHours[0];
      const hourFormatted = mostActiveHour.hour_of_day === 0 ? '12 AM' :
        mostActiveHour.hour_of_day < 12 ? `${mostActiveHour.hour_of_day} AM` :
        mostActiveHour.hour_of_day === 12 ? '12 PM' :
        `${mostActiveHour.hour_of_day - 12} PM`;
      insights.push({
        type: 'most_active_hour',
        title: 'Most Active Hour',
        value: hourFormatted,
        detail: `${mostActiveHour.event_count} activities (${mostActiveHour.percentage}%)`
      });
    }

    // Completion streak
    if (completionStreak && completionStreak.length > 0) {
      const streak = completionStreak[0];
      if (streak.current_streak > 0) {
        insights.push({
          type: 'completion_streak',
          title: 'Current Streak',
          value: `${streak.current_streak} day${streak.current_streak > 1 ? 's' : ''}`,
          detail: `Longest streak: ${streak.longest_streak} days`
        });
      }
    }

    // Overdue tasks warning
    if (overdueTasks && overdueTasks.length > 0) {
      const overdue = overdueTasks[0];
      if (overdue.overdue_count > 0) {
        insights.push({
          type: 'overdue_tasks',
          title: 'Overdue Tasks',
          value: overdue.overdue_count.toString(),
          detail: overdue.overdue_high_priority > 0 ?
            `${overdue.overdue_high_priority} high priority` :
            'Review and update due dates',
          severity: 'warning'
        });
      }
    }

    // Average productivity
    if (avgTasksPerDay && avgTasksPerDay.length > 0) {
      const avg = avgTasksPerDay[0];
      insights.push({
        type: 'avg_productivity',
        title: 'Daily Average',
        value: `${avg.avg_completed_per_day} completed`,
        detail: `${avg.avg_created_per_day} created per day`
      });
    }

    const insightsData = {
      period: {
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString()
      },
      productivity_trends: productivityTrends || [],
      status_distribution: statusDistribution || [],
      priority_distribution: priorityDistribution || [],
      active_hours: activeHours || [],
      active_days: activeDays || [],
      overdue_tasks: overdueTasks?.[0] || null,
      avg_tasks_per_day: avgTasksPerDay?.[0] || null,
      completion_streak: completionStreak?.[0] || null,
      insights,
      workspace_id: workspace_id || null
    };

    res.json(insightsData);
  } catch (error) {
    console.error('Error in GET /analytics/insights:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/analytics/workspace/:workspaceId/team
 * Get team activity for workspace (admin only)
 */
router.get('/workspace/:workspaceId/team', async (req, res) => {
  try {
    const userId = req.user.id;
    const { workspaceId } = req.params;
    const {
      start_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      end_date = new Date().toISOString()
    } = req.query;

    // Check if user is admin of workspace
    const { data: membership, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .single();

    if (memberError || !membership || !['admin', 'owner'].includes(membership.role)) {
      return res.status(403).json({ error: 'Access denied. Workspace admin required.' });
    }

    // Get team activity
    const { data: teamActivity, error: activityError } = await supabase
      .rpc('get_workspace_team_activity', {
        p_workspace_id: workspaceId,
        p_start_date: start_date,
        p_end_date: end_date
      });

    if (activityError) {
      console.error('Error fetching team activity:', activityError);
      return res.status(500).json({ error: 'Failed to fetch team activity' });
    }

    res.json({
      workspace_id: workspaceId,
      period: {
        start_date,
        end_date
      },
      team_activity: teamActivity || []
    });
  } catch (error) {
    console.error('Error in GET /analytics/workspace/:workspaceId/team:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
