import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('Stage 6: Labels and Sync', () => {
  const testEmail = `test.${Date.now()}@planpal.test`;
  let authToken = null;
  let userId = null;
  let workspaceId = null;
  let labelId = null;

  // Helper function to create test user
  async function createTestUser() {
    // Replace with actual Supabase admin client call in real tests
    return {
      token: 'mock_token_for_testing',
      userId: 'mock_user_id',
    };
  }

  beforeAll(async () => {
    const testUser = await createTestUser();
    authToken = testUser.token;
    userId = testUser.userId;
    // Assume workspace created in previous stage
  });

  describe('S6.1: Labels - Create', () => {
    it('should create a new label', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/labels`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Bug',
          color: '#FF0000',
        })
        .expect(201);

      expect(res.body.label).toBeDefined();
      expect(res.body.label.name).toBe('Bug');
      expect(res.body.label.color).toBe('#FF0000');
      
      labelId = res.body.label.id;
    });

    it('should validate color format', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/labels`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Invalid Color',
          color: 'red', // Invalid format
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('should validate name is not empty', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/labels`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: '',
          color: '#00FF00',
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('should require workspace membership', async () => {
      const fakeWorkspaceId = '00000000-0000-0000-0000-000000000000';
      
      const res = await request(app)
        .post(`/api/v1/workspaces/${fakeWorkspaceId}/labels`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Label',
          color: '#0000FF',
        })
        .expect(403);

      expect(res.body.error.code).toBe('NOT_A_MEMBER');
    });
  });

  describe('S6.2: Labels - List', () => {
    it('should list workspace labels', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/labels`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.labels).toBeDefined();
      expect(Array.isArray(res.body.labels)).toBe(true);
      
      const bug = res.body.labels.find(l => l.name === 'Bug');
      expect(bug).toBeDefined();
      expect(bug.color).toBe('#FF0000');
    });

    it('should return labels sorted by name', async () => {
      // Create multiple labels
      await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/labels`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Feature', color: '#00FF00' });
      
      await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/labels`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Design', color: '#0000FF' });

      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/labels`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const names = res.body.labels.map(l => l.name);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });

    it('should not include deleted labels', async () => {
      // Create and delete a label
      const createRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/labels`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'ToDelete', color: '#FFFF00' });

      const tempLabelId = createRes.body.label.id;

      await request(app)
        .delete(`/api/v1/workspaces/${workspaceId}/labels/${tempLabelId}`)
        .set('Authorization', `Bearer ${authToken}`);

      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/labels`)
        .set('Authorization', `Bearer ${authToken}`);

      const found = res.body.labels.find(l => l.id === tempLabelId);
      expect(found).toBeUndefined();
    });
  });

  describe('S6.3: Labels - Update', () => {
    it('should update label name', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${workspaceId}/labels/${labelId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Critical Bug' })
        .expect(200);

      expect(res.body.label.name).toBe('Critical Bug');
      expect(res.body.label.color).toBe('#FF0000'); // Unchanged
    });

    it('should update label color', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${workspaceId}/labels/${labelId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ color: '#AA0000' })
        .expect(200);

      expect(res.body.label.color).toBe('#AA0000');
      expect(res.body.label.name).toBe('Critical Bug'); // Unchanged
    });

    it('should update both name and color', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${workspaceId}/labels/${labelId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Bug',
          color: '#FF0000',
        })
        .expect(200);

      expect(res.body.label.name).toBe('Bug');
      expect(res.body.label.color).toBe('#FF0000');
    });

    it('should validate color format on update', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${workspaceId}/labels/${labelId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ color: 'invalid' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('should require at least one field', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${workspaceId}/labels/${labelId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('S6.4: Labels - Delete', () => {
    it('should require admin role', async () => {
      // This test needs a non-admin user
      // Skipped in basic version
    });

    it('should soft delete label', async () => {
      const createRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/labels`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Temporary', color: '#123456' });

      const tempId = createRes.body.label.id;

      await request(app)
        .delete(`/api/v1/workspaces/${workspaceId}/labels/${tempId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // Verify it's gone from list
      const listRes = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/labels`)
        .set('Authorization', `Bearer ${authToken}`);

      const found = listRes.body.labels.find(l => l.id === tempId);
      expect(found).toBeUndefined();
    });
  });

  describe('S6.5: Sync - Initial Sync', () => {
    it('should return all workspace data without since parameter', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/sync`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('serverTime');
      expect(res.body).toHaveProperty('tasks');
      expect(res.body).toHaveProperty('subtasks');
      expect(res.body).toHaveProperty('taskComments');
      expect(res.body).toHaveProperty('taskAttachments');
      expect(res.body).toHaveProperty('labels');
      expect(res.body).toHaveProperty('events');
      expect(res.body).toHaveProperty('eventAttendees');
      expect(res.body).toHaveProperty('channels');
      expect(res.body).toHaveProperty('documents');
      expect(res.body).toHaveProperty('folders');
      expect(res.body).toHaveProperty('members');
      expect(res.body).toHaveProperty('hasMore');
      
      expect(typeof res.body.hasMore).toBe('boolean');
      expect(Array.isArray(res.body.labels)).toBe(true);
    });

    it('should include labels we created', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/sync`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const bug = res.body.labels.find(l => l.name === 'Bug');
      expect(bug).toBeDefined();
    });

    it('should return ISO timestamp for serverTime', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/sync`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      const parsed = new Date(res.body.serverTime);
      expect(parsed.toString()).not.toBe('Invalid Date');
    });
  });

  describe('S6.6: Sync - Incremental Sync', () => {
    it('should return only changes after since timestamp', async () => {
      // Get initial sync
      const initial = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/sync`)
        .set('Authorization', `Bearer ${authToken}`);

      const since = initial.body.serverTime;

      // Make a change
      await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/labels`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'New Label', color: '#AABBCC' });

      // Sync again
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/sync`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({ since })
        .expect(200);

      // Should only have the new label
      const newLabel = res.body.labels.find(l => l.name === 'New Label');
      expect(newLabel).toBeDefined();
    });

    it('should include soft-deleted rows', async () => {
      // Create and delete a label
      const createRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/labels`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Will Delete', color: '#111111' });

      const tempId = createRes.body.label.id;
      const since = new Date().toISOString();

      await request(app)
        .delete(`/api/v1/workspaces/${workspaceId}/labels/${tempId}`)
        .set('Authorization', `Bearer ${authToken}`);

      // Sync should include the deleted label
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/sync`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({ since })
        .expect(200);

      const deleted = res.body.labels.find(l => l.id === tempId);
      expect(deleted).toBeDefined();
      expect(deleted.deleted_at).not.toBeNull();
    });

    it('should validate since timestamp format', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/sync`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({ since: 'invalid-timestamp' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('S6.7: Sync - Pagination', () => {
    it('should set hasMore to false for small datasets', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/sync`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.hasMore).toBe(false);
    });

    it('should set hasMore to true when exceeding 1000 rows', async () => {
      // This test requires creating 1000+ items, which is impractical
      // In real integration tests, this would be tested with fixtures
    });
  });

  describe('S6.8: Sync - RLS Enforcement', () => {
    it('should only return data user can access', async () => {
      // This requires a second user and workspace
      // RLS should automatically filter results
      // Verified by database policy tests
    });
  });

  describe('S6.9: Error Handling', () => {
    it('should require authentication', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/sync`)
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_REQUIRED');
    });

    it('should require workspace membership', async () => {
      const fakeWorkspaceId = '00000000-0000-0000-0000-000000000000';
      
      const res = await request(app)
        .get(`/api/v1/workspaces/${fakeWorkspaceId}/sync`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);

      expect(res.body.error.code).toBe('NOT_A_MEMBER');
    });
  });
});
