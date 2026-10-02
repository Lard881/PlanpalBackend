# PlanPal: Frontend (Flutter, Mobile and Desktop)

> Read `00-overview.md`, `01-database.md` and `02-backend.md` first.
> One Flutter project builds the Android app and the Windows desktop app (iOS and macOS later). The screens come from the Figma export images. Open the matching image file for exact layout, spacing and colors.

---

## 1. Plain-language idea

Think of the app as one house with two front doors:

- On a phone, you enter through the **bottom tab bar** door (Home, Tasks, Chat, Profile, Settings).
- On a desktop, you enter through the **left sidebar** door (Home, Tasks, Calendar, Chat, Documents, Analytics, Team, Settings).

Behind both doors it is the same rooms: the same data, the same logic, the same widgets. Only the layout around them changes with the screen width.

---

## 2. Project structure (feature-first)

```
app/lib/
  main.dart                       # startup: init Supabase, Drift, l10n, Firebase (mobile), window (desktop)
  app.dart                        # MaterialApp.router, theme, locale
  core/
    config/env.dart               # --dart-define values
    theme/                        # tokens, light + dark ThemeData, text styles
    l10n/                         # app_en.arb, app_es.arb, app_fr.arb, app_zh.arb, app_ko.arb
    router/                       # go_router setup, guards
    network/
      api_client.dart             # dio, auth interceptor, retry-on-401, timeouts
      connectivity_service.dart   # real reachability, not just "has wifi"
      api_error_mapper.dart       # response/exception -> AppFailure
    errors/
      app_failure.dart            # sealed failure types
      failure_messages.dart       # failure -> localized text
    db/                           # Drift database, tables, DAOs
    sync/
      outbox.dart                 # queued local changes
      sync_engine.dart            # push outbox, pull changes, retry with backoff
    layout/
      breakpoints.dart
      adaptive_scaffold.dart      # bottom bar vs rail vs sidebar
    widgets/                      # shared components (section 6)
    utils/
  features/
    auth/          workspace/     home/       tasks/      calendar/
    chat/          documents/     analytics/  team/       search/
    notifications/ settings/
      (each feature has: data/ (repository, DTOs, DAOs), domain/ (models), presentation/ (screens, widgets, providers))
```

Rules:
- Screens never call `dio` or Supabase directly. They read from **Riverpod providers**, which read from **repositories**.
- Repositories read from the local Drift database first and refresh from the server. Writes go to Drift and the outbox first (section 8).
- Models use `freezed` and `json_serializable`.
- No business logic inside widgets.
- No hard-coded user-facing strings: every string comes from the ARB files.
- No mock data anywhere, including tests that ship in the app. Widget tests may use fakes that live only under `test/`.

---

## 3. Setup notes per platform

**Android (first)**
- `minSdk 23` or higher.
- Add Firebase (`google-services.json`) for push. Ask for the notification permission on Android 13 and above.
- Google sign-in with the native `google_sign_in` flow, then `supabase.auth.signInWithIdToken`.
- Release build: signed AAB or APK, R8 on.

**Windows (first)**
- Use `window_manager`: minimum window size 900x600, remember size and position.
- Google sign-in on desktop uses the browser: `supabase.auth.signInWithOAuth(google)` with a loopback redirect; the app listens on a local port until the redirect returns.
- Local notifications through `flutter_local_notifications` (Windows support). No FCM on Windows.
- Keyboard shortcuts (section 10.13).
- Use `sqlite3_flutter_libs` so Drift works on Windows.

**iOS and macOS (later; do not block them now)**
- Do not use `dart:io` `Platform` checks scattered around. Put them in one `platform_info.dart`.
- Avoid Android-only or Windows-only plugins in shared code paths.
- Keep push behind an interface `PushService` with an Android implementation now and iOS later.

---

## 4. Design system

Values are read from the design images. Put them in `core/theme/` as tokens; never use raw hex values in widgets.

### 4.1 Colors

| Token | Light | Dark |
|---|---|---|
| `primary` | `#3B82F6` | `#60A5FA` |
| `onPrimary` | `#FFFFFF` | `#0B1220` |
| `success` (green, Calendar button, Completed) | `#10B981` | `#34D399` |
| `warning` (orange, Analytics button, Medium priority) | `#F59E0B` | `#FBBF24` |
| `violet` (purple, Documents button) | `#8B5CF6` | `#A78BFA` |
| `danger` (red, High priority, Overdue) | `#EF4444` | `#F87171` |
| `background` | `#F8FAFC` | `#0B1220` |
| `surface` (cards) | `#FFFFFF` | `#111827` |
| `surfaceAlt` (inputs, chips) | `#F1F5F9` | `#1F2937` |
| `sidebar` (desktop) | `#0F172A` | `#020617` |
| `textPrimary` | `#0F172A` | `#F1F5F9` |
| `textMuted` | `#64748B` | `#94A3B8` |
| `border` | `#E2E8F0` | `#1F2937` |

Priority chips: High = `danger` tint, Medium = `warning` tint, Low = `success` tint (text in the strong color, background at about 12% opacity). Status chips: Todo = grey, In Progress = `primary` tint, Completed = `success` tint, Overdue = `danger` tint. Both light and dark versions of every chip must keep a text contrast ratio of at least 4.5:1.

