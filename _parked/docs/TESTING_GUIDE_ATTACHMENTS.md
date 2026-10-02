# Stage 10: File Attachments & Links - Testing Guide

## Overview
This guide provides comprehensive testing procedures for the file attachments and links system implemented in Stage 10.

## Prerequisites

### Backend Setup Required
Before testing, ensure the backend is configured:

1. **Apply Database Migration**
   ```bash
   cd BACKEND
   # Apply migration 004_create_attachments_and_links.sql to your Supabase database
   ```

2. **Set Up Storage Bucket**
   ```bash
   # Option 1: Automated setup
   node scripts/setup-storage.js
   
   # Option 2: Manual setup
   # Execute SQL from supabase/storage_setup.sql in Supabase SQL Editor
   ```

3. **Start Backend Server**
   ```bash
   npm install  # If not already done
   npm start    # Server should run on http://localhost:3000
   ```

4. **Verify Environment Variables**
   ```
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_KEY=your_service_key
   JWT_SECRET=your_jwt_secret
   ```

### Flutter App Setup
1. **Install Dependencies**
   ```bash
   cd app
   flutter pub get
   ```

2. **Generate Code**
   ```bash
   flutter pub run build_runner build --delete-conflicting-outputs
   ```

3. **Update API Base URL**
   - Ensure `lib/core/config/api_config.dart` points to your backend
   - For local testing: `http://localhost:3000/api`

---

## Testing Checklist

### 1. File Upload Testing

#### 1.1 Single File Upload
- [ ] Open a task in TaskDetailScreen
- [ ] Tap Edit button
- [ ] Tap "Add" button in Attachments section
- [ ] Select a single image file (JPG/PNG)
- [ ] Verify upload dialog appears
- [ ] Verify progress indicator shows 0% → 100%
- [ ] Verify thumbnail generation for images
- [ ] Verify file appears in attachment list
- [ ] Verify file icon is correct for file type

**Expected Results:**
- Upload completes successfully
- Thumbnail displayed for images
- File name and size shown correctly
- No errors in console

#### 1.2 Multiple File Upload
- [ ] Tap Add button in Attachments
- [ ] Select multiple files (3-5 files of different types)
- [ ] Verify upload dialog shows all files
- [ ] Verify individual progress bars for each file
- [ ] Verify completion counter (e.g., "Uploading 2 of 5 files...")
- [ ] Verify all files appear in list after upload

**Expected Results:**
- All files upload successfully
- Progress tracked individually
- No files skipped or failed

#### 1.3 Large File Upload
- [ ] Select a file close to 50MB limit
- [ ] Verify upload completes successfully
- [ ] Verify progress tracking works for large files

**Expected Results:**
- Large file uploads successfully
- Progress indicator works smoothly

#### 1.4 File Type Validation
Test each allowed file type:
- [ ] Images: .jpg, .jpeg, .png, .gif, .webp, .svg
- [ ] Documents: .pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx
- [ ] Text: .txt, .csv, .json
- [ ] Archives: .zip

**Expected Results:**
- All 18 file types accepted
- Appropriate icons displayed for each type

#### 1.5 File Validation Errors
- [ ] Try uploading file > 50MB
- [ ] Try uploading unsupported file type (.exe, .bat, etc.)
- [ ] Try uploading empty file

**Expected Results:**
- Clear error messages displayed
- Upload prevented before reaching server
- No crashes or undefined behavior

---

### 2. File Download & Preview Testing

#### 2.1 Image Preview
- [ ] Tap on an uploaded image attachment
- [ ] Verify full-screen preview opens
- [ ] Test pinch-to-zoom (0.5x to 4x)
- [ ] Test pan/drag while zoomed
- [ ] Verify black background with white controls
- [ ] Tap download button
- [ ] Verify signed URL generated
- [ ] Verify file downloads successfully

**Expected Results:**
- Image loads and displays correctly
- Zoom and pan work smoothly
- Download opens browser/download manager

#### 2.2 Non-Image File Preview
- [ ] Tap on PDF/document attachment
- [ ] Verify preview screen shows file icon
- [ ] Verify file name and size displayed
- [ ] Tap download button
- [ ] Verify download works

**Expected Results:**
- File info displayed correctly
- Download button works
- Opens in appropriate app after download

#### 2.3 Thumbnail Display
- [ ] Upload multiple images
- [ ] Verify thumbnails appear in attachment cards
- [ ] Verify thumbnails are 200x200 (approximately)
- [ ] Verify aspect ratio maintained
- [ ] Check for broken image icons (should not appear)

**Expected Results:**
- All thumbnails load correctly
- No broken images
- Reasonable file sizes (thumbnails compressed)

---

### 3. File Deletion Testing

#### 3.1 Single File Delete
- [ ] Tap delete button on an attachment
- [ ] Verify confirmation dialog appears
- [ ] Tap "Cancel" - verify nothing happens
- [ ] Tap delete button again
- [ ] Tap "Delete" in confirmation
- [ ] Verify file removed from list
- [ ] Verify success message shown

