import type { WeighIn } from './weightTrend';

/**
 * The pure half of the weight-history merge — no database, no React Native.
 *
 * WHY THIS FILE EXISTS SEPARATELY
 * `weightHistory.ts` imports `constants/supabase`, which pulls in
 * `react-native-url-polyfill` and AsyncStorage, which pull in `react-native`
 * itself. React Native's `index.js` is Flow-typed, esbuild can't parse it, and
 * so `tsx utils/__tests__/weightHistory.test.ts` died on import before running
 * a single assertion:
 *
 *     ERROR: Unexpected "typeof"  (node_modules/react-native/index.js:27:7)
 *
 * Same reason `constants/data.ts` is deliberately import-free. Merge logic is
 * exactly the kind of thing that needs tests, so it must not sit behind an
 * unloadable import chain. Keep this file's imports type-only — a type import
 * is erased at transform time, a value import is not.
 *
 * `weightHistory.ts` re-exports everything here, so call sites are unchanged.
 */

export interface WeightEntry extends WeighIn {
  /** Which table it came from — useful for debugging and for "source" badges. */
  source: 'manual' | 'measurements' | 'inbody';
}

/**
 * Priority when two sources report the same date. InBody is a calibrated scale
 * reading, so it wins; a manual Stats entry and a Body Measurements entry are
 * equally trustworthy, so first-seen wins between those.
 */
export const SOURCE_RANK: Record<WeightEntry['source'], number> = {
  inbody: 3,
  measurements: 2,
  manual: 1,
};

/** Rejects nulls, NaN, and readings no human hits — bad rows must not smooth in. */
export const plausible = (lb: unknown): lb is number =>
  typeof lb === 'number' && Number.isFinite(lb) && lb > 20 && lb < 1500;

/** Normalise a timestamp or date string to YYYY-MM-DD. */
export function toDay(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * One entry per day, highest-ranked source winning, oldest first.
 */
export function dedupeByDate(entries: WeightEntry[]): WeightEntry[] {
  const best = new Map<string, WeightEntry>();
  for (const e of entries) {
    const existing = best.get(e.date);
    if (!existing || SOURCE_RANK[e.source] > SOURCE_RANK[existing.source]) {
      best.set(e.date, e);
    }
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Strip the source tag — what analyzeWeightTrend() takes. */
export function toWeighIns(entries: WeightEntry[]): WeighIn[] {
  return entries.map(({ date, weight }) => ({ date, weight }));
}

/** Most recent weigh-in in pounds, or null. */
export function latestWeight(entries: WeightEntry[]): number | null {
  return entries.length ? entries[entries.length - 1].weight : null;
}
