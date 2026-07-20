# Build 2 – WidgetKit + Siri Shortcuts

## What was built

### 1. WidgetKit home screen widget

**Source files** (checked into repo, copied into the Xcode project during EAS Build by `withWidget.js`):

| File | Purpose |
|---|---|
| `targets/widget/FuelogWidget.swift` | Timeline provider, entry model, SwiftUI views for Small (2×2) and Medium (2×4) |
| `targets/widget/FuelogWidgetBundle.swift` | `@main` widget bundle entry point |
| `targets/widget/Info.plist` | Widget extension Info.plist (declares `com.apple.widgetkit-extension`) |
| `targets/widget/FuelogWidget.entitlements` | App Groups entitlement for the widget target |

**Design:**
- Background `#0D0D0D`, accent teal `#00C896` matches the app
- Small: circular calorie-progress arc + "N left" label + FUELOG wordmark
- Medium: calorie ring on left + P/C/F horizontal bars on right

**Data flow:**
```
Food logged in app
  → LogScreen.tsx useEffect (on logs change)
  → syncWidgetData() [utils/widgetSync.ts]
  → FuelogNativeModule.writeWidgetData() [modules/fuelog-native/]
  → UserDefaults(suiteName: "group.com.zackschramm.macrolog")
  → WidgetCenter.shared.reloadAllTimelines()
  → FuelogProvider.getTimeline() reads the UserDefaults JSON
  → Widget renders updated data
```

Shared UserDefaults key: `fuelogWidgetData`
JSON shape:
```json
{
  "date": "2026-06-24",
  "calories": 1250,
  "caloriesGoal": 2200,
  "protein": 95.0,
  "proteinGoal": 150,
  "carbs": 140.0,
  "carbsGoal": 250,
  "fat": 45.0,
  "fatGoal": 70
}
```

---

### 2. Siri Shortcuts (NSUserActivity-based)

No separate extension required. Uses `NSUserActivity` donation — Siri learns the
patterns and surfaces them as suggestions in Spotlight, Lock Screen, and Shortcuts app.

**Activity types registered** (via `withSiriShortcuts.js`):
- `com.zackschramm.macrolog.logProtein` — suggested phrase: "Log protein in Fuelog"
- `com.zackschramm.macrolog.startWorkout` — suggested phrase: "Start a workout in Fuelog"

**"Log protein" shortcut:**
Donated automatically from `LogScreen.tsx` `onLogged` callback whenever the food logged
contains protein > 0. After a few donations Siri will surface it as a suggestion.

**"Start workout" shortcut:**
Call `donateStartWorkoutShortcut()` from `modules/fuelog-native/index.ts` when the user
taps **Start Workout** in WorkoutScreen. Example:

```typescript
import { donateStartWorkoutShortcut } from 'fuelog-native';

// In WorkoutScreen, on workout start button press:
donateStartWorkoutShortcut().catch(() => {});
```

---

### 3. Native module — `fuelog-native`

Local Expo module auto-linked via `expo-module.config.json`. Expo's build system
includes it automatically during `expo prebuild` / EAS Build.

| File | Purpose |
|---|---|
| `modules/fuelog-native/ios/FuelogNativeModule.swift` | Swift implementation (App Group writes + NSUserActivity donations) |
| `modules/fuelog-native/index.ts` | TypeScript API surface |
| `modules/fuelog-native/expo-module.config.json` | Tells Expo to include the module |
| `modules/fuelog-native/package.json` | Required for `file:` dependency resolution |

Added to `package.json` as `"fuelog-native": "file:./modules/fuelog-native"`.

---

## Config plugins

### `plugins/withWidget.js`

Runs during `expo prebuild` / EAS Build. It:
1. Adds `com.apple.security.application-groups = ["group.com.zackschramm.macrolog"]` to the
   main app entitlements.
2. Copies all Swift / plist / entitlements files from `targets/widget/` into `ios/FuelogWidget/`.
3. Adds a new Xcode native target `FuelogWidget` with product type
   `com.apple.product-type.widgetkit-extension`.
4. Adds `FuelogWidget.swift` and `FuelogWidgetBundle.swift` to the target's Sources build phase.
5. Patches build settings: `SWIFT_VERSION=5.0`, `IPHONEOS_DEPLOYMENT_TARGET=16.0`,
   `INFOPLIST_FILE`, `CODE_SIGN_ENTITLEMENTS`, `SKIP_INSTALL=YES`.
