# PlanPal: Project Overview and Decisions

> Read this file first. Then read `01-database.md`, `02-backend.md`, `03-frontend.md` and `04-task-stages.md`.
> This whole document set is written to be handed to an AI build tool (Kiro). Follow it in order, stage by stage.

---

## 1. What PlanPal is

PlanPal is a task and team productivity app. Think of it as a shared whiteboard for a team where everyone sees who is doing what and by when. It also works as a personal to-do app for one person.

One Flutter codebase produces:

| Platform | Priority | Notes |
|---|---|---|
| Android | First | Tested on a Samsung Galaxy A14 |
| Windows desktop | First | Keep code portable to macOS |
| iOS | Later | Do not write Android-only code where avoidable |
| macOS | Later | Same |

---

## 2. Golden rules (Kiro must follow these)

1. **No mock data. Ever.** Every screen reads and writes real data from Supabase through the Express API (or Supabase Realtime for chat). No hard-coded lists, fake users or placeholder tasks in the app. Empty screens must show a real empty state (see `03-frontend.md`, section 12).
2. **Build stage by stage.** Follow `04-task-stages.md`. Do not start a stage until the previous stage's checklist is fully ticked. Tick boxes as you complete tasks.
3. **The design images are the visual source of truth** for layout, spacing and colors. Two early-prototype images (`WhatsApp Image ...` and `IMG-...WA0001`) are NOT part of the design; ignore them. The design has known bugs (section 7). Do not copy the bugs.
4. **Security lives in two places**: Supabase Row Level Security (RLS) and Express permission checks. Never rely on only one.
5. **Never put secrets in the Flutter app.** The Supabase service-role key, Resend key and Firebase server credentials exist only on the Express server.
6. **Everything must work on both mobile and desktop layouts** unless a task says otherwise.
7. **Offline-aware from the start.** Local cache and a sync queue are part of the architecture, not an afterthought (section 6).

---

## 3. Confirmed product decisions

These answers came from the owner. Do not change them without asking.

| Topic | Decision |
|---|---|
| Starting point | Fresh build from the new designs. Existing users and data are NOT migrated. Start with an empty database. |
| Pricing | Removed completely: no Free/Pro/Team plans, no upgrade screen, no "Upgrade to Pro" card in the sidebar. |
| Workspaces | Every user gets a private **Personal** workspace automatically. A user can also create or join any number of **Team** workspaces. |
| Personal to team | A personal task can be moved into a team workspace. |
| Roles | Admin, Member, Guest (permissions in section 5). |
| Joining a team | **Invite code only.** No email invitations. |
| Kept features | Tasks, Calendar, Chat, Documents, Analytics, Team, Notifications, Global search. |
| Chat | One-to-one and group channels. Real-time. Files and images can be sent. |
| Documents | Both file upload and writing documents inside the app. |
| Login | Email and password, plus Google. No Microsoft (it appears in the design; remove it). |
| Password reset | 6-digit OTP code by email (kept). |
| Notifications | In-app plus push. |
| Offline | Works both online and offline (section 6). |
| Look | Three theme modes: Light, Dark and System (follows the device). Default is System. |
| Languages | English (default), Spanish, French, Chinese (Simplified), Korean. Switchable in Settings; first launch follows the device language when supported, otherwise English. |
| Errors | Every failure shows a clear message that says what went wrong and whether it is the internet, the server, permissions or something else (see `03-frontend.md`, section 13). |
| Global search | First release searches Tasks, Documents and People, as in the design. Chat messages and calendar events are a later stage. |
| Files | Supabase Storage. |
| Backend hosting | Render free tier. All free-tier rules in section 8 are mandatory. |
| Not done before build | The owner will not fix the Figma bugs first. Kiro implements those screens correctly (section 7). |

### Decisions made on the owner's behalf (owner said "you decide")

Each has a reason. The owner can change them later.

