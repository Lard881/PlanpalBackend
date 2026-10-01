import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { createApp } from '../src/app.js';
import { supabase, supabaseAdmin } from '../src/lib/supabase.js';

const app = createApp();

describe('Sync API', () => {
  let authToken;
  let userId;
  let workspaceId;
  const deviceId = 'test-device-12345';
  let testTaskId;
  let testProjectId;

  beforeAll(async () => {
    // Create test user
    const email = `sync-test-${Date.now()}@example.com`;
    const password = 'TestPassword123!';
    
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });
    
    if (signUpError) throw signUpError;
    
    authToken = authData.session.access_token;
    userId = authData.user.id;
    
    // Create workspace
    const { data: workspace } = await supabaseAdmin
      .from('workspaces')
      .insert({
        name: 'Sync Test Workspace',
        created_by: userId,
      })
      .select()
      .single();
    
    workspaceId = workspace.id;
    
    // Add user to workspace
    await supabaseAdmin
      .from('workspace_members')
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        role: 'admin',
      });
  });

  afterAll(async () => {
    // Cleanup
    if (workspaceId) {
      await supabaseAdmin.from('workspaces').delete().eq('id', workspaceId);
    }
    if (userId) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
    }
  });

  beforeEach(async () => {
    // Reset sync metadata before each test
    await supabaseAdmin
      .from('sync_metadata')
      .delete()
      .eq('device_id', deviceId);
    
    await supabaseAdmin
      .from('sync_conflicts')
      .delete()
      .eq('device_id', deviceId);
  });

  // ============================================================================
  // GET /sync/pull - Pull Changes
  // ============================================================================

  describe('GET /sync/pull', () => {
    beforeEach(async () => {
      // Create test task
      const { data: task } = await supabaseAdmin
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'Test Task for Sync',
          created_by: userId,
        })
        .select()
        .single();
      
      testTaskId = task.id;
      
      // Create test project
      const { data: project } = await supabaseAdmin
        .from('projects')
        .insert({
          workspace_id: workspaceId,
          name: 'Test Project for Sync',
          created_by: userId,
        })
        .select()
        .single();
      
      testProjectId = project.id;
    });

    it('should pull all changes for initial sync', async () => {
      const res = await request(app)
        .get('/api/v1/sync/pull')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
          entity_types: 'task,project',
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('changes');
      expect(res.body).toHaveProperty('sync_timestamps');
      expect(res.body).toHaveProperty('server_timestamp');
      
      expect(res.body.changes).toHaveProperty('task');
      expect(res.body.changes).toHaveProperty('project');
      
      expect(res.body.changes.task.length).toBeGreaterThan(0);
      expect(res.body.changes.project.length).toBeGreaterThan(0);
      
      // Verify task data
      const taskChange = res.body.changes.task.find(c => c.id === testTaskId);
      expect(taskChange).toBeDefined();
      expect(taskChange.data.title).toBe('Test Task for Sync');
      expect(taskChange.operation).toBe('insert');
    });

    it('should pull only changes since last sync', async () => {
      // First sync
      await request(app)
        .get('/api/v1/sync/pull')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
          entity_types: 'task',
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Create new task after first sync
      const { data: newTask } = await supabaseAdmin
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'New Task After Sync',
          created_by: userId,
        })
        .select()
        .single();
      
      // Second sync - should only get new task
      const res = await request(app)
        .get('/api/v1/sync/pull')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
          entity_types: 'task',
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(res.body.changes.task.length).toBeGreaterThanOrEqual(1);
      
      const newTaskChange = res.body.changes.task.find(c => c.id === newTask.id);
      expect(newTaskChange).toBeDefined();
      expect(newTaskChange.data.title).toBe('New Task After Sync');
    });

    it('should pull with custom since timestamp', async () => {
      const sinceTimestamp = new Date(Date.now() - 1000 * 60).toISOString(); // 1 minute ago
      
      const res = await request(app)
        .get('/api/v1/sync/pull')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
          entity_types: 'task',
          since: sinceTimestamp,
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.changes).toHaveProperty('task');
      expect(res.body.sync_timestamps.task).toBe(sinceTimestamp);
    });

    it('should include deleted entities', async () => {
      // Soft delete task
      await supabaseAdmin
        .from('tasks')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', testTaskId);
      
      const res = await request(app)
        .get('/api/v1/sync/pull')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
          entity_types: 'task',
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const deletedTask = res.body.changes.task.find(c => c.id === testTaskId);
      expect(deletedTask).toBeDefined();
      expect(deletedTask.operation).toBe('delete');
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/v1/sync/pull')
        .query({ device_id: deviceId })
        .expect(401);
    });
  });

  // ============================================================================
  // POST /sync/push - Push Changes
  // ============================================================================

  describe('POST /sync/push', () => {
    it('should push insert operation', async () => {
      const newTaskId = '00000000-0000-0000-0000-000000000001';
      
      const res = await request(app)
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          device_id: deviceId,
          conflict_resolution: 'server_wins',
          changes: [{
            entity_type: 'task',
            entity_id: newTaskId,
            operation: 'insert',
            data: {
              workspace_id: workspaceId,
              title: 'New Task from Client',
              status: 'todo',
              created_by: userId,
            },
            client_updated_at: new Date().toISOString(),
          }],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.processed).toBe(1);
      expect(res.body.successful).toBe(1);
      expect(res.body.failed).toBe(0);
      
      const result = res.body.results[0];
      expect(result.success).toBe(true);
      expect(result.conflict).toBe(false);
      expect(result.data.title).toBe('New Task from Client');
      
      // Verify task was created
      const { data: task } = await supabaseAdmin
        .from('tasks')
        .select('*')
        .eq('id', newTaskId)
        .single();
      
      expect(task).toBeDefined();
      expect(task.title).toBe('New Task from Client');
    });

    it('should push update operation', async () => {
      // Create task
      const { data: task } = await supabaseAdmin
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'Original Title',
          created_by: userId,
        })
        .select()
        .single();
      
      // Push update
      const res = await request(app)
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          device_id: deviceId,
          conflict_resolution: 'server_wins',
          changes: [{
            entity_type: 'task',
            entity_id: task.id,
            operation: 'update',
            data: {
              title: 'Updated Title',
              status: 'in_progress',
            },
            client_updated_at: new Date().toISOString(),
          }],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      const result = res.body.results[0];
      expect(result.success).toBe(true);
      expect(result.data.title).toBe('Updated Title');
      expect(result.data.status).toBe('in_progress');
      
      // Verify update
      const { data: updatedTask } = await supabaseAdmin
        .from('tasks')
        .select('*')
        .eq('id', task.id)
        .single();
      
      expect(updatedTask.title).toBe('Updated Title');
      expect(updatedTask.status).toBe('in_progress');
    });

    it('should push delete operation', async () => {
      // Create task
      const { data: task } = await supabaseAdmin
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'Task to Delete',
          created_by: userId,
        })
        .select()
        .single();
      
      // Push delete
      const res = await request(app)
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          device_id: deviceId,
          conflict_resolution: 'server_wins',
          changes: [{
            entity_type: 'task',
            entity_id: task.id,
            operation: 'delete',
            client_updated_at: new Date().toISOString(),
          }],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      const result = res.body.results[0];
      expect(result.success).toBe(true);
      
      // Verify soft delete
      const { data: deletedTask } = await supabaseAdmin
        .from('tasks')
        .select('*')
        .eq('id', task.id)
        .single();
      
      expect(deletedTask.deleted_at).not.toBeNull();
    });

    it('should handle conflicts with server_wins strategy', async () => {
      // Create task
      const { data: task } = await supabaseAdmin
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'Original Title',
          created_by: userId,
        })
        .select()
        .single();
      
      // Wait to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Update on server (simulating another device)
      await supabaseAdmin
        .from('tasks')
        .update({ title: 'Server Update' })
        .eq('id', task.id);
      
      // Push client update (conflict!)
      const res = await request(app)
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          device_id: deviceId,
          conflict_resolution: 'server_wins',
          changes: [{
            entity_type: 'task',
            entity_id: task.id,
            operation: 'update',
            data: {
              title: 'Client Update',
            },
            client_updated_at: task.created_at, // Old timestamp = conflict
          }],
        })
        .expect(200);

      expect(res.body.conflicts).toBeGreaterThan(0);
      
      const result = res.body.results[0];
      expect(result.conflict).toBe(true);
      expect(result.resolution).toBe('server_wins');
      expect(result.data.title).toBe('Server Update'); // Server wins
      
      // Verify server data unchanged
      const { data: finalTask } = await supabaseAdmin
        .from('tasks')
        .select('*')
        .eq('id', task.id)
        .single();
      
      expect(finalTask.title).toBe('Server Update');
    });

    it('should handle conflicts with client_wins strategy', async () => {
      // Create task
      const { data: task } = await supabaseAdmin
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'Original Title',
          created_by: userId,
        })
        .select()
        .single();
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Update on server
      await supabaseAdmin
        .from('tasks')
        .update({ title: 'Server Update' })
        .eq('id', task.id);
      
      // Push client update with client_wins
      const res = await request(app)
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          device_id: deviceId,
          conflict_resolution: 'client_wins',
          changes: [{
            entity_type: 'task',
            entity_id: task.id,
            operation: 'update',
            data: {
              title: 'Client Update',
            },
            client_updated_at: task.created_at,
          }],
        })
        .expect(200);

      expect(res.body.conflicts).toBeGreaterThan(0);
      
      const result = res.body.results[0];
      expect(result.conflict).toBe(true);
      expect(result.resolution).toBe('client_wins');
      expect(result.data.title).toBe('Client Update'); // Client wins
      
      // Verify client data applied
      const { data: finalTask } = await supabaseAdmin
        .from('tasks')
        .select('*')
        .eq('id', task.id)
        .single();
      
      expect(finalTask.title).toBe('Client Update');
    });

    it('should handle batch of mixed operations', async () => {
      const newTaskId = '00000000-0000-0000-0000-000000000002';
      
      // Create existing task for update
      const { data: existingTask } = await supabaseAdmin
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'Existing Task',
          created_by: userId,
        })
        .select()
        .single();
      
      // Push batch: insert, update, delete
      const res = await request(app)
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          device_id: deviceId,
          conflict_resolution: 'server_wins',
          changes: [
            {
              entity_type: 'task',
              entity_id: newTaskId,
              operation: 'insert',
              data: {
                workspace_id: workspaceId,
                title: 'Inserted Task',
                created_by: userId,
              },
              client_updated_at: new Date().toISOString(),
            },
            {
              entity_type: 'task',
              entity_id: existingTask.id,
              operation: 'update',
              data: {
                title: 'Updated Task',
              },
              client_updated_at: new Date().toISOString(),
            },
          ],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.processed).toBe(2);
      expect(res.body.successful).toBe(2);
      expect(res.body.failed).toBe(0);
    });

    it('should validate request body', async () => {
      await request(app)
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          device_id: deviceId,
          changes: [], // Empty changes
        })
        .expect(400);
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/api/v1/sync/push')
        .send({
          device_id: deviceId,
          changes: [],
        })
        .expect(401);
    });
  });

  // ============================================================================
  // GET /sync/status - Get Sync Status
  // ============================================================================

  describe('GET /sync/status', () => {
    it('should return sync status for device', async () => {
      // Perform a sync first
      await request(app)
        .get('/api/v1/sync/pull')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
          entity_types: 'task,project',
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      // Get status
      const res = await request(app)
        .get('/api/v1/sync/status')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('device_id', deviceId);
      expect(res.body).toHaveProperty('workspace_id', workspaceId);
      expect(res.body).toHaveProperty('sync_metadata');
      expect(res.body.sync_metadata.length).toBeGreaterThan(0);
      
      const taskMetadata = res.body.sync_metadata.find(m => m.entity_type === 'task');
      expect(taskMetadata).toBeDefined();
      expect(taskMetadata.last_sync_at).toBeDefined();
      expect(taskMetadata.sync_status).toBe('success');
    });

    it('should filter by entity_type', async () => {
      // Perform sync
      await request(app)
        .get('/api/v1/sync/pull')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
          entity_types: 'task',
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      // Get status for specific entity type
      const res = await request(app)
        .get('/api/v1/sync/status')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
          entity_type: 'task',
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.sync_metadata.length).toBeGreaterThan(0);
      expect(res.body.sync_metadata.every(m => m.entity_type === 'task')).toBe(true);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/v1/sync/status')
        .query({ device_id: deviceId })
        .expect(401);
    });
  });

  // ============================================================================
  // GET /sync/conflicts - Get Conflicts
  // ============================================================================

  describe('GET /sync/conflicts', () => {
    it('should return sync conflicts', async () => {
      // Create a conflict scenario
      const { data: task } = await supabaseAdmin
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'Original',
          created_by: userId,
        })
        .select()
        .single();
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Server update
      await supabaseAdmin
        .from('tasks')
        .update({ title: 'Server Update' })
        .eq('id', task.id);
      
      // Client update (creates conflict)
      await request(app)
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          device_id: deviceId,
          conflict_resolution: 'server_wins',
          changes: [{
            entity_type: 'task',
            entity_id: task.id,
            operation: 'update',
            data: { title: 'Client Update' },
            client_updated_at: task.created_at,
          }],
        });
      
      // Get conflicts
      const res = await request(app)
        .get('/api/v1/sync/conflicts')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('conflicts');
      expect(res.body.conflicts.length).toBeGreaterThan(0);
      
      const conflict = res.body.conflicts[0];
      expect(conflict.entity_type).toBe('task');
      expect(conflict.entity_id).toBe(task.id);
      expect(conflict.resolution_strategy).toBe('server_wins');
      expect(conflict.server_data).toBeDefined();
      expect(conflict.client_data).toBeDefined();
    });

    it('should limit results', async () => {
      const res = await request(app)
        .get('/api/v1/sync/conflicts')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
          limit: 10,
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.conflicts.length).toBeLessThanOrEqual(10);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/v1/sync/conflicts')
        .query({ workspace_id: workspaceId })
        .expect(401);
    });
  });

  // ============================================================================
  // POST /sync/reset - Reset Sync
  // ============================================================================

  describe('POST /sync/reset', () => {
    it('should reset sync metadata for device', async () => {
      // Perform sync first
      await request(app)
        .get('/api/v1/sync/pull')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
          entity_types: 'task',
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      // Verify metadata exists
      let statusRes = await request(app)
        .get('/api/v1/sync/status')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(statusRes.body.sync_metadata.length).toBeGreaterThan(0);
      
      // Reset
      const res = await request(app)
        .post('/api/v1/sync/reset')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          device_id: deviceId,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      
      // Verify metadata cleared
      statusRes = await request(app)
        .get('/api/v1/sync/status')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(statusRes.body.sync_metadata.length).toBe(0);
    });

    it('should reset specific entity type only', async () => {
      // Sync multiple entity types
      await request(app)
        .get('/api/v1/sync/pull')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
          entity_types: 'task,project',
        })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      // Reset only task
      await request(app)
        .post('/api/v1/sync/reset')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          workspace_id: workspaceId,
          device_id: deviceId,
          entity_type: 'task',
        })
        .expect(200);
      
      // Verify only task metadata cleared
      const statusRes = await request(app)
        .get('/api/v1/sync/status')
        .query({
          workspace_id: workspaceId,
          device_id: deviceId,
        })
        .set('Authorization', `Bearer ${authToken}`);
      
      const taskMeta = statusRes.body.sync_metadata.find(m => m.entity_type === 'task');
      const projectMeta = statusRes.body.sync_metadata.find(m => m.entity_type === 'project');
      
      expect(taskMeta).toBeUndefined();
      expect(projectMeta).toBeDefined();
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/api/v1/sync/reset')
        .send({ device_id: deviceId })
        .expect(401);
    });
  });
});
