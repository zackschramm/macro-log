/**
 * Sport -> archetype taxonomy, and what each archetype's model actually supports.
 *
 * WHY THIS EXISTS
 * The engine used to branch on a hardcoded set:
 *
 *     export const ENDURANCE_SPORTS = new Set([...]);
 *     if (isEnduranceSport(sport)) { ...the whole triathlon engine... }
 *
 * That works for two branches. It does not work for six, and it especially
 * doesn't work when the real question is not "is this sport X" but "does this
 * athlete's model include a sweat-rate field". A powerlifter must never see
 * "trained carb rate (g/h)"; a yoga user must never see a periodized carb
 * curve. Those are capability questions, so this file answers them with a
 * capability record rather than a sport-name comparison.
 *
 * Adding a sport is one row in SPORT_ARCHETYPES. Adding a capability is one
 * field the compiler will point at in all six records.
 *
 * DELIBERATELY ZERO RUNTIME IMPORTS, same rule as `constants/data.ts` and the
 * `utils/session*` engine modules — it keeps the test runner able to load the
 * whole engine tree without React Native.
 *
 * Pure data and pure lookups. No behaviour lives here.
 */

// ── The six archetypes ──────────────────────────────────────────────────────

/**
 * Each archetype has a genuinely different dominant nutrition variable. They
 * are not intensity tiers of one another, which is why widening the endurance
 * model's parameters would have been the wrong answer:
 *
 *   endurance     glycogen depleted per session; swings ~4x day to day
 *   strength      total energy sufficiency and protein DISTRIBUTION
 *   intermittent  glycogen, but on a weekly match calendar
 *   physique      the RATE of body-mass change, and whether lean mass survives
 *   weightClass   a declared number on a declared date, then performing after
 *   lowLoad       nothing much — say so and get out of the way
 */
export type Archetype =
  | 'endurance'
  | 'strength'
  | 'intermittent'
  | 'physique'
  | 'weightClass'
  | 'lowLoad';

export const ARCHETYPES: readonly Archetype[] = [
  'endurance', 'strength', 'intermittent', 'physique', 'weightClass', 'lowLoad',
] as const;

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  endurance:    'Endurance',
  strength:     'Strength & power',
  intermittent: 'Team & intermittent',
  physique:     'Physique & weight-sensitive',
  weightClass:  'Weight-class & combat',
  lowLoad:      'Low-load',
};

// ── Capability vocabulary ───────────────────────────────────────────────────

/** How the daily carbohydrate number is arrived at. */
export type CarbModel =
  | 'endurance'      // periodized 3-12 g/kg curve, protected first
  | 'strength'       // flat 3-7 g/kg curve, residual under the protein/fat floors
  | 'intermittent'   // 3-8 g/kg curve with match-day floors on top
  | 'residual'       // no curve at all; carbohydrate is what's left above a floor
  | 'none';          // no carbohydrate model — show the general macro engine

/**
 * Which macro is reserved first. The endurance module flipped this to
 * carbohydrate-first because carbohydrate is the performance-limiting macro in
 * that population. It is the ONLY archetype where that is true. Do not
 * propagate the flip: for every other archetype the app's original
 * protein-first allocation is already correct.
 */
export type AllocationOrder = 'carbFirst' | 'proteinFirst';

/** What "race day" is called, and therefore which planner (if any) applies. */
export type EventModel = 'race' | 'meet' | 'match' | 'weighIn' | 'show' | 'round' | 'none';

/**
 * How fuel gets in during competition.
 *   rate     a g/h absorption problem (endurance, golf's round)
 *   windows  an OPPORTUNITY problem — the constraint is when you're allowed to
 *            eat, not what the gut can take (half time, changeovers, timeouts)
 *   none     nothing meaningful happens during the event
 */
export type InEventFueling = 'rate' | 'windows' | 'none';

/** How training is periodized, and therefore what the phase picker offers. */
export type PhaseModel =
  | 'seasonal'    // base / build / peak / taper / race week
  | 'block'       // accumulation / intensification / realization / deload
  | 'matchWeek'   // MD-3 ... MD ... MD+1, derived from the next fixture
  | 'prep'        // off-season / prep / peak week / reverse
  | 'camp'        // off-season / camp / descent / recovery
  | 'none';

