# PlanPal API Contract

Generated from the tested source code after Fix Round 2.
Base path: `/api/v1`. All dates are ISO 8601 UTC. IDs are UUIDs.

**Conventions**
- Request bodies: camelCase field names.
- Response rows: snake_case field names from Postgres; shaped objects use camelCase.
- Named wrapper keys: e.g. `{ tasks, nextCursor }`, `{ task }`, `{ channel }`.
- Error shape: `{ error: { code, message, requestId } }`.
- Auth: `Authorization: Bearer <supabase_access_token>` required on every endpoint except `/health`.

---

## Authentication errors (all endpoints)

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `AUTH_REQUIRED` | Missing token |
| 401 | `AUTH_EXPIRED` | Token expired |
| 403 | `NOT_A_MEMBER` | No membership in this workspace |
| 403 | `FORBIDDEN` | Role does not permit this action |
| 400 | `VALIDATION_FAILED` | Invalid/missing fields; `details` lists them |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server bug |

---

## GET /health

No auth required.

**Response 200**
```json
{ "status": "ok", "time": "2026-10-14T09:00:00.000Z" }
```

---

## GET /me

Returns the current user's profile, workspace list and personal workspace id.

**Response 200**
```json
{
  "profile": {
    "id": "uuid",
    "email": "user@example.com",
    "fullName": "Maya Chen",
    "avatarUrl": "https://...",
    "timezone": "UTC",
    "language": "en",
    "theme": "system",
    "createdAt": "2026-01-01T00:00:00.000Z"
  },
  "workspaces": [
    { "id": "uuid", "name": "My Space", "type": "personal", "role": "admin" }
  ],
  "personalWorkspaceId": "uuid"
}
```

---

## PATCH /me

**Request body** (all optional)
```json
{
  "fullName": "Maya Chen",
  "avatarUrl": "https://...",
  "timezone": "America/New_York",
  "language": "en",
  "theme": "dark"
}
```
`language`: one of `en es fr zh ko`. `theme`: one of `light dark system`.

**Response 200** `{ "profile": { ...same shape as GET /me profile... } }`

---

## POST /me/avatar-upload-url

**Request body** `{ "name": "photo.jpg", "mimeType": "image/jpeg", "sizeBytes": 102400 }`

**Response 200** `{ "fileId": "uuid", "uploadUrl": "https://...", "token": "...", "path": "avatars/uuid/photo.jpg" }`

---

## DELETE /me/avatar

**Response 204** No content.

---

## DELETE /me

Deletes the account. Blocked if the user is the last admin of a team with other members.

**Request body** `{ "password": "current-password" }`

**Response 204** No content.

**Error 409** `TRANSFER_ADMIN_FIRST`

---

## GET /workspaces

**Response 200** `{ "workspaces": [ { "id", "name", "type", "role", "memberCount" } ] }`

---

## POST /workspaces

**Request body** `{ "name": "Acme Studio" }`

**Response 201** `{ "workspace": { "id", "name", "type": "team", "role": "admin" } }`

---

## GET /workspaces/:workspaceId

**Response 200** `{ "workspace": { "id", "name", "type", "memberCount", "role" } }`

---

## PATCH /workspaces/:workspaceId

Admin only. Personal workspaces cannot be renamed.

**Request body** `{ "name": "New Name" }`

**Response 200** `{ "workspace": { ... } }`

---

## DELETE /workspaces/:workspaceId

Admin only. Personal workspaces cannot be deleted.

**Response 204** No content.

---

## POST /workspaces/join

**Request body** `{ "code": "ABCD1234" }`

**Response 200** `{ "workspace": { ... } }`

**Errors** `INVALID_CODE` `CODE_EXPIRED` `CODE_REVOKED` `CODE_USED_UP` `ALREADY_MEMBER`

---

## GET /workspaces/:workspaceId/members

**Response 200** `{ "members": [ { "user_id", "role", "joined_at", "profiles": { "full_name", "email", "avatar_url" } } ] }`

---

## PATCH /workspaces/:workspaceId/members/:userId

Admin only.

**Request body** `{ "role": "member" }`

**Response 200** `{ "member": { ... } }`

**Error 403** `LAST_ADMIN`

---

## DELETE /workspaces/:workspaceId/members/:userId

Admin (remove others) or self (leave). Personal workspaces blocked.

**Response 204** No content.

---

## GET /workspaces/:workspaceId/invites

Admin only.

