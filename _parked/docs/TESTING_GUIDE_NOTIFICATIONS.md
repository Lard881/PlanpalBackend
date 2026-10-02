# Notifications System Testing Guide

## Overview
This guide covers comprehensive testing for the PlanPal notifications system, including privacy enforcement, deduplication, push delivery, and reminder functionality.

## Test Categories

### 1. **Privacy & Security Tests**

#### Notifications Privacy
- [ ] **Test: User can only see their own notifications**
  - Create notifications for user A and user B
  - Query as user A, verify only user A's notifications returned
  - Query as user B, verify only user B's notifications returned

- [ ] **Test: User cannot modify another user's notifications**
  - Create notification for user A
  - Attempt to mark as read/unread as user B
  - Verify 403 Forbidden response

- [ ] **Test: User cannot delete another user's notifications**
  - Create notification for user A
  - Attempt to delete as user B
  - Verify 403 Forbidden response

- [ ] **Test: Workspace filtering respects user membership**
  - User A is member of workspace 1
  - User A is NOT member of workspace 2
  - Create notifications in both workspaces for user A
  - Filter by workspace 2, verify notifications still returned (user_id filter takes precedence)

#### Device Tokens Privacy
- [ ] **Test: User can only see their own device tokens**
  - Register tokens for user A and user B
  - Query as user A, verify only user A's tokens returned

- [ ] **Test: User can only delete their own tokens**
  - Register token for user A
  - Attempt to delete as user B (directly via database)
  - Verify token still exists

- [ ] **Test: Token reassignment on conflict**
  - User A registers token "ABC123"
  - User B registers same token "ABC123"
  - Verify token is now associated with user B only

### 2. **Deduplication Tests**

#### Deadline Reminders
- [ ] **Test: No duplicate 24-hour deadline notifications**
  - Task due in 24 hours
  - Run deadline reminder check twice
  - Verify only one notification created with dedupe_key "deadline-24h-{taskId}"

- [ ] **Test: No duplicate 1-hour deadline notifications**
  - Task due in 1 hour
  - Run deadline reminder check twice
  - Verify only one notification created with dedupe_key "deadline-1h-{taskId}"

- [ ] **Test: Different time windows create different notifications**
  - Task due in 24 hours
  - Run 24-hour check, verify notification created
  - Time passes, task now due in 1 hour
  - Run 1-hour check, verify second notification created
  - Verify two distinct notifications with different dedupe_keys

#### Overdue Task Reminders
- [ ] **Test: No duplicate overdue notifications**
  - Task is overdue
  - Run overdue check multiple times
  - Verify only one notification created with dedupe_key "overdue-{taskId}"

- [ ] **Test: Overdue notification persists until task completed**
  - Task becomes overdue, notification created
  - Run overdue check again, no new notification
  - Complete the task
  - Create new task, let it become overdue
  - Verify new notification created (different task ID)

#### Event Reminders
- [ ] **Test: No duplicate event reminders for same time window**
  - Event starts in 1 hour
  - Run 1-hour reminder check twice
  - Verify only one notification with dedupe_key "event-1h-{eventId}"

- [ ] **Test: Multiple reminder windows work correctly**
  - Event starts in 1 hour
  - Run 1-hour check, verify notification created
  - Time passes, event starts in 30 minutes
  - Run 30-minute check, verify second notification created
  - Time passes, event starts in 15 minutes
  - Run 15-minute check, verify third notification created
  - Verify three distinct notifications total

#### General Deduplication
- [ ] **Test: Dedupe_key unique constraint enforced**
  - Attempt to insert notification with duplicate dedupe_key
  - Verify database unique constraint violation

- [ ] **Test: Notifications without dedupe_key not affected**
  - Create two task_assigned notifications for same task
  - Verify both created (no dedupe_key set)

### 3. **Push Delivery Tests**

#### Basic Push Functionality
- [ ] **Test: Notification queued for push (pushed_at = null)**
  - Create notification
  - Verify pushed_at is initially null

- [ ] **Test: Push worker processes unpushed notifications**
  - Create 5 notifications with pushed_at = null
  - Run processPushQueue()
  - Verify all 5 have pushed_at timestamp set