/**
 * How loudly the energy-availability card is shown. A SEPARATE AXIS from
 * archetype on purpose: the populations that need the guard most do not map
 * cleanly onto one archetype. Physique and weight-class obviously, but also
 * climbing, gymnastics, and the distance-running / cycling / long-course
 * triathlon population, all of whom carry a power-to-weight incentive.
 */
export type EaProminence = 'headline' | 'standard' | 'quiet';

/**
 * Whether the low-energy-availability calorie floor can be switched off.
 *
 *   hard   non-overridable. The caller's `enforce` flag is ignored.
 *   soft   respected once acknowledged.
 *
 * An override a user can find in three taps is not a guard. Note the floor
 * itself is FREE in every packaging tier — a safety layer is never paywalled.
 */
export type EaClamp = 'hard' | 'soft';

/**
 * What kind of body-mass planning the archetype's model contemplates.
 *
 *   none        no weight-management surface at all
 *   gradual     a capped rate of change over weeks (physique)
 *   makeWeight  a declared number on a declared date (weight-class)
 *
 * NOTE this is what the TAXONOMY declares, not what ships. See
 * `weightManagementSurfaceFor()` and DEFERRED_ARCHETYPES below.
 */
export type WeightManagement = 'none' | 'gradual' | 'makeWeight';

export interface ArchetypeCapabilities {
  carbModel: CarbModel;
  allocationOrder: AllocationOrder;
  eventModel: EventModel;
  inEventFueling: InEventFueling;
  /**
   * Does this athlete have an in-event carbohydrate RATE in g/h?
   *
   * False for strength: a meet is snacks between attempts, not a rate. This is
   * the single most load-bearing `false` in the table — it is what keeps
   * "trained carb tolerance (g/h)" off a powerlifter's profile screen.
   */
  carbRatePerHour: boolean;
  phaseModel: PhaseModel;
  showsGutTraining: boolean;
  showsSweatRate: boolean;
  eaProminence: EaProminence;
  eaClamp: EaClamp;
  weightManagement: WeightManagement;
}

// ── The table ───────────────────────────────────────────────────────────────

/**
 * Per-archetype defaults. Sport-level exceptions live in
 * SPORT_CAPABILITY_OVERRIDES, and there are deliberately very few of them —
 * an exception per sport would just be the hardcoded set again with more steps.
 */
export const ARCHETYPE_CAPABILITIES: Record<Archetype, ArchetypeCapabilities> = {
  endurance: {
    carbModel: 'endurance',
    allocationOrder: 'carbFirst',
    eventModel: 'race',
    inEventFueling: 'rate',
    carbRatePerHour: true,
    phaseModel: 'seasonal',
    showsGutTraining: true,
    showsSweatRate: true,
    eaProminence: 'standard',
    eaClamp: 'soft',
    weightManagement: 'none',
  },

  strength: {
    carbModel: 'strength',
    allocationOrder: 'proteinFirst',
    eventModel: 'meet',
    // A meet is nine maximal attempts spread over six to ten hours with
    // twenty-minute waits. It is a blood-glucose, hydration and
    // don't-be-bloated problem, not an absorption-rate problem.
    inEventFueling: 'none',
    carbRatePerHour: false,
    phaseModel: 'block',
    showsGutTraining: false,   // nothing to train
    showsSweatRate: false,     // low value; deliberately not shown
    eaProminence: 'standard',
    eaClamp: 'soft',
    weightManagement: 'none',
  },

  intermittent: {
    carbModel: 'intermittent',
    allocationOrder: 'proteinFirst',
    eventModel: 'match',
    inEventFueling: 'windows',
    carbRatePerHour: false,
    phaseModel: 'matchWeek',
    showsGutTraining: false,
    // Hockey and American football in full gear produce losses at or above
    // Ironman rates over a much shorter window. Higher value here than in
    // endurance, and `sweatRateLPerH()` needs no changes at all.
    showsSweatRate: true,
    eaProminence: 'standard',
    eaClamp: 'soft',
    weightManagement: 'none',
  },

  physique: {
    // No curve. Carbohydrate is residual under a floor, because the number
    // being optimised here is body mass, not glycogen.
    carbModel: 'residual',
    allocationOrder: 'proteinFirst',
    eventModel: 'show',
    inEventFueling: 'none',
    carbRatePerHour: false,
    phaseModel: 'prep',
    showsGutTraining: false,
    showsSweatRate: false,
    // The headline, not a footnote. Disordered eating is elevated across
    // athletic populations and highest in leanness-dependent and aesthetic
    // sports, and this archetype is where the app is most able to do harm.
    eaProminence: 'headline',
    eaClamp: 'hard',
    weightManagement: 'gradual',
  },

  weightClass: {
    carbModel: 'intermittent',   // the TRAINING-day model is archetype C's
    allocationOrder: 'proteinFirst',
    eventModel: 'weighIn',
    inEventFueling: 'none',
    carbRatePerHour: false,
    phaseModel: 'camp',
    showsGutTraining: false,
    // High value, but ONLY for planning the refuel after the scale. It must
    // never be exposed as an input to cut planning.
    showsSweatRate: true,
    eaProminence: 'headline',
    // NOTE: the design recommended a HARD clamp here alongside physique. The
    // approved decision for this build is hard for physique, soft elsewhere,
    // and nothing weight-class-specific ships yet (see DEFERRED_ARCHETYPES),
    // so nothing depends on this value today. Revisit as part of the
    // professional review that gates archetype E.
    eaClamp: 'soft',
    weightManagement: 'makeWeight',
  },

  lowLoad: {
    carbModel: 'none',
    allocationOrder: 'proteinFirst',
    // Default is no event at all. Golf is the single exception and overrides
    // this below. Resisting the urge to build more here is part of the design.
    eventModel: 'none',
    inEventFueling: 'none',
    carbRatePerHour: false,
    phaseModel: 'none',
    showsGutTraining: false,
    showsSweatRate: false,
    eaProminence: 'quiet',
    eaClamp: 'soft',
    weightManagement: 'none',
  },
};

