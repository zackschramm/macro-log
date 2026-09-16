/**
 * Recovery score.
 *
 * This lived inside RecoveryScreen.tsx, where nothing could import it and so
 * nothing tested it. That is how a step function shipped with a cliff at
 * exactly five hours of sleep: 4h59m scored 0 sleep points, 5h00m scored 10.
 * On a night where HRV is missing the score is normalised over 60 points
 * rather than 100, so that one minute was worth 17 points of displayed score —
 * found live on a real night at 4h59m, which showed 33 instead of 49.
 *
 * Two properties matter here and are enforced by the tests:
 *   1. every component curve is CONTINUOUS — no input moves the score by a
 *      visible step, so a number never jumps for a reason the athlete cannot
 *      perceive;
 *   2. the score reports the basis it was computed from, because a score
 *      built from two components is not the same measurement as one built
 *      from three and must not be presented as though it were.
 */

export type RecoveryComponent = 'hrv' | 'rhr' | 'sleep';

export interface RecoveryInputs {
  hrv: number | null;        // ms
  restingHR: number | null;  // bpm
  sleepHours: number | null; // hours
}

export interface RecoveryScore {
  /** 0-100, or null when no component was available at all. */
  score: number | null;
  /** Which components actually contributed, in display order. */
  basis: RecoveryComponent[];
  /** Raw points available given the basis. 100 only when all three are present. */
  maxPossible: number;
}