- [ ] **Test: Push worker skips already-pushed notifications**
  - Create notification with pushed_at already set
  - Run processPushQueue()
  - Verify notification not processed again

- [ ] **Test: Push worker respects 24-hour window**
  - Create notification from 25 hours ago with pushed_at = null
  - Run processPushQueue()
  - Verify old notification not processed

- [ ] **Test: Push worker limits to 1000 per cycle**
  - Create 1500 notifications with pushed_at = null
  - Run processPushQueue()
  - Verify only 1000 processed in first run
  - Run again, verify remaining 500 processed

#### Multi-Device Push
- [ ] **Test: Notification sent to all user devices**
  - User has 3 devices registered
  - Create notification
  - Run push worker
  - Verify push sent to all 3 devices

- [ ] **Test: User with no devices doesn't break push worker**
  - User has no device tokens
  - Create notification for user
  - Run push worker
  - Verify no errors, pushed_at still updated

#### Invalid Token Cleanup
- [ ] **Test: Invalid tokens identified and removed**
  - Register token "invalid-token-123"
  - Mock Firebase response: invalid-registration-token error
  - Run push worker
  - Verify token deleted from device_tokens table

- [ ] **Test: Valid tokens retained after push**
  - Register token "valid-token-123"
  - Mock Firebase response: success
  - Run push worker
  - Verify token still exists in device_tokens table

- [ ] **Test: Partial batch failure handled correctly**
  - User has 3 tokens: 2 valid, 1 invalid
  - Create notification
  - Run push worker
  - Verify 2 successful sends, 1 invalid token removed

#### Immediate Push
- [ ] **Test: sendImmediatePush bypasses queue**
  - Call sendImmediatePush() directly
  - Verify push sent without notification in database
  - Useful for real-time chat messages

- [ ] **Test: Immediate push cleans up invalid tokens**
  - User has 1 valid, 1 invalid token
  - Call sendImmediatePush()
  - Verify invalid token removed

### 4. **Reminder Scheduler Tests**

#### Deadline Reminders
- [ ] **Test: 24-hour deadline check**
  - Create task due in 23-25 hours
  - Run checkDeadlineReminders()
  - Verify notification created

- [ ] **Test: 1-hour deadline check**
  - Create task due in 55-65 minutes
  - Run checkDeadlineReminders()
  - Verify notification created

- [ ] **Test: Completed tasks don't trigger reminders**
  - Create task due in 1 hour, mark as completed
  - Run checkDeadlineReminders()
  - Verify no notification created

- [ ] **Test: Tasks without assignee don't trigger reminders**
  - Create task due in 1 hour with no assignee
  - Run checkDeadlineReminders()
  - Verify no notification created

#### Overdue Task Reminders
- [ ] **Test: Overdue tasks identified correctly**
  - Create task with due_date in the past
  - Run checkOverdueTasks()
  - Verify notification created

- [ ] **Test: Completed overdue tasks ignored**
  - Create overdue task, mark as completed
  - Run checkOverdueTasks()
  - Verify no notification created

#### Event Reminders
- [ ] **Test: 1-hour event reminder**
  - Create event starting in 1 hour
  - Run checkEventReminders()
  - Verify notification created

- [ ] **Test: 30-minute event reminder**
  - Create event starting in 30 minutes
  - Run checkEventReminders()
  - Verify notification created

- [ ] **Test: 15-minute event reminder**
  - Create event starting in 15 minutes
  - Run checkEventReminders()
  - Verify notification created

- [ ] **Test: Event without participants doesn't trigger reminders**
  - Create event with no participants
  - Run checkEventReminders()
  - Verify no notifications created

#### Scheduler Behavior
- [ ] **Test: Reminder scheduler runs every 5 minutes**
  - Start reminder scheduler
  - Wait 5 minutes
  - Verify processReminders() was called

- [ ] **Test: Scheduler prevents concurrent runs**
  - Start reminder scheduler
  - Manually trigger processReminders() during scheduled run
  - Verify second call skipped (isRunning flag)

- [ ] **Test: Scheduler graceful shutdown**
  - Start reminder scheduler
  - Call stopReminderScheduler()
  - Verify interval cleared, no more executions

