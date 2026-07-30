/**
 * Turns the endurance profile + today's sessions into a block of text the AI
 * can reason about.
 *
 * The point is to replace a static sport label with today's actual situation.
 * "The user does triathlon" produces generic advice. "The user is 9 days from
 * an Ironman, did 4h20 yesterday, needs 11 g/kg carbohydrate today and is
 * trained to 75 g/h" produces advice worth reading.
 *
 * Pure formatting — the caller fetches the data. Type-only imports so this
 * stays testable.
 */

import {
  carbTargetGPerKg, phaseFromRaceDate, daysUntilRace, isCarbLoadWindow,
  carbLoadGPerKgFor, energyAvailability, PHASE_LABEL,
  type TrainingPhase,
} from './enduranceFueling';
import { dailyEnergy, type Session, type NeatLevel } from './enduranceEnergy';
import {
  TRI_COURSES, baseCarbRate, planGutTraining, needsMixedCarbSource,
  GLUCOSE_FRUCTOSE_RATIO, type TriDistance,
} from './raceFueling';

export interface EnduranceProfile {
  sport?: string | null;
  raceDate?: string | null;
  trainingPhase?: string | null;
  carbToleranceGPerH?: number | null;
  sweatRateLPerH?: number | null;
  neatLevel?: string | null;
  experienceLevel?: string | null;
  massKg?: number | null;
  ffmKg?: number | null;
  bmr?: number | null;
}

