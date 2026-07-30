/**
 * Weight trend analysis.
 *
 * Daily scale weight swings 3-5 lb on water, glycogen, sodium and cycle phase —
 * far more than a week of real fat loss. Showing users that raw number is a
 * leading cause of people abandoning tracking: they do everything right, wake up
 * heavier, and conclude it isn't working.
 *
 * Everything here works off a SMOOTHED signal instead. That same smoothed series
 * is the input adaptive TDEE and plateau detection will need later, so this is
 * deliberately a standalone, dependency-free module (no React, no Supabase) —
 * which also makes it testable with `npm test`.
 */

export interface WeighIn {
  /** YYYY-MM-DD */
  date: string;
  /** lb */
  weight: number;
}

export interface TrendPoint {
  date: string;
  /** The raw reading that day */
  raw: number;
  /** Smoothed trend value */
  trend: number;
}

export type TrendDirection = 'losing' | 'gaining' | 'holding';

export interface WeightTrend {
  points: TrendPoint[];
  /** Latest smoothed weight — the number worth showing the user. */
  current: number | null;
  /** Smoothed lb/week. Negative = losing. */
  ratePerWeek: number | null;
  direction: TrendDirection;
  /** Total smoothed change over the window. */
  totalChange: number | null;
  /** How far the newest raw reading sits from trend — powers "that's water". */
  deviation: number | null;
  daysTracked: number;
  /** False until there's enough spread to say anything honest. */
  hasEnoughData: boolean;
}

/**
 * Half-life in days for the exponential smoothing.
 *
 * ~10 days is the usual choice for bodyweight: long enough to swallow a salty
 * meal or a bad night's sleep, short enough that a real 2-week trend still shows
 * up. Shorter and you're just redrawing the noise; longer and users think the
 * app is ignoring them.
 */
const HALF_LIFE_DAYS = 10;

/** Minimum span before any rate claim is honest. */
const MIN_DAYS_FOR_RATE = 10;
const MIN_POINTS_FOR_RATE = 4;

/** Below this, call it "holding" rather than implying a direction. */
const FLAT_THRESHOLD_LB_PER_WEEK = 0.15;

/** Milestone step, in the unit the trend was built in. */
const MILESTONE_STEP_KG = 2;

function daysBetween(a: string, b: string): number {
  const ms = new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime();
  return ms / 86400000;
}

/** One time-aware exponential pass. Gaps widen alpha, so an entry after a long
 *  break correctly counts for more than one taken an hour later. */
function ewmaPass(vals: number[], gaps: number[]): number[] {
  const out = new Array<number>(vals.length);
  let t = vals[0];
  out[0] = t;
  for (let i = 1; i < vals.length; i++) {
    // after one half-life the new reading and the running trend weigh the same
    const alpha = 1 - Math.pow(0.5, Math.max(gaps[i], 0) / HALF_LIFE_DAYS);
    t = t + alpha * (vals[i] - t);
    out[i] = t;
  }
  return out;
}

/**
 * Zero-lag smoothing (forward pass, then backward over the result).
 *
 * A single EWMA pass always lags — during a steady 1 lb/week loss the smoothed
 * line trails the real one by over a pound, which made the rate read ~30% low
 * and made every normal reading look like a "deviation". Because this is
 * historical data, not a forecast, we're allowed to look ahead: filtering
 * forwards then backwards cancels the phase shift and centres the line in the
 * data. (Standard zero-phase / filtfilt technique.)
 */