### 5. **API Endpoint Tests**

#### GET /api/v1/notifications
- [ ] **Test: Pagination works correctly**
  - Create 50 notifications
  - Query page=1, limit=20
  - Verify 20 notifications returned, pagination metadata correct

- [ ] **Test: Filter by read status**
  - Create 10 unread, 5 read notifications
  - Query with read=false
  - Verify only 10 unread returned

- [ ] **Test: Filter by notification type**
  - Create notifications of various types
  - Query with type=task_assigned
  - Verify only task_assigned notifications returned

- [ ] **Test: Filter by workspace**
  - Create notifications in workspace A and B
  - Query with workspace_id=A
  - Verify only workspace A notifications returned

#### GET /api/v1/notifications/counts
- [ ] **Test: Total count accurate**
  - Create 15 notifications
  - Query counts endpoint
  - Verify total=15

- [ ] **Test: Unread count accurate**
  - Create 10 unread, 5 read notifications
  - Query counts endpoint
  - Verify unread=10, read=5

- [ ] **Test: Counts by type accurate**
  - Create 3 task_assigned, 2 task_comment, 1 mention
  - Query counts endpoint
  - Verify breakdown correct

#### PATCH /api/v1/notifications/:id/read
- [ ] **Test: Mark as read updates timestamp**
  - Create unread notification
  - Mark as read
  - Verify read_at timestamp set

- [ ] **Test: Idempotent - marking read twice**
  - Mark notification as read
  - Mark as read again
  - Verify no error, read_at unchanged

#### POST /api/v1/notifications/mark-all-read
- [ ] **Test: All unread marked as read**
  - Create 10 unread notifications
  - Call mark-all-read
  - Verify all have read_at timestamp

- [ ] **Test: Workspace filter works**
  - Create 5 unread in workspace A, 5 in workspace B
  - Call mark-all-read with workspace_id=A
  - Verify only workspace A marked as read

#### DELETE /api/v1/notifications/:id
- [ ] **Test: Delete removes notification**
  - Create notification
  - Delete it
  - Verify notification no longer exists

- [ ] **Test: Cannot delete non-existent notification**
  - Attempt to delete non-existent ID
  - Verify 404 response

#### POST /api/v1/notifications/bulk-delete
- [ ] **Test: Multiple notifications deleted**
  - Create 5 notifications
  - Bulk delete all 5
  - Verify all removed, count=5 returned

- [ ] **Test: Input validation - requires array**
  - Send non-array input
  - Verify 400 validation error

#### POST /api/v1/device-tokens
- [ ] **Test: Register new token**
  - Register token for first time
  - Verify 201 Created response

- [ ] **Test: Re-register same token updates timestamp**
  - Register token
  - Register same token again
  - Verify 200 OK, updated_at refreshed

- [ ] **Test: Platform validation**
  - Attempt invalid platform "linux"
  - Verify 400 validation error

- [ ] **Test: Token length validation**
  - Attempt token with < 10 characters
  - Verify 400 validation error

#### POST /api/v1/device-tokens/cleanup-invalid
- [ ] **Test: Bulk cleanup of invalid tokens**
  - Register 5 tokens
  - Call cleanup with 3 token strings
  - Verify 3 deleted, count=3 returned

### 6. **Notification Helper Function Tests**

#### notifyTaskAssigned
- [ ] **Test: Creates notification with correct data**
  - Call notifyTaskAssigned()
  - Verify notification has type=task_assigned, correct entity_type/id

- [ ] **Test: Doesn't notify self-assignment**
  - Assign task to self (assignedBy === userId)
  - Verify no notification created

#### notifyTaskComment
- [ ] **Test: Creates notification for task owner**
  - Call notifyTaskComment()
  - Verify notification created for task owner

- [ ] **Test: Doesn't notify commenter about own comment**
  - Comment as task owner (commentedBy === userId)
  - Verify no notification created

#### notifyMention
- [ ] **Test: Creates mention notification**
  - Call notifyMention()
  - Verify notification has type=mention

