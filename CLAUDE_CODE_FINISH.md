# Paste into `claude` running inside MacroLog repo

You're inside the macro-log repo. The InBody feature is already committed on a local
branch `feat/inbody-import` (commit 06f2804). What's left:

1. **Push the branch.** Try:
       git push -u origin feat/inbody-import
   If it fails with "Authentication failed" or "Password authentication is not supported",
   then sort out auth:
   - If `gh` is installed: run `gh auth status`. If not logged in, run `gh auth login`
     (choose HTTPS + browser flow). Then retry the push.
   - Else if `~/.ssh/id_ed25519.pub` or `id_rsa.pub` exists and is on GitHub: switch the
     remote with `git remote set-url origin git@github.com:zackschramm/macro-log.git`
     and retry.
   - Else: tell me and stop. Don't try to create a PAT yourself.

2. **Apply the Supabase migration.** The file is at
   `supabase/migrations/20260601_inbody_logs.sql`. Two ways:
   - If `supabase` CLI is logged in (`supabase projects list` works without error):
         supabase db push
   - Otherwise: print the SQL contents to stdout so I can paste it into the dashboard,
     and stop — don't try to install or log in to the supabase CLI yourself.

3. **Smoke test instructions only — don't run.** Print this to the user:
       npx expo start --dev-client
       # then: open Fuelog → Stats tab → scroll to "BODY COMPOSITION · INBODY"
       # → tap "📷 Scan InBody" → pick an InBody result sheet photo

4. **Kick off EAS builds.** Confirm `eas` is installed and logged in:
       eas whoami
   If logged in as zackschramm, run:
       eas build --platform all --profile production --non-interactive
   If not logged in, do NOT run `eas login` automatically — tell the user and stop.

5. **TestFlight rule (hard rule from CLAUDE.md):** Do NOT add any TestFlight testers.
   `zackschramm@icloud.com` is the only individual tester allowed, and the user manages
   that manually. If the build completes and submission is suggested, only mention
   `eas submit` — do not invite testers or modify TestFlight groups.

Report back with: branch push status, migration apply status (or SQL printed),
and EAS build URLs once queued. Don't summarize what you did; just give me the
URLs and any errors.