// ── Sport assignment ────────────────────────────────────────────────────────

/**
 * All 26 sport keys, assigned. No sport is unassigned and none is in two
 * places — `sportArchetypes.test.ts` fails the build if that stops being true.
 *
 * Keys match `profiles.sport`, `SPORT_MULTIPLIERS` and `SPORT_PROFILES`.
 */
export const SPORT_ARCHETYPES: Record<string, Archetype> = {
  // A — Endurance (10). Glycogen availability across continuous work measured
  // in hours. Carbohydrate is performance-limiting and is protected first.
  triathlon:    'endurance',
  tri_sprint:   'endurance',
  tri_olympic:  'endurance',
  tri_70_3:     'endurance',
  tri_ironman:  'endurance',
  running:      'endurance',
  cycling:      'endurance',
  swimming:     'endurance',
  rowing:       'endurance',
  hiking:       'endurance',

  // B — Strength & power (2). Total energy sufficiency and protein
  // distribution. `none` (general fitness) sits here deliberately: general
  // -fitness users are, nutritionally, low-volume strength athletes, and the
  // app's existing protein-first allocation is already correct for them.
  powerlifting: 'strength',
  none:         'strength',

  // C — Intermittent / team (8). Repeated high-intensity efforts inside a
  // fixed-length competition, on a weekly match calendar. CrossFit sits here
  // because its event is a competition day of multiple efforts — structurally
  // a match day, not a race.
  basketball:   'intermittent',
  soccer:       'intermittent',
  football:     'intermittent',
  baseball:     'intermittent',
  tennis:       'intermittent',
  volleyball:   'intermittent',
  hockey:       'intermittent',
  crossfit:     'intermittent',

  // D — Physique & weight-sensitive (3). For bodybuilding body composition IS
  // the outcome; for gymnastics and climbing it is instrumental
  // (strength-to-weight). Either way the number being optimised is body mass.
  bodybuilding: 'physique',
  gymnastics:   'physique',
  climbing:     'physique',

  // E — Weight-class / combat (1). Assigned, but its distinctive tooling is
  // deliberately NOT built. See DEFERRED_ARCHETYPES.
  wrestling:    'weightClass',

  // F — Low-load / general (2). Training energy cost is low and there is no
  // fuel constraint on performance.
  yoga:         'lowLoad',
  golf:         'lowLoad',
};

/**
 * The handful of places where a single sport genuinely differs from its
 * archetype's defaults. Kept short on purpose.
 */
