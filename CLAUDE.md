# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start development server
npx expo start

# Start for specific platform
npx expo start --ios
npx expo start --android

# Build with EAS
eas build --profile development
eas build --profile preview
eas build --profile production

# Run Supabase functions locally
supabase functions serve ai-proxy
```

There are no lint or test scripts configured.

## Architecture

MacroLog is a React Native + Expo fitness and nutrition tracking app with an AI coaching feature.

**Entry flow:** `index.ts` → `App.tsx` → `AuthProvider` → conditional routing between `AuthScreen`, `OnboardingScreen`, and `MainTabs`.

**Navigation:** `screens/MainTabs.tsx` hosts a 6-tab navigator (Log, Train, Stats, Coach, Social, Me). Each tab maps to a screen in `screens/`.

**Auth:** `hooks/useAuth.tsx` provides a React Context with session state backed by Supabase Auth (stored in AsyncStorage).

**Backend:** Supabase (PostgreSQL + Auth). Client initialized in `constants/supabase.ts`. All AI calls go through a Deno serverless function at `supabase/functions/ai-proxy/` to keep API keys server-side. The proxy is called via the helper in `constants/ai.ts`.

**AI:** Claude Sonnet 4 (via the ai-proxy function) powers the Coach screen, meal plan generation, and image-based food recognition from the camera.

**Food data:** USDA Food Database API is called from within the ai-proxy function. Barcode scanning is handled by `components/BarcodeScanner.tsx`.

**Health integration:** `hooks/useHealthKit.ts` reads/writes weight, nutrition, and workout data to Apple Health.

**Key constants:** `constants/data.ts` (food/meal reference data), `constants/programs.ts` (workout programs).

**Static pages:** `docs/` contains the support and privacy HTML pages (not part of the app bundle).

## Environment

`.env` is required at the project root. Supabase credentials (URL and anon key) live in `constants/supabase.ts`. Anthropic and USDA API keys are stored as Supabase function secrets (not in the repo).