### 4.2 Typography and shape
- Font: **Inter** (bundle the font files; do not download at runtime, because the app must work offline). For Chinese and Korean, use the platform's default CJK fallback (Noto Sans SC / Noto Sans KR on Android, Microsoft YaHei / Malgun Gothic on Windows).
- Scale: page title 28 (desktop) / 24 (mobile) bold; section title 20 semibold; card title 16 semibold; body 14; caption 12.
- Corner radius: cards 16, buttons and inputs 10, chips fully rounded.
- Spacing scale: 4, 8, 12, 16, 24, 32.
- Cards: 1 px border, very soft shadow in light mode; border only in dark mode.

### 4.3 Theme modes (owner requirement)
- Three choices: **Light**, **Dark**, **System**. Default **System** (follows the device, updates live when the device changes).
- Stored locally (Drift/shared preferences) and in `profiles.theme` so it follows the user to other devices. Local value applies instantly, then syncs.
- Implement with a Riverpod `themeModeProvider` feeding `MaterialApp.router(themeMode: ...)`.
- The desktop sidebar is dark in both modes (as in the design).

---

## 5. Responsive layout

| Width | Layout name | Navigation | Notes |
|---|---|---|---|
| under 600 | **Mobile** | Bottom tab bar (5 tabs) + FAB where the design has one | Single column. |
| 600 to 899 | **Tablet / narrow window** | Navigation rail (icons + labels) on the left | Two columns where sensible. |
| 900 and above | **Desktop** | Full dark sidebar (240 px) + top bar + content | Right side panels appear (calendar, updates). |

`adaptive_scaffold.dart` chooses the layout from `MediaQuery` width, not from the platform. A phone in landscape or a narrow Windows window must still look right.

**Mobile bottom tabs** (from the design): Home, Tasks, Chat, Profile, Settings. The other pages (Calendar, Documents, Analytics, Team, Notifications, Search) are opened from Home quick actions, the header bell, the search icon, and a "More" list inside Profile. Chat is hidden while the Personal workspace is selected; in that case the Chat tab shows a short explanation and a button "Create or join a team workspace".

**Desktop sidebar items:** Home, Tasks, Calendar, Chat, Documents, Analytics, Team, Settings. In the Personal workspace, hide Chat and Team.

**Top bar (desktop):** workspace switcher (left of the search field, added by us), global search field with the Ctrl+K hint, notification bell with unread dot, user avatar + name + real role in the current workspace.

---

## 6. Shared components (build once, reuse everywhere)

`PlanPalButton` (primary, secondary, danger, loading state), `PlanPalTextField` (label, error text, obscure toggle), `PriorityChip`, `StatusChip`, `LabelChip`, `Avatar` (image with initials fallback, presence dot), `TaskCard` (Home), `TaskRow` (table row desktop, list tile mobile), `SectionHeader` (title + "View All"), `QuickActionTile`, `StatCard`, `EmptyState`, `ErrorState` (message + Retry), `LoadingSkeleton`, `ConnectivityBanner`, `SyncStatusChip`, `WorkspaceSwitcher`, `SearchField`, `ConfirmDialog`, `FilePickerButton`, `AttachmentTile`, `ChatBubble`, `MessageComposer`, `DateTimePickerField`, `RoleBadge`, `AppSnackbar` (typed: success, info, error).

---

## 7. Navigation (go_router)

| Route | Screen | Notes |
|---|---|---|
| `/splash` | Session check | Reads the stored session; goes to `/home` or `/login`. Works offline if a session exists. |
| `/login` `/signup` | Auth | Public. |
| `/forgot-password` `/verify-code` `/new-password` | Password reset (6-digit code) | Public. |
| `/onboarding/workspace` | First-run choice | After first login only: "Continue with Personal" or "Create or join a team". Skippable. |
| `/home` | Home | |
| `/tasks` | Task list | |
| `/tasks/new` | New task | Dialog on desktop, full page on mobile. |
| `/tasks/:id` | Task detail | Desktop: side panel or page as in `desktop-task-detail.png`. |
| `/calendar` | Calendar | |
| `/chat` `/chat/:channelId` | Chat | Mobile: list then conversation. Desktop: split view. |
| `/documents` `/documents/folder/:id` `/documents/:id` | Documents | `:id` opens a file preview or the editor. |
| `/analytics` | Analytics | |
| `/team` | Team directory | |
| `/search?q=` | Search results | |
| `/notifications` | Notifications | |
| `/profile` | Profile (mobile tab) | |
| `/settings` `/settings/:section` | Settings | Sections: profile, account, notifications, appearance, workspace, security. |
| `/workspace/create` `/workspace/join` | Workspace management | |
| `/workspace/:id/members` `/workspace/:id/invites` | Admin screens | Admin only. |

Guards:
- Not signed in: redirect to `/login`.
- Signed in on `/login`: redirect to `/home`.
- Deep links from a push notification open the right task, event, channel or document (from the notification `data`).
- The selected workspace is part of app state (`currentWorkspaceProvider`), stored locally, and defaults to the Personal workspace.

---

## 8. Data layer, offline and sync

### 8.1 Layers
```
Screen  ->  Riverpod provider  ->  Repository  ->  Drift (local)  <->  Sync engine  <->  API / Realtime
```
Screens **watch Drift streams**. So the screen updates immediately when a local change happens, and again when the server data arrives. This is what makes offline feel normal.

### 8.2 Local tables (Drift)
Mirror the server tables that the app reads: `profiles`, `workspaces`, `workspace_members`, `labels`, `tasks`, `subtasks`, `task_comments`, `task_attachments`, `files` (metadata only), `events`, `event_attendees`, `channels`, `channel_members`, `messages` (last 200 per channel), `folders`, `documents`, `notifications`.