**Response 200** `{ "invites": [ { "id", "code", "role", "max_uses", "use_count", "expires_at", "revoked_at", "created_at" } ] }`

---

## POST /workspaces/:workspaceId/invites

Admin only.

**Request body** `{ "role": "member", "maxUses": 10, "expiresAt": "2026-12-01T00:00:00Z" }`

**Response 201** `{ "invite": { "id", "code", "role", "max_uses", "expires_at" } }`

---

## DELETE /workspaces/:workspaceId/invites/:inviteId

Admin only. Sets `revoked_at`.

**Response 204** No content.

---

## GET /workspaces/:workspaceId/labels

**Response 200** `{ "labels": [ { "id", "workspace_id", "name", "color", "created_at" } ] }`

---

## POST /workspaces/:workspaceId/labels

**Request body** `{ "name": "Bug", "color": "#EF4444" }`

**Response 201** `{ "label": { ... } }`

---

## PATCH /workspaces/:workspaceId/labels/:labelId

**Request body** `{ "name": "...", "color": "..." }` (both optional)

**Response 200** `{ "label": { ... } }`

---

## DELETE /workspaces/:workspaceId/labels/:labelId

Admin only.

**Response 204** No content.

---

## GET /workspaces/:workspaceId/tasks

**Query params** `status` `priority` `assigneeId` `labelId` `dueFrom` `dueTo` `q` `view=today|week|overdue|all` `sort=due_at|priority|created_at|title` `order=asc|desc` `limit` `cursor`

**Response 200**
```json
{
  "tasks": [
    {
      "id": "uuid",
      "workspace_id": "uuid",
      "title": "Plan offsite",
      "status": "todo",
      "priority": "high",
      "due_at": "2026-10-20T17:00:00.000Z",
      "reminder_minutes_before": 60,
      "assignee_id": "uuid",
      "label_id": "uuid",
      "created_by": "uuid",
      "completed_at": null,
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-01T00:00:00.000Z",
      "deleted_at": null,
      "assignee": { "id": "uuid", "full_name": "Maya Chen", "avatar_url": "..." },
      "label": { "id": "uuid", "name": "Bug", "color": "#EF4444" },
      "subtask_counts": { "done": 1, "total": 3 }
    }
  ],
  "nextCursor": null
}
```

---

## POST /workspaces/:workspaceId/tasks

**Request body**
```json
{
  "id": "uuid",
  "title": "Plan offsite",
  "description": "Venue, date, agenda...",
  "priority": "high",
  "dueAt": "2026-10-20T17:00:00.000Z",
  "reminderMinutesBefore": 60,
  "assigneeId": "uuid",
  "labelId": "uuid",
  "subtasks": [{ "id": "uuid", "title": "Book venue" }],
  "attachmentFileIds": ["uuid"]
}
```
`id` is optional (client-generated for offline use; idempotent on repeat). Subtask IDs are optional and client-supplied IDs make retried offline task creation idempotent without duplicate subtasks.
`reminderMinutesBefore` is optional and nullable. Values must be whole minutes >= 5; `null` or omission uses the default reminder 24 hours before the due time.

**Response 201** `{ "task": { ...same shape as list row... } }`

---

## GET /tasks/:taskId

**Response 200**
```json
{
  "task": {
    "...all task fields...",
    "assignee": { "id", "full_name", "email", "avatar_url" },
    "label": { "id", "name", "color" },
    "subtasks": [ { "id", "title", "done", "position", "created_at" } ],
    "task_attachments": [ { "file_id", "files": { "id", "name", "mime_type", "size_bytes", "created_at" } } ],
    "comments": [
      { "id", "body", "created_at", "updated_at", "author": { "id", "full_name", "avatar_url" } }
    ]
  }
}
```

---

## PATCH /tasks/:taskId

**Request body** (all optional): `title` `description` `priority` `status` `dueAt` `reminderMinutesBefore` `assigneeId` `labelId`. `reminderMinutesBefore` is nullable; `null` resets to the default 24-hour reminder.

**Response 200** `{ "task": { ... } }`

---

## DELETE /tasks/:taskId

**Response 204** No content.

---

## POST /tasks/bulk

**Request body** `{ "ids": ["uuid"], "action": "complete" }`
`action`: `complete` or `delete`.

**Response 200** `{ "succeeded": ["uuid"], "failed": [ { "id": "uuid", "code": "NOT_FOUND" } ] }`

---

## POST /tasks/:taskId/subtasks

