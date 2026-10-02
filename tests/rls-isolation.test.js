/**
 * RLS Isolation Test Suite
 * 
 * Tests proving:
 * 1. A Member of workspace A cannot read anything in workspace B
 * 2. A Guest cannot read unassigned tasks
 * 3. Nobody can read another user's notifications
 * 
 * Run against a separate test Supabase project.
 */

import { createClient } from '@supabase/supabase-js';
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';

const SUPABASE_URL = process.env.TEST_SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY || 'your-anon-key';
const SUPABASE_SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_KEY || 'your-service-key';

describe('RLS Isolation Tests', () => {
  let adminClient;
  let userAClient;
  let userBClient;
  let guestClient;
  
  let userAId, userBId, guestUserId;
  let workspaceAId, workspaceBId;
  let taskInAId, taskInBId, unassignedTaskId;
  let notificationAId, notificationBId;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Create test users via Supabase Auth (bypassing RLS for setup)
    const { data: userA } = await adminClient.auth.admin.createUser({
      email: 'usera@test.com',
      password: 'password123',
      email_confirm: true,
    });
    userAId = userA.user.id;

    const { data: userB } = await adminClient.auth.admin.createUser({
      email: 'userb@test.com',
      password: 'password123',
      email_confirm: true,
    });
    userBId = userB.user.id;

    const { data: guestUser } = await adminClient.auth.admin.createUser({
      email: 'guest@test.com',
      password: 'password123',
      email_confirm: true,
    });
    guestUserId = guestUser.user.id;

    // Sign in as each user
    const { data: sessionA } = await adminClient.auth.signInWithPassword({
      email: 'usera@test.com',
      password: 'password123',
    });
    userAClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${sessionA.session.access_token}` } },
    });

    const { data: sessionB } = await adminClient.auth.signInWithPassword({
      email: 'userb@test.com',
      password: 'password123',
    });
    userBClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${sessionB.session.access_token}` } },
    });

    const { data: sessionGuest } = await adminClient.auth.signInWithPassword({
      email: 'guest@test.com',
      password: 'password123',
    });
    guestClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${sessionGuest.session.access_token}` } },
    });

    // Get personal workspaces (auto-created by trigger)
    const { data: wsA } = await userAClient
      .from('workspaces')
      .select('id')
      .eq('type', 'personal')
      .single();
    workspaceAId = wsA.id;

    const { data: wsB } = await userBClient
      .from('workspaces')
      .select('id')
      .eq('type', 'personal')
      .single();
    workspaceBId = wsB.id;

    // Create team workspace and add guest
    const { data: teamWs } = await userAClient
      .from('workspaces')
      .insert({ name: 'Team Workspace', type: 'team', created_by: userAId })
      .select()
      .single();
    const teamWsId = teamWs.id;

    // Add guest to team workspace
    await adminClient
      .from('workspace_members')
      .insert({ workspace_id: teamWsId, user_id: guestUserId, role: 'guest' });

    // Create tasks
    const { data: taskA } = await userAClient
      .from('tasks')
      .insert({
        title: 'Task in Workspace A',
        workspace_id: workspaceAId,
        created_by: userAId,
      })
      .select()
      .single();
    taskInAId = taskA.id;

    const { data: taskB } = await userBClient
      .from('tasks')
      .insert({
        title: 'Task in Workspace B',
        workspace_id: workspaceBId,
        created_by: userBId,
      })
      .select()
      .single();
    taskInBId = taskB.id;

    // Create unassigned task in team workspace (guest should NOT see it)
    const { data: unassignedTask } = await userAClient
      .from('tasks')
      .insert({
        title: 'Unassigned Task',
        workspace_id: teamWsId,
        created_by: userAId,
        assignee_id: null,
      })
      .select()
      .single();
    unassignedTaskId = unassignedTask.id;

    // Create notifications
    await adminClient.from('notifications').insert([
      {
        user_id: userAId,
        workspace_id: workspaceAId,
        type: 'system',
        title: 'Notification for User A',
      },
      {
        user_id: userBId,
        workspace_id: workspaceBId,
        type: 'system',
        title: 'Notification for User B',
      },
    ]);
  });

  afterAll(async () => {
    // Cleanup test users
    await adminClient.auth.admin.deleteUser(userAId);
    await adminClient.auth.admin.deleteUser(userBId);
    await adminClient.auth.admin.deleteUser(guestUserId);
  });

  describe('Workspace Isolation', () => {
    test('User A cannot read tasks in Workspace B', async () => {
      const { data, error } = await userAClient
        .from('tasks')
        .select('*')
        .eq('id', taskInBId);

      expect(data).toEqual([]);
      expect(error).toBeNull();
    });

    test('User B cannot read tasks in Workspace A', async () => {
      const { data, error } = await userBClient
        .from('tasks')
        .select('*')
        .eq('id', taskInAId);

      expect(data).toEqual([]);
      expect(error).toBeNull();
    });

    test('User A can only see their own workspaces', async () => {
      const { data, error } = await userAClient
        .from('workspaces')
        .select('*');

      expect(error).toBeNull();
      expect(data.every((ws) => ws.id !== workspaceBId)).toBe(true);
    });
  });

  describe('Guest Restrictions', () => {
    test('Guest cannot read unassigned tasks', async () => {
      const { data, error } = await guestClient
        .from('tasks')
        .select('*')
        .eq('id', unassignedTaskId);

      expect(data).toEqual([]);
      expect(error).toBeNull();
    });

    test('Guest can only see assigned tasks', async () => {
      // Assign a task to guest
      const { data: assignedTask } = await userAClient
        .from('tasks')
        .insert({
          title: 'Task Assigned to Guest',
          workspace_id: workspaceAId,
          created_by: userAId,
          assignee_id: guestUserId,
        })
        .select()
        .single();

      const { data, error } = await guestClient
        .from('tasks')
        .select('*')
        .eq('id', assignedTask.id);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(assignedTask.id);
    });
  });

  describe('Notification Privacy', () => {
    test('User A cannot read User B notifications', async () => {
      const { data, error } = await userAClient
        .from('notifications')
        .select('*')
        .eq('user_id', userBId);

      expect(data).toEqual([]);
      expect(error).toBeNull();
    });

    test('User B cannot read User A notifications', async () => {
      const { data, error } = await userBClient
        .from('notifications')
        .select('*')
        .eq('user_id', userAId);

      expect(data).toEqual([]);
      expect(error).toBeNull();
    });

    test('User can only see their own notifications', async () => {
      const { data, error } = await userAClient
        .from('notifications')
        .select('*');

      expect(error).toBeNull();
      expect(data.every((notif) => notif.user_id === userAId)).toBe(true);
    });
  });

  describe('Profile Visibility', () => {
    test('User A can see User B profile only if they share a workspace', async () => {
      // Initially, they don't share a workspace
      const { data: before } = await userAClient
        .from('profiles')
        .select('*')
        .eq('id', userBId);

      expect(before).toEqual([]);

      // Add User B to a workspace with User A
      const { data: sharedWs } = await userAClient
        .from('workspaces')
        .insert({ name: 'Shared Workspace', type: 'team', created_by: userAId })
        .select()
        .single();

      await adminClient
        .from('workspace_members')
        .insert({ workspace_id: sharedWs.id, user_id: userBId, role: 'member' });

      // Now User A should see User B
      const { data: after } = await userAClient
        .from('profiles')
        .select('*')
        .eq('id', userBId);

      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(userBId);
    });
  });
});