Extra local-only tables:
- `outbox(id, entityType, entityId, operation, payloadJson, createdAt, attempts, lastError, status)` where `status` is `pending | failed`.
- `sync_state(workspaceId, lastServerTime)`.
- `kv(key, value)` for small settings (theme, language, selected workspace).

Each mirrored row also has `syncStatus`: `synced | pending | failed`, so the UI can show a small "waiting to sync" marker.

Local cache is **per signed-in user**. On sign-out, delete the local database and secure storage so the next person on the device sees nothing.

### 8.3 Writes (offline-first)
1. Create the change in Drift right away (new rows get a client-generated UUID v4). The UI updates instantly.
2. Add an outbox entry.
3. If online, the sync engine sends it now; if offline, it waits.
4. On success, mark the row `synced` and store the server's version of it (server sets `updated_at`).
5. On a temporary failure (no internet, 5xx, timeout, 503), keep it `pending` and retry with exponential backoff (2s, 4s, 8s ... max 5 min).
6. On a permanent failure (400, 403, 404), mark the entry `failed`, roll the local row back or mark it, and tell the user with a clear message (section 13). The **Sync status** screen (Settings) lists pending and failed items, with "Retry" and "Discard".

Order matters: the outbox is replayed **in creation order**, one at a time per entity, so a "create task" is always sent before "edit that task".

### 8.4 Reads and pulling
- On app start, on login, on workspace switch, when connectivity returns, and every 5 minutes while the app is open and Realtime is connected (every 2 minutes when it is not): call `GET /workspaces/:id/sync?since=<lastServerTime>` and merge into Drift. Rows with `deleted_at` are removed locally.
- Chat history: fetch the latest 50 when a channel opens, and older pages on scroll up.
- Realtime keeps things fresh while online (section 11).
- If the server row is newer than a local pending row, the **server wins only after** the pending change has been sent (last write wins, as decided).

### 8.5 What works offline
Exactly the table in `00-overview.md`, section 6. Actions that cannot work offline (upload file, log in, Google sign-in, open a not-yet-cached file) must be **disabled or must explain**, not fail silently.

### 8.6 Connectivity service
`connectivity_plus` only says whether a network interface exists, not whether the internet works. So the service does two things:
1. Listen to `connectivity_plus` for quick "no network" detection.
2. When the interface says "connected", confirm real reachability by calling `GET {API_BASE_URL}/health` with a short timeout (5 s). Re-check when a request fails.

It exposes one state to the whole app:

| State | Meaning |
|---|---|
| `online` | Network and server reachable |
| `noNetwork` | Device has no network interface (airplane mode, Wi-Fi off) |
| `noInternet` | Interface up but nothing reachable (for example Wi-Fi without internet); also confirm with a reachability check on a second host (Supabase URL) |
| `serverUnreachable` | Internet works (Supabase URL responds) but the PlanPal API does not (server down or waking up) |

This state drives the banner (section 13) and lets the error messages say the **true reason**.

---

## 9. Authentication (Supabase Auth from Flutter)

### 9.1 Screens (from `desktop-login.png`, `desktop-signup.png`, `mobile-login.png`, `mobile-signup.png`)
- **Login:** email, password (show/hide), "Forgot password?", "Sign in" button, "or continue with" **Google** (Microsoft removed), link to sign up.
- **Sign up:** full name, email, password (minimum 8 characters), confirm password, checkbox "I agree to the Terms of Service and Privacy Policy" (the links open real URLs that the owner will provide; keep them in `env.dart`, and until they exist link to a simple in-app placeholder page, but do not remove the checkbox), button **"Create Account"** (not "Create Free Account"), Google button, link to sign in.
- **Verify email:** enter the 6-digit code sent by email (Supabase confirm signup with OTP), resend button with a 60-second cooldown.
- **Forgot password (3 steps):** enter email; enter the 6-digit code; enter and confirm the new password. Use `resetPasswordForEmail`, `verifyOTP(recovery)`, `updateUser`.

### 9.2 Behavior
- Validate before sending: valid email format, password 8 or more characters, passwords match. Show errors under the field, in the user's language.
- Map Supabase auth errors to the failure types in section 13 (wrong password, email not confirmed, user already exists, weak password, too many requests, network).
- After login: call `GET /me`, store profile, apply the saved theme and language, register the device for push (mobile), start the first sync, then open `/home` (or `/onboarding/workspace` the first time).
- Session: `supabase_flutter` stores and refreshes the session. The `dio` interceptor adds the access token, and on `401 AUTH_EXPIRED` refreshes once and retries once. If refresh fails, sign out and go to `/login` with the message "Your session has expired".
- Sign out: unregister the push token (`DELETE /devices/:token`), clear local database and secure storage, go to `/login`. Signing out works offline (clear locally; the token cleanup retries later or expires).
- Google on Android: native flow with `signInWithIdToken`. Google on Windows: browser flow with loopback redirect.

---

## 10. Screens

For each screen: what it shows, where the data comes from, actions, and states. Every screen implements **loading, empty, error, and offline** states (sections 12 and 13). Names in the designs (Alex Johnson, Maya Webb, and so on) are Figma placeholder text only.