**Expected Results:**
- Confirmation required before delete
- File removed from UI immediately
- Database updated (soft delete)
- Storage file deleted (via trigger)

#### 3.2 Multiple Deletes
- [ ] Delete multiple attachments in sequence
- [ ] Verify each deletion works independently
- [ ] Verify attachment count updates correctly

**Expected Results:**
- All deletions successful
- Count reflects current state
- No orphaned files in storage

---

### 4. Link Attachment Testing

#### 4.1 Add Link with Metadata
- [ ] Tap Edit in task detail
- [ ] Tap Add button in Links section
- [ ] Enter URL: `https://github.com`
- [ ] Tap Add
- [ ] Verify metadata fetched automatically
- [ ] Verify link appears with favicon
- [ ] Verify domain displayed as title

**Test URLs:**
- [ ] `https://github.com/user/repo`
- [ ] `https://figma.com/file/abc123`
- [ ] `https://docs.google.com/document/d/abc`
- [ ] `https://example.com`

**Expected Results:**
- Metadata fetched for each URL
- Favicon displayed (custom or Google fallback)
- Domain extracted correctly
- Link stored in database

#### 4.2 Link Display
- [ ] Verify favicon loads (or fallback icon shows)
- [ ] Verify title displayed (or domain as fallback)
- [ ] Verify description shown if available
- [ ] Verify URL truncated if too long

**Expected Results:**
- Links display cleanly
- No broken images for favicons
- Text truncation works properly

#### 4.3 Open Link
- [ ] Tap "Open" button on a link card
- [ ] Verify link opens in external browser
- [ ] Test on multiple link types

**Expected Results:**
- Links open correctly in default browser
- HTTPS and HTTP both work
- No security warnings for valid URLs

#### 4.4 Delete Link
- [ ] Tap delete button on a link
- [ ] Verify confirmation dialog
- [ ] Confirm deletion
- [ ] Verify link removed from list

**Expected Results:**
- Confirmation required
- Link removed immediately
- Database updated (soft delete)

---

### 5. Offline Mode Testing

#### 5.1 Upload While Offline
- [ ] Turn off network/WiFi
- [ ] Try to upload a file
- [ ] Verify error message shown
- [ ] Turn network back on
- [ ] Retry upload
- [ ] Verify upload succeeds

**Expected Results:**
- Graceful error handling when offline
- Clear offline message
- Retry works when online

#### 5.2 View Cached Attachments Offline
- [ ] Load task with attachments while online
- [ ] Turn off network
- [ ] Navigate away and back to task
- [ ] Verify attachments still visible
- [ ] Verify cached data displayed

**Expected Results:**
- Cached attachments load from local DB
- No network errors
- UI shows cached state

#### 5.3 Delete While Offline
- [ ] Turn off network
- [ ] Try to delete an attachment
- [ ] Verify soft delete happens locally
- [ ] Turn network back on
- [ ] Verify sync happens (if sync implemented)

**Expected Results:**
- Local delete works immediately
- Syncs to server when online

---

### 6. Edge Cases & Error Handling

#### 6.1 Network Interruption During Upload
- [ ] Start uploading a large file
- [ ] Turn off network mid-upload
- [ ] Verify error shown
- [ ] Turn network back on
- [ ] Retry upload

**Expected Results:**
- Upload fails gracefully
- Error message displayed
- Can retry without crashes

#### 6.2 Invalid File Operations
- [ ] Try to preview deleted attachment
- [ ] Try to download with expired URL (after 1 hour)
- [ ] Try to upload file without workspace context

**Expected Results:**
- Appropriate error messages
- No crashes or undefined behavior
- User can recover gracefully

#### 6.3 UI State Management
- [ ] Upload files, then navigate away mid-upload
- [ ] Return to screen
- [ ] Verify state handled correctly
- [ ] No memory leaks or stuck states

**Expected Results:**
- Navigation doesn't break upload
- Progress tracked correctly
- No zombie processes

---

### 7. Performance Testing

#### 7.1 Large File Performance
- [ ] Upload 50MB file
- [ ] Monitor progress smoothness
- [ ] Verify UI remains responsive
- [ ] Check memory usage

**Expected Results:**
- Smooth progress updates
- No UI freezing
- Reasonable memory usage
- Thumbnail generation doesn't block UI

#### 7.2 Many Attachments
- [ ] Create task with 20+ attachments
- [ ] Scroll through attachment list
- [ ] Verify smooth scrolling
- [ ] Check list rendering performance

**Expected Results:**
- List scrolls smoothly
- Images load progressively
- No jank or stuttering

#### 7.3 Thumbnail Generation
- [ ] Upload 10 images simultaneously
- [ ] Verify thumbnails generated in background
- [ ] UI should remain responsive
- [ ] Isolates used (check console logs)

**Expected Results:**
- Thumbnails generated without blocking
- Progress shown for each file
- No UI freezing during processing