6. Weakly links `WidgetKit.framework` to the main app (required for
   `WidgetCenter.shared.reloadAllTimelines()` in the native module).
7. Adds a **"Embed Foundation Extensions"** `PBXCopyFilesBuildPhase` to the main app target
   so the widget `.appex` is packaged into the IPA.

### `plugins/withSiriShortcuts.js`

1. Adds `NSUserActivityTypes` array to main app `Info.plist`.
2. Adds `NSSiriUsageDescription` to `Info.plist`.
3. Adds `com.apple.developer.siri = true` to main app entitlements.

---

## Changes to existing files

| File | What changed |
|---|---|
| `app.json` | Added `ios.entitlements` for App Groups; added `./plugins/withWidget` and `./plugins/withSiriShortcuts` to `plugins` array |
| `package.json` | Added `"fuelog-native": "file:./modules/fuelog-native"` |
| `screens/LogScreen.tsx` | Imported `syncWidgetData` + `donateSiriProteinShortcut`; added `useEffect` to sync widget on log change; added Siri shortcut donation in `onLogged` |

---

## EAS Build — what you need to do before triggering Build 2

### Required in App Store Connect / Apple Developer Portal

1. **App Groups capability** — register `group.com.zackschramm.macrolog` in the
   [Apple Developer Portal → Identifiers](https://developer.apple.com/account/resources/identifiers/list)
   and enable it for both:
   - `com.zackschramm.macrolog` (main app)
   - `com.zackschramm.macrolog.widget` (widget extension — create this App ID if not present)

2. **Siri capability** — enable Siri in the main App ID (`com.zackschramm.macrolog`).

3. **Provisioning profiles** — regenerate provisioning profiles for both App IDs after
   adding the capabilities. EAS Build can do this automatically if you use
   `"credentialsSource": "remote"` (the default).

### `eas.json` — add widget bundle ID to production build

No changes strictly required. EAS Build should pick up the new target automatically via
the config plugin. However, if the build fails to sign the widget extension, add an
explicit schematics entry:

```json
{
  "build": {
    "production": {
      "autoIncrement": true,
      "ios": {
        "bundleIdentifier": "com.zackschramm.macrolog",
        "extensions": {
          "FuelogWidget": {
            "bundleIdentifier": "com.zackschramm.macrolog.widget"
          }
        }
      }
    }
  }
}
```

---

## Testing locally (without a full EAS build)

### Test the widget Swift code in Xcode

1. Run `npx expo prebuild --platform ios` to generate the native project.
2. Open `ios/macro-log.xcworkspace` in Xcode 15+.
3. Verify the `FuelogWidget` target appears in the project navigator.
4. Select the `FuelogWidget` scheme and run on an iOS 16+ Simulator.
5. Long-press the simulator home screen → add widget → search "Fuelog".

### Test App Group data sharing

1. Run the main app on a real device (App Group UserDefaults requires a real device for
   proper entitlement enforcement in signed builds).
2. Log a food item.
3. Check the widget — it should update within seconds (the native module calls
   `WidgetCenter.shared.reloadAllTimelines()`).

### Test Siri Shortcuts

1. Log a protein-containing food 2–3 times.
2. Ask Siri: "Log protein in Fuelog". After a few donations, Siri will surface it as
   a suggestion in Spotlight.
3. To add a custom voice phrase: open the Shortcuts app → All Shortcuts → look for
   "Log protein in Fuelog" → tap the `+` to add your own phrase.

---

## Widget timeline refresh strategy

The widget timeline refreshes:
- **Immediately** when food is logged (via `WidgetCenter.shared.reloadAllTimelines()`
  called from the native module).
- **Every 30 minutes** as a fallback (configured in `FuelogProvider.getTimeline`).

If the user hasn't logged today, the widget shows zeros against the stored goals.

---

## Known limitations / future work

- **Periodization** — the widget always shows the base macro goals, not the
  training/rest day split. To support this, include `caloriesGoal` for the effective
  (periodized) target in the payload written by `syncWidgetData`.
- **Android** — `fuelog-native` is iOS-only. The `syncWidgetData` utility no-ops on
  Android via the `Platform.OS !== 'ios'` guard.
- **Expo Go** — the native module is not available in Expo Go. All sync calls fail
  silently. Test only with a development build (`expo-dev-client`).
- **WorkoutScreen shortcut** — `donateStartWorkoutShortcut()` is ready to call from
  WorkoutScreen but was not added in this PR per the "do not modify WorkoutScreen
  logging logic" constraint.
