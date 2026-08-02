/**
 * COMPATIBILITY SHIM. The session-energy model moved to `./sessionEnergy`.
 *
 * Nothing in it was ever endurance-specific: wearable-first source priority
 * (power -> device -> distance -> MET), the resting double-count fix and the
 * NEAT factors are physics and accounting. Every archetype needs them, and
 * energy availability in particular is meaningless without a defensible
 * exercise-energy figure — so the module now lives under a name that says so.
 *
 * This file exists only so that `workoutMapping.ts`, `sessionMapping.ts`,
 * `enduranceContext.ts` and the existing tests didn't all have to change in one
 * commit. New code should import from `./sessionEnergy` directly. Nothing new
 * should be added here.
 */
export * from './sessionEnergy';
