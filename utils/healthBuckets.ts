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


// ─── Sleep: one day, one tracker ────────────────────────────────────────────
//
// WHOOP's app and the Apple Watch BOTH write sleep-stage samples into
// HealthKit for the same night. Summing every sample in the window therefore
// reported roughly double for anyone wearing two trackers (Zack, build 163),
// and the "last night" window could also swallow the night before.
//
// Model (council-reviewed, EIGHTH revision). Revisions two through seven
// classified each session by the clock — "started after 21:00", "ended before
// 04:00", "began before mid-morning" — and every pass of the council found a
// new cliff in that machinery: a one-minute shift across 21:00 moved 1.5h into
// the headline; a 3h evening crash was re-dated onto TOMORROW and evicted the
// real night; a pre-dawn alarm silently promoted every morning nap. The rules
// are gone. What replaced them:
//   * samples are grouped by tracker and clustered into SESSIONS — a gap
//     longer than SLEEP_SESSION_GAP_MS separates two sleeps;
//   * sessions are linked into BOUTS. Two consecutive sessions are the same
//     sleep when the gap between them is ≤ NIGHT_LINK_GAP_MS AND the earlier
//     one did not end at a waking hour (EARLY_WAKE_HOUR..EVENING_HOUR). Waking
//     at 03:00 and going back to bed at 06:30 is therefore ONE broken night,
//     while an alarm at 05:30 ends the night and the post-workout nap stays a
//     nap. This is the only clock test left in the model, and it asks the one
//     question that matters: did you get up for the day, or not?
//   * a bout belongs to the sleep day its LAST session ends on. Nothing is ever
//     re-dated forward, so no sleep can be attributed to a day that has not
//     happened yet, and a broken night lands whole on its wake date;
//   * per sleep day, per tracker, the LONGEST bout is that day's night; every
//     other bout is a nap, reported separately and never folded into "last
//     night". A day whose longest bout is under MIN_FRAGMENT_MS has no night at
//     all. An evening crash, an afternoon sleep and a couch doze are all just
//     bouts: they can never evict OR inflate the night, because the night is
//     whichever bout is longest;
//   * per day the tracker with the MOST night sleep wins — trackers are never
//     summed. "Last night" is the newest day on which some tracker has night
//     sleep; a tracker that has not synced yet simply loses to the one that
//     has. A night touching the query window's edge is truncated and is not
//     reported.

// KNOWN TRADE-OFFS (council pass 7, confirmed and deliberately accepted).
// Seven review passes have run against this file. The bug that prompted it —
// two trackers being summed, roughly doubling reported sleep — is fixed and
// covered by the suite. What is left below are judgement calls between two
// defensible answers, not defects with a known right fix. They are written
// down so the next person does not rediscover them as bugs:
//
//  1. THE 04:00 MERGE BOUNDARY. Waking at 03:59 and sleeping again at 06:30
//     counts as one broken night; waking at 04:01 makes the 06:30 sleep a nap.
//     A real cliff, worth up to ~2.5h in the headline. It is load-bearing: it
//     is the only signal that separates "woke in the night" from "got up for
//     the day", and dropping it made a 05:30 alarm merge the post-workout nap
//     into the night (pass 5). No gap threshold separates those two cases —
//     both are ~3.5h — so the hour test stays.
//  2. A SHORT NIGHT-SHAPED SLEEP OUTRANKS A LONGER DAYTIME ONE. 1h at 00:30
//     plus 5h at 10:00 reports the 1h. Preferring the night-shaped bout is what
//     stops a 2.5h afternoon nap displacing a 2h night; the cost is this
//     inversion when the daytime sleep is much longer.
//  3. A CHAIN IS FILED UNDER ITS LAST SESSION'S DATE. Any sleep ending between
//     19:00 and midnight chains forward, so an evening sleep is filed against
//     the night it precedes. That is what stops a broken night's pre-midnight
//     half vanishing onto the previous day; it also means a long day-sleep
//     ending after 19:00 is dated to the following day.
//  4. A SHORT MIDNIGHT-CROSSING DOZE REPORTS AS THAT DAY'S SLEEP. See
//     `startedAtNight` below for why this side of the trade was chosen.
//
// Every one of these is a two-sided choice where the opposite setting produced
// a confirmed defect in an earlier revision. Change one only with the scenario
// that motivated it in hand, and run the suite.

