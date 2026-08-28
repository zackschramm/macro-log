/**
 * Day+source bucketing for raw HealthKit samples.
 *
 * Lives here rather than inside `useHealthKit.ts` so it can be unit-tested —
 * that hook imports `react-native-health`, which drags in React Native and
 * cannot be loaded by the test runner. `useHealthKit` imports this.
 *
 * WHY IT EXISTS
 * On iOS 27, `react-native-health` crashes in native code whenever it runs an
 * HKStatisticsCollectionQuery — which is what powers `getActiveEnergyBurned`,
 * `getBasalEnergyBurned` and `getDailyStepCountSamples`. The crash happens
 * before any JS callback fires, so it can't be caught. Those three calls were
 * therefore hard-disabled on iOS 27, which blanked the Stats page and every
 * TDEE calculation on that OS.
 *
 * `getSamples` reaches the same underlying data through HKSampleQuery, a
 * different native path that doesn't crash. It returns raw samples with no
 * aggregation, so we rebuild the buckets here.
 *
 * Keyed by (day, source) so every shape of caller keeps working: ones that sum
 * the array, ones that group by `sourceName` to pick a dominant source, and
 * ones that want per-day values for a chart.
 *
 * Zero runtime imports.
 */

/**
 * Unit string + scale factor for each quantity type we read via `getSamples`.
 *
 * ── The trap this encodes ───────────────────────────────────────────────────
 *
 * react-native-health's TypeScript enum exports `kilocalorie = 'kilocalorie'`
 * (index.d.ts), but its NATIVE unit parser (`hkUnitFromOptions` in
 * RCTAppleHealthKit+Utils.m) only recognises these strings:
 *
 *   gram kg stone pound meter cm inch mile foot second minute hour day
 *   joule calorie count percent bpm fahrenheit celsius mmhg mmolPerL
 *   literPerMinute mgPerdL mlPerKgMin
 *
 * "kilocalorie" is NOT among them. An unrecognised string falls through to the
 * caller's default — which for getSamples is `countUnit` — and then
 * `doubleValueForUnit:` throws "incompatible units" on every energy sample.
 * That throw is caught per-sample and only NSLogged, so the query returns an
 * EMPTY ARRAY WITH NO ERROR. Silent, total data loss that looks exactly like
 * "the user has no data".
 *
 * So: ask for `calorie` (the gram calorie) and scale to kcal ourselves.
 * 1 kcal = 1000 cal.
 */
export const SAMPLE_UNITS: Record<string, { unit: string; scale: number }> = {
  ActiveEnergyBurned: { unit: 'calorie', scale: 1 / 1000 },
  BasalEnergyBurned:  { unit: 'calorie', scale: 1 / 1000 },
  StepCount:          { unit: 'count',   scale: 1 },
};

export interface RawSample {
  /**
   * The magnitude, under whichever key the bridge happened to use.
   *
   * react-native-health's TypeScript types promise `value` for getSamples, and
   * they are WRONG. The native implementation writes the key `quantity`
   * (RCTAppleHealthKit+Queries.m:371) — or `distance` for mile/metre units
   * (:373) — and only the *quantity-sample* path used by HRV, resting heart
   * rate and SpO2 writes `value` (:264). Because the lying type checked out,
   * every step / active-calorie / basal-calorie bucket silently read
   * `undefined` and scored 0, while HRV kept working. That is exactly the
   * "49ms HRV but blank steps" symptom, and it produced no Sentry error
   * because the buckets existed — they were just all zero.
   */
  value?: number;
  quantity?: number;
  distance?: number;
  /** getSamples returns `start`/`end`; the aggregated APIs return `startDate`/`endDate`. */
  start?: string;
  end?: string;
  startDate?: string;
  endDate?: string;
  sourceName?: string;
  sourceId?: string;
}

export interface Bucket {
  value: number;
  startDate: string;
  endDate: string;
  sourceName: string;
  sourceId?: string;
}

/**
 * Classify one HKCategoryValueSleepAnalysis sample.
 *
 * `getSleepSamples` does NOT return the raw enum. The bridge switches it into
 * a string before handing it over — "INBED", "ASLEEP", "CORE", "DEEP", "REM",
 * "AWAKE", "UNKNOWN" (RCTAppleHealthKit+Queries.m:612-643). The app compared
 * that string to the numbers 1/3/4/5, which is always false under strict
 * equality, so total sleep was permanently 0 and every sleep figure rendered
 * as "no data" on every device and every iOS version.
 *
 * Both spellings are accepted: the numeric enum is what a future bridge
 * version (or a direct HealthKit call) would give us, and being wrong in that
 * direction would silently zero sleep all over again.
 */
export function classifySleepSample(value: unknown): { asleep: boolean; deep: boolean; rem: boolean } {
  const v = typeof value === 'string' ? value.toUpperCase() : value;
  const deep = v === 'DEEP' || v === 4;
  const rem = v === 'REM' || v === 5;
  // "INBED" and "AWAKE" are deliberately NOT sleep: counting in-bed time as
  // sleep is how a fitness app tells someone they slept nine hours when they
  // read for two of them.
  const asleep = deep || rem || v === 'ASLEEP' || v === 'CORE' || v === 1 || v === 3;
  return { asleep, deep, rem };
}

export function bucketByDayAndSource(
  raw: RawSample[] | null | undefined,
  scale = 1,
): Bucket[] {
  if (!Array.isArray(raw)) return [];
  const buckets = new Map<string, Bucket>();

  for (const s of raw) {
    const startIso = s?.start ?? s?.startDate;
    if (!startIso) continue;                       // undateable sample — drop it
    const rawValue = s?.value ?? s?.quantity ?? s?.distance;
    const value = (typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : 0) * scale;
    const day = String(startIso).slice(0, 10);
    const source = s.sourceName ?? 'unknown';
    const key = `${day}|${source}`;
    const endIso = String(s.end ?? s.endDate ?? startIso);

    const existing = buckets.get(key);
    if (existing) {
      existing.value += value;
      // Widen the bucket to span every sample that landed in it.
      if (String(startIso) < existing.startDate) existing.startDate = String(startIso);
      if (endIso > existing.endDate) existing.endDate = endIso;
    } else {
      buckets.set(key, {
        value,
        startDate: String(startIso),
        endDate: endIso,
        sourceName: source,
        sourceId: s.sourceId,
      });
    }
  }

  return [...buckets.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
}
