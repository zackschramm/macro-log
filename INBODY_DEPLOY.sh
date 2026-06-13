#!/usr/bin/env bash
# InBody feature — commit, push, deploy, build.
# Run from inside the MacroLog repo:  bash INBODY_DEPLOY.sh
#
# What this does:
#   1. Commits the prior WIP on main (HealthKit/RevenueCat/etc.) in one commit
#   2. Branches feat/inbody-import
#   3. Commits the new InBody files
#   4. Pushes the branch
#   5. Prints SQL + edge function deploy commands
#   6. Optionally kicks off `eas build`

set -e

cd "$(dirname "$0")"

# Make sure we're at the repo root
if [ ! -f app.json ]; then
  echo "❌ Run this from the MacroLog repo root."
  exit 1
fi

echo "→ Current branch: $(git branch --show-current)"
echo "→ Status:"
git status --short

read -p $'\nContinue? (y/N) ' yn
[[ "$yn" != "y" && "$yn" != "Y" ]] && { echo "Aborted."; exit 0; }

# 1. Commit prior WIP on main (excluding the new InBody files, which we'll commit on the branch)
echo ""
echo "→ Step 1: commit pre-existing WIP on main"
git add -u   # tracked changes
git add .claude/settings.local.json constants/purchases.ts constants/sportProfiles.ts \
        screens/PaywallScreen.tsx screens/RecoveryScreen.tsx 2>/dev/null || true

# Stage everything EXCEPT the new InBody files (we want those on a branch)
git reset -- screens/InBodySection.tsx supabase/migrations/20260601_inbody_logs.sql INBODY_DEPLOY.sh 2>/dev/null || true

if ! git diff --cached --quiet; then
  git commit -m "feat: HealthKit recovery, RevenueCat paywall, sport profiles, profile refactor

- HealthKit hook expanded for HRV/sleep/steps/heart rate; add RecoveryScreen
- iOS Info.plist permissions for Health share/update, photos, notifications
- RevenueCat: purchases.ts, PaywallScreen, gating on Coach/Workout/MealPlan
- Sport profiles + expanded program library
- ProfileScreen rebuild
- Slim LogScreen by moving shared logic out
- Misc: BarcodeScanner, manifest, eas.json, deps"
else
  echo "  (no pre-existing changes to commit)"
fi

# 2. Branch
echo ""
echo "→ Step 2: branch feat/inbody-import"
git checkout -b feat/inbody-import 2>/dev/null || git checkout feat/inbody-import

# 3. Commit the InBody files
echo ""
echo "→ Step 3: commit InBody feature"
# Note: ProgressScreen.tsx was already modified in place by the assistant — it'll be picked up here.
git add screens/InBodySection.tsx screens/ProgressScreen.tsx supabase/migrations/20260601_inbody_logs.sql
git commit -m "feat(stats): InBody import + tracking

- New screens/InBodySection.tsx (scan via ai-proxy vision, manual entry, charts, segmental, history)
- Migration: inbody_logs table with RLS + unique constraint for upsert
- Wired into ProgressScreen (Stats tab) above HISTORY
- Pro gating: visceral fat, BMR, InBody Score chart, segmental view"

# 4. Push
echo ""
echo "→ Step 4: push branch"
git push -u origin feat/inbody-import

# 5. Print deploy steps (don't run automatically)
cat <<'EOF'

────────────────────────────────────────────────────────────
✅ Code is committed and pushed.

Next steps (run these yourself):

1. Apply the database migration. Either:
   a) Paste supabase/migrations/20260601_inbody_logs.sql into the Supabase SQL editor
      (project zbcxuffgmjuqarapfdwb), OR
   b) If you've initialized supabase migrations:
        supabase db push

2. No edge function change is needed — InBodySection.tsx uses the existing
   ai-proxy as a generic Claude vision call.

3. Smoke test:
     npx expo start --dev-client
     # Open Fuelog → Stats tab → scroll to "BODY COMPOSITION · INBODY"
     # Tap "📷  Scan InBody" → pick a photo of an InBody result sheet

4. EAS build (production):
     eas build --platform ios --profile production
     # or both:
     eas build --platform all --profile production

5. Submit:
     eas submit --platform ios --latest
     eas submit --platform android --latest

────────────────────────────────────────────────────────────
EOF
