import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { useUnits } from '../constants/units';
import { calculateTargets } from '../constants/data';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { logError } from '../utils/logError';

/**
 * One-time prompt asking existing users for the three stats onboarding never
 * used to collect: height, age, sex.
 *
 * Without them Mifflin-St Jeor can't run, so those users are still sitting on
 * the crude cal-per-lb estimate from the old onboarding flow. This banner is
 * the migration path — it shows once, is dismissible, and never returns.
 *
 * The same AsyncStorage key is written by OnboardingScreen on completion, so
 * users who go through the *new* flow never see it at all.
 */
export const STATS_BACKFILL_KEY = 'fuelog_stats_backfill_prompted';

/** True when the profile can't support Mifflin-St Jeor. */
export function needsStatsBackfill(profile: any): boolean {
  if (!profile) return false;
  return !profile.height_in || !profile.age || !profile.sex;
}

const SEX_OPTIONS = [
  { key: 'male', label: 'Male' },
  { key: 'female', label: 'Female' },
];

export default function StatsBackfillPrompt({
  profile,
  onUpdate,
}: {
  profile: any;
  onUpdate: (p: any) => void;
}) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { user } = useAuth();
  const u = useUnits();

  const [visible, setVisible] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [ft, setFt] = useState('');
  const [inch, setInch] = useState('');
  const [cm, setCm] = useState('');
  const [age, setAge] = useState(profile?.age ? String(profile.age) : '');
  const [sex, setSex] = useState(profile?.sex || '');

  useEffect(() => {
    let cancelled = false;
    if (!needsStatsBackfill(profile)) return;
    AsyncStorage.getItem(STATS_BACKFILL_KEY)
      .then(v => { if (!cancelled && !v) setVisible(true); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const markSeen = async () => {
    setVisible(false);
    try { await AsyncStorage.setItem(STATS_BACKFILL_KEY, String(Date.now())); } catch (e) { logError('StatsBackfillPrompt.markSeen', e); }
  };

  const dismiss = () => { setModalOpen(false); markSeen(); };

  const height_in = u.isMetric
    ? (parseFloat(cm) || 0) / 2.54
    : (parseInt(ft, 10) || 0) * 12 + (parseInt(inch, 10) || 0);
  const ageNum = parseInt(age, 10) || 0;
  const canSave = height_in > 0 && ageNum > 0 && !!sex;

  const save = async () => {
    if (!user || !canSave) return;
    setSaving(true);
    try {
      const stats = { height_in, age: ageNum, sex };
      const weightLbs = Number(profile?.weight_lbs) || 0;

      // Guard: calculateTargets returns all zeros when weight is missing
      // (mifflinBmr can't run without it). Writing that would ZERO OUT the
      // user's calorie and macro targets — far worse than leaving them alone.
      // Save the stats regardless; only touch targets when we can compute real
      // ones, and never when the user set their own.
      let patch: Record<string, unknown> = stats;
      if (weightLbs > 0 && !profile?.custom_goals) {
        const targets = calculateTargets({
          weight_lbs: weightLbs,
          height_in,
          age: ageNum,
          sex,
          activity: profile?.activity || 'moderate',
          goal: profile?.goal || 'maintain',
          sport: profile?.sport || undefined,
        });
        if (targets.calories > 0) patch = { ...stats, ...targets };
      }
      const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
      if (error) { Alert.alert('Error', error.message); return; }
      onUpdate({ ...profile, ...patch });
      setModalOpen(false);
      await markSeen();
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <>
      <View style={s.banner}>
        <View style={{ flex: 1 }}>
          <Text style={s.bannerTitle}>Sharpen your targets</Text>
          <Text style={s.bannerSub}>Add your height, age, and sex — takes 15 seconds.</Text>
        </View>
        <TouchableOpacity
          style={s.bannerCta}
          onPress={() => setModalOpen(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Add height, age, and sex to improve your calorie targets"
        >
          <Text style={s.bannerCtaText}>Add</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.bannerClose}
          onPress={markSeen}
          accessibilityRole="button"
          accessibilityLabel="Dismiss targets reminder"
        >
          <Ionicons name="close" size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={dismiss}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.modalWrap}
        >
          <View style={s.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={s.sheetTitle}>A few quick stats</Text>
              <Text style={s.sheetSub}>
                Height, age, and sex let us use the Mifflin-St Jeor formula instead of a rough
                per-pound estimate. Your targets update as soon as you save.
              </Text>

              <Text style={s.label}>Height</Text>
              {u.isMetric ? (
                <View style={s.row}>
                  <TextInput
                    style={[s.input, { flex: 1 }]} value={cm} onChangeText={setCm}
                    placeholder="178" placeholderTextColor={colors.textTertiary}
                    keyboardType="number-pad"
                    accessibilityLabel="Height in centimetres"
                  />
                  <Text style={s.suffix}>cm</Text>
                </View>
              ) : (
                <View style={s.row}>
                  <TextInput
                    style={[s.input, { flex: 1 }]} value={ft} onChangeText={setFt}
                    placeholder="5" placeholderTextColor={colors.textTertiary}
                    keyboardType="number-pad"
                    accessibilityLabel="Height, feet"
                  />
                  <Text style={s.suffix}>ft</Text>
                  <TextInput
                    style={[s.input, { flex: 1 }]} value={inch} onChangeText={setInch}
                    placeholder="10" placeholderTextColor={colors.textTertiary}
                    keyboardType="number-pad"
                    accessibilityLabel="Height, inches"
                  />
                  <Text style={s.suffix}>in</Text>
                </View>
              )}

              <Text style={s.label}>Age</Text>
              <View style={s.row}>
                <TextInput
                  style={[s.input, { flex: 1 }]} value={age} onChangeText={setAge}
                  placeholder="28" placeholderTextColor={colors.textTertiary}
                  keyboardType="number-pad"
                  accessibilityLabel="Age in years"
                />
                <Text style={s.suffix}>years</Text>
              </View>

              <Text style={s.label}>Sex</Text>
              <View style={s.row}>
                {SEX_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.key}
                    style={[s.seg, sex === opt.key && s.segActive]}
                    onPress={() => setSex(opt.key)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={opt.label}
                    accessibilityState={{ selected: sex === opt.key }}
                  >
                    <Text style={sex === opt.key ? s.segTextActive : s.segText}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[s.saveBtn, !canSave && s.saveBtnDisabled]}
                onPress={save}
                disabled={!canSave || saving}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Save stats and update targets"
                accessibilityState={{ disabled: !canSave || saving }}
              >
                {saving
                  ? <ActivityIndicator color={colors.accentText} />
                  : <Text style={s.saveBtnText}>Update my targets</Text>}
              </TouchableOpacity>

              <TouchableOpacity
                style={s.skipBtn}
                onPress={dismiss}
                accessibilityRole="button"
                accessibilityLabel="Not now"
              >
                <Text style={s.skipBtnText}>Not now</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    banner: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      marginHorizontal: spacing.lg, marginBottom: spacing.sm,
      paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
      backgroundColor: c.card, borderRadius: radius.card,
      borderWidth: 1, borderColor: c.border,
    },
    bannerTitle: { fontSize: 14, fontWeight: weight.bold, color: c.text },
    bannerSub: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    bannerCta: {
      backgroundColor: c.accent, borderRadius: radius.pill,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    },
    bannerCtaText: { fontSize: 13, fontWeight: weight.bold, color: c.accentText },
    bannerClose: { padding: 4 },

    modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: {
      backgroundColor: c.bgSecondary, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
      padding: spacing.xl, paddingBottom: spacing.xxxl, maxHeight: '88%',
    },
    sheetTitle: { fontSize: 22, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    sheetSub: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginTop: spacing.sm, marginBottom: spacing.xl },
    label: {
      fontSize: 12, color: c.textSecondary, fontWeight: weight.semibold,
      textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.lg },
    input: {
      backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border,
      color: c.text, paddingVertical: 12, paddingHorizontal: 14, fontSize: 20,
      fontWeight: weight.bold, textAlign: 'center',
    },
    suffix: { fontSize: 14, color: c.textSecondary, fontWeight: weight.medium, minWidth: 34 },
    seg: {
      flex: 1, backgroundColor: c.card, borderRadius: radius.md, paddingVertical: 14,
      alignItems: 'center', borderWidth: 1, borderColor: c.border,
    },
    segActive: { backgroundColor: c.accentMuted, borderColor: c.accent },
    segText: { color: c.textSecondary, fontSize: 15, fontWeight: weight.semibold },
    segTextActive: { color: c.accent, fontSize: 15, fontWeight: weight.semibold },
    saveBtn: {
      backgroundColor: c.accent, borderRadius: radius.card, height: 52,
      alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm,
    },
    saveBtnDisabled: { opacity: 0.4 },
    saveBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.bold },
    skipBtn: { alignItems: 'center', paddingVertical: spacing.lg },
    skipBtnText: { color: c.textSecondary, fontSize: 14, fontWeight: weight.semibold },
  });
}
