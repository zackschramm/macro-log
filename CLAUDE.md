# CLAUDE.md

Comprehensive reference for Claude Code sessions in this repository. Read this before touching any code.

---

## Project Overview

**Fuelog** is a React Native + Expo (TypeScript) fitness and nutrition tracking app for iOS. It covers food logging (manual, barcode, photo, voice), workout tracking, body composition, AI coaching, wearable integrations (Whoop, Oura, Garmin, Dexcom CGM), and RevenueCat-gated Pro features.

**Tech stack:** React Native 0.81.5 · Expo 54 · TypeScript (strict) · Hermes engine · Supabase (PostgreSQL + Auth + Edge Functions) · RevenueCat · Apple HealthKit

No new architecture (`newArchEnabled: false`). No lint or test scripts configured.

---

## Key Identifiers

| Key | Value |
|-----|-------|
| App name | Fuelog |
| Expo slug | `macro-log` |
| Bundle ID / Android package | `com.zackschramm.macrolog` |
| App Store ID (ASC) | `6759591771` |
| Deep link scheme | `fuelog://` |
| EAS project ID | `d47c3758-3b67-47fa-a584-9353dfd02ce0` |
| EAS owner | `zackschramm` |
| Supabase project ref | `zbcxuffgmjuqarapfdwb` |
| App Group (WidgetKit) | `group.com.zackschramm.macrolog` |

---

## Commands

```bash
# Development
npx expo start
npx expo start --ios
npx expo start --android

# EAS builds
eas build --profile development
eas build --profile preview
eas build --profile production

# Supabase edge functions (local dev)
supabase functions serve ai-proxy
supabase functions serve proactive-coach
```

---

## Architecture

### Entry Flow

```
index.ts
└─ App.tsx
   └─ SafeAreaProvider
      └─ AuthProvider (hooks/useAuth.tsx)
         └─ AppContent
            ├─ loading → ActivityIndicator
            ├─ password recovery deep link → ResetPasswordScreen
            ├─ no session → AuthScreen
            ├─ session, not onboarded → OnboardingScreen
            └─ session + onboarded →
               └─ RestTimerProvider (contexts/RestTimerContext.tsx)
                  └─ UnitsProvider (constants/units.tsx)
                     └─ MainTabs
```

**App.tsx responsibilities:**
- RevenueCat init + login/logout on auth state changes
- Deep link handling: `fuelog://reset-password`, `fuelog://invite/CODE`, `fuelog://coach`
- Referral code capture and linking on post-onboard session start
- Notification permission request + onboarding notification scheduling

### Navigation (screens/MainTabs.tsx — 7 tabs)

| Tab label | Screen | File |
|-----------|--------|------|
| Home | LogScreen | screens/LogScreen.tsx |
| Train | WorkoutScreen | screens/WorkoutScreen.tsx |
| Stats | ProgressScreen | screens/ProgressScreen.tsx |
| Coach | CoachScreen | screens/CoachScreen.tsx |
| Recover | RecoveryScreen | screens/RecoveryScreen.tsx |
| Plates | PlateCalculatorScreen | screens/PlateCalculatorScreen.tsx |
| Me | ProfileScreen | screens/ProfileScreen.tsx |

MainTabs also renders a global `RestTimer` pill overlay and `CancellationSaveModal`.

---

## Screens Reference

All 31 screens are fully implemented — no stubs or placeholders.

### Tab Screens
- **LogScreen** — Daily food log, macro rings, water tracker, voice/photo entry, streak tracking, achievements, TDEE / periodization support
- **WorkoutScreen** — Exercise logging, preset programs, rest timer, HealthKit sync, PR tracking
- **ProgressScreen** — Body measurements, progress photos, InBody import, weight/macro trend charts
- **CoachScreen** — AI chat (Claude). 3 free messages then paywall. Up to 50-message history stored in AsyncStorage
- **RecoveryScreen** — HRV, RHR, sleep, VO2 max, wearable source selection, breathwork, glucose, cycle tracking sub-sections
- **PlateCalculatorScreen** — Barbell plate calculator (lbs/kg)
- **ProfileScreen** — Settings, photo upload, macro goals, unit prefs, wearable OAuth setup, sport selection, referral code, achievement badges

### Auth / Onboarding
- **AuthScreen** — Email/password login + signup, forgot password modal
- **OnboardingScreen** — Goal, activity level, weight → macro targets calculation
- **ResetPasswordScreen** — Supabase PKCE password reset confirmation

