import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock push-worker before importing app
vi.mock('../src/lib/push-worker.js', () => ({
  processPushQueue: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
}));

// Mock config so Firebase appears configured and cron secret is set
vi.mock('../src/config/env.js', () => ({
  config: {
    port: 3000,
    nodeEnv: 'test',
    isDevelopment: false,
    isProduction: false,
    isTest: true,
    supabase: {
      url: 'https://test.supabase.co',
      anonKey: 'test-anon-key',
      serviceRoleKey: 'test-service-role-key',
      jwtSecret: 'test-jwt-secret',
    },
    firebase: {
      serviceAccountJson: '{"type":"service_account"}',
      serviceAccount: { type: 'service_account' }, // truthy = Firebase configured
    },
    cron: {
      secret: 'correct-secret-abc123',
    },
    cors: {
      origins: ['http://localhost:3000'],
    },
  },
}));

// Mock auth middleware to prevent Supabase calls
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (_req, _res, next) => next(),
}));

// Mock rate limiter
vi.mock('../src/middleware/rateLimit.js', () => ({
  generalLimiter: (_req, _res, next) => next(),
}));

const { createApp } = await import('../src/app.js');
const app = createApp();

describe('POST /internal/push/run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when X-Cron-Secret header is missing', async () => {
    const res = await request(app).post('/internal/push/run');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when X-Cron-Secret header is wrong', async () => {
    const res = await request(app)
      .post('/internal/push/run')
      .set('X-Cron-Secret', 'wrong-secret');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 200 when X-Cron-Secret header is correct', async () => {
    const res = await request(app)
      .post('/internal/push/run')
      .set('X-Cron-Secret', 'correct-secret-abc123');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
