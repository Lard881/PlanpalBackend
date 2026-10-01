import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { createApp } from '../src/app.js';
import { supabase, supabaseAdmin } from '../src/lib/supabase.js';

const app = createApp();

describe('Activity Feed API', () => {
  let authToken1, authToken2;
  let user1Id, user2Id;
  let workspaceId, projectId, taskId;
  let activityIds = [];

  beforeAll(async () => {
    const timestamp = Date.now();
    
    // Create test users
    const { data: auth1 } = await supabase.auth.signUp({
      email: `feed-user1-${timestamp}@example.com`,
      password: 'TestPassword123!',
    });
    authToken1 = auth1.session.access_token;
    user1Id = auth1.user.id;
    
    const { data: auth2 } = await supabase.auth.signUp({
      email: `feed-user2-${timestamp}@example.com`,
      password: 'TestPassword123!',
    });
    authToken2 = auth2.session.access_token;
    user2Id = auth2.user.id;
    
    // Create workspace
    const { data: workspace } = await supabaseAdmin
      .from('workspaces')
      .insert({
        name: 'Activity Feed Test Workspace',
        created_by: user1Id,
      })
      .select()
      .single();
    workspaceId = workspace.id;
    
    // Add members
    await supabaseAdmin.from('workspace_members').insert([
      { workspace_id: workspaceId, user_id: user1Id, role: 'admin' },
      { workspace_id: workspaceId, user_id: user2Id, role: 'member' },
    ]);
    
    // Create project
    const { data: project } = await supabaseAdmin
      .from('projects')
      .insert({
        workspace_id: workspaceId,
        name: 'Test Project',
        created_by: user1Id,
      })
      .select()
      .single();
    projectId = project.id;
    
    // Create task
    const { data: task } = await supabaseAdmin
      .from('tasks')
      .insert({
        project_id: projectId,
        title: 'Test Task',
        created_by: user1Id,
        assigned_to: user1Id,
      })
      .select()
      .single();
    taskId = task.id;
    
    // Create test activities
    const activities = await supabaseAdmin
      .from('activities')
      .insert([
        {
          workspace_id: workspaceId,
          user_id: user1Id,
          entity_type: 'task',
          entity_id: taskId,
          action: 'created',
        },
        {
          workspace_id: workspaceId,
          user_id: user1Id,
          entity_type: 'task',
          entity_id: taskId,
          action: 'updated',
        },
        {
          workspace_id: workspaceId,
          user_id: user2Id,
          entity_type: 'task',
          entity_id: taskId,
          action: 'commented',
        },
      ])
      .select();
    
    activityIds = activities.data.map(a => a.id);
  });

  afterAll(async () => {
    // Cleanup
    await supabaseAdmin.from('activity_read_status').delete().eq('user_id', user2Id);
    await supabaseAdmin.from('activity_preferences').delete().eq('workspace_id', workspaceId);
    await supabaseAdmin.from('activities').delete().eq('workspace_id', workspaceId);
    await supabaseAdmin.from('tasks').delete().eq('id', taskId);
    await supabaseAdmin.from('projects').delete().eq('id', projectId);
    await supabaseAdmin.from('workspace_members').delete().eq('workspace_id', workspaceId);
    await supabaseAdmin.from('workspaces').delete().eq('id', workspaceId);
    await supabaseAdmin.auth.admin.deleteUser(user1Id);
    await supabaseAdmin.auth.admin.deleteUser(user2Id);
  });

  beforeEach(async () => {
    // Reset read status before each test
    await supabaseAdmin.from('activity_read_status').delete().eq('user_id', user2Id);
  });

  describe('GET /api/v1/activity-feed/personalized', () => {
    it('should get personalized activity feed', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/personalized?workspace_id=${workspaceId}`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(200);
      expect(res.body.activities).toBeDefined();
      expect(Array.isArray(res.body.activities)).toBe(true);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.limit).toBe(50);
    });

    it('should respect pagination', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/personalized?workspace_id=${workspaceId}&limit=2&offset=1`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(2);
      expect(res.body.pagination.offset).toBe(1);
    });

    it('should filter by read status', async () => {
      // Mark one activity as read
      await supabaseAdmin.from('activity_read_status').insert({
        user_id: user2Id,
        activity_id: activityIds[0],
      });

      const res = await request(app)
        .get(`/api/v1/activity-feed/personalized?workspace_id=${workspaceId}&include_read=false`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(200);
      expect(res.body.activities.every(a => !a.is_read)).toBe(true);
    });

    it('should reject unauthorized workspace access', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/personalized?workspace_id=00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(403);
    });

    it('should require workspace_id', async () => {
      const res = await request(app)
        .get('/api/v1/activity-feed/personalized')
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/activity-feed/aggregated', () => {
    it('should get aggregated activity feed', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/aggregated?workspace_id=${workspaceId}`)
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.activities).toBeDefined();
      expect(Array.isArray(res.body.activities)).toBe(true);
      expect(res.body.aggregation_window_hours).toBe(24);
    });

    it('should filter by entity type', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/aggregated?workspace_id=${workspaceId}&entity_type=task`)
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.activities.every(a => a.entity_type === 'task')).toBe(true);
    });

    it('should respect hours_back parameter', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/aggregated?workspace_id=${workspaceId}&hours_back=1`)
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.aggregation_window_hours).toBe(1);
    });

    it('should enforce max hours_back limit', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/aggregated?workspace_id=${workspaceId}&hours_back=1000`)
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/activity-feed/mark-read', () => {
    it('should mark activities as read', async () => {
      const res = await request(app)
        .post('/api/v1/activity-feed/mark-read')
        .set('Authorization', `Bearer ${authToken2}`)
        .send({
          activity_ids: [activityIds[0], activityIds[1]],
        });

      expect(res.status).toBe(200);
      expect(res.body.marked_count).toBeGreaterThan(0);
      expect(res.body.activity_ids).toEqual([activityIds[0], activityIds[1]]);
    });

    it('should handle duplicate mark-read requests', async () => {
      // Mark first time
      await request(app)
        .post('/api/v1/activity-feed/mark-read')
        .set('Authorization', `Bearer ${authToken2}`)
        .send({
          activity_ids: [activityIds[0]],
        });

      // Mark again
      const res = await request(app)
        .post('/api/v1/activity-feed/mark-read')
        .set('Authorization', `Bearer ${authToken2}`)
        .send({
          activity_ids: [activityIds[0]],
        });

      expect(res.status).toBe(200);
      expect(res.body.marked_count).toBe(0); // Already marked
    });

    it('should require activity_ids', async () => {
      const res = await request(app)
        .post('/api/v1/activity-feed/mark-read')
        .set('Authorization', `Bearer ${authToken2}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('should reject empty activity_ids array', async () => {
      const res = await request(app)
        .post('/api/v1/activity-feed/mark-read')
        .set('Authorization', `Bearer ${authToken2}`)
        .send({
          activity_ids: [],
        });

      expect(res.status).toBe(400);
    });

    it('should enforce max 100 activities', async () => {
      const tooMany = Array(101).fill('00000000-0000-0000-0000-000000000000');
      
      const res = await request(app)
        .post('/api/v1/activity-feed/mark-read')
        .set('Authorization', `Bearer ${authToken2}`)
        .send({
          activity_ids: tooMany,
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/activity-feed/mark-all-read', () => {
    it('should mark all activities as read', async () => {
      const res = await request(app)
        .post(`/api/v1/activity-feed/mark-all-read?workspace_id=${workspaceId}`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(200);
      expect(res.body.marked_count).toBeGreaterThanOrEqual(0);
    });

    it('should return 0 if all already read', async () => {
      // Mark all first
      await request(app)
        .post(`/api/v1/activity-feed/mark-all-read?workspace_id=${workspaceId}`)
        .set('Authorization', `Bearer ${authToken2}`);

      // Try again
      const res = await request(app)
        .post(`/api/v1/activity-feed/mark-all-read?workspace_id=${workspaceId}`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(200);
      expect(res.body.marked_count).toBe(0);
    });

    it('should require workspace_id', async () => {
      const res = await request(app)
        .post('/api/v1/activity-feed/mark-all-read')
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/activity-feed/unread-count', () => {
    beforeEach(async () => {
      // Reset read status
      await supabaseAdmin.from('activity_read_status').delete().eq('user_id', user2Id);
    });

    it('should get unread activity count', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/unread-count?workspace_id=${workspaceId}`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(200);
      expect(res.body.workspace_id).toBe(workspaceId);
      expect(typeof res.body.unread_count).toBe('number');
      expect(res.body.unread_count).toBeGreaterThanOrEqual(0);
    });

    it('should decrease after marking as read', async () => {
      // Get initial count
      const res1 = await request(app)
        .get(`/api/v1/activity-feed/unread-count?workspace_id=${workspaceId}`)
        .set('Authorization', `Bearer ${authToken2}`);
      const initialCount = res1.body.unread_count;

      // Mark one as read
      await request(app)
        .post('/api/v1/activity-feed/mark-read')
        .set('Authorization', `Bearer ${authToken2}`)
        .send({ activity_ids: [activityIds[0]] });

      // Get new count
      const res2 = await request(app)
        .get(`/api/v1/activity-feed/unread-count?workspace_id=${workspaceId}`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res2.body.unread_count).toBeLessThanOrEqual(initialCount);
    });
  });

  describe('GET /api/v1/activity-feed/preferences/:workspace_id', () => {
    it('should get activity preferences', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/preferences/${workspaceId}`)
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.preferences).toBeDefined();
      expect(res.body.preferences.user_id).toBe(user1Id);
      expect(res.body.preferences.workspace_id).toBe(workspaceId);
    });

    it('should create default preferences if not exist', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/preferences/${workspaceId}`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(200);
      expect(res.body.preferences).toBeDefined();
      expect(res.body.preferences.email_digest_frequency).toBe('daily');
      expect(res.body.preferences.show_mentions).toBe(true);
    });

    it('should reject unauthorized workspace access', async () => {
      const res = await request(app)
        .get('/api/v1/activity-feed/preferences/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/v1/activity-feed/preferences/:workspace_id', () => {
    it('should update activity preferences', async () => {
      const res = await request(app)
        .put(`/api/v1/activity-feed/preferences/${workspaceId}`)
        .set('Authorization', `Bearer ${authToken1}`)
        .send({
          email_digest_frequency: 'weekly',
          show_own_activities: true,
          excluded_actions: ['deleted'],
        });

      expect(res.status).toBe(200);
      expect(res.body.preferences).toBeDefined();
      expect(res.body.preferences.email_digest_frequency).toBe('weekly');
      expect(res.body.preferences.show_own_activities).toBe(true);
      expect(res.body.preferences.excluded_actions).toContain('deleted');
    });

    it('should validate email_digest_frequency', async () => {
      const res = await request(app)
        .put(`/api/v1/activity-feed/preferences/${workspaceId}`)
        .set('Authorization', `Bearer ${authToken1}`)
        .send({
          email_digest_frequency: 'invalid',
        });

      expect(res.status).toBe(400);
    });

    it('should handle partial updates', async () => {
      const res = await request(app)
        .put(`/api/v1/activity-feed/preferences/${workspaceId}`)
        .set('Authorization', `Bearer ${authToken1}`)
        .send({
          show_comments: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.preferences.show_comments).toBe(false);
    });
  });

  describe('GET /api/v1/activity-feed/summary/:workspace_id', () => {
    it('should get workspace activity summary', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/summary/${workspaceId}`)
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.workspace_id).toBe(workspaceId);
      expect(res.body.period).toBeDefined();
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary.total_activities).toBeGreaterThanOrEqual(0);
      expect(res.body.summary.by_action).toBeDefined();
      expect(res.body.summary.by_day).toBeDefined();
    });

    it('should respect days_back parameter', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/summary/${workspaceId}?days_back=30`)
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.period.days_back).toBe(30);
    });

    it('should enforce max days_back limit', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/summary/${workspaceId}?days_back=100`)
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/activity-feed/refresh-summary', () => {
    it('should refresh activity summary', async () => {
      const res = await request(app)
        .post('/api/v1/activity-feed/refresh-summary')
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('refreshed');
      expect(res.body.refreshed_at).toBeDefined();
    });
  });

  describe('Authentication', () => {
    it('should reject requests without token', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/personalized?workspace_id=${workspaceId}`);

      expect(res.status).toBe(401);
    });

    it('should reject requests with invalid token', async () => {
      const res = await request(app)
        .get(`/api/v1/activity-feed/personalized?workspace_id=${workspaceId}`)
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
    });
  });
});