### Feature Screens (accessible from Profile or modals)
- **FoodsScreen** — Custom food database CRUD, USDA lookup, barcode scan
- **MealPlanScreen** — AI-generated weekly meal plans (Pro), grocery list export
- **GroceryListScreen** — AI grocery lists from meal plans, interactive checklist
- **HistoryScreen** — Past macro logs by date (reverse chrono)
- **MineralsScreen** — 50+ vitamin/mineral tracker with AI analysis (Pro)
- **MicronutrientsScreen** — Core micronutrient daily tracking
- **NotificationsScreen** — Schedule macro, meal, water, workout, check-in reminders
- **PaywallScreen** — RevenueCat monthly/yearly subscription UI
- **ReferralScreen** — Referral code generation, sharing, signup tracking
- **SocialScreen** — Social feed (posts, likes, leaderboard)

### Camera / Input Modals
- **FoodPhotoScreen** — Camera or gallery → Claude Vision → macro analysis
- **VoiceLogScreen** — Voice transcription → AI food parsing → `AnalyzedItem[]`
- **BarcodeScanner** (component/modal) — Expo camera barcode → USDA FDC lookup

### Body / Health Screens
- **BodyMeasurementsScreen** — Chest, waist, hips, arms, thighs, neck with charts
- **ProgressPhotosScreen** — Photo timeline with comparison view
- **InBodySection** — InBody device scan import, segmental analysis, compare modal
- **GlucoseScreen** — CGM (Dexcom via cgm-proxy), glucose curve, time-in-range stats
- **CycleTrackingScreen** — Menstrual phases, symptom logging, phase-based guidance
- **BreathworkScreen** — Guided breathwork (Box 4-4-4-4, 4-7-8, Physiological Sigh)

### Workout Screens
- **RecipeBuilderScreen** — Multi-step recipe creation with macro totals
- **WorkoutProgramScreen** — AI-generated workout programs (goal/days/equipment)

---

## Components Reference

| Component | Purpose |
|-----------|---------|
| `MacroRing.tsx` | Animated circular progress ring for protein/carbs/fat |
| `WaterTracker.tsx` | Daily water intake logging with AsyncStorage persistence |
| `AddFoodModal.tsx` | Food entry modal: recents, favorites, barcode, recipe, create |
| `BarcodeScanner.tsx` | Expo camera barcode → USDA FDC lookup with micronutrients |
| `FoodAnalysisResults.tsx` | Displays photo/voice-analyzed items with confidence badge |
| `AchievementBadges.tsx` | Achievement grid + toast on unlock |
| `SkeletonBox.tsx` | Pulsing shimmer loading placeholder |
| `CalorieBurnModal.tsx` | TDEE display with goal adjustment (−400/0/+250 cal) |
| `CancellationSaveModal.tsx` | Global confirm-discard modal (context-driven) |
| `CreateFoodModal.tsx` | Form to create custom food entry in Supabase |
| `ExerciseHistoryModal.tsx` | Exercise history chart, best lifts, PR tracking |
| `InBodyCompareModal.tsx` | Side-by-side InBody scan diff |
| `ShareCardGenerator.tsx` | Screenshot share card (workouts, macros, body comp) |
| `AdaptiveMacroCard.tsx` | Flexible macro display card |

---

## Constants & Utilities

### `constants/theme.ts`
Design system. Export: `useTheme()` hook → `{ colors, isDark }`.

**Dark theme palette:**
| Token | Hex |
|-------|-----|
| background | `#0D0D0D` |
| card | `#161616` |
| surface | `#1E1E1E` |
| accent | `#00C896` |
| text | `#FFFFFF` |
| subtext | `#888888` |

**Spacing:** `xs=4, sm=8, md=16, lg=24, xl=32, xxl=40, xxxl=48`
**Border radius:** `sm=6, md=10, lg=16, xl=24, pill=999`
**Font weights:** `regular=400, medium=500, semibold=600, bold=700, heavy=800`

### `constants/purchases.ts`
RevenueCat integration.
- `configureRevenueCat()` — call once on app load (done in App.tsx)
- `loginRevenueCat(userId)` / `logoutRevenueCat()`
- `hasPro(): Promise<boolean>` — checks entitlement `'Fuelog Pro'` (cached)
- RevenueCat API key is in this file

