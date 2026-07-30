// Platform-agnostic health hook. iOS → Apple HealthKit (useHealthKit),
// Android → Health Connect (useHealthConnect). Both expose the same surface
// (isAuthorized, requestPermissions, probeData, getRecoveryData,
// getAvailableSources, getWeeklyTrainingLoad), so screens can call one hook
// and get the right backend for the device.
//
// Type + constant + standalone-function exports are re-exported from
// useHealthKit so existing imports keep working unchanged.
import { Platform } from 'react-native';
import { useHealthKit } from './useHealthKit';
import { useHealthConnect } from './useHealthConnect';

export type {
  RecoveryData,
  WeeklyTrainingLoad,
} from './useHealthKit';

export {
  STORAGE_PREFERRED_TRACKER,
  STORAGE_HK_SOURCES,
  STORAGE_LAST_SYNC,
  SOURCE_PREF_KEYS,
  buildSourcePrefs,
} from './useHealthKit';

// Both hooks are always called (React rules of hooks) but only the
// platform-appropriate result is returned. The unused one is a cheap no-op.
export function useHealth() {
  const hk = useHealthKit();
  const hc = useHealthConnect();
  return Platform.OS === 'android' ? hc : hk;
}
