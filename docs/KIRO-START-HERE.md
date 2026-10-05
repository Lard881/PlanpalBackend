# KIRO: START HERE

You are fixing and finishing the **PlanPal** app (Flutter app for Android and Windows, Node.js + Express backend, Supabase database). A first build already exists. It does not match the plan. This package contains the plan and your instructions.

## What is in this package

| Path | What it is |
|---|---|
| `KIRO-START-HERE.md` | This file. The rules. Read it fully before doing anything. |
| `prompts/01-backend-fix.md` | Your backend job. **Do this first.** |
| `prompts/02-flutter-fix.md` | Your Flutter job. **Do not start until the owner says so.** |
| `docs/00-overview.md` | Product decisions, rules, architecture, free-tier rules |
| `docs/01-database.md` | Complete database (SQL) |
| `docs/02-backend.md` | Complete API |
| `docs/03-frontend.md` | Complete Flutter app plan |
| `docs/04-task-stages.md` | The task tracker (stages 0 to 17) |
| `design/` | Figma screens (the visual source of truth) |

---

## RULE 1: SCOPE LOCK (the most important rule)

**Stop adding things. Build only what is written in `docs/`.**

- If it is not in `docs/`, do not build it. No extra features, endpoints, tables, screens, packages, languages, settings or "nice improvements".
- The first build added many things nobody asked for (projects, custom fields, task templates, time tracking, saved views, general data export, 15 languages, a custom WebSocket server, activity-feed extras, a Todoist-style inbox). **Do not continue them.** Move their files into a folder named `_parked/` (do not delete them) and remove their routes, screens, providers and migrations from the running app.
- If you think something is missing or should be different, **do not decide alone.** Write it in a file `QUESTIONS.md` with the reason and keep going on the documented work. The owner decides.
- If the docs and the code disagree, **the docs win.** Change the code.
- If two parts of the docs seem to disagree, ask in `QUESTIONS.md` and follow `docs/00-overview.md`.

## RULE 2: Honesty about progress

- A task is done only when it is implemented, tested, and you can show the passing test output.
- Never write "assumed complete", "100% complete" or similar. The first build did this and it was wrong.
- Delete the old status files (`PROJECT_STATUS.md`, `STAGE_*_SUMMARY.md`, `*_COMPLETE.md`, `TESTING_GUIDE_*.md`, extra API guides). The only progress record is `docs/04-task-stages.md`. Tick `[x]` only for finished and tested tasks.

## RULE 3: No mock data

No fake users, fake tasks, sample lists or placeholder numbers in the app or the backend. Names such as "Alex Johnson" in the design images are Figma placeholder text. Every screen reads real data. Empty screens show real empty states.

## RULE 4: Free-tier rules are mandatory

The owner uses free plans for everything. Read `docs/00-overview.md` section 8 fully. In short:

1. **Render free server sleeps after about 15 minutes.** Nothing important may depend on a timer inside Express. Time-based work (reminders, cleanup) runs in Supabase `pg_cron`.
2. **Notifications must work while the server is asleep.** The database (`pg_cron` + `pg_net`) calls the secured endpoint `POST /internal/push/run`, which wakes the server and sends the pushes. Pushes for things that happen inside a request (assignments, comments, chat) are sent immediately from that request. Details: `docs/02-backend.md` section 6.15 and `docs/01-database.md` section 9.
3. Two UptimeRobot monitors (`/health` and `/health/db`) keep Render awake and Supabase active.
4. **Real-time uses Supabase Realtime, not a custom WebSocket server.** Use one Realtime channel per workspace and throttle presence.
5. Compress images before upload. Paginate every list. Sync with `since`. Weekly cleanup job. Email (Resend) only for sign-up and password-reset codes.
6. Firebase Cloud Messaging for Android push. Windows uses local notifications only.
7. No second Render service. No local disk storage. Log to stdout.

## RULE 5: Work in order, one stage at a time

1. Follow `docs/04-task-stages.md` in stage order.
2. Do not start a stage before the previous stage's "Definition of done" is fully true.
3. After **each stage**, stop and send the owner a report in exactly this format, then wait for the owner's reply:

```
STAGE REPORT: Stage N, <name>
Finished (task ids and file names):
Not finished (task ids and the reason):
Tests run (exact command and its output):
Things I need from the owner (keys, URLs, decisions):
Questions added to QUESTIONS.md:
Anything I changed that is not in the docs (should be empty):
```

## RULE 6: Security

- Never put the Supabase service-role key, Firebase service account, Resend key or `CRON_SECRET` in the Flutter app or in git.
- Use the Supabase admin client only in the cases listed in `docs/02-backend.md` section 3.1, and always after an explicit permission check.
- Row Level Security stays on for every table.

---

## Order of work

1. Read this file and all five documents in `docs/`.
2. Open `prompts/01-backend-fix.md` and do it, stage by stage.
3. When the backend is finished and tested, **stop and report.** Wait.
4. When the owner says "go", open `prompts/02-flutter-fix.md` and do it.

## Things only the owner can provide (ask, never invent)

Supabase project URLs and keys, Firebase project files, Google OAuth client IDs and SHA-1 keys, Resend sending domain, Terms of Service and Privacy Policy URLs, the `CRON_SECRET` value, app icon and name if different from the design.
