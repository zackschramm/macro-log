import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { supabase } from '../constants/supabase';
import { getWeeklyAvgTDEE, USER_GOAL_ADJUSTMENTS } from '../utils/tdee';
import type { TDEEResult, UserGoal } from '../utils/tdee';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';

const GOAL_LABELS: Record<UserGoal, string> = {
  lose_fat: 'Lose Fat',
  build_muscle: 'Build Muscle',
  maintain: 'Maintain',
};

// Labels are DERIVED from the shared adjustments so the copy can never drift
// out of sync with the math again (it previously hardcoded its own numbers).
const goalAdjLabel = (goal: UserGoal): string => {
  const adj = USER_GOAL_ADJUSTMENTS[goal];
  if (adj === 0) return 'maintenance';
  return `${adj < 0 ? '−' : '+'}${Math.abs(adj)} cal ${adj < 0 ? 'deficit' : 'surplus'}`;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  userId: string;
  tdeeData: TDEEResult;
  onTargetUpdated?: () => void;
}

export default function CalorieBurnModal({ visible, onClose, userId, tdeeData, onTargetUpdated }: Props) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [weeklyAvg, setWeeklyAvg] = useState<number | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setWeeklyLoading(true);
    setWeeklyAvg(null);
    getWeeklyAvgTDEE().then((avg) => {
      setWeeklyAvg(avg);
      setWeeklyLoading(false);
    });
  }, [visible]);

  const handleUpdateTarget = () => {
    if (!weeklyAvg) return;
    const newTarget = Math.round(weeklyAvg + USER_GOAL_ADJUSTMENTS[tdeeData.goal]);
    Alert.alert(
      'Update Calorie Target?',
      `Set daily calorie target to ${newTarget.toLocaleString()} cal?\n\nBased on your 7-day average burn (${weeklyAvg.toLocaleString()} cal) adjusted for your ${GOAL_LABELS[tdeeData.goal]} goal.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update',
          onPress: async () => {
            setUpdating(true);
            await supabase.from('profiles').update({ calories: newTarget }).eq('id', userId);
            setUpdating(false);
            Alert.alert('Updated!', 'Your static calorie target has been saved. It will fully take effect on next app launch.');
            onTargetUpdated?.();
            onClose();
          },
        },
      ]
    );
  };

  if (!tdeeData.tdee) return null;

  const bmr = tdeeData.bmr ?? 0;
  const active = tdeeData.active ?? 0;
  const total = tdeeData.tdee;

  // Color for "eaten" value: green = on target, amber = under by 100–300, red = over or under 300+
  const surplus = tdeeData.surplus ?? 0;
  const eatenColor = Math.abs(surplus) <= 100
    ? colors.accent
    : surplus > 100 && surplus <= 300
      ? colors.warning
      : colors.danger;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.title}>Calorie Burn</Text>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.closeTxt}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

            {/* Energy breakdown bar chart */}
            <Text style={s.sectionLabel}>TODAY'S ENERGY BREAKDOWN</Text>
            <View style={s.card}>
              {([
                { label: 'Resting', value: bmr, color: colors.textSecondary },
                { label: 'Active', value: active, color: colors.accent },
              ] as const).map(({ label, value, color }) => (
                <View key={label} style={s.barRow}>
                  <Text style={s.barLabel}>{label}</Text>
                  <View style={s.barTrack}>
                    <View style={[s.bar, { width: `${Math.max(4, Math.round((value / total) * 100))}%` as any, backgroundColor: color }]} />
                  </View>
                  <Text style={s.barValue}>{Math.round(value).toLocaleString()}</Text>
                </View>
              ))}
              <View style={s.barDivider} />
              <View style={s.barRow}>
                <Text style={[s.barLabel, { color: colors.text, fontWeight: weight.bold }]}>Total</Text>
                <View style={s.barTrack}>
                  <View style={[s.bar, { width: '100%', backgroundColor: colors.info }]} />
                </View>
                <Text style={[s.barValue, { color: colors.text, fontWeight: weight.bold }]}>{total.toLocaleString()} cal</Text>
              </View>
            </View>

            {/* What this means */}
            <Text style={s.sectionLabel}>WHAT THIS MEANS FOR YOU</Text>
            <View style={s.card}>
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Your goal</Text>
                <Text style={s.metaValue}>{GOAL_LABELS[tdeeData.goal]} · {goalAdjLabel(tdeeData.goal)}</Text>
              </View>
              {tdeeData.projectedTdee != null && (
                <View style={s.metaRow}>
                  <Text style={s.metaLabel}>Projected full-day burn</Text>
                  <Text style={s.metaValue}>{tdeeData.projectedTdee.toLocaleString()} cal</Text>
                </View>
              )}
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Suggested intake today</Text>
                <Text style={[s.metaValue, { color: colors.accent }]}>{tdeeData.goalCalories?.toLocaleString()} cal</Text>
              </View>
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>You've eaten</Text>
                <Text style={[s.metaValue, { color: eatenColor }]}>{tdeeData.caloriesLogged.toLocaleString()} cal</Text>
              </View>
              <View style={[s.metaRow, s.metaRowLast]}>
                <Text style={s.metaLabel}>
                  {Math.abs(surplus) <= 50 ? 'Status' : surplus > 0 ? 'Still to eat' : 'Over target'}
                </Text>
                <Text style={[s.metaValue, { color: Math.abs(surplus) <= 50 ? colors.accent : colors.text }]}>
                  {Math.abs(surplus) <= 50 ? 'On target!' : `${Math.abs(surplus).toLocaleString()} cal`}
                </Text>
              </View>
            </View>

            {/* 7-day average */}
            <Text style={s.sectionLabel}>7-DAY AVERAGE</Text>
            <View style={s.card}>
              {weeklyLoading ? (
                <ActivityIndicator color={colors.accent} style={{ paddingVertical: 8 }} />
              ) : weeklyAvg != null ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginBottom: 8 }}>
                    <Text style={s.weeklyNum}>{weeklyAvg.toLocaleString()}</Text>
                    <Text style={s.weeklyUnit}>cal/day</Text>
                  </View>
                  <Text style={s.weeklySub}>
                    Your average daily calorie burn over the last 7 days. Using this gives a more accurate calorie target than activity-level estimates alone.
                  </Text>
                </>
              ) : (
                <Text style={s.noDataText}>
                  Not enough HealthKit data yet. Wear your Apple Watch for a few days to see your 7-day average.
                </Text>
              )}
            </View>

            {/* Update target button */}
            {weeklyAvg != null && (
              <TouchableOpacity style={s.updateBtn} onPress={handleUpdateTarget} disabled={updating} activeOpacity={0.8}>
                {updating
                  ? <ActivityIndicator color={colors.accentText} />
                  : <Text style={s.updateBtnText}>Update My Calorie Target</Text>}
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.65)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: c.bgSecondary,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      maxHeight: '85%',
      paddingBottom: 32,
    },
    handle: {
      width: 36,
      height: 4,
      backgroundColor: c.borderStrong,
      borderRadius: 2,
      alignSelf: 'center',
      marginTop: 12,
      marginBottom: 20,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      marginBottom: spacing.lg,
    },
    title: {
      fontSize: 22,
      fontWeight: weight.heavy,
      color: c.text,
    },
    closeBtn: {
      backgroundColor: c.cardAlt,
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeTxt: {
      color: c.textSecondary,
      fontSize: 20,
      lineHeight: 22,
    },
    content: {
      paddingHorizontal: spacing.xl,
      paddingBottom: 8,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: weight.bold,
      color: c.textTertiary,
      letterSpacing: 1.5,
      marginBottom: spacing.sm,
      marginTop: spacing.md,
    },
    card: {
      backgroundColor: c.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: spacing.xs,
    },
    barRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
    },
    barLabel: {
      width: 52,
      fontSize: 12,
      color: c.textSecondary,
      fontWeight: weight.medium,
    },
    barTrack: {
      flex: 1,
      height: 8,
      backgroundColor: c.border,
      borderRadius: 4,
      overflow: 'hidden',
    },
    bar: {
      height: '100%',
      borderRadius: 4,
    },
    barValue: {
      width: 72,
      fontSize: 12,
      color: c.textSecondary,
      fontWeight: weight.semibold,
      textAlign: 'right',
    },
    barDivider: {
      height: 1,
      backgroundColor: c.border,
      marginVertical: 6,
    },
    metaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    metaRowLast: {
      marginBottom: 0,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    metaLabel: {
      fontSize: 13,
      color: c.textSecondary,
      fontWeight: weight.medium,
      flex: 1,
    },
    metaValue: {
      fontSize: 13,
      color: c.text,
      fontWeight: weight.semibold,
      textAlign: 'right',
    },
    weeklyNum: {
      fontSize: 32,
      fontWeight: weight.heavy,
      color: c.text,
      letterSpacing: -1,
    },
    weeklyUnit: {
      fontSize: 14,
      color: c.textSecondary,
      fontWeight: weight.medium,
    },
    weeklySub: {
      fontSize: 12,
      color: c.textTertiary,
      lineHeight: 17,
      fontWeight: weight.regular,
    },
    noDataText: {
      fontSize: 13,
      color: c.textTertiary,
      lineHeight: 18,
      fontWeight: weight.regular,
    },
    updateBtn: {
      backgroundColor: c.accent,
      borderRadius: radius.md,
      padding: 16,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    updateBtnText: {
      color: c.accentText,
      fontSize: 15,
      fontWeight: weight.heavy,
    },
  });
}