export const COMPONENT_WEIGHTS: Record<RecoveryComponent, number> = {
  hrv: 40,
  rhr: 30,
  sleep: 30,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Linear interpolation across an ascending table of [x, y] anchor points.
 * Flat outside the table's ends — never extrapolates off a cliff.
 */
export function ramp(x: number, points: readonly (readonly [number, number])[]): number {
  if (!Number.isFinite(x) || points.length === 0) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

/** HRV in ms → 0-40. 20ms floor, 100ms ceiling. Already continuous; unchanged. */
export function hrvPoints(hrv: number): number {
  return clamp(((hrv - 20) / 80) * COMPONENT_WEIGHTS.hrv, 0, COMPONENT_WEIGHTS.hrv);
}

/** Resting HR in bpm → 0-30. 80bpm floor, 45bpm ceiling. Already continuous; unchanged. */
export function rhrPoints(restingHR: number): number {
  return clamp(((80 - restingHR) / 35) * COMPONENT_WEIGHTS.rhr, 0, COMPONENT_WEIGHTS.rhr);
}

/**
 * Sleep in hours → 0-30.
 *
 * Anchors are the OLD step function's own values, so a night that scored
 * correctly before still scores the same: 5h→10, 6h→20, 7h→30, 8.5h→30,
 * 10h→20. Everything between them is now interpolated instead of snapped
 * down to the band below, which is the actual fix.
 */
const SLEEP_ANCHORS = [
  [0, 0],
  // The old step function gave zero to everything under 5h, and a naive ramp
  // from [0,0] to [5,10] quietly handed 4 points to a two-hour night — a band
  // with no anchor in the original and no test. Hold zero to 3h so genuinely
  // destroyed sleep still scores nothing, then ramp. (Council P3.)
  [3, 0],
  [5, 10],
  [6, 20],
  [7, 30],
  [8.5, 30],
  [10, 20],
] as const;

export function sleepPoints(sleepHours: number): number {
  return clamp(ramp(sleepHours, SLEEP_ANCHORS), 0, COMPONENT_WEIGHTS.sleep);
}

export function calcRecoveryScore(d: RecoveryInputs): RecoveryScore {
  let points = 0;
  let maxPossible = 0;
  const basis: RecoveryComponent[] = [];

  if (d.hrv !== null && Number.isFinite(d.hrv)) {
    points += hrvPoints(d.hrv);
    maxPossible += COMPONENT_WEIGHTS.hrv;
    basis.push('hrv');
  }
  if (d.restingHR !== null && Number.isFinite(d.restingHR)) {
    points += rhrPoints(d.restingHR);
    maxPossible += COMPONENT_WEIGHTS.rhr;
    basis.push('rhr');
  }
  if (d.sleepHours !== null && Number.isFinite(d.sleepHours)) {
    points += sleepPoints(d.sleepHours);
    maxPossible += COMPONENT_WEIGHTS.sleep;
    basis.push('sleep');
  }

  if (maxPossible === 0) return { score: null, basis: [], maxPossible: 0 };
  return { score: Math.round((points / maxPossible) * 100), basis, maxPossible };
}

const COMPONENT_LABELS: Record<RecoveryComponent, string> = {
  hrv: 'HRV',
  rhr: 'resting HR',
  sleep: 'sleep',
};

/**
 * "from resting HR + sleep" — the caption shown under the ring whenever the
 * score is NOT the full three-component measurement. Null when all three are
 * present (nothing to disclose) or when there is no score at all.
 */
export function describeBasis(basis: RecoveryComponent[]): string | null {
  if (basis.length === 0 || basis.length === 3) return null;
  return `from ${basis.map((k) => COMPONENT_LABELS[k]).join(' + ')}`;
}

// ─── HRV availability ─────────────────────────────────────────────────────────

/**
 * Strip the "· <pref> has nothing recent" decoration sourceCaption() may add,
 * leaving the raw HealthKit sourceName.
 */
function rawSourceName(caption: string | undefined): string {
  return String(caption ?? '').split(' · ')[0].trim();
}

/**
 * Trackers CONFIRMED not to write HRV to Apple Health.
 *
 * WHOOP computes RMSSD while Apple Health stores SDNN, so WHOOP deliberately
 * omits HRV from its Health export while still writing resting HR, sleep,
 * blood oxygen and respiratory rate. That is a verified fact about one vendor,
 * and this list is the only thing the app is allowed to assert it about.
 *
 * It exists because the first version of this function named whatever source
 * happened to supply resting HR or sleep. Five independent review lenses
 * confirmed the same defect: an Apple Watch owner who simply left HRV off in
 * the Health permission sheet — HealthKit returns an empty array for a denied
 * read type, indistinguishable from no data, as this repo notes at
 * useHealthKit.ts:466 — was told "Apple Watch doesn't send HRV to Apple
 * Health". Apple Watch is the canonical writer of HealthKit SDNN. The app was
 * blaming the user's hardware for its own missing permission and steering
 * them away from the one screen that fixes it.
 *
 * Match is case-insensitive and substring-based because HealthKit sourceNames
 * carry device owners ("Zack's Apple Watch") and vendor casing varies.
 */
const KNOWN_NON_HRV_SOURCES = ['whoop'];

function isKnownNonHrvSource(source: string): boolean {
  const s = source.toLowerCase();
  return KNOWN_NON_HRV_SOURCES.some((k) => s.includes(k));
}

/** See HrvNote. Exported for tests; callers read `RecoveryData.hrvNote`. */
export function deriveHrvNote(d: {
  hrv: number | null;
  hrvTrend: { date: string; value: number }[];
  sources: Record<string, string>;
}): HrvNote | undefined {
  if (d.hrv !== null) return undefined;
  const last = d.hrvTrend[d.hrvTrend.length - 1];
  if (last) return { kind: 'stale', date: last.date, value: last.value };

  // Nothing for 7 days. Naming a tracker here is an assertion about that
  // vendor's export behaviour, so it is made ONLY for vendors we have
  // verified. For everyone else an empty window is exactly as consistent with
  // a denied HRV permission, a sparse week, or a tracker paired yesterday —
  // so say what is true (nothing arrived) and point at the setting that is
  // most often the actual cause, without blaming a device.
  const recoverySource = rawSourceName(d.sources['rhr']) || rawSourceName(d.sources['sleep']);
  if (recoverySource && isKnownNonHrvSource(recoverySource)) {
    return { kind: 'not-shared', source: recoverySource };
  }
  return { kind: 'none-recent' };
}

export type HrvNote =
  /** Nothing in the 36h window, but the 7-day trend still holds values. */
  | { kind: 'stale'; date: string; value: number }
  /**
   * Nothing wrote HRV for 7 days while another tracker IS writing recovery
   * data. WHOOP is the confirmed case: it computes RMSSD, Apple Health
   * stores SDNN, so WHOOP deliberately omits HRV from its Health export.
   * For those athletes HRV is not late — it is never arriving, and telling
   * them to wait is telling them to fix the one thing that isn't broken.
   */
  | { kind: 'not-shared'; source: string }
  /**
   * Nothing for 7 days and no verified explanation. Deliberately names no
   * tracker: an empty window cannot distinguish a tracker that never writes
   * HRV from a denied read permission or a sparse week.
   */
  | { kind: 'none-recent' };