### `constants/ai.ts`
```typescript
callAI(messages, system?, maxTokens?, type?) → Promise<string>
```
Routes to the `ai-proxy` Supabase edge function. `type` is `'vision'` for food photo analysis, `'text'` (default) for chat. The function requires a valid Supabase JWT.

### `constants/supabase.ts`
Supabase client initialized with URL, anon key, and AsyncStorage auth adapter. Import `supabase` from here.

### `constants/data.ts`
- `calculateTargets(profile)` — Mifflin-St Jeor BMR + activity + goal adjustment → `{ calories, protein, carbs, fat }`
- `MEALS` — 7 meal type labels
- `MC` — macro color map (protein/carbs/fat)
- `WORKOUT_PLAN` — default 7-day workout split
- Sport-specific macro multipliers (18 sports)

### `constants/units.tsx`
`UnitsProvider` context. `useUnits()` → `{ system, setSystem, formatWeight, formatHeight, parseWeight, ... }`. Canonical data stored in imperial (lbs/inches); converts for display only.

### `constants/programs.ts`
`PRESET_PROGRAMS` — library of built-in workout splits (upper/lower, PPL, full-body, etc.).

### `constants/sportProfiles.ts`
`SPORT_PROFILES` — 18 sports with training focus, nutrition guidance, key exercises, coaching context.

---

## Contexts & Hooks

### `hooks/useAuth.tsx` — `AuthProvider`
Supabase auth context. Provides `{ session, user, loading, signOut }`. Listens to `onAuthStateChange`. Wrap the app root (already done in App.tsx).

### `contexts/RestTimerContext.tsx` — `RestTimerProvider`
Global rest timer state: `{ seconds, defaultSeconds, start, dismiss }`. Persists default to AsyncStorage. Triggers haptics at 10s and on completion.

### `constants/units.tsx` — `UnitsProvider`
See above. Wraps the authenticated app tree.

### `hooks/useHealthKit.ts`
Full HealthKit integration. Key exports:
- `requestPermissions()` — shows iOS permission dialog
- `getRecoveryData(sourcePrefs)` → `RecoveryData` (HRV, RHR, sleep, steps, VO2 max, 7-day trends)
- `getWorkoutHistory(days, sourcePrefs)` → `HealthKitWorkout[]`
- `getWeeklyTrainingLoad(sourcePrefs)` → `{ totalMinutes, totalCalories, dailyLoad[] }`
- `saveWeight(lbs)`, `saveNutrition({...})`, `saveWorkout({...})`
- `getTodayBurn()` → `{ bmr, active }` (standalone, no hook needed)
- `getWeeklyBurnData()` → `[{ date, burned }]`

**Multi-source deduplication:** active calories are summed per source and max taken (not totalled) to avoid double-counting Apple Watch + Whoop. Overlapping workouts deduped by >50% duration overlap.

**Source preferences:** global tracker (ProfileScreen) + per-metric overrides; per-metric always wins.

HealthKit is iOS-only. All calls are no-ops on Android.

---

## Backend — Supabase

**Project ref:** `zbcxuffgmjuqarapfdwb`
**Client:** `constants/supabase.ts`
**Auth:** email/password via Supabase Auth, session stored in AsyncStorage

### Key Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User goals, macro targets, sport, unit_system, referral_code, acquisition_source (how the user heard about Fuelog, captured in onboarding), periodization_settings (jsonb), photo URL |
| `macro_logs` | Daily food entries + micronutrients: fiber_g, sugar_g, sodium_mg, calcium_mg, iron_mg, vitamin_d_mcg, vitamin_c_mg, vitamin_b12_mcg, magnesium_mg, zinc_mg, potassium_mg, omega3_g |
| `user_foods` | Custom foods (name, brand, serving, macros, fiber, sugar) |
| `user_recipes` | Custom recipes with JSONB ingredient array + per-serving nutrition |
| `inbody_logs` | InBody scan results: weight, body fat %, skeletal muscle mass, segmental lean/fat mass, InBody score, BMR, visceral fat |
| `body_measurements` | Manual circumference measurements (waist, chest, hips, arms, thighs, neck) + body fat % |
| `micronutrient_targets` | Per-user RDA targets for 12 micronutrients |
| `workout_logs` | Individual exercise sets/reps logged per session |
| `custom_workouts` | User-created workout splits (days stored as JSONB) |
| `workout_programs` | Structured programs with week/day progression (JSONB) |
| `program_completed_days` | Tracks which program days are done |
| `wearable_tokens` | OAuth access + refresh tokens per provider (Whoop/Oura/Garmin/Dexcom), unique on (user_id, provider) |
| `cycle_logs` | Daily cycle phase, flow intensity, symptoms, energy level |
| `cycle_settings` | Cycle length, period length, last period start per user |
| `referrals` | Referral tracking: referrer_id, referee_id, code, status (pending/signed_up/converted) |
| `proactive_notifications` | AI-generated coaching notifications log (rate-limit check) |

