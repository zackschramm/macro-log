import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import { getTodayTDEE } from './tdee';
import { getConnectedWearables, getWhoopData, getOuraData, getGarminData } from './wearables';
import { getCoachMemories, formatMemoriesForPrompt } from './coachMemory';
import { analyzeWeightTrend, describeTrend } from './weightTrend';
import { getWeightHistory, toWeighIns } from './weightHistory';
import { toLocalDateString } from './dateUtils';
import { logError } from './logError';

const GOAL_LABELS: Record<string, string> = {
  lose: 'lose fat',
  gain: 'build muscle',
  maintain: 'maintain',
};

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: 'sedentary',
  light: 'lightly active',
  active: 'active',
  very_active: 'very active',
};

export async function buildCoachContext(userId: string): Promise<string> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = toLocalDateString(sevenDaysAgo);

  const [
    asyncGoal,
    asyncActivity,
    asyncStreak,
    profileResult,
    macroLogsResult,
    inbodyResult,
    workoutLogsResult,
    tdeeResult,
    microLogsResult,
  ] = await Promise.allSettled([
    AsyncStorage.getItem('fuelog_onboarding_goal'),
    AsyncStorage.getItem('fuelog_onboarding_activity'),
    AsyncStorage.getItem('fuelog_streak_count'),
    supabase.from('profiles').select('goal,activity,calories,protein,carbs,fat').eq('id', userId).single(),
    supabase.from('macro_logs').select('date,calories,protein,carbs,fat').eq('user_id', userId).gte('date', sevenDaysAgoStr),
    supabase.from('inbody_logs').select('measured_at,body_fat_pct,skeletal_muscle_mass_lb,bmi').eq('user_id', userId).order('measured_at', { ascending: false }).limit(1).single(),
    supabase.from('workout_logs').select('date').eq('user_id', userId).gte('date', sevenDaysAgoStr),
    getTodayTDEE(userId).catch(() => null),
    supabase.from('macro_logs')
      .select('date,fiber_g,calcium_mg,iron_mg,vitamin_d_mcg,vitamin_b12_mcg,magnesium_mg,zinc_mg,potassium_mg,omega3_g')
      .eq('user_id', userId).gte('date', sevenDaysAgoStr),
  ]);

  const profile = profileResult.status === 'fulfilled' ? profileResult.value.data : null;
  const tdee = tdeeResult.status === 'fulfilled' ? tdeeResult.value : null;

  // Goal: prefer AsyncStorage (set by parallel onboarding session), fall back to profile
  const rawGoal =
    (asyncGoal.status === 'fulfilled' && asyncGoal.value) || profile?.goal || null;
  const goalLabel = rawGoal ? (GOAL_LABELS[rawGoal] ?? rawGoal) : null;

  // Activity: prefer AsyncStorage, fall back to profile
  const rawActivity =
    (asyncActivity.status === 'fulfilled' && asyncActivity.value) || profile?.activity || null;
  const activityLabel = rawActivity ? (ACTIVITY_LABELS[rawActivity] ?? rawActivity) : null;

  // Streak (default 0 if missing)
  const streakRaw = asyncStreak.status === 'fulfilled' ? asyncStreak.value : null;
  const streak = streakRaw ? parseInt(streakRaw, 10) : 0;

  // Macro targets
  const targetCal = profile?.calories ?? null;
  const targetProtein = profile?.protein ?? null;
  const targetCarbs = profile?.carbs ?? null;
  const targetFat = profile?.fat ?? null;

  // Average macros this week (aggregate by day to avoid double-counting meals)
  let avgCalories: number | null = null;
  let avgProtein: number | null = null;
  if (macroLogsResult.status === 'fulfilled' && macroLogsResult.value.data?.length) {
    const rows = macroLogsResult.value.data;
    const byDay: Record<string, { calories: number; protein: number }> = {};
    rows.forEach((r: any) => {
      if (!byDay[r.date]) byDay[r.date] = { calories: 0, protein: 0 };
      byDay[r.date].calories += r.calories ?? 0;
      byDay[r.date].protein += r.protein ?? 0;
    });
    const days = Object.values(byDay);
    if (days.length > 0) {
      avgCalories = Math.round(days.reduce((s, d) => s + d.calories, 0) / days.length);
      avgProtein = Math.round(days.reduce((s, d) => s + d.protein, 0) / days.length);
    }
  }

  // Last InBody scan
  let inbodyLine: string | null = null;
  if (inbodyResult.status === 'fulfilled' && inbodyResult.value.data) {
    const ib = inbodyResult.value.data as any;
    if (ib.measured_at && (ib.body_fat_pct != null || ib.skeletal_muscle_mass_lb != null || ib.bmi != null)) {
      const date = new Date(ib.measured_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });
      const parts: string[] = [];
      if (ib.body_fat_pct != null) parts.push(`Body fat: ${(ib.body_fat_pct as number).toFixed(1)}%`);
      if (ib.skeletal_muscle_mass_lb != null) {
        const kg = ((ib.skeletal_muscle_mass_lb as number) * 0.453592).toFixed(1);
        parts.push(`Muscle mass: ${kg}kg`);
      }
      if (ib.bmi != null) parts.push(`BMI: ${(ib.bmi as number).toFixed(1)}`);
      if (parts.length > 0) inbodyLine = `${date} — ${parts.join(', ')}`;
    }
  }

  // Workout days in last 7 days (distinct dates from workout_logs)
  let workoutDays: number | null = null;
  if (workoutLogsResult.status === 'fulfilled' && workoutLogsResult.value.data?.length) {
    const dates = (workoutLogsResult.value.data as any[]).map((r) => r.date);
    workoutDays = new Set(dates).size;
  }

  // Build context string — omit lines where data is missing
  const hasAnyData =
    goalLabel || activityLabel || targetCal != null || avgCalories != null ||
    inbodyLine || workoutDays != null || streak > 0;

  if (!hasAnyData) return '';

  const lines: string[] = [
    'You are the AI Coach inside Fuelog, a personal fitness and nutrition tracking app. Here is everything you know about this user:',
    '',
  ];

  if (goalLabel) lines.push(`- Goal: ${goalLabel}`);
  if (activityLabel) lines.push(`- Activity level: ${activityLabel}`);
  if (targetCal != null && targetProtein != null && targetCarbs != null && targetFat != null) {
    lines.push(`- Daily macro targets: ${targetCal} cal, ${targetProtein}g protein, ${targetCarbs}g carbs, ${targetFat}g fat`);
  }
  if (avgCalories != null && avgProtein != null) {
    lines.push(`- Average macros this week: ${avgCalories} cal, ${avgProtein}g protein`);
  }
  if (inbodyLine) lines.push(`- Last InBody scan: ${inbodyLine}`);
  if (workoutDays != null) {
    lines.push(`- Recent workout frequency: ${workoutDays} workout${workoutDays !== 1 ? 's' : ''} in the last 7 days`);
  }
  if (streak > 0) lines.push(`- Current streak: ${streak} day${streak !== 1 ? 's' : ''}`);

  // Micronutrient gaps: report nutrients averaging below 60% of default target
  if (microLogsResult.status === 'fulfilled' && microLogsResult.value.data?.length) {
    const microRows = microLogsResult.value.data as any[];
    const microByDay: Record<string, any> = {};
    microRows.forEach(r => {
      if (!microByDay[r.date]) microByDay[r.date] = {};
      const d = microByDay[r.date];
      if (r.fiber_g)         d.fiber_g         = (d.fiber_g ?? 0) + r.fiber_g;
      if (r.calcium_mg)      d.calcium_mg      = (d.calcium_mg ?? 0) + r.calcium_mg;
      if (r.iron_mg)         d.iron_mg         = (d.iron_mg ?? 0) + r.iron_mg;
      if (r.vitamin_d_mcg)   d.vitamin_d_mcg   = (d.vitamin_d_mcg ?? 0) + r.vitamin_d_mcg;
      if (r.vitamin_b12_mcg) d.vitamin_b12_mcg = (d.vitamin_b12_mcg ?? 0) + r.vitamin_b12_mcg;
      if (r.magnesium_mg)    d.magnesium_mg    = (d.magnesium_mg ?? 0) + r.magnesium_mg;
      if (r.zinc_mg)         d.zinc_mg         = (d.zinc_mg ?? 0) + r.zinc_mg;
      if (r.potassium_mg)    d.potassium_mg    = (d.potassium_mg ?? 0) + r.potassium_mg;
      if (r.omega3_g)        d.omega3_g        = (d.omega3_g ?? 0) + r.omega3_g;
    });
    const microDays = Object.values(microByDay);
    const microDefaults: Record<string, { label: string; target: number }> = {
      fiber_g:         { label: 'Fiber',       target: 25 },
      calcium_mg:      { label: 'Calcium',     target: 1000 },
      iron_mg:         { label: 'Iron',        target: 18 },
      vitamin_d_mcg:   { label: 'Vitamin D',   target: 15 },
      vitamin_b12_mcg: { label: 'Vitamin B12', target: 2.4 },
      magnesium_mg:    { label: 'Magnesium',   target: 320 },
      zinc_mg:         { label: 'Zinc',        target: 8 },
      potassium_mg:    { label: 'Potassium',   target: 2600 },
      omega3_g:        { label: 'Omega-3',     target: 1.1 },
    };
    const gaps: string[] = [];
    for (const [key, meta] of Object.entries(microDefaults)) {
      const total = microDays.reduce((s, d) => s + (d[key] ?? 0), 0);
      const daysWithData = microDays.filter(d => (d[key] ?? 0) > 0).length;
      if (daysWithData === 0) continue;
      const avg = total / microDays.length;
      const pct = Math.round((avg / meta.target) * 100);
      if (pct < 60) gaps.push(`${meta.label} at ${pct}% of target`);
    }
    if (gaps.length > 0) {
      lines.push(`- Micronutrient gaps this week: ${gaps.join(', ')}`);
    }
  }

  if (tdee?.tdee != null && tdee.goalCalories != null) {
    const diff = tdee.caloriesLogged - tdee.goalCalories;
    const diffLabel = diff >= 0
      ? `${diff} cal surplus vs goal`
      : `${Math.abs(diff)} cal deficit vs goal`;
    lines.push(`- Today's calorie burn: ${tdee.tdee} cal (BMR: ${tdee.bmr ?? 0} + Active: ${tdee.active ?? 0})`);
    lines.push(`- Suggested intake based on burn: ${tdee.goalCalories} cal`);
    lines.push(`- Actual intake today: ${tdee.caloriesLogged} cal (${diffLabel})`);
  }

  lines.push('');

  try {
    const connected = await getConnectedWearables(userId);
    const [whoopRes, ouraRes, garminRes] = await Promise.allSettled([
      connected.includes('whoop') ? getWhoopData(userId) : Promise.resolve(null),
      connected.includes('oura') ? getOuraData(userId) : Promise.resolve(null),
      connected.includes('garmin') ? getGarminData(userId) : Promise.resolve(null),
    ]);
    const wearableLines: string[] = [];
    if (whoopRes.status === 'fulfilled' && whoopRes.value) {
      const w = whoopRes.value;
      const parts: string[] = [];
      if (w.recoveryScore != null) parts.push(`Recovery ${w.recoveryScore}%`);
      if (w.hrv != null) parts.push(`HRV ${w.hrv}ms`);
      if (w.strain != null) parts.push(`Strain ${w.strain.toFixed(1)}`);
      if (parts.length) wearableLines.push(`- Whoop: ${parts.join(', ')}`);
    }
    if (ouraRes.status === 'fulfilled' && ouraRes.value) {
      const o = ouraRes.value;
      const parts: string[] = [];
      if (o.readinessScore != null) parts.push(`Readiness ${o.readinessScore}`);
      if (o.sleepScore != null) parts.push(`Sleep Score ${o.sleepScore}`);
      if (parts.length) wearableLines.push(`- Oura: ${parts.join(', ')}`);
    }
    if (garminRes.status === 'fulfilled' && garminRes.value) {
      const g = garminRes.value;
      const parts: string[] = [];
      if (g.bodyBattery != null) parts.push(`Body Battery ${g.bodyBattery}`);
      if (g.stressLevel != null) parts.push(`Stress ${g.stressLevel}`);
      if (parts.length) wearableLines.push(`- Garmin: ${parts.join(', ')}`);
    }
    if (wearableLines.length > 0) {
      lines.push('WEARABLE DATA:');
      lines.push(...wearableLines);
      lines.push('');
    }
  } catch (e) { logError('buildCoachContext.dates', e); }

  try {
    const { data: cs } = await supabase.from('cycle_settings')
      .select('tracking_enabled,cycle_length_days,period_length_days,last_period_start')
      .eq('user_id', userId).single();
    if (cs?.tracking_enabled && cs.last_period_start) {
      const start = new Date((cs.last_period_start as string) + 'T12:00:00');
      const today = new Date();
      today.setHours(12, 0, 0, 0);
      const daysDiff = Math.floor((today.getTime() - start.getTime()) / 86400000);
      const cycleLen = cs.cycle_length_days as number;
      const periodLen = (cs.period_length_days as number) ?? 5;
      const cycleDay = (daysDiff % cycleLen) + 1;
      const daysUntilPeriod = cycleLen - cycleDay + 1;
      const phaseName = cycleDay <= periodLen ? 'Menstrual'
        : cycleDay <= 13 ? 'Follicular'
        : cycleDay <= 16 ? 'Ovulation'
        : 'Luteal';
      lines.push('CYCLE DATA:');
      lines.push(`- Current phase: ${phaseName} (Day ${cycleDay} of ${cycleLen})`);
      lines.push(`- Days until next period: ${daysUntilPeriod}`);
      lines.push(`- Average cycle length: ${cycleLen} days`);
      lines.push('');
    }
  } catch (e) { logError('buildCoachContext.cycleDay', e); }

  // Weight trend. The Coach previously saw individual weigh-ins but had no
  // notion of rate of change, so it couldn't say whether a plan was working.
  try {
    // Merged across all three weight tables — reading body_measurements alone
    // meant a user who logs weight on the Stats tab had no trend at all here.
    const trend = analyzeWeightTrend(toWeighIns(await getWeightHistory(userId)));

    if (trend.hasEnoughData && trend.current !== null) {
      lines.push('WEIGHT TREND:');
      lines.push(`- Trend weight: ${trend.current} lbs (smoothed — ignores daily water swings)`);
      lines.push(`- Rate: ${describeTrend(trend)}`);
      if (trend.totalChange !== null) {
        lines.push(`- Net change over ${trend.daysTracked} days: ${trend.totalChange > 0 ? '+' : ''}${trend.totalChange} lbs`);
      }
      lines.push(
        '- Use the trend, not the latest scale reading, when judging progress. ' +
        'A single high or low weigh-in is water, not fat.'
      );
      lines.push('');
    }
  } catch (e) { logError('buildCoachContext.cycleDay', e); }

  // Durable memories last, immediately before the closing instruction, so they
  // sit closest to the model's attention at generation time. Fails soft — a
  // memory outage costs personalisation, never the conversation.
  try {
    const memories = await getCoachMemories();
    const block = formatMemoriesForPrompt(memories);
    if (block) {
      lines.push(block);
      lines.push('');
    }
  } catch (e) { logError('buildCoachContext.cycleDay', e); }

  lines.push('Always reference this data when relevant. Be specific, not generic.');

  return lines.join('\n');
}