export interface SleepSample {
  value: unknown;
  start?: string;
  end?: string;
  startDate?: string;
  endDate?: string;
  sourceName?: string;
}

interface SleepInterval { start: number; end: number; deep: boolean; rem: boolean }

export interface SleepSession {
  source: string;
  start: number;      // ms epoch
  end: number;        // ms epoch
  asleepMs: number;   // union of asleep intervals
  deepMs: number;
  remMs: number;
  intervals: SleepInterval[];
}

const HOUR_MS = 3_600_000;
/** Asleep intervals from one tracker further apart than this are different sleeps. */
export const SLEEP_SESSION_GAP_MS = 2 * HOUR_MS;
/** Sessions no further apart than this are the same sleep, unless the earlier one ended at a waking hour. */
export const NIGHT_LINK_GAP_MS = 4 * HOUR_MS;
/** A night-shaped bout shorter than this is a doze: it can be a nap, never a day's night sleep. */
export const MIN_FRAGMENT_MS = 1 * HOUR_MS;
/** A bout that did NOT begin at night has to reach this to stand in for a night (the sleep after an all-nighter, a night shift). */
export const LONE_SLEEP_MS = 2 * HOUR_MS;
/** Waking hours run from here to EVENING_HOUR: a sleep that ends inside them ended for the day. */
export const EARLY_WAKE_HOUR = 4;
/** ...and stop here — a sleep ending in the evening did not end the day, it preceded the night. */
export const EVENING_HOUR = 19;
/** A bout that began before this local hour, or crossed midnight, is night-shaped: it is a night even when short. */
export const MORNING_END_HOUR = 10;
/** A night whose first sample sits within this of the query window's start was cut by the window. */
export const WINDOW_EDGE_MS = 45 * 60_000;

const msToHours = (ms: number) => Math.round(ms / 36000) / 100;

