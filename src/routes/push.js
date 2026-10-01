import express from 'express';
import { processPushQueue } from '../lib/push-worker.js';
import { requireAuth } from '../middleware/auth.js';
import logger from '../lib/logger.js';

const router = express.Router();

/**
 * POST /push/process
 * Manually trigger push notification processing
 * For testing and manual intervention
 * In production, this should be protected with an internal API key
 */
router.post('/process', requireAuth, async (req, res, next) => {
  try {
    logger.info(`Manual push processing triggered by user ${req.userId}`);

    const result = await processPushQueue();

    res.json({
      success: true,
      ...result,
      message: `Processed ${result.processed} notifications, sent ${result.sent} pushes`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /push/status
 * Get push worker status
 */
router.get('/status', requireAuth, async (req, res) => {
  res.json({
    status: 'operational',
    message: 'Push worker is running',
    info: 'Notifications are processed automatically every minute',
  });
});

export default router;
