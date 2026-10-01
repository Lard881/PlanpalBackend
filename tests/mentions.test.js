import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { createApp } from '../src/app.js';
import { supabase, supabaseAdmin } from '../src/lib/supabase.js';

const app = createApp();

describe('Mentions API', () => {
  let authToken1, authToken2, authToken3;
  let user1Id, user2Id, user3Id;
  let workspaceId, projectId, taskId, commentId;
  let mentionId;

  beforeAll(async () => {
    // Create test users
    const timestamp = Date.now();
    
    // User 1
    const { data: auth1 } = await supabase.auth.signUp({
      email: `mentions-user1-${timestamp}@example.com`,
      password: 'TestPassword123!',
    });
    authToken1 = auth1.session.access_token;
    user1Id = auth1.user.id;
    
    // User 2
    const { data: auth2 } = await supabase.auth.signUp({
      email: `mentions-user2-${timestamp}@example.com`,
      password: 'TestPassword123!',
    });
    authToken2 = auth2.session.access_token;
    user2Id = auth2.user.id;
    
    // User 3
    const { data: auth3 } = await supabase.auth.signUp({
      email: `mentions-user3-${timestamp}@example.com`,
      password: 'TestPassword123!',
    });
    authToken3 = auth3.session.access_token;
    user3Id = auth3.user.id;
    
    // Create workspace
    const { data: workspace } = await supabaseAdmin
      .from('workspaces')
      .insert({
        name: 'Mentions Test Workspace',
        created_by: user1Id,
      })
      .select()
      .single();
    workspaceId = workspace.id;
    
    // Add members to workspace
    await supabaseAdmin.from('workspace_members').insert([
      { workspace_id: workspaceId, user_id: user1Id, role: 'admin' },
      { workspace_id: workspaceId, user_id: user2Id, role: 'member' },
      { workspace_id: workspaceId, user_id: user3Id, role: 'member' },
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
        description: 'Task description',
        created_by: user1Id,
        assigned_to: user1Id,
      })
      .select()
      .single();
    taskId = task.id;
    
    // Create comment
    const { data: comment } = await supabaseAdmin
      .from('comments')
      .insert({
        task_id: taskId,
        user_id: user1Id,
        content: 'Test comment',
      })
      .select()
      .single();
    commentId = comment.id;
  });

  afterAll(async () => {
    // Cleanup
    await supabaseAdmin.from('mentions').delete().eq('task_id', taskId);
    await supabaseAdmin.from('comments').delete().eq('task_id', taskId);
    await supabaseAdmin.from('tasks').delete().eq('id', taskId);
    await supabaseAdmin.from('projects').delete().eq('id', projectId);
    await supabaseAdmin.from('workspace_members').delete().eq('workspace_id', workspaceId);
    await supabaseAdmin.from('workspaces').delete().eq('id', workspaceId);
    await supabaseAdmin.auth.admin.deleteUser(user1Id);
    await supabaseAdmin.auth.admin.deleteUser(user2Id);
    await supabaseAdmin.auth.admin.deleteUser(user3Id);
  });

  beforeEach(async () => {
    // Clean mentions before each test
    await supabaseAdmin.from('mentions').delete().eq('task_id', taskId);
  });

  describe('POST /api/v1/mentions', () => {
    it('should create a task mention', async () => {
      const res = await request(app)
        .post('/api/v1/mentions')
        .set('Authorization', `Bearer ${authToken1}`)
        .send({
          mention_type: 'task',
          task_id: taskId,
          mentioned_user_id: user2Id,
        });

      expect(res.status).toBe(201);
      expect(res.body.mention).toBeDefined();
      expect(res.body.mention.mention_type).toBe('task');
      expect(res.body.mention.task_id).toBe(taskId);
      expect(res.body.mention.mentioned_user_id).toBe(user2Id);
      expect(res.body.mention.mentioned_by_user_id).toBe(user1Id);
      expect(res.body.mention.is_read).toBe(false);
      expect(res.body.mention.id).toBeDefined();
      expect(res.body.mention.created_at).toBeDefined();
      
      mentionId = res.body.mention.id;
    });

    it('should create a comment mention', async () => {
      const res = await request(app)
        .post('/api/v1/mentions')
        .set('Authorization', `Bearer ${authToken1}`)
        .send({
          mention_type: 'comment',
          task_id: taskId,
          comment_id: commentId,
          mentioned_user_id: user2Id,
        });

      expect(res.status).toBe(201);
      expect(res.body.mention.mention_type).toBe('comment');
      expect(res.body.mention.comment_id).toBe(commentId);
    });

    it('should reject mention without required fields', async () => {
      const res = await request(app)
        .post('/api/v1/mentions')
        .set('Authorization', `Bearer ${authToken1}`)
        .send({
          mention_type: 'task',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('should reject comment mention without comment_id', async () => {
      const res = await request(app)
        .post('/api/v1/mentions')
        .set('Authorization', `Bearer ${authToken1}`)
        .send({
          mention_type: 'comment',
          task_id: taskId,
          mentioned_user_id: user2Id,
        });

      expect(res.status).toBe(400);
    });

    it('should reject mention for non-existent task', async () => {
      const res = await request(app)
        .post('/api/v1/mentions')
        .set('Authorization', `Bearer ${authToken1}`)
        .send({
          mention_type: 'task',
          task_id: '00000000-0000-0000-0000-000000000000',
          mentioned_user_id: user2Id,
        });

      expect(res.status).toBe(404);
    });

    it('should prevent duplicate mentions', async () => {
      // Create first mention
      await request(app)
        .post('/api/v1/mentions')
        .set('Authorization', `Bearer ${authToken1}`)
        .send({
          mention_type: 'task',
          task_id: taskId,
          mentioned_user_id: user2Id,
        });

      // Try to create duplicate
      const res = await request(app)
        .post('/api/v1/mentions')
        .set('Authorization', `Bearer ${authToken1}`)
        .send({
          mention_type: 'task',
          task_id: taskId,
          mentioned_user_id: user2Id,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/duplicate|already exists/i);
    });
  });

  describe('GET /api/v1/mentions', () => {
    beforeEach(async () => {
      // Create test mentions
      await supabaseAdmin.from('mentions').insert([
        {
          mention_type: 'task',
          task_id: taskId,
          mentioned_by_user_id: user1Id,
          mentioned_user_id: user2Id,
          is_read: false,
        },
        {
          mention_type: 'comment',
          task_id: taskId,
          comment_id: commentId,
          mentioned_by_user_id: user1Id,
          mentioned_user_id: user2Id,
          is_read: true,
        },
        {
          mention_type: 'task',
          task_id: taskId,
          mentioned_by_user_id: user3Id,
          mentioned_user_id: user2Id,
          is_read: false,
        },
      ]);
    });

    it('should get all mentions for user', async () => {
      const res = await request(app)
        .get('/api/v1/mentions')
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.mentions)).toBe(true);
      expect(res.body.mentions.length).toBe(3);
      expect(res.body.total).toBe(3);
      expect(res.body.mentions.every(m => m.mentioned_user_id === user2Id)).toBe(true);
    });

    it('should filter unread mentions', async () => {
      const res = await request(app)
        .get('/api/v1/mentions?is_read=false')
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(200);
      expect(res.body.mentions.length).toBe(2);
      expect(res.body.mentions.every(m => m.is_read === false)).toBe(true);
    });

    it('should filter read mentions', async () => {
      const res = await request(app)
        .get('/api/v1/mentions?is_read=true')
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(200);
      expect(res.body.mentions.length).toBe(1);
      expect(res.body.mentions.every(m => m.is_read === true)).toBe(true);
    });

    it('should respect pagination', async () => {
      const res = await request(app)
        .get('/api/v1/mentions?limit=2&offset=1')
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(200);
      expect(res.body.mentions.length).toBe(2);
      expect(res.body.limit).toBe(2);
      expect(res.body.offset).toBe(1);
      expect(res.body.total).toBe(3);
    });

    it('should return empty array if no mentions', async () => {
      const res = await request(app)
        .get('/api/v1/mentions')
        .set('Authorization', `Bearer ${authToken3}`);

      expect(res.status).toBe(200);
      expect(res.body.mentions.length).toBe(0);
      expect(res.body.total).toBe(0);
    });

    it('should include mentioned_by user details', async () => {
      const res = await request(app)
        .get('/api/v1/mentions')
        .set('Authorization', `Bearer ${authToken2}`);

      const mention = res.body.mentions[0];
      expect(mention.mentioned_by_user_name).toBeDefined();
      expect(mention.mentioned_by_user_email).toBeDefined();
    });
  });

  describe('PUT /api/v1/mentions/:id/read', () => {
    let unreadMentionId;

    beforeEach(async () => {
      const { data } = await supabaseAdmin
        .from('mentions')
        .insert({
          mention_type: 'task',
          task_id: taskId,
          mentioned_by_user_id: user1Id,
          mentioned_user_id: user2Id,
          is_read: false,
        })
        .select()
        .single();
      unreadMentionId = data.id;
    });

    it('should mark mention as read', async () => {
      const res = await request(app)
        .put(`/api/v1/mentions/${unreadMentionId}/read`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(200);
      expect(res.body.mention.id).toBe(unreadMentionId);
      expect(res.body.mention.is_read).toBe(true);
    });

    it('should reject marking another user\'s mention', async () => {
      const res = await request(app)
        .put(`/api/v1/mentions/${unreadMentionId}/read`)
        .set('Authorization', `Bearer ${authToken3}`);

      expect(res.status).toBe(403);
    });

    it('should return 404 for non-existent mention', async () => {
      const res = await request(app)
        .put('/api/v1/mentions/00000000-0000-0000-0000-000000000000/read')
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/v1/mentions/read-all', () => {
    beforeEach(async () => {
      await supabaseAdmin.from('mentions').insert([
        {
          mention_type: 'task',
          task_id: taskId,
          mentioned_by_user_id: user1Id,
          mentioned_user_id: user2Id,
          is_read: false,
        },
        {
          mention_type: 'task',
          task_id: taskId,
          mentioned_by_user_id: user3Id,
          mentioned_user_id: user2Id,
          is_read: false,
        },
        {
          mention_type: 'task',
          task_id: taskId,
          mentioned_by_user_id: user1Id,
          mentioned_user_id: user2Id,
          is_read: true,
        },
      ]);
    });

    it('should mark all unread mentions as read', async () => {
      const res = await request(app)
        .put('/api/v1/mentions/read-all')
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(200);
      expect(res.body.updated_count).toBe(2);
      
      // Verify all mentions are now read
      const verifyRes = await request(app)
        .get('/api/v1/mentions?is_read=false')
        .set('Authorization', `Bearer ${authToken2}`);
      
      expect(verifyRes.body.mentions.length).toBe(0);
    });

    it('should return 0 if no unread mentions', async () => {
      // First mark all as read
      await request(app)
        .put('/api/v1/mentions/read-all')
        .set('Authorization', `Bearer ${authToken2}`);

      // Try again
      const res = await request(app)
        .put('/api/v1/mentions/read-all')
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.body.updated_count).toBe(0);
    });
  });

  describe('DELETE /api/v1/mentions/:id', () => {
    let mentionToDeleteId;

    beforeEach(async () => {
      const { data } = await supabaseAdmin
        .from('mentions')
        .insert({
          mention_type: 'task',
          task_id: taskId,
          mentioned_by_user_id: user1Id,
          mentioned_user_id: user2Id,
          is_read: false,
        })
        .select()
        .single();
      mentionToDeleteId = data.id;
    });

    it('should delete mention', async () => {
      const res = await request(app)
        .delete(`/api/v1/mentions/${mentionToDeleteId}`)
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(204);
      
      // Verify deletion
      const { data } = await supabaseAdmin
        .from('mentions')
        .select()
        .eq('id', mentionToDeleteId);
      
      expect(data.length).toBe(0);
    });

    it('should reject deleting another user\'s mention', async () => {
      const res = await request(app)
        .delete(`/api/v1/mentions/${mentionToDeleteId}`)
        .set('Authorization', `Bearer ${authToken3}`);

      expect(res.status).toBe(403);
    });

    it('should return 404 for non-existent mention', async () => {
      const res = await request(app)
        .delete('/api/v1/mentions/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${authToken2}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/mentions/users/search', () => {
    it('should search users by name', async () => {
      const res = await request(app)
        .get('/api/v1/mentions/users/search?q=mentions-user2')
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.users.some(u => u.id === user2Id)).toBe(true);
    });

    it('should filter by workspace', async () => {
      const res = await request(app)
        .get(`/api/v1/mentions/users/search?q=mentions&workspace_id=${workspaceId}`)
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.users.every(u => 
        [user1Id, user2Id, user3Id].includes(u.id)
      )).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const res = await request(app)
        .get('/api/v1/mentions/users/search?q=mentions&limit=2')
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(200);
      expect(res.body.users.length).toBeLessThanOrEqual(2);
    });

    it('should reject query shorter than 2 characters', async () => {
      const res = await request(app)
        .get('/api/v1/mentions/users/search?q=U')
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(400);
    });

    it('should require query parameter', async () => {
      const res = await request(app)
        .get('/api/v1/mentions/users/search')
        .set('Authorization', `Bearer ${authToken1}`);

      expect(res.status).toBe(400);
    });
  });

  describe('Authentication', () => {
    it('should reject requests without token', async () => {
      const res = await request(app)
        .get('/api/v1/mentions');

      expect(res.status).toBe(401);
    });

    it('should reject requests with invalid token', async () => {
      const res = await request(app)
        .get('/api/v1/mentions')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
    });
  });

  describe('Automatic Mention Extraction', () => {
    it('should extract mentions from task description', async () => {
      const { data: taskWithMention } = await supabaseAdmin
        .from('tasks')
        .insert({
          project_id: projectId,
          title: 'Task with Mention',
          description: `Hey @[${user2Id}] please review this`,
          created_by: user1Id,
          assigned_to: user1Id,
        })
        .select()
        .single();

      // Wait a bit for trigger to execute
      await new Promise(resolve => setTimeout(resolve, 500));

      const { data: mentions } = await supabaseAdmin
        .from('mentions')
        .select()
        .eq('task_id', taskWithMention.id)
        .eq('mention_type', 'task')
        .eq('mentioned_user_id', user2Id);

      expect(mentions.length).toBe(1);
      expect(mentions[0].mentioned_by_user_id).toBe(user1Id);
      
      // Cleanup
      await supabaseAdmin.from('tasks').delete().eq('id', taskWithMention.id);
    });

    it('should extract mentions from comment', async () => {
      const { data: commentWithMention } = await supabaseAdmin
        .from('comments')
        .insert({
          task_id: taskId,
          user_id: user1Id,
          content: `cc @[${user3Id}] for visibility`,
        })
        .select()
        .single();

      // Wait for trigger
      await new Promise(resolve => setTimeout(resolve, 500));

      const { data: mentions } = await supabaseAdmin
        .from('mentions')
        .select()
        .eq('comment_id', commentWithMention.id)
        .eq('mention_type', 'comment')
        .eq('mentioned_user_id', user3Id);

      expect(mentions.length).toBe(1);
      
      // Cleanup
      await supabaseAdmin.from('comments').delete().eq('id', commentWithMention.id);
    });

    it('should extract multiple mentions', async () => {
      const { data: commentWithMultiple } = await supabaseAdmin
        .from('comments')
        .insert({
          task_id: taskId,
          user_id: user1Id,
          content: `Hey @[${user2Id}] and @[${user3Id}], please review`,
        })
        .select()
        .single();

      // Wait for trigger
      await new Promise(resolve => setTimeout(resolve, 500));

      const { data: mentions } = await supabaseAdmin
        .from('mentions')
        .select()
        .eq('comment_id', commentWithMultiple.id)
        .eq('mention_type', 'comment');

      expect(mentions.length).toBe(2);
      expect(mentions.some(m => m.mentioned_user_id === user2Id)).toBe(true);
      expect(mentions.some(m => m.mentioned_user_id === user3Id)).toBe(true);
      
      // Cleanup
      await supabaseAdmin.from('comments').delete().eq('id', commentWithMultiple.id);
    });

    it('should handle duplicate mentions in same text', async () => {
      const { data: commentWithDuplicates } = await supabaseAdmin
        .from('comments')
        .insert({
          task_id: taskId,
          user_id: user1Id,
          content: `@[${user2Id}] please review. Thanks @[${user2Id}]!`,
        })
        .select()
        .single();

      // Wait for trigger
      await new Promise(resolve => setTimeout(resolve, 500));

      const { data: mentions } = await supabaseAdmin
        .from('mentions')
        .select()
        .eq('comment_id', commentWithDuplicates.id)
        .eq('mention_type', 'comment')
        .eq('mentioned_user_id', user2Id);

      expect(mentions.length).toBe(1);
      
      // Cleanup
      await supabaseAdmin.from('comments').delete().eq('id', commentWithDuplicates.id);
    });
  });
});