**Request body** `{ "id": "uuid", "title": "Book venue" }`; `id` is optional and client-supplied IDs are idempotent for offline retries. Replaying the same ID and matching task/title returns the existing subtask.

**Response 201** `{ "subtask": { "id", "task_id", "title", "is_done", "position", "created_at" } }`

---

## PATCH /subtasks/:subtaskId

**Request body** `{ "title": "...", "done": true }` (at least one required)

`done` is mapped to the database field `is_done`.

**Response 200** `{ "subtask": { ... } }`

---

## DELETE /subtasks/:subtaskId

**Response 204** No content.

---

## GET /tasks/:taskId/comments

**Query** `cursor`

**Response 200** `{ "comments": [ { "id", "body", "created_at", "author": { "id", "full_name", "avatar_url" } } ], "nextCursor": null }`

---

## POST /tasks/:taskId/comments

**Request body** `{ "id": "uuid", "body": "Looks good! @[Maya Chen](user:uuid)" }`; `id` is optional and client-supplied IDs are idempotent for offline retries.

**Response 201** `{ "comment": { "id", "task_id", "body", "created_at", "author": { ... } } }`

---

## PATCH /comments/:commentId

Author only.

**Request body** `{ "body": "Updated text" }`

**Response 200** `{ "comment": { ... } }`

---

## DELETE /comments/:commentId

Author or admin.

**Response 204** No content.

---

## POST /tasks/:taskId/attachments

**Request body** `{ "fileId": "uuid" }`

**Response 201** `{ "attachment": { "task_id", "file_id", "created_at" } }`

---

## DELETE /tasks/:taskId/attachments/:fileId

**Response 204** No content.

---

## POST /tasks/:taskId/move

**Request body** `{ "targetWorkspaceId": "uuid" }`

**Response 200** `{ "task": { ... } }`

---

## GET /workspaces/:workspaceId/events?from=&to=

`from` and `to` are ISO datetime strings. Max range: 62 days.

**Response 200**
```json
{
  "events": [
    {
      "id": "uuid",
      "workspace_id": "uuid",
      "title": "Team standup",
      "description": "",
      "starts_at": "2026-10-14T09:00:00.000Z",
      "ends_at": "2026-10-14T09:30:00.000Z",
      "all_day": false,
      "color": "#4F46E5",
      "reminder_minutes_before": 15,
      "created_by": "uuid",
      "event_attendees": [ { "user_id": "uuid", "profiles": { "full_name", "avatar_url" } } ]
    }
  ],
  "dueTasks": [ { "id", "title", "due_at", "status", "priority" } ]
}
```

---

## POST /workspaces/:workspaceId/events

**Request body**
```json
{
  "id": "uuid",
  "title": "Team standup",
  "startsAt": "2026-10-14T09:00:00.000Z",
  "endsAt": "2026-10-14T09:30:00.000Z",
  "allDay": false,
  "color": "#4F46E5",
  "description": "Daily sync",
  "attendeeIds": ["uuid"],
  "reminderMinutesBefore": 15
}
```

`id` is optional. A client-supplied ID supports offline retries; replaying the same event data does not create a duplicate event or attendee.

**Response 201** `{ "event": { ... } }`

---

## PATCH /events/:eventId

**Request body** (all optional): `title` `startsAt` `endsAt` `allDay` `color` `description` `attendeeIds` `reminderMinutesBefore`

**Response 200** `{ "event": { ... } }`

---

## DELETE /events/:eventId

**Response 204** No content.

---

## GET /workspaces/:workspaceId/channels

Team workspaces only.

**Response 200**
```json
{
  "channels": [
    {
      "id": "uuid",
      "workspace_id": "uuid",
      "kind": "channel",
      "name": "general",
      "description": "",
      "is_private": false,
      "created_by": "uuid",
      "created_at": "...",
      "lastMessage": { "body": "Hey!", "createdAt": "...", "authorName": "Maya" },
      "unreadCount": 3,
      "otherUser": null
    },
    {
      "id": "uuid",
      "kind": "dm",
      "name": null,
      "lastMessage": { ... },
      "unreadCount": 1,
      "otherUser": { "id": "uuid", "full_name": "Alex Kim", "avatar_url": "..." }
    }
  ]
}
```
`otherUser` is present (and non-null) only for `kind = "dm"` channels.

---

## POST /workspaces/:workspaceId/channels

**Request body** `{ "name": "design", "description": "...", "isPrivate": false, "memberIds": ["uuid"] }`