### 10.1 Workspace switcher and workspace screens (new; not in the design)
- Desktop: at the top of the sidebar, below the logo: current workspace name with an arrow; opens a menu listing **Personal** and every team (with role badge), then "Create workspace" and "Join with code".
- Mobile: in the Home header (tap the workspace name).
- **Create workspace:** one field (name), button "Create". Creator becomes admin; a #general channel exists automatically.
- **Join with code:** one field (8 characters, auto-uppercase, spaces trimmed), button "Join". Show specific errors for invalid, expired, revoked, used up, and already a member.
- **Members (admin):** list with avatar, name, role dropdown (Admin, Member, Guest), remove button, and "Leave workspace" for yourself. Show `LAST_ADMIN` as a clear message.
- **Invite codes (admin):** list of codes with role, uses, expiry, status; "New code" dialog (role, optional max uses, optional expiry); copy button; revoke button.
- **Personal workspace:** hides Chat, Team, Members, Invites.

### 10.2 Home
Reference: `desktop-home-dashboard.png`, `PlanPal-Mobile-Flow.png` (first phone).
- Greeting by time of day with the user's first name ("Good Morning/Afternoon/Evening, {name}") and the line "Let's make today productive." (localized).
- **Your Tasks Today:** tasks of the current workspace due today and assigned to the user, as cards (title, time, priority chip, action button "Details"). "View All Tasks" goes to `/tasks?view=today`. The check icon marks a task complete. Mobile: horizontal scroll; desktop: row of up to three cards.
- **Quick Actions:** New Task (blue), Calendar (green), Analytics (orange), Documents (purple). Desktop: four in a row. Mobile: 2x2 grid.
- **Overview** (desktop; on mobile show it below Quick Actions if space allows): range dropdown (This Week, Last 7 days, Last 30 days); four stat tiles (Tasks Completed, Tasks In Progress, Tasks Overdue, Productivity %); smooth line/area chart of tasks completed per day with a y-axis and date labels. Fix the design's broken chart (see `00-overview.md`, section 7). Data: `GET /workspaces/:id/overview`.
- **Right panel (desktop only):** mini month calendar with today highlighted and "Today" and arrow buttons; **Upcoming** list of the next events with colored dots and time. Data from events.
- Mobile: header has logo, bell (unread dot) and avatar; a floating "+" button opens New Task.

