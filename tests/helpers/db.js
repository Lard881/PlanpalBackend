/**
 * DB-backed tests run only against a dedicated TEST Supabase project.
 * Production SUPABASE_* variables must never be used as a fallback.
 */
export const TEST_SUPABASE_URL = process.env.TEST_SUPABASE_URL;
export const TEST_SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY;
export const TEST_SUPABASE_SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_KEY;

export const skipDbTests = !TEST_SUPABASE_URL || !TEST_SUPABASE_ANON_KEY || !TEST_SUPABASE_SERVICE_KEY;

export function logSkip(suiteName) {
  if (skipDbTests) {
    console.log(
      `\n⚠️  Skipping ${suiteName}: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, or TEST_SUPABASE_SERVICE_KEY not set\n`,
    );
  }
}
