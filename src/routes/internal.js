import { Router } from 'express';
import crypto from 'crypto';
import { config } from '../config/env.js';
import { generalLimiter } from '../middleware/rateLimit.js';
import { processPushQueue } from '../lib/push-worker.js';

const internalRouter = Router();

internalRouter.use(generalLimiter);

/**
 * POST /internal/push/run
 * Called by pg_cron every 5 minutes via vault secret planpal_cron_secret.
 * Authenticates with X-Cron-Secret header (constant-time compare).
 * No user JWT required — this is a server-to-server call.
 */
internalRouter.post('/push/run', async (req, res) => {
  const requestId = req.id || 'unknown';

  // Reject if Firebase is not configured — don't crash
  if (!config.firebase.serviceAccount) {
    return res.status(200).json({ ok: true, skipped: 'FIREBASE_NOT_CONFIGURED' });
  }

  // Validate cron secret
  const provided = req.headers['x-cron-secret'];
  const expected = config.cron.secret;

  if (!provided || !expected) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret', requestId },
    });
  }

  // Constant-time compare to prevent timing attacks
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const match =
    a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!match) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret', requestId },
    });
  }

  try {
    const result = await processPushQueue();
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message, requestId },
    });
  }
});

export default internalRouter;
