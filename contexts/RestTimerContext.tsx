import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

const STORAGE_KEY = 'fuelog_rest_timer_seconds';
const DEFAULT_SECONDS = 90;

interface RestTimerContextType {
  remaining: number | null;
  defaultSeconds: number;
  startTimer: (seconds?: number) => void;
  dismiss: () => void;
  setDefaultSeconds: (s: number) => Promise<void>;
}

const RestTimerContext = createContext<RestTimerContextType>({
  remaining: null,
  defaultSeconds: DEFAULT_SECONDS,
  startTimer: () => {},
  dismiss: () => {},
  setDefaultSeconds: async () => {},
});

export function useRestTimer() {
  return useContext(RestTimerContext);
}

export function RestTimerProvider({ children }: { children: React.ReactNode }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [defaultSeconds, setDefaultSecondsState] = useState(DEFAULT_SECONDS);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const defaultRef = useRef(DEFAULT_SECONDS);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      if (val) {
        const parsed = parseInt(val, 10);
        setDefaultSecondsState(parsed);
        defaultRef.current = parsed;
      }
    });
  }, []);

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setRemaining(null);
  }, [clearTimer]);

  const startTimer = useCallback((seconds?: number) => {
    clearTimer();
    const secs = seconds ?? defaultRef.current;
    setRemaining(secs);

    intervalRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev === null || prev <= 0) {
          clearTimer();
          return null;
        }
        const next = prev - 1;
        if (next === 10) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        if (next === 0) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          clearTimer();
          // keep "0" visible for 1.5s then dismiss
          setTimeout(() => setRemaining(null), 1500);
        }
        return next;
      });
    }, 1000);
  }, [clearTimer]);

  const setDefaultSeconds = useCallback(async (s: number) => {
    setDefaultSecondsState(s);
    defaultRef.current = s;
    await AsyncStorage.setItem(STORAGE_KEY, String(s));
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  return (
    <RestTimerContext.Provider value={{ remaining, defaultSeconds, startTimer, dismiss, setDefaultSeconds }}>
      {children}
    </RestTimerContext.Provider>
  );
}