All tables use RLS. Users can only read/write their own rows. JWT from Supabase Auth is passed automatically by the client.

---

## Edge Functions

All in `supabase/functions/`. Require `Authorization: Bearer <supabase-jwt>` unless noted.

### `ai-proxy`
Dual-purpose proxy. `verify_jwt = true` in config.toml.

- **USDA food search** — `POST` with `{ query }` → nutrient data array (calls USDA FDC API)
- **AI chat** — `POST` with `{ messages, system?, max_tokens?, type? }` → `{ content: [{ type: 'text', text: string }] }`
  - Model: `claude-sonnet-4-6`
  - `type: 'vision'` used for food photo base64 payloads

**Required secrets:** `ANTHROPIC_API_KEY`, `USDA_API_KEY`

**Cloudflare tunnel endpoint:** `ai.fuelog.app` (routes to this function)

### `cgm-proxy`
Dexcom CGM integration (OAuth 2.0).

Actions: `exchange_code`, `refresh`, `readings` (last 24h glucose with time-in-range stats)

**Required secrets:** `DEXCOM_CLIENT_ID`, `DEXCOM_CLIENT_SECRET`

### `garmin-proxy`
Garmin integration (OAuth **1.0a** — HMAC-SHA1 signed requests).

Actions: `request_token`, `exchange_verifier`, `body_battery`, `dailies` (stress + steps), `sleep`

**Required secrets:** `GARMIN_CONSUMER_KEY`, `GARMIN_CONSUMER_SECRET`

### `oura-proxy`
Oura ring integration (OAuth 2.0).

Actions: `exchange_code`, `readiness`, `sleep`, `activity`

**Required secrets:** `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`

### `whoop-proxy`
Whoop strap integration (OAuth 2.0).

Actions: `exchange_code`, `recovery` (HRV, RHR, SpO2, skin temp, sleep performance), `strain`, `sleep`

**Required secrets:** `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`

### `proactive-coach`
AI-generated push notification trigger. Called by an external cron job (not by the app directly).

- Rate limit: 1 notification per user per 23 hours (checked via `proactive_notifications` table)
- Evaluates 6 signals in priority order: recovery overreach, calorie deficit streak, protein miss, streak risk, workout gap, weekly win
- Calls Claude (200 tokens) to generate 2–3 sentence notification copy
- Returns `{ triggered, type, title, body, deepLink: 'fuelog://coach' }`

**No additional secrets** beyond Supabase service role key + `ANTHROPIC_API_KEY`.

---

## Wearable Integrations

All wearables use OAuth. Tokens stored in `wearable_tokens` table. Token refresh happens automatically in each proxy if `expires_at` is within 5 minutes.

**Redirect URI:** `fuelog://wearable-callback`

| Provider | OAuth version | Proxy function | Key data |
|----------|--------------|----------------|----------|
| Whoop | 2.0 | `whoop-proxy` | Recovery score, HRV, RHR, strain, sleep |
| Oura | 2.0 | `oura-proxy` | Readiness, sleep, activity scores |
| Garmin | 1.0a | `garmin-proxy` | Body battery, stress, steps, sleep |
| Dexcom | 2.0 | `cgm-proxy` | Continuous glucose (EGV), time-in-range |

OAuth client IDs/secrets are set as Supabase function secrets. The `utils/wearables.ts` file has a TODO to fill in Whoop and Oura client IDs after registering OAuth apps with those providers.

---

## AI Integration

**Helper:** `callAI()` in `constants/ai.ts` — wraps the ai-proxy edge function.

```typescript
callAI(
  messages: { role: 'user'|'assistant', content: string|Array }[],
  system?: string,
  maxTokens?: number,
  type?: 'text' | 'vision'
) → Promise<string>
```

- `type: 'vision'` — used when `content` contains base64 image data (FoodPhotoScreen)
- `type: 'text'` (default) — used for CoachScreen chat, meal plan generation, workout programs, voice log parsing

