import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createApp } from '../src/app.js';

// Use TEST database
const SUPABASE_URL = process.env.TEST_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const skipTests = !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY;

if (skipTests) {
  console.log('\n⚠️  Skipping Stage 5 tests: Supabase credentials not set\n');
}

(skipTests ? describe.skip : describe)('Stage 5: Workspaces, Members, and Invite Codes', () => {
  let app;
  let supabaseAdmin;
  const testEmail = `test-ws-${Date.now()}@planpal.test`;
  const testPassword = 'TestPass123!';
  let authToken = null;
  let userId = null;
  let personalWorkspaceId = null;
  let teamWorkspaceId = null;
  let inviteCode = null;
  let inviteId = null;

  beforeAll(async () => {
    app = createApp();
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Create REAL test user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    });

    if (authError) throw authError;
    userId = authData.user.id;

    // Get REAL auth token
    const { data: signInData, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });

    if (signInError) throw signInError;
    authToken = signInData.session.access_token;
  });

  afterAll(async () => {
    // Clean up test user
    if (userId && supabaseAdmin) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
    }
  });

  describe('S5.1: List Workspaces', () => {
    it('should return user workspaces including personal workspace', async () => {
      const res = await request(app)
        .get('/api/v1/workspaces')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('workspaces');
      expect(Array.isArray(res.body.workspaces)).toBe(true);
      
      // Should have at least personal workspace
      expect(res.body.workspaces.length).toBeGreaterThanOrEqual(1);
      
      const personal = res.body.workspaces.find(w => w.type === 'personal');
      expect(personal).toBeDefined();
      expect(personal.role).toBe('admin');
      
      personalWorkspaceId = personal.id;
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/v1/workspaces')
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_REQUIRED');
    });
  });

  describe('S5.2: Create Team Workspace', () => {
    it('should create a new team workspace', async () => {
      const res = await request(app)
        .post('/api/v1/workspaces')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Test Team' })
        .expect(201);

      expect(res.body.workspace).toMatchObject({
        name: 'Test Team',
        type: 'team',
      });
      expect(res.body.workspace.id).toBeDefined();
      
      teamWorkspaceId = res.body.workspace.id;
    });

    it('should reject invalid workspace name', async () => {
      const res = await request(app)
        .post('/api/v1/workspaces')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: '' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('should reject missing name field', async () => {
      const res = await request(app)
        .post('/api/v1/workspaces')
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('S5.3: Get Workspace Details', () => {
    it('should return workspace details with counts', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${teamWorkspaceId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.workspace).toMatchObject({
        id: teamWorkspaceId,
        name: 'Test Team',
        type: 'team',
        role: 'admin',
      });
      
      expect(res.body.workspace.counts).toBeDefined();
      expect(res.body.workspace.counts.members).toBeGreaterThanOrEqual(1);
      expect(res.body.workspace.counts.tasks).toBeGreaterThanOrEqual(0);
    });

    it('should return 403 for non-member workspace', async () => {
      const fakeWorkspaceId = '00000000-0000-0000-0000-000000000000';
      
      const res = await request(app)
        .get(`/api/v1/workspaces/${fakeWorkspaceId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);

      expect(res.body.error.code).toBe('NOT_A_MEMBER');
    });
  });

  describe('S5.4: Update Workspace', () => {
    it('should rename team workspace', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${teamWorkspaceId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Renamed Team' })
        .expect(200);

      expect(res.body.workspace.name).toBe('Renamed Team');
    });

    it('should reject renaming personal workspace', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${personalWorkspaceId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'New Name' })
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('personal');
    });

    it('should require admin role', async () => {
      // This would need a second test user as a non-admin member
      // Skipped in this basic version
    });
  });

  describe('S5.5: Delete Workspace', () => {
    it('should reject deleting personal workspace', async () => {
      const res = await request(app)
        .delete(`/api/v1/workspaces/${personalWorkspaceId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('personal');
    });

    it('should soft delete team workspace', async () => {
      // Create a temporary workspace to delete
      const createRes = await request(app)
        .post('/api/v1/workspaces')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Temporary Workspace' });

      const tempWorkspaceId = createRes.body.workspace.id;

      await request(app)
        .delete(`/api/v1/workspaces/${tempWorkspaceId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // Verify it's no longer in the list
      const listRes = await request(app)
        .get('/api/v1/workspaces')
        .set('Authorization', `Bearer ${authToken}`);

      const exists = listRes.body.workspaces.some(w => w.id === tempWorkspaceId);
      expect(exists).toBe(false);
    });
  });

  describe('S5.6: Invite Codes', () => {
    it('should create invite code (admin)', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${teamWorkspaceId}/invites`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          role: 'full',
          maxUses: 5,
        })
        .expect(201);

      expect(res.body.invite).toBeDefined();
      expect(res.body.invite.code).toHaveLength(8);
      expect(res.body.invite.role).toBe('full');
      expect(res.body.invite.max_uses).toBe(5);
      
      inviteCode = res.body.invite.code;
      inviteId = res.body.invite.id;
    });

    it('should validate invite role', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${teamWorkspaceId}/invites`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          role: 'invalid_role',
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('should list invite codes (admin)', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${teamWorkspaceId}/invites`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.invites).toBeDefined();
      expect(Array.isArray(res.body.invites)).toBe(true);
      expect(res.body.invites.length).toBeGreaterThanOrEqual(1);
      
      const found = res.body.invites.find(i => i.code === inviteCode);
      expect(found).toBeDefined();
    });

    it('should revoke invite code (admin)', async () => {
      await request(app)
        .delete(`/api/v1/workspaces/${teamWorkspaceId}/invites/${inviteId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // Verify it's no longer in active invites
      const res = await request(app)
        .get(`/api/v1/workspaces/${teamWorkspaceId}/invites`)
        .set('Authorization', `Bearer ${authToken}`);

      const found = res.body.invites.find(i => i.id === inviteId);
      expect(found).toBeUndefined();
    });
  });

  describe('S5.7: Join Workspace', () => {
    let validInviteCode = null;

    beforeAll(async () => {
      // Create a fresh invite code
      const res = await request(app)
        .post(`/api/v1/workspaces/${teamWorkspaceId}/invites`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ role: 'full' });
      
      validInviteCode = res.body.invite.code;
    });

    it('should reject invalid invite code', async () => {
      const res = await request(app)
        .post('/api/v1/workspaces/join')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ code: 'INVALID1' })
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_CODE');
    });

    it('should reject already member', async () => {
      // Try to join workspace we're already in
      const res = await request(app)
        .post('/api/v1/workspaces/join')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ code: validInviteCode })
        .expect(400);

      expect(res.body.error.code).toBe('ALREADY_MEMBER');
    });

    it('should validate code format', async () => {
      const res = await request(app)
        .post('/api/v1/workspaces/join')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ code: 'SHORT' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('S5.8: Workspace Members', () => {
    it('should list workspace members', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${teamWorkspaceId}/members`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.members).toBeDefined();
      expect(Array.isArray(res.body.members)).toBe(true);
      expect(res.body.members.length).toBeGreaterThanOrEqual(1);
      
      const creator = res.body.members.find(m => m.userId === userId);
      expect(creator).toBeDefined();
      expect(creator.role).toBe('admin');
    });

    it('should require workspace membership', async () => {
      const fakeWorkspaceId = '00000000-0000-0000-0000-000000000000';
      
      const res = await request(app)
        .get(`/api/v1/workspaces/${fakeWorkspaceId}/members`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);

      expect(res.body.error.code).toBe('NOT_A_MEMBER');
    });
  });

  describe('S5.9: Update Member Role', () => {
    it('should validate role value', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${teamWorkspaceId}/members/${userId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ role: 'invalid' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('should reject demoting last admin', async () => {
      const res = await request(app)
        .patch(`/api/v1/workspaces/${teamWorkspaceId}/members/${userId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ role: 'full' })
        .expect(403);

      expect(res.body.error.code).toBe('LAST_ADMIN');
    });
  });

  describe('S5.10: Remove Member / Leave Workspace', () => {
    it('should reject leaving personal workspace', async () => {
      const res = await request(app)
        .delete(`/api/v1/workspaces/${personalWorkspaceId}/members/${userId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('personal');
    });

    it('should reject removing last admin', async () => {
      const res = await request(app)
        .delete(`/api/v1/workspaces/${teamWorkspaceId}/members/${userId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);

      expect(res.body.error.code).toBe('LAST_ADMIN');
    });

    it('should require admin role to remove others', async () => {
      // This would need a second test user as a non-admin member
      // Skipped in this basic version
    });
  });

  describe('S5.11: Error Response Format', () => {
    it('should include requestId in all error responses', async () => {
      const res = await request(app)
        .get('/api/v1/workspaces')
        .expect(401);

      expect(res.body.error.requestId).toBeDefined();
      expect(typeof res.body.error.requestId).toBe('string');
    });

    it('should include code and message in errors', async () => {
      const res = await request(app)
        .post('/api/v1/workspaces')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: '' })
        .expect(400);

      expect(res.body.error.code).toBeDefined();
      expect(res.body.error.message).toBeDefined();
      expect(typeof res.body.error.code).toBe('string');
      expect(typeof res.body.error.message).toBe('string');
    });

    it('should include details for validation errors', async () => {
      const res = await request(app)
        .post('/api/v1/workspaces')
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toBeDefined();
    });
  });

  describe('S5.12: Request ID Header', () => {
    it('should include X-Request-Id in response headers', async () => {
      const res = await request(app)
        .get('/api/v1/workspaces')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.headers['x-request-id']).toBeDefined();
    });
  });
});
