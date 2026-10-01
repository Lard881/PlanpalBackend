import express from 'express';
import { z } from 'zod';
import { validate } from '../lib/validation.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

// ============================================================================
// Validation schemas
// ============================================================================

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
});

const joinWorkspaceSchema = z.object({
  code: z.string().length(8),
});

const memberRoleSchema = z.object({
  role: z.enum(['admin', 'member', 'guest']),
});

// ============================================================================
// GET /workspaces - List user's workspaces
// ============================================================================

router.get('/', async (req, res, next) => {
  try {
    const { data: memberships, error } = await req.supabase
      .from('workspace_members')
      .select(`
        id,
        role,
        workspace:workspaces(
          id,
          name,
          description,
          is_personal,
          created_at
        )
      `)
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const workspaces = memberships.map(m => ({
      ...m.workspace,
      role: m.role,
      membership_id: m.id,
    }));

    res.json({ workspaces });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /workspaces - Create a new workspace
// ============================================================================

router.post('/', validate(createWorkspaceSchema), async (req, res, next) => {
  try {
    const { name, description } = req.body;

    // Create workspace
    const { data: workspace, error: workspaceError } = await req.supabase
      .from('workspaces')
      .insert({
        name,
        description,
        is_personal: false,
        created_by: req.userId,
      })
      .select()
      .single();

    if (workspaceError) throw workspaceError;

    logger.info(`Workspace created: ${workspace.id} by user ${req.userId}`);

    res.status(201).json({ workspace });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /workspaces/:id - Get workspace details
// ============================================================================

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Get workspace with member count
    const { data: workspace, error } = await req.supabase
      .from('workspaces')
      .select(`
        *,
        members:workspace_members(count)
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new AppError('NOT_FOUND', 'Workspace not found', 404);
      }
      throw error;
    }

    // Get user's role in this workspace
    const { data: membership } = await req.supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', id)
      .eq('user_id', req.userId)
      .single();

    workspace.member_count = workspace.members[0]?.count || 0;
    workspace.role = membership?.role;
    delete workspace.members;

    res.json({ workspace });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PATCH /workspaces/:id - Update workspace
// ============================================================================

router.patch('/:id', validate(updateWorkspaceSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check if workspace is personal
    const { data: workspace } = await req.supabase
      .from('workspaces')
      .select('is_personal')
      .eq('id', id)
      .single();

    if (workspace?.is_personal) {
      throw new AppError(
        'PERSONAL_WORKSPACE',
        'Cannot modify Personal workspace',
        400
      );
    }

    // Update workspace (RLS will check admin permission)
    const { data: updated, error } = await req.supabase
      .from('workspaces')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    logger.info(`Workspace updated: ${id}`);

    res.json({ workspace: updated });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DELETE /workspaces/:id - Delete workspace
// ============================================================================

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if workspace is personal
    const { data: workspace } = await req.supabase
      .from('workspaces')
      .select('is_personal')
      .eq('id', id)
      .single();

    if (workspace?.is_personal) {
      throw new AppError(
        'PERSONAL_WORKSPACE',
        'Cannot delete Personal workspace',
        400
      );
    }

    // Check if workspace has content
    const { count: taskCount } = await req.supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', id);

    if (taskCount > 0) {
      throw new AppError(
        'WORKSPACE_NOT_EMPTY',
        `Workspace has ${taskCount} tasks. Delete or move them first.`,
        400
      );
    }

    // Delete workspace (RLS will check admin permission)
    const { error } = await req.supabase
      .from('workspaces')
      .delete()
      .eq('id', id);

    if (error) throw error;

    logger.info(`Workspace deleted: ${id}`);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /workspaces/join - Join workspace with invite code
// ============================================================================

router.post('/join', validate(joinWorkspaceSchema), async (req, res, next) => {
  try {
    const { code } = req.body;

    // Find invite code
    const { data: invite, error: inviteError } = await req.supabase
      .from('invite_codes')
      .select('*, workspace:workspaces(*)')
      .eq('code', code)
      .single();

    if (inviteError || !invite) {
      throw new AppError('INVALID_CODE', 'Invalid or expired invite code', 400);
    }

    // Check if code is revoked
    if (invite.revoked_at) {
      throw new AppError('CODE_REVOKED', 'This invite code has been revoked', 400);
    }

    // Check if code is expired
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      throw new AppError('CODE_EXPIRED', 'This invite code has expired', 400);
    }

    // Check if max uses reached
    if (invite.max_uses && invite.uses >= invite.max_uses) {
      throw new AppError('CODE_USED_UP', 'This invite code has reached its maximum uses', 400);
    }

    // Check if already a member
    const { data: existingMember } = await req.supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', invite.workspace_id)
      .eq('user_id', req.userId)
      .single();

    if (existingMember) {
      throw new AppError('ALREADY_MEMBER', 'You are already a member of this workspace', 400);
    }

    // Add user as member
    const { data: membership, error: memberError } = await req.supabase
      .from('workspace_members')
      .insert({
        workspace_id: invite.workspace_id,
        user_id: req.userId,
        role: 'member', // Default role for invited users
      })
      .select('*, workspace:workspaces(*)')
      .single();

    if (memberError) throw memberError;

    // Increment invite code usage
    await req.supabase
      .from('invite_codes')
      .update({ uses: invite.uses + 1 })
      .eq('id', invite.id);

    logger.info(`User ${req.userId} joined workspace ${invite.workspace_id} via invite code`);

    res.status(201).json({ 
      workspace: membership.workspace,
      membership 
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /workspaces/:id/members - List workspace members
// ============================================================================

router.get('/:id/members', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: members, error } = await req.supabase
      .from('workspace_members')
      .select(`
        id,
        role,
        joined_at,
        user:profiles(
          id,
          name,
          email,
          avatar_url
        )
      `)
      .eq('workspace_id', id)
      .order('joined_at', { ascending: true });

    if (error) throw error;

    res.json({ members: members || [] });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PATCH /workspaces/:id/members/:memberId/role - Change member role
// ============================================================================

router.patch('/:id/members/:memberId/role', validate(memberRoleSchema), async (req, res, next) => {
  try {
    const { id: workspaceId, memberId } = req.params;
    const { role } = req.body;

    // Get member info
    const { data: member } = await req.supabase
      .from('workspace_members')
      .select('user_id, role')
      .eq('id', memberId)
      .eq('workspace_id', workspaceId)
      .single();

    if (!member) {
      throw new AppError('NOT_FOUND', 'Member not found', 404);
    }

    // Cannot change role in personal workspace
    const { data: workspace } = await req.supabase
      .from('workspaces')
      .select('is_personal')
      .eq('id', workspaceId)
      .single();

    if (workspace?.is_personal) {
      throw new AppError('PERSONAL_WORKSPACE', 'Cannot change roles in Personal workspace', 400);
    }

    // Check if this is the last admin
    if (member.role === 'admin' && role !== 'admin') {
      const { count } = await req.supabase
        .from('workspace_members')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('role', 'admin');

      if (count <= 1) {
        throw new AppError('LAST_ADMIN', 'Cannot remove the last admin', 400);
      }
    }

    // Update role (RLS will check admin permission)
    const { data: updated, error } = await req.supabase
      .from('workspace_members')
      .update({ role })
      .eq('id', memberId)
      .select()
      .single();

    if (error) throw error;

    logger.info(`Member ${memberId} role changed to ${role} in workspace ${workspaceId}`);

    res.json({ member: updated });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DELETE /workspaces/:id/members/:memberId - Remove member
// ============================================================================

router.delete('/:id/members/:memberId', async (req, res, next) => {
  try {
    const { id: workspaceId, memberId } = req.params;

    // Get member info
    const { data: member } = await req.supabase
      .from('workspace_members')
      .select('role')
      .eq('id', memberId)
      .eq('workspace_id', workspaceId)
      .single();

    if (!member) {
      throw new AppError('NOT_FOUND', 'Member not found', 404);
    }

    // Check if this is the last admin
    if (member.role === 'admin') {
      const { count } = await req.supabase
        .from('workspace_members')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('role', 'admin');

      if (count <= 1) {
        throw new AppError('LAST_ADMIN', 'Cannot remove the last admin', 400);
      }
    }

    // Remove member (RLS will check admin permission)
    const { error } = await req.supabase
      .from('workspace_members')
      .delete()
      .eq('id', memberId);

    if (error) throw error;

    logger.info(`Member ${memberId} removed from workspace ${workspaceId}`);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /workspaces/:id/leave - Leave workspace
// ============================================================================

router.post('/:id/leave', async (req, res, next) => {
  try {
    const { id: workspaceId } = req.params;

    // Cannot leave personal workspace
    const { data: workspace } = await req.supabase
      .from('workspaces')
      .select('is_personal')
      .eq('id', workspaceId)
      .single();

    if (workspace?.is_personal) {
      throw new AppError('PERSONAL_WORKSPACE', 'Cannot leave Personal workspace', 400);
    }

    // Get user's membership
    const { data: membership } = await req.supabase
      .from('workspace_members')
      .select('id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', req.userId)
      .single();

    if (!membership) {
      throw new AppError('NOT_A_MEMBER', 'You are not a member of this workspace', 400);
    }

    // Check if last admin
    if (membership.role === 'admin') {
      const { count } = await req.supabase
        .from('workspace_members')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('role', 'admin');

      if (count <= 1) {
        throw new AppError('LAST_ADMIN', 'Cannot leave as the last admin. Transfer admin rights first.', 400);
      }
    }

    // Remove membership
    const { error } = await req.supabase
      .from('workspace_members')
      .delete()
      .eq('id', membership.id);

    if (error) throw error;

    logger.info(`User ${req.userId} left workspace ${workspaceId}`);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