### 10.3 Tasks
Reference: `desktop-tasks.png`, `PlanPal-Mobile-Flow.png` (second phone), `mobile` task screens.
- **Desktop:** page title, subtitle, "Add Task" button; filter bar (Status, Priority, Assignee dropdowns and Sort control); table with checkbox column, Task Name, Assignee (avatar + name), Due Date, Priority chip, Status chip. Selecting rows shows the blue bulk bar "N tasks selected" with **Mark Complete** and **Delete Selected** (confirm before delete). The design shows "Priority: High" pre-selected; the real default is **All**. Clicking a row opens the task detail.
- **Mobile:** search field, chips **All / Today / This Week / Overdue**, list of task tiles (checkbox, title, day + time, priority chip). Swipe left reveals **Edit** and **Delete** (the design's tip text "Swipe left on a task to edit or delete" is shown once, until dismissed). Completed tasks show strikethrough. Overdue tasks show a red "Overdue" marker. Pull to refresh.
- Search box filters the list locally (offline capable).
- Statuses shown: Todo, In Progress, Completed, and computed Overdue.
- Data: Drift `tasks` (with joins) filtered by the current workspace.

### 10.4 Task detail
Reference: `desktop-task-detail.png` and the third phone in `PlanPal-Mobile-Flow.png`.
- Header: back to tasks, priority chip, status chip (tap to change), title (editable), due date.
- Sections: **Description**, **Subtasks (done/total)** with checkboxes and an inline "Add subtask" field, **Attachments** (file name, size, tap to download/open; "Attach File" button), **Comments** (avatar, name, relative time, text, composer at the bottom with `@` mention picker), assignee selector (members of this workspace), label selector, and menu with **Move to another workspace** (Personal to Team and back; only shows workspaces where the user is admin or member) and **Delete**.
- Editing saves automatically (debounced 800 ms) to Drift and the outbox; show a small "Saved" or "Waiting to sync" indicator.
- Guests see and change only what the permission table allows; disabled fields explain why on long-press or hover.

### 10.5 New task / edit task
Reference: fourth phone in `PlanPal-Mobile-Flow.png`.
- Fields: Task Name (required), Description, Due Date (date and time picker), Priority (High / Med / Low segmented control, default Medium), Assignee (default: yourself; in the Personal workspace it is fixed to yourself), Label (optional), buttons **Add Subtask** and **Attach File**, primary button **Create Task**.
- Attachments need the internet. Offline, the button is disabled with the explanation "Attachments need an internet connection" (a task can still be created without them).
- After creating, return to the list; the new task is there instantly.

### 10.6 Calendar
Reference: `desktop-calendar.png`, fifth phone in `PlanPal-Mobile-Flow.png`.
- **Desktop:** month title with previous/next arrows, **Week / Month / Day** switch, month grid with colored event chips per day and "+N more" when crowded; right panel "Events: {selected date}" with time, title, dot color, and **Schedule Event** button. Today's cell is highlighted.
- **Mobile:** **Month / Day** toggle, compact month grid (give the grid its own height; do not overlap it with the schedule list as the design does), "Today" button, and **Today's Schedule** list below.
- Tasks with a due date also appear (a different marker, tap to open the task).
- **Schedule Event** dialog/page: title, description, start, end, all day, color, attendees (workspace members), reminder (5, 15, 30, 60 minutes).
- Data: Drift `events`, `event_attendees`, tasks with due dates.

### 10.7 Chat
Reference: `desktop-chat.png`, sixth phone in `PlanPal-Mobile-Flow.png`.
- **Desktop split view:** left column **Channels** (with `#` names, unread count) and **Direct Messages** (avatar, name, presence dot); center conversation with channel header (name, description, search and members icons), messages with avatar, name, time, bubbles (own messages right, blue), attachment button (paperclip), text field, emoji button, send button.
- **Mobile:** the Messages list (search field, channel and DM rows with last message preview, time and unread badge; floating chat button starts a new DM or channel), then a full-screen conversation.
- Real-time: new messages appear instantly through Supabase Realtime (section 11). Sending uses `POST /channels/:id/messages` with a client-generated UUID; the bubble appears at once with a small clock (sending) and changes to a check when confirmed. Offline: stays "waiting" until it sends; failed sends show a red "Tap to retry".
- **Files and images:** paperclip on desktop, "+" on mobile; pick a file (or an image from the gallery/camera on mobile). Flow: request upload URL, upload with progress bar, then send the message with `fileId`. Images show an inline preview (tap for full-screen); other files show a file tile with name and size. Needs internet.
- New channel dialog (name, description, private toggle, pick members). New DM picker from workspace members.
- Typing indicator and "online" dots from Realtime Presence.
- Message actions (long press or hover menu): copy, edit own, delete own (admins can delete any).
- Mark a channel as read when opened and visible (`POST /channels/:id/read`).
- Unavailable in the Personal workspace (see section 5).

### 10.8 Documents
Reference: `desktop-documents.png`.
- Breadcrumb (workspace name / folder), page title, **Grid / List** toggle, **Upload File** button and (new) **New Document** button.
- **Folders** row (name, file count), **Recent Documents** grid: preview tile with file type badge (PDF red, DOC blue, XLS green, other grey), name and size, or a "written document" tile.
- Actions per item: open, rename, move to folder, download, delete (uploader or admin). Upload uses the signed URL flow with a progress indicator. Images are compressed on the device before upload (maximum 1600 px on the long side, quality 80) to save free-tier storage and bandwidth. Drag and drop files onto the page on Windows.
- **Written document editor:** title field, rich text editor (`flutter_quill`) with bold, italic, underline, headings, bullet and numbered lists, links. Autosaves (debounced 2 s) to Drift and the outbox; saves as Quill delta JSON plus a plain-text copy for search.
- File preview: images and PDFs open in-app; other files download and open with the system app.
- Empty state when there are no folders or documents.

### 10.9 Analytics
Reference: `desktop-analytics.png`.
- Title, subtitle, range dropdown (Last 7 / 30 / 90 Days), **Export CSV** button.
- Four stat cards: **Tasks Completed** (+ change versus the previous period), **Avg. Completion Time** (days), **Team Velocity** (on-time rate %), **Productive Streak** (days).
- **Weekly Task Output** bar chart (Mon to Sun) and **Category Mix** donut (by label). Fix the design's overlap: the donut has its own space beside its title. Use `fl_chart`.
- Mobile: cards in a 2x2 grid, then charts stacked; reachable from the Home Analytics quick action.
- Offline: show the last cached data with "Last updated {time}".
- Guests: no access (route shows a permission message).

### 10.10 Team
Reference: `desktop-team.png` (fix the layout bug, see `00-overview.md`).
- Title "Team Directory", role filter chips **All / Admin / Member / Guest**, **Invite Member** button (opens the invite-codes dialog; admin only. Change the label to "Invite with code").
- Responsive grid of member cards: avatar, full name on one line, role, presence dot (Active now, Away, Offline) from Realtime Presence.
- Right panel "Latest Updates" (desktop): recent activity in the workspace (task completed, file uploaded, member joined), built from real recent rows (tasks, files, members). No invented text.
- Tap a member: profile sheet with a "Message" button (opens a DM) and, for admins, role change and remove.
- Mobile: a list, reached from Profile > Team.

### 10.11 Notifications
Reference: `desktop-notifications.png`, `mobile-notifications.png`.
- Tabs: **All (n)**, **Unread (n)**, **Tasks**, **Mentions**; **Mark all as read** button.
- Row: colored icon by type (task assigned, comment, mention @, deadline clock, system info), title, relative time, one-line body, blue dot for unread, three-dot menu (mark read/unread, delete).
- Tap opens the target (task, event, channel, document) and marks it read.
- Data: Drift `notifications` kept fresh by Realtime inserts and `GET /notifications`.
- Localize the visible title and body from `type` and the referenced entity when possible, falling back to the server text.

### 10.12 Global search
Reference: `desktop-search-results.png`.
- Desktop: the top-bar search field (Ctrl+K focuses it). Typing opens the results page; **Esc** closes. Mobile: search icon in the header opens a search page.
- Debounce 300 ms, minimum 2 characters.
- Chips: **All Results (n)**, **Tasks (n)**, **Documents (n)**, **People (n)**, using counts from `GET /search`.
- Results grouped by type. Task rows: checkbox, title, due date, priority chip, match %. Document rows: icon, name, "Last updated ...", match %. People rows: avatar, name, email, role.
- Scope switch: "This workspace" (default) or "All my workspaces".
- Offline: search the local Drift data (tasks, people, document titles) with a note "Offline: showing results from this device".
- First release does not search chat messages or events.

### 10.13 Settings and profile
Reference: `desktop-settings.png`, `mobile-settings.png`, `mobile-profile.png`.
Desktop "Workspace Settings" has a left list: **Profile, Account, Notifications, Appearance, Integrations, Security**. Build them like this:
- **Profile:** avatar (Upload New, Remove; images up to 5 MB, crop to square), full name, email (read only), timezone (dropdown; default from the device), language dropdown, **Save Settings**.
- **Account:** change email is not in the first release; **Delete account** (needs password, with the admin-transfer rule from the backend), **Sign out**.
- **Notifications:** switches for push (mobile), in-app sound/flash, and types (assignments, comments, mentions, deadlines, chat). Stored in the local `kv` table and `profiles` later; first release stores locally and respects them when showing local notifications.
- **Appearance:** Theme (Light / Dark / System) and Language (English, Español, Français, 中文, 한국어).
- **Integrations:** hide this tab in the first release (nothing is defined for it). Leave a TODO in the task file.
- **Security:** change password (current + new), "Sign out on all devices".
- **Workspace** (new section, team workspaces only): rename, Members, Invite codes, leave, delete (admin).
- **Sync status** (new section): connection state, last sync time, pending and failed items with Retry and Discard.
- Mobile: Profile tab shows avatar, name, email, current workspace and a list (Team, Documents, Analytics, Notifications, Sync status, Sign out); Settings tab holds the same sections as a list.

### 10.14 Keyboard shortcuts (Windows)
Ctrl+K search, Ctrl+N new task, Ctrl+Enter send message or save form, Esc close dialog or search, Ctrl+1 to Ctrl+8 jump to sidebar pages.

---

## 11. Realtime

Free-tier rule: use **one Realtime channel per workspace** that carries all the changes below, not one channel per table per screen, and throttle presence updates to once every 30 seconds. Use `supabase.channel(...)` subscriptions, opened when the app is in the foreground and online, closed on sign-out. RLS decides what arrives.

| Subscription | Purpose |
|---|---|
| `messages` inserts/updates where `channel_id` is one of the user's channels | Live chat |
| `notifications` inserts where `user_id = me` | Live notifications, local notification on Windows and on Android while the app is open |
| `tasks` and `task_comments` changes in the current workspace | Live updates on lists and task detail |
| `channel_members` changes for me | New channels and DMs appear |
| `workspace_members` changes in the current workspace | Team page updates |
| Presence on `workspace:{id}` | Online, away and typing |

Reconnect handling: when the connection drops and returns, run a sync pull and re-fetch the last messages of the open channel so nothing is missed. Show "Reconnecting..." in the banner while it is down.

---

## 12. Loading, empty and offline states

No screen may ever show fake content to avoid looking empty. Use these states:

| State | What to show |
|---|---|
| Loading first time | Skeleton placeholders shaped like the content (not a spinner over a blank page) |
| Loading with cached data | Show the cached data immediately, and a thin refresh indicator on top |
| Empty | `EmptyState` with an icon, a short sentence and a clear action (for example "No tasks yet. Create your first task." with a **Create Task** button) |
| Error | `ErrorState` with the specific message (section 13) and a **Try again** button |
| Offline | Data from the local cache plus the offline banner (section 13.3) |

Empty texts to write per screen (all localized): tasks ("No tasks yet"), today ("Nothing due today"), overdue ("No overdue tasks. Nice work"), calendar day ("No events on this day"), chat list ("No conversations yet"), channel ("Be the first to say something"), documents ("No documents yet. Upload a file or write a document"), notifications ("You're all caught up"), search ("No results for "{query}""), team (only yourself: "Invite people with a code to start collaborating"), analytics ("Complete some tasks to see your statistics").

---

## 13. Error handling and messages (owner requirement)

Goal: when something does not work, the user must be told **what** happened and **why**, in their language, and what they can do. The important split: **internet problem**, **server problem**, **permission problem**, **the user's input**, or **a bug**.

### 13.1 Failure types (`app_failure.dart`)

```dart
sealed class AppFailure {
  final String? requestId;     // from the server, shown under "Details" for support
  const AppFailure([this.requestId]);
}
class NoInternet extends AppFailure {}          // device offline or no internet at all
class ServerUnreachable extends AppFailure {}   // internet works, PlanPal server does not
class ServerWaking extends AppFailure {}        // first slow request on the free tier
class RequestTimeout extends AppFailure {}
class SessionExpired extends AppFailure {}
class Forbidden extends AppFailure {}
class NotFound extends AppFailure {}
class ValidationFailed extends AppFailure { final Map<String,String> fields; ... }
class RateLimited extends AppFailure {}
class FileTooLarge extends AppFailure {}
class FileTypeNotAllowed extends AppFailure {}
class InvalidInviteCode extends AppFailure { final String reason; ... } // invalid|expired|revoked|used_up|already_member
class LastAdmin extends AppFailure {}
class WrongCredentials extends AppFailure {}
class ServerError extends AppFailure {}         // 500 and 502
class UnknownFailure extends AppFailure {}
```

### 13.2 How a failure is decided (`api_error_mapper.dart`)

1. Request threw a socket/DNS error or never got a response:
   - Ask `ConnectivityService`. `noNetwork` or `noInternet` gives `NoInternet`. `serverUnreachable` gives `ServerUnreachable`.
2. Request timed out: if it is the first request after a long idle period or the health check is slow, `ServerWaking`; otherwise `RequestTimeout`.
3. Response arrived: read `error.code` from the JSON (see `02-backend.md`, section 5) and map it (`AUTH_EXPIRED` becomes `SessionExpired` after one failed refresh, `FORBIDDEN` and `NOT_A_MEMBER` become `Forbidden`, `VALIDATION_FAILED` becomes `ValidationFailed`, and so on). Keep `requestId`.
4. `503` becomes `ServerWaking` (first 90 seconds of trying) then `ServerUnreachable`.
5. Anything else becomes `UnknownFailure`.
6. Log every failure locally (in memory, last 100) for the Sync status screen; do not send personal data anywhere.

### 13.3 Where errors are shown

| Situation | Component |
|---|---|
| Device offline or server unreachable while using the app | **Connectivity banner** at the top of the screen (mobile: below the header; desktop: above the content). Yellow for offline ("You're offline..."), red for server unreachable. It disappears by itself when back online and briefly shows a green "Back online. Syncing..." |
| A screen cannot load its data and has no cache | Full-area **ErrorState** with message + **Try again** |
| A screen has cached data but refresh failed | Small banner "Couldn't refresh: {message}" and keep the cached data |
| An action failed (save, send, delete) | **Snackbar/toast** with the message and a **Retry** action where it makes sense |
| A field is wrong | Red text under the field |
| Something needs a decision (delete, discard failed item) | **Dialog** |
| Queued offline work | Small "Waiting to sync (3)" chip; tap opens Sync status |
| A queued action was rejected by the server | Notification-style item in Sync status and a snackbar the next time the app is opened: "One change could not be saved: {reason}" |

A **"Details"** link under any error shows the technical line: `code`, HTTP status and `requestId` (for example `Code: FORBIDDEN · Ref: b3c1...`), with a **Copy** button. This helps the owner find the cause in the server logs.

### 13.4 Messages in all five languages

Put these in the ARB files (key name in the first column). `{ }` are placeholders.

| Key | English | Español | Français | 中文 | 한국어 |
|---|---|---|---|---|---|
| `errNoInternet` | No internet connection. Check your Wi-Fi or mobile data and try again. | Sin conexión a internet. Revisa tu Wi-Fi o datos móviles e inténtalo de nuevo. | Pas de connexion internet. Vérifiez votre Wi-Fi ou vos données mobiles, puis réessayez. | 没有网络连接。请检查 Wi-Fi 或移动数据后重试。 | 인터넷에 연결되어 있지 않습니다. Wi-Fi 또는 모바일 데이터를 확인한 후 다시 시도하세요. |
| `bannerOffline` | You're offline. Your changes are saved on this device and will sync when you're back online. | Estás sin conexión. Tus cambios se guardan en este dispositivo y se sincronizarán cuando vuelvas a estar en línea. | Vous êtes hors ligne. Vos modifications sont enregistrées sur cet appareil et seront synchronisées au retour de la connexion. | 你目前处于离线状态。更改已保存在此设备上，恢复网络后会自动同步。 | 오프라인 상태입니다. 변경 사항은 이 기기에 저장되며 온라인이 되면 동기화됩니다. |
| `bannerBackOnline` | Back online. Syncing... | De nuevo en línea. Sincronizando... | De nouveau en ligne. Synchronisation... | 已恢复网络，正在同步…… | 다시 온라인입니다. 동기화하는 중... |
| `errServerUnreachable` | We can't reach the PlanPal server right now. Your internet works, so the problem is on our side. Please try again in a moment. | No podemos conectar con el servidor de PlanPal en este momento. Tu internet funciona, así que el problema es de nuestro lado. Inténtalo de nuevo en unos instantes. | Impossible de joindre le serveur PlanPal pour le moment. Votre connexion fonctionne, le problème vient donc de notre côté. Veuillez réessayer dans un instant. | 目前无法连接到 PlanPal 服务器。你的网络正常，问题出在我们这边。请稍后重试。 | 지금은 PlanPal 서버에 연결할 수 없습니다. 인터넷은 정상이므로 서버 쪽 문제입니다. 잠시 후 다시 시도하세요. |
| `errServerWaking` | The server is waking up. This can take up to a minute the first time. Please wait... | El servidor se está iniciando. La primera vez puede tardar hasta un minuto. Espera un momento... | Le serveur démarre. Cela peut prendre jusqu'à une minute la première fois. Veuillez patienter... | 服务器正在启动，首次可能需要长达一分钟，请稍候…… | 서버를 시작하는 중입니다. 처음에는 최대 1분 정도 걸릴 수 있습니다. 잠시만 기다려 주세요... |
| `errTimeout` | The request took too long. Check your connection and try again. | La solicitud tardó demasiado. Revisa tu conexión e inténtalo de nuevo. | La requête a pris trop de temps. Vérifiez votre connexion et réessayez. | 请求超时。请检查网络连接后重试。 | 요청 시간이 초과되었습니다. 연결을 확인한 후 다시 시도하세요. |
| `errServer` | Something went wrong on our server. It's not your fault. Please try again. | Algo salió mal en nuestro servidor. No es tu culpa. Inténtalo de nuevo. | Une erreur est survenue sur notre serveur. Ce n'est pas de votre faute. Veuillez réessayer. | 我们的服务器出了问题，不是你的错。请重试。 | 서버에서 문제가 발생했습니다. 사용자의 잘못이 아닙니다. 다시 시도하세요. |
| `errSessionExpired` | Your session has expired. Please sign in again. | Tu sesión ha caducado. Inicia sesión de nuevo. | Votre session a expiré. Veuillez vous reconnecter. | 登录已过期，请重新登录。 | 세션이 만료되었습니다. 다시 로그인하세요. |
| `errForbidden` | You don't have permission to do this in this workspace. | No tienes permiso para hacer esto en este espacio de trabajo. | Vous n'avez pas l'autorisation d'effectuer cette action dans cet espace de travail. | 你在此工作区没有执行此操作的权限。 | 이 워크스페이스에서 이 작업을 수행할 권한이 없습니다. |
| `errNotFound` | This item no longer exists or you can't access it. | Este elemento ya no existe o no tienes acceso. | Cet élément n'existe plus ou vous n'y avez pas accès. | 该项目已不存在，或你无权访问。 | 이 항목이 더 이상 존재하지 않거나 접근 권한이 없습니다. |
| `errRateLimited` | Too many attempts. Please wait a moment and try again. | Demasiados intentos. Espera un momento e inténtalo de nuevo. | Trop de tentatives. Veuillez patienter un instant puis réessayer. | 尝试次数过多，请稍等片刻后重试。 | 시도 횟수가 너무 많습니다. 잠시 후 다시 시도하세요. |
| `errFileTooLarge` | This file is too large. The maximum size is 25 MB. | Este archivo es demasiado grande. El tamaño máximo es 25 MB. | Ce fichier est trop volumineux. La taille maximale est de 25 Mo. | 文件过大，最大允许 25 MB。 | 파일이 너무 큽니다. 최대 크기는 25MB입니다. |
| `errInviteInvalid` | That invite code isn't valid. Check it and try again. | Ese código de invitación no es válido. Revísalo e inténtalo de nuevo. | Ce code d'invitation n'est pas valide. Vérifiez-le et réessayez. | 该邀请码无效，请检查后重试。 | 초대 코드가 올바르지 않습니다. 확인한 후 다시 시도하세요. |
| `errWrongCredentials` | Incorrect email or password. | Correo o contraseña incorrectos. | E-mail ou mot de passe incorrect. | 邮箱或密码不正确。 | 이메일 또는 비밀번호가 올바르지 않습니다. |
| `errUnknown` | Something unexpected happened. Please try again. | Ocurrió algo inesperado. Inténtalo de nuevo. | Un problème inattendu est survenu. Veuillez réessayer. | 发生了意外错误，请重试。 | 예상치 못한 문제가 발생했습니다. 다시 시도하세요. |

Also write (same five languages, same style) the remaining messages needed by the features: invite code expired / revoked / used up / already a member, file type not allowed, last admin cannot leave, cannot delete a non-empty folder, password too short, passwords do not match, email already registered, email not confirmed, attachments and uploads need internet, chat needs a team workspace, "one change could not be saved: {reason}".

### 13.5 Rules
- Never show a raw exception, stack trace, SQL or English-only server text to the user. Always map to a localized message.
- Never show only "Error". Always say what happened and what to do next.
- Never blame the user for server or internet problems, and never blame the internet for server problems. Use the connectivity state to choose.
- Never lose the user's typed input when an error happens. Keep the form filled.
- Errors during background sync are quiet (they only show in the sync chip and Sync status), unless the change was permanently rejected.
- Disable buttons while an action runs and show a loading state, so users cannot double-submit.

---

## 14. Localization

- Flutter `gen-l10n`, `l10n.yaml` with `arb-dir: lib/core/l10n`, template `app_en.arb`. Locales: `en` (default and fallback), `es`, `fr`, `zh` (Simplified), `ko`.
- Language choice: saved locally and in `profiles.language`. On first launch, follow the device language if supported, otherwise English. Changing it in Settings applies immediately without restarting.
- Use ICU messages for plurals and placeholders (`{count, plural, one{1 task} other{{count} tasks}}`), and `intl` for dates, times and numbers in the chosen locale. Use the workspace/user timezone from the profile for displaying times.
- Layout must survive long text (French and Spanish are longer): no fixed-width buttons, allow wrapping, use ellipsis only where truncation is acceptable.
- Test each language on a mobile and a desktop screenshot for overflow.
- Every new string is added to all five ARB files in the same change. Missing keys must fail the build (`flutter gen-l10n` with `nullable-getter: false` and a CI check).

---

## 15. Push and local notifications

- **Android:** FCM. On login: ask permission (Android 13+), get the token, `POST /devices`. Refresh on `onTokenRefresh`. Tapping a push opens the correct screen using the `data` fields. While the app is open, incoming Realtime notifications show as local notifications instead of duplicate pushes.
- **Windows:** local notifications only, shown while the app is running (from Realtime). Optional later: keep running in the system tray.
- **Badge/unread count** on the bell comes from the local `notifications` table.

---

## 16. Testing (required)

- **Unit tests:** repositories, failure mapper (each backend code and each network case), sync engine (outbox ordering, retry, permanent failure), date and range helpers.
- **Widget tests:** each shared component in light and dark, each screen's loading, empty, error and offline states, and layout at widths 375, 700 and 1280.
- **Integration tests:** login, create task offline then reconnect and confirm it appears on the server, send a chat message offline then reconnect, join with a code, upload a file.
- **Localization test:** every key exists in all five languages.
- **Manual device checks:** Samsung Galaxy A14 (or similar low-end Android) for performance; a Windows 10/11 laptop at 1366x768 and at 1920x1080; turn Wi-Fi off and on during use; airplane mode; Render cold start (wait 20 minutes, then open the app).
- Run `flutter analyze` and `flutter test` in CI on every push.

---

## 17. Accessibility and quality

- Minimum tap target 48x48 on mobile.
- Every icon-only button has a tooltip / semantic label (localized).
- Text scales with the system font size without breaking layouts.
- Full keyboard navigation on desktop (tab order, focus rings, Enter and Esc behavior).
- Color is never the only signal (priority and status chips also carry text).
- Support system reduced motion: keep animations short (under 250 ms) and simple.

---

## 18. Frontend checklist for the stages file

See `04-task-stages.md`. Each stage lists its Flutter tasks next to its backend and database tasks.
