/**
 * RLS Isolation Test Suite
 * 
 * Tests proving all RLS policies work correctly per S1.14.
 * Run against a separate test Supabase project.
 */

import { createClient } from '@supabase/supabase-js';
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';

const SUPABASE_URL = process.env.TEST_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_KEY;

// Skip all tests if Supabase credentials are not provided
const skipTests = !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY;

if (skipTests) {
  console.log('\n⚠️  Skipping RLS tests: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, or TEST_SUPABASE_SERVICE_KEY not set\n');
}

(skipTests ? describe.skip : describe)('RLS Isolation Tests', () => {
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

  describe('Last Admin Protection', () => {
    test('Last admin cannot be demoted', async () => {
      // Create a team workspace with only one admin
      const { data: soloTeam } = await userAClient
        .from('workspaces')
        .insert({ name: 'Solo Admin Team', type: 'team', created_by: userAId })
        .select()
        .single();

      // Try to demote the only admin to member (should fail)
      const { error } = await adminClient
        .from('workspace_members')
        .update({ role: 'member' })
        .eq('workspace_id', soloTeam.id)
        .eq('user_id', userAId);

      expect(error).not.toBeNull();
      expect(error.code).toBe('P0001'); // Postgres custom exception
    });

    test('Last admin cannot be removed', async () => {
      // Create a team workspace with only one admin
      const { data: soloTeam2 } = await userAClient
        .from('workspaces')
        .insert({ name: 'Solo Admin Team 2', type: 'team', created_by: userAId })
        .select()
        .single();

      // Try to remove the only admin (should fail)
      const { error } = await adminClient
        .from('workspace_members')
        .delete()
        .eq('workspace_id', soloTeam2.id)
        .eq('user_id', userAId);

      expect(error).not.toBeNull();
      expect(error.code).toBe('P0001');
    });
  });

  describe('Personal Workspace Restrictions', () => {
    test('Personal workspace cannot get invite codes', async () => {
      const { error } = await userAClient
        .from('invite_codes')
        .insert({
          workspace_id: workspaceAId, // Personal workspace
          code: 'TESTCODE',
          created_by: userAId,
        });

      expect(error).not.toBeNull();
    });

    test('Personal workspace cannot get channels', async () => {
      const { error } = await userAClient
        .from('channels')
        .insert({
          workspace_id: workspaceAId, // Personal workspace
          kind: 'channel',
          name: 'test-channel',
          created_by: userAId,
        });

      expect(error).not.toBeNull();
    });
  });

  describe('Task Workspace Move', () => {
    test('Normal update of tasks.workspace_id fails', async () => {
      // Try to move a task by updating workspace_id directly
      const { error } = await userAClient
        .from('tasks')
        .update({ workspace_id: workspaceBId })
        .eq('id', taskInAId);

      expect(error).not.toBeNull();
      expect(error.message).toContain('move_task_to_workspace');
    });

    test('move_task_to_workspace succeeds', async () => {
      // Create a task and a target workspace
      const { data: task } = await userAClient
        .from('tasks')
        .insert({
          title: 'Task to Move',
          workspace_id: workspaceAId,
          created_by: userAId,
        })
        .select()
        .single();

      const { data: targetWs } = await userAClient
        .from('workspaces')
        .insert({ name: 'Target Workspace', type: 'team', created_by: userAId })
        .select()
        .single();

      // Use the function to move the task
      const { error } = await userAClient.rpc('move_task_to_workspace', {
        p_task: task.id,
        p_target: targetWs.id,
      });

      expect(error).toBeNull();

      // Verify the task was moved
      const { data: movedTask } = await userAClient
        .from('tasks')
        .select('workspace_id')
        .eq('id', task.id)
        .single();

      expect(movedTask.workspace_id).toBe(targetWs.id);
    });
  });

  describe('join_workspace Errors', () => {
    test('Returns INVALID_CODE for non-existent code', async () => {
      const { error } = await userAClient.rpc('join_workspace', {
        p_code: 'INVALID99',
      });

      expect(error).not.toBeNull();
      expect(error.code).toBe('P0002');
      expect(error.message).toContain('INVALID_CODE');
    });

    test('Returns CODE_EXPIRED for expired code', async () => {
      // Create an expired invite code
      const { data: teamWs } = await userAClient
        .from('workspaces')
        .insert({ name: 'Team with Expired Code', type: 'team', created_by: userAId })
        .select()
        .single();

      const { data: expiredCode } = await userAClient
        .from('invite_codes')
        .insert({
          workspace_id: teamWs.id,
          code: 'EXPIRED1',
          expires_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
          created_by: userAId,
        })
        .select()
        .single();

      const { error } = await userBClient.rpc('join_workspace', {
        p_code: 'EXPIRED1',
      });

      expect(error).not.toBeNull();
      expect(error.code).toBe('P0002');
      expect(error.message).toContain('CODE_EXPIRED');
    });

    test('Returns CODE_REVOKED for revoked code', async () => {
      const { data: teamWs } = await userAClient
        .from('workspaces')
        .insert({ name: 'Team with Revoked Code', type: 'team', created_by: userAId })
        .select()
        .single();

      const { data: revokedCode } = await userAClient
        .from('invite_codes')
        .insert({
          workspace_id: teamWs.id,
          code: 'REVOKED1',
          revoked_at: new Date().toISOString(),
          created_by: userAId,
        })
        .select()
        .single();

      const { error } = await userBClient.rpc('join_workspace', {
        p_code: 'REVOKED1',
      });

      expect(error).not.toBeNull();
      expect(error.code).toBe('P0002');
      expect(error.message).toContain('CODE_REVOKED');
    });

    test('Returns CODE_USED_UP for exhausted code', async () => {
      const { data: teamWs } = await userAClient
        .from('workspaces')
        .insert({ name: 'Team with Used Up Code', type: 'team', created_by: userAId })
        .select()
        .single();

      const { data: usedUpCode } = await userAClient
        .from('invite_codes')
        .insert({
          workspace_id: teamWs.id,
          code: 'USEDUP1',
          max_uses: 1,
          use_count: 1,
          created_by: userAId,
        })
        .select()
        .single();

      const { error } = await userBClient.rpc('join_workspace', {
        p_code: 'USEDUP1',
      });

      expect(error).not.toBeNull();
      expect(error.code).toBe('P0002');
      expect(error.message).toContain('CODE_USED_UP');
    });

    test('Returns ALREADY_MEMBER for duplicate join', async () => {
      const { data: teamWs } = await userAClient
        .from('workspaces')
        .insert({ name: 'Team for Duplicate Join', type: 'team', created_by: userAId })
        .select()
        .single();

      const { data: validCode } = await userAClient
        .from('invite_codes')
        .insert({
          workspace_id: teamWs.id,
          code: 'VALID123',
          created_by: userAId,
        })
        .select()
        .single();

      // User A is already admin, try to join again
      const { error } = await userAClient.rpc('join_workspace', {
        p_code: 'VALID123',
      });

      expect(error).not.toBeNull();
      expect(error.code).toBe('P0002');
      expect(error.message).toContain('ALREADY_MEMBER');
    });
  });

  describe('Guest Status-Only Update', () => {
    test('Guest can only change status of assigned task', async () => {
      // Assign a task to guest
      const { data: guestTask } = await userAClient
        .from('tasks')
        .insert({
          title: 'Guest Status Test',
          workspace_id: workspaceAId,
          created_by: userAId,
          assignee_id: guestUserId,
        })
        .select()
        .single();

      // Guest can change status
      const { error: statusError } = await guestClient
        .from('tasks')
        .update({ status: 'in_progress' })
        .eq('id', guestTask.id);

      expect(statusError).toBeNull();

      // Guest cannot change title
      const { error: titleError } = await guestClient
        .from('tasks')
        .update({ title: 'Changed Title' })
        .eq('id', guestTask.id);

      expect(titleError).not.toBeNull();
    });
  });

  describe('claim_unpushed_notifications Security', () => {
    test('Normal users cannot call claim_unpushed_notifications', async () => {
      const { error } = await userAClient.rpc('claim_unpushed_notifications', {
        p_limit: 10,
      });

      expect(error).not.toBeNull();
      // Function should not be accessible to normal users
    });
  });

  describe('Deadline Reminder Deduplication', () => {
    test('Deadline reminders do not duplicate when run twice', async () => {
      // Create a task due within 24 hours
      const dueAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
      const { data: urgentTask } = await userAClient
        .from('tasks')
        .insert({
          title: 'Urgent Task',
          workspace_id: workspaceAId,
          created_by: userAId,
          assignee_id: userAId,
          due_at: dueAt,
        })
        .select()
        .single();

      // Run reminder function twice
      await adminClient.rpc('create_deadline_notifications');
      await adminClient.rpc('create_deadline_notifications');

      // Check that only one notification was created
      const { data: notifications } = await adminClient
        .from('notifications')
        .select('*')
        .eq('entity_id', urgentTask.id)
        .eq('type', 'deadline_approaching');

      expect(notifications.length).toBe(1);
    });
  });
});
