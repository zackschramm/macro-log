import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import { toLocalDateString } from './dateUtils';

const STREAK_COUNT_KEY = 'fuelog_streak_count';
const STREAK_LAST_DATE_KEY = 'fuelog_streak_last_date';
const STREAK_MILESTONES_KEY = 'fuelog_streak_milestones_shown';

const MILESTONES = [7, 30, 100];

function todayStr() { return toLocalDateString(); }
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toLocalDateString(d);
}

export interface StreakResult {
  count: number;
  lastDate: string;
  milestoneToShow: number | null;
}

export async function updateStreak(userId: string): Promise<StreakResult> {
  const today = todayStr();
  const yesterday = yesterdayStr();

  const [countRaw, lastDate, milestonesRaw] = await Promise.all([
    AsyncStorage.getItem(STREAK_COUNT_KEY),
    AsyncStorage.getItem(STREAK_LAST_DATE_KEY),
    AsyncStorage.getItem(STREAK_MILESTONES_KEY),
  ]);

  let count = parseInt(countRaw ?? '0', 10) || 0;
  const storedLastDate = lastDate ?? '';
  const milestonesShown: number[] = JSON.parse(milestonesRaw ?? '[]');

  const { count: todayCount } = await supabase
    .from('macro_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('date', today);

  const loggedToday = (todayCount ?? 0) > 0;
  let newLastDate = storedLastDate;

  if (loggedToday) {
    if (storedLastDate === today) {
      // Already counted today — no change
    } else if (storedLastDate === yesterday) {
      count += 1;
      newLastDate = today;
    } else {
      count = 1;
      newLastDate = today;
    }
  } else {
    // Haven't logged today yet
    if (storedLastDate < yesterday) {
      // Missed at least one day — streak is broken
      count = 0;
    }
    // If storedLastDate === yesterday, streak still alive — keep count
  }

  await AsyncStorage.multiSet([
    [STREAK_COUNT_KEY, String(count)],
    [STREAK_LAST_DATE_KEY, newLastDate],
  ]);

  let milestoneToShow: number | null = null;
  if (count > 0) {
    const hit = MILESTONES.find(m => m === count && !milestonesShown.includes(m));
    if (hit != null) {
      milestonesShown.push(hit);
      await AsyncStorage.setItem(STREAK_MILESTONES_KEY, JSON.stringify(milestonesShown));
      milestoneToShow = hit;
    }
  }

  return { count, lastDate: newLastDate, milestoneToShow };
}

export function getDisplayStreak(count: number, lastDate: string): number {
  const today = todayStr();
  const yesterday = yesterdayStr();
  return (lastDate === today || lastDate === yesterday) ? count : 0;
}

export async function loadStreak(): Promise<{ count: number; lastDate: string }> {
  const [countRaw, lastDate] = await Promise.all([
    AsyncStorage.getItem(STREAK_COUNT_KEY),
    AsyncStorage.getItem(STREAK_LAST_DATE_KEY),
  ]);
  return {
    count: parseInt(countRaw ?? '0', 10) || 0,
    lastDate: lastDate ?? '',
  };
}
