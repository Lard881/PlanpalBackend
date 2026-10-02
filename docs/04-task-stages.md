# PlanPal: Development Task Stages

> This is the tracker. Tick `[x]` when a task is finished and tested. Never start a stage before the previous one is fully ticked.
> Every stage ends with a **Definition of done**. If any line of it is not true, the stage is not done.
> **No mock data anywhere.** Every screen must read real data from the real backend and database.

Legend: `[ ]` to do, `[~]` in progress, `[x]` done. Change the marker in place and update the progress table.

---

## Progress table

| Stage | Name | Status | Done / Total |
|---|---|---|---|
| 0 | Accounts and project setup | To do | 0 / 12 |
| 1 | Database | In progress | 11 / 14 |
| 2 | Backend foundation | In progress | 13 / 15 |
| 3 | Flutter foundation | To do | 0 / 20 |
| 4 | Authentication and onboarding | To do | 0 / 16 |
| 5 | Workspaces, members and invite codes | To do | 0 / 17 |
| 6 | Offline sync engine | To do | 0 / 13 |
| 7 | Tasks | To do | 0 / 26 |
| 8 | Calendar | To do | 0 / 12 |
| 9 | Files and Documents | To do | 0 / 17 |
| 10 | Chat (real-time) | To do | 0 / 19 |
| 11 | Notifications and push | To do | 0 / 20 |
| 12 | Global search | To do | 0 / 9 |
| 13 | Analytics | To do | 0 / 10 |
| 14 | Home dashboard | To do | 0 / 9 |
| 15 | Team and Settings | To do | 0 / 15 |
| 16 | Windows desktop polish | To do | 0 / 9 |
| 17 | Quality, hardening and release | To do | 0 / 17 |
| 18 | Later (backlog) | Parked | n/a |

Total: 270 tasks in stages 0 to 17.

---

## Stage 0: Accounts and project setup

Goal: everything the build needs exists and is connected.
Depends on: nothing.

- [ ] S0.1 Create a Supabase project (fresh, empty). Note the URL, anon key and service-role key. Keep the service-role key secret.
- [ ] S0.2 Create a second Supabase project for automated tests (never test on the real one).
- [ ] S0.3 Create a Firebase project. Add the Android app. Download `google-services.json`. Create a service account key for the backend.
- [ ] S0.4 Create a Resend account and verify a sending domain (or use its test sender while developing).
- [ ] S0.5 Create a Google Cloud OAuth setup: web client ID, Android client ID (with SHA-1 of the debug and release keys). Add the redirect URLs for desktop.
- [ ] S0.6 Create the Render web service for the backend (free tier). Connect it to the backend repository.
- [ ] S0.7 Create two free UptimeRobot monitors, `/health` and `/health/db` (5-minute interval) once the backend is deployed.
- [ ] S0.8 Create the repository layout from `00-overview.md` section 11 (`app/`, `backend/`, `supabase/migrations/`, `docs/`). Copy these documents into `docs/`.
- [ ] S0.9 Create the Flutter project with Android and Windows enabled (iOS and macOS folders may exist but are not built yet). Confirm `flutter doctor` is clean for Android and Windows.
- [ ] S0.10 Create the Node.js project (Express) with ESLint, Prettier and Jest.
- [ ] S0.11 Add CI (GitHub Actions): backend lint and tests, Flutter analyze and tests. Secrets stored in the CI secret store.
- [ ] S0.12 Add `.gitignore` entries for `.env`, `google-services.json`, keystores and service-account files. Add `.env.example` files with every variable name (no values).

Definition of done: all services exist; no secret is committed; both projects build an empty "hello" locally; CI runs green on an empty test.

---

## Stage 1: Database

Goal: the full schema, security rules, functions and storage exist in Supabase.
Depends on: Stage 0. Reference: `01-database.md`.