export const SPORT_CAPABILITY_OVERRIDES: Record<string, Partial<ArchetypeCapabilities>> = {
  // Power-to-weight incentive. These athletes' FUELLING model is endurance,
  // but they belong to the same risk population as physique athletes, which is
  // exactly why EA prominence is a separate axis from archetype.
  running:     { eaProminence: 'headline' },
  cycling:     { eaProminence: 'headline' },
  tri_ironman: { eaProminence: 'headline' },

  // The one court sport that really is an endurance problem. Five-hour matches
  // exist, and 30-60 g/h across one is a gut-training problem like any other.
  tennis:      { showsGutTraining: true },

  // Golf is the low-load archetype's single exception: a 4-5 hour walked round
  // is a genuine 1,200-1,800 kcal expenditure with a real blood-glucose and
  // hydration problem. Nothing else in this archetype gets an event.
  golf:        { eventModel: 'round', inEventFueling: 'rate', carbRatePerHour: true },
};

// ── The deferred weight-class seam ──────────────────────────────────────────

/**
 * ARCHETYPE E IS ASSIGNED BUT NOT BUILT. THIS IS DELIBERATE.
 *
 * `wrestling` keeps its weightClass assignment above because the taxonomy
 * should describe the sport honestly. What is NOT built, in any form:
 *
 *   - minimum competitive weight (the 5% / 12% body-fat floor)
 *   - the capped descent planner and its "move class or move date" output
 *   - the post-weigh-in refuel table
 *   - any target-weight or weigh-in-date field
 *
 * Until that ships, a wrestler gets the daily training model and no weigh-in
 * tooling whatsoever — which is a clean, shippable outcome in its own right.
 *
 * WHEN IT IS BUILT, THESE CONDITIONS COME WITH IT. They are recorded here
 * rather than in a document because this is the file the next person will read:
 *
 *   1. Professional review first. This archetype's floors are borrowed from
 *      the NCAA and NFHS wrestling weight-certification programmes, which
 *      exist because three US collegiate wrestlers died within six weeks of
 *      each other in late 1997 attempting rapid cuts. Borrowing their numbers
 *      for credibility while shipping without review is not a position that
 *      survives being stated out loud.
 *   2. 18+ only. Wrestling in the US is overwhelmingly a high-school sport.
 *      See MIN_AGE_FOR_WEIGHT_MANAGEMENT. Under-18 users get the training-day
 *      model and growth/maintenance framing, with no target-weight field at
 *      all — not a disabled one, an absent one.
 *   3. No rapid-cut machinery, ever. No water loading/cutting, no sauna or
 *      sweat-suit scheduling, no diuretics (including merely listing them), no
 *      "how much can I cut in 24 hours" estimator, no sodium depletion.
 *      Fuelog plans the weight you can hold.
 *   4. The refusals are the product. A target below the minimum competitive
 *      weight produces no plan; a descent above the cap produces the decision
 *      ("move up a class, or give it more time"), not a faster plan.
 *
 * `powerlifting` is designed to borrow this same overlay when a competition
 * weight is declared, while its daily model stays archetype B. That overlay is
 * deferred with the rest of it — which is why the strength model in
 * `utils/strengthFueling.ts` has no target-weight input.
 */
export const DEFERRED_ARCHETYPES: readonly Archetype[] = ['weightClass'] as const;

export function isArchetypeDeferred(a: Archetype): boolean {
  return DEFERRED_ARCHETYPES.indexOf(a) !== -1;
}

/**
 * Minimum age for ANY weight-management surface. Nothing consumes this yet
 * because no such surface exists — it is defined now so that the first one
 * built cannot be built without it.
 */
export const MIN_AGE_FOR_WEIGHT_MANAGEMENT = 18;

// ── Lookups ─────────────────────────────────────────────────────────────────

/** Sports we don't recognise fall through to general fitness, same as elsewhere. */
export const DEFAULT_ARCHETYPE: Archetype = 'strength';

export function archetypeOf(sport?: string | null): Archetype {
  if (!sport) return DEFAULT_ARCHETYPE;
  return SPORT_ARCHETYPES[sport] ?? DEFAULT_ARCHETYPE;
}

/** Every sport assigned to an archetype, in declaration order. */
export function sportsInArchetype(a: Archetype): string[] {
  return Object.keys(SPORT_ARCHETYPES).filter(k => SPORT_ARCHETYPES[k] === a);
}