#### notifyDeadlineApproaching
- [ ] **Test: Creates notification with dedupe_key**
  - Call notifyDeadlineApproaching(hoursUntilDue=24)
  - Verify dedupe_key="deadline-24h-{taskId}"

#### notifyTaskOverdue
- [ ] **Test: Creates notification with dedupe_key**
  - Call notifyTaskOverdue()
  - Verify dedupe_key="overdue-{taskId}"

#### notifyEventReminder
- [ ] **Test: Creates notification with dedupe_key**
  - Call notifyEventReminder(minutesUntilStart=60)
  - Verify dedupe_key="event-1h-{eventId}"

### 7. **Integration Tests**

#### End-to-End Notification Flow
- [ ] **Test: Complete notification lifecycle**
  1. Create task assigned notification
  2. Verify in database with pushed_at=null
  3. Run push worker
  4. Verify pushed_at updated, FCM message sent
  5. Mark notification as read via API
  6. Verify read_at timestamp set
  7. Delete notification via API
  8. Verify removed from database

#### End-to-End Reminder Flow
- [ ] **Test: Deadline reminder full cycle**
  1. Create task due in 24 hours
  2. Run reminder scheduler
  3. Verify notification created with dedupe_key
  4. Run push worker
  5. Verify push sent to assigned user
  6. Run reminder scheduler again
  7. Verify no duplicate notification created

#### Concurrent Operations
- [ ] **Test: Concurrent token registrations**
  - Simulate 10 concurrent registrations of same token
  - Verify only one token record exists
  - Verify no errors or race conditions

- [ ] **Test: Concurrent mark-all-read calls**
  - Create 100 unread notifications
  - Call mark-all-read twice simultaneously
  - Verify all marked as read, no errors

### 8. **Error Handling Tests**

#### Database Errors
- [ ] **Test: Supabase connection failure**
  - Simulate database connection error
  - Verify error logged, 500 response returned

- [ ] **Test: Invalid notification ID format**
  - Query with invalid UUID format
  - Verify 400 validation error

#### Firebase Errors
- [ ] **Test: Firebase credentials missing**
  - Start server without FIREBASE_SERVICE_ACCOUNT_JSON
  - Verify warning logged, push worker continues (no crash)

- [ ] **Test: Firebase network timeout**
  - Simulate Firebase API timeout
  - Verify error logged, push worker continues

#### Rate Limiting
- [ ] **Test: API rate limiting enforced**
  - Make 100 requests in 1 second
  - Verify 429 Too Many Requests after threshold

### 9. **Performance Tests**

#### Large Batch Operations
- [ ] **Test: Process 1000 notifications efficiently**
  - Create 1000 notifications
  - Run push worker
  - Verify all processed in < 30 seconds

- [ ] **Test: Bulk delete 500 notifications**
  - Create 500 notifications
  - Bulk delete all
  - Verify operation completes in < 5 seconds

#### Scheduler Performance
- [ ] **Test: Reminder check with 10,000 tasks**
  - Create 10,000 tasks with various due dates
  - Run deadline reminder check
  - Verify completes in < 10 seconds

### 10. **Manual Testing Procedures**

#### Firebase Cloud Messaging
**Prerequisites:** Real Firebase project with valid credentials

1. **Android Device Registration**
   - Install PlanPal on Android device
   - Register device token via POST /device-tokens
   - Verify token appears in database

2. **Push Notification Delivery**
   - Create notification for test user
   - Wait for push scheduler (1 minute)
   - Verify notification appears on Android device
   - Verify pushed_at timestamp updated in database

3. **Invalid Token Cleanup**
   - Uninstall PlanPal from device (invalidates token)
   - Create notification for user
   - Wait for push worker
   - Verify token removed from database (invalid-registration-token error)

4. **Multi-Device Push**
   - Register 3 devices for same user (Android, iOS, Windows)
   - Create notification
   - Verify push delivered to all 3 devices

#### Reminder System
1. **Deadline Reminder**
   - Create task due in exactly 24 hours
   - Wait for reminder scheduler (5 minutes)
   - Verify notification created
   - Verify push sent to assigned user

2. **Overdue Notification**
   - Create task with due_date in the past
   - Wait for reminder scheduler
   - Verify overdue notification created