export function smoothWeights(weighIns: WeighIn[]): TrendPoint[] {
  const sorted = [...weighIns]
    .filter(w => Number.isFinite(w.weight) && w.weight > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return [];
  if (sorted.length === 1) {
    return [{ date: sorted[0].date, raw: sorted[0].weight, trend: sorted[0].weight }];
  }

  const vals = sorted.map(w => w.weight);
  const gaps = sorted.map((w, i) => i === 0 ? 0 : daysBetween(sorted[i - 1].date, w.date));

  const fwd = ewmaPass(vals, gaps);

  // Backward pass: reverse the series, and shift gaps so each step still sees
  // the interval it actually spans.
  const revVals = [...fwd].reverse();
  const revGaps = gaps.slice(1).reverse();
  revGaps.unshift(0);
  const back = ewmaPass(revVals, revGaps).reverse();

  return sorted.map((w, i) => ({ date: w.date, raw: w.weight, trend: back[i] }));
}

/**
 * Least-squares slope in lb/week, computed from the RAW readings.
 *
 * Deliberately not from the smoothed series: OLS is already noise-tolerant and
 * unbiased, whereas regressing a smoothed series inherits the smoother's
 * attenuation and reports a slower rate than the user is actually achieving.
 */
function regress(points: TrendPoint[]): { slopePerDay: number; intercept: number } | null {
  if (points.length < 2) return null;
  const t0 = points[0].date;
  const xs = points.map(p => daysBetween(t0, p.date));
  const ys = points.map(p => p.raw);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;          // all readings on one day
  const slopePerDay = num / den;
  return { slopePerDay, intercept: meanY - slopePerDay * meanX };
}

function slopePerWeek(points: TrendPoint[]): number | null {
  const r = regress(points);
  return r === null ? null : r.slopePerDay * 7;
}

/** Recent window used to judge whether today's reading is unusual. */
const DEVIATION_WINDOW_DAYS = 21;

/**
 * How far today's reading sits from where the recent trend says it should be.
 *
 * Measured against a short-window regression rather than the smoothed line's
 * final value: the backward smoothing pass has no data after the last point, so
 * that endpoint always lags. On a steady 0.1 lb/day decline that lag alone read
 * as a 1 lb "deviation" and would have fired the water-weight message every
 * single day. Regression has no such endpoint bias.
 */
function deviationFromTrend(points: TrendPoint[]): number | null {
  if (points.length < 3) return null;
  const last = points[points.length - 1];
  const recent = points.filter(p => daysBetween(p.date, last.date) <= DEVIATION_WINDOW_DAYS);
  if (recent.length < 3) return null;

  const r = regress(recent);
  if (r === null) return null;
  const x = daysBetween(recent[0].date, last.date);
  return last.raw - (r.intercept + r.slopePerDay * x);
}

export function analyzeWeightTrend(weighIns: WeighIn[], windowDays = 90): WeightTrend {
  const all = smoothWeights(weighIns);

  const empty: WeightTrend = {
    points: [], current: null, ratePerWeek: null, direction: 'holding',
    totalChange: null, deviation: null, daysTracked: 0, hasEnoughData: false,
  };
  if (all.length === 0) return empty;

  // Trim to the window, but smooth over the full history first so the trend
  // enters the window already warmed up rather than resetting to a raw value.
  const last = all[all.length - 1];
  const points = all.filter(p => daysBetween(p.date, last.date) <= windowDays);
  if (points.length === 0) return empty;

  const first = points[0];
  const daysTracked = Math.round(daysBetween(first.date, last.date));
  const hasEnoughData =
    points.length >= MIN_POINTS_FOR_RATE && daysTracked >= MIN_DAYS_FOR_RATE;

  const rate = hasEnoughData ? slopePerWeek(points) : null;
  const direction: TrendDirection =
    rate === null || Math.abs(rate) < FLAT_THRESHOLD_LB_PER_WEEK
      ? 'holding'
      : rate < 0 ? 'losing' : 'gaining';

  return {
    points,
    current: round1(last.trend),
    ratePerWeek: rate === null ? null : round2(rate),
    direction,
    // From the regression, not (last.trend - first.trend): the backward
    // smoothing pass pulls both endpoints toward the middle of the data, which
    // systematically understates how much the user actually moved.
    totalChange: rate === null ? null : round1((rate / 7) * daysTracked),
    deviation: (() => { const d = deviationFromTrend(points); return d === null ? null : round1(d); })(),
    daysTracked,
    hasEnoughData,
  };
}

/**
 * Plain-language explanation of the gap between today's scale reading and the
 * trend. This is the actual anti-quitting mechanism — the message someone needs
 * on the morning the scale jumped 3 lb overnight.
 */
export function explainDeviation(trend: WeightTrend, unit = 'lbs'): string | null {
  if (trend.deviation === null || trend.points.length < 3) return null;
  // Threshold scales with the unit — 0.8 kg is nearly 2 lb, so a fixed number
  // would either spam imperial users or stay silent for metric ones.
  const threshold = unit === 'kg' ? 0.4 : 0.8;
  const d = trend.deviation;
  if (Math.abs(d) < threshold) return null;
  const dir = d > 0 ? 'above' : 'below';
  // Neutral wording: "not fat" only makes sense to someone cutting.
  return (
    `Today's reading is ${Math.abs(d).toFixed(1)} ${unit} ${dir} your trend — ` +
    `that's normal day-to-day water shift, not a real change in body ` +
    `composition. Watch the trend line.`
  );
}

/** Headline summary, e.g. "Down 1.2 lbs/week over 6 weeks". */
export function describeTrend(trend: WeightTrend, unit = 'lbs'): string {
  if (!trend.hasEnoughData) {
    const need = Math.max(0, MIN_POINTS_FOR_RATE - trend.points.length);
    return need > 0
      ? `Log ${need} more weigh-in${need === 1 ? '' : 's'} to see your trend`
      : 'Keep logging — your trend needs about 10 days';
  }
  const rate = trend.ratePerWeek ?? 0;
  const weeks = Math.max(1, Math.round(trend.daysTracked / 7));
  const span = `over ${weeks} week${weeks === 1 ? '' : 's'}`;
  if (trend.direction === 'holding') return `Holding steady ${span}`;
  const verb = trend.direction === 'losing' ? 'Down' : 'Up';
  return `${verb} ${Math.abs(rate).toFixed(1)} ${unit}/week ${span}`;
}

// ── Milestones ──────────────────────────────────────────────────────────────

export type MilestoneKind =
  | 'first_trend'        // enough data to show a trend at all
  | 'weight_change'      // every 5 lb of smoothed change
  | 'consistency'        // sustained logging
  | 'goal_reached';

export interface Milestone {
  kind: MilestoneKind;
  /** Stable id so a milestone is only ever celebrated once. */
  key: string;
  title: string;
  detail: string;
  /** Genuine success moments — the right places to ask for a review. */
  reviewWorthy: boolean;
}

const MILESTONE_STEP_LB = 5;

/**
 * Milestones earned as of now. Caller filters against what's already been shown.
 *
 * Deliberately based on the SMOOTHED value: celebrating a raw reading would fire
 * on a dehydrated morning and then look wrong the next day, which is worse than
 * not celebrating at all.
 */
export function detectMilestones(
  trend: WeightTrend,
  opts?: {
    goalWeight?: number | null;
    goalDirection?: 'lose' | 'gain' | 'maintain';
    /** Unit the trend was built in — affects step size and copy. */
    unit?: string;
  }
): Milestone[] {
  const out: Milestone[] = [];
  if (!trend.hasEnoughData || trend.current === null || trend.totalChange === null) return out;
  const unit = opts?.unit ?? 'lbs';
  const step = unit === 'kg' ? MILESTONE_STEP_KG : MILESTONE_STEP_LB;

  out.push({
    kind: 'first_trend',
    key: 'first_trend',
    title: 'Your trend is live',
    detail: 'Enough weigh-ins to see through the daily noise. This is the number that matters.',
    reviewWorthy: false,
  });

  const steps = Math.floor(Math.abs(trend.totalChange) / step);
  if (steps >= 1) {
    const amount = steps * step;
    const down = trend.totalChange < 0;
    out.push({
      kind: 'weight_change',
      key: `weight_${down ? 'down' : 'up'}_${amount}${unit}`,
      title: `${amount} ${unit} ${down ? 'down' : 'up'}`,
      detail: `Your trend weight has moved ${amount} ${unit} over ${Math.round(trend.daysTracked / 7)} weeks.`,
      reviewWorthy: true,
    });
  }

  if (trend.daysTracked >= 30 && trend.points.length >= 12) {
    out.push({
      kind: 'consistency',
      key: 'consistency_30d',
      title: '30 days of tracking',
      detail: 'A month of consistent weigh-ins. Consistency is what makes the trend trustworthy.',
      reviewWorthy: true,
    });
  }

  const goal = opts?.goalWeight;
  if (goal && opts?.goalDirection && opts.goalDirection !== 'maintain') {
    const reached = opts.goalDirection === 'lose'
      ? trend.current <= goal
      : trend.current >= goal;
    if (reached) {
      out.push({
        kind: 'goal_reached',
        key: `goal_${goal}${unit}`,
        title: 'Goal weight reached',
        detail: `Your trend weight hit ${goal} ${unit}. That's the real thing, not a scale fluke.`,
        reviewWorthy: true,
      });
    }
  }

  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
