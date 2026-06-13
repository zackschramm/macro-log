# Fuelog — HealthKit Integration Audit

_Audited: `hooks/useHealthKit.ts` and its consumers (`RecoveryScreen`, `WorkoutScreen`, `ProgressScreen`), `app.json`, `package.json`. Date: 2026-06-02._

## Verdict

The iOS integration is well-built and will work in your dev client. But there are two reasons it can look like it "doesn't work," plus a few correctness bugs worth fixing before you trust the numbers. **Android currently gets zero health data.**

---

## Critical / High

### H1 — Android has no health integration at all
`react-native-health` is **iOS-only** (no `android/` folder in the package). There's no `react-native-health-connect`, and `app.json` declares no Health Connect permissions. The hook short-circuits on `Platform.OS !== 'ios'`, so on Android every screen reports "unavailable." Since you ship to Google Play, those users get nothing.

**Fix:** add `react-native-health-connect`, add the Health Connect permissions/plugin to `app.json` (`android.permission.health.READ_*`), and branch the hook by platform behind a shared interface.

### H2 — "Authorized" is a false positive on iOS
`initHealthKit` resolves **success even when the user denied read access** or never toggled the metrics on — this is Apple's privacy design, you cannot detect denied reads. So `isAuthorized` becomes `true`, but every read returns empty, and the UI can't tell "denied" from "no data yet." This is almost certainly why you can't tell if it's working.

**Fix:** after init, run a probe read (e.g. today's steps + latest weight). If the key reads all come back empty, surface a "Health access looks off — enable Fuelog in Settings › Privacy › Health" prompt instead of silently showing blanks.

---

## Medium

### M1 — Hook state isn't shared across screens
`useHealthKit()` is instantiated separately in `RecoveryScreen`, `WorkoutScreen`, and `ProgressScreen`. Each instance has its own `isAuthorized`/`isAvailable` and re-runs `initHealthKit`. It's idempotent so it mostly works, but `ProgressScreen` requests permission in a mount effect and then checks `health.isAuthorized` on save — save fast and the flag is still `false`, so the weight is **silently not written** to Health.

**Fix:** lift the hook into a context/provider (or module-level singleton) so authorization is shared, and gate writes on a resolved permission, not the per-instance flag.

### M2 — Workout history field names likely mismatched
`getWorkoutHistory` reads `w.totalEnergyBurned`, `w.totalDistance`, `w.workoutActivityType`, `w.uuid`. `react-native-health`'s workout results expose `calories`, `distance`, `activityName`/`activityId`, `id`. If so, **every imported workout shows null calories, null distance, and name "Workout."**

**Fix:** verify the returned object shape on a device; prefer `getAnchoredWorkouts` and map the documented fields.

### M3 — Active calories are summed across all sources
Unlike every other metric (which respects `sourcePrefs` via `filterBySource`), `getActiveEnergyBurned` sums **all** samples and just labels the source as `data[0]`. With Apple Watch + Whoop + iPhone all writing active energy, today's burn is double-counted and inflated — directly corrupting your "calories burned" number.

**Fix:** apply the same source filter as the other metrics, or dedupe by `sourceName`.

### M4 — HRV `×1000` conversion is unverified
`results.hrv = Math.round(filtered[0].value * 1000)` assumes the library returns seconds. Expect a real HRV of ~20–100 ms. If `react-native-health` already returns milliseconds on your version, you'll display values in the tens of thousands.

**Fix:** check the magnitude on a real device; drop the `×1000` if it's already ms.

---

## Low / polish

- **L1** — `saveWorkout` always writes `TraditionalStrengthTraining` regardless of `data.name`, so runs/rides get mislabeled in Apple Health. Map `name` → activity type.
- **L2** — Missing `BasalEnergyBurned` (resting energy) in read permissions. Add it if you want to pull TDEE / "calories needed" from Health rather than computing it purely from the Mifflin–St Jeor formula.
- **L3** — Usage strings are declared in both `app.json infoPlist` and added by the `react-native-health` plugin (harmless). More importantly: confirm the **HealthKit capability is enabled for App ID `6759591771` in the Apple Developer portal** — if it isn't, dev works but TestFlight/production builds silently return no data.
- **L4** — No background delivery/observers; data only refreshes when a screen mounts. Fine for v1.

---

## How to verify it works (real device, dev client)

1. Settings › Privacy & Security › Health › Fuelog — confirm the toggles are **ON** (this is the single most common cause of "no data").
2. Add a manual workout + a weight entry in Apple Health, then open the Workout and Progress screens.
3. Log a meal in Fuelog → confirm it appears under Nutrition in Apple Health (tests writes).
4. Glance at the HRV value magnitude (M4) and today's active-calorie total (M3).

## Suggested order of fixes
H2 (so you can actually see status) → M2/M3/M4 (trust the numbers) → M1 (robustness) → H1 (Android) → L-items.
