import express from 'express';
import { userClient, supabaseAdmin } from '../lib/supabase.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/env.js';

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
      .select(`
        workspace_id,
        role,
        workspaces!inner(id, name, type)
      `)
      .eq('user_id', req.user.id);
    
    if (membershipsError) throw membershipsError;
    
    const workspaces = memberships.map(m => ({
      id: m.workspaces.id,
      name: m.workspaces.name,
      type: m.workspaces.type,
      role: m.role,
    }));
    
    // Find personal workspace
    const personalWorkspace = workspaces.find(w => w.type === 'personal');
    
    res.json({
      profile: {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        avatarPath: profile.avatar_path,
        timezone: profile.timezone,
        language: profile.language,
        theme: profile.theme,
        createdAt: profile.created_at,
      },
      workspaces,
      personalWorkspaceId: personalWorkspace?.id || null,
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
  avatarPath: z.string().optional(),
  timezone: z.string().optional(),
  language: z.enum(['en', 'es', 'fr', 'zh', 'ko']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});

router.patch('/', validate(updateProfileSchema), async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);
    
    const updates = {};
    if (req.body.fullName !== undefined) updates.full_name = req.body.fullName;
    if (req.body.avatarPath !== undefined) updates.avatar_path = req.body.avatarPath;
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
        avatarPath: data.avatar_path,
        timezone: data.timezone,
        language: data.language,
        theme: data.theme,
        createdAt: data.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /me/avatar-upload-url
 * Generate signed URL for avatar upload
 */
const avatarUploadSchema = z.object({
  mimeType: z.string().regex(/^image\/(jpeg|jpg|png|gif|webp)$/),
  sizeBytes: z.number().max(5 * 1024 * 1024), // 5 MB max
});

router.post('/avatar-upload-url', validate(avatarUploadSchema), async (req, res, next) => {
  try {
    const { mimeType, sizeBytes } = req.body;
    const userId = req.user.id;
    
    // Determine file extension
    const ext = mimeType.split('/')[1];
    const fileName = `avatar-${Date.now()}.${ext}`;
    const filePath = `avatars/${userId}/${fileName}`;
    
    // Generate signed upload URL (60 seconds)
    const { data, error } = await supabaseAdmin.storage
      .from('planpal-files')
      .createSignedUploadUrl(filePath);
    
    if (error) {
      logger.error('Failed to create signed upload URL', error);
      throw new AppError(ErrorCodes.UPSTREAM_ERROR, 'Failed to generate upload URL');
    }
    
    res.json({
      uploadUrl: data.signedUrl,
      path: filePath,
      token: data.token,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /me/avatar
 * Remove avatar
 */
router.delete('/avatar', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);
    
    // Get current avatar path
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('avatar_path')
      .eq('id', req.user.id)
      .single();
    
    if (fetchError) throw fetchError;
    
    // Remove from storage if exists
    if (profile.avatar_path) {
      const { error: deleteError } = await supabaseAdmin.storage
        .from('planpal-files')
        .remove([profile.avatar_path]);
      
      if (deleteError) {
        logger.warn('Failed to delete avatar from storage', deleteError);
      }
    }
    
    // Clear avatar_path in profile
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_path: null })
      .eq('id', req.user.id);
    
    if (updateError) throw updateError;
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
