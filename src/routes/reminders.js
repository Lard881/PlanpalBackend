import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  processReminders,
  checkDeadlineReminders,
  checkOverdueTasks,
  checkEventReminders,
} from '../workers/reminder-scheduler.js';
import logger from '../lib/logger.js';

const router = express.Router();

/**
 * POST /reminders/process
 * Manually trigger all reminder checks
 * For testing and manual intervention
 */
router.post('/process', requireAuth, async (req, res, next) => {
  try {
    logger.info(`Manual reminder processing triggered by user ${req.userId}`);

    const result = await processReminders();

    res.json({
      ...result,
      message: `Checked ${result.totals.checked} items, created ${result.totals.notified} notifications`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /reminders/check-deadlines
 * Manually trigger deadline reminder checks only
 */
router.post('/check-deadlines', requireAuth, async (req, res, next) => {
  try {
    logger.info(`Manual deadline check triggered by user ${req.userId}`);

    const result = await checkDeadlineReminders();

    res.json({
      success: true,
      ...result,
      message: `Checked ${result.checked} tasks, created ${result.notified} notifications`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /reminders/check-overdue
 * Manually trigger overdue task checks only
 */
router.post('/check-overdue', requireAuth, async (req, res, next) => {
  try {
    logger.info(`Manual overdue check triggered by user ${req.userId}`);

    const result = await checkOverdueTasks();

    res.json({
      success: true,
      ...result,
      message: `Checked ${result.checked} tasks, created ${result.notified} notifications`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /reminders/check-events
 * Manually trigger event reminder checks only
 */
router.post('/check-events', requireAuth, async (req, res, next) => {
  try {
    logger.info(`Manual event reminder check triggered by user ${req.userId}`);

    const result = await checkEventReminders();

    res.json({
      success: true,
      ...result,
      message: `Checked ${result.checked} events, created ${result.notified} notifications`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /reminders/status
 * Get reminder worker status
 */
router.get('/status', requireAuth, async (req, res) => {
  res.json({
    status: 'operational',
    message: 'Reminder worker is running',
    info: {
      deadline: 'Checks tasks due in 24 hours and 1 hour',
      overdue: 'Checks tasks that became overdue in the last hour',
      events: 'Checks events starting in 1 hour, 30 minutes, and 15 minutes',
      schedule: 'Runs automatically every 5 minutes',
      deduplication: 'Uses dedupe_key to prevent duplicate notifications',
    },
  });
});

export default router;
