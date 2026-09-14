import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logError } from './logError';
import { toLocalDateString } from './dateUtils';

const LAST_REVIEW_KEY = 'fuelog_last_review_prompt';
const FIRST_RACE_PLAN_DAY_KEY = 'fuelog_first_race_plan_day';
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export async function maybeRequestReview(): Promise<void> {
  try {
    const isAvailable = await StoreReview.isAvailableAsync();
    if (!isAvailable) return;

    const lastPrompt = await AsyncStorage.getItem(LAST_REVIEW_KEY);
    if (lastPrompt && Date.now() - parseInt(lastPrompt, 10) < SIXTY_DAYS_MS) return;

    await AsyncStorage.setItem(LAST_REVIEW_KEY, Date.now().toString());
    await StoreReview.requestReview();
  } catch (e) { logError('storeReview.maybeRequestReview', e); }
}

/**
 * Review gate for the Race Fuel screen. The first plan is the wow moment,
 * but it is also minute one: the athlete hasn't raced on it, hasn't come
 * back, and Apple only lets us ask three times a year — spending one there
 * (as build 164 did) buys a reflex, not a review. So the first plan only
 * records the day, and the prompt fires on the first plan built on a LATER
 * day: the athlete came back for another one. Recalculating in the same
 * session is not coming back. `maybeRequestReview` keeps its 60-day floor.
 */
export async function maybeRequestReviewAfterRacePlan(today: string = toLocalDateString()): Promise<void> {
  try {
    const firstDay = await AsyncStorage.getItem(FIRST_RACE_PLAN_DAY_KEY);
    if (!firstDay) {
      await AsyncStorage.setItem(FIRST_RACE_PLAN_DAY_KEY, today);
      return;
    }
    if (today <= firstDay) return;
    await maybeRequestReview();
  } catch (e) { logError('storeReview.afterRacePlan', e); }
}