/** Archetype defaults with any sport-level override applied. */
export function capabilitiesFor(sport?: string | null): ArchetypeCapabilities {
  const base = ARCHETYPE_CAPABILITIES[archetypeOf(sport)];
  const override = sport ? SPORT_CAPABILITY_OVERRIDES[sport] : undefined;
  return override ? { ...base, ...override } : base;
}

/**
 * Which archetype's DAILY model to run for this sport today.
 *
 * Identical to `archetypeOf` except for deferred archetypes, whose daily model
 * falls back to the nearest built neighbour. A wrestler's training-day
 * requirements are archetype C's — it is only the descent and the weigh-in
 * that are distinctive, and neither of those ships.
 */
export function dailyModelArchetypeFor(sport?: string | null): Archetype {
  const a = archetypeOf(sport);
  return a === 'weightClass' ? 'intermittent' : a;
}

export function eaProminenceFor(sport?: string | null): EaProminence {
  return capabilitiesFor(sport).eaProminence;
}

export function eaClampFor(sport?: string | null): EaClamp {
  return capabilitiesFor(sport).eaClamp;
}

/**
 * What weight-management surface this sport may show TODAY.
 *
 * Always 'none' for a deferred archetype regardless of what the taxonomy
 * declares. Gate UI on this, never on `capabilities.weightManagement` — the
 * latter is a description of the design, this is a description of what exists.
 */
export function weightManagementSurfaceFor(sport?: string | null): WeightManagement {
  const a = archetypeOf(sport);
  if (isArchetypeDeferred(a)) return 'none';
  return ARCHETYPE_CAPABILITIES[a].weightManagement;
}

/**
 * Sports for which the scale going down must never be celebrated — no
 * achievement, no streak, no milestone. Rewarding a falling number is the
 * exact reinforcement loop these populations don't need.
 *
 * Physique and weight-class by archetype, plus the power-to-weight endurance
 * sports, which is precisely the `eaProminence === 'headline'` population.
 */
export function suppressesWeightLossCelebration(sport?: string | null): boolean {
  return eaProminenceFor(sport) === 'headline';
}

// ── The Profile link row ────────────────────────────────────────────────────

export interface EventRow {
  label: string;
  sub: string;
}

/**
 * One row whose label and destination come from `eventModel`, replacing the
 * hardcoded "Race Fuel Plan" branch. `none` means the row is hidden.
 *
 * PACKAGING: every one of these planners is a Pro feature. The daily targets
 * and the ENTIRE safety layer behind them — energy availability, warnings,
 * floors — are free. A guard is never gated.
 */
export const EVENT_ROW: Record<EventModel, EventRow | null> = {
  race:    { label: 'Race Fuel Plan', sub: 'Carbs, fluid & sodium leg by leg' },
  meet:    { label: 'Meet Day Plan',  sub: 'Attempts, timing & caffeine' },
  match:   { label: 'Match Day Plan', sub: 'Before, half-time & after' },
  weighIn: { label: 'Weigh-In Plan',  sub: 'Making weight, then refuelling' },
  show:    { label: 'Show Week',      sub: 'Carb load & final week' },
  round:   { label: 'Round Plan',     sub: 'Fuel and fluid across 18' },
  none:    null,
};

/**
 * The event planner row for a sport, or null when there isn't one.
 *
 * Returns null for deferred archetypes too — a wrestler sees no weigh-in row
 * because there is no weigh-in planner behind it.
 */
export function eventRowFor(sport?: string | null): EventRow | null {
  if (isArchetypeDeferred(archetypeOf(sport))) return null;
  return EVENT_ROW[capabilitiesFor(sport).eventModel];
}

// ── Back-compat ─────────────────────────────────────────────────────────────

/**
 * Thin wrapper over the taxonomy, kept because `ProfileScreen`, `TrialEndingCard`
 * and `buildCoachContext` all call it. It replaces the old hardcoded
 * ENDURANCE_SPORTS set — same answer, one source of truth.
 *
 * New call sites should prefer `capabilitiesFor(sport)` and ask about the
 * capability they actually care about.
 */
export const isEnduranceSport = (sport?: string | null): boolean =>
  !!sport && archetypeOf(sport) === 'endurance';

/** Covers `powerlifting` and `none` — very likely the plurality of users. */
export const isStrengthSport = (sport?: string | null): boolean =>
  !!sport && archetypeOf(sport) === 'strength';