---

### 8. Security & Permissions Testing

#### 8.1 Authentication
- [ ] Try to upload file without being logged in
- [ ] Verify authentication required
- [ ] Login and retry
- [ ] Upload succeeds

**Expected Results:**
- Unauthenticated requests rejected (401)
- Clear login prompt
- Works after authentication

#### 8.2 Workspace Access
- [ ] Try to access attachment from different workspace
- [ ] Verify access denied (403)
- [ ] Try to delete attachment uploaded by another user
- [ ] Verify permission checked

**Expected Results:**
- Workspace isolation enforced
- Only authorized users can delete
- RLS policies working

---

### 9. Database Integrity Testing

#### 9.1 Verify Database Records
After uploading files, check database:

```sql
-- Check attachments table
SELECT id, task_id, file_name, file_size, mime_type, deleted_at 
FROM task_attachments 
WHERE task_id = 'your-task-id';

-- Check links table
SELECT id, task_id, url, title, deleted_at 
FROM task_links 
WHERE task_id = 'your-task-id';

-- Check storage usage
SELECT get_workspace_storage_used('your-workspace-id');
```

**Expected Results:**
- Records created correctly
- Foreign keys valid
- Timestamps populated
- Soft deletes marked with deleted_at

#### 9.2 Storage Bucket Verification
```sql
-- Check storage objects
SELECT * FROM storage.objects 
WHERE bucket_id = 'task-attachments';
```

**Expected Results:**
- Files stored in correct paths
- Thumbnails in thumbs/ subdirectory
- No orphaned files

---

### 10. Cross-Platform Testing

#### 10.1 Windows Testing
- [ ] Test file picker UI
- [ ] Test file upload from Windows file system
- [ ] Test file preview
- [ ] Test download to Windows downloads folder
- [ ] Test link opening in default browser

#### 10.2 Android Testing
- [ ] Test file picker UI
- [ ] Test file upload from Android storage
- [ ] Test camera integration (if added)
- [ ] Test file preview
- [ ] Test download to Android downloads
- [ ] Test link opening in Chrome/default browser
- [ ] Test permission prompts (storage access)

**Expected Results:**
- Works identically on both platforms
- Platform-specific UI feels native
- File paths handled correctly

---

## Known Limitations (To Address Later)

1. **Skipped UI Components:**
   - Login/register screens
   - Task list screen
   - Workspace selection
   - Navigation routing

2. **Features Not Yet Implemented:**
   - Real-time sync of attachments across devices
   - Attachment versioning
   - Batch operations (select multiple to delete)
   - Search within attachments
   - Filter by file type
   - Sort attachments
   - Share functionality (placeholder in preview)
   - Rich link previews (Open Graph protocol)
   - Link preview cards with images

3. **Backend Not Production-Ready:**
   - Storage bucket needs to be created manually
   - No rate limiting on uploads
   - No virus scanning
   - No content moderation
   - Link metadata fetching is basic (only domain)

---

## Bug Report Template

When testing reveals issues, document them as follows:

```markdown
### Bug: [Brief Description]

**Severity:** Critical / High / Medium / Low

**Steps to Reproduce:**
1. Step one
2. Step two
3. Step three

**Expected Behavior:**
What should happen

**Actual Behavior:**
What actually happened

**Screenshots/Logs:**
[Attach screenshots or error logs]

**Environment:**
- Platform: Windows / Android
- Flutter version:
- Backend version:

**Possible Cause:**
[If known]
```

---

## Success Criteria

Stage 10 is considered complete when:

- [ ] All 18 file types can be uploaded
- [ ] Thumbnails generate correctly for images
- [ ] Files can be previewed and downloaded
- [ ] Links can be added with metadata
- [ ] Links open in external browser
- [ ] Deletion works with confirmation
- [ ] Offline caching works
- [ ] Progress tracking is accurate
- [ ] No critical bugs or crashes
- [ ] UI is responsive and smooth
- [ ] Error messages are clear and helpful
- [ ] Security policies enforced

---

## Next Steps After Testing

1. **Fix Critical Bugs:** Address any P0/P1 issues immediately
2. **Document Issues:** Create issue tracker for non-critical bugs
3. **Performance Tuning:** Optimize based on performance test results
4. **Continue to Stage 11:** Move forward with implementation plan
5. **Return for Integration:** After Stage 18, implement skipped UI screens
6. **End-to-End Testing:** Test complete user flows on Windows and Android

---

## Notes for Future Testing

- Test with real Supabase instance (not local mock)
- Test with varying network conditions (3G, 4G, WiFi)
- Test with different file sizes and types
- Monitor backend logs during testing
- Check Supabase dashboard for storage usage
- Verify RLS policies in Supabase dashboard
- Test with multiple users/workspaces
- Load test with concurrent uploads

---

**Testing Date:** _____________

**Tester:** _____________

**Build Version:** _____________

**Pass/Fail:** _____________

**Notes:**
