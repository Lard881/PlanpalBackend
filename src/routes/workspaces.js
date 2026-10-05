import express from 'express';
import { z } from 'zod';
import { userClient } from '../lib/supabase.js';
import { AppError, ErrorCodes } from '../lib/errors.js';
import { loadWorkspace, requireRole } from '../middleware/workspace.js';
import { validate } from '../middleware/validate.js';
import { generateInviteCode, normalizeInviteCode } from '../lib/codes.js';

const router = express.Router();

// Validation schemas
const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
});

const joinWorkspaceSchema = z.object({
  code: z.string().length(8),
});

const updateMemberSchema = z.object({
  role: z.enum(['admin', 'full', 'guest']),
});

const createInviteSchema = z.object({
  role: z.enum(['admin', 'full', 'guest']),
  maxUses: z.number().int().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
});

/**
 * GET /workspaces
 * List user's workspaces
 */
router.get('/', async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);
    
    const { data: memberships, error } = await supabase
      .from('workspace_members')
      .select(`
        workspace_id,
        role,
        workspaces!inner(
          id,
          name,
          type,
          created_at
        )
      `)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false, foreignTable: 'workspaces' });
    
    if (error) throw error;
    
    const workspaces = memberships.map(m => ({
      id: m.workspaces.id,
      name: m.workspaces.name,
      type: m.workspaces.type,
      role: m.role,
      createdAt: m.workspaces.created_at,
    }));
    
    res.json({ workspaces });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /workspaces
 * Create a new team workspace
 */