3. **Event Reminder Cascade**
   - Create event starting in 1 hour
   - Wait 5 minutes, verify 1-hour notification
   - Wait until 30 minutes before
   - Verify 30-minute notification created
   - Wait until 15 minutes before
   - Verify 15-minute notification created

#### Notification UI (Flutter)
Will be tested in Tasks 7-14

## Test Data Setup

### Sample Users
```sql
-- User A
id: 'user-a-uuid'
email: 'usera@test.com'

-- User B  
id: 'user-b-uuid'
email: 'userb@test.com'
```

### Sample Workspaces
```sql
-- Workspace 1
id: 'ws-1-uuid'
name: 'Test Workspace 1'

-- Workspace 2
id: 'ws-2-uuid'
name: 'Test Workspace 2'
```

### Sample Tasks
```sql
-- Task due in 24 hours
INSERT INTO tasks (id, title, due_date, assigned_to, workspace_id)
VALUES ('task-1', 'Test Task 1', NOW() + INTERVAL '24 hours', 'user-a-uuid', 'ws-1-uuid');

-- Task due in 1 hour
INSERT INTO tasks (id, title, due_date, assigned_to, workspace_id)
VALUES ('task-2', 'Test Task 2', NOW() + INTERVAL '1 hour', 'user-a-uuid', 'ws-1-uuid');

-- Overdue task
INSERT INTO tasks (id, title, due_date, assigned_to, workspace_id)
VALUES ('task-3', 'Overdue Task', NOW() - INTERVAL '1 day', 'user-a-uuid', 'ws-1-uuid');
```

### Sample Device Tokens
```sql
INSERT INTO device_tokens (user_id, token, platform)
VALUES 
  ('user-a-uuid', 'android-token-123', 'android'),
  ('user-a-uuid', 'ios-token-456', 'ios'),
  ('user-b-uuid', 'android-token-789', 'android');
```

## Running Tests

### Automated Unit Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test notifications.test.js

# Run with coverage
npm test -- --coverage

# Watch mode
npm test:watch
```

### Manual API Tests (Postman/Insomnia)
1. Import API collection (create from endpoints)
2. Set environment variables (AUTH_TOKEN, BASE_URL)
3. Run test suite

### Database Inspection
```bash
# Connect to Supabase
npx supabase db connect

# Check notifications
SELECT * FROM notifications ORDER BY created_at DESC LIMIT 10;

# Check device tokens
SELECT * FROM device_tokens;

# Check dedupe_key usage
SELECT dedupe_key, COUNT(*) FROM notifications GROUP BY dedupe_key HAVING COUNT(*) > 1;
```

## Success Criteria

✅ **Privacy Tests:** All user isolation tests pass, no cross-user data leakage  
✅ **Deduplication Tests:** No duplicate reminders created for same event/time window  
✅ **Push Delivery Tests:** All unpushed notifications processed, invalid tokens cleaned up  
✅ **Reminder Tests:** All deadline/overdue/event reminders created on schedule  
✅ **API Tests:** All endpoints return correct status codes and data  
✅ **Error Handling:** System gracefully handles all error scenarios  
✅ **Performance:** Large batch operations complete within acceptable time limits

## Test Coverage Goals

- **Notifications API:** 90%+ coverage
- **Device Tokens API:** 90%+ coverage
- **Push Worker:** 85%+ coverage (excluding Firebase mocks)
- **Reminder Scheduler:** 85%+ coverage
- **Notification Helpers:** 95%+ coverage (pure functions)

## Known Limitations

1. **Firebase Mocking:** Real Firebase integration requires manual testing with live credentials
2. **Timing Tests:** Reminder scheduler tests may need time manipulation (test clock)
3. **Concurrency:** Race condition tests require specialized testing tools
4. **Performance:** Load tests need production-like environment

## Next Steps

After completing these tests:
1. **Task 6:** Flutter notifications repository with Drift schema
2. **Task 7:** Flutter notifications UI
3. **Task 8-14:** Complete notification system with UI integration

---

**Document Version:** 1.0  
**Last Updated:** Stage 11, Task 5  
**Total Test Cases:** 150+
