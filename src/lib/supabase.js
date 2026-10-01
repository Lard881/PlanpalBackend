import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';

/**
 * User client: RLS applies. Use for normal reads and writes.
 * @param {string} jwt - User's Supabase access token
 */
export function userClient(jwt) {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Admin client: bypasses RLS. Only for specific operations.
 * Use cases:
 * - Creating signed URLs
 * - Inserting notifications
 * - Reading device_tokens for push
 * - Deleting storage objects
 * - Verifying tokens
 */
export const adminClient = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);