**Response 201** `{ "channel": { ... } }`

---

## POST /workspaces/:workspaceId/dms

**Request body** `{ "userId": "uuid" }`

**Response 200** `{ "channel": { ...channel fields..., "otherUser": { "id", "full_name", "avatar_url" } } }`

---

## POST /channels/:channelId/members

**Request body** `{ "userId": "uuid" }`

**Response 201** `{ "member": { "channel_id", "user_id" } }`

---

## DELETE /channels/:channelId/members/:userId

**Response 204** No content.

---

## GET /channels/:channelId/messages?before=&limit=50

`before`: ISO datetime cursor. `limit`: 1–100, default 50.

**Response 200**
```json
{
  "messages": [
    {
      "id": "uuid",
      "body": "Hey team!",
      "file_id": null,
      "created_at": "...",
      "updated_at": "...",
      "edited_at": null,
      "sender": { "id": "uuid", "full_name": "Maya Chen", "avatar_url": "..." }
    }
  ],
  "hasMore": false
}
```

---

## POST /channels/:channelId/messages

**Request body** `{ "id": "uuid", "body": "Hey!", "fileId": "uuid" }` (`body` or `fileId` required; `id` required for idempotency)

**Response 201** `{ "message": { ...same shape as list row... } }`

---

## PATCH /messages/:messageId

**Request body** `{ "body": "Edited text" }`

**Response 200** `{ "message": { ... } }`

---

## DELETE /messages/:messageId

**Response 204** No content.

---

## POST /channels/:channelId/read

**Response 200** `{ "success": true }`

---

## POST /workspaces/:workspaceId/files/upload-url

**Request body** `{ "name": "report.pdf", "mimeType": "application/pdf", "sizeBytes": 5242880 }`

Max size: 25 MB. Allowed types: common document, image, video and audio types.

**Response 200** `{ "fileId": "uuid", "uploadUrl": "https://...", "token": "...", "path": "ws-uuid/file-uuid/report.pdf" }`

**Error 400** `FILE_TOO_LARGE` `FILE_TYPE_NOT_ALLOWED`

---

## GET /files/:fileId/download-url

**Response 200** `{ "url": "https://...", "expiresAt": "..." }`

---

## DELETE /files/:fileId

**Response 204** No content.

---

## GET /workspaces/:workspaceId/folders?parentId=

`parentId` optional; omit for root folders.

**Response 200** `{ "folders": [ { "id", "name", "parent_id", "workspace_id", "file_count", "created_at" } ] }`

---

## POST /workspaces/:workspaceId/folders

**Request body** `{ "name": "Design Assets", "parentId": null }`

**Response 201** `{ "folder": { ... } }`

---

## PATCH /folders/:folderId

**Request body** `{ "name": "New Name", "parentId": "uuid" }` (both optional)

**Response 200** `{ "folder": { ... } }`

---

## DELETE /folders/:folderId

Only if empty.

**Response 204** No content.

**Error 409** `FOLDER_NOT_EMPTY`

---

## GET /workspaces/:workspaceId/documents?folderId=&kind=&recent=

`kind`: `file` or `written`. `recent=true` returns latest 12.

**Response 200** `{ "documents": [ { "id", "kind", "title", "folder_id", "file_id", "created_at", "updated_at" } ] }`

---

## POST /workspaces/:workspaceId/documents

**Request body (file)** `{ "kind": "file", "title": "Report", "fileId": "uuid", "folderId": "uuid" }`

**Request body (written)** `{ "kind": "written", "title": "Meeting notes", "content": {}, "contentText": "...", "folderId": null }`

**Response 201** `{ "document": { ... } }`

---

## GET /documents/:documentId

**Response 200** `{ "document": { "id", "kind", "title", "folder_id", "file_id", "content", "content_text", "workspace_id", "created_by", "created_at", "updated_at" } }`

---

## PATCH /documents/:documentId

**Request body** `{ "title": "...", "folderId": "uuid", "content": {}, "contentText": "..." }` (all optional)

**Response 200** `{ "document": { ... } }`

---

## DELETE /documents/:documentId

**Response 204** No content.

---

## GET /notifications?filter=&cursor=

`filter`: `all` `unread` `tasks` `mentions`. Default `all`.