| Topic | Decision | Reason |
|---|---|---|
| Who handles login | **Supabase Auth**, called directly from Flutter with `supabase_flutter`. Express verifies the Supabase JWT on every request. | Handles email/password, Google, sessions, refresh and password reset. It is also what makes RLS work, because the database can see who the user is. Writing our own login would be more code and more risk. |
| 6-digit OTP reset | Done through Supabase Auth email OTP, with Resend set as Supabase's custom SMTP sender. The old custom Express OTP endpoints are retired. | Same user experience (6-digit code), much less code to maintain. Gmail SMTP was not delivering; Resend fixes delivery. |
| Real-time (chat, live updates, online status) | **Supabase Realtime** (Postgres Changes + Presence). | Render's free tier puts the server to sleep. A Socket.io server on Render would disconnect and lag. Supabase Realtime runs on Supabase's infrastructure and does not sleep. |
| State management in Flutter | **Riverpod** | Works the same on mobile and desktop, easy to test, good for async data and offline. |
| Local database | **Drift** (SQLite) | Reliable offline cache on Android and Windows. |
| Navigation | **go_router** | One route table for both layouts. |
| Task features, first release | Subtasks, attachments, comments, priority, due date, status, single assignee, labels (categories), reminders. | The designs and analytics need them. |
| Task features, later | Several assignees, recurring tasks, Kanban board. | Not in the designs. Adds complexity. |
| Localization tooling | Flutter gen-l10n with ARB files: `app_en.arb`, `app_es.arb`, `app_fr.arb`, `app_zh.arb`, `app_ko.arb`. | Standard Flutter way. Adding a language later means adding one file. |

---

## 4. Architecture

```
Flutter app (Android, Windows, later iOS/macOS)
   |  Riverpod, go_router, Drift (offline cache), sync queue
   |
   |-- (A) Supabase Auth ----------------- login, Google, OTP reset, sessions
   |-- (B) Supabase Realtime ------------- chat, live task/notification updates, presence
   |-- (C) Express REST API (Render) ----- all business logic and data changes
              |
              |-- Supabase Postgres (RLS on) ---- the database
              |-- Supabase Storage (private) ---- files
              |-- Firebase Cloud Messaging ------ push (Android now, iOS later)
              |-- Resend (via Supabase SMTP) ---- emails
```

### Who does what

