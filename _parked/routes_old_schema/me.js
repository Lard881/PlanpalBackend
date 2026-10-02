import express from 'express';
import { userClient } from '../lib/supabase.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';

const router = express.Router();

/**
 * GET /me
 * Get current user profile with workspaces
 */
router.get('/', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);
    
    // Get profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();
    
    if (profileError) throw profileError;
    
    // Get workspaces with role
    const { data: memberships, error: membershipsError } = await supabase
      .from('workspace_members')
      .select('workspace_id, role, workspaces!inner(id, name, type)')
      .eq('user_id', req.user.id);
    
    if (membershipsError) throw membershipsError;
    
    const workspaces = memberships.map(m => ({
      id: m.workspaces.id,
      name: m.workspaces.name,
      type: m.workspaces.type,
      role: m.role,
    }));
    
    res.json({
      profile: {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        avatarUrl: profile.avatar_url,
        timezone: profile.timezone,
        language: profile.language,
        theme: profile.theme,
        personalWorkspaceId: profile.personal_workspace_id,
        createdAt: profile.created_at,
      },
      workspaces,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /me
 * Update profile
 */
const updateProfileSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  timezone: z.string().optional(),
  language: z.enum(['en', 'es', 'fr', 'zh', 'ko']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});

router.patch('/', validate(updateProfileSchema), async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);
    
    const updates = {};
    if (req.body.fullName !== undefined) updates.full_name = req.body.fullName;
    if (req.body.timezone !== undefined) updates.timezone = req.body.timezone;
    if (req.body.language !== undefined) updates.language = req.body.language;
    if (req.body.theme !== undefined) updates.theme = req.body.theme;
    
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({
      profile: {
        id: data.id,
        email: data.email,
        fullName: data.full_name,
        avatarUrl: data.avatar_url,
        timezone: data.timezone,
        language: data.language,
        theme: data.theme,
        personalWorkspaceId: data.personal_workspace_id,
        createdAt: data.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
