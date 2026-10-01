import { adminClient } from '../lib/supabase.js';
import logger from '../lib/logger.js';
import {
  notifyDeadlineApproaching,
  notifyTaskOverdue,
  notifyEventReminder,
} from '../lib/notifications.js';

/**
 * Check for tasks with approaching deadlines and create notifications
 * Checks for tasks due in 24 hours and 1 hour
 */
async function checkDeadlineReminders() {
  try {
    logger.info('Checking for deadline reminders...');

    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in1Hour = new Date(now.getTime() + 60 * 60 * 1000);

    // Get tasks due within the next 24 hours that are not completed
    const { data: tasks, error } = await adminClient
      .from('tasks')
      .select('id, title, due_at, assignee_id, workspace_id, status')
      .not('status', 'eq', 'completed')
      .not('due_at', 'is', null)
      .gte('due_at', now.toISOString())
      .lte('due_at', in24Hours.toISOString());

    if (error) throw error;

    if (!tasks || tasks.length === 0) {
      logger.info('No tasks with approaching deadlines');
      return { checked: 0, notified: 0 };
    }

    logger.info(`Found ${tasks.length} tasks with approaching deadlines`);

    let notificationCount = 0;

    for (const task of tasks) {
      // Skip tasks without assignee
      if (!task.assignee_id) continue;

      const dueAt = new Date(task.due_at);
      const hoursUntilDue = (dueAt - now) / (1000 * 60 * 60);

      // Send 24-hour reminder
      if (hoursUntilDue <= 24 && hoursUntilDue > 23) {
        await notifyDeadlineApproaching(
          task.assignee_id,
          task.workspace_id,
          task.id,
          task.title,
          dueAt
        );
        notificationCount++;
        logger.debug(`24-hour reminder sent for task ${task.id}`);
      }

      // Send 1-hour reminder
      if (hoursUntilDue <= 1 && hoursUntilDue > 0.5) {
        await notifyDeadlineApproaching(
          task.assignee_id,
          task.workspace_id,
          task.id,
          task.title,
          dueAt
        );
        notificationCount++;
        logger.debug(`1-hour reminder sent for task ${task.id}`);
      }
    }

    logger.info(`Deadline check complete: ${notificationCount} notifications created`);
    return { checked: tasks.length, notified: notificationCount };
  } catch (error) {
    logger.error('Deadline reminder check failed:', error);
    throw error;
  }
}

/**
 * Check for overdue tasks and create notifications
 * Checks for tasks that became overdue in the last hour
 */
async function checkOverdueTasks() {
  try {
    logger.info('Checking for overdue tasks...');

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Get tasks that are overdue (due_at is in the past and status is not completed)
    const { data: tasks, error } = await adminClient
      .from('tasks')
      .select('id, title, due_at, assignee_id, workspace_id, status')
      .not('status', 'eq', 'completed')
      .not('due_at', 'is', null)
      .lt('due_at', now.toISOString())
      .gte('due_at', oneHourAgo.toISOString()); // Only recently overdue tasks

    if (error) throw error;

    if (!tasks || tasks.length === 0) {
      logger.info('No recently overdue tasks');
      return { checked: 0, notified: 0 };
    }

    logger.info(`Found ${tasks.length} recently overdue tasks`);

    let notificationCount = 0;

    for (const task of tasks) {
      // Skip tasks without assignee
      if (!task.assignee_id) continue;

      await notifyTaskOverdue(
        task.assignee_id,
        task.workspace_id,
        task.id,
        task.title
      );
      notificationCount++;
      logger.debug(`Overdue notification sent for task ${task.id}`);
    }

    logger.info(`Overdue check complete: ${notificationCount} notifications created`);
    return { checked: tasks.length, notified: notificationCount };
  } catch (error) {
    logger.error('Overdue task check failed:', error);
    throw error;
  }
}

/**
 * Check for upcoming events and create reminder notifications
 * Checks for events starting in 1 hour, 30 minutes, and 15 minutes
 */
