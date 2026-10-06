#!/usr/bin/env node
/**
 * Verify Test Database Setup
 * Checks that all tables exist and test credentials work
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const expectedTables = [
  'profiles', 'workspaces', 'workspace_members', 'invite_codes',
  'labels', 'files', 'tasks', 'subtasks', 'task_comments', 'task_attachments',
  'events', 'event_attendees', 'channels', 'channel_members', 'messages',
  'folders', 'documents', 'notifications', 'device_tokens'
];

async function verify() {
  console.log('\n🔍 Verifying Test Database Setup\n');
  console.log('='.repeat(60));

  // Check credentials
  if (!process.env.TEST_SUPABASE_URL || !process.env.TEST_SUPABASE_SERVICE_KEY) {
    console.log('❌ Test credentials not found in .env');
    process.exit(1);
  }

  const testUrl = process.env.TEST_SUPABASE_URL;
  console.log(`📍 Test URL: ${testUrl}`);

  const supabase = createClient(
    testUrl,
    process.env.TEST_SUPABASE_SERVICE_KEY
  );

  // Try to query profiles table
  console.log('\n📊 Checking tables...\n');

  let foundTables = 0;

  for (const table of expectedTables) {
    try {
      const { error } = await supabase.from(table).select('*').limit(0);
      if (error) {
        console.log(`   ❌ ${table} - ${error.message}`);
      } else {
        console.log(`   ✅ ${table}`);
        foundTables++;
      }
    } catch (err) {
      console.log(`   ❌ ${table} - Error: ${err.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));

  if (foundTables === expectedTables.length) {
    console.log(`✅ SUCCESS! All ${foundTables}/${expectedTables.length} tables found`);
    console.log('\n🎉 Test database is ready!');
    console.log('\n📝 Next steps:');
    console.log('   1. Run: npm test');
    console.log('   2. All tests should run against TEST database');
    console.log('   3. Production database is safe');
  } else {
    console.log(`⚠️  Found ${foundTables}/${expectedTables.length} tables`);
    console.log('\n💡 Some migrations may not have run.');
    console.log('   Check: RUN_MIGRATIONS_INSTRUCTIONS.md');
  }

  console.log('');
}

verify().catch(err => {
  console.error('\n❌ Verification failed:', err.message);
  process.exit(1);
});
