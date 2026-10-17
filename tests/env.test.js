import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';

const projectUrl = 'https://production.example.invalid';

function runConfigImport(testCredentials) {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    SUPABASE_URL: projectUrl,
    SUPABASE_ANON_KEY: 'production-anon-placeholder',
    SUPABASE_SERVICE_ROLE_KEY: 'production-service-placeholder',
    TEST_SUPABASE_URL: testCredentials ? 'https://test.example.invalid' : '',
    TEST_SUPABASE_ANON_KEY: testCredentials ? 'test-anon-placeholder' : '',
    TEST_SUPABASE_SERVICE_KEY: testCredentials ? 'test-service-placeholder' : '',
    TEST_SUPABASE_JWT_SECRET: testCredentials ? 'test-jwt-placeholder' : '',
  };

  return spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import { config } from './src/config/env.js'; if (config.supabase.url !== process.env.TEST_SUPABASE_URL || config.supabase.anonKey !== process.env.TEST_SUPABASE_ANON_KEY || config.supabase.serviceRoleKey !== process.env.TEST_SUPABASE_SERVICE_KEY || config.supabase.jwtSecret !== process.env.TEST_SUPABASE_JWT_SECRET) process.exit(2); console.log('dedicated test credentials selected');",
  ], { cwd: process.cwd(), env, encoding: 'utf8' });
}

describe('Supabase test credential isolation', () => {
  test('NODE_ENV=test rejects absent dedicated test credentials even if production credentials exist', () => {
    const result = runConfigImport(false);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('TEST_SUPABASE_URL');
    expect(result.stderr).not.toContain('production-service-placeholder');
  });

  test('NODE_ENV=test selects only dedicated test credentials', () => {
    const result = runConfigImport(true);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('dedicated test credentials selected');
    expect(result.stdout).not.toContain('placeholder');
  });
});
