import express from 'express';
import { userClient, supabaseAdmin } from '../lib/supabase.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

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
        avatarUrl: profile.avatar_url,
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
  avatarUrl: z.string().optional(),
  timezone: z.string().optional(),
  language: z.enum(['en', 'es', 'fr', 'zh', 'ko']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});

router.patch('/', validate(updateProfileSchema), async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);
    
    const updates = {};
    if (req.body.fullName !== undefined) updates.full_name = req.body.fullName;
    if (req.body.avatarUrl !== undefined) updates.avatar_url = req.body.avatarUrl;
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
});

router.post('/avatar-upload-url', validate(avatarUploadSchema), async (req, res, next) => {
  try {
    const { mimeType } = req.body;
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
    
    // Get current avatar url
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', req.user.id)
      .single();
    
    if (fetchError) throw fetchError;
    
    // Remove from storage if exists
    if (profile.avatar_url) {
      const { error: deleteError } = await supabaseAdmin.storage
        .from('planpal-files')
        .remove([profile.avatar_url]);
      
      if (deleteError) {
        logger.warn('Failed to delete avatar from storage', deleteError);
      }
    }
    
    // Clear avatar_url in profile
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: null })
      .eq('id', req.user.id);
    
    if (updateError) throw updateError;
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /me
 * Delete user account
 */
const deleteAccountSchema = z.object({
  password: z.string().min(1).optional(),
  confirmDelete: z.literal(true),
});

router.delete('/', validate(deleteAccountSchema), async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);
    
    // Check if user is the only admin of any team with other members
    const { data: memberships } = await supabase
      .from('workspace_members')
      .select('workspace_id, role, workspaces!inner(id, type)')
      .eq('user_id', req.user.id);
    
    for (const membership of memberships || []) {
      if (membership.role === 'admin' && membership.workspaces.type === 'team') {
        // Count admins in this workspace
        const { data: admins } = await supabase
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', membership.workspace_id)
          .eq('role', 'admin');
        
        // Count total members
        const { count: totalMembers } = await supabase
          .from('workspace_members')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', membership.workspace_id);
        
        if (admins.length === 1 && totalMembers > 1) {
          throw new AppError(
            ErrorCodes.TRANSFER_ADMIN_FIRST,
            'You are the only admin of a team with other members. Transfer admin role before deleting account.',
            409
          );
        }
      }
    }
    
    // Get personal workspace
    const personalWorkspace = memberships?.find(m => m.workspaces.type === 'personal');
    
    // Soft delete profile
    await supabase
      .from('profiles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.user.id);
    
    // Remove from team workspaces
    await supabase
      .from('workspace_members')
      .delete()
      .eq('user_id', req.user.id)
      .neq('workspace_id', personalWorkspace?.workspace_id);
    
    // Delete personal workspace and its files
    if (personalWorkspace) {
      // Delete all files in workspace storage
      const { data: files } = await supabase
        .from('files')
        .select('path')
        .eq('workspace_id', personalWorkspace.workspace_id);
      
      if (files && files.length > 0) {
        const paths = files.map(f => f.path);
        await supabaseAdmin.storage
          .from('planpal-files')
          .remove(paths);
      }
      
      // Soft delete workspace
      await supabase
        .from('workspaces')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', personalWorkspace.workspace_id);
    }
    
    // Delete auth user with admin client
    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(req.user.id);
    
    if (deleteAuthError) {
      logger.error('Failed to delete auth user', deleteAuthError);
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Failed to complete account deletion');
    }
    
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
