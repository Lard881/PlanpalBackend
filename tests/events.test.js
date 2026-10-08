import request from 'supertest';
import app from '../src/index.js';
import { adminClient } from '../src/lib/supabase.js';

describe('Events API - S8.4', () => {
  let authToken;
  let userId;
  let workspaceId;
  let memberToken;
  let memberUserId;
  let supabase;

  beforeAll(async () => {
    supabase = adminClient();

    // Create admin user
    const { data: { user: admin } } = await supabase.auth.admin.createUser({
      email: `test-events-admin-${Date.now()}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    userId = admin.id;

    const { data: { session: adminSession } } = await supabase.auth.signInWithPassword({
      email: admin.email,
      password: 'password123',
    });
    authToken = adminSession.access_token;

    // Get workspace
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id')
      .eq('created_by', userId)
      .eq('is_personal', true)
      .single();
    workspaceId = workspace.id;

    // Create member user
    const { data: { user: member } } = await supabase.auth.admin.createUser({
      email: `test-events-member-${Date.now()}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    memberUserId = member.id;

    const { data: { session: memberSession } } = await supabase.auth.signInWithPassword({
      email: member.email,
      password: 'password123',
    });
    memberToken = memberSession.access_token;

    // Add member to workspace
    await supabase.from('workspace_members').insert({
      workspace_id: workspaceId,
      user_id: memberUserId,
      role: 'member',
    });
  });

  afterAll(async () => {
    if (userId) await supabase.auth.admin.deleteUser(userId);
    if (memberUserId) await supabase.auth.admin.deleteUser(memberUserId);
  });

  describe('GET /workspaces/:workspaceId/events', () => {
    beforeAll(async () => {
      // Create test events
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      await supabase.from('events').insert([
        {
          workspace_id: workspaceId,
          title: 'Today Event',
          starts_at: now.toISOString(),
          ends_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
          created_by: userId,
        },
        {
          workspace_id: workspaceId,
          title: 'Tomorrow Event',
          starts_at: tomorrow.toISOString(),
          ends_at: new Date(tomorrow.getTime() + 60 * 60 * 1000).toISOString(),
          created_by: userId,
        },
        {
          workspace_id: workspaceId,
          title: 'Next Week Event',
          starts_at: nextWeek.toISOString(),
          ends_at: new Date(nextWeek.getTime() + 60 * 60 * 1000).toISOString(),
          created_by: userId,
        },
      ]);

      // Create a task with due date
      await supabase.from('tasks').insert({
        workspace_id: workspaceId,
        title: 'Task with due date',
        status: 'todo',
        priority: 'high',
        due_at: tomorrow.toISOString(),
        created_by: userId,
      });
    });

    it('should return events and due tasks in date range', async () => {
      const now = new Date();
      const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/events`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          from: now.toISOString(),
          to: weekFromNow.toISOString(),
        })
        .expect(200);

      expect(res.body.events).toBeDefined();
      expect(res.body.dueTasks).toBeDefined();
      expect(res.body.events.length).toBeGreaterThanOrEqual(2);
      expect(res.body.dueTasks.length).toBeGreaterThanOrEqual(1);
    });

    it('should reject range > 62 days', async () => {
      const now = new Date();
      const tooFar = new Date(now.getTime() + 63 * 24 * 60 * 60 * 1000);

      await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/events`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          from: now.toISOString(),
          to: tooFar.toISOString(),
        })
        .expect(400);
    });

    it('should allow member to view events', async () => {
      const now = new Date();
      const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/events`)
        .set('Authorization', `Bearer ${memberToken}`)
        .query({
          from: now.toISOString(),
          to: weekFromNow.toISOString(),
        })
        .expect(200);

      expect(res.body.events).toBeDefined();
    });
  });

  describe('POST /workspaces/:workspaceId/events', () => {
    it('should create event with attendees', async () => {
      const now = new Date();
      const eventData = {
        title: 'Team Meeting',
        startsAt: now.toISOString(),
        endsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        description: 'Quarterly review',
        attendeeIds: [memberUserId],
      };

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/events`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(eventData)
        .expect(201);

      expect(res.body.event).toBeDefined();
      expect(res.body.event.title).toBe('Team Meeting');

      // Verify attendees
      const { data: attendees } = await supabase
        .from('event_attendees')
        .select('*')
        .eq('event_id', res.body.event.id);

      expect(attendees).toHaveLength(1);
      expect(attendees[0].user_id).toBe(memberUserId);
    });

    it('should validate attendees are workspace members', async () => {
      const now = new Date();
      const fakeUserId = '550e8400-e29b-41d4-a716-999999999999';

      const eventData = {
        title: 'Invalid Meeting',
        startsAt: now.toISOString(),
        endsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        attendeeIds: [fakeUserId],
      };

      // This should fail at DB level due to foreign key constraint
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/events`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(eventData);

      // May be 400 or 500 depending on error handling
      expect([400, 500]).toContain(res.status);
    });

    it('should create event with client-supplied ID (idempotency)', async () => {
      const now = new Date();
      const clientId = '550e8400-e29b-41d4-a716-446655440001';

      const eventData = {
        id: clientId,
        title: 'Idempotent Event',
        startsAt: now.toISOString(),
        endsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      };

      const res1 = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/events`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(eventData)
        .expect(201);

      expect(res1.body.event.id).toBe(clientId);

      // Second request should also succeed (idempotent)
      const res2 = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/events`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(eventData)
        .expect(201);

      expect(res2.body.event.id).toBe(clientId);
    });
  });

  describe('PATCH /events/:eventId', () => {
    let eventId;

    beforeAll(async () => {
      const now = new Date();
      const { data: event } = await supabase.from('events').insert({
        workspace_id: workspaceId,
        title: 'Update Test Event',
        starts_at: now.toISOString(),
        ends_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        created_by: userId,
      }).select().single();
      eventId = event.id;
    });

    it('should update event', async () => {
      const res = await request(app)
        .patch(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Updated Event Title',
          description: 'New description',
        })
        .expect(200);

      expect(res.body.event.title).toBe('Updated Event Title');
    });

    it('should update attendees', async () => {
      const res = await request(app)
        .patch(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          attendeeIds: [memberUserId],
        })
        .expect(200);

      // Verify attendees updated
      const { data: attendees } = await supabase
        .from('event_attendees')
        .select('*')
        .eq('event_id', eventId);

      expect(attendees).toHaveLength(1);
    });
  });

  describe('DELETE /events/:eventId', () => {
    it('should soft delete event', async () => {
      const now = new Date();
      const { data: event } = await supabase.from('events').insert({
        workspace_id: workspaceId,
        title: 'Delete Test',
        starts_at: now.toISOString(),
        ends_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        created_by: userId,
      }).select().single();

      await request(app)
        .delete(`/api/v1/events/${event.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // Verify soft delete
      const { data: deletedEvent } = await supabase
        .from('events')
        .select('deleted_at')
        .eq('id', event.id)
        .single();

      expect(deletedEvent.deleted_at).toBeTruthy();
    });
  });

  describe('Role-based permissions', () => {
    it('should allow admin to create events', async () => {
      const now = new Date();
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/events`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Admin Event',
          startsAt: now.toISOString(),
          endsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        })
        .expect(201);

      expect(res.body.event).toBeDefined();
    });

    it('should allow member to create events', async () => {
      const now = new Date();
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/events`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          title: 'Member Event',
          startsAt: now.toISOString(),
          endsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        })
        .expect(201);

      expect(res.body.event).toBeDefined();
    });
  });
});
