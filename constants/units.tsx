import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { useAuth } from '../hooks/useAuth';

// ─────────────────────────────────────────────────────────────────────────────
// Units engine
//
// Canonical storage stays IMPERIAL everywhere in Supabase (weight_lbs, height_in,
// *_in body measurements, InBody *_lb). We only convert at the display/input
// edges based on the user's chosen system, so there is NO database migration of
// existing rows — just a new `unit_system` column to remember the preference.
// ─────────────────────────────────────────────────────────────────────────────

export type UnitSystem = 'imperial' | 'metric';
const STORAGE_KEY = 'unit_system';

export const KG_PER_LB = 0.45359237;
export const LB_PER_KG = 2.20462262;
export const CM_PER_IN = 2.54;
export const KM_PER_MI = 1.609344;

const round = (n: number, d = 1) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export interface UnitsApi {
  system: UnitSystem;
  isMetric: boolean;
  setSystem: (s: UnitSystem) => Promise<void>;

  weightUnit: string;   // 'lbs' | 'kg'
  lengthUnit: string;   // 'in' | 'cm'
  distanceUnit: string; // 'mi' | 'km'

  // canonical (imperial) -> number in display unit
  dispWeight: (lb: number, d?: number) => number;
  dispLength: (inch: number, d?: number) => number;
  dispDistance: (km: number, d?: number) => number;

  // user input in display unit -> canonical (imperial)
  toLb: (input: string | number) => number;
  toInch: (input: string | number) => number;

  // canonical -> formatted string with unit suffix
  fmtWeight: (lb: number, d?: number) => string;
  fmtLength: (inch: number, d?: number) => string;
  fmtDistance: (km: number, d?: number) => string;
  fmtHeight: (totalIn: number) => string;

  // height helpers (stored as total inches)
  heightFields: (totalIn: number) => { ft: string; in: string; cm: string };
  fieldsToInch: (f: { ft?: string; in?: string; cm?: string }) => number;
}

function makeApi(system: UnitSystem, setSystem: (s: UnitSystem) => Promise<void>): UnitsApi {
  const isMetric = system === 'metric';
  return {
    system,
    isMetric,
    setSystem,
    weightUnit: isMetric ? 'kg' : 'lbs',
    lengthUnit: isMetric ? 'cm' : 'in',
    distanceUnit: isMetric ? 'km' : 'mi',

    dispWeight: (lb, d = 1) => round(isMetric ? lb * KG_PER_LB : lb, d),
    dispLength: (inch, d = 1) => round(isMetric ? inch * CM_PER_IN : inch, d),
    dispDistance: (km, d = 1) => round(isMetric ? km : km / KM_PER_MI, d),

    toLb: (input) => {
      const n = parseFloat(String(input));
      if (isNaN(n)) return NaN;
      return isMetric ? n * LB_PER_KG : n;
    },
    toInch: (input) => {
      const n = parseFloat(String(input));
      if (isNaN(n)) return NaN;
      return isMetric ? n / CM_PER_IN : n;
    },

    fmtWeight: (lb, d = 1) => `${round(isMetric ? lb * KG_PER_LB : lb, d)} ${isMetric ? 'kg' : 'lbs'}`,
    fmtLength: (inch, d = 1) => `${round(isMetric ? inch * CM_PER_IN : inch, d)} ${isMetric ? 'cm' : 'in'}`,
    fmtDistance: (km, d = 1) => `${round(isMetric ? km : km / KM_PER_MI, d)} ${isMetric ? 'km' : 'mi'}`,
    fmtHeight: (totalIn) => {
      if (isMetric) return `${Math.round(totalIn * CM_PER_IN)} cm`;
      const ft = Math.floor(totalIn / 12);
      const inch = Math.round(totalIn % 12);
      return `${ft}'${inch}"`;
    },

    heightFields: (totalIn) => ({
      ft: String(Math.floor(totalIn / 12) || ''),
      in: String(Math.round(totalIn % 12) || ''),
      cm: totalIn ? String(Math.round(totalIn * CM_PER_IN)) : '',
    }),
    fieldsToInch: (f) => {
      if (isMetric) {
        const cm = parseFloat(f.cm || '');
        return isNaN(cm) ? 0 : cm / CM_PER_IN;
      }
      return (parseInt(f.ft || '') || 0) * 12 + (parseInt(f.in || '') || 0);
    },
  };
}

const UnitsContext = createContext<UnitsApi | null>(null);

export function UnitsProvider({
  initialSystem,
  children,
}: {
  initialSystem?: UnitSystem | null;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [system, setSystemState] = useState<UnitSystem>(initialSystem === 'metric' ? 'metric' : 'imperial');

  // Follow the profile's saved value if it loads/changes after mount.
  useEffect(() => {
    if (initialSystem === 'metric' || initialSystem === 'imperial') setSystemState(initialSystem);
  }, [initialSystem]);

  // Hydrate from local storage too (covers the case where the profile row
  // hasn't loaded yet, and keeps the choice instant/offline).
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if ((v === 'metric' || v === 'imperial') && !initialSystem) setSystemState(v);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSystem = useCallback(
    async (s: UnitSystem) => {
      setSystemState(s);
      await AsyncStorage.setItem(STORAGE_KEY, s);
      if (user?.id) {
        await supabase.from('profiles').update({ unit_system: s }).eq('id', user.id);
      }
    },
    [user?.id]
  );

  return <UnitsContext.Provider value={makeApi(system, setSystem)}>{children}</UnitsContext.Provider>;
}

// Imperial fallback so any screen rendered outside the provider still works.
const noopSet = async () => {};

export function useUnits(): UnitsApi {
  const ctx = useContext(UnitsContext);
  return ctx ?? makeApi('imperial', noopSet);
}