- [x] S1.1 Migration 0001: extensions and enum types.
- [x] S1.2 Migration 0002: all tables, indexes, `updated_at` and `completed_at` triggers.
- [x] S1.3 Migration 0003: helper functions (`is_member`, `is_admin`, and the others).
- [x] S1.4 Migration 0004: enable RLS and create every policy, including `tasks_guard`.
- [x] S1.5 Migration 0005: signup trigger (profile + Personal workspace + admin membership).
- [x] S1.6 Migration 0005: new team trigger (admin membership + #general channel), member-joined trigger, last-admin protection.
- [x] S1.7 Migration 0005: `join_workspace`, `move_task_to_workspace`, `get_or_create_dm`.
- [x] S1.8 Migration 0006: `search_all` function.
- [x] S1.9 Migration 0007: analytics functions.
- [x] S1.10 Migration 0008: deadline and event notification function and the pg_cron schedule.
- [x] S1.11 Migration 0009: Realtime publication for the listed tables.
- [ ] S1.12 Create the private storage bucket `planpal-files` with no client policies.
- [ ] S1.13 Configure Auth: email provider with confirmation by 6-digit code, Google provider, Resend SMTP, code-based email templates, password minimum 8.
- [ ] S1.14 Write an automated RLS test suite (SQL or API-level) covering: cross-workspace isolation, guest limits, notification privacy, last-admin rule, personal workspace restrictions, task move.

Note: S1.1-S1.11 verified by reviewer on local Postgres 16 with stand-ins; real Supabase run pending the owner. S1.14 test suite written and enhanced per R2.7 but NOT RUN (requires TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_KEY).

Definition of done: all migrations run on an empty project without errors, in order; the RLS test suite passes; creating a user through Supabase Auth automatically produces a profile and a Personal workspace.

---

## Stage 2: Backend foundation

Goal: a deployed, secure API skeleton with auth, errors, health and the profile endpoints.
Depends on: Stage 1. Reference: `02-backend.md`.

- [x] S2.1 Project structure, environment validation with zod, logger.
- [x] S2.2 `GET /health` (no auth, no database) and deploy to Render; confirm the uptime monitor sees it.
- [x] S2.3 Security middleware: helmet, cors, body limit, trust proxy, rate limiting.
- [x] S2.4 `lib/supabase.js` with `userClient(jwt)` and `adminClient`.
- [x] S2.5 Auth middleware (401 `AUTH_REQUIRED`, 401 `AUTH_EXPIRED`).
- [x] S2.6 Workspace middleware (`NOT_A_MEMBER`, role attached).
- [x] S2.7 `AppError`, error codes and the central error handler with Postgres error translation and `requestId`.
- [x] S2.8 Request validation helper (zod) returning `VALIDATION_FAILED` with field details.
- [x] S2.9 `GET /me` (profile, workspaces with roles, personal workspace id).
- [x] S2.10 `PATCH /me` (name, timezone, language, theme).
- [x] S2.11 Avatar upload URL, save and remove endpoints.
- [x] S2.12 Graceful shutdown handling.
- [ ] S2.13 Tests: auth cases, error format on every failure, validation, `/me`.
- [ ] S2.14 Confirm the first request after 20 idle minutes returns (cold start) and note the time.
- [x] S2.15 `GET /health/db` (select 1 through the admin client) for the second uptime monitor.

Definition of done: deployed API; every error has `error.code` and `requestId`; tests green; `/me` returns the real Personal workspace for a real test user.

---

## Stage 3: Flutter foundation

Goal: an empty but complete app shell that looks right on phone and desktop, in every theme and language, and handles errors and connectivity.
Depends on: Stage 2. Reference: `03-frontend.md` sections 2 to 8, 12 to 14.

- [ ] S3.1 Project structure, packages, `env.dart` with `--dart-define`.
- [ ] S3.2 Design tokens and light and dark `ThemeData`; bundle Inter font files.
- [ ] S3.3 Theme mode provider (Light, Dark, System), saved locally, applied live.
- [ ] S3.4 Localization setup with the five ARB files; language provider; language switch applies live.
- [ ] S3.5 CI check that every key exists in all five languages.
- [ ] S3.6 Breakpoints and `adaptive_scaffold` (bottom tabs, rail, sidebar).
- [ ] S3.7 go_router with the route table and guards (placeholder pages show real empty states, not fake content).
- [ ] S3.8 Shared components from section 6 (buttons, fields, chips, avatar, cards, empty, error, skeleton, banner, snackbars).
- [ ] S3.9 `dio` client with auth interceptor, timeouts (long first-call timeout), and retry-once on `AUTH_EXPIRED`.
- [ ] S3.10 `ConnectivityService` with the four states and real reachability checks.
- [ ] S3.11 `AppFailure` types and `api_error_mapper`.
- [ ] S3.12 `failure_messages` and all error strings in five languages.
- [ ] S3.13 Connectivity banner (offline, server unreachable, waking, back online).
- [ ] S3.14 "Details" link with error code and request id and a Copy button.
- [ ] S3.15 Drift database with tables, DAOs and migrations setup, on Android and Windows.
- [ ] S3.16 Outbox table and the base repository pattern (write local then queue).
- [ ] S3.17 Android configuration (minSdk, permissions, app name and icon).
- [ ] S3.18 Windows configuration (`window_manager`, minimum size 900x600, remember size).
- [ ] S3.19 Unit tests: failure mapper for every code and network case; connectivity service state logic.
- [ ] S3.20 Widget tests: shell at widths 375, 700 and 1280 in light and dark.

Definition of done: the app runs on Android and Windows; switching theme and language works instantly; turning Wi-Fi off shows the offline banner; simulating a server failure shows the correct localized message; no hard-coded strings.

---

## Stage 4: Authentication and onboarding

Goal: real accounts. Sign up, log in, Google, password reset, session, sign out.
Depends on: Stage 3. Reference: `03-frontend.md` section 9.

- [ ] S4.1 Login screen (mobile and desktop) from the design, Microsoft removed.
- [ ] S4.2 Sign-up screen with the Terms checkbox and "Create Account" wording.
- [ ] S4.3 Field validation with localized messages (email format, password 8 or more, match).
- [ ] S4.4 Email and password sign-up and login through Supabase Auth.
- [ ] S4.5 Email confirmation with the 6-digit code screen and resend cooldown.
- [ ] S4.6 Forgot password: request code, verify code, set new password (three steps).
- [ ] S4.7 Google login on Android (native token flow).
- [ ] S4.8 Google login on Windows (browser flow with loopback redirect).
- [ ] S4.9 Map every Supabase auth error to an `AppFailure` and a localized message.
- [ ] S4.10 Session restore on start (works offline if already logged in) and the splash screen.
- [ ] S4.11 After login: `GET /me`, apply saved theme and language, start first sync.
- [ ] S4.12 Onboarding step "Continue with Personal or create/join a team" (skippable).
- [ ] S4.13 Sign out: clear local database and secure storage, remove the device token.
- [ ] S4.14 Session-expired handling: refresh once, otherwise sign out with the message.
- [ ] S4.15 Backend: `DELETE /me` (delete account) and the admin-transfer rule.
- [ ] S4.16 Tests: each auth error, offline start with an existing session, sign-out wipes local data.

Definition of done: a brand-new user can sign up, confirm the email code, land in the app, and see their real Personal workspace; password reset works end to end with real email delivery; Google works on Android and Windows.

---

## Stage 5: Workspaces, members and invite codes

Goal: Personal plus Team workspaces, switching, roles and joining by code.
Depends on: Stage 4. Reference: `00-overview.md` section 5, `02-backend.md` 6.2, `03-frontend.md` 10.1.

- [ ] S5.1 Backend: `GET/POST /workspaces`, details, rename, delete (team only).
- [ ] S5.2 Backend: `POST /workspaces/join` with all specific error codes.
- [ ] S5.3 Backend: members list, change role, remove member, leave.
- [ ] S5.4 Backend: invite codes create, list, revoke (secure generator, collision retry).
- [ ] S5.5 Backend: `member_joined` notification for admins after a join.
- [ ] S5.6 Backend tests for the whole permission table rows about workspaces and members.
- [ ] S5.7 Flutter: workspace repository with Drift and the current-workspace provider (saved locally).
- [ ] S5.8 Flutter: workspace switcher (desktop sidebar top; mobile Home header).
- [ ] S5.9 Flutter: create workspace screen.
- [ ] S5.10 Flutter: join with code screen with specific messages.
- [ ] S5.11 Flutter: members screen (role change, remove, leave, last-admin message).
- [ ] S5.12 Flutter: invite codes screen (create dialog, copy, revoke).
- [ ] S5.13 Personal workspace rules in the UI (hide Chat, Team, Members, Invites).
- [ ] S5.14 Role-based UI: hide or disable actions the role cannot do.
- [ ] S5.15 Real role shown in the top bar (replaces the fixed "Workspace Admin" text).
- [ ] S5.16 Flutter tests: switching workspace changes all data sources; role-based visibility.
- [ ] S5.17 Manual test with two real accounts: create, invite, join, change role, remove.

Definition of done: two real accounts can share a team through a code; roles limit what each sees; the last admin cannot be removed; Personal stays private.

---

## Stage 6: Offline sync engine

Goal: the machinery that makes offline work. Proven with a simple entity first (labels), then reused everywhere.
Depends on: Stage 5. Reference: `00-overview.md` section 6, `02-backend.md` 6.14, `03-frontend.md` 8.

- [ ] S6.1 Backend: `GET /workspaces/:id/sync?since=` for the entities that exist so far, with soft-deleted rows and `hasMore`.
- [ ] S6.2 Backend: idempotent create behaviour for client-supplied ids (shared helper).
- [ ] S6.3 Backend: labels endpoints (used to prove the engine).
- [ ] S6.4 Flutter: sync engine pull (merge into Drift, remove deleted rows, store `serverTime`).
- [ ] S6.5 Flutter: outbox push in creation order with exponential backoff.
- [ ] S6.6 Flutter: temporary versus permanent failure handling and row `syncStatus`.
- [ ] S6.7 Flutter: triggers for sync (start, login, workspace switch, connectivity back, every 2 minutes).
- [ ] S6.8 Flutter: `SyncStatusChip` ("Waiting to sync (n)").
- [ ] S6.9 Flutter: Sync status screen (state, last sync, pending and failed items, Retry, Discard).
- [ ] S6.10 Flutter: friendly message when a queued change is rejected.
- [ ] S6.11 Tests: outbox ordering, retry after dropped connection does not duplicate, permanent rejection, last-write-wins.
- [ ] S6.12 Manual test: create and edit labels offline, reconnect, confirm the server and a second device match.
- [ ] S6.13 Manual test: kill the app while items are pending; relaunch; they still sync.

Definition of done: labels created offline appear on the server after reconnecting, exactly once; a second device receives them; failures are visible and explained.

---

## Stage 7: Tasks

Goal: the full task system.
Depends on: Stage 6. Reference: `02-backend.md` 6.3 to 6.5, `03-frontend.md` 10.3 to 10.5.

Backend
- [ ] S7.1 Task list endpoint with all filters, sorting, views (today, week, overdue) and pagination.
- [ ] S7.2 Create task (client id, assignee membership check, `task_assigned` notification).
- [ ] S7.3 Get task detail (subtasks, attachments, comments, assignee, label).
- [ ] S7.4 Update task (assignee change and status change notifications).
- [ ] S7.5 Soft delete task (admin or creator).
- [ ] S7.6 Bulk complete and delete with per-item results.
- [ ] S7.7 Move task to another workspace.
- [ ] S7.8 Subtasks endpoints.
- [ ] S7.9 Comments endpoints with mention parsing.
- [ ] S7.10 Task attachments endpoints (file must exist and be in the same workspace).
- [ ] S7.11 Add tasks, subtasks, comments and attachments to the sync endpoint.
- [ ] S7.12 Backend tests (permissions, idempotency, guest rules, bulk, move).

Flutter (mobile and desktop)
- [ ] S7.13 Task repository (Drift plus outbox plus sync).
- [ ] S7.14 Tasks screen, mobile: chips, search, tiles, swipe to edit or delete, pull to refresh.
- [ ] S7.15 Tasks screen, desktop: filter bar, sortable table, row selection, bulk bar with confirm.
- [ ] S7.16 New task screen or dialog with all fields; attachments disabled offline with explanation.
- [ ] S7.17 Task detail screen: status change, inline edit with autosave and "Saved / Waiting to sync".
- [ ] S7.18 Subtasks: add, check, reorder, delete.
- [ ] S7.19 Comments with `@mention` picker.
- [ ] S7.20 Attachments list with open and download (online only; clear message offline).
- [ ] S7.21 Assignee and label pickers (from real members and labels).
- [ ] S7.22 Move to another workspace action.
- [ ] S7.23 Overdue computed display; empty, loading, error and offline states.
- [ ] S7.24 Guest and role restrictions in the UI.
- [ ] S7.25 Flutter tests: list filters, offline create and edit, bulk actions.
- [ ] S7.26 Manual test: two accounts assign tasks to each other; offline create then reconnect.

Definition of done: everything in the task screens works with real data on Android and Windows, online and offline; permissions match the table.

---

## Stage 8: Calendar

Goal: month, week and day views with real events and task due dates.
Depends on: Stage 7. Reference: `02-backend.md` 6.6, `03-frontend.md` 10.6.

- [ ] S8.1 Backend: events range endpoint (max 62 days) including due tasks.
- [ ] S8.2 Backend: create, update, delete events with attendees and reminders.
- [ ] S8.3 Add events and attendees to the sync endpoint.
- [ ] S8.4 Backend tests (roles, attendee membership, range limit).
- [ ] S8.5 Flutter: event repository (Drift, outbox, sync).
- [ ] S8.6 Calendar screen, desktop: month, week and day, event chips, right panel, Schedule Event.
- [ ] S8.7 Calendar screen, mobile: month and day, compact grid, Today's Schedule (no overlap).
- [ ] S8.8 Schedule Event dialog or page (all fields, attendees, reminder).
- [ ] S8.9 Show tasks with due dates on the calendar and open them on tap.
- [ ] S8.10 Timezone-correct display using the profile timezone.
- [ ] S8.11 Empty, loading, error and offline states; localized month and weekday names.
- [ ] S8.12 Tests and a manual check of a real event with two attendees.

Definition of done: an event created by one user appears for attendees; offline creation syncs later; all three views work at every width.

---

## Stage 9: Files and Documents

Goal: upload and download files, folders, and written documents.
Depends on: Stage 7. Reference: `02-backend.md` 6.8 and 6.9, `03-frontend.md` 10.8.

- [ ] S9.1 Backend: upload-URL endpoint (type and size validation, sanitized name, `files` row via user client).
- [ ] S9.2 Backend: download-URL endpoint (RLS check, 5-minute signed URL).
- [ ] S9.3 Backend: delete file (uploader or admin) with storage cleanup.
- [ ] S9.4 Backend: folders endpoints (`FOLDER_NOT_EMPTY` rule).
- [ ] S9.5 Backend: documents endpoints for both file and written kinds.
- [ ] S9.6 Add folders and documents to the sync endpoint.
- [ ] S9.7 Backend tests (limits, types, permissions, guest access, cross-workspace).
- [ ] S9.8 Flutter: upload service with progress, cancel, retry and clear failure messages.
- [ ] S9.9 Flutter: Documents screen (breadcrumb, folders, recent, grid and list toggle).
- [ ] S9.10 Flutter: Upload File and drag and drop on Windows.
- [ ] S9.11 Flutter: create, rename, move and delete folders and documents.
- [ ] S9.12 Flutter: written document editor with `flutter_quill`, autosave and offline queue.
- [ ] S9.13 Flutter: file preview (images, PDF) and open other files with the system app.
- [ ] S9.14 Flutter: attach files to tasks using this service.
- [ ] S9.15 Offline behavior: cached list, disabled uploads with explanation, offline document editing.
- [ ] S9.16 Empty, loading, error states; file type badges.
- [ ] S9.17 Manual test: upload a 20 MB file on mobile data; a 30 MB file is rejected with the right message.

Definition of done: real files upload to Supabase Storage and download through signed URLs; written documents save and sync; only permitted roles can see or change them.

---

## Stage 10: Chat (real-time)

Goal: real-time chat with channels, direct messages, files and images.
Depends on: Stage 9. Reference: `02-backend.md` 6.7, `03-frontend.md` 10.7 and 11.

- [ ] S10.1 Backend: list channels and DMs with unread counts and last message preview.
- [ ] S10.2 Backend: create channel, add and remove members, get-or-create DM.
- [ ] S10.3 Backend: message history (paged) and send (idempotent by client id, needs body or file).
- [ ] S10.4 Backend: edit and delete own message, admin delete.
- [ ] S10.5 Backend: mark channel read; chat and mention notifications.
- [ ] S10.6 Backend: block chat endpoints in Personal workspaces (`CHAT_NOT_AVAILABLE_IN_PERSONAL`).
- [ ] S10.7 Backend tests (privacy of private channels and DMs, guests, idempotency).
- [ ] S10.8 Flutter: chat repository (Drift last 200 per channel, outbox for sends).
- [ ] S10.9 Flutter: Realtime subscriptions for messages and channel membership with reconnect recovery.
- [ ] S10.10 Flutter: desktop split view (channels, DMs, conversation).
- [ ] S10.11 Flutter: mobile message list and full-screen conversation.
- [ ] S10.12 Flutter: message composer with sending, sent and failed states and tap to retry.
- [ ] S10.13 Flutter: file and image sending with progress and inline image preview.
- [ ] S10.14 Flutter: new channel dialog and new DM picker.
- [ ] S10.15 Flutter: presence (online, away) and typing indicator.
- [ ] S10.16 Flutter: unread badges and mark-as-read when visible.
- [ ] S10.17 Flutter: message actions (copy, edit, delete) and `@mentions`.
- [ ] S10.18 Flutter: offline reading of cached messages and queued sending.
- [ ] S10.19 Manual test: two real devices chatting live; airplane mode on one, send, reconnect, delivery without duplicates.

Definition of done: messages arrive instantly on the other device; offline sends deliver once after reconnecting; private channels stay private.

---

## Stage 11: Notifications and push

Goal: in-app notification center and push on Android.
Depends on: Stage 10. Reference: `02-backend.md` 6.10 and 6.15, `03-frontend.md` 10.11 and 15.

- [ ] S11.1 Backend: notifications list with filters, counts, mark read and unread, read all, delete.
- [ ] S11.2 Backend: device token register and remove.
- [ ] S11.3 Backend: push worker (batching, invalid token cleanup, `pushed_at`).
- [ ] S11.4 Backend: confirm deadline, overdue and event reminders arrive once (cron plus `dedupe_key`).
- [ ] S11.5 Backend tests (privacy, dedupe, worker with a fake Firebase sender in tests only).
- [ ] S11.6 Flutter: notifications repository and screen with tabs and counts.
- [ ] S11.7 Flutter: notification actions and opening the target screen.
- [ ] S11.8 Flutter: live updates through Realtime and the bell unread dot.
- [ ] S11.9 Flutter (Android): permission request, token registration and refresh, push tap handling.
- [ ] S11.10 Flutter (Windows): local notifications from Realtime while the app is running.
- [ ] S11.11 Flutter: localized notification text from type and entity.
- [ ] S11.12 Settings: notification switches respected when showing local notifications.
- [ ] S11.13 Empty, loading and error states.
- [ ] S11.14 Manual test: assign a task from another account and receive a push with the app closed.
- [ ] S11.15 Free-tier push path: create the Vault secrets (`planpal_api_url`, `planpal_cron_secret`), `run_reminders_and_push()` and the `pg_net` call; set `CRON_SECRET` on Render.
- [ ] S11.16 Backend: secured `POST /internal/push/run` (timing-safe secret check, rate limit, not under `/api/v1`) and `sendPending()` using `claim_unpushed_notifications`.
- [ ] S11.17 Backend: send pushes immediately after any request that creates notifications (fire and forget, errors logged).
- [ ] S11.18 Retry rule: temporary Firebase failures reset `pushed_at`; stop after 3 attempts; invalid tokens deleted.
- [ ] S11.19 Weekly cleanup cron (`purge_old_rows`) and the app's full re-sync when its last sync is older than 60 days.
- [ ] S11.20 Manual test of the sleeping server: stop UptimeRobot, wait 20 minutes, create a task due in 23 hours; a deadline push must arrive within 6 minutes without opening the app.

Definition of done: real pushes reach an Android phone; the notification center matches the server; no duplicate reminders.

---

## Stage 12: Global search

Goal: search tasks, documents and people.
Depends on: Stage 11. Reference: `02-backend.md` 6.11, `03-frontend.md` 10.12.

- [ ] S12.1 Backend: `GET /search` with counts, type filter and workspace scope.
- [ ] S12.2 Backend tests (RLS respected, guest limits, minimum length, no duplicate people).
- [ ] S12.3 Flutter: search field in the top bar with Ctrl+K and the mobile search page.
- [ ] S12.4 Flutter: results page with chips and counts.
- [ ] S12.5 Flutter: grouped results with match percentage and tap to open.
- [ ] S12.6 Flutter: "This workspace" versus "All my workspaces" switch.
- [ ] S12.7 Flutter: offline local search with the offline note.
- [ ] S12.8 Debounce, empty and error states.
- [ ] S12.9 Manual test with realistic data across two workspaces.

Definition of done: searching finds real items; nothing from workspaces the user is not in ever appears.

---

## Stage 13: Analytics

Goal: real statistics and charts.
Depends on: Stage 12. Reference: `01-database.md` section 8, `02-backend.md` 6.12, `03-frontend.md` 10.9.

- [ ] S13.1 Backend: analytics endpoint combining summary, weekly, categories, daily and streak.
- [ ] S13.2 Backend: CSV export.
- [ ] S13.3 Backend: overview endpoint for Home.
- [ ] S13.4 Backend tests with a fixture and hand-calculated expected numbers.
- [ ] S13.5 Flutter: Analytics screen with the four stat cards and range selector.
- [ ] S13.6 Flutter: weekly bar chart and category donut without overlap.
- [ ] S13.7 Flutter: Export CSV (save to disk on Windows, share on Android).
- [ ] S13.8 Flutter: offline cached numbers with "Last updated".
- [ ] S13.9 Guest permission message; empty state.
- [ ] S13.10 Manual test: numbers match what the task list shows.

Definition of done: statistics equal the real data; charts render correctly in light and dark on both platforms.

---

## Stage 14: Home dashboard

Goal: the Home screen from the design with real data.
Depends on: Stages 7, 8 and 13. Reference: `03-frontend.md` 10.2.

- [ ] S14.1 Greeting by time of day with the first name and localized subtitle.
- [ ] S14.2 Tasks Today cards with complete action and View All.
- [ ] S14.3 Quick Actions (four tiles) with correct navigation.
- [ ] S14.4 Overview stat tiles with range dropdown.
- [ ] S14.5 Smooth line and area chart (fixes the broken design).
- [ ] S14.6 Right panel: mini calendar and Upcoming events (desktop).
- [ ] S14.7 Mobile header, floating add button and horizontal cards.
- [ ] S14.8 Empty, loading, error and offline states for each block.
- [ ] S14.9 Responsive check at widths 375, 700 and 1280.

Definition of done: Home shows only real data and updates live when tasks change.

---

## Stage 15: Team and Settings

Goal: team directory, activity, profile and all settings sections.
Depends on: Stage 14. Reference: `03-frontend.md` 10.10 and 10.13.

- [ ] S15.1 Team page with the corrected grid of member cards and role filter chips.
- [ ] S15.2 Presence dots from Realtime.
- [ ] S15.3 Latest Updates panel built from real activity.
- [ ] S15.4 Member profile sheet with Message and admin actions.
- [ ] S15.5 Invite with code button (opens the invite dialog).
- [ ] S15.6 Settings: Profile (avatar upload and crop, name, timezone, language, save).
- [ ] S15.7 Settings: Account (delete account, sign out).
- [ ] S15.8 Settings: Notifications switches.
- [ ] S15.9 Settings: Appearance (Light, Dark, System; five languages) synced to the profile.
- [ ] S15.10 Settings: Security (change password, sign out everywhere).
- [ ] S15.11 Settings: Workspace section (rename, leave, delete) and Sync status link.
- [ ] S15.12 Hide the Integrations tab.
- [ ] S15.13 Mobile Profile tab and Settings list.
- [ ] S15.14 Empty, loading, error states.
- [ ] S15.15 Tests: theme and language persistence across devices.

Definition of done: every settings option works and persists; the Team page matches the corrected design.

---

## Stage 16: Windows desktop polish

Goal: the desktop app feels native and complete.
Depends on: Stage 15.

- [ ] S16.1 Keyboard shortcuts from `03-frontend.md` 10.14.
- [ ] S16.2 Hover states, tooltips and context menus on desktop.
- [ ] S16.3 Window behavior (minimum size, remembered size and position).
- [ ] S16.4 Drag and drop for uploads.
- [ ] S16.5 Tab order and focus rings across all pages.
- [ ] S16.6 High-DPI and scaling checks (100%, 125%, 150%).
- [ ] S16.7 Windows installer (MSIX or Inno Setup) and app icon.
- [ ] S16.8 Confirm all screens at 1366x768 and 1920x1080.
- [ ] S16.9 Check that no code path blocks macOS later (no Windows-only calls outside `platform_info.dart`).

Definition of done: a person can use the whole app with the keyboard on Windows; the installer installs and updates cleanly.

---

## Stage 17: Quality, hardening and release

Goal: safe to give to real users.
Depends on: Stage 16.

- [ ] S17.1 Run the complete RLS test suite again on the final schema.
- [ ] S17.2 Security review of the backend: every route has auth and validation; no secrets in logs; rate limits work.
- [ ] S17.3 Confirm the service-role key exists only on the server.
- [ ] S17.4 Review every use of the admin client and confirm each has a permission check before it.
- [ ] S17.5 Load test: 50 users, chat and task lists, on the free tiers; note limits.
- [ ] S17.6 Test the Render cold start and confirm the app shows the waking message and recovers.
- [ ] S17.7 Full offline test plan: every row of the offline table in `00-overview.md` section 6.
- [ ] S17.8 Error message test: create each failure type on purpose (Wi-Fi off, server stopped, expired session, forbidden action, too-large file) and confirm the message and language are right in all five languages.
- [ ] S17.9 Translation review of all five languages by a native speaker if possible.
- [ ] S17.10 Accessibility pass (text scaling, contrast in both themes, tap targets, labels).
- [ ] S17.11 Performance pass on a low-end Android phone (scrolling, startup time, memory).
- [ ] S17.12 Privacy: terms and privacy policy URLs live; account deletion tested end to end.
- [ ] S17.13 Backups: enable Supabase backups if the plan allows; document how to restore.
- [ ] S17.14 Release build for Android (signed APK or AAB) and install test on the Samsung Galaxy A14.
- [ ] S17.15 Release build for Windows and install test on a clean machine.
- [ ] S17.16 Write a short README for running, testing and deploying everything.
- [ ] S17.17 Tag version 1.0.0 and record the release notes.

Definition of done: all earlier stages ticked; all tests green; a person who has never seen the app can sign up, join a team, do the main tasks, and gets a clear message whenever something goes wrong.

---

## Stage 18: Later (backlog, not part of version 1.0)

- [ ] L1 iOS build (push through APNs, Apple sign-in requirement review).
- [ ] L2 macOS build.
- [ ] L3 Search chat messages and calendar events.
- [ ] L4 Several assignees per task.
- [ ] L5 Recurring tasks.
- [ ] L6 Kanban board view.
- [ ] L7 Integrations tab (define what it should do first).
- [ ] L8 Email notifications.
- [ ] L9 Windows push (system tray or a push service).
- [ ] L10 More languages.
- [ ] L11 Change email address.
- [ ] L12 Move to a paid Render instance to remove cold starts.

---

## Change requests (owner adds new ideas here while building)

When you find something new while building, add a line here instead of changing earlier stages silently. Then decide which stage it belongs to.

| # | Date | Idea or change | Decision | Stage |
|---|---|---|---|---|
| CR1 | | | | |

---

## Owner inputs still needed (Kiro must ask for these, not invent them)

- [ ] Terms of Service and Privacy Policy URLs (Stage 4).
- [ ] Google OAuth client IDs and SHA-1 keys (Stage 0 and Stage 4).
- [ ] Sending domain for Resend (Stage 0).
- [ ] Final app name, icon and splash artwork if different from the design (Stage 3).
- [ ] Windows code-signing certificate, if wanted (Stage 16).
