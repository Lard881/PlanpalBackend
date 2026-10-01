import { userClient } from '../lib/supabase.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

/**
 * Workspace membership middleware
 * Loads user's role in the workspace
 */
export async function loadWorkspace(req, res, next) {
  try {
    const workspaceId = req.params.workspaceId;
    
    if (!workspaceId) {
      return next();
    }
    
    const supabase = userClient(req.jwt);
    
    // Load membership through user client (RLS applies)
    const { data: membership, error } = await supabase
      .from('workspace_members')
      .select('workspace_id, role, workspaces!inner(id, type)')
      .eq('workspace_id', workspaceId)
      .eq('user_id', req.user.id)
      .single();
    
    if (error || !membership) {
      throw new AppError(
        ErrorCodes.NOT_A_MEMBER,
        'Not a member of this workspace',
        403
      );
    }
    
    req.workspace = {
      id: membership.workspace_id,
      type: membership.workspaces.type,
      role: membership.role,
    };
    
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Require specific role
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.workspace) {
      return next(
        new AppError(ErrorCodes.FORBIDDEN, 'Workspace context required', 403)
      );
    }
    
    if (!allowedRoles.includes(req.workspace.role)) {
      return next(
        new AppError(
          ErrorCodes.FORBIDDEN,
          `Requires one of: ${allowedRoles.join(', ')}`,
          403
        )
      );
    }
    
    next();
  };
}
