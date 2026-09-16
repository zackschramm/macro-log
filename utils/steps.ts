/**
 * Daily step totals from HealthKit / Health Connect samples.
 *
 * THE RULE: steps from different sources measure THE SAME WALKING. An iPhone
 * in a pocket and an Apple Watch on the wrist both count the same 8,000 steps,
 * so adding them is always wrong. Within one source, segments across the day
 * are separate measurements and DO add up.
 *
 * So: sum within (day, source), then take the best single source per day.
 * Apple Health does the same thing in its own UI, which is why the app could
 * disagree with Health on the same phone.
 *
 * Two bugs in build 169 came from not having this in one place:
 *
 *   1. The headline did `filtered.reduce((s, d) => s + d.value)`. That is
 *      correct ONLY when `filtered` is a single source — but filterBySource
 *      deliberately falls back to ALL sources when the user's preference
 *      matches nothing, which is the common case (no preference set). Two
 *      devices then roughly doubled the count.
 *
 *   2. The 7-day trend mapped every sample straight to {date, value} with no
 *      grouping at all. getDailyStepCountSamples returns one entry per day
 *      PER SOURCE, so a day with an iPhone and a Watch produced two points
 *      with the same date — duplicated days on the chart.
 *
 * `toDay` is injected so this is testable without a device timezone. It must
 * match the app's toLocalDateString: bucketing on the ISO string's first ten
 * characters is UTC, which lands late-evening samples on tomorrow for anyone
 * west of Greenwich.
 */

export interface StepSample {
  value?: number | null;
  startDate?: string | null;
  start?: string | null;
  sourceName?: string | null;
}

export interface DaySteps {
  date: string;
  value: number;
  /** The source that won the day, for the "from <tracker>" caption. */
  source: string;
}

const localDay = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * One entry per day, ascending. Never returns two entries for the same date.
 */
export function stepsByDay(
  raw: StepSample[] | null | undefined,
  toDay: (iso: string) => string = localDay,
): DaySteps[] {
  if (!Array.isArray(raw)) return [];

  // (day, source) -> summed value
  const perSource = new Map<string, { date: string; source: string; value: number }>();
  for (const s of raw) {
    const iso = s?.startDate ?? s?.start;
    if (!iso) continue;
    const date = toDay(String(iso));
    if (!date) continue;
    const v = Number(s?.value);
    if (!Number.isFinite(v) || v < 0) continue;
    const source = (s?.sourceName ?? 'unknown') || 'unknown';
    const key = `${date}|${source}`;
    const hit = perSource.get(key);
    if (hit) hit.value += v;
    else perSource.set(key, { date, source, value: v });
  }

  // Best source per day. Ties go to the first seen, which keeps the result
  // stable rather than flipping between trackers on repeated reads.
  const best = new Map<string, DaySteps>();
  for (const { date, source, value } of perSource.values()) {
    const hit = best.get(date);
    if (!hit || value > hit.value) best.set(date, { date, value: Math.round(value), source });
  }

  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The single day's total, or null when that day has no samples. */
export function stepsForDay(
  raw: StepSample[] | null | undefined,
  date: string,
  toDay: (iso: string) => string = localDay,
): DaySteps | null {
  return stepsByDay(raw, toDay).find((d) => d.date === date) ?? null;
}