router.post('/', validate(createWorkspaceSchema), async (req, res, next) => {
  try {
    const { name } = req.body;
    const supabase = userClient(req.jwt);
    
    // Create workspace (trigger will add creator as admin and create #general channel)
    const { data: workspace, error } = await supabase
      .from('workspaces')
      .insert({
        name,
        type: 'team',
        owner_id: req.user.id,
      })
      .select()
      .single();
    
    if (error) throw error;
    
    res.status(201).json({ workspace });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /workspaces/:workspaceId
 * Get workspace details with counts
 */
router.get('/:workspaceId', loadWorkspace, async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);
    
    // Get workspace details
    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('id, name, type, created_at')
      .eq('id', req.params.workspaceId)
      .single();
    
    if (wsError) throw wsError;
    
    // Get counts in parallel
    const [
      { count: memberCount },
      { count: taskCount },
      { count: completedTaskCount },
    ] = await Promise.all([
      supabase
        .from('workspace_members')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', req.params.workspaceId),
      supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', req.params.workspaceId)
        .is('deleted_at', null),
      supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', req.params.workspaceId)
        .eq('status', 'completed')
        .is('deleted_at', null),
    ]);
    
    res.json({
      workspace: {
        ...workspace,
        role: req.workspace.role,
        counts: {
          members: memberCount || 0,
          tasks: taskCount || 0,
          completedTasks: completedTaskCount || 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /workspaces/:workspaceId
 * Update workspace (admins only)
 */
router.patch(
  '/:workspaceId',
  loadWorkspace,
  requireRole('admin'),
  validate(updateWorkspaceSchema),
  async (req, res, next) => {
    try {
      // Cannot rename personal workspace
      if (req.workspace.type === 'personal') {
        throw new AppError(
          ErrorCodes.FORBIDDEN,
          'Cannot rename personal workspace',
          403
        );
      }
      
      const { name } = req.body;
      const supabase = userClient(req.jwt);
      
      const { data: workspace, error } = await supabase
        .from('workspaces')
        .update({ name })
        .eq('id', req.params.workspaceId)
        .select()
        .single();
      
      if (error) throw error;
      
      res.json({ workspace });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /workspaces/:workspaceId
 * Soft delete workspace (admins only, team workspaces only)
 */
router.delete(
  '/:workspaceId',
  loadWorkspace,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      // Cannot delete personal workspace
      if (req.workspace.type === 'personal') {
        throw new AppError(
          ErrorCodes.FORBIDDEN,
          'Cannot delete personal workspace',
          403
        );
      }
      
      const supabase = userClient(req.jwt);
      
      const { error } = await supabase
        .from('workspaces')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', req.params.workspaceId);
      
      if (error) throw error;
      
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /workspaces/join
 * Join workspace with invite code
 */
router.post('/join', validate(joinWorkspaceSchema), async (req, res, next) => {
  try {
    const code = normalizeInviteCode(req.body.code);
    const supabase = userClient(req.jwt);
    
    // Call the join_workspace function
    const { data, error } = await supabase.rpc('join_workspace', {
      p_code: code,
    });
    
    if (error) {
      // Map Postgres error messages to specific codes
      if (error.message?.includes('INVALID_CODE')) {
        throw new AppError(ErrorCodes.INVALID_CODE, 'Invalid invite code', 400);
      }
      if (error.message?.includes('CODE_EXPIRED')) {
        throw new AppError(ErrorCodes.CODE_EXPIRED, 'Invite code has expired', 400);
      }
      if (error.message?.includes('CODE_REVOKED')) {
        throw new AppError(ErrorCodes.CODE_REVOKED, 'Invite code has been revoked', 400);
      }
      if (error.message?.includes('CODE_USED_UP')) {
        throw new AppError(ErrorCodes.CODE_USED_UP, 'Invite code has reached maximum uses', 400);
      }
      if (error.message?.includes('ALREADY_MEMBER')) {
        throw new AppError(ErrorCodes.ALREADY_MEMBER, 'Already a member of this workspace', 400);
      }
      throw error;
    }
    
    // Get the workspace details
    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('id, name, type, created_at')
      .eq('id', data)
      .single();
    
    if (wsError) throw wsError;
    
    res.json({ workspace });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /workspaces/:workspaceId/members
 * List workspace members (guests see only themselves and admins)
 */
router.get('/:workspaceId/members', loadWorkspace, async (req, res, next) => {
  try {
    const supabase = userClient(req.jwt);
    
    // RLS will filter for guests
    const { data: members, error } = await supabase
      .from('workspace_members')
      .select(`
        user_id,
        role,
        joined_at,
        profiles!inner(
          id,
          full_name,
          email,
          avatar_url
        )
      `)
      .eq('workspace_id', req.params.workspaceId)
      .order('joined_at', { ascending: true });
    
    if (error) throw error;
    
    const formatted = members.map(m => ({
      userId: m.user_id,
      role: m.role,
      joinedAt: m.joined_at,
      fullName: m.profiles.full_name,
      email: m.profiles.email,
      avatarUrl: m.profiles.avatar_url,
    }));
    
    res.json({ members: formatted });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /workspaces/:workspaceId/members/:userId
 * Update member role (admins only)
 */
router.patch(
  '/:workspaceId/members/:userId',
  loadWorkspace,
  requireRole('admin'),
  validate(updateMemberSchema),
  async (req, res, next) => {
    try {
      const { role } = req.body;
      const supabase = userClient(req.jwt);
      
      const { data: member, error } = await supabase
        .from('workspace_members')
        .update({ role })
        .eq('workspace_id', req.params.workspaceId)
        .eq('user_id', req.params.userId)
        .select()
        .single();
      
      if (error) {
        // Check for LAST_ADMIN protection trigger
        if (error.message?.includes('last admin')) {
          throw new AppError(
            ErrorCodes.LAST_ADMIN,
            'Cannot demote the last admin',
            403
          );
        }
        throw error;
      }
      
      res.json({ member });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /workspaces/:workspaceId/members/:userId
 * Remove member or leave workspace
 */
router.delete(
  '/:workspaceId/members/:userId',
  loadWorkspace,
  async (req, res, next) => {
    try {
      const targetUserId = req.params.userId;
      const isSelf = targetUserId === req.user.id;
      
      // Personal workspace: cannot remove self or others
      if (req.workspace.type === 'personal') {
        throw new AppError(
          ErrorCodes.FORBIDDEN,
          'Cannot leave or remove members from personal workspace',
          403
        );
      }
      
      // Check permission: admin can remove anyone, anyone can remove themselves
      if (!isSelf && req.workspace.role !== 'admin') {
        throw new AppError(
          ErrorCodes.FORBIDDEN,
          'Only admins can remove other members',
          403
        );
      }
      
      const supabase = userClient(req.jwt);
      
      const { error } = await supabase
        .from('workspace_members')
        .delete()
        .eq('workspace_id', req.params.workspaceId)
        .eq('user_id', targetUserId);
      
      if (error) {
        // Check for LAST_ADMIN protection trigger
        if (error.message?.includes('last admin')) {
          throw new AppError(
            ErrorCodes.LAST_ADMIN,
            'Cannot remove the last admin',
            403
          );
        }
        throw error;
      }
      
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /workspaces/:workspaceId/invites
 * List invite codes (admins only)
 */
router.get(
  '/:workspaceId/invites',
  loadWorkspace,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const supabase = userClient(req.jwt);
      
      const { data: invites, error } = await supabase
        .from('invite_codes')
        .select('*')
        .eq('workspace_id', req.params.workspaceId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      res.json({ invites });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /workspaces/:workspaceId/invites
 * Create invite code (admins only)
 */
router.post(
  '/:workspaceId/invites',
  loadWorkspace,
  requireRole('admin'),
  validate(createInviteSchema),
  async (req, res, next) => {
    try {
      const { role, maxUses, expiresAt } = req.body;
      const supabase = userClient(req.jwt);
      
      // Generate code with collision retry
      let attempts = 0;
      let invite = null;
      
      while (attempts < 5) {
        const code = generateInviteCode();
        
        const { data, error } = await supabase
          .from('invite_codes')
          .insert({
            workspace_id: req.params.workspaceId,
            code,
            role,
            created_by: req.user.id,
            max_uses: maxUses || null,
            expires_at: expiresAt || null,
          })
          .select()
          .single();
        
        if (!error) {
          invite = data;
          break;
        }
        
        // Check if it's a duplicate code error
        if (error.code === '23505') {
          attempts++;
          continue;
        }
        
        // Other error
        throw error;
      }
      
      if (!invite) {
        throw new AppError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to generate unique invite code',
          500
        );
      }
      
      res.status(201).json({ invite });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /workspaces/:workspaceId/invites/:inviteId
 * Revoke invite code (admins only)
 */
router.delete(
  '/:workspaceId/invites/:inviteId',
  loadWorkspace,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const supabase = userClient(req.jwt);
      
      const { error } = await supabase
        .from('invite_codes')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', req.params.inviteId)
        .eq('workspace_id', req.params.workspaceId);
      
      if (error) throw error;
      
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
