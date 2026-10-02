import express from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { validate } from '../lib/validation.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

// ============================================================================
// Validation schemas
// ============================================================================

const createInviteSchema = z.object({
  workspace_id: z.string().uuid(),
  max_uses: z.number().int().min(1).max(100).optional().nullable(),
  expires_at: z.string().datetime().optional().nullable(),
});

// ============================================================================
// Helper: Generate unique invite code
// ============================================================================

async function generateUniqueCode(supabase, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    // Generate 8-character alphanumeric code
    const code = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 8);

    // Check if code already exists
    const { data: existing } = await supabase
      .from('invite_codes')
      .select('id')
      .eq('code', code)
      .single();

    if (!existing) {
      return code;
    }
  }

  throw new AppError('SERVER_ERROR', 'Failed to generate unique invite code', 500);
}

// ============================================================================
// GET /invites - List invite codes for workspace
// ============================================================================

router.get('/', async (req, res, next) => {
  try {
    const { workspace_id } = req.query;

    if (!workspace_id) {
      throw new AppError('VALIDATION_FAILED', 'workspace_id is required', 400);
    }

    const { data: invites, error } = await req.supabase
      .from('invite_codes')
      .select(`
        id,
        code,
        uses,
        max_uses,
        expires_at,
        revoked_at,
        created_at,
        created_by:profiles!invite_codes_created_by_fkey(id, name)
      `)
      .eq('workspace_id', workspace_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ invites: invites || [] });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /invites - Create new invite code
// ============================================================================

router.post('/', validate(createInviteSchema), async (req, res, next) => {
  try {
    const { workspace_id, max_uses, expires_at } = req.body;

    // Generate unique code
    const code = await generateUniqueCode(req.supabase);

    // Create invite code (RLS will check admin permission)
    const { data: invite, error } = await req.supabase
      .from('invite_codes')
      .insert({
        workspace_id,
        code,
        max_uses,
        expires_at,
        created_by: req.userId,
      })
      .select()
      .single();

    if (error) throw error;

    logger.info(`Invite code created: ${code} for workspace ${workspace_id}`);

    res.status(201).json({ invite });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DELETE /invites/:id - Revoke invite code
// ============================================================================

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Mark as revoked (RLS will check admin permission)
    const { error } = await req.supabase
      .from('invite_codes')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;

    logger.info(`Invite code revoked: ${id}`);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
