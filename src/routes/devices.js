import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { validate } from '../middleware/validate.js';

const router = express.Router();

const registerDeviceSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['android', 'ios', 'web']),
});

/**
 * POST /devices
 * Register FCM device token
 */
router.post('/', validate(registerDeviceSchema), async (req, res, next) => {
  try {
    const { token, platform } = req.body;
    const supabase = userClient(req.jwt);

    // Upsert device token
    const { data: device, error } = await supabase
      .from('device_tokens')
      .upsert({
        user_id: req.user.id,
        token,
        platform,
      }, {
        onConflict: 'token',
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ device });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /devices/:token
 * Unregister device token (on logout)
 */
router.delete('/:token', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);

    const { error } = await supabase
      .from('device_tokens')
      .delete()
      .eq('token', req.params.token)
      .eq('user_id', req.user.id);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
