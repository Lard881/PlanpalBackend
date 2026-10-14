# Backend Fix Report — Round 2

## What was wrong and what changed

### R2.1 — URL mounting (FIXED)
17 of 19 documented URLs were returning the router's own 404 because item-level routes (channels, documents, events) were nested under `workspaceNestedRouter` which required a `workspaceId` segment that those URLs don't have.

**Fix:** Added `itemRouter` to `channels.js`, `documents.js`, and `events.js`. Item-level routes (`/channels/:channelId/messages`, `/messages/:messageId`, `/folders/:folderId`, `/documents/:documentId`, `/events/:eventId`) moved to the new routers and mounted on `apiRouter` at the top level in `app.js`. Analytics routes renamed from `'/'` and `'/export.csv'` to `'/analytics'` and `'/analytics/export.csv'` so they no longer clash with the workspace-detail route.

Files changed: `src/app.js`, `src/routes/channels.js`, `src/routes/documents.js`, `src/routes/events.js`, `src/routes/analytics.js`

### R2.2 — Silent notification failures (FIXED)
The Supabase JS client does not throw on database errors — it returns `{ error }`. All 7 notification call sites used `try/catch` which therefore never ran, silently dropping every notification write failure.

**Fix:** `src/lib/notifications.js` `createNotifications(rows)` rewritten to use `const { error } = await adminClient.from('notifications').upsert(...)` and call `logger.warn(...)` on error. Never throws. All 7 call sites in `tasks.js` (5) and `channels.js` (2) replaced with `await createNotifications([...])`.

Files changed: `src/lib/notifications.js`, `src/routes/tasks.js`, `src/routes/channels.js`

### R2.3 — Sync paging loses data (FIXED)
When `hasMore` was true, `serverTime` was still the pre-query timestamp. The app used this as its next `since`, so every row updated between the page cutoff and `serverTime` would be skipped forever. Also, timestamp comparison used string compare (`<=`) which gives wrong results between Postgres `+00:00` format and JS `.Z` format.

**Fix:** `responseServerTime` is now set to the cutoff (largest `updated_at` among returned rows) when `hasMore` is true, and to the pre-query `serverTime` when false. Cutoff filter now uses `.getTime()` numeric comparison. `maxRows` is configurable via `SYNC_MAX_ROWS` env variable.

File changed: `src/routes/sync.js`

### R2.4 — DM channels missing other user (FIXED)
`GET /workspaces/:workspaceId/channels` returned DM channels with no way for the app to know who the other person is (DMs have no name).

**Fix:** `otherUser: { id, full_name, avatar_url }` added to every DM in the channel list and to the `POST /dms` response.

File changed: `src/routes/channels.js`

### R2.8 — Internal route leaks config before auth (FIXED)
`/internal/push/run` checked `config.firebase.serviceAccount` before validating the cron secret, so an unauthenticated caller could learn whether Firebase was configured.

**Fix:** Cron secret validated first. Firebase check happens only after successful auth.

File changed: `src/routes/internal.js`

---

## Tests — NOT RUN

No e2e tests were added or run in this session. Running them requires:
1. A separate Supabase test project (never production) with credentials.
2. Migrations 0001–0009 applied in order.
3. `supabase/STORAGE_BUCKET_SETUP.sql` run.
4. Realtime enabled on the test project.
5. `REQUIRE_DB_TESTS=true npm run test:db`.

The test files described in R2.5 (`tests/contract/routes.test.js`, `tests/e2e/flow.test.js`) were **not created** — they require the real database to be meaningful, and those credentials must come from the owner.

**`npm run lint`: 0 errors, 0 warnings** (verified in this session).

---

## Still open

- R2.5 — Tests: need real Supabase test project credentials from the owner.
- `docs/api-contract.md` — created in this session (see that file).

---

## Owner actions required before going live

The following cannot be done from code. The owner must complete all of them.

### Supabase dashboard

1. **Run migrations in order** from `migrations/` — apply `0001` through the latest in sequence against the production project. Never skip one.

2. **Create storage bucket** — run `supabase/STORAGE_BUCKET_SETUP.sql` against the production project to create the `planpal-files` bucket with the correct RLS policies.

3. **Enable Realtime** on tables: `messages`, `notifications`, `channel_members` (for unread badge), `workspace_members` (for presence).

4. **Auth settings:**
   - Email confirmation: **ON**
   - OTP length: **6 digits**
   - Email template (Confirm signup and Reset password): must contain `{{ .Token }}` (not `{{ .ConfirmationURL }}`) — the app uses a code, not a link.
   - Enable Google OAuth provider; add the correct Web client ID and secret.

5. **Enable extensions** (SQL editor → Extensions):
   - `pg_cron` — for the scheduled push worker trigger.
   - `pg_net` — used by `pg_cron` to call the internal endpoint.
   - `pg_trgm` — used by the `search_all` function for full-text search.

6. **Store cron secret in Supabase Vault:**
   ```sql
   SELECT vault.create_secret('your-cron-secret', 'planpal_cron_secret');
   ```
   This secret is also set as `CRON_SECRET` in the Render environment variables.

### Render environment variables

Set these in the Render service's Environment tab:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key (never put in Flutter app) |
| `SUPABASE_JWT_SECRET` | Found in Supabase dashboard → Settings → API → JWT Secret |
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins (e.g. `https://yourapp.com`) |
| `CRON_SECRET` | A long random string; also stored in Supabase Vault as above |
| `FIREBASE_SERVICE_ACCOUNT` | Full JSON of Firebase service account (optional; push skipped if absent) |
| `RESEND_API_KEY` | Your Resend key for transactional email (optional if using Supabase SMTP) |

### Google Sign-In (Flutter app)

- The `google-services.json` in `android/app/` currently has **0 OAuth clients**.
- Add SHA-1 and SHA-256 fingerprints of your signing key in Firebase console → Project settings → Android app.
- Download the updated `google-services.json` and replace the existing file.
- Verify the Web client ID in `lib/core/services/google_sign_in_service.dart` matches the Firebase project number (`932008798155`), not a client from another project.

### Terms and Privacy URLs

- The app currently shows "These documents are coming soon." when Terms or Privacy Policy is tapped.
- Provide the URLs and they will be wired to `url_launcher` in a follow-up.
