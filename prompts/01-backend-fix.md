# PROMPT 01: Fix the backend (`PlanpalBackend`)

Read `KIRO-START-HERE.md` first and obey its six rules (scope lock, honesty, no mock data, free-tier rules, one stage at a time with a report, security). Then fix the backend so it matches `docs/01-database.md` and `docs/02-backend.md`.

## What I found in your first build (so you know what to fix)

1. The core database is not in the repo. Only `supabase/migrations/0001_types.sql` exists, plus migrations 004 to 014 for other things. The code queries tables that are never created: `profiles`, `workspaces`, `workspace_members`, `tasks`, `labels`, `notifications`, `invite_codes`, `events`, `documents`, `device_tokens` and more.
2. Names differ from the docs: `comments` (docs: `task_comments`), subtasks stored as `parent_task_id` on tasks (docs: a `subtasks` table), `task_labels` many-to-many (docs: one `label_id`), plus `projects` and `activities` that are not in the docs.
3. Missing completely: chat, calendar events endpoints, folders and documents endpoints, signed-URL file uploads (you used multer and a `task-attachments` bucket), subtasks and comments endpoints as documented, `/devices`, `DELETE /me`.
4. A custom WebSocket server (`src/lib/websocket.js`) was built, and it imports `ws`, which is not declared in `package.json`. The plan uses Supabase Realtime because Render's free server sleeps and would drop WebSocket connections.
5. The reminder and push schedulers run as timers inside Express (`src/workers/*.js`). On the free Render tier these stop when the server sleeps, so reminders and notifications would not be delivered.
6. Features nobody asked for: projects, custom fields, templates, time tracking, saved views, export of everything, user preferences with 15 languages, mentions and activity feed extras.
7. Only 5 test files exist (search, analytics, sync, mentions, activity feed). Nothing tests login, permissions, workspace isolation, tasks, files or chat.
8. `PROJECT_STATUS.md` says stages 1 to 3 were "assumed from project structure" and the backend is "100% complete". Both are untrue.

## Your job, in this order

### Step 0: Clean up (before any new work)
- Create `_parked/` and move into it, without deleting: `src/routes/` files for projects, custom-fields, export, preferences, activities, activity-feed, team-dashboard, task-labels, links, mentions (the old version), `src/lib/websocket.js`, `src/lib/realtime-helpers.js`, `src/workers/*`, migrations 004 to 014, and the extra `docs/` files.
- Remove their imports and `apiRouter.use(...)` lines from `src/app.js`, and the WebSocket and scheduler start-up code from `src/server.js`.
- Remove `multer` and any dependency that is no longer used. Declare every dependency that is used.
- Delete `PROJECT_STATUS.md`, `STAGE_*_SUMMARY.md`, `TESTING_GUIDE_*.md` and the extra `*_API.md` files (keep a copy in `_parked/` if you want). Keep one `README.md`.

### Step 1: Database (Stage 1) 
- Create migrations `0002` to `0009` **exactly as written in `docs/01-database.md`**: core tables, helper functions, RLS, triggers, `join_workspace`, `move_task_to_workspace`, `get_or_create_dm`, `search_all`, analytics functions, `claim_unpushed_notifications`, `run_reminders_and_push`, `purge_old_rows`, cron schedules, Realtime publication. Use the same table and column names as the docs.
- Create the private bucket `planpal-files` with no client access policies.
- Run everything on an empty Supabase test project. Show that creating an Auth user creates a profile and a Personal workspace.
- Write the RLS test suite from task S1.14 and show it passing.
- Stop. Send the stage report. Wait.

### Step 2: Backend foundation (Stage 2)
- Structure, env validation (add `CRON_SECRET`), `GET /health` and `GET /health/db`.
- Auth and workspace middleware, central error handler. Map Postgres `P0002` to `INVALID_CODE`, `CODE_EXPIRED`, `CODE_REVOKED`, `CODE_USED_UP`, `ALREADY_MEMBER`, `TASK_NOT_FOUND`; map `P0001` "last admin" to `LAST_ADMIN`; add `CHAT_NOT_AVAILABLE_IN_PERSONAL`, `TRANSFER_ADMIN_FIRST`, `FOLDER_NOT_EMPTY`. Send `X-Request-Id` on every response. Every error has `error.code` and `requestId`.
- `GET /me`, `PATCH /me`, avatar endpoints.
- Stop. Report. Wait.

### Step 3: Workspaces, members, invite codes (Stage 5, backend part)
- Use the documented paths under `/api/v1/workspaces/:workspaceId/...`. Join with `join_workspace()`. Role changes rely on the database last-admin trigger.
- Stop. Report. Wait.

### Step 4: Sync base and labels (Stage 6, backend part), then Tasks (Stage 7, backend part)
- Sync endpoint with soft-deleted rows and `hasMore`, idempotent creates with client ids.
- Tasks, subtasks, task comments (with mentions), attachments by `fileId`, bulk, move.
- Stop. Report after each of the two stages. Wait.

### Step 5: Calendar (Stage 8), Files and Documents (Stage 9), Chat (Stage 10)
- Calendar events with the 62-day range, attendees, reminders, due tasks included.
- Files: signed upload and download URLs only (files never pass through Express), `files` table, 25 MB limit, allowed types, sanitized names.
- Folders and documents, both `file` and `written` kinds.
- Chat: channels, DMs, members, history, idempotent send with client UUID, edit, delete, mark read, mentions, blocked in Personal workspaces.
- Stop. Report after each stage. Wait.

### Step 6: Notifications and push, free-tier safe (Stage 11, backend part)
This is the part most likely to be done wrongly. Follow `docs/02-backend.md` section 6.15 and `docs/01-database.md` section 9 exactly.
- Notifications list with filters and counts, read, unread, read-all, delete. Devices at `/devices` (rename from `/device-tokens`).
- `pushService` with `sendForIds()` (called right after any request that creates notifications) and `sendPending()` (uses `claim_unpushed_notifications`).
- `POST /internal/push/run`: secret header `X-Cron-Secret`, timing-safe compare, rate limited, not under `/api/v1`.
- Do **not** use `setInterval` as the main mechanism. An optional 60-second fallback timer is allowed but nothing may rely on it.
- Prove it: with the Render server asleep, a task due in 23 hours must produce a push within 6 minutes. Show the evidence (logs or screenshot description).
- Stop. Report. Wait.

### Step 7: Search (Stage 12), Analytics (Stage 13), account deletion
- `/search` with counts for All, Tasks, Documents, People. Analytics from the SQL functions, plus `overview` and CSV export. `DELETE /me` with the admin-transfer rule.
- Stop. Report. Wait.

### Step 8: Tests and cleanup
- Add the 13 test groups from `docs/02-backend.md` section 9, against a separate test Supabase project. `npm test` and `npm run lint` must pass. Show the output.
- Write one `README.md`: setup, env variables, run, test, deploy to Render, UptimeRobot setup, Vault secrets setup.
- Update the backend tasks in `docs/04-task-stages.md` honestly.
- Final report. **Stop. Do not start the Flutter prompt until the owner says so.**

## Reminders
- Do not add anything that is not in `docs/`. If you think something is missing, write it in `QUESTIONS.md`.
- Do not claim a task is done without passing test output.
- Free-tier rules are mandatory (see `KIRO-START-HERE.md` Rule 4).
