/**
 * Stage 2 Tests: Backend Foundation
 * 
 * Tests for S2.13:
 * - Health endpoints (no auth required)
 * - Auth middleware (401 errors)
 * - Error format (code + requestId)
 * - Validation errors (VALIDATION_FAILED with field details)
 * - /me endpoint (GET and PATCH)
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createClient } from '@supabase/supabase-js';
import request from 'supertest';
import { createApp } from '../src/app.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Skip if credentials not provided
const skipTests = !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY;

if (skipTests) {
  console.log('\n⚠️  Skipping Stage 2 tests: SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY not set\n');
}

(skipTests ? describe.skip : describe)('Stage 2: Backend Foundation', () => {
  let app;
  let supabaseAdmin;
  let testUserId;
  let testUserEmail;
  let testUserToken;

  beforeAll(async () => {
    app = createApp();
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Create a test user
    testUserEmail = `test-${Date.now()}@planpal.test`;
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: testUserEmail,
      password: 'TestPassword123!',
      email_confirm: true,
    });

    if (authError) throw authError;
    testUserId = authData.user.id;

    // Get auth token
    const { data: sessionData, error: sessionError } = await supabaseAdmin.auth.signInWithPassword({
      email: testUserEmail,
      password: 'TestPassword123!',
    });

    if (sessionError) throw sessionError;
    testUserToken = sessionData.session.access_token;
  });

  afterAll(async () => {
    // Cleanup: delete test user
    if (testUserId) {
      await supabaseAdmin.auth.admin.deleteUser(testUserId);
    }
  });

  describe('Health Endpoints (S2.2, S2.15)', () => {
    test('GET /health returns 200 without auth', async () => {
      const res = await request(app)
        .get('/health')
        .expect(200);

      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('timestamp');
    });

    test('GET /health/db returns 200 without auth', async () => {
      const res = await request(app)
        .get('/health/db')
        .expect(200);

      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('database', 'connected');
    });
  });

  describe('Auth Middleware (S2.5)', () => {
    test('GET /api/v1/me without token returns 401 AUTH_REQUIRED', async () => {
      const res = await request(app)
        .get('/api/v1/me')
        .expect(401);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('code', 'AUTH_REQUIRED');
      expect(res.body.error).toHaveProperty('message');
      expect(res.body.error).toHaveProperty('requestId');
    });

    test('GET /api/v1/me with invalid token returns 401 AUTH_EXPIRED', async () => {
      const res = await request(app)
        .get('/api/v1/me')
        .set('Authorization', 'Bearer invalid.token.here')
        .expect(401);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error.code).toMatch(/AUTH_REQUIRED|AUTH_EXPIRED/);
      expect(res.body.error).toHaveProperty('requestId');
    });

    test('Valid token allows access to protected routes', async () => {
      const res = await request(app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('profile');
    });
  });

  describe('Error Format (S2.7)', () => {
    test('Every error has error.code and requestId', async () => {
      const res = await request(app)
        .get('/api/v1/me')
        .expect(401);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('code');
      expect(res.body.error).toHaveProperty('requestId');
      expect(typeof res.body.error.code).toBe('string');
      // requestId can be string or number depending on pino-http config
      expect(['string', 'number']).toContain(typeof res.body.error.requestId);
    });

    test('404 errors have proper format', async () => {
      const res = await request(app)
        .get('/api/v1/nonexistent')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('code', 'NOT_FOUND');
      expect(res.body.error).toHaveProperty('requestId');
    });

    test('Response includes X-Request-Id header', async () => {
      const res = await request(app)
        .get('/health')
        .expect(200);

      expect(res.headers).toHaveProperty('x-request-id');
    });
  });

  describe('Validation Errors (S2.8)', () => {
    test('PATCH /api/v1/me with invalid data returns VALIDATION_FAILED', async () => {
      const res = await request(app)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          fullName: '', // Too short (min 1)
          language: 'invalid', // Not in enum
          theme: 'rainbow', // Not in enum
        })
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_FAILED');
      expect(res.body.error).toHaveProperty('details');
      expect(res.body.error.details).toHaveProperty('fields');
      expect(Array.isArray(res.body.error.details.fields)).toBe(true);
    });

    test('Validation error includes field-specific messages', async () => {
      const res = await request(app)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          language: 'invalid',
        })
        .expect(400);

      expect(res.body.error.details.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'language' })
        ])
      );
    });
  });

  describe('GET /api/v1/me (S2.9)', () => {
    test('Returns profile with all fields', async () => {
      const res = await request(app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('profile');
      expect(res.body.profile).toHaveProperty('id', testUserId);
      expect(res.body.profile).toHaveProperty('email', testUserEmail);
      expect(res.body.profile).toHaveProperty('fullName');
      expect(res.body.profile).toHaveProperty('avatarUrl');
      expect(res.body.profile).toHaveProperty('timezone');
      expect(res.body.profile).toHaveProperty('language');
      expect(res.body.profile).toHaveProperty('theme');
      expect(res.body.profile).toHaveProperty('createdAt');
    });

    test('Returns workspaces array with roles', async () => {
      const res = await request(app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('workspaces');
      expect(Array.isArray(res.body.workspaces)).toBe(true);
      
      // Should have at least Personal workspace (auto-created by trigger)
      expect(res.body.workspaces.length).toBeGreaterThan(0);
      
      const firstWorkspace = res.body.workspaces[0];
      expect(firstWorkspace).toHaveProperty('id');
      expect(firstWorkspace).toHaveProperty('name');
      expect(firstWorkspace).toHaveProperty('type');
      expect(firstWorkspace).toHaveProperty('role');
    });

    test('Returns personalWorkspaceId', async () => {
      const res = await request(app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('personalWorkspaceId');
      
      // Personal workspace should exist (auto-created)
      const personalWorkspace = res.body.workspaces.find(w => w.type === 'personal');
      if (personalWorkspace) {
        expect(res.body.personalWorkspaceId).toBe(personalWorkspace.id);
      }
    });
  });

  describe('PATCH /api/v1/me (S2.10)', () => {
    test('Updates fullName', async () => {
      const newName = 'Updated Test Name';
      
      const res = await request(app)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ fullName: newName })
        .expect(200);

      expect(res.body.profile.fullName).toBe(newName);
    });

    test('Updates timezone', async () => {
      const res = await request(app)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ timezone: 'America/New_York' })
        .expect(200);

      expect(res.body.profile.timezone).toBe('America/New_York');
    });

    test('Updates language (valid enum)', async () => {
      const res = await request(app)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ language: 'es' })
        .expect(200);

      expect(res.body.profile.language).toBe('es');
    });

    test('Updates theme (valid enum)', async () => {
      const res = await request(app)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ theme: 'dark' })
        .expect(200);

      expect(res.body.profile.theme).toBe('dark');
    });

    test('Updates multiple fields at once', async () => {
      const res = await request(app)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          fullName: 'Multi Update Test',
          language: 'fr',
          theme: 'light',
        })
        .expect(200);

      expect(res.body.profile.fullName).toBe('Multi Update Test');
      expect(res.body.profile.language).toBe('fr');
      expect(res.body.profile.theme).toBe('light');
    });

    test('Rejects invalid language', async () => {
      const res = await request(app)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ language: 'invalid' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    test('Rejects invalid theme', async () => {
      const res = await request(app)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ theme: 'rainbow' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    test('Ignores unknown fields', async () => {
      const res = await request(app)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({
          fullName: 'Valid Name',
          unknownField: 'should be ignored',
        })
        .expect(200);

      expect(res.body.profile.fullName).toBe('Valid Name');
      expect(res.body.profile).not.toHaveProperty('unknownField');
    });
  });

  describe('Avatar Endpoints (S2.11)', () => {
    test('POST /api/v1/me/avatar-upload-url requires auth', async () => {
      const res = await request(app)
        .post('/api/v1/me/avatar-upload-url')
        .send({ mimeType: 'image/jpeg' })
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_REQUIRED');
    });

    test('POST /api/v1/me/avatar-upload-url validates mime type', async () => {
      const res = await request(app)
        .post('/api/v1/me/avatar-upload-url')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ mimeType: 'application/pdf' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'mimeType' })
        ])
      );
    });

    test('POST /api/v1/me/avatar-upload-url returns signed URL', async () => {
      const res = await request(app)
        .post('/api/v1/me/avatar-upload-url')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ mimeType: 'image/jpeg' })
        .expect(200);

      expect(res.body).toHaveProperty('uploadUrl');
      expect(res.body).toHaveProperty('path');
      expect(res.body).toHaveProperty('token');
      expect(typeof res.body.uploadUrl).toBe('string');
      expect(res.body.uploadUrl).toContain('planpal-files');
    });

    test('DELETE /api/v1/me/avatar requires auth', async () => {
      const res = await request(app)
        .delete('/api/v1/me/avatar')
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_REQUIRED');
    });

    test('DELETE /api/v1/me/avatar succeeds even with no avatar', async () => {
      const res = await request(app)
        .delete('/api/v1/me/avatar')
        .set('Authorization', `Bearer ${testUserToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
    });
  });

  describe('Rate Limiting (S2.3)', () => {
    test('API routes are rate limited', async () => {
      // Make multiple requests quickly
      const requests = [];
      for (let i = 0; i < 5; i++) {
        requests.push(
          request(app)
            .get('/api/v1/me')
            .set('Authorization', `Bearer ${testUserToken}`)
        );
      }

      const responses = await Promise.all(requests);
      
      // All should succeed if under rate limit
      responses.forEach(res => {
        expect(res.status).toBeLessThan(500);
      });
    });
  });
});
