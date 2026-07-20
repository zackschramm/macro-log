import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { useUnits } from '../constants/units';
import { toLocalDateString } from '../utils/dateUtils';

const DISMISS_KEY = 'fuelog_adaptive_macro_dismissed_until';

interface Props {
  userId: string;
  profile: any;
  onTargetUpdated?: () => void;
}

interface Suggestion {
  message: string;
  newCalories: number | null;
}

export default function AdaptiveMacroCard({ userId, profile, onTargetUpdated }: Props) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const u = useUnits();
  const [dismissed, setDismissed] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [applying, setApplying] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadData();
  }, [userId, profile?.goal]);

  const loadData = async () => {
    try {
      const dismissedUntil = await AsyncStorage.getItem(DISMISS_KEY);
      if (dismissedUntil && new Date(dismissedUntil) > new Date()) {
        setDismissed(true);
        setReady(true);
        return;
      }

      const since = new Date();
      since.setDate(since.getDate() - 28);
      const sinceStr = toLocalDateString(since);

      const { data } = await supabase
        .from('progress_logs')
        .select('date, weight_lbs')
        .eq('user_id', userId)
        .gte('date', sinceStr)
        .not('weight_lbs', 'is', null)
        .order('date', { ascending: true });

      const entries = (data ?? []).filter((r: any) => r.weight_lbs != null);

      if (entries.length < 5) {
        setReady(true);
        return;
      }

      const mid = Math.floor(entries.length / 2);
      const firstHalf = entries.slice(0, mid);
      const secondHalf = entries.slice(mid);

      const avg = (arr: any[]) => arr.reduce((s, r) => s + r.weight_lbs, 0) / arr.length;
      const firstAvg = avg(firstHalf);
      const secondAvg = avg(secondHalf);
      const totalChange = secondAvg - firstAvg;
      // Approximate weeks: 28-day window split in half → ~2 weeks each half
      const weeklyRate = totalChange / 2;

      const goal = profile?.goal;
      const currentCal: number = profile?.calories ?? 2000;

      // Convert canonical-lbs values to display unit for user-facing messages.
      // weight_lbs is stored as lbs in the DB; u.dispWeight converts to the
      // user's preferred unit and u.weightUnit provides the label.
      const dispChange = u.dispWeight(Math.abs(totalChange), 1);
      const dispRate   = u.dispWeight(Math.abs(weeklyRate), 1);
      const wUnit = u.weightUnit;
      let sug: Suggestion | null = null;

      if (goal === 'lose') {
        if (weeklyRate > -0.25) {
          const newCal = Math.max(1200, Math.round(currentCal - 150));
          const changeText =
            totalChange > 0.2 ? `gone up ${u.dispWeight(totalChange, 1)} ${wUnit}`
            : totalChange < -0.1 ? `gone down only ${dispChange} ${wUnit}`
            : 'stayed roughly flat';
          sug = {
            message: `Your weight has ${changeText} over the last 3 weeks. For your fat loss goal, we suggest reducing your daily calorie target to ${newCal} cal.`,
            newCalories: newCal,
          };
        }
      } else if (goal === 'gain') {
        if (weeklyRate < 0.25) {
          const newCal = Math.round(currentCal + 150);
          const changeText =
            totalChange < -0.2 ? `gone down ${dispChange} ${wUnit}`
            : totalChange > 0.1 ? `gone up only ${u.dispWeight(totalChange, 1)} ${wUnit}`
            : 'stayed roughly flat';
          sug = {
            message: `Your weight has ${changeText} over the last 3 weeks. For your muscle-building goal, we suggest increasing your daily calorie target to ${newCal} cal.`,
            newCalories: newCal,
          };
        }
      } else if (goal === 'maintain') {
        if (Math.abs(weeklyRate) > 0.5) {
          const direction = weeklyRate > 0 ? 'gaining' : 'losing';
          const changeText =
            totalChange > 0 ? `gone up ${u.dispWeight(totalChange, 1)} ${wUnit}`
            : `gone down ${dispChange} ${wUnit}`;
          sug = {
            message: `Your weight has ${changeText} over the last 3 weeks. That's faster than expected for a maintenance goal — you're ${direction} about ${dispRate} ${wUnit}/week. Consider adjusting your intake.`,
            newCalories: null,
          };
        }
      }

      setSuggestion(sug);
    } catch {}
    setReady(true);
  };

  const handleApply = () => {
    if (!suggestion?.newCalories) return;
    const newCal = suggestion.newCalories;
    Alert.alert(
      'Update calorie target?',
      `Set your daily calorie target to ${newCal} cal?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update',
          onPress: async () => {
            setApplying(true);
            try {
              await supabase.from('profiles').update({ calories: newCal }).eq('id', userId);
              onTargetUpdated?.();
              handleDismiss();
            } catch {}
            setApplying(false);
          },
        },
      ]
    );
  };

  const handleDismiss = async () => {
    const until = new Date();
    until.setDate(until.getDate() + 14);
    await AsyncStorage.setItem(DISMISS_KEY, until.toISOString());
    setDismissed(true);
  };

  if (!ready || dismissed || !suggestion) return null;

  return (
    <View style={s.card}>
      <View style={s.accentBar} />
      <View style={s.content}>
        <Text style={s.title}>MACRO CHECK-IN</Text>
        <Text style={s.body}>{suggestion.message}</Text>
        {suggestion.newCalories != null && (
          <TouchableOpacity style={s.applyBtn} onPress={handleApply} disabled={applying}>
            <Text style={s.applyBtnText}>
              {applying ? 'Updating…' : `Apply suggested target (${suggestion.newCalories} cal)`}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={handleDismiss} style={s.dismissLink}>
          <Text style={s.dismissText}>Dismiss for 2 weeks</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      backgroundColor: c.card,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: spacing.lg,
      overflow: 'hidden',
    },
    accentBar: {
      width: 3,
      backgroundColor: c.accent,
    },
    content: {
      flex: 1,
      padding: spacing.lg,
    },
    title: {
      fontSize: 10,
      fontWeight: weight.bold as any,
      color: c.textSecondary,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    body: {
      fontSize: 14,
      color: c.text,
      lineHeight: 20,
      fontWeight: weight.medium as any,
      marginBottom: 14,
    },
    applyBtn: {
      backgroundColor: c.accent,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: 10,
      alignItems: 'center',
      marginBottom: 10,
    },
    applyBtnText: {
      color: c.accentText,
      fontSize: 13,
      fontWeight: weight.bold as any,
    },
    dismissLink: {
      alignSelf: 'flex-start',
    },
    dismissText: {
      fontSize: 12,
      color: c.textTertiary,
      fontWeight: weight.medium as any,
      textDecorationLine: 'underline',
    },
  });
}
