import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createApp } from '../src/app.js';
import {
  TEST_SUPABASE_URL,
  TEST_SUPABASE_ANON_KEY,
  TEST_SUPABASE_SERVICE_KEY,
  skipDbTests,
  logSkip,
} from './helpers/db.js';

logSkip('Chat API');

(skipDbTests ? describe.skip : describe)('Chat API', () => {
  let app;
  let admin;
  let authClient;
  let authToken;
  let userId;
  let personalWorkspaceId;
  let teamWorkspaceId;

  beforeAll(async () => {
    app = createApp();
    admin = createClient(TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_KEY);
    authClient = createClient(TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await admin.auth.admin.createUser({
      email: `test-chat-${Date.now()}@planpal.test`,
      password: 'TestPass123!',
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;

    const { data: sessionData, error: signInError } =
      await authClient.auth.signInWithPassword({
        email: data.user.email,
        password: 'TestPass123!',
      });
    if (signInError) throw signInError;
    authToken = sessionData.session.access_token;

    const { data: personal, error: workspaceError } = await admin
      .from('workspaces')
      .select('id')
      .eq('created_by', userId)
      .eq('type', 'personal')
      .single();
    if (workspaceError) throw workspaceError;
    personalWorkspaceId = personal.id;

    const response = await request(app)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Chat test workspace' })
      .expect(201);
    teamWorkspaceId = response.body.workspace.id;
  });

  afterAll(async () => {
    if (userId && admin) await admin.auth.admin.deleteUser(userId);
  });

  test('blocks direct messages in personal workspaces', async () => {
    const response = await request(app)
      .post(`/api/v1/workspaces/${personalWorkspaceId}/dms`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ userId })
      .expect(400);

    expect(response.body.error.code).toBe('CHAT_NOT_AVAILABLE_IN_PERSONAL');
  });

  test('rejects private-channel members outside the workspace', async () => {
    const response = await request(app)
      .post(`/api/v1/workspaces/${teamWorkspaceId}/channels`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Private channel validation',
        isPrivate: true,
        memberIds: [randomUUID()],
      })
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  test('accepts a retried message once using its client ID', async () => {
    const channelResponse = await request(app)
      .post(`/api/v1/workspaces/${teamWorkspaceId}/channels`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Idempotency test', isPrivate: true })
      .expect(201);
    const channelId = channelResponse.body.channel.id;
    const clientId = randomUUID();
    const send = () =>
      request(app)
        .post(`/api/v1/channels/${channelId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ id: clientId, body: 'retry-safe message' });

    const first = await send().expect(201);
    const retry = await send().expect(200);

    expect(first.body.message.id).toBe(clientId);
    expect(retry.body.message.id).toBe(clientId);
  });
});
