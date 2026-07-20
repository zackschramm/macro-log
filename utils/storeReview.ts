import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_REVIEW_KEY = 'fuelog_last_review_prompt';
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export async function maybeRequestReview(): Promise<void> {
  try {
    const isAvailable = await StoreReview.isAvailableAsync();
    if (!isAvailable) return;

    const lastPrompt = await AsyncStorage.getItem(LAST_REVIEW_KEY);
    if (lastPrompt && Date.now() - parseInt(lastPrompt, 10) < SIXTY_DAYS_MS) return;

    await AsyncStorage.setItem(LAST_REVIEW_KEY, Date.now().toString());
    await StoreReview.requestReview();
  } catch {}
}
