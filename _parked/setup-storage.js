/**
 * Supabase Storage Bucket Setup Script
 * 
 * This script creates and configures the task-attachments storage bucket
 * Run this once during initial setup or when deploying to a new environment
 * 
 * Usage:
 *   node scripts/setup-storage.js
 * 
 * Prerequisites:
 *   - SUPABASE_URL and SUPABASE_SERVICE_KEY in .env
 *   - @supabase/supabase-js package installed
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const BUCKET_NAME = 'task-attachments';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB in bytes

// Allowed MIME types for uploads
const ALLOWED_MIME_TYPES = [
  // Images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  
  // Documents
  'application/pdf',
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  
  // Text & Data
  'text/plain',
  'text/csv',
  'application/json',
  
  // Archives
  'application/zip',
  'application/x-zip-compressed',
];

async function setupStorage() {
  console.log('🚀 Starting Supabase Storage setup...\n');

  // Validate environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env file');
    process.exit(1);
  }

  // Create Supabase admin client
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    // Step 1: Check if bucket already exists
    console.log(`📦 Checking if bucket "${BUCKET_NAME}" exists...`);
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();

    if (listError) {
      throw new Error(`Failed to list buckets: ${listError.message}`);
    }

    const existingBucket = buckets.find(b => b.id === BUCKET_NAME);

    if (existingBucket) {
      console.log(`✓ Bucket "${BUCKET_NAME}" already exists`);
      console.log(`  - Public: ${existingBucket.public}`);
      console.log(`  - File size limit: ${existingBucket.file_size_limit ? `${existingBucket.file_size_limit / (1024 * 1024)}MB` : 'Unlimited'}`);
    } else {
      // Step 2: Create the bucket
      console.log(`📦 Creating bucket "${BUCKET_NAME}"...`);
      
      const { data: newBucket, error: createError } = await supabase.storage.createBucket(
        BUCKET_NAME,
        {
          public: false, // Requires authentication
          fileSizeLimit: MAX_FILE_SIZE,
          allowedMimeTypes: ALLOWED_MIME_TYPES,
        }
      );

      if (createError) {
        throw new Error(`Failed to create bucket: ${createError.message}`);
      }

      console.log(`✓ Bucket "${BUCKET_NAME}" created successfully`);
      console.log(`  - Public: false`);
      console.log(`  - File size limit: ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
      console.log(`  - Allowed MIME types: ${ALLOWED_MIME_TYPES.length} types`);
    }

    // Step 3: Verify bucket configuration
    console.log(`\n🔍 Verifying bucket configuration...`);
    const { data: bucket, error: getError } = await supabase.storage.getBucket(BUCKET_NAME);

    if (getError) {
      throw new Error(`Failed to get bucket info: ${getError.message}`);
    }

    console.log('✓ Bucket configuration verified');
    console.log(`  - ID: ${bucket.id}`);
    console.log(`  - Name: ${bucket.name}`);
    console.log(`  - Created: ${bucket.created_at}`);
    console.log(`  - Updated: ${bucket.updated_at}`);

    // Step 4: Test bucket access
    console.log(`\n🧪 Testing bucket access...`);
    const testPath = '_test/test.txt';
    const testContent = 'PlanPal storage test file';

    // Upload test file
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(testPath, testContent, {
        contentType: 'text/plain',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload test file: ${uploadError.message}`);
    }

    console.log('✓ Test file uploaded successfully');

    // List files
    const { data: files, error: listFilesError } = await supabase.storage
      .from(BUCKET_NAME)
      .list('_test');

    if (listFilesError) {
      throw new Error(`Failed to list files: ${listFilesError.message}`);
    }

    console.log(`✓ Test file listed successfully (${files.length} files found)`);

    // Delete test file
    const { error: deleteError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([testPath]);

    if (deleteError) {
      console.warn(`⚠ Warning: Failed to delete test file: ${deleteError.message}`);
    } else {
      console.log('✓ Test file deleted successfully');
    }

    // Step 5: Display storage policies reminder
    console.log('\n📋 Next Steps:');
    console.log('1. ✓ Storage bucket is ready');
    console.log('2. ⚠ Apply storage policies:');
    console.log('   Run the SQL file: supabase/storage_setup.sql');
    console.log('   This sets up RLS policies for workspace-scoped access');
    console.log('3. Test file uploads from your app');
    console.log('4. Monitor storage usage in Supabase Dashboard');

    console.log('\n✅ Storage setup completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Storage setup failed:');
    console.error(error.message);
    console.error('\nTroubleshooting:');
    console.error('- Verify SUPABASE_URL and SUPABASE_SERVICE_KEY are correct');
    console.error('- Check Supabase project is accessible');
    console.error('- Ensure service key has admin privileges');
    console.error('- Check Supabase Dashboard for any error logs\n');
    process.exit(1);
  }
}

// Display configuration info
function displayConfig() {
  console.log('Configuration:');
  console.log(`- Bucket name: ${BUCKET_NAME}`);
  console.log(`- Max file size: ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  console.log(`- Allowed types: ${ALLOWED_MIME_TYPES.length} MIME types`);
  console.log(`- Public access: false (authentication required)`);
  console.log('');
}

// Main execution
if (require.main === module) {
  displayConfig();
  setupStorage();
}

module.exports = { setupStorage };
