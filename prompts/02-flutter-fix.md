# PROMPT 02: Fix the Flutter app (`Planpal`)

**Start only after the owner has said the backend is accepted.** Read `KIRO-START-HERE.md` first and obey its six rules. Then fix the Flutter app so it matches `docs/03-frontend.md` and the images in `design/`.

## What I found in your first build (so you know what to fix)

1. The app is structured like a Todoist-style app (`/inbox`, `/today`, `/projects`), not like PlanPal. There is no bottom tab bar, no navigation rail and no desktop sidebar.
2. Missing screens: Home dashboard, Calendar, Chat, Documents, Analytics page (the existing `analytics` feature only tracks events), Team directory, Notifications with tabs, workspace switcher, members screen, invite codes screen, and most Settings sections.
3. `app.dart` is fixed to `ThemeMode.system` with a TODO. There is no Light, Dark, System choice.
4. Localization is mostly empty: English has 159 keys but Spanish, French, Korean and Chinese have only 41 each. About 320 user-facing English strings are hard-coded inside screens. There are no error or connectivity messages in any language.
5. Duplicates: two connectivity services (`core/connectivity` and `core/network`) and two Drift databases (`core/db` and `core/database`).
6. `window_manager` is in `pubspec.yaml` but is not used (no minimum size, no remembered window, no shortcuts).
7. `notification_providers.dart` calls Supabase directly from the presentation layer.
8. Only 4 test files exist, all about sync.
9. Several guide files (`STAGE_12_COMPLETE.md`, `FLUTTER_SETUP_COMPLETE.md`, search guides) claim completion that is not true.

## Your job, in this order

### Step 0: Clean up
- Move into `_parked/` (do not delete): the projects, reminders, activities and labels-as-projects features, the `/inbox`, `/today`, `/projects` routes and screens, and any feature not in `docs/03-frontend.md`.
- Delete the stale `*_COMPLETE.md` and guide files. Keep one `README.md`.
- Keep **one** Drift database and **one** connectivity service (keep whichever the sync code uses), remove the other, fix the imports.
- Stop adding packages that the docs do not list.

### Step 1: Foundation (Stage 3)
- Project structure from `docs/03-frontend.md` section 2. Design tokens and light and dark `ThemeData` using the colors in section 4.1, bundled Inter font.
- Theme provider with **Light, Dark, System**, default System, saved locally and in `profiles.theme`, live switching.
- Localization: bring all five ARB files (en, es, fr, zh, ko) to the same keys. Move every user-facing string into ARB. Add all error, banner and status messages from section 13.4 in all five languages. Add a CI check that fails if any key is missing in any language. Language switching applies instantly.
- `adaptive_scaffold`: bottom tabs under 600 px, rail 600 to 899, dark sidebar at 900 px and above with the top bar (workspace switcher, search with Ctrl+K, bell, avatar and real role). Layout depends on width, not platform.
- go_router with the route table in section 7 and guards.
- Shared components from section 6.
- Error handling: `AppFailure` types, `api_error_mapper`, the four connectivity states with a real reachability check (health call), the connectivity banner (offline, server unreachable, waking, back online), the "Details" link with code and request id and a Copy button. The user must always be able to tell an internet problem from a server problem.
- Windows: `window_manager` (minimum 900x600, remember size and position).
- Tests: failure mapper, connectivity states, localization key parity, shell at widths 375, 700, 1280 in light and dark.
- Stop. Report. Wait.

### Step 2: Authentication and workspaces (Stages 4 and 5)
- Keep the working login, signup, 6-digit verify and reset screens and Google login. Match `design/` (no Microsoft button; "Create Account" wording; Terms checkbox).
- Google on Windows through the browser with a loopback redirect.
- After login: `GET /me`, apply saved theme and language, first sync, onboarding "Continue with Personal or create/join a team".
- Workspace switcher, create workspace, join with code (specific messages for each code error), members screen, invite codes screen, Personal workspace rules, role-based UI.
- Stop. Report after each stage. Wait.

### Step 3: Offline engine (Stage 6)
- Every entity uses client-generated UUIDs. Drift is what screens watch. Outbox with ordered replay and exponential backoff. Pull with `GET /workspaces/:id/sync?since=` (every 5 minutes while Realtime is connected, 2 minutes otherwise).
- One Sync status screen (merge the existing `sync_*` screens). "Waiting to sync (n)" chip.
- Stop. Report. Wait.

### Step 4: Feature stages, one at a time
Tasks (7), Calendar (8), Files and Documents (9), Chat (10), Notifications and push (11), Global search (12), Analytics (13), Home (14), Team and Settings (15), Windows polish (16). For each: build the screens from the matching image in `design/`, with real data and loading, empty, error and offline states.
- Real-time uses **Supabase Realtime**, one channel per workspace, presence updates at most every 30 seconds. Reconnect recovery pulls missed data.
- Compress images before upload (max 1600 px, quality 80).
- Notifications on Android: FCM token registration to `/devices`, push tap opens the right screen. Windows: local notifications from Realtime.
- Screens never call Supabase directly (only repositories do). Remove the direct call in `notification_providers.dart`.
- Apply the design corrections in `docs/00-overview.md` section 7 (Team page layout, charts, no plan or upgrade screens).
- Stop and report after **each** stage. Wait for the owner's reply.

### Step 5: Final quality (Stage 17, Flutter part)
- Tests: failure mapper, localization parity, shell at three widths, offline create then reconnect, chat offline send, screen states. `flutter analyze` and `flutter test` must pass. Show the output.
- Manual checklist: Wi-Fi off and on, airplane mode, Render cold start, Samsung Galaxy A14, Windows at 1366x768 and 1920x1080.
- Update the Flutter tasks in `docs/04-task-stages.md` honestly. Final report.

## Reminders
- Do not add anything that is not in `docs/`. Write doubts in `QUESTIONS.md`.
- No mock data. No hard-coded user-facing strings.
- Do not claim a task is done without passing test output.
- Free-tier rules are mandatory (see `KIRO-START-HERE.md` Rule 4).
