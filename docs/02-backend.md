# PlanPal: Backend (Node.js + Express)

> Read `00-overview.md` and `01-database.md` first.
> The backend is a thin, careful layer: it checks who the user is, checks what they may do, talks to Supabase, and returns clean JSON. It never returns fake data.

---

## 1. Plain-language idea

Think of Express as the reception desk of a building:

1. A visitor (the Flutter app) shows a badge (the Supabase login token).
2. The desk checks the badge is real (verify the JWT).
3. The desk checks the visitor may enter that room (permissions).
4. The desk fetches or changes the papers in the archive (Supabase Postgres) on the visitor's behalf.
5. The desk hands back a clear answer, or a clear reason for saying no (the error format in section 5).

---

## 2. Project structure

```
backend/
  src/
    server.js                # starts the app
    app.js                   # builds Express (middleware, routes)
    config/env.js            # reads and validates environment variables (zod)
    lib/
      supabase.js            # userClient(jwt) and adminClient
      errors.js              # AppError and error codes
      logger.js              # pino
      pagination.js
      codes.js               # invite code generator
    middleware/
      auth.js                # verifies JWT, attaches req.user and req.jwt
      workspace.js           # loads membership + role for :workspaceId
      validate.js            # zod validation wrapper
      rateLimit.js
      errorHandler.js
    routes/
      health.js  internal.js  me.js  workspaces.js  members.js  invites.js  labels.js
      tasks.js  subtasks.js  comments.js  events.js  channels.js  messages.js
      files.js  folders.js  documents.js  notifications.js  devices.js
      search.js  analytics.js  sync.js
    services/                # business logic, one file per area
    workers/
      pushService.js         # sendForIds() and sendPending(); no required timers
    tests/
  package.json
  .env.example
```

Rules:
- Routes only parse and validate input, call a service and send the response.
- Services hold the logic. Services never read `req` or `res`.
- Use ES modules or CommonJS consistently. Use async/await, and wrap async routes so errors reach the error handler.

---

## 3. Authentication and the two Supabase clients

### Verify the token
Every route except `GET /health` requires `Authorization: Bearer <supabase access token>`.

`middleware/auth.js`:
1. Read the token. If missing, respond `401 AUTH_REQUIRED`.
2. Verify with `adminClient.auth.getUser(token)` (simple and safe), or verify the JWT locally with the project's JWT secret for less latency.
3. If invalid or expired, respond `401 AUTH_EXPIRED` (the app then refreshes the session and retries once).
4. Attach `req.user = { id, email }` and `req.jwt = token`.

### Clients (`lib/supabase.js`)
```js
// User client: RLS applies. Use for normal reads and writes.
export function userClient(jwt) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
// Admin client: bypasses RLS. Only for the cases in section 3.1.
export const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
```

### 3.1 When the admin client is allowed
Only these, and always after an explicit permission check written in the service:
- Creating signed upload and download URLs.
- Inserting notifications.
- Reading `device_tokens` for push.
- Deleting storage objects.
- Verifying tokens.

Everything else uses the user client so RLS protects the data even if Express has a bug.

### 3.2 Workspace middleware
For routes containing `:workspaceId`, load the caller's `workspace_members` row through the user client. If there is no row, respond `403 NOT_A_MEMBER` (do not reveal whether the workspace exists). Attach `req.workspace = { id, type, role }`. Services use this for role checks from the table in `00-overview.md`, section 5.

---

## 4. Conventions

- Base path: `/api/v1`.
- JSON in, JSON out. Dates are ISO 8601 UTC strings.
- IDs are UUIDs. The client may send its own `id` when creating a row (offline creation). The server must accept it and treat a repeat of the same `id` from the same user as **idempotent** (return the existing row, not an error).
- Soft delete: `DELETE` endpoints set `deleted_at`. Reads exclude deleted rows unless the sync endpoint asks for them.
- Pagination: cursor style. `?limit=30&cursor=<opaque>`. Response: `{ "data": [...], "nextCursor": "..." | null }`.
- Validation: every body and query is validated with zod. On failure respond `400 VALIDATION_FAILED` with field errors.
- Rate limits: 300 requests per 15 minutes per user in general; stricter for `POST /workspaces/join` (10 per hour) and file upload URLs (60 per hour).
- Security middleware: `helmet`, `cors` (only `ALLOWED_ORIGINS`; native apps send no Origin), body size limit 1 MB, trust proxy on (Render is behind a proxy).
- Logging: `pino`, one line per request with request id, user id, route, status and duration. Never log tokens or passwords.