| Job | Where it happens |
|---|---|
| Sign up, log in, Google login, refresh session, OTP reset | Flutter to Supabase Auth directly |
| Create, read, update, delete tasks, events, documents, workspaces, etc. | Flutter to Express to Supabase (using the user's JWT so RLS applies) |
| Sending a chat message | Flutter to Express (validates, creates notifications) |
| Receiving chat messages, live updates, who is online | Flutter subscribes to Supabase Realtime directly |
| File upload and download | Express creates signed URLs; Flutter transfers the file directly to and from Supabase Storage |
| Push notifications | Express worker sends through Firebase |
| Deadline reminders | Supabase `pg_cron` job creates notification rows; Express worker pushes them |
| Global search | Express endpoint using Postgres full-text search |

### Two Supabase clients on the server

Express must create two kinds of Supabase clients. This is important.

1. **User client**: created per request with the user's JWT. RLS applies. Use it for normal reads and writes.
2. **Admin client**: uses the service-role key. RLS is bypassed. Use it only for: creating signed URLs, moving files between workspaces, inserting notifications, joining with an invite code, and sending push. Never expose its results without a permission check.

---

## 5. Roles and permissions

Personal workspace: the owner is the only member, always Admin. It cannot be deleted, cannot have invite codes, cannot have chat channels, and the owner cannot leave it.

Team workspace:

| Action | Admin | Member | Guest |
|---|---|---|---|
| View workspace tasks | Yes | Yes | Only tasks assigned to them |
| Create tasks | Yes | Yes | No |
| Edit any task | Yes | Only tasks they created or are assigned to | Only tasks assigned to them (status and comments) |
| Delete tasks | Yes | Only tasks they created | No |
| Comment on tasks | Yes | Yes | Yes (assigned tasks only) |
| View calendar events | Yes | Yes | Only events they attend |
| Create and edit events | Yes | Yes | No |
| Chat in channels | Yes | Yes | Only channels they were added to |
| Create channels | Yes | Yes | No |
| Documents: view | Yes | Yes | No |
| Documents: upload, write, delete own | Yes | Yes | No |
| Documents: delete anyone's | Yes | No | No |
| View analytics | Yes | Yes (own numbers and team totals) | No |
| View team directory | Yes | Yes | Only themselves and admins |
| Create or revoke invite codes | Yes | No | No |
| Change member roles or remove members | Yes | No | No |
| Rename or delete the workspace | Yes | No | No |

A team workspace must always have at least one Admin. Block demoting or removing the last Admin.

---

## 6. Offline strategy

Owner requirement: the app works both online and offline.

Plain-language idea: the app keeps a local copy of your data on the device (like a notebook). When you are offline you keep writing in the notebook. When the internet comes back, the app copies your changes to the server and pulls anything new.

| Feature | Offline behavior |
|---|---|
| View tasks, calendar, documents list, team, notifications | Works from the local cache |
| Create, edit, complete, delete tasks and subtasks | Works. Changes are saved locally and queued. |
| Add comments | Works, queued |
| Create and edit calendar events | Works, queued |
| Write in-app documents | Works, queued |
| Chat: read old messages | Works from cache |
| Chat: send a message | Queued and shown as "sending", sent when back online |
| Chat: receive new messages, online status | Online only |
| Upload files, download files not yet cached | Online only. Show a clear message. |
| Global search | Searches the local cache offline (tasks, events, people, document titles); full search including chat messages needs online |
| Login, sign-up, password reset, Google login | Online only. An already logged-in user can open the app offline. |
| Analytics | Shows the last cached numbers with an "offline, last updated" label |
| Push notifications | Online only |

Sync rules:

- Every synced table has `updated_at` and `deleted_at` (soft delete), so the app can pull "everything changed since my last sync" and also learn what was deleted.
- Conflict rule: **last write wins**, compared by `updated_at`. The server sets `updated_at`, not the phone's clock.
- Queued actions are stored in a local `outbox` table and replayed in order. A failed action retries with backoff. A permanently rejected action (for example, permission removed) is shown to the user and removed from the queue.
- Show a small offline indicator in the app bar/sidebar and a "syncing" state.

---

## 7. Design changes: what to remove, add and fix

### Remove
- Whole "Upgrade Plan" screen (Free / Pro / Team).
- "Upgrade to Pro" card at the bottom of the desktop sidebar.
- "Create **Free** Account" wording on sign-up: use "Create Account".
- Microsoft login button on desktop login and sign-up (mobile too, if present).
- Any plan limits (3 projects, 2 guests and so on). There are no limits.
- "Workspace Admin" is a role label. Show the user's real role in the current workspace instead of a fixed text.

### Add (not in the designs)
- **Workspace switcher**: desktop, at the top of the sidebar; mobile, in the Home header or profile. Lists Personal plus every team workspace, plus "Create workspace" and "Join with code".
- **Join with code** screen and **Create workspace** screen.
- **Invite codes** management (Admin only) inside Workspace Settings: list, create (choose role and optional expiry), revoke, copy.
- **Members management** (Admin only): change role, remove member.
- **Document editor** for written documents, and "New document" next to "Upload File".
- **File and image sending in chat** (the paperclip already exists in the desktop design), with image previews.
- **Offline / syncing indicator.**
- **Theme** (Light / Dark / System) and **Language** (English, Spanish, French, Chinese, Korean) settings under Appearance.
- **Clear error and status messages** on every screen and action (see `03-frontend.md`, section 13).
- **Real empty, loading and error states** for every screen.
- **Personal workspace behavior**: hide Chat and Team pages while the Personal workspace is selected.
- **Mobile screens missing from the Figma export**: Documents, Analytics, Team, Global Search, Task detail edit mode, Create workspace, Join workspace. Build them by adapting the matching desktop screen to a single-column layout with the same components.

### Fix (bugs in the design; implement correctly)
1. **Desktop Team page:** names and roles are stacked one letter per line and the cards are far too tall. Build normal member cards in a responsive grid: avatar, full name on one line, role below, presence dot.
2. **Desktop Home dashboard "Overview" chart:** the blue lines are broken segments. Build a smooth line/area chart with a y-axis (0 to 100 scale) and date labels on the x-axis, with a soft blue fill under the line.
3. **Desktop Analytics "Category Mix" donut:** it overlaps the card title. Give it its own space.
4. Some sidebar icons (Team, Settings) render as small dots in some exports. Use proper icons everywhere.
5. The mobile Calendar's "Today's Schedule" overlaps the month grid. Give the grid its own height.
6. Mobile Task list has a blank circle button in the top-right; give it a purpose (filter) or remove it.

### Data shown in the designs is example text only
Names like Alex Johnson, Maya Webb, "Team Meeting Prep", dates in May 2024 and stats like "12 tasks completed" are placeholder text from Figma. Do not copy them into code. The real user's name, tasks and numbers always come from the database.

---

## 8. Free-tier rules (Render, Supabase, Firebase, Resend)

The owner uses free plans everywhere. Design for them. **Never assume anything keeps running while the Render server is asleep.**

### 8.1 Render (backend)
Render's free tier stops the server after about 15 minutes with no requests. The first request after that can take up to about a minute. Timers inside Express (setInterval, node-cron) die when the server sleeps or restarts.

1. `GET /health` returns quickly with no database call. `GET /health/db` runs `select 1` against Supabase (this keeps the Supabase project active).
2. Set up a free UptimeRobot account with two monitors, `/health` and `/health/db`, every 5 minutes. This keeps Render awake.
3. **Nothing time-based may depend on a timer inside Express.** Reminders and cleanups run in Supabase `pg_cron` (always on). When a push must go out, `pg_cron` calls Express through `pg_net` (see `01-database.md` section 9 and `02-backend.md` section 6.15), which also wakes the server.
4. Pushes for things that happen inside a request (task assigned, comment, chat message) are sent immediately from that same request, because the server is awake then.
5. Flutter must handle a slow first response: show a clear "Connecting..." state, use a long timeout (60 seconds) on the first call, and never freeze the UI.
6. Chat receiving does not go through Render (Supabase Realtime), so it is unaffected by sleep. Chat sending does, hence rules 2 and 5 plus the offline queue.
7. One Render service only (the monthly free instance hours cover one always-on service). No local disk storage (the disk is wiped on restart). Log to stdout.

### 8.2 Supabase (database, auth, storage, realtime)
- A free project can be **paused after a period of inactivity**. The `/health/db` monitor and the pg_cron jobs keep it active. If it is ever paused, the app shows "server unreachable" and the owner restores it from the Supabase dashboard.
- Free plans limit database size, file storage, bandwidth, and Realtime connections and messages. Check the current numbers in the Supabase dashboard and keep usage low:
  - Compress images on the phone before upload (maximum 1600 px on the long side, quality 80).
  - Use **one Realtime channel per workspace** (not one per table per screen). Throttle presence updates to once every 30 seconds. Write `last_seen_at` only when the app closes.
  - Paginate every list. Sync pulls always use `since`. While Realtime is connected, pull every 5 minutes; when it is not, every 2 minutes.
  - Keep pg_cron jobs light (reminders every 5 minutes; cleanup weekly).
  - Weekly cleanup deletes notifications older than 90 days and permanently removes soft-deleted rows older than 60 days. A device that was offline for more than 60 days does a full re-sync.
- `pg_cron`, `pg_net` and Vault are available on the free plan.

### 8.3 Firebase Cloud Messaging
Free. Used for Android push now and iOS later. Windows uses local notifications only.

### 8.4 Resend (email)
The free plan has a daily and monthly email cap. Use email **only** for sign-up confirmation and password-reset codes. No email notifications in version 1.0.

---

## 9. Tech stack summary

**Flutter:** `flutter_riverpod`, `go_router`, `supabase_flutter`, `dio`, `drift` + `sqlite3_flutter_libs`, `connectivity_plus`, `flutter_secure_storage`, `intl` + Flutter gen-l10n, `fl_chart`, `table_calendar` (or `syncfusion`-free equivalent), `file_picker`, `image_picker` (mobile), `cached_network_image`, `flutter_quill`, `firebase_core` + `firebase_messaging` (Android/iOS), `flutter_local_notifications` (Android, Windows), `window_manager` (Windows), `url_launcher`, `google_sign_in` (mobile), `freezed` + `json_serializable`, `flutter_test` + `mocktail`.

**Backend (Node.js, Express):** `express`, `@supabase/supabase-js`, `zod` (validation), `helmet`, `cors`, `express-rate-limit`, `pino` (logging), `firebase-admin`, `dotenv`, `jest` + `supertest`.

**Database:** Supabase Postgres with RLS, `pg_trgm`, full-text search, `pg_cron`.

Package versions: use the latest stable versions at build time and pin them in the lockfiles.

---

## 10. Environment variables

Backend (`.env` on Render, never committed):
```
PORT=3000
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=          # only if verifying JWTs locally
FIREBASE_SERVICE_ACCOUNT_JSON=  # base64 of the service-account file
ALLOWED_ORIGINS=
CRON_SECRET=                  # long random string; pg_cron sends it to /internal/push/run
NODE_ENV=production
```

Flutter (passed with `--dart-define` or a git-ignored config file; the anon key is safe to ship, the service-role key is not):
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
API_BASE_URL=
GOOGLE_WEB_CLIENT_ID=
```

---

## 11. Repository layout

```
planpal/
  app/                 # Flutter project (mobile + desktop)
  backend/             # Node.js + Express
  supabase/
    migrations/        # SQL files in order (from 01-database.md)
  docs/                # these markdown files
```