/** Milliseconds covered by the intervals, with overlaps counted once. */
export function unionMs(intervals: ReadonlyArray<{ start: number; end: number }>): number {
  const sorted = intervals.filter(i => i.end > i.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = NaN;
  let curEnd = NaN;
  for (const i of sorted) {
    if (Number.isNaN(curStart)) { curStart = i.start; curEnd = i.end; continue; }
    if (i.start <= curEnd) { if (i.end > curEnd) curEnd = i.end; }
    else { total += curEnd - curStart; curStart = i.start; curEnd = i.end; }
  }
  if (!Number.isNaN(curStart)) total += curEnd - curStart;
  return total;
}

/** Asleep intervals (INBED/AWAKE dropped) grouped by sourceName. */
function asleepIntervalsBySource(samples: ReadonlyArray<SleepSample> | null | undefined): Map<string, SleepInterval[]> {
  const out = new Map<string, SleepInterval[]>();
  if (!Array.isArray(samples)) return out;
  for (const s of samples) {
    const kind = classifySleepSample(s?.value);
    if (!kind.asleep) continue;
    const start = Date.parse(String(s?.startDate ?? s?.start ?? ''));
    const end = Date.parse(String(s?.endDate ?? s?.end ?? ''));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const source = s?.sourceName ?? '';
    const list = out.get(source) ?? [];
    list.push({ start, end, deep: kind.deep, rem: kind.rem });
    out.set(source, list);
  }
  return out;
}

/** Cluster each tracker's asleep intervals into sessions, oldest first. */
export function sleepSessions(samples: ReadonlyArray<SleepSample> | null | undefined): SleepSession[] {
  const sessions: SleepSession[] = [];
  for (const [source, intervals] of asleepIntervalsBySource(samples)) {
    intervals.sort((a, b) => a.start - b.start);
    let cur: SleepInterval[] = [];
    let curEnd = -Infinity;
    const flush = () => {
      if (!cur.length) return;
      sessions.push({
        source,
        start: Math.min(...cur.map(i => i.start)),
        end: Math.max(...cur.map(i => i.end)),
        asleepMs: unionMs(cur),
        deepMs: unionMs(cur.filter(i => i.deep)),
        remMs: unionMs(cur.filter(i => i.rem)),
        intervals: cur,
      });
      cur = [];
      curEnd = -Infinity;
    };
    for (const iv of intervals) {
      if (cur.length && iv.start - curEnd > SLEEP_SESSION_GAP_MS) flush();
      cur.push(iv);
      if (iv.end > curEnd) curEnd = iv.end;
    }
    flush();
  }
  return sessions.sort((a, b) => a.end - b.end);
}

/** Local-clock helpers injected for tests; production uses the device clock. */
export interface LocalClock {
  dateKey: (d: Date) => string;   // local YYYY-MM-DD
  hour: (d: Date) => number;      // local hour 0-23
}
export const deviceClock: LocalClock = {
  dateKey: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  hour: d => d.getHours(),
};

/**
 * The sleep day a bout belongs to: the local date it ENDS on — the wake date.
 * Nothing is re-dated forward, so sleep is never attributed to a day that has
 * not happened yet. (Revisions two through seven moved evening sleeps to the
 * next day so a broken night's pre-midnight half would rejoin it; bouts do that
 * by linking sessions instead, without inventing a future date.)
 */
export function sleepDayOf(session: { start: number; end: number }, clock: LocalClock): string {
  return clock.dateKey(new Date(session.end));
}

/**
 * A wake INSIDE the waking hours ended the sleep for good: an alarm at 05:30
 * means the 09:00 lie-down belongs to a different day's reckoning. A wake
 * outside them — 03:00, or an evening doze ending at 22:30 — did not.
 */
function wokeForTheDay(at: number, clock: LocalClock): boolean {
  const h = clock.hour(new Date(at));
  return h >= EARLY_WAKE_HOUR && h < EVENING_HOUR;
}

/** A wake in the small hours: you did not get up, you went back to sleep. */
function wokeInTheNight(at: number, clock: LocalClock): boolean {
  return clock.hour(new Date(at)) < EARLY_WAKE_HOUR;
}

/**
 * One tracker's sessions grouped into CHAINS — everything that belongs to the
 * same night's reckoning, so it is filed under one sleep day. Sessions chain
 * while they are within NIGHT_LINK_GAP_MS and no wake for the day separates
 * them, which is what keeps a 22:00–23:45 first half filed against the night it
 * began rather than vanishing onto the previous day. Oldest first.
 */
function sleepChains(sessions: ReadonlyArray<SleepSession>, clock: LocalClock): SleepSession[][] {
  const chains: SleepSession[][] = [];
  for (const s of [...sessions].sort((a, b) => a.start - b.start)) {
    const chain = chains[chains.length - 1];
    const prev = chain?.[chain.length - 1];
    if (prev && s.start - prev.end <= NIGHT_LINK_GAP_MS && !wokeForTheDay(prev.end, clock)) chain.push(s);
    else chains.push([s]);
  }
  return chains;
}

/**
 * One tracker's sessions merged into BOUTS — one continuous sleep each. Two
 * sessions are the same sleep only when the earlier one ended in the small
 * hours: waking at 03:00 and going back to bed at 06:30 is one broken night,
 * while a couch doze that ends at 21:30 is its own sleep however soon bed
 * follows. That matches what WHOOP's and Apple's own apps show for the same
 * night, which is what the user compares this card against.
 */
export function sleepBouts(sessions: ReadonlyArray<SleepSession>, clock: LocalClock = deviceClock): SleepSession[] {
  const bouts: SleepSession[] = [];
  for (const s of [...sessions].sort((a, b) => a.start - b.start)) {
    const prev = bouts[bouts.length - 1];
    const merged =
      prev != null &&
      s.start - prev.end <= NIGHT_LINK_GAP_MS &&
      wokeInTheNight(prev.end, clock);
    if (!merged) { bouts.push({ ...s, intervals: [...s.intervals] }); continue; }
    prev.intervals.push(...s.intervals);
    prev.end = Math.max(prev.end, s.end);
    prev.asleepMs = unionMs(prev.intervals);
    prev.deepMs = unionMs(prev.intervals.filter(i => i.deep));
    prev.remMs = unionMs(prev.intervals.filter(i => i.rem));
  }
  return bouts;
}

export interface SleepDayTracker {
  source: string;
  nightMs: number;   // union of the day's night sessions (0 = no night sleep from this tracker that day)
  napMs: number;     // union of the rest — reported separately, never folded into "last night"
  deepMs: number;    // night sessions only
  remMs: number;     // night sessions only
  start: number;     // earliest night-session start that day (NaN when nightMs is 0)
  end: number;       // latest night-session end that day (NaN when nightMs is 0)
}

/**
 * Whether a bout began at night — before mid-morning, or across midnight — and
 * therefore how much of it is needed before it can stand as a day's night.
 *
 * ONE predicate, deliberately. Through the seventh revision these were two
 * separate tests that could disagree: a 23:15-01:14 sleep counted as
 * night-shaped (it crossed midnight) but was held to the two-hour daytime
 * floor, so a real 1h59m night was dropped entirely and the card silently
 * showed the PREVIOUS day's night under the heading "last night" (council
 * pass 7, confirmed). Showing a stale number that looks plausible is a worse
 * failure than showing an unflattering true one.
 *
 * The cost of unifying them is recorded in KNOWN TRADE-OFFS below: a 90-minute
 * couch doze that happens to tip over midnight now reports as that day's sleep.
 * At 00:35 that is, in fairness, the most recent sleep the user has had.
 */
function startedAtNight(b: SleepSession, clock: LocalClock): boolean {
  return (
    clock.hour(new Date(b.start)) < MORNING_END_HOUR ||
    clock.dateKey(new Date(b.start)) !== clock.dateKey(new Date(b.end))
  );
}

/**
 * A sleep that began at night counts from MIN_FRAGMENT_MS — a 2h night is a
 * short night, and the 06:30-08:00 sleep after an all-nighter is that day's
 * sleep. Anything else has to reach LONE_SLEEP_MS, so a 40-minute doze or a
 * 90-minute afternoon nap can never stand in for a night, or hide the real one
 * on an earlier day.
 */
function nightFloor(b: SleepSession, clock: LocalClock): number {
  return startedAtNight(b, clock) ? MIN_FRAGMENT_MS : LONE_SLEEP_MS;
}

/**
 * Split one tracker's bouts for one sleep day into the night and the naps. The
 * night is the longest bout that began at night; failing that — an all-nighter,
 * a night shift — the longest bout that reaches LONE_SLEEP_MS. Everything else
 * is a nap. A day with no eligible bout has no night at all, and
 * summarizeLastNight then falls through to the previous day.
 */
function splitNightAndNaps(bouts: SleepSession[], clock: LocalClock): { night: SleepSession | null; naps: SleepSession[] } {
  const longestOf = (list: SleepSession[]) =>
    list.length ? list.reduce((a, b) => (b.asleepMs > a.asleepMs ? b : a)) : null;
  const eligible = bouts.filter(b => b.asleepMs >= nightFloor(b, clock));
  const night = longestOf(eligible.filter(b => startedAtNight(b, clock))) ?? longestOf(eligible);
  return { night, naps: night ? bouts.filter(b => b !== night) : bouts };
}

/**
 * Per sleep day, per tracker: that tracker's night sleep and nap time for the
 * day. Days are sorted ascending.
 */
export function sleepDays(
  samples: ReadonlyArray<SleepSample> | null | undefined,
  clock: LocalClock = deviceClock,
): Array<{ date: string; trackers: SleepDayTracker[] }> {
  // Sessions are linked into bouts per tracker BEFORE they are dated, so a
  // broken night is one bout and lands whole on the date it ended.
  const bySourceAll = new Map<string, SleepSession[]>();
  for (const s of sleepSessions(samples)) {
    const list = bySourceAll.get(s.source) ?? [];
    list.push(s);
    bySourceAll.set(s.source, list);
  }
  const perDay = new Map<string, Map<string, SleepSession[]>>();
  for (const [source, sessions] of bySourceAll) {
    for (const chain of sleepChains(sessions, clock)) {
      // The whole chain is filed under the day its LAST session ends on, so an
      // evening doze is that night's nap rather than the previous day's.
      const day = sleepDayOf(chain[chain.length - 1], clock);
      const bySource = perDay.get(day) ?? new Map<string, SleepSession[]>();
      const list = bySource.get(source) ?? [];
      list.push(...sleepBouts(chain, clock));
      bySource.set(source, list);
      perDay.set(day, bySource);
    }
  }
  const out: Array<{ date: string; trackers: SleepDayTracker[] }> = [];
  for (const [date, bySource] of perDay) {
    const trackers: SleepDayTracker[] = [];
    for (const [source, bouts] of bySource) {
      const { night, naps } = splitNightAndNaps(bouts, clock);
      trackers.push({
        source,
        nightMs: night ? night.asleepMs : 0,
        napMs: unionMs(naps.flatMap(x => x.intervals)),
        deepMs: night ? night.deepMs : 0,
        remMs: night ? night.remMs : 0,
        start: night ? night.start : NaN,
        end: night ? night.end : NaN,
      });
    }
    out.push({ date, trackers });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const mostNight = (trackers: SleepDayTracker[]) => trackers.reduce((a, b) => (b.nightMs > a.nightMs ? b : a));

export interface LastNightSleep {
  date: string;            // sleep day (wake date)
  asleepHours: number;     // night sleep only
  napHours: number;        // same tracker's naps that day, for a caption — not part of asleepHours
  deepHours: number;
  remHours: number;
  source: string;
  start: number;
  end: number;
}

/**
 * The most recent night's sleep from ONE tracker: the newest sleep day on
 * which some tracker has night sleep, reported by the tracker with the most
 * night sleep that day. Naps that day are returned alongside, never added in.
 * Returns null when no tracker has any (untruncated) night sleep in the samples.
 */
export function summarizeLastNight(
  samples: ReadonlyArray<SleepSample> | null | undefined,
  clock: LocalClock = deviceClock,
  opts: { windowStart?: number } = {},
): LastNightSleep | null {
  const days = sleepDays(samples, clock);
  for (let i = days.length - 1; i >= 0; i--) {
    // A night whose first sample sits at the query window's edge was cut by
    // the window (HealthKit returns the samples after the edge, not the
    // whole night); reporting it would show a number that shrinks by the hour.
    const withNight = days[i].trackers.filter(
      t => t.nightMs > 0 && (opts.windowStart == null || t.start >= opts.windowStart + WINDOW_EDGE_MS),
    );
    if (!withNight.length) continue;
    const t = mostNight(withNight);
    return {
      date: days[i].date,
      asleepHours: msToHours(t.nightMs),
      napHours: msToHours(t.napMs),
      deepHours: msToHours(t.deepMs),
      remHours: msToHours(t.remMs),
      source: t.source,
      start: t.start,
      end: t.end,
    };
  }
  return null;
}

/**
 * Night sleep per sleep day (naps excluded, so it matches the headline), each
 * day from the single tracker that recorded the most — never the sum of
 * trackers. `fromDate` (inclusive, same key format) drops the partial day the
 * widened query window can produce at the far end.
 */
export function sleepTrendByDay(
  samples: ReadonlyArray<SleepSample> | null | undefined,
  clock: LocalClock = deviceClock,
  fromDate?: string,
): Array<{ date: string; value: number }> {
  return sleepDays(samples, clock)
    .filter(d => !fromDate || d.date >= fromDate)
    .map(d => ({ date: d.date, value: msToHours(mostNight(d.trackers).nightMs) }))
    .filter(d => d.value > 0);
}
