import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { createApp } from '../src/app.js';
import {
  TEST_SUPABASE_ANON_KEY,
  TEST_SUPABASE_SERVICE_KEY,
  TEST_SUPABASE_URL,
  skipDbTests,
  logSkip,
} from './helpers/db.js';

logSkip('Workspace member sync tombstone tests');

(skipDbTests ? describe.skip : describe)('Workspace member sync tombstones', () => {
  const adminEmail = `sync-admin-${Date.now()}@planpal.test`;
  const memberEmail = `sync-member-${Date.now()}@planpal.test`;
  const password = 'TestPass123!';
  let app;
  let admin;
  let authClient;
  let workspaceId;
  let adminId;
  let memberId;
  let adminToken;

  beforeAll(async () => {
    app = createApp();
    admin = createClient(TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_KEY);
    authClient = createClient(TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: adminResult, error: adminError } = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
    });
    if (adminError) throw adminError;
    adminId = adminResult.user.id;

    const { data: memberResult, error: memberError } = await admin.auth.admin.createUser({
      email: memberEmail,
      password,
      email_confirm: true,
    });
    if (memberError) throw memberError;
    memberId = memberResult.user.id;

    const { data: workspace, error: workspaceError } = await admin
      .from('workspaces')
      .insert({ name: 'Sync tombstone test', type: 'team', created_by: adminId })
      .select('id')
      .single();
    if (workspaceError) throw workspaceError;
    workspaceId = workspace.id;

    const { error: membershipError } = await admin
      .from('workspace_members')
      .insert({ workspace_id: workspaceId, user_id: memberId, role: 'member' });
    if (membershipError) throw membershipError;

    const { data: session, error: signInError } = await authClient.auth.signInWithPassword({
      email: adminEmail,
      password,
    });
    if (signInError) throw signInError;
    adminToken = session.session.access_token;
  });

  afterAll(async () => {
    if (workspaceId && admin) {
      await admin.from('workspaces')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', workspaceId);
      await admin.from('workspaces').delete().eq('id', workspaceId);
    }
    if (memberId && admin) await admin.auth.admin.deleteUser(memberId);
    if (adminId && admin) await admin.auth.admin.deleteUser(adminId);
  });

  test('removes membership from access while returning its tombstone to sync', async () => {
    await request(app)
      .delete(`/api/v1/workspaces/${workspaceId}/members/${memberId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const response = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/sync`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const removedMember = response.body.members.find(member => member.user_id === memberId);
    expect(removedMember).toBeDefined();
    expect(removedMember.deleted_at).toEqual(expect.any(String));

    const { data: activeMembership, error } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', memberId)
      .is('deleted_at', null)
      .maybeSingle();
    expect(error).toBeNull();
    expect(activeMembership).toBeNull();
  });
});
