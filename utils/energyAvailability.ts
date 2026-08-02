/**
 * Energy availability (RED-S) — the shared safety layer. ARCHETYPE-AGNOSTIC.
 *
 * WHY THIS IS ITS OWN MODULE NOW
 * This was written inside `enduranceFueling.ts` and was therefore reachable
 * only by the ten endurance sports. It is the single most valuable thing in the
 * codebase and it is not endurance-specific in any way: it is a statement about
 * how much energy is left for physiology after training is paid for. A
 * bodybuilder in contest prep, a wrestler in a descent and a gymnast are the
 * populations MOST likely to breach it, and until this move none of them could
 * reach the check at all.
 *
 * Only the guard's PROMINENCE varies by archetype (see
 * `constants/sportArchetypes.ts` — `eaProminence`, `eaClamp`). The maths does
 * not vary, the threshold does not vary, and the floor is never a Pro feature:
 * daily targets and the entire safety layer are free in every packaging tier.
 * A guard is never paywalled.
 *
 * Zero runtime imports (see sessionEnergy.ts for why).
 */

/**
 * Energy availability is what's left for physiology after training is paid for,
 * normalised to the tissue that actually needs it:
 *
 *     EA = (intake - exercise energy expenditure) / fat-free mass
 *
 * Below 30 kcal/kg FFM/day is the clinical threshold for low energy
 * availability; sustained, it becomes RED-S — a multi-system problem affecting
 * bone density, endocrine function, immunity and performance. 45+ is optimal.
 *
 * This is the single most common serious nutrition problem in age-group
 * endurance sport, and almost no consumer app checks for it. Fuelog already
 * knows fat-free mass from InBody, so the check is nearly free.
 *
 * ── A property of this metric that looks like a bug and is not ──────────────
 *
 * An athlete eating exactly maintenance always has
 *
 *     EA = (maintenance − EEE) / FFM = (BMR × NEAT) / FFM
 *
 * which does not contain a training term at all. With Katch-McArdle
 * (BMR = 370 + 21.6·FFM) and a desk job (NEAT 1.25) that lands near
 *
 *     1.25 × (370/FFM + 21.6)  ≈  33-37 kcal/kg FFM
 *
 * for essentially every body size. So a healthy athlete eating maintenance sits
 * around 35 whether they trained for one hour or six, and CANNOT reach 45
 * without either eating a surplus or having a genuinely active non-training
 * life. Do not "fix" this by inflating the NEAT factors.
 *
 * The consequence for the product: 45 is a well-fuelled/surplus marker, not a
 * daily goal, and 30-45 must NOT produce a warning or the app cries wolf every
 * single day. Only `status === 'low'` is actionable — and it is reachable
 * exactly when it should be, by dieting on top of a heavy training load.
 * Use `shouldWarn` rather than testing the status string at call sites.
 *
 * ── One threshold worth NOT revisiting ──────────────────────────────────────
 *
 * EA_LOW = 30 derives largely from Loucks' work in women. The evidence in men
 * suggests a lower disruption threshold (~20-25 kcal/kg FFM), and the IOC's
 * 2023 REDs consensus frames energy availability as a spectrum with a risk
 * classification rather than a single cutoff. 30 stays in place for everyone
 * anyway: being conservative for men errs in the safe direction, one threshold
 * is far easier to explain than two, and the cost of that conservatism is a
 * small number of male athletes seeing a nudge they didn't strictly need.
 * Written down here so nobody "fixes" it later.
 */
export const EA_OPTIMAL = 45;
export const EA_LOW = 30;

export type EaStatus = 'optimal' | 'suboptimal' | 'low' | 'unknown';

export interface EnergyAvailability {
  value: number | null;
  status: EaStatus;
  /**
   * The only field the UI should gate a warning on. True below the clinical
   * threshold only — see the note above on why 30-45 is unremarkable.
   */
  shouldWarn: boolean;
  /** Extra kcal/day needed to clear the low-EA threshold. 0 when already clear. */
  deficitToLow: number;
  /** Extra kcal/day needed to reach optimal. 0 when already optimal. */
  deficitToOptimal: number;
}

const isPos = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

export function energyAvailability(
  intakeKcal: number,
  exerciseKcal: number,
  ffmKg: number | null | undefined
): EnergyAvailability {
  if (!isPos(ffmKg) || !isPos(intakeKcal)) {
    return {
      value: null, status: 'unknown', shouldWarn: false,
      deficitToLow: 0, deficitToOptimal: 0,
    };
  }
  const ex = Number.isFinite(exerciseKcal) && exerciseKcal > 0 ? exerciseKcal : 0;
  const ea = (intakeKcal - ex) / ffmKg;

  const status: EaStatus =
    ea >= EA_OPTIMAL ? 'optimal' : ea >= EA_LOW ? 'suboptimal' : 'low';

  return {
    value: Math.round(ea * 10) / 10,
    status,
    shouldWarn: status === 'low',
    deficitToLow: ea >= EA_LOW ? 0 : Math.round((EA_LOW - ea) * ffmKg),
    deficitToOptimal: ea >= EA_OPTIMAL ? 0 : Math.round((EA_OPTIMAL - ea) * ffmKg),
  };
}

/**
 * The lowest calorie target that keeps energy availability at or above the
 * clinical floor. Callers should clamp goal-adjusted targets to this — an app
 * should not prescribe a number that is known to be harmful.
 */
export function minimumSafeCalories(
  exerciseKcal: number,
  ffmKg: number | null | undefined
): number | null {
  if (!isPos(ffmKg)) return null;
  const ex = Number.isFinite(exerciseKcal) && exerciseKcal > 0 ? exerciseKcal : 0;
  return Math.round(EA_LOW * ffmKg + ex);
}

// ── The clamp ───────────────────────────────────────────────────────────────

export interface EaFloorInput {
  calories: number;
  exerciseKcal?: number;
  ffmKg?: number | null;
  /**
   * Soft clamps respect this. Hard clamps ignore it entirely — see
   * `nonOverridable`.
   */
  enforce?: boolean;
  /**
   * When true, `enforce` is ignored and the floor always applies.
   *
   * Set from `eaClampFor(sport)`. An override the user can find in three taps
   * is not a guard, and for the archetypes whose whole activity is driving
   * body mass down, the floor is not a preference. Athletes may override any
   * other computed number in this engine; safety floors are the exception.
   */
  nonOverridable?: boolean;
}

export interface EaFloorResult {
  /** The calorie figure to actually use, raised to the floor when required. */
  calories: number;
  /** True when the target was raised to clear the low-EA threshold. */
  raised: boolean;
  /** The floor itself, or null when fat-free mass is unknown. */
  floor: number | null;
}

/**
 * Apply the low-EA calorie floor. Every archetype's day-targets function routes
 * through this, so there is exactly one place the floor can be got wrong.
 *
 * Note the floor is only computable when fat-free mass is known. When it isn't,
 * nothing is clamped and `floor` is null — the honest answer, rather than
 * inventing a body-composition estimate to justify a safety number.
 */
export function applyEnergyAvailabilityFloor(input: EaFloorInput): EaFloorResult {
  const calories = isPos(input?.calories) ? input.calories : 0;
  const enforce = input?.nonOverridable === true || input?.enforce !== false;
  const floor = minimumSafeCalories(input?.exerciseKcal ?? 0, input?.ffmKg ?? null);

  if (!enforce || floor === null || calories <= 0 || calories >= floor) {
    return { calories, raised: false, floor };
  }
  return { calories: floor, raised: true, floor };
}
