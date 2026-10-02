import express from 'express';
import { adminClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validation.js';
import { z } from 'zod';
import logger from '../lib/logger.js';

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// Validation schemas
const registerTokenSchema = z.object({
  body: z.object({
    token: z.string().min(10, 'Token must be at least 10 characters'),
    platform: z.enum(['android', 'ios', 'windows', 'macos'], {
      errorMap: () => ({ message: 'Platform must be android, ios, windows, or macos' }),
    }),
  }),
});

const removeTokenSchema = z.object({
  body: z.object({
    token: z.string().min(10, 'Token must be at least 10 characters'),
  }),
});

/**
 * POST /device-tokens
 * Register a device token for push notifications
 */
router.post(
  '/',
  validateRequest(registerTokenSchema),
  async (req, res, next) => {
    try {
      const userId = req.userId;
      const { token, platform } = req.body;

      // Check if token already exists
      const { data: existing } = await adminClient
        .from('device_tokens')
        .select('*')
        .eq('token', token)
        .single();

      if (existing) {
        // Token exists - update user_id and platform if needed
        if (existing.user_id !== userId || existing.platform !== platform) {
          const { data: updated, error } = await adminClient
            .from('device_tokens')
            .update({
              user_id: userId,
              platform: platform,
              updated_at: new Date().toISOString(),
            })
            .eq('token', token)
            .select()
            .single();

          if (error) throw error;

          logger.info(`Device token updated for user ${userId}: ${token.substring(0, 10)}...`);
          return res.json({
            device_token: updated,
            message: 'Device token updated',
          });
        }

        // Token exists and belongs to same user - just update timestamp
        const { data: updated, error } = await adminClient
          .from('device_tokens')
          .update({ updated_at: new Date().toISOString() })
          .eq('token', token)
          .select()
          .single();

        if (error) throw error;

        logger.info(`Device token refreshed for user ${userId}: ${token.substring(0, 10)}...`);
        return res.json({
          device_token: updated,
          message: 'Device token refreshed',
        });
      }

      // Create new token
      const { data: created, error } = await adminClient
        .from('device_tokens')
        .insert({
          user_id: userId,
          token: token,
          platform: platform,
        })
        .select()
        .single();

      if (error) {
        // Handle unique constraint violation (race condition)
        if (error.code === '23505') {
          return res.status(409).json({
            error: {
              code: 'TOKEN_ALREADY_EXISTS',
              message: 'This device token is already registered',
            },
          });
        }
        throw error;
      }

      logger.info(`Device token registered for user ${userId}: ${token.substring(0, 10)}...`);
      res.status(201).json({
        device_token: created,
        message: 'Device token registered',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /device-tokens
 * Get all device tokens for the current user
 */
router.get('/', async (req, res, next) => {
  try {
    const userId = req.userId;

    const { data: tokens, error } = await adminClient
      .from('device_tokens')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    res.json({
      device_tokens: tokens,
      count: tokens.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /device-tokens
 * Remove a device token (on logout or token invalidation)
 */
router.delete(
  '/',
  validateRequest(removeTokenSchema),
  async (req, res, next) => {
    try {
      const userId = req.userId;
      const { token } = req.body;

      // Delete token with ownership check
      const { error } = await adminClient
        .from('device_tokens')
        .delete()
        .eq('token', token)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info(`Device token removed for user ${userId}: ${token.substring(0, 10)}...`);
      res.json({
        success: true,
        message: 'Device token removed',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /device-tokens/all
 * Remove all device tokens for the current user (on sign out everywhere)
 */
router.delete('/all', async (req, res, next) => {
  try {
    const userId = req.userId;

    const { data: deleted, error } = await adminClient
      .from('device_tokens')
      .delete()
      .eq('user_id', userId)
      .select('id');

    if (error) throw error;

    logger.info(`All device tokens removed for user ${userId}, count: ${deleted.length}`);
    res.json({
      success: true,
      count: deleted.length,
      message: `Removed ${deleted.length} device tokens`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /device-tokens/cleanup-invalid
 * Internal: Remove invalid tokens (called by push worker after failed sends)
 * This endpoint can be protected with an internal API key in production
 */
router.post('/cleanup-invalid', async (req, res, next) => {
  try {
    const { tokens } = req.body;

    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'tokens must be a non-empty array',
        },
      });
    }

    // Delete invalid tokens
    const { data: deleted, error } = await adminClient
      .from('device_tokens')
      .delete()
      .in('token', tokens)
      .select('id');

    if (error) throw error;

    logger.info(`Cleaned up ${deleted.length} invalid device tokens`);
    res.json({
      success: true,
      count: deleted.length,
      message: `Cleaned up ${deleted.length} invalid tokens`,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
