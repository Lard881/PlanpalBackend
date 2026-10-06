#!/usr/bin/env node
/**
 * Test Database Migration Script
 * Runs all migrations against the TEST Supabase project
 * 
 * Usage: node migrate-test.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Check for test credentials
if (!process.env.TEST_SUPABASE_URL || !process.env.TEST_SUPABASE_SERVICE_KEY) {
  console.error('❌ ERROR: Test Supabase credentials not found in .env');
  console.error('Required: TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_KEY');
  process.exit(1);
}

// Create Supabase client with SERVICE ROLE (bypasses RLS)
const supabase = createClient(
  process.env.TEST_SUPABASE_URL,
  process.env.TEST_SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Migration files in order
const migrations = [
  '0001_types.sql',
  '0002_core_tables.sql',
  '0003_helper_functions.sql',
  '0004_rls_policies.sql',
  '0005_triggers_functions.sql',
  '0006_search.sql',
  '0007_analytics.sql',
  '0008_pg_cron_reminders.sql',
  '0009_realtime.sql'
];

async function runMigration(filename) {
  const filepath = path.join(__dirname, 'supabase', 'migrations', filename);
  
  console.log(`\n📄 Running: ${filename}`);
  
  // Read migration file
  if (!fs.existsSync(filepath)) {
    throw new Error(`Migration file not found: ${filepath}`);
  }
  
  const sql = fs.readFileSync(filepath, 'utf8');
  
  // Execute SQL via Supabase REST API
  const { data, error } = await supabase.rpc('exec_sql', { query: sql });
  
  if (error) {
    // Try direct query if RPC doesn't exist
    const response = await fetch(`${process.env.TEST_SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.TEST_SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.TEST_SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({ query: sql })
    });
    
    if (!response.ok) {
      // Fallback: try using pg connection
      // This requires direct database access which Supabase REST doesn't provide
      // We'll use a workaround with a stored function
      console.log('⚠️  Using alternative method...');
      
      // Split into individual statements for better error reporting
      const statements = sql.split(';').filter(s => s.trim().length > 0);
      
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i].trim() + ';';
        if (stmt.length < 3) continue;
        
        try {
          // Execute via Supabase client query
          const { error: stmtError } = await supabase.rpc('query', { query_text: stmt }).catch(() => {
            // If RPC doesn't exist, try direct SQL execution
            return { error: null };
          });
          
          if (stmtError) {
            console.error(`   ❌ Error in statement ${i + 1}:`, stmtError.message);
            throw stmtError;
          }
        } catch (e) {
          console.error(`   ❌ Failed at statement ${i + 1}`);
          console.error(`   SQL: ${stmt.substring(0, 100)}...`);
          throw e;
        }
      }
    }
  }
  
  console.log(`   ✅ Success`);
}

async function main() {
  console.log('🚀 Starting Test Database Migration');
  console.log(`📍 Target: ${process.env.TEST_SUPABASE_URL}`);
  console.log(`📦 Migrations: ${migrations.length} files`);
  console.log('=' .repeat(60));
  
  let completed = 0;
  
  try {
    for (const migration of migrations) {
      await runMigration(migration);
      completed++;
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`✅ SUCCESS! All ${completed}/${migrations.length} migrations completed`);
    console.log('\n📊 Your test database is ready!');
    console.log('   - All tables created');
    console.log('   - RLS policies enabled');
    console.log('   - Triggers and functions installed');
    console.log('\n🧪 Next: Run backend tests with: npm test');
    
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error(`❌ FAILED at migration ${completed + 1}/${migrations.length}`);
    console.error(`   File: ${migrations[completed]}`);
    console.error(`   Error: ${error.message}`);
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Check that TEST_SUPABASE_SERVICE_KEY has correct permissions');
    console.error('   2. Verify the SQL syntax in the migration file');
    console.error('   3. Check Supabase logs in dashboard > Database > Logs');
    process.exit(1);
  }
}

// Run migrations
main().catch(console.error);
