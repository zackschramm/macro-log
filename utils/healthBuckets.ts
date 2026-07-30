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

export interface RawSample {
  value?: number;
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

export function bucketByDayAndSource(raw: RawSample[] | null | undefined): Bucket[] {
  if (!Array.isArray(raw)) return [];
  const buckets = new Map<string, Bucket>();

  for (const s of raw) {
    const startIso = s?.start ?? s?.startDate;
    if (!startIso) continue;                       // undateable sample — drop it
    const value = typeof s.value === 'number' && Number.isFinite(s.value) ? s.value : 0;
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
