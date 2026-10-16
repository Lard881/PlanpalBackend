/**
 * S12.2 Backend Search Tests
 * Tests for /search endpoint
 * - RLS respected
 * - Guest limits
 * - Minimum length
 * - No duplicate people
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createClient } from '@supabase/supabase-js';
import request from 'supertest';
import { createApp } from '../src/app.js';

import {
  TEST_SUPABASE_URL as supabaseUrl,
  TEST_SUPABASE_ANON_KEY as supabaseAnonKey,
  TEST_SUPABASE_SERVICE_KEY as supabaseServiceKey,
  skipDbTests as skipTests,
  logSkip,
} from './helpers/db.js';

logSkip('Search tests');

(skipTests ? describe.skip : describe)('Stage 12: Search Tests (S12.2)', () => {
  let app;
  let supabase;
  let authClient;
  let user1Token, user2Token, guestToken;
  let user1Id, user2Id, guestId;
  let workspace1Id, workspace2Id;
  let task1Id, task2Id, doc1Id;

  beforeAll(async () => {
    app = createApp();
    supabase = createClient(supabaseUrl, supabaseServiceKey);
    authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Create test users
    const { data: u1 } = await supabase.auth.admin.createUser({
      email: `search-user1-${Date.now()}@test.com`,
      password: 'password123',
      email_confirm: true,
    });
    user1Id = u1.user.id;

    const { data: u2 } = await supabase.auth.admin.createUser({
      email: `search-user2-${Date.now()}@test.com`,
      password: 'password123',
      email_confirm: true,
    });
    user2Id = u2.user.id;

    const { data: guest } = await supabase.auth.admin.createUser({
      email: `search-guest-${Date.now()}@test.com`,
      password: 'password123',
      email_confirm: true,
    });
    guestId = guest.user.id;

    // Get tokens
    const { data: session1 } = await authClient.auth.signInWithPassword({
      email: u1.user.email,
      password: 'password123',
    });
    user1Token = session1.session.access_token;

    const { data: session2 } = await authClient.auth.signInWithPassword({
      email: u2.user.email,
      password: 'password123',
    });
    user2Token = session2.session.access_token;

    const { data: sessionGuest } = await authClient.auth.signInWithPassword({
      email: guest.user.email,
      password: 'password123',
    });
    guestToken = sessionGuest.session.access_token;

    // Get workspace IDs (created by signup trigger)
    const { data: w1, error: workspace1Error } = await supabase
      .from('workspaces')
      .select('id')
      .eq('created_by', user1Id)
      .eq('type', 'personal')
      .single();
    if (workspace1Error) throw workspace1Error;
    workspace1Id = w1.id;

    const { data: w2, error: workspace2Error } = await supabase
      .from('workspaces')
      .select('id')
      .eq('created_by', user2Id)
      .eq('type', 'personal')
      .single();
    if (workspace2Error) throw workspace2Error;
    workspace2Id = w2.id;

    // Create team workspace and add guest
    const { data: team, error: teamError } = await supabase
      .from('workspaces')
      .insert({
        name: 'Search Test Team',
        type: 'team',
        created_by: user1Id,
      })
      .select()
      .single();
      if (teamError) throw teamError;
    const teamId = team.id;

    // Add guest to team
    await supabase
      .from('workspace_members')
      .insert({
        workspace_id: teamId,
        user_id: guestId,
        role: 'guest',
      });

    // Create tasks in workspace1
    const { data: t1 } = await supabase
      .from('tasks')
      .insert({
        workspace_id: workspace1Id,
        title: 'Searchable Task Alpha',
        description: 'Important task for user1',
        status: 'todo',
        created_by: user1Id,
      })
      .select()
      .single();
    task1Id = t1.id;

    // Create task in workspace2 (user2)
    const { data: t2 } = await supabase
      .from('tasks')
      .insert({
        workspace_id: workspace2Id,
        title: 'Searchable Task Beta',
        description: 'Private task for user2',
        status: 'todo',
        created_by: user2Id,
      })
      .select()
      .single();
    task2Id = t2.id;

    // Create document in workspace1
    const { data: d1 } = await supabase
      .from('documents')
      .insert({
        workspace_id: workspace1Id,
        title: 'Searchable Document',
        kind: 'written',
        created_by: user1Id,
      })
      .select()
      .single();
    doc1Id = d1.id;
  });

  afterAll(async () => {
    // Cleanup
    await supabase.from('tasks').delete().eq('id', task1Id);
    await supabase.from('tasks').delete().eq('id', task2Id);
    await supabase.from('documents').delete().eq('id', doc1Id);
    await supabase.auth.admin.deleteUser(user1Id);
    await supabase.auth.admin.deleteUser(user2Id);
    await supabase.auth.admin.deleteUser(guestId);
  });

  describe('Authentication & Validation', () => {
    test('requires authentication', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=test');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_REQUIRED');
    });

    test('validates minimum query length', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=a')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    test('validates type parameter', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=test&type=invalid')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(400);
    });
  });

  describe('RLS Isolation', () => {
    test('user1 can search and find their own content', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=Alpha')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(0);
      
      const taskResult = res.body.results.find(
        result => result.kind === 'task' && result.id === task1Id,
      );
      expect(taskResult).toBeDefined();
      expect(taskResult.title).toContain('Alpha');
    });

    test('user1 cannot see user2 private workspace content', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=Beta')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      
      const taskResult = res.body.results.find(result => result.id === task2Id);
      expect(taskResult).toBeUndefined();
    });

    test('workspace scoping works correctly', async () => {
      const res = await request(app)
        .get(`/api/v1/search?q=Searchable&workspaceId=${workspace1Id}`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.results.every(r => r.workspace_id === workspace1Id)).toBe(true);
    });
  });

  describe('Type Filtering', () => {
    test('can filter by type=task', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=Searchable&type=task')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.results.every(result => result.kind === 'task')).toBe(true);
      expect(res.body.counts.task).toBeGreaterThan(0);
    });

    test('can filter by type=document', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=Searchable&type=document')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.results.every(result => result.kind === 'document')).toBe(
        true,
      );
    });

    test('can filter by type=person', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=search&type=person')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.results.every(result => result.kind === 'person')).toBe(
        true,
      );
    });

    test('type=all returns mixed results with counts', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=Searchable&type=all')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.counts).toHaveProperty('all');
      expect(res.body.counts).toHaveProperty('task');
      expect(res.body.counts).toHaveProperty('document');
      expect(res.body.counts).toHaveProperty('person');
    });
  });

  describe('Guest Restrictions', () => {
    test('guest can search but has limited access', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=test')
        .set('Authorization', `Bearer ${guestToken}`);

      expect(res.status).toBe(200);
      // Guest should only see content from workspaces they're in
      // Cannot see user1's personal workspace or user2's workspace
    });

    test('guest cannot see content outside their workspaces', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=Alpha')
        .set('Authorization', `Bearer ${guestToken}`);

      expect(res.status).toBe(200);
      const taskResult = res.body.results.find(result => result.id === task1Id);
      expect(taskResult).toBeUndefined(); // Should not see user1's personal task
    });
  });

  describe('People Deduplication', () => {
    test('no duplicate people in results', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=search&type=person')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      
      const personIds = res.body.results.map(result => result.id);
      const uniqueIds = [...new Set(personIds)];
      
      expect(personIds.length).toBe(uniqueIds.length);
    });

    test('person appears once even if in multiple workspaces', async () => {
      // Create team and add user2
      const { data: sharedTeam } = await supabase
        .from('workspaces')
        .insert({
          name: 'Shared Search Team',
          type: 'team',
          created_by: user1Id,
        })
        .select()
        .single();

      await supabase
        .from('workspace_members')
        .insert({
          workspace_id: sharedTeam.id,
          user_id: user2Id,
          role: 'member',
        });

      const res = await request(app)
        .get('/api/v1/search?q=search&type=person')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      
      const user2Results = res.body.results.filter(r => r.entity_id === user2Id);
      expect(user2Results.length).toBeLessThanOrEqual(1);

      // Cleanup
      await supabase.from('workspaces').delete().eq('id', sharedTeam.id);
    });
  });

  describe('Limit Parameter', () => {
    test('respects limit parameter', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=search&limit=5')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeLessThanOrEqual(5);
    });

    test('enforces maximum limit of 50', async () => {
      const res = await request(app)
        .get('/api/v1/search?q=test&limit=100')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(400);
    });
  });
});