**Response 200**
```json
{
  "notifications": [
    {
      "id": "uuid",
      "type": "task_assigned",
      "title": "Task assigned to you",
      "body": "\"Plan offsite\"",
      "entity_type": "task",
      "entity_id": "uuid",
      "workspace_id": "uuid",
      "read_at": null,
      "created_at": "..."
    }
  ],
  "unreadCount": 5,
  "totalCount": 12,
  "nextCursor": null
}
```

---

## POST /notifications/:id/read

**Response 200** `{ "ok": true }`

---

## POST /notifications/:id/unread

**Response 200** `{ "ok": true }`

---

## POST /notifications/read-all

**Response 200** `{ "ok": true }`

---

## DELETE /notifications/:id

**Response 204** No content.

---

## POST /devices

**Request body** `{ "token": "fcm-token", "platform": "android" }`

**Response 200** `{ "ok": true }`

---

## DELETE /devices/:token

**Response 204** No content.

---

## GET /search?q=&workspaceId=&type=&limit=

`q` min length 2. `type`: `all` `task` `document` `person`. `workspaceId` optional.

**Response 200**
```json
{
  "counts": { "all": 8, "task": 3, "document": 3, "person": 2 },
  "results": [
    { "id": "uuid", "type": "task", "title": "Plan offsite", "workspaceId": "uuid", "score": 0.9 }
  ]
}
```

---

## GET /workspaces/:workspaceId/analytics?range=

`range`: `7d` `30d` `90d`. Default `7d`. Member or admin only (guests get 403).

**Response 200**
```json
{
  "summary": {
    "completed": 24,
    "completed_prev": 18,
    "on_time_rate": 87.5,
    "avg_completion_hours": 14.2,
    "changeVsPrevious": 33
  },
  "weekly": [ { "week": "2026-10-07", "completed": 6 } ],
  "categories": [ { "label": "Bug", "count": 8, "color": "#EF4444" } ],
  "daily": [ { "day": "2026-10-07", "completed": 3 } ],
  "streak": 5
}
```
`changeVsPrevious`: percent change vs previous period, or `null` if no previous data.
`summary.changeVsPrevious` is the field name (camelCase in the shaped wrapper object).

---

## GET /workspaces/:workspaceId/analytics/export.csv?range=

`range`: `7d` `30d` `90d`.

**Response 200** `Content-Type: text/csv`, `Content-Disposition: attachment; filename="analytics-7d.csv"`

```
Date,Completed Tasks
2026-10-07,3
2026-10-08,5
```

---

## GET /workspaces/:workspaceId/overview?range=

`range`: `week` `7d` `30d`. Default `week`.

**Response 200**
```json
{
  "counts": { "completed": 12, "inProgress": 4, "overdue": 2 },
  "productivityPercent": 87,
  "dailySeries": [ { "day": "2026-10-07", "completed": 3 } ]
}
```

---

## GET /workspaces/:workspaceId/sync?since=

`since`: ISO datetime (optional; omit for full sync).

**Response 200**
```json
{
  "serverTime": "2026-10-14T09:00:00.000Z",
  "tasks": [ { "...all task columns including deleted_at..." } ],
  "subtasks": [ { "..." } ],
  "taskComments": [ { "..." } ],
  "taskAttachments": [ { "..." } ],
  "labels": [ { "..." } ],
  "events": [ { "..." } ],
  "eventAttendees": [ { "..." } ],
  "channels": [ { "..." } ],
  "documents": [ { "..." } ],
  "folders": [ { "..." } ],
  "members": [ { "workspace_id", "user_id", "role", "joined_at", "updated_at" } ],
  "profiles": [ { "id", "full_name", "email", "avatar_url" } ],
  "files": [ { "..." } ],
  "hasMore": false
}
```

**Paging rule**: when `hasMore` is `true`, `serverTime` equals the largest `updated_at` among the rows returned (the cutoff). The app passes this as `since` on the next call. When `hasMore` is `false`, `serverTime` is captured before the queries and the app is fully up to date.

Configurable page size: `SYNC_MAX_ROWS` env variable (default 1000).

---

## POST /internal/push/run

Server-to-server. No user JWT. Authenticated via `X-Cron-Secret` header (constant-time compare).

**Response 200** `{ "ok": true, "sent": 12, "skipped": 0 }` or `{ "ok": true, "skipped": "FIREBASE_NOT_CONFIGURED" }`

**Response 401** `{ "error": { "code": "UNAUTHORIZED", ... } }` — secret missing or wrong.

---

## Owner actions required before going live

See `docs/backend-fix-report.md` for the full list.