AI powers: Coach chat, meal plan generation, grocery list generation, workout program generation, food photo analysis, voice log parsing, proactive coaching notifications, mineral/micronutrient AI insights.

Model: `claude-sonnet-4-6` (set in ai-proxy function).

---

## RevenueCat / Paywall

**Package:** `react-native-purchases` + `react-native-purchases-ui`

**Entitlement:** `'Fuelog Pro'`

**Check access:** `await hasPro()` from `constants/purchases.ts` — cached, fast.

**Pro-gated features:**
- Unlimited Coach messages (free: 3)
- Meal plan generation (MealPlanScreen)
- Minerals / advanced micronutrient tracking (MineralsScreen)
- AI workout program generation (WorkoutProgramScreen) — verify in screen
- Proactive coaching notifications

**Paywall screen:** `screens/PaywallScreen.tsx` — monthly/yearly options via RevenueCat UI.

**TestFlight bypass:** REMOVED — `EXPO_PUBLIC_IS_TESTFLIGHT` is not referenced anywhere in code (verified 2026-07-19). `hasPro()` is a pure RevenueCat entitlement check with no bypass. The flag lingers only in `.env.example`; safe to ignore.

---

## Native Features

### WidgetKit Home Screen Widget
- Sizes: Small (2×2) and Medium (2×4)
- Data: calorie ring, P/C/F macros vs goals
- Colors: dark bg `#0D0D0D`, accent `#00C896`
- Data flow: `LogScreen (food logged) → syncWidgetData() → FuelogNativeModule.writeWidgetData() → UserDefaults (App Group) → WidgetCenter.reloadAllTimelines()`
- Native module: `modules/fuelog-native/` (local Expo module, auto-linked)
- App Group: `group.com.zackschramm.macrolog`
- Config plugin: `plugins/withWidget.js`

### Siri Shortcuts (App Intents)
- Type: App Intents framework (`AppShortcutsProvider`) — no legacy NSUserActivity donation, works with iOS 16+ Shortcuts and iOS 26+ LLM Siri
- Swift sources live in `targets/appintents/` and are copied into `ios/Fuelog/AppIntents/` and added to the **main app target** (not a separate extension) by the config plugin on every prebuild
- Types are guarded with `@available(iOS 16.0, *)` and `AppIntents.framework` is weak-linked so the app still builds/runs down to the 15.1 deployment target — Siri simply won't offer the shortcuts on iOS 15
- `LogFoodIntent` — "Log \<food\> in Fuelog". `openAppWhenRun = true`; writes the food string to the shared App Group (`fuelogPendingFoodLog` / `fuelogPendingFoodLogTimestamp` keys) instead of logging directly, since macro estimation needs an AI network call. `App.tsx` polls `getPendingSiriFoodLog()` (`utils/widgetSync.ts`) on cold start and on every foreground transition, routes to the Log tab, and pre-fills `VoiceLogScreen`'s text field for the user to confirm.
- `TodayMacrosIntent` — "What are my macros today in Fuelog". `openAppWhenRun = false`; answers entirely from the `fuelogWidgetData` App Group snapshot that the widget already uses (no app launch, no network call).
- `FuelogShortcuts` (`AppShortcutsProvider`) declares the Siri phrases for both intents.
- Config plugin: `plugins/withSiriShortcuts.js`

### Apple HealthKit
- Read: Weight, Active + Basal Energy, Workout, Heart Rate, Resting HR, HRV, Steps, Sleep, SpO2, Respiratory Rate, VO2 Max
- Write: Weight, Energy Consumed, Protein, Carbohydrates, Fat, Water, Workout
- iOS only; guarded by `Platform.OS === 'ios'`

---

## Build & Deploy

### EAS Profiles (`eas.json`)

| Profile | Distribution | Notes |
|---------|-------------|-------|
| `development` | internal | expo-dev-client, for local development |
| `preview` | internal | Standard preview build |
| `production` | internal → App Store | `autoIncrement: true` — auto-bumps build number |

**`appVersionSource: remote`** — version pulled from ASC, not from app.json. Do not manually bump `version` in app.json for releases.

**Submit config:** ASC App ID `6759591771` in `eas.json` submit profile.

### Environment
`.env` at project root is required. Contains:
- `EXPO_PUBLIC_ANTHROPIC_API_KEY` — used client-side (consider moving to EAS secrets)
- `EXPO_PUBLIC_IS_TESTFLIGHT` — vestigial; no longer read by any code

