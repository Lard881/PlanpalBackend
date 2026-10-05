import express from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

/**
 * GET /health
 * Health check endpoint - no auth, no database
 * Used by uptime monitors
 */
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/db
 * Database health check - no auth, tests database connection
 * Used by uptime monitors to keep Supabase project active
 */
router.get('/db', async (req, res) => {
  try {
    // Alternative: direct SQL query
    const { error: dbError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .limit(1);
    
    if (dbError) {
      logger.error('Database health check failed', dbError);
      return res.status(503).json({
        status: 'error',
        message: 'Database unavailable',
      });
    }
    
    res.json({
      status: 'ok',
      database: 'connected',
    });
  } catch (error) {
    logger.error('Database health check error', error);
    res.status(503).json({
      status: 'error',
      message: 'Database unavailable',
    });
  }
});

export default router;