const SPORT_TO_DISTANCE: Record<string, TriDistance> = {
  tri_sprint: 'sprint',
  tri_olympic: 'olympic',
  tri_70_3: 'half',
  tri_ironman: 'full',
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Resolve the phase: an explicit setting wins, otherwise infer from the race
 * date, otherwise assume build (the most common state for someone using this).
 */
export function resolvePhase(p: EnduranceProfile, todayISO?: string): TrainingPhase {
  const explicit = p?.trainingPhase;
  if (explicit && explicit in PHASE_LABEL) return explicit as TrainingPhase;
  return phaseFromRaceDate(p?.raceDate ?? null, todayISO) ?? 'build';
}

export function buildEnduranceContext(
  profile: EnduranceProfile,
  todaySessions: Session[] = [],
  todayISO?: string
): string[] {
  const lines: string[] = [];
  const sport = profile?.sport ?? '';
  const massKg = profile?.massKg ?? 0;
  if (!massKg) return lines;

  const distance = SPORT_TO_DISTANCE[sport];
  const course = distance ? TRI_COURSES[distance] : null;
  const phase = resolvePhase(profile, todayISO);
  const days = daysUntilRace(profile?.raceDate ?? null, todayISO);

  lines.push('ENDURANCE CONTEXT:');

  if (course) {
    lines.push(
      `- Event: ${course.label} (${course.swimKm}km swim / ${course.bikeKm}km bike / ` +
      `${course.runKm}km run), typically ${course.typicalHours[0]}-${course.typicalHours[1]} hours`
    );
  }

  lines.push(`- Training phase: ${PHASE_LABEL[phase]}`);
  if (days !== null && days >= 0) {
    lines.push(`- Race is ${days} day${days === 1 ? '' : 's'} away`);
  }

  // Today's training and what it costs.
  const energy = dailyEnergy({
    bmr: profile?.bmr ?? 0,
    neat: (profile?.neatLevel as NeatLevel) ?? 'sedentary',
    sessions: todaySessions,
    massKg,
  });

  if (todaySessions.length > 0) {
    const summary = todaySessions
      .map(s => `${s.discipline} ${Math.round(s.durationMin)}min`)
      .join(', ');
    lines.push(`- Today's training: ${summary}`);

    // Say where the number came from. "Your watch said 2,400" lands very
    // differently from an unattributed figure the athlete can't reconcile with
    // the device on their wrist.
    const usedDevice = energy.sources.includes('device');
    const usedPower = energy.sources.includes('power');
    const provenance = usedPower
      ? 'from power data'
      : usedDevice
        ? 'as reported by your wearable'
        : 'estimated — no wearable figure available for these sessions';
    lines.push(
      `- Training cost today: ~${energy.exerciseComponent} cal, ${provenance} ` +
      `(additional to resting — do NOT add this to a TDEE that already assumes ` +
      `an active lifestyle)`
    );

    // Only mention the cross-check when it's materially different. A 5%
    // disagreement is noise; a 25% one usually means either the watch is
    // mis-calibrated or we've misread the session's intensity, and only the
    // athlete can say which.
    if (energy.deviceKcal !== null && energy.modelKcal > 0) {
      const pct = Math.abs(energy.deltaKcal as number) / energy.modelKcal;
      if (pct >= 0.2) {
        const dir = (energy.deltaKcal as number) > 0 ? 'higher' : 'lower';
        lines.push(
          `- Cross-check: your wearable reported ${energy.deviceKcal} cal, ` +
          `${Math.round(pct * 100)}% ${dir} than the ${energy.modelKcal} cal we'd ` +
          `estimate from duration and pace. The wearable figure is being used. ` +
          `If the athlete's weight or intensity looks misreported, say so.`
        );
      }
    }
  } else {
    lines.push('- Today\'s training: none logged yet');
  }
  lines.push(`- Training load today: ${r1(energy.load)} intensity-weighted hours`);

  // Carbohydrate: the number that actually matters.
  const raceHours = course ? (course.typicalHours[0] + course.typicalHours[1]) / 2 : null;
  const loading = isCarbLoadWindow(profile?.raceDate ?? null, todayISO, raceHours);
  const choGPerKg = loading
    ? carbLoadGPerKgFor(raceHours ?? 0)
    : carbTargetGPerKg(energy.load, phase);

  lines.push(
    `- Carbohydrate target today: ${r1(choGPerKg)} g/kg = ~${Math.round(choGPerKg * massKg)}g` +
    (loading ? ' (CARB LOADING — race is 1-2 days out, reduce fibre)' : '')
  );
  lines.push(`- Maintenance today: ~${energy.maintenance} cal (resting ${energy.restingComponent} + training ${energy.exerciseComponent})`);

  // Energy availability — only surfaced when it's actually a problem.
  if (profile?.ffmKg) {
    const ea = energyAvailability(energy.target, energy.exerciseComponent, profile.ffmKg);
    if (ea.shouldWarn) {
      lines.push(
        `- LOW ENERGY AVAILABILITY: ${ea.value} kcal/kg FFM (below the 30 threshold). ` +
        `Needs ~${ea.deficitToLow} more calories. Raise this before discussing anything else — ` +
        `it drives fatigue, poor sleep, illness and stress fractures, and no training ` +
        `adjustment fixes it.`
      );
    }
  }

  // Race fuelling and the gut work needed to get there.
  if (course && raceHours) {
    const target = baseCarbRate(raceHours);
    const trained = profile?.carbToleranceGPerH ?? null;
    lines.push(`- Race fuelling target: ${target} g carbs/hour for this distance`);
    if (trained) {
      lines.push(`- Trained carb tolerance: ${trained} g/hour`);
      if (trained < target) {
        const weeksAvailable = days !== null && days > 0 ? days / 7 : null;
        const gut = planGutTraining(trained, target, weeksAvailable);
        lines.push(
          `- Gut training: ${gut.note} Never advise a race rate above ` +
          `${Math.round(gut.achievableGPerH)} g/hour — an untrained rate causes GI ` +
          `distress regardless of fitness.`
        );
      }
      if (needsMixedCarbSource(Math.min(trained, target))) {
        lines.push(
          `- Above 60 g/hour requires mixed glucose:fructose (${GLUCOSE_FRUCTOSE_RATIO}); ` +
          `single-source carbohydrate will not absorb fast enough.`
        );
      }
    } else {
      lines.push('- Trained carb tolerance: NOT SET — ask before recommending any race rate.');
    }
  }

  if (profile?.sweatRateLPerH) {
    lines.push(`- Measured sweat rate: ${profile.sweatRateLPerH} L/hour`);
  }

  if (profile?.experienceLevel === 'first_timer') {
    lines.push(
      '- Experience: FIRST TIMER. Favour conservative, concrete advice. Explain the ' +
      'reasoning. Do not assume they know what FTP, threshold or a brick session is.');
  } else if (profile?.experienceLevel === 'experienced') {
    lines.push(
      '- Experience: EXPERIENCED. Skip the basics, use the technical vocabulary, and ' +
      'respect their own numbers over the defaults.');
  }

  lines.push('');
  return lines;
}
