import { useState, useEffect } from 'react';
import AppleHealthKit, {
  HealthKitPermissions,
  HealthValue,
} from 'react-native-health';
import { Platform } from 'react-native';

const PERMISSIONS: HealthKitPermissions = {
  permissions: {
    read: [
      AppleHealthKit.Constants.Permissions.Weight,
      AppleHealthKit.Constants.Permissions.ActiveEnergyBurned,
      AppleHealthKit.Constants.Permissions.Workout,
    ],
    write: [
      AppleHealthKit.Constants.Permissions.Weight,
      AppleHealthKit.Constants.Permissions.EnergyConsumed,
      AppleHealthKit.Constants.Permissions.Protein,
      AppleHealthKit.Constants.Permissions.Carbohydrates,
      AppleHealthKit.Constants.Permissions.TotalFat,
      AppleHealthKit.Constants.Permissions.Water,
      AppleHealthKit.Constants.Permissions.Workout,
    ],
  },
};

export function useHealthKit() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleHealthKit.isAvailable((err, available) => {
      if (!err && available) setIsAvailable(true);
    });
  }, []);

  const requestPermissions = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (Platform.OS !== 'ios') return resolve(false);
      AppleHealthKit.initHealthKit(PERMISSIONS, (err) => {
        if (err) { resolve(false); return; }
        setIsAuthorized(true);
        resolve(true);
      });
    });
  };

  const saveWeight = (weightLbs: number): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!isAuthorized) return resolve(false);
      AppleHealthKit.saveWeight(
        { value: weightLbs, unit: AppleHealthKit.Constants.Units.pound },
        (err) => resolve(!err)
      );
    });
  };

  const getLatestWeight = (): Promise<number | null> => {
    return new Promise((resolve) => {
      if (!isAuthorized) return resolve(null);
      AppleHealthKit.getLatestWeight(
        { unit: AppleHealthKit.Constants.Units.pound },
        (err, result: HealthValue) => {
          if (err || !result) return resolve(null);
          resolve(result.value);
        }
      );
    });
  };

  const saveNutrition = (data: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meal: string;
  }): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!isAuthorized) return resolve(false);
      const now = new Date().toISOString();
      AppleHealthKit.saveFood(
        {
          foodName: data.meal,
          calories: data.calories,
          protein: data.protein,
          carbohydrates: data.carbs,
          totalFat: data.fat,
          startDate: now,
        } as any,
        (err) => resolve(!err)
      );
    });
  };

  const saveWorkout = (data: {
    name: string;
    startDate: Date;
    endDate: Date;
    calories?: number;
  }): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!isAuthorized) return resolve(false);
      AppleHealthKit.saveWorkout(
        {
          type: AppleHealthKit.Constants.Activities.TraditionalStrengthTraining,
          startDate: data.startDate.toISOString(),
          endDate: data.endDate.toISOString(),
          energyBurned: data.calories || 0,
          energyBurnedUnit: 'calorie',
        },
        (err) => resolve(!err)
      );
    });
  };

  return {
    isAvailable,
    isAuthorized,
    requestPermissions,
    saveWeight,
    getLatestWeight,
    saveNutrition,
    saveWorkout,
  };
}
