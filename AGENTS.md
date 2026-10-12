# PlanPal rules (always active)

Put a copy of this file named `AGENTS.md` in the ROOT of BOTH repos (Flutter app and backend). Antigravity reads it on every task.

1. Spec = `docs/00-overview.md` to `docs/04-task-stages.md` plus the PNGs in `design/`. If code and spec disagree, the spec wins. If the spec is silent or unclear, ASK, do not guess.
2. Do only what the current prompt lists. No extra features, renames, refactors, or package upgrades that the prompt does not name. Ideas go under SUGGESTIONS in your report.
3. Create no status, summary, log, "check" or SQL files in the repo. Run commands in the terminal and paste the real output in your chat report.
4. Never write "done", "fixed", "working" unless you ran the command in this session and pasted its output. Otherwise write NOT RUN.
5. Commit to git BEFORE starting each prompt (`git add -A && git commit -m "before prompt N"`), so any step can be undone.
6. No mock, sample, dummy or invented data in `lib/` or `src/`. Show real data, or a proper empty state.
7. One definition per thing: one provider name = one definition in the whole project; one `PlanPalButton`, one `PlanPalTextField`. Reuse, do not duplicate.
8. Every user-visible string goes in the ARB files (all 5 languages), never hard-coded in Dart.
9. Never put the Supabase service_role key, Resend key or Firebase server credentials in the Flutter app.
10. Do not touch `android/`, `windows/`, Gradle files or `pubspec.yaml` unless the prompt says so.
11. Work in the order of the prompt. After each numbered step run `flutter analyze` (app) or `npm run lint` (backend) and paste the result. Stop at the end of the prompt and report. Do not start the next prompt on your own.
12. Report format at the end of every prompt: Files changed / created / deleted, command outputs (real), NOT RUN / NOT DONE, SUGGESTIONS.
