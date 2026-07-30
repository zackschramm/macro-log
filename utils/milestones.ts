import AsyncStorage from '@react-native-async-storage/async-storage';
import { Milestone } from './weightTrend';
import { maybeRequestReview } from './storeReview';
import { logError } from './logError';

const SEEN_KEY = 'fuelog_seen_milestones';

/**
 * Milestones the user hasn't been shown yet, newest-value first.
 * detectMilestones() returns everything currently *earned*, so this is what
 * turns that into "what's new since last time".
 */
export async function getUnseenMilestones(earned: Milestone[]): Promise<Milestone[]> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    return earned.filter(m => !seen.includes(m.key));
  } catch {
    return [];
  }
}

export async function markMilestoneSeen(key: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    if (!seen.includes(key)) {
      seen.push(key);
      await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    }
  } catch (e) { logError('milestones.markMilestoneSeen', e); }
}

/**
 * Ask for a store review, but only off the back of a genuine win.
 *
 * `maybeRequestReview` already rate-limits to once per 60 days; this adds the
 * "earned it" gate. Prompting at a random moment gets a 1-star reflex —
 * prompting right after someone sees they're 10 lbs down does not. Deliberately
 * fired after the celebration UI has been dismissed, never during it.
 */
export async function celebrateAndMaybeAskForReview(m: Milestone): Promise<void> {
  await markMilestoneSeen(m.key);
  if (m.reviewWorthy) await maybeRequestReview();
}
