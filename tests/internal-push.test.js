import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('POST /internal/push/run', () => {
  it('returns 401 when X-Cron-Secret header is missing', async () => {
    const res = await request(app).post('/internal/push/run');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when X-Cron-Secret header is wrong', async () => {
    const res = await request(app)
      .post('/internal/push/run')
      .set('X-Cron-Secret', 'wrong-secret-definitely-not-it');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 200 when X-Cron-Secret header matches CRON_SECRET', async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return;
    }
    const res = await request(app)
      .post('/internal/push/run')
      .set('X-Cron-Secret', secret);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
