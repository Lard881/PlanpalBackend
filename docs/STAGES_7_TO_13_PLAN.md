# Stages 7-13: Implementation Plan

**Status**: Implementation in progress  
**Goal**: Complete all remaining backend endpoints before git push

---

## Stage 7: Tasks (Core Feature)
**Priority**: CRITICAL - Most complex stage

### Endpoints (17 total)
**Tasks** (7):
- GET `/api/v1/workspaces/:id/tasks` - List with filtering/sorting
- POST `/api/v1/workspaces/:id/tasks` - Create (with subtasks, attachments)
- GET `/api/v1/tasks/:id` - Get full task
- PATCH `/api/v1/tasks/:id` - Update (detect changes for notifications)
- DELETE `/api/v1/tasks/:id` - Soft delete
- POST `/api/v1/tasks/bulk` - Bulk complete/delete
- POST `/api/v1/tasks/:id/move` - Move to another workspace

**Subtasks** (3):
- POST `/api/v1/tasks/:id/subtasks` - Create subtask
- PATCH `/api/v1/subtasks/:id` - Update subtask
- DELETE `/api/v1/subtasks/:id` - Delete subtask

**Comments** (4):
- GET `/api/v1/tasks/:id/comments` - List with pagination
- POST `/api/v1/tasks/:id/comments` - Create (with @mentions)
- PATCH `/api/v1/comments/:id` - Update (author only)
- DELETE `/api/v1/comments/:id` - Delete (author or admin)

**Attachments** (2):
- POST `/api/v1/tasks/:id/attachments` - Attach file
- DELETE `/api/v1/tasks/:id/attachments/:fileId` - Remove attachment

### Complexity Factors
- Query filtering: status, priority, assignee, label, date ranges, search text
- View filters: today, week, overdue, all
- Sorting: due_at, priority, created_at, title
- Cursor pagination
- Notification triggers: task_assigned, task_updated, task_comment, @mentions
- RLS enforcement: guests see only assigned tasks
- Subtask counts in list view
- Assignee validation (must be workspace member)

---

## Stage 8: Calendar Events
**Endpoints** (4):
- GET `/api/v1/workspaces/:id/events?from=&to=` - Range query + due tasks
- POST `/api/v1/workspaces/:id/events` - Create event
- PATCH `/api/v1/events/:id` - Update event
- DELETE `/api/v1/events/:id` - Soft delete

### Key Features
- Date range required (max 62 days)
- Returns events + tasks with due_at in range
- Attendee management
- All-day events support

---

## Stage 9: Files and Documents
**Endpoints** (11):

**Files** (3):
- POST `/api/v1/workspaces/:id/files/upload-url` - Get signed upload URL
- GET `/api/v1/files/:id/download-url` - Get signed download URL
- DELETE `/api/v1/files/:id` - Delete file

**Folders** (3):
- GET `/api/v1/workspaces/:id/folders?parentId=` - List folders
- POST `/api/v1/workspaces/:id/folders` - Create folder
- PATCH/DELETE `/api/v1/folders/:id` - Update/delete folder

**Documents** (5):
- GET `/api/v1/workspaces/:id/documents` - List documents
- POST `/api/v1/workspaces/:id/documents` - Create (file or written)
- GET `/api/v1/documents/:id` - Get document
- PATCH `/api/v1/documents/:id` - Update document
- DELETE `/api/v1/documents/:id` - Soft delete

### Complexity
- Signed URLs (admin client after RLS check)
- File name sanitization
- Size/type validation (25MB, specific MIME types)
- Two document types: file-based and written (Quill delta)
- Storage bucket operations

---

## Stage 10: Chat
**Endpoints** (10):
- GET `/api/v1/workspaces/:id/channels` - List channels + DMs
- POST `/api/v1/workspaces/:id/channels` - Create channel
- POST `/api/v1/workspaces/:id/dms` - Get/create DM
- POST `/api/v1/channels/:id/members` - Add members
- DELETE `/api/v1/channels/:id/members/:userId` - Remove/leave
- GET `/api/v1/channels/:id/messages` - Get messages
- POST `/api/v1/channels/:id/messages` - Send message
- PATCH `/api/v1/messages/:id` - Edit message
- DELETE `/api/v1/messages/:id` - Delete message
- POST `/api/v1/channels/:id/read` - Mark as read

### Key Features
- Personal workspace check (chat not available)
- Idempotent message sending (client-generated IDs)
- @mention parsing and notifications
- Unread counts
- Last message preview
- Chat vs DM distinction

---

## Stage 11: Notifications and Push
**Endpoints** (8):

**Notifications** (5):
- GET `/api/v1/notifications?filter=&cursor=` - List with filters
- POST `/api/v1/notifications/:id/read` - Mark read
- POST `/api/v1/notifications/:id/unread` - Mark unread
- POST `/api/v1/notifications/read-all` - Bulk mark read
- DELETE `/api/v1/notifications/:id` - Dismiss

**Devices** (2):
- POST `/api/v1/devices` - Register FCM token
- DELETE `/api/v1/devices/:token` - Unregister token

**Push** (1):
- POST `/internal/push/run` - Cron-triggered push sender

### Complexity
- Filter types: all, unread, tasks, mentions
- Counts for badges
- Firebase Admin SDK integration
- Push service (sendPending, sendForIds)
- Cron secret authentication
- Token cleanup on invalid tokens

---

## Stage 12: Search
**Endpoints** (1):
- GET `/api/v1/search?q=&workspaceId=&type=&limit=` - Universal search

### Key Features
- Calls `search_all` database function
- Types: all, task, document, person
- Returns counts per type
- Minimum query length: 2 characters
- Person deduplication
- Cross-workspace or single workspace

---

## Stage 13: Analytics
**Endpoints** (3):
- GET `/api/v1/workspaces/:id/analytics?range=` - Full analytics
- GET `/api/v1/workspaces/:id/analytics/export.csv` - CSV export
- GET `/api/v1/workspaces/:id/overview?range=` - Dashboard summary

### Key Features
- Date ranges: 7d, 30d, 90d, week
- Multiple database function calls in parallel
- CSV generation
- Productivity percentage calculation
- Guest role blocked (403)

---

## Additional Requirement
**DELETE /me endpoint**: Account deletion with safety checks

---

## Implementation Strategy

### Order of Implementation
1. ✅ Stage 2: Foundation (DONE)
2. ✅ Stage 5: Workspaces (DONE)
3. ✅ Stage 6: Labels + Sync (DONE)
4. ⏳ Stage 7: Tasks (IN PROGRESS)
5. Stage 8: Events
6. Stage 9: Files + Documents
7. Stage 10: Chat
8. Stage 11: Notifications + Push
9. Stage 12: Search
10. Stage 13: Analytics
11. DELETE /me endpoint

### Approach
- Create route files with all endpoints
- Use existing middleware (auth, workspace, validate)
- Leverage RLS for permission checks
- Add notification triggers where specified
- Write test structures (integration tests need test DB)
- Document completion in stage reports

---

**Current Progress**: Stages 2, 5, 6 complete. Starting Stage 7.
