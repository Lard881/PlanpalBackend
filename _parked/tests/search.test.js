import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createTestSupabaseClient } from './helpers/supabase.js';
import { createTestUser, createTestWorkspace, generateToken } from './helpers/auth.js';

describe('Search API', () => {
  let app;
  let supabase;
  
  // Test users
  let user1, user2, guestUser;
  let user1Token, user2Token, guestToken;
  
  // Test workspaces
  let workspace1, workspace2;
  
  // Test data IDs
  let task1Id, task2Id, task3Id;
  let doc1Id, doc2Id;

  beforeAll(async () => {
    app = createApp();
    supabase = createTestSupabaseClient();
    
    // Create test users
    user1 = await createTestUser(supabase, 'user1@test.com');
    user2 = await createTestUser(supabase, 'user2@test.com');
    guestUser = await createTestUser(supabase, 'guest@test.com');
    
    user1Token = generateToken(user1.id);
    user2Token = generateToken(user2.id);
    guestToken = generateToken(guestUser.id);
    
    // Create workspaces
    workspace1 = await createTestWorkspace(supabase, user1.id, 'Engineering Team');
    workspace2 = await createTestWorkspace(supabase, user2.id, 'Design Team');
    
    // Add guest to workspace1 with guest role
    await supabase.from('workspace_members').insert({
      workspace_id: workspace1.id,
      user_id: guestUser.id,
      role: 'guest',
    });
  });

  beforeEach(async () => {
    // Clean up test data
    await supabase.from('tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('documents').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    
    // Create test tasks
    const tasks = await supabase.from('tasks').insert([
      {
        title: 'Project Planning',
        description: 'Plan the new project timeline',
        workspace_id: workspace1.id,
        created_by: user1.id,
        status: 'todo',
      },
      {
        title: 'Design Review',
        description: 'Review project designs',
        workspace_id: workspace1.id,
        created_by: user1.id,
        status: 'in_progress',
      },
      {
        title: 'Private Task',
        description: 'This is a private task in workspace 2',
        workspace_id: workspace2.id,
        created_by: user2.id,
        status: 'todo',
      },
    ]).select();
    
    [task1Id, task2Id, task3Id] = tasks.data.map(t => t.id);
    
    // Create test documents
    const docs = await supabase.from('documents').insert([
      {
        title: 'Project Specification',
        content: 'This document outlines the project requirements and timeline for Q4',
        workspace_id: workspace1.id,
        created_by: user1.id,
      },
      {
        title: 'Design Guidelines',
        content: 'Guidelines for the design system',
        workspace_id: workspace2.id,
        created_by: user2.id,
      },
    ]).select();
    
    [doc1Id, doc2Id] = docs.data.map(d => d.id);
  });

  afterAll(async () => {
    // Cleanup
    if (workspace1) await supabase.from('workspaces').delete().eq('id', workspace1.id);
    if (workspace2) await supabase.from('workspaces').delete().eq('id', workspace2.id);
    if (user1) await supabase.auth.admin.deleteUser(user1.id);
    if (user2) await supabase.auth.admin.deleteUser(user2.id);
    if (guestUser) await supabase.auth.admin.deleteUser(guestUser.id);
  });

  describe('GET /api/v1/search', () => {
    describe('Authentication', () => {
      it('should require authentication', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .query({ query: 'project' });

        expect(response.status).toBe(401);
      });

      it('should reject invalid tokens', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', 'Bearer invalid-token')
          .query({ query: 'project' });

        expect(response.status).toBe(401);
      });
    });

    describe('Validation', () => {
      it('should require query parameter', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`);

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('query');
      });

      it('should enforce minimum query length (2 characters)', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'a' });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('at least 2 characters');
      });

      it('should enforce maximum query length (100 characters)', async () => {
        const longQuery = 'a'.repeat(101);
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: longQuery });

        expect(response.status).toBe(400);
      });

      it('should validate type parameter', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'test', type: 'invalid' });

        expect(response.status).toBe(400);
      });

      it('should validate workspaceId format', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'test', workspaceId: 'not-a-uuid' });

        expect(response.status).toBe(400);
      });
    });

    describe('Basic Search', () => {
      it('should search all types by default', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'project' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('tasks');
        expect(response.body).toHaveProperty('documents');
        expect(response.body).toHaveProperty('people');
        expect(response.body).toHaveProperty('totalCount');
      });

      it('should find tasks by title', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'project' });

        expect(response.status).toBe(200);
        expect(response.body.tasks.items.length).toBeGreaterThan(0);
        expect(response.body.tasks.items[0].title).toContain('Project');
      });

      it('should find tasks by description', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'timeline' });

        expect(response.status).toBe(200);
        expect(response.body.tasks.items.length).toBeGreaterThan(0);
        expect(response.body.tasks.items[0].description).toContain('timeline');
      });

      it('should find documents by title', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'specification' });

        expect(response.status).toBe(200);
        expect(response.body.documents.items.length).toBeGreaterThan(0);
        expect(response.body.documents.items[0].title).toContain('Specification');
      });

      it('should find documents by content', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'requirements' });

        expect(response.status).toBe(200);
        expect(response.body.documents.items.length).toBeGreaterThan(0);
        expect(response.body.documents.items[0].content).toContain('requirements');
      });

      it('should be case-insensitive', async () => {
        const lowerResponse = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'project' });

        const upperResponse = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'PROJECT' });

        expect(lowerResponse.body.totalCount).toBe(upperResponse.body.totalCount);
      });
    });

    describe('Type Filtering', () => {
      it('should filter by tasks only', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'project', type: 'tasks' });

        expect(response.status).toBe(200);
        expect(response.body.tasks.items.length).toBeGreaterThan(0);
        expect(response.body.documents.count).toBe(0);
        expect(response.body.people.count).toBe(0);
      });

      it('should filter by documents only', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'project', type: 'documents' });

        expect(response.status).toBe(200);
        expect(response.body.documents.items.length).toBeGreaterThan(0);
        expect(response.body.tasks.count).toBe(0);
        expect(response.body.people.count).toBe(0);
      });

      it('should filter by people only', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: user1.full_name, type: 'people' });

        expect(response.status).toBe(200);
        expect(response.body.people.items.length).toBeGreaterThan(0);
        expect(response.body.tasks.count).toBe(0);
        expect(response.body.documents.count).toBe(0);
      });
    });

    describe('Workspace Filtering', () => {
      it('should search all workspaces by default', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'project' });

        expect(response.status).toBe(200);
        expect(response.body.tasks.items.length).toBeGreaterThan(0);
      });

      it('should filter by specific workspace', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'project', workspaceId: workspace1.id });

        expect(response.status).toBe(200);
        expect(response.body.tasks.items.every(t => t.workspaceId === workspace1.id)).toBe(true);
      });

      it('should return empty results for inaccessible workspace', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'private', workspaceId: workspace2.id });

        expect(response.status).toBe(200);
        expect(response.body.tasks.count).toBe(0);
        expect(response.body.documents.count).toBe(0);
      });
    });

    describe('RLS (Row Level Security)', () => {
      it('should only return tasks from accessible workspaces', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'task' });

        expect(response.status).toBe(200);
        
        // User1 should only see tasks from workspace1
        const taskWorkspaces = response.body.tasks.items.map(t => t.workspaceId);
        expect(taskWorkspaces.every(id => id === workspace1.id)).toBe(true);
      });

      it('should not leak data between users', async () => {
        // User1 creates a task
        await supabase.from('tasks').insert({
          title: 'Secret Project',
          description: 'Confidential information',
          workspace_id: workspace1.id,
          created_by: user1.id,
          status: 'todo',
        });

        // User2 searches for it
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user2Token}`)
          .query({ query: 'secret' });

        expect(response.status).toBe(200);
        expect(response.body.tasks.items.length).toBe(0);
      });

      it('should respect workspace membership for documents', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'guidelines' });

        expect(response.status).toBe(200);
        // User1 shouldn't see workspace2 documents
        expect(response.body.documents.count).toBe(0);
      });

      it('should allow access to shared workspaces', async () => {
        // Add user2 to workspace1
        await supabase.from('workspace_members').insert({
          workspace_id: workspace1.id,
          user_id: user2.id,
          role: 'member',
        });

        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user2Token}`)
          .query({ query: 'project' });

        expect(response.status).toBe(200);
        // User2 should now see workspace1 tasks
        expect(response.body.tasks.items.some(t => t.workspaceId === workspace1.id)).toBe(true);
      });
    });

    describe('Guest User Limits', () => {
      it('should allow guest to search their workspace', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${guestToken}`)
          .query({ query: 'project' });

        expect(response.status).toBe(200);
        expect(response.body.tasks.items.length).toBeGreaterThan(0);
      });

      it('should respect guest workspace boundaries', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${guestToken}`)
          .query({ query: 'private' });

        expect(response.status).toBe(200);
        // Guest shouldn't see workspace2 content
        expect(response.body.tasks.count).toBe(0);
      });

      it('should show guest only workspace members', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${guestToken}`)
          .query({ query: user1.full_name, type: 'people' });

        expect(response.status).toBe(200);
        // Guest should only see people in workspace1
        const people = response.body.people.items;
        expect(people.every(p => 
          p.workspaces.some(w => w.id === workspace1.id)
        )).toBe(true);
      });
    });

    describe('People Deduplication', () => {
      it('should deduplicate people across workspaces', async () => {
        // Add user1 to both workspaces
        await supabase.from('workspace_members').insert({
          workspace_id: workspace2.id,
          user_id: user1.id,
          role: 'member',
        });

        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: user1.full_name.split(' ')[0], type: 'people' });

        expect(response.status).toBe(200);
        
        // Should appear only once
        const userIds = response.body.people.items.map(p => p.id);
        const uniqueIds = [...new Set(userIds)];
        expect(userIds.length).toBe(uniqueIds.length);
      });

      it('should include all workspaces for deduplicated person', async () => {
        // Add user1 to workspace2
        await supabase.from('workspace_members').insert({
          workspace_id: workspace2.id,
          user_id: user1.id,
          role: 'admin',
        });

        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: user1.email, type: 'people' });

        expect(response.status).toBe(200);
        
        const person = response.body.people.items.find(p => p.id === user1.id);
        expect(person).toBeDefined();
        expect(person.workspaces.length).toBe(2);
        expect(person.workspaces.map(w => w.id)).toContain(workspace1.id);
        expect(person.workspaces.map(w => w.id)).toContain(workspace2.id);
      });

      it('should not duplicate people in search results', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'test.com', type: 'people' });

        expect(response.status).toBe(200);
        
        // Check no duplicate IDs
        const ids = response.body.people.items.map(p => p.id);
        const uniqueIds = new Set(ids);
        expect(ids.length).toBe(uniqueIds.size);
      });
    });

    describe('Match Scoring', () => {
      it('should score exact matches highest', async () => {
        await supabase.from('tasks').insert({
          title: 'project',
          description: 'test',
          workspace_id: workspace1.id,
          created_by: user1.id,
          status: 'todo',
        });

        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'project' });

        expect(response.status).toBe(200);
        const topResult = response.body.tasks.items[0];
        expect(topResult.matchScore).toBe(100);
      });

      it('should sort results by match score', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'project' });

        expect(response.status).toBe(200);
        const scores = response.body.tasks.items.map(t => t.matchScore);
        
        // Check descending order
        for (let i = 1; i < scores.length; i++) {
          expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
        }
      });

      it('should prioritize title over description matches', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'project' });

        expect(response.status).toBe(200);
        const titleMatch = response.body.tasks.items.find(t => 
          t.title.toLowerCase().includes('project')
        );
        const descMatch = response.body.tasks.items.find(t => 
          !t.title.toLowerCase().includes('project') &&
          t.description?.toLowerCase().includes('project')
        );

        if (titleMatch && descMatch) {
          expect(titleMatch.matchScore).toBeGreaterThan(descMatch.matchScore);
        }
      });
    });

    describe('Pagination', () => {
      it('should respect limit parameter', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'test', limit: 1 });

        expect(response.status).toBe(200);
        expect(response.body.tasks.items.length).toBeLessThanOrEqual(1);
      });

      it('should respect offset parameter', async () => {
        const page1 = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'project', limit: 1, offset: 0 });

        const page2 = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'project', limit: 1, offset: 1 });

        expect(page1.status).toBe(200);
        expect(page2.status).toBe(200);

        if (page1.body.tasks.items.length > 0 && page2.body.tasks.items.length > 0) {
          expect(page1.body.tasks.items[0].id).not.toBe(page2.body.tasks.items[0].id);
        }
      });

      it('should enforce maximum limit', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'test', limit: 1000 });

        expect(response.status).toBe(400);
      });
    });

    describe('Empty Results', () => {
      it('should return empty arrays for no matches', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'nonexistent' });

        expect(response.status).toBe(200);
        expect(response.body.tasks.items).toEqual([]);
        expect(response.body.documents.items).toEqual([]);
        expect(response.body.people.items).toEqual([]);
        expect(response.body.totalCount).toBe(0);
      });

      it('should handle special characters safely', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: '%$#@!' });

        expect(response.status).toBe(200);
        expect(response.body.totalCount).toBeGreaterThanOrEqual(0);
      });
    });

    describe('Performance', () => {
      it('should complete search within reasonable time', async () => {
        const start = Date.now();
        
        const response = await request(app)
          .get('/api/v1/search')
          .set('Authorization', `Bearer ${user1Token}`)
          .query({ query: 'project' });

        const duration = Date.now() - start;
        
        expect(response.status).toBe(200);
        expect(duration).toBeLessThan(1000); // Should complete in < 1 second
      });
    });
  });
});