Supabase URL and anon key are hardcoded in `constants/supabase.ts`.
Anthropic and USDA API keys are Supabase function secrets (not in repo).
Wearable OAuth secrets are Supabase function secrets.

### Apple Developer Portal Requirements
When adding new capabilities or regenerating profiles:
1. App Group `group.com.zackschramm.macrolog` must be enabled for both main app and widget extension IDs
2. Siri capability must be enabled for main app ID
3. HealthKit must be enabled for main app ID

### TestFlight Distribution — HARD RULE

**ONLY** add `zackschramm@icloud.com` (Zack Schramm) as an individual tester.

- Do NOT add any other email address under Individual Testers, ever.
- Do NOT invite anyone else to TestFlight without explicit written instruction in that session.
- The Team (Expo) internal group is fine. No external testing groups or additional individuals.

This rule applies to every build, every session, no exceptions.

---

## Known Issues & TODOs

1. **Wearable OAuth client IDs missing** — `utils/wearables.ts` has a TODO to fill in Whoop and Oura client IDs after registering OAuth apps with those providers.

2. **Referral promo not auto-granted** — `screens/ReferralScreen.tsx` has a TODO to grant referrer 1 free month via RevenueCat promo/coupon API once configured.

3. **SECURITY — `.env` committed** — `EXPO_PUBLIC_ANTHROPIC_API_KEY` is in the committed `.env` file. Should be moved to EAS build secrets injected at build time.

4. **SECURITY — OAuth tokens stored plaintext** — `wearable_tokens` table stores access/refresh tokens without encryption at rest. Consider Supabase Vault or column-level encryption.

5. **TestFlight flag** — RESOLVED 2026-07-19: flag is not referenced in any code; paywall cannot be bypassed via env. No action needed before App Store submission.

6. **Missing DB indexes** — `body_measurements` has no index on `(user_id, date)`. `referrals` has no indexes on `referrer_id` or `referee_id`. Add for query performance as data grows.

7. **Social tables not in migrations** — RESOLVED 2026-07-19: `supabase/migrations/20260719_social.sql` adds `social_posts`, `post_likes`, `post_comments` (RLS: feed readable by all authenticated users, writes own-rows-only), a `public_profiles` view (id+name only, for user search), and a `get_leaderboard(days)` security-definer RPC (cross-user log counts without opening macro_logs RLS). SocialScreen updated to use the RPC and view. Migration must be applied with `supabase db push` (not yet run as of 2026-07-19).

8. **Android** — HealthKit, WidgetKit, and Siri Shortcuts are iOS-only. The app runs on Android but those features are no-ops. No Android-specific health integration is implemented.

## iOS 27 (Beta) Compatibility Checklist

iOS 27 beta (public July 2026) ships a heavily changed WebKit (Safari 27: 58 features / 525 fixes). Zack's test phone runs the beta; App Review and ~all launch users run stable iOS 26, so beta breakage is NOT a launch blocker — but retest before iOS 27 GA (fall 2026):

1. **Wearable OAuth (KNOWN BROKEN on beta)** — Whoop's id.whoop.com login blank-spins inside ASWebAuthenticationSession on iOS 27 beta (same class of bug as GitHub app login breaking on the preview). Mitigation shipped in build 140: `connectWearable` opens the flow in real Safari via `Linking.openURL` and completes through the fuelog:// deep link (`handleWearableRedirect` in App.tsx). If real Safari also fails on a beta device, connect from a stable-iOS device — nothing app-side can fix beta WebKit.
2. **On-device AI** (`modules/fuelog-native`, Apple Foundation Models) — verify `isLocalAIAvailable`/`generateLocalAI` against the iOS 27 SDK; Apple evolves this API year over year. Guarded `#available(iOS 26.0, *)`, weak-linked, silent cloud fallback — worst case is fallback to ai-proxy, not a crash.
3. **WidgetKit widget** — re-verify rendering + App Group data handoff on 27.
4. **Siri App Intents** — re-verify "Log <food> in Fuelog" intent.
5. **File Apple Feedback** for the auth-sheet hang while 27 is in beta; check each beta's release notes: https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes
6. **Never debug wearable/web-auth issues on the beta phone alone** — reproduce on the iOS 26 simulator (`npx expo run:ios`) first to separate app bugs from beta-OS bugs.
