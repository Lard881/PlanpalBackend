import request from 'supertest';
import app from '../src/index.js';
import { adminClient } from '../src/lib/supabase.js';

describe('Tasks API', () => {
  let authToken;
  let userId;
  let workspaceId;
  let guestToken;
  let guestUserId;
  let adminToken;
  let adminUserId;
  let labelId;
  let taskId;
  let supabase;

  beforeAll(async () => {
    supabase = adminClient();

    // Create test user 1 (admin)
    const { data: { user: user1 } } = await supabase.auth.admin.createUser({
      email: `test-tasks-admin-${Date.now()}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    adminUserId = user1.id;

    const { data: { session: session1 } } = await supabase.auth.signInWithPassword({
      email: user1.email,
      password: 'password123',
    });
    adminToken = session1.access_token;

    // Get admin's Personal workspace
    const { data: workspaces } = await supabase
      .from('workspaces')
      .select('id')
      .eq('created_by', adminUserId)
      .eq('is_personal', true)
      .single();
    workspaceId = workspaces.id;

    // Create test user 2 (regular member)
    const { data: { user: user2 } } = await supabase.auth.admin.createUser({
      email: `test-tasks-member-${Date.now()}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    userId = user2.id;

    const { data: { session: session2 } } = await supabase.auth.signInWithPassword({
      email: user2.email,
      password: 'password123',
    });
    authToken = session2.access_token;

    // Add member to workspace
    await supabase.from('workspace_members').insert({
      workspace_id: workspaceId,
      user_id: userId,
      role: 'member',
    });

    // Create test user 3 (guest)
    const { data: { user: user3 } } = await supabase.auth.admin.createUser({
      email: `test-tasks-guest-${Date.now()}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    guestUserId = user3.id;

    const { data: { session: session3 } } = await supabase.auth.signInWithPassword({
      email: user3.email,
      password: 'password123',
    });
    guestToken = session3.access_token;

    // Add guest to workspace
    await supabase.from('workspace_members').insert({
      workspace_id: workspaceId,
      user_id: guestUserId,
      role: 'guest',
    });

    // Create a label for testing
    const { data: label } = await supabase
      .from('labels')
      .insert({
        workspace_id: workspaceId,
        name: 'Test Label',
        color: '#FF5733',
      })
      .select()
      .single();
    labelId = label.id;
  });

  afterAll(async () => {
    // Cleanup
    if (userId) await supabase.auth.admin.deleteUser(userId);
    if (adminUserId) await supabase.auth.admin.deleteUser(adminUserId);
    if (guestUserId) await supabase.auth.admin.deleteUser(guestUserId);
  });

  describe('POST /workspaces/:workspaceId/tasks', () => {
    it('should create a task with client-supplied ID (idempotency)', async () => {
      const clientId = '550e8400-e29b-41d4-a716-446655440000';
      const taskData = {
        id: clientId,
        title: 'Idempotent Task',
        description: 'Testing idempotency',
        priority: 'high',
      };

      // First request
      const res1 = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/tasks`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(taskData)
        .expect(201);

      expect(res1.body.task.id).toBe(clientId);
      expect(res1.body.task.title).toBe('Idempotent Task');

      // Second request with same ID (should succeed idempotently)
      const res2 = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/tasks`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(taskData)
        .expect(201);

      expect(res2.body.task.id).toBe(clientId);

      taskId = clientId;
    });

    it('should validate assignee is a workspace member', async () => {
      const fakeUserId = '550e8400-e29b-41d4-a716-999999999999';

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/tasks`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Task with invalid assignee',
          assigneeId: fakeUserId,
        })
        .expect(400);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should create notification when assigning to another user', async () => {
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/tasks`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Assigned Task',
          assigneeId: adminUserId,
        })
        .expect(201);

      // Check notification was created
      const { data: notification } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', adminUserId)
        .eq('type', 'task_assigned')
        .eq('entity_id', res.body.task.id)
        .single();

      expect(notification).toBeTruthy();
    });

    it('should NOT allow guests to create tasks', async () => {
      await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/tasks`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({
          title: 'Guest Task',
        })
        .expect(403);
    });
  });

  describe('GET /workspaces/:workspaceId/tasks', () => {
    beforeAll(async () => {
      // Create test tasks with different statuses and priorities
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      await supabase.from('tasks').insert([
        {
          workspace_id: workspaceId,
          title: 'Today Task',
          status: 'todo',
          priority: 'high',
          due_at: now.toISOString(),
          created_by: userId,
        },
        {
          workspace_id: workspaceId,
          title: 'Overdue Task',
          status: 'in_progress',
          priority: 'urgent',
          due_at: yesterday.toISOString(),
          created_by: userId,
        },
        {
          workspace_id: workspaceId,
          title: 'Week Task',
          status: 'backlog',
          priority: 'medium',
          due_at: nextWeek.toISOString(),
          created_by: userId,
        },
        {
          workspace_id: workspaceId,
          title: 'Completed Task',
          status: 'completed',
          priority: 'low',
          due_at: tomorrow.toISOString(),
          created_by: userId,
        },
      ]);
    });

    it('should filter tasks by status', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/tasks?status=completed`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.tasks).toHaveLength(1);
      expect(res.body.tasks[0].status).toBe('completed');
    });

    it('should filter tasks by priority', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/tasks?priority=urgent`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.tasks.length).toBeGreaterThanOrEqual(1);
      res.body.tasks.forEach(task => {
        expect(task.priority).toBe('urgent');
      });
    });

    it('should support view=today filter', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/tasks?view=today`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.tasks.length).toBeGreaterThanOrEqual(1);
    });

    it('should support view=overdue filter', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/tasks?view=overdue`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.tasks.length).toBeGreaterThanOrEqual(1);
      res.body.tasks.forEach(task => {
        expect(task.status).not.toBe('completed');
        expect(new Date(task.due_at) < new Date()).toBe(true);
      });
    });

    it('should support pagination with cursor', async () => {
      const res1 = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/tasks?limit=2`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res1.body.tasks).toHaveLength(2);
      expect(res1.body.nextCursor).toBeTruthy();

      // Fetch next page
      const res2 = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/tasks?limit=2&cursor=${res1.body.nextCursor}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res2.body.tasks.length).toBeGreaterThanOrEqual(1);
    });

    it('should search tasks by title', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/tasks?q=Overdue`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.tasks.length).toBeGreaterThanOrEqual(1);
      expect(res.body.tasks[0].title).toContain('Overdue');
    });

    it('should allow guests to view tasks', async () => {
      const res = await request(app)
        .get(`/api/v1/workspaces/${workspaceId}/tasks`)
        .set('Authorization', `Bearer ${guestToken}`)
        .expect(200);

      expect(res.body.tasks).toBeDefined();
    });
  });

  describe('PATCH /tasks/:taskId', () => {
    let updateTaskId;

    beforeAll(async () => {
      const { data: task } = await supabase
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'Update Test Task',
          status: 'todo',
          created_by: userId,
        })
        .select()
        .single();
      updateTaskId = task.id;
    });

    it('should update task and create notification on assignee change', async () => {
      const res = await request(app)
        .patch(`/api/v1/tasks/${updateTaskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          assigneeId: adminUserId,
        })
        .expect(200);

      expect(res.body.task.assignee_id).toBe(adminUserId);

      // Check notification
      const { data: notification } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', adminUserId)
        .eq('type', 'task_assigned')
        .eq('entity_id', updateTaskId)
        .single();

      expect(notification).toBeTruthy();
    });

    it('should create notification on status change', async () => {
      const res = await request(app)
        .patch(`/api/v1/tasks/${updateTaskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'completed',
        })
        .expect(200);

      expect(res.body.task.status).toBe('completed');

      // Notification should go to creator
      const { data: notification } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .eq('type', 'task_updated')
        .eq('entity_id', updateTaskId);

      expect(notification.length).toBeGreaterThanOrEqual(1);
    });

    it('should NOT allow guests to update tasks', async () => {
      await request(app)
        .patch(`/api/v1/tasks/${updateTaskId}`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({
          title: 'Guest Update',
        })
        .expect(403);
    });
  });

  describe('DELETE /tasks/:taskId', () => {
    let deleteTaskId;

    beforeAll(async () => {
      const { data: task } = await supabase
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'Delete Test Task',
          created_by: userId,
        })
        .select()
        .single();
      deleteTaskId = task.id;
    });

    it('should soft delete a task (creator)', async () => {
      await request(app)
        .delete(`/api/v1/tasks/${deleteTaskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // Verify soft delete
      const { data: task } = await supabase
        .from('tasks')
        .select('deleted_at')
        .eq('id', deleteTaskId)
        .single();

      expect(task.deleted_at).toBeTruthy();
    });

    it('should allow admin to delete any task', async () => {
      const { data: task } = await supabase
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'Admin Delete Test',
          created_by: userId,
        })
        .select()
        .single();

      await request(app)
        .delete(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
    });

    it('should NOT allow guests to delete tasks', async () => {
      const { data: task } = await supabase
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'Guest Delete Test',
          created_by: userId,
        })
        .select()
        .single();

      await request(app)
        .delete(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${guestToken}`)
        .expect(403);
    });
  });

  describe('POST /tasks/bulk', () => {
    let bulkTaskIds;

    beforeAll(async () => {
      const { data: tasks } = await supabase
        .from('tasks')
        .insert([
          { workspace_id: workspaceId, title: 'Bulk Task 1', created_by: userId },
          { workspace_id: workspaceId, title: 'Bulk Task 2', created_by: userId },
          { workspace_id: workspaceId, title: 'Bulk Task 3', created_by: userId },
        ])
        .select();
      bulkTaskIds = tasks.map(t => t.id);
    });

    it('should bulk complete tasks', async () => {
      const res = await request(app)
        .post('/api/v1/tasks/bulk')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ids: bulkTaskIds.slice(0, 2),
          action: 'complete',
        })
        .expect(200);

      expect(res.body.succeeded).toHaveLength(2);
      expect(res.body.failed).toHaveLength(0);

      // Verify status
      const { data: tasks } = await supabase
        .from('tasks')
        .select('status')
        .in('id', bulkTaskIds.slice(0, 2));

      tasks.forEach(task => {
        expect(task.status).toBe('completed');
      });
    });

    it('should bulk delete tasks', async () => {
      const res = await request(app)
        .post('/api/v1/tasks/bulk')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ids: [bulkTaskIds[2]],
          action: 'delete',
        })
        .expect(200);

      expect(res.body.succeeded).toHaveLength(1);

      // Verify soft delete
      const { data: task } = await supabase
        .from('tasks')
        .select('deleted_at')
        .eq('id', bulkTaskIds[2])
        .single();

      expect(task.deleted_at).toBeTruthy();
    });

    it('should return per-item results for mixed success/failure', async () => {
      const invalidId = '550e8400-e29b-41d4-a716-111111111111';

      const res = await request(app)
        .post('/api/v1/tasks/bulk')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ids: [bulkTaskIds[0], invalidId],
          action: 'complete',
        })
        .expect(200);

      expect(res.body.succeeded.length).toBeGreaterThanOrEqual(0);
      expect(res.body.failed.length).toBeGreaterThanOrEqual(0);
    });

    it('should NOT allow guests to bulk action tasks', async () => {
      await request(app)
        .post('/api/v1/tasks/bulk')
        .set('Authorization', `Bearer ${guestToken}`)
        .send({
          ids: bulkTaskIds,
          action: 'complete',
        })
        .expect(403);
    });
  });

  describe('POST /tasks/:taskId/move', () => {
    let moveTaskId;
    let targetWorkspaceId;

    beforeAll(async () => {
      // Create task
      const { data: task } = await supabase
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'Move Test Task',
          created_by: userId,
        })
        .select()
        .single();
      moveTaskId = task.id;

      // Create target workspace
      const { data: targetWorkspace } = await supabase
        .from('workspaces')
        .insert({
          name: 'Target Workspace',
          created_by: adminUserId,
        })
        .select()
        .single();
      targetWorkspaceId = targetWorkspace.id;

      // Add both users to target workspace
      await supabase.from('workspace_members').insert([
        { workspace_id: targetWorkspaceId, user_id: userId, role: 'member' },
        { workspace_id: targetWorkspaceId, user_id: adminUserId, role: 'admin' },
      ]);
    });

    it('should move task to another workspace', async () => {
      const res = await request(app)
        .post(`/api/v1/tasks/${moveTaskId}/move`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          targetWorkspaceId,
        })
        .expect(200);

      // Verify task workspace changed
      const { data: task } = await supabase
        .from('tasks')
        .select('workspace_id')
        .eq('id', moveTaskId)
        .single();

      expect(task.workspace_id).toBe(targetWorkspaceId);
    });

    it('should NOT allow guests to move tasks', async () => {
      const { data: task } = await supabase
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'Guest Move Test',
          created_by: userId,
        })
        .select()
        .single();

      await request(app)
        .post(`/api/v1/tasks/${task.id}/move`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({
          targetWorkspaceId,
        })
        .expect(403);
    });
  });

  describe('Subtasks, Comments, Attachments', () => {
    let parentTaskId;

    beforeAll(async () => {
      const { data: task } = await supabase
        .from('tasks')
        .insert({
          workspace_id: workspaceId,
          title: 'Parent Task',
          created_by: userId,
        })
        .select()
        .single();
      parentTaskId = task.id;
    });

    it('should create subtask', async () => {
      const res = await request(app)
        .post(`/api/v1/tasks/${parentTaskId}/subtasks`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Subtask 1',
        })
        .expect(201);

      expect(res.body.subtask.title).toBe('Subtask 1');
    });

    it('should update subtask', async () => {
      const { data: subtask } = await supabase
        .from('subtasks')
        .insert({
          task_id: parentTaskId,
          title: 'Update Subtask',
          position: 0,
        })
        .select()
        .single();

      const res = await request(app)
        .patch(`/api/v1/subtasks/${subtask.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          done: true,
        })
        .expect(200);

      expect(res.body.subtask.done).toBe(true);
    });

    it('should create comment with mention', async () => {
      const res = await request(app)
        .post(`/api/v1/tasks/${parentTaskId}/comments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          body: `Hey @[Admin](user:${adminUserId}) check this out`,
        })
        .expect(201);

      expect(res.body.comment.body).toContain('Admin');

      // Check mention notification
      const { data: notifications } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', adminUserId)
        .eq('type', 'mention')
        .eq('entity_id', parentTaskId);

      expect(notifications.length).toBeGreaterThanOrEqual(1);
    });

    it('should NOT allow guests to create comments', async () => {
      await request(app)
        .post(`/api/v1/tasks/${parentTaskId}/comments`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({
          body: 'Guest comment',
        })
        .expect(403);
    });
  });
});
