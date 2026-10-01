import express from 'express';

const router = express.Router();

/**
 * GET /health
 * Health check endpoint - no auth, no database
 * Used by uptime monitors
 */
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
  });
});

export default router;
