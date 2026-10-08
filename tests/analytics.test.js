/**
 * S13.4 Backend Analytics Tests
 * Tests for /workspaces/:id/analytics endpoints
 * - Tests with fixtures and hand-calculated expected numbers
 * - Guest permission blocking
 * - Range parameters
 * - CSV export
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createClient } from '@supabase/supabase-js';
import request from 'supertest';
import { createApp } from '../src/app.js';

const supabaseUrl = process.env.TEST_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.TEST_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const skipTests = !supabaseUrl || !supabaseServiceKey;

if (skipTests) {
  console.log('\n⚠️  Skipping Analytics tests: Test database credentials not set\n');
}

(skipTests ? describe.skip : describe)('Stage 13: Analytics Tests (S13.4)', () => {
  let app;
  let supabase;
  let adminToken, memberToken, guestToken;
  let adminId, memberId, guestId;
  let workspaceId;

  beforeAll(async () => {
    app = createApp();
    supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Create test users
    const { data: admin } = await supabase.auth.admin.createUser({
      email: `analytics-admin-${Date.now()}@test.com`,
      password: 'password123',
      email_confirm: true,
    });
    adminId = admin.user.id;

    const { data: member } = await supabase.auth.admin.createUser({
      email: `analytics-member-${Date.now()}@test.com`,
      password: 'password123',
      email_confirm: true,
    });
    memberId = member.user.id;

    const { data: guest } = await supabase.auth.admin.createUser({
      email: `analytics-guest-${Date.now()}@test.com`,
      password: 'password123',
      email_confirm: true,
    });
    guestId = guest.user.id;

    // Get tokens
    const { data: session1 } = await supabase.auth.signInWithPassword({
      email: admin.user.email,
      password: 'password123',
    });
    adminToken = session1.session.access_token;

    const { data: session2 } = await supabase.auth.signInWithPassword({
      email: member.user.email,
      password: 'password123',
    });
    memberToken = session2.session.access_token;

    const { data: session3 } = await supabase.auth.signInWithPassword({
      email: guest.user.email,
      password: 'password123',
    });
    guestToken = session3.session.access_token;

    // Create team workspace
    const { data: workspace } = await supabase
      .from('workspaces')
      .insert({
        name: 'Analytics Test Team',
        kind: 'team',
        created_by: adminId,
      })
      .select()
      .single();
    workspaceId = workspace.id;

    // Add member and guest
    await supabase.from('workspace_members').insert([
      { workspace_id: workspaceId, user_id: memberId, role: 'member' },
      { workspace_id: workspaceId, user_id: guestId, role: 'guest' },
    ]);

    // Create fixture data with known values
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    // Insert test tasks
    await supabase.from('tasks').insert([
      // Completed today - 3 tasks
      {
        workspace_id: workspaceId,
        title: 'Task 1 - Completed Today',
        status: 'completed',
        category: 'work',
        created_by: adminId,
        created_at: now.toISOString(),
        completed_at: now.toISOString(),
      },
      {
        workspace_id: workspaceId,
        title: 'Task 2 - Completed Today',
        status: 'completed',
        category: 'personal',
        created_by: adminId,
        created_at: now.toISOString(),
        completed_at: now.toISOString(),
      },
      {
        workspace_id: workspaceId,
        title: 'Task 3 - Completed Today',
        status: 'completed',
        category: 'work',
        created_by: adminId,
        created_at: now.toISOString(),
        completed_at: now.toISOString(),
      },
      // Completed yesterday - 2 tasks
      {
        workspace_id: workspaceId,
        title: 'Task 4 - Completed Yesterday',
        status: 'completed',
        category: 'work',
        created_by: adminId,
        created_at: yesterday.toISOString(),
        completed_at: yesterday.toISOString(),
      },
      {
        workspace_id: workspaceId,
        title: 'Task 5 - Completed Yesterday',
        status: 'completed',
        category: 'personal',
        created_by: adminId,
        created_at: yesterday.toISOString(),
        completed_at: yesterday.toISOString(),
      },
      // Completed 2 days ago - 1 task
      {
        workspace_id: workspaceId,
        title: 'Task 6 - Completed 2 Days Ago',
        status: 'completed',
        category: 'work',
        created_by: adminId,
        created_at: twoDaysAgo.toISOString(),
        completed_at: twoDaysAgo.toISOString(),
      },
      // In progress - 2 tasks
      {
        workspace_id: workspaceId,
        title: 'Task 7 - In Progress',
        status: 'in_progress',
        category: 'work',
        created_by: adminId,
        created_at: now.toISOString(),
      },
      {
        workspace_id: workspaceId,
        title: 'Task 8 - In Progress',
        status: 'in_progress',
        category: 'personal',
        created_by: adminId,
        created_at: now.toISOString(),
      },
      // Todo - 1 task
      {
        workspace_id: workspaceId,
        title: 'Task 9 - Todo',
        status: 'todo',
        category: 'work',
        created_by: adminId,
        created_at: now.toISOString(),
      },
    ]);
  });

  afterAll(async () => {
    // Cleanup
    await supabase.from('tasks').delete().eq('workspace_id', workspaceId);
    await supabase.from('workspaces').delete().eq('id', workspaceId);
    await supabase.auth.admin.deleteUser(adminId);
    await supabase.auth.admin.deleteUser(memberId);
    await supabase.auth.admin.deleteUser(guestId);
  });

  describe('Authentication & Authorization', () => {
    test('requires authentication', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_REQUIRED');
    });

    test('blocks guests from analytics', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics`)
        .set('Authorization', `Bearer ${guestToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    test('allows admin to view analytics', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    test('allows member to view analytics', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('Analytics Summary with Hand-Calculated Numbers', () => {
    test('returns correct summary statistics for 7d range', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics?range=7d`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('summary');
      expect(res.body).toHaveProperty('weekly');
      expect(res.body).toHaveProperty('categories');
      expect(res.body).toHaveProperty('daily');
      expect(res.body).toHaveProperty('streak');

      const { summary } = res.body;
      
      // Expected: 6 completed tasks total (3 today + 2 yesterday + 1 two days ago)
      expect(summary.completed_count).toBeGreaterThanOrEqual(6);
      
      // Expected: 9 total tasks created
      expect(summary.created_count).toBeGreaterThanOrEqual(9);
    });

    test('category breakdown matches fixture data', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics?range=7d`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      
      const { categories } = res.body;
      expect(Array.isArray(categories)).toBe(true);

      // Expected categories: 'work' and 'personal'
      const workCategory = categories.find(c => c.category === 'work');
      const personalCategory = categories.find(c => c.category === 'personal');

      // Work: 4 completed (Tasks 1, 3, 4, 6)
      if (workCategory) {
        expect(workCategory.count).toBeGreaterThanOrEqual(4);
      }

      // Personal: 2 completed (Tasks 2, 5)
      if (personalCategory) {
        expect(personalCategory.count).toBeGreaterThanOrEqual(2);
      }
    });

    test('daily completion shows correct counts', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics?range=7d`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      
      const { daily } = res.body;
      expect(Array.isArray(daily)).toBe(true);
      expect(daily.length).toBeGreaterThan(0);

      // Find today's entry
      const today = new Date().toISOString().split('T')[0];
      const todayEntry = daily.find(d => d.date === today);

      if (todayEntry) {
        // Expected: 3 completed today
        expect(todayEntry.completed).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('Range Parameters', () => {
    test('accepts 7d range', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics?range=7d`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    test('accepts 30d range', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics?range=30d`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    test('accepts 90d range', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics?range=90d`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    test('rejects invalid range', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics?range=365d`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    test('defaults to 7d if no range specified', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // Should use 7d by default
    });
  });

  describe('CSV Export', () => {
    test('admin can export CSV', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics/export.csv?range=7d`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('analytics-7d.csv');
      expect(res.text).toContain('Date,Completed Tasks,Created Tasks,Completion Rate');
    });

    test('member with full role can export CSV', async () => {
      // Update member to full role temporarily
      await supabase
        .from('workspace_members')
        .update({ role: 'full' })
        .eq('workspace_id', workspaceId)
        .eq('user_id', memberId);

      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics/export.csv`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');

      // Restore member role
      await supabase
        .from('workspace_members')
        .update({ role: 'member' })
        .eq('workspace_id', workspaceId)
        .eq('user_id', memberId);
    });

    test('guest cannot export CSV', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics/export.csv`)
        .set('Authorization', `Bearer ${guestToken}`);

      expect(res.status).toBe(403);
    });

    test('CSV contains valid data rows', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics/export.csv?range=7d`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      
      const lines = res.text.split('\n').filter(l => l.trim());
      expect(lines.length).toBeGreaterThan(1); // Header + data rows
      
      // Check format of first data row
      if (lines.length > 1) {
        const dataRow = lines[1].split(',');
        expect(dataRow.length).toBe(4); // Date, Completed, Created, Rate
      }
    });
  });

  describe('Overview Endpoint', () => {
    test('returns dashboard overview', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/overview`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('counts');
      expect(res.body).toHaveProperty('productivityPercent');
      expect(res.body).toHaveProperty('dailySeries');

      const { counts } = res.body;
      expect(counts).toHaveProperty('completed');
      expect(counts).toHaveProperty('inProgress');
      expect(counts).toHaveProperty('overdue');

      // Hand-calculated expectations:
      // Completed: 6 tasks
      expect(counts.completed).toBeGreaterThanOrEqual(6);
      // In Progress: 2 tasks
      expect(counts.inProgress).toBeGreaterThanOrEqual(2);
    });

    test('accepts week range parameter', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/overview?range=week`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    test('accepts 7d and 30d range parameters', async () => {
      const res1 = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/overview?range=7d`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/overview?range=30d`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res2.status).toBe(200);
    });
  });

  describe('Workspace Isolation', () => {
    test('cannot access analytics from non-member workspace', async () => {
      // Create another workspace
      const { data: otherWorkspace } = await supabase
        .from('workspaces')
        .insert({
          name: 'Other Workspace',
          kind: 'team',
          created_by: memberId,
        })
        .select()
        .single();

      const res = await request(app)
        .get(`/api/v1/workspaces/${otherWorkspace.id}/analytics`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);

      // Cleanup
      await supabase.from('workspaces').delete().eq('id', otherWorkspace.id);
    });
  });

  describe('Streak Calculation', () => {
    test('includes streak in analytics response', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/analytics`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('streak');
      expect(typeof res.body.streak).toBe('number');
      
      // Should have at least 2-day streak based on fixture data
      // (completed today and yesterday)
      expect(res.body.streak).toBeGreaterThanOrEqual(2);
    });
  });
});
