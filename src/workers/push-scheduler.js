import { processPushQueue } from '../lib/push-worker.js';
import logger from '../lib/logger.js';

/**
 * Push notification scheduler
 * Runs every minute to process pending push notifications
 */

let isRunning = false;
let intervalId = null;

async function runPushWorker() {
  if (isRunning) {
    logger.debug('Push worker already running, skipping this cycle');
    return;
  }

  isRunning = true;

  try {
    await processPushQueue();
  } catch (error) {
    logger.error('Push worker error:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Start the push scheduler
 * @param {number} intervalMinutes - Interval in minutes (default: 1)
 */
export function startPushScheduler(intervalMinutes = 1) {
  if (intervalId) {
    logger.warn('Push scheduler already running');
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;

  logger.info(`Starting push scheduler (interval: ${intervalMinutes} minute(s))`);

  // Run immediately on start
  runPushWorker();

  // Then run at intervals
  intervalId = setInterval(runPushWorker, intervalMs);

  logger.info('Push scheduler started successfully');
}

/**
 * Stop the push scheduler
 */
export function stopPushScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Push scheduler stopped');
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, stopping push scheduler');
  stopPushScheduler();
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, stopping push scheduler');
  stopPushScheduler();
});

export default {
  start: startPushScheduler,
  stop: stopPushScheduler,
};