---

## 5. Error format (needed for clear error messages in the app)

The owner wants the user to know **why** something failed, especially internet problems. The app can tell "no internet" by itself (the request never leaves the phone). The server's job is to give precise reasons for everything else.

Every error response uses this shape:

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Human-readable English fallback",
    "details": { "field": "title" },
    "requestId": "b3c1..."
  }
}
```

Error codes (stable strings; Flutter maps each to a localized message, see `03-frontend.md` section 13):

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Wrong or missing fields. `details` lists them. |
| 400 | `INVALID_CODE` `CODE_EXPIRED` `CODE_REVOKED` `CODE_USED_UP` `ALREADY_MEMBER` | Invite code problems |
| 400 | `FILE_TOO_LARGE` `FILE_TYPE_NOT_ALLOWED` | Upload rules |
| 401 | `AUTH_REQUIRED` | No token |
| 401 | `AUTH_EXPIRED` | Token expired; refresh and retry |
| 403 | `NOT_A_MEMBER` | Not in this workspace |
| 403 | `FORBIDDEN` | Role does not allow this action |
| 403 | `LAST_ADMIN` | Cannot remove or demote the last admin |
| 404 | `NOT_FOUND` (and specific ones like `TASK_NOT_FOUND`) | Missing, or hidden by permissions |
| 409 | `CONFLICT` | Rare; for example a duplicate label name |
| 413 | `PAYLOAD_TOO_LARGE` | Request body too big |
| 429 | `RATE_LIMITED` | Too many requests. Include `Retry-After`. |
| 500 | `INTERNAL_ERROR` | Bug on the server. Log it with the requestId. |
| 502 | `UPSTREAM_ERROR` | Supabase or another service failed |
| 503 | `SERVICE_UNAVAILABLE` | Server starting or overloaded (also what Render may return while waking up) |

Error handler (`middleware/errorHandler.js`):
- `AppError` becomes its status and code.
- zod errors become `VALIDATION_FAILED`.
- Supabase/Postgres errors are translated: `42501` becomes `FORBIDDEN`, `P0002` becomes the specific code from the message (`INVALID_CODE` and so on), `P0001` with "last admin" becomes `LAST_ADMIN`, `23505` becomes `CONFLICT`, `PGRST116` becomes `NOT_FOUND`.
- Anything unknown becomes `INTERNAL_ERROR` with a generic message. Never leak stack traces or SQL to the client.
- Always include `requestId` (also send it in the `X-Request-Id` response header).

---

## 6. Endpoints

All paths start with `/api/v1`. "Role" = the minimum workspace role. Personal workspaces: the owner is admin.

### 6.1 Health and profile
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | No auth, no database call. Returns `{ "status": "ok", "time": ... }`. Used by the uptime monitor. |
| GET | `/health/db` | No auth. Runs `select 1` through the admin client. Returns `{ "status": "ok" }` or 503. Used by a second uptime monitor so the free Supabase project stays active. |
| GET | `/me` | Profile plus list of workspaces with the user's role in each, and `personalWorkspaceId`. Called after login. |
| PATCH | `/me` | `fullName`, `timezone`, `language` (`en es fr zh ko`), `theme` (`light dark system`). |
| POST | `/me/avatar-upload-url` | Returns a signed upload URL and the final path; after upload the app calls `PATCH /me` with `avatarPath`. |
| DELETE | `/me/avatar` | Remove avatar. |
| DELETE | `/me` | Delete account (see 6.16). |

### 6.2 Workspaces, members and invites
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/workspaces` | any | The user's workspaces. |
| POST | `/workspaces` | any user | Body `{ name }`. Creates a **team** workspace (trigger adds admin and #general). |
| GET | `/workspaces/:workspaceId` | member | Details and counts. |
| PATCH | `/workspaces/:workspaceId` | admin | Rename. Not allowed on personal. |
| DELETE | `/workspaces/:workspaceId` | admin | Soft delete a team. Not allowed on personal. |
| POST | `/workspaces/join` | any user | Body `{ code }`. Calls `join_workspace(code)`. Returns the workspace. |
| GET | `/workspaces/:workspaceId/members` | member | Guests see only themselves and admins (RLS). |
| PATCH | `/workspaces/:workspaceId/members/:userId` | admin | Body `{ role }`. `LAST_ADMIN` protection comes from the database trigger. |
| DELETE | `/workspaces/:workspaceId/members/:userId` | admin, or self to leave | Remove or leave. Personal: blocked. |
| GET | `/workspaces/:workspaceId/invites` | admin | List codes. |
| POST | `/workspaces/:workspaceId/invites` | admin | Body `{ role, maxUses?, expiresAt? }`. Server generates an 8-character code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` using a cryptographically secure random source. Retry on collision. |
| DELETE | `/workspaces/:workspaceId/invites/:inviteId` | admin | Revoke (set `revoked_at`). |

After a successful join, insert a `member_joined` notification for the workspace admins (admin client, permission already proven by the join function).

### 6.3 Labels
| Method | Path | Role |
|---|---|---|
| GET | `/workspaces/:workspaceId/labels` | member |
| POST | same | member |
| PATCH | `/workspaces/:workspaceId/labels/:labelId` | member |
| DELETE | same | admin |

### 6.4 Tasks
| Method | Path | Notes |
|---|---|---|
| GET | `/workspaces/:workspaceId/tasks` | Query: `status`, `priority`, `assigneeId`, `labelId`, `dueFrom`, `dueTo`, `q`, `view=today|week|overdue|all`, `sort=due_at|priority|created_at|title`, `order`, `limit`, `cursor`. `overdue` = not completed and `due_at < now()`. The list rows include `assignee {id, fullName, avatarPath}`, `label`, `subtaskCounts {done, total}`. |
| POST | `/workspaces/:workspaceId/tasks` | member. Body: `id?`, `title`, `description?`, `priority?`, `dueAt?`, `assigneeId?`, `labelId?`, `subtasks?[]`, `attachmentFileIds?[]`. Assignee must be a member of that workspace. If the assignee is not the creator, create a `task_assigned` notification. |
| GET | `/tasks/:taskId` | Full task with subtasks, attachments (file metadata), comments (latest 20), assignee, label. Access decided by RLS. |
| PATCH | `/tasks/:taskId` | Partial update. Detect assignee change and create `task_assigned` for the new assignee; status change notifies the creator (`task_updated`). |
| DELETE | `/tasks/:taskId` | Soft delete. Admin or creator (also enforced by trigger). |
| POST | `/tasks/bulk` | Body `{ ids[], action: 'complete' | 'delete' }`. Powers the desktop "2 tasks selected: Mark Complete / Delete Selected" bar. Each id is checked; the response lists `succeeded[]` and `failed[{id, code}]`. |
| POST | `/tasks/:taskId/move` | Body `{ targetWorkspaceId }`. Calls `move_task_to_workspace`. Returns the updated task. |

### 6.5 Subtasks, comments, attachments
| Method | Path |
|---|---|
| POST | `/tasks/:taskId/subtasks` |
| PATCH | `/subtasks/:subtaskId` |
| DELETE | `/subtasks/:subtaskId` |
| GET | `/tasks/:taskId/comments?cursor=` |
| POST | `/tasks/:taskId/comments` (creates `task_comment` notification for assignee and creator; parses `@mentions`, see 6.13) |
| PATCH | `/comments/:commentId` (author) |
| DELETE | `/comments/:commentId` (author or admin) |
| POST | `/tasks/:taskId/attachments` body `{ fileId }` (file must already be uploaded and belong to the same workspace) |
| DELETE | `/tasks/:taskId/attachments/:fileId` |

### 6.6 Events (calendar)
| Method | Path | Notes |
|---|---|---|
| GET | `/workspaces/:workspaceId/events?from=&to=` | Range query for Month, Week, Day views. Both bounds required, maximum span 62 days. Also return tasks with a `due_at` in range as `dueTasks[]` so the calendar can show them. |
| POST | `/workspaces/:workspaceId/events` | Body: `id?`, `title`, `startsAt`, `endsAt`, `allDay?`, `color?`, `description?`, `attendeeIds?[]`, `reminderMinutesBefore?`. Attendees must be members. |
| PATCH | `/events/:eventId` | Includes attendee changes. |
| DELETE | `/events/:eventId` | Soft delete. |

### 6.7 Chat
| Method | Path | Notes |
|---|---|---|
| GET | `/workspaces/:workspaceId/channels` | Channels the user can see plus their DMs, each with `unreadCount` and last message preview. Team workspaces only; on Personal respond `400 CHAT_NOT_AVAILABLE_IN_PERSONAL`. |
| POST | `/workspaces/:workspaceId/channels` | Body `{ name, description?, isPrivate?, memberIds?[] }`. |
| POST | `/workspaces/:workspaceId/dms` | Body `{ userId }`. Calls `get_or_create_dm`. |
| POST | `/channels/:channelId/members` | Add people (channel creator or admin). |
| DELETE | `/channels/:channelId/members/:userId` | Remove or leave. |
| GET | `/channels/:channelId/messages?before=&limit=50` | History (older pages). New messages arrive through Supabase Realtime. |
| POST | `/channels/:channelId/messages` | Body: `id` (client-generated UUID, required, makes retries safe), `body?`, `fileId?` (at least one of them). Insert through the user client. Then create `chat_message` notifications for other channel members who are not currently muted, and `mention` notifications for `@mentions`. |
| PATCH | `/messages/:messageId` | Edit own message. |
| DELETE | `/messages/:messageId` | Soft delete own message (admin may delete any in the workspace). |
| POST | `/channels/:channelId/read` | Sets `last_read_at = now()` for the caller. |

Mention format in message text: `@[Full Name](user:<uuid>)`. Only notify users who are members of the channel.

### 6.8 Files
Files never pass through Express. Express only hands out short-lived signed URLs after checking permission.

| Method | Path | Notes |
|---|---|---|
| POST | `/workspaces/:workspaceId/files/upload-url` | Body `{ name, mimeType, sizeBytes }`. Validate type and size (25 MB). Generate `fileId`, path `{workspaceId}/{fileId}/{sanitizedName}`. Insert the `files` row (user client, so RLS checks role), create a signed **upload** URL (admin client), return `{ fileId, uploadUrl, token, path }`. |
| GET | `/files/:fileId/download-url` | Load the `files` row with the **user client** (if RLS hides it, respond 404). Then create a signed download URL valid for 5 minutes (admin client). |
| DELETE | `/files/:fileId` | Uploader or admin. Soft delete the row and delete the storage object. Also remove task attachments, documents or messages that used it (or leave them showing "file removed"; choose "file removed"). |

Sanitize file names: remove path separators and control characters, limit to 120 characters, keep the extension.

Image previews in chat: the app asks for a download URL per image and caches it.

### 6.9 Folders and documents
| Method | Path | Notes |
|---|---|---|
| GET | `/workspaces/:workspaceId/folders?parentId=` | Each folder includes `fileCount`. |
| POST | `/workspaces/:workspaceId/folders` | `{ name, parentId? }` |
| PATCH / DELETE | `/folders/:folderId` | Rename or move; delete only if empty (or delete everything inside, as the owner prefers later; first release: only when empty, respond `409 FOLDER_NOT_EMPTY`). |
| GET | `/workspaces/:workspaceId/documents?folderId=&kind=&recent=true` | List. `recent=true` returns latest 12. |
| POST | `/workspaces/:workspaceId/documents` | Two shapes. **File:** `{ kind: 'file', title, fileId, folderId? }`. **Written:** `{ kind: 'written', title, content (Quill delta JSON), contentText, folderId? }`. |
| GET | `/documents/:documentId` | Full document. Written documents include `content`. |
| PATCH | `/documents/:documentId` | Rename, move folder, or save new `content` + `contentText`. Last write wins (`updated_at`). |
| DELETE | `/documents/:documentId` | Soft delete. |

### 6.10 Notifications and devices
| Method | Path | Notes |
|---|---|---|
| GET | `/notifications?filter=all|unread|tasks|mentions&cursor=` | `tasks` = types `task_assigned task_updated task_comment deadline_approaching task_overdue`. `mentions` = `mention`. Response also includes `unreadCount` and `totalCount` for the tab badges "All (12)", "Unread (2)". |
| POST | `/notifications/:id/read` | Mark one read. |
| POST | `/notifications/:id/unread` | Mark one unread. |
| POST | `/notifications/read-all` | "Mark all as read". |
| DELETE | `/notifications/:id` | Dismiss (hard delete is fine here). |
| POST | `/devices` | Body `{ token, platform }`. Upsert into `device_tokens`. Call after login and whenever the FCM token refreshes. |
| DELETE | `/devices/:token` | Call on logout. |

### 6.11 Search
| Method | Path | Notes |
|---|---|---|
| GET | `/search?q=&workspaceId=&type=all|task|document|person&limit=20` | Calls `search_all` as the user. Minimum query length 2. Deduplicate people by `id`. Response: `{ counts: {all, task, document, person}, results: [...] }`. The counts feed the chips "All Results (8)", "Tasks (3)", "Documents (3)", "People (2)". Omit `workspaceId` to search all of the user's workspaces. |

### 6.12 Analytics
| Method | Path | Notes |
|---|---|---|
| GET | `/workspaces/:workspaceId/analytics?range=7d|30d|90d` | Runs the analytics functions (summary, weekly, categories, daily, streak) in parallel and returns one object. Includes `changeVsPrevious` percent for tasks completed. Member or admin; guests get `403`. |
| GET | `/workspaces/:workspaceId/analytics/export.csv?range=` | CSV download for "Export CSV". |
| GET | `/workspaces/:workspaceId/overview?range=week` | Small version for the Home dashboard: counts (completed, in progress, overdue), productivity %, daily series. |

"Productivity %" on Home = `on_time_rate` from `analytics_summary` for the chosen range (define it once and reuse it everywhere).

### 6.13 Mentions
Parse `@[Name](user:<uuid>)` in task comments and chat messages. For each valid workspace member that is not the author, insert a `mention` notification with `entity_type` and `entity_id` pointing to the task or channel. Use `dedupe_key = 'mention:{messageOrCommentId}:{userId}'`.

### 6.14 Sync (offline support)
One endpoint the app calls when it comes back online and on a schedule.

`GET /workspaces/:workspaceId/sync?since=<ISO time>`

Returns everything changed **after** `since` that the caller may see, including soft-deleted rows so the app can remove them locally:

```json
{
  "serverTime": "2026-09-29T10:00:00Z",
  "tasks": [ ... ], "subtasks": [ ... ], "taskComments": [ ... ],
  "taskAttachments": [ ... ], "labels": [ ... ], "events": [ ... ], "eventAttendees": [ ... ],
  "channels": [ ... ], "documents": [ ... ], "folders": [ ... ],
  "members": [ ... ], "hasMore": false
}
```

Rules:
- The client stores `serverTime` (not its own clock) as the next `since`. First sync uses `since` omitted (returns all).
- Page large results: if more than 1000 rows in total, set `hasMore: true` and return up to the newest-updated cutoff so the client can call again.
- Chat messages are synced per channel through the messages endpoint (latest 50 when a channel is opened), not through this endpoint.
- Notifications are synced through `GET /notifications`.

Pushing local changes: the app replays its outbox by calling the normal endpoints (POST/PATCH/DELETE) in the original order. Because creates carry client-generated ids and are idempotent, a retry after a dropped connection never duplicates data. For updates, send `clientUpdatedAt`; if the server row's `updated_at` is newer than `clientUpdatedAt`, still apply the update (last write wins as decided) and return the resulting row so the client can refresh.

### 6.15 Push sending (free-tier safe)

Render's free server sleeps, so **no timer inside Express may be responsible for sending pushes.** Pushes go out in three ways, all using the same `pushService.sendPending()` function:

1. **Immediately after a request creates notifications** (task assigned, comment, mention, chat message, member joined). Call `pushService.sendForIds(ids)` after the response is sent. Errors are logged and never break the request.
2. **From the database every 5 minutes.** Supabase `pg_cron` runs `run_reminders_and_push()` (see `01-database.md` section 9), which creates deadline, overdue and event reminders and then calls `POST /internal/push/run` through `pg_net`. This also wakes the sleeping server.
3. **Fallback timer** (optional): a `setInterval` every 60 seconds that calls `sendPending()` while the server happens to be awake. It is only a bonus; nothing relies on it.

`POST /internal/push/run`
- Not under user auth. Requires header `X-Cron-Secret` equal to `CRON_SECRET` (compare with `crypto.timingSafeEqual`). Wrong or missing secret: `401 AUTH_REQUIRED`.
- Rate limit: 30 per hour per IP. Respond quickly (`{ "claimed": n, "sent": n, "failed": n }`).
- Never mount it under `/api/v1`, never document it for the app, never call it from Flutter.

`sendPending()`:
1. Call the SQL function `claim_unpushed_notifications(100)` with the admin client. It marks rows as pushed and counts attempts, so two runs can never send the same notification.
2. Group by user and load `device_tokens`. Users with no token: skip (they already have the in-app notification).
3. Send with `firebase-admin` `sendEachForMulticast`. Title and body: the notification's fallback text, plus `data` fields `{ type, entityType, entityId, workspaceId }` so the app can localize and open the right screen.
4. Delete tokens that return `messaging/registration-token-not-registered`.
5. For a temporary failure (Firebase 5xx, timeout), set `pushed_at = null` for those ids so the next run retries (the SQL function stops after 3 attempts).
6. Optional for the first release: skip a chat push if the user was seen online in the last minute.

Windows desktop: FCM is not available. Windows shows local notifications while the app is running (from Realtime `notifications` inserts). Do not build a Windows push service in the first release.

### 6.16 Account deletion
`DELETE /me`: require the password or a fresh login in the request. Block if the user is the only admin of a team that still has other members (`409 TRANSFER_ADMIN_FIRST`). Otherwise soft delete the profile, remove memberships from teams, delete the personal workspace and its files, delete the auth user with the admin client.

---

## 7. Password reset and email

Supabase Auth now handles the 6-digit OTP (`00-overview.md`, section 3). The old Express endpoints (`/forgot-password`, `/verify-reset-code`, `/reset-password`) are **not** part of this backend. If they exist in older code, do not carry them over.

Flutter calls:
- `supabase.auth.resetPasswordForEmail(email)` (sends the 6-digit code through Resend SMTP)
- `supabase.auth.verifyOTP(type: recovery, email, token)`
- `supabase.auth.updateUser(password: ...)`

The backend does not touch these. It only needs `/me` to work after the user is signed in.

---

## 8. Deployment on Render (free tier)

- One Web Service. Build command `npm ci`. Start command `node src/server.js`. Node LTS.
- Health check path `/health`.
- Set the environment variables from `00-overview.md`, section 10.
- Keep-awake: create two free UptimeRobot monitors, `https://<service>.onrender.com/health` and `/health/db`, every 5 minutes.
- Set `CRON_SECRET`. Then, in Supabase, store the API URL and the same secret in Vault (see `01-database.md` section 9).
- Graceful shutdown: on `SIGTERM`, stop accepting requests, finish in-flight ones, clear the push fallback interval, exit.
- Log only to stdout.

---

## 9. Testing (required)

Use `jest` + `supertest` against a **separate Supabase test project** (never the real one). Create real test users through the admin API in setup and delete them after.

Minimum tests:
1. Auth: no token gives 401; expired token gives 401 `AUTH_EXPIRED`; valid token works.
2. Workspaces: signup creates a Personal workspace; creating a team creates admin membership and #general; join with valid, expired, revoked, used-up and unknown codes; cannot join twice.
3. Roles: for every row in the permission table in `00-overview.md`, one allowed case and one denied case.
4. Isolation: user in workspace A gets 403/404 for every resource of workspace B.
5. Tasks: create with client id twice (idempotent); assignee must be member; overdue filter; bulk complete and delete; move Personal to Team; guest can only change status.
6. Last admin cannot leave, be demoted or be removed.
7. Files: too large, wrong type, upload URL only for full members, download URL denied for other workspaces, guest download only on assigned task.
8. Chat: idempotent send; message needs body or file; Personal workspace has no chat.
9. Notifications: assign creates one; deadline function creates only one per task (run twice).
10. Search: results respect RLS; counts match; short query rejected.
11. Analytics: numbers match hand-computed data from a fixture.
12. Sync: changes and soft deletes since a timestamp appear; unchanged rows do not.
13. Error format: every failure has `error.code` and `requestId`.

Also add `npm run lint` (ESLint) and run tests in CI on every push.

---

## 10. Backend checklist for the stages file

See `04-task-stages.md`, Stages 2 to 10 (each feature stage has a backend part).
