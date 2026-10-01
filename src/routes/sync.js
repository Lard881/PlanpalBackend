import express from 'express';
import { z } from 'zod';
import { validate } from '../lib/validation.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const syncPullSchema = z.object({
  query: z.object({
    workspace_id: z.string().uuid().optional(),
    device_id: z.string().min(1).max(255),
    entity_types: z.string().optional(), // Comma-separated: tasks,projects,labels
    since: z.string().datetime().optional(), // ISO 8601 timestamp
  }),
});

const syncPushSchema = z.object({
  body: z.object({
    workspace_id: z.string().uuid().optional(),
    device_id: z.string().min(1).max(255),
    changes: z.array(z.object({
      entity_type: z.enum(['task', 'project', 'label', 'task_label', 'comment', 'attachment', 'link']),
      entity_id: z.string().uuid(),
      operation: z.enum(['insert', 'update', 'delete']),
      data: z.record(z.any()).optional(), // Entity data for insert/update
      client_updated_at: z.string().datetime(), // When client made this change
      version: z.number().int().optional(), // Optional version for optimistic locking
    })).max(500), // Limit batch size
    conflict_resolution: z.enum(['server_wins', 'client_wins', 'fail_on_conflict']).default('server_wins'),
  }),
});

const syncStatusSchema = z.object({
  query: z.object({
    workspace_id: z.string().uuid().optional(),
    device_id: z.string().min(1).max(255),
    entity_type: z.string().optional(),
  }),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get changes for a specific entity type since last sync
 */
async function getEntityChanges(supabase, entityType, workspaceId, since, userId) {
  const tableName = entityType === 'task_label' ? 'task_labels' : `${entityType}s`;
  
  let query = supabase
    .from(tableName)
    .select('*')
    .eq('workspace_id', workspaceId);
  
  // Filter by updated_at if since timestamp provided
  if (since) {
    query = query.gt('updated_at', since);
  }
  
  // For soft-deleted entities, include deleted_at
  const { data, error } = await query;
  
  if (error) throw error;
  
  // Mark deleted items
  return (data || []).map(item => ({
    id: item.id,
    data: item,
    operation: item.deleted_at ? 'delete' : (since ? 'update' : 'insert'),
    updated_at: item.updated_at || item.created_at,
  }));
}

/**
 * Get last sync timestamp for a device/entity
 */
async function getLastSyncTime(supabase, userId, workspaceId, deviceId, entityType) {
  const { data, error } = await supabase
    .from('sync_metadata')
    .select('last_sync_at')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .eq('device_id', deviceId)
    .eq('entity_type', entityType)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  
  return data?.last_sync_at || null;
}

/**
 * Update sync metadata after successful sync
 */
async function updateSyncMetadata(supabase, userId, workspaceId, deviceId, entityType, status = 'success') {
  const { data, error } = await supabase.rpc('upsert_sync_metadata', {
    p_user_id: userId,
    p_workspace_id: workspaceId,
    p_device_id: deviceId,
    p_entity_type: entityType,
    p_sync_status: status,
    p_metadata: {},
  });
  
  if (error) throw error;
  return data;
}

/**
 * Detect and resolve conflicts
 */
async function resolveConflict(supabase, change, serverData, strategy, userId, workspaceId, deviceId) {
  // No server data = no conflict (new or already deleted)
  if (!serverData) {
    return { resolved: change.data, strategy: 'no_conflict' };
  }
  
  const serverUpdatedAt = new Date(serverData.updated_at || serverData.created_at);
  const clientUpdatedAt = new Date(change.client_updated_at);
  
  // Check if there's actually a conflict (server changed after client's base version)
  const hasConflict = serverUpdatedAt > clientUpdatedAt;
  
  if (!hasConflict) {
    return { resolved: change.data, strategy: 'no_conflict' };
  }
  
  let resolvedData;
  let resolutionStrategy;
  
  switch (strategy) {
    case 'server_wins':
      resolvedData = serverData;
      resolutionStrategy = 'server_wins';
      break;
      
    case 'client_wins':
      resolvedData = { ...serverData, ...change.data, updated_at: new Date().toISOString() };
      resolutionStrategy = 'client_wins';
      break;
      
    case 'fail_on_conflict':
      throw new AppError(
        `Conflict detected for ${change.entity_type} ${change.entity_id}`,
        409,
        'SYNC_CONFLICT',
        { serverData, clientData: change.data }
      );
      
    default:
      resolvedData = serverData;
      resolutionStrategy = 'server_wins';
  }
  
  // Log conflict
  await supabase.rpc('log_sync_conflict', {
    p_user_id: userId,
    p_workspace_id: workspaceId,
    p_device_id: deviceId,
    p_entity_type: change.entity_type,
    p_entity_id: change.entity_id,
    p_conflict_type: 'update_conflict',
    p_resolution_strategy: resolutionStrategy,
    p_server_data: serverData,
    p_client_data: change.data,
    p_resolved_data: resolvedData,
    p_metadata: { client_updated_at: change.client_updated_at },
  });
  
  return { resolved: resolvedData, strategy: resolutionStrategy };
}

/**
 * Apply a single change to the database
 */
async function applyChange(supabase, change, conflictResolution, userId, workspaceId, deviceId) {
  const tableName = change.entity_type === 'task_label' ? 'task_labels' : `${change.entity_type}s`;
  
  try {
    switch (change.operation) {
      case 'insert': {
        const { data, error } = await supabase
          .from(tableName)
          .insert({ ...change.data, id: change.entity_id })
          .select()
          .single();
        
        if (error) {
          // Handle duplicate key (entity already exists)
          if (error.code === '23505') {
            return { success: false, conflict: true, error: 'Entity already exists' };
          }
          throw error;
        }
        
        return { success: true, data };
      }
      
      case 'update': {
        // Get current server state
        const { data: serverData } = await supabase
          .from(tableName)
          .select('*')
          .eq('id', change.entity_id)
          .single();
        
        // Resolve conflict if needed
        const resolution = await resolveConflict(
          supabase,
          change,
          serverData,
          conflictResolution,
          userId,
          workspaceId,
          deviceId
        );
        
        if (resolution.strategy === 'server_wins' && serverData) {
          // Server wins - don't update, return server data
          return { success: true, data: serverData, conflict: true, resolution: 'server_wins' };
        }
        
        // Client wins or no conflict - apply update
        const { data, error } = await supabase
          .from(tableName)
          .update(change.data)
          .eq('id', change.entity_id)
          .select()
          .single();
        
        if (error) throw error;
        
        return {
          success: true,
          data,
          conflict: resolution.strategy !== 'no_conflict',
          resolution: resolution.strategy,
        };
      }
      
      case 'delete': {
        // Soft delete (set deleted_at) if column exists, otherwise hard delete
        const { data: checkData } = await supabase
          .from(tableName)
          .select('deleted_at')
          .eq('id', change.entity_id)
          .single();
        
        if (!checkData) {
          return { success: true, alreadyDeleted: true };
        }
        
        // Check if table has deleted_at column
        const hasDeletedAt = 'deleted_at' in (checkData || {});
        
        if (hasDeletedAt) {
          const { error } = await supabase
            .from(tableName)
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', change.entity_id);
          
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from(tableName)
            .delete()
            .eq('id', change.entity_id);
          
          if (error) throw error;
        }
        
        return { success: true };
      }
      
      default:
        throw new AppError(`Invalid operation: ${change.operation}`, 400, 'INVALID_OPERATION');
    }
  } catch (error) {
    logger.error('Error applying change', { change, error: error.message });
    return { success: false, error: error.message };
  }
}

// ============================================================================
// GET /sync/pull - Pull changes from server
// ============================================================================
/**
 * Pull changes from server since last sync
 * Returns all changes (inserts, updates, deletes) for specified entity types
 */
router.get('/pull', validate(syncPullSchema), async (req, res, next) => {
  try {
    const { workspace_id, device_id, entity_types, since } = req.query;
    const workspaceId = workspace_id || req.workspaceId;
    const userId = req.userId;
    
    // Parse entity types (default to all if not specified)
    const types = entity_types 
      ? entity_types.split(',').filter(Boolean)
      : ['task', 'project', 'label', 'task_label', 'comment', 'attachment', 'link'];
    
    const changes = {};
    const syncTimestamps = {};
    
    // Get changes for each entity type
    for (const entityType of types) {
      // Get last sync time for this entity type
      const lastSync = since || await getLastSyncTime(
        req.supabase,
        userId,
        workspaceId,
        device_id,
        entityType
      );
      
      syncTimestamps[entityType] = lastSync;
      
      // Fetch changes since last sync
      const entityChanges = await getEntityChanges(
        req.supabase,
        entityType,
        workspaceId,
        lastSync,
        userId
      );
      
      changes[entityType] = entityChanges;
    }
    
    // Update sync metadata for all types
    for (const entityType of types) {
      await updateSyncMetadata(
        req.supabase,
        userId,
        workspaceId,
        device_id,
        entityType,
        'success'
      );
    }
    
    res.json({
      changes,
      sync_timestamps: syncTimestamps,
      server_timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /sync/push - Push local changes to server
// ============================================================================
/**
 * Push local changes to server with conflict resolution
 * Processes a batch of changes and returns results for each
 */
router.post('/push', validate(syncPushSchema), async (req, res, next) => {
  try {
    const { workspace_id, device_id, changes, conflict_resolution } = req.body;
    const workspaceId = workspace_id || req.workspaceId;
    const userId = req.userId;
    
    const results = [];
    const conflicts = [];
    let successCount = 0;
    let failureCount = 0;
    
    // Process each change
    for (const change of changes) {
      const result = await applyChange(
        req.supabase,
        change,
        conflict_resolution,
        userId,
        workspaceId,
        device_id
      );
      
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
      
      if (result.conflict) {
        conflicts.push({
          entity_type: change.entity_type,
          entity_id: change.entity_id,
          resolution: result.resolution,
        });
      }
      
      results.push({
        entity_type: change.entity_type,
        entity_id: change.entity_id,
        operation: change.operation,
        success: result.success,
        conflict: result.conflict || false,
        resolution: result.resolution,
        data: result.data,
        error: result.error,
      });
    }
    
    // Update sync metadata for affected entity types
    const entityTypes = [...new Set(changes.map(c => c.entity_type))];
    for (const entityType of entityTypes) {
      const status = failureCount > 0 ? 'partial' : 'success';
      await updateSyncMetadata(
        req.supabase,
        userId,
        workspaceId,
        device_id,
        entityType,
        status
      );
    }
    
    res.json({
      success: failureCount === 0,
      processed: changes.length,
      successful: successCount,
      failed: failureCount,
      conflicts: conflicts.length,
      results,
      server_timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /sync/status - Get sync status for device
// ============================================================================
/**
 * Get sync status and last sync times for a device
 */
router.get('/status', validate(syncStatusSchema), async (req, res, next) => {
  try {
    const { workspace_id, device_id, entity_type } = req.query;
    const workspaceId = workspace_id || req.workspaceId;
    const userId = req.userId;
    
    let query = req.supabase
      .from('sync_metadata')
      .select('*')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .eq('device_id', device_id);
    
    if (entity_type) {
      query = query.eq('entity_type', entity_type);
    }
    
    const { data: metadata, error } = await query;
    
    if (error) throw error;
    
    res.json({
      device_id,
      workspace_id: workspaceId,
      sync_metadata: metadata || [],
      server_timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /sync/conflicts - Get sync conflicts for debugging
// ============================================================================
/**
 * Get recent sync conflicts for a device
 */
router.get('/conflicts', async (req, res, next) => {
  try {
    const { workspace_id, device_id, limit = 50 } = req.query;
    const workspaceId = workspace_id || req.workspaceId;
    const userId = req.userId;
    
    let query = req.supabase
      .from('sync_conflicts')
      .select('*')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId);
    
    if (device_id) {
      query = query.eq('device_id', device_id);
    }
    
    query = query
      .order('created_at', { ascending: false })
      .limit(parseInt(limit, 10));
    
    const { data: conflicts, error } = await query;
    
    if (error) throw error;
    
    res.json({
      conflicts: conflicts || [],
      count: conflicts?.length || 0,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /sync/reset - Reset sync state for device (debug/testing)
// ============================================================================
/**
 * Reset sync metadata for a device (useful for testing or troubleshooting)
 */
router.post('/reset', async (req, res, next) => {
  try {
    const { workspace_id, device_id, entity_type } = req.body;
    const workspaceId = workspace_id || req.workspaceId;
    const userId = req.userId;
    
    let query = req.supabase
      .from('sync_metadata')
      .delete()
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .eq('device_id', device_id);
    
    if (entity_type) {
      query = query.eq('entity_type', entity_type);
    }
    
    const { error } = await query;
    
    if (error) throw error;
    
    res.json({
      success: true,
      message: 'Sync metadata reset successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
