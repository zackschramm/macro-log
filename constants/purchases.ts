import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logError } from '../utils/logError';

const PRO_CACHE_KEY = 'fuelog_has_pro';

export const REVENUECAT_IOS_API_KEY = 'appl_widYlAIBGWbxsKJMtAIkwmeihmL';
export const ENTITLEMENT_ID = 'Fuelog Pro';

// Call once at app startup — never call again.
export function configureRevenueCat() {
  Purchases.setLogLevel(LOG_LEVEL.ERROR);
  Purchases.configure({ apiKey: REVENUECAT_IOS_API_KEY });
}

// Call after the user logs in so purchases are tied to their account.
export async function loginRevenueCat(userId: string) {
  try {
    await Purchases.logIn(userId);
  } catch (e) { logError('purchases.loginRevenueCat', e); }
}

/**
 * Call when the user logs out.
 *
 * Guarded on `isAnonymous` because App.tsx calls this from the `else` branch of
 * a `useEffect([session])`, and on a cold start `session` is null until Supabase
 * finishes restoring it. That fired a logOut for a user who had never logged in,
 * and RevenueCat rejects it: "LogOut was called but the current user is
 * anonymous." Functionally harmless — RevenueCat refuses and moves on — but it
 * threw an error into Sentry on every single cold launch, which is exactly the
 * kind of constant background noise that trains you to ignore the dashboard.
 *
 * The guard lives here rather than at the call site so every caller gets it.
 */
export async function logoutRevenueCat() {
  try {
    if (await Purchases.isAnonymous()) return;
    await Purchases.logOut();
  } catch (e) { logError('purchases.logoutRevenueCat', e); }
}

export async function hasPro(): Promise<boolean> {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const result = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
    // Cache the result so it's available offline
    await AsyncStorage.setItem(PRO_CACHE_KEY, result ? '1' : '0');
    return result;
  } catch {
    // RevenueCat unavailable — fall back to cached value
    try {
      const cached = await AsyncStorage.getItem(PRO_CACHE_KEY);
      return cached === '1';
    } catch {
      return false;
    }
  }
}