async function checkEventReminders() {
  try {
    logger.info('Checking for event reminders...');

    const now = new Date();
    const in1Hour = new Date(now.getTime() + 60 * 60 * 1000);

    // Get events starting within the next hour
    const { data: events, error } = await adminClient
      .from('events')
      .select(`
        id,
        title,
        starts_at,
        workspace_id,
        event_attendees!inner(user_id)
      `)
      .gte('starts_at', now.toISOString())
      .lte('starts_at', in1Hour.toISOString());

    if (error) throw error;

    if (!events || events.length === 0) {
      logger.info('No upcoming events');
      return { checked: 0, notified: 0 };
    }

    logger.info(`Found ${events.length} upcoming events`);

    let notificationCount = 0;

    for (const event of events) {
      const startsAt = new Date(event.starts_at);
      const minutesUntilStart = (startsAt - now) / (1000 * 60);

      // Get unique attendees
      const attendeeIds = [
        ...new Set(event.event_attendees.map((a) => a.user_id)),
      ];

      for (const userId of attendeeIds) {
        // Send reminder at 1 hour
        if (minutesUntilStart <= 60 && minutesUntilStart > 55) {
          await notifyEventReminder(
            userId,
            event.workspace_id,
            event.id,
            event.title,
            startsAt
          );
          notificationCount++;
        }

        // Send reminder at 30 minutes
        if (minutesUntilStart <= 30 && minutesUntilStart > 25) {
          await notifyEventReminder(
            userId,
            event.workspace_id,
            event.id,
            event.title,
            startsAt
          );
          notificationCount++;
        }

        // Send reminder at 15 minutes
        if (minutesUntilStart <= 15 && minutesUntilStart > 10) {
          await notifyEventReminder(
            userId,
            event.workspace_id,
            event.id,
            event.title,
            startsAt
          );
          notificationCount++;
        }
      }

      logger.debug(`Event reminders sent for event ${event.id}`);
    }

    logger.info(`Event reminder check complete: ${notificationCount} notifications created`);
    return { checked: events.length, notified: notificationCount };
  } catch (error) {
    logger.error('Event reminder check failed:', error);
    throw error;
  }
}

/**
 * Run all reminder checks
 * This is the main function that should be called by the cron job
 */
export async function processReminders() {
  try {
    logger.info('Starting reminder processing...');

    const [deadlineResult, overdueResult, eventResult] = await Promise.all([
      checkDeadlineReminders(),
      checkOverdueTasks(),
      checkEventReminders(),
    ]);

    const totalChecked =
      deadlineResult.checked + overdueResult.checked + eventResult.checked;
    const totalNotified =
      deadlineResult.notified + overdueResult.notified + eventResult.notified;

    logger.info(
      `Reminder processing complete: checked ${totalChecked} items, created ${totalNotified} notifications`
    );

    return {
      success: true,
      deadline: deadlineResult,
      overdue: overdueResult,
      events: eventResult,
      totals: {
        checked: totalChecked,
        notified: totalNotified,
      },
    };
  } catch (error) {
    logger.error('Reminder processing failed:', error);
    throw error;
  }
}

// Scheduler state
let isRunning = false;
let intervalId = null;

async function runReminderWorker() {
  if (isRunning) {
    logger.debug('Reminder worker already running, skipping this cycle');
    return;
  }

  isRunning = true;

  try {
    await processReminders();
  } catch (error) {
    logger.error('Reminder worker error:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Start the reminder scheduler
 * @param {number} intervalMinutes - Interval in minutes (default: 5)
 */
export function startReminderScheduler(intervalMinutes = 5) {
  if (intervalId) {
    logger.warn('Reminder scheduler already running');
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;

  logger.info(`Starting reminder scheduler (interval: ${intervalMinutes} minute(s))`);

  // Run immediately on start
  runReminderWorker();

  // Then run at intervals
  intervalId = setInterval(runReminderWorker, intervalMs);

  logger.info('Reminder scheduler started successfully');
}

/**
 * Stop the reminder scheduler
 */
export function stopReminderScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Reminder scheduler stopped');
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, stopping reminder scheduler');
  stopReminderScheduler();
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, stopping reminder scheduler');
  stopReminderScheduler();
});

export default {
  processReminders,
  checkDeadlineReminders,
  checkOverdueTasks,
  checkEventReminders,
  start: startReminderScheduler,
  stop: stopReminderScheduler,
};
