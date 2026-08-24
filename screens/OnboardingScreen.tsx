import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { useHealth } from '../hooks/useHealth';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { LB_PER_KG, CM_PER_IN } from '../constants/units';
import { deriveMacrosFromCalories, calculateTargets } from '../constants/data';
import { STATS_BACKFILL_KEY } from '../components/StatsBackfillPrompt';
import { track, EVENTS } from '../utils/analytics';

const GOAL_OPTIONS = [
  { key: 'lose',     label: 'Lose Fat',           sub: 'Burn fat while preserving muscle' },
  { key: 'gain',     label: 'Build Muscle',        sub: 'Maximize muscle and strength' },
  { key: 'maintain', label: 'Maintain & Perform',  sub: 'Stay lean and perform your best' },
];

const SOURCE_OPTIONS = [
  { key: 'app_store', label: 'App Store',        sub: 'Searching or browsing the App Store' },
  { key: 'tiktok',    label: 'TikTok',            sub: 'Saw a video or post' },
  { key: 'instagram', label: 'Instagram',         sub: 'Saw a post, reel, or story' },
  { key: 'youtube',   label: 'YouTube',           sub: 'Saw a video or short' },
  { key: 'friend',    label: 'Friend or Family',  sub: 'Someone recommended it' },
  { key: 'referral',  label: 'Referral Code',     sub: 'Used an invite link or code' },
  { key: 'reddit',    label: 'Reddit / Forum',    sub: 'Saw a post or comment' },
  { key: 'other',     label: 'Other',             sub: 'Somewhere else' },
];

const ACTIVITY_OPTIONS = [
  { key: 'sedentary',  label: 'Sedentary',      sub: 'Desk job, little or no exercise',    mult: 1.0 },
  { key: 'light',      label: 'Lightly Active', sub: '1–3 workouts per week',               mult: 1.1 },
  { key: 'active',     label: 'Active',          sub: '4–5 workouts per week',               mult: 1.2 },
  { key: 'very_active', label: 'Very Active',   sub: 'Athlete or manual labor',             mult: 1.35 },
];

const SEX_OPTIONS = [
  { key: 'male',   label: 'Male'   },
  { key: 'female', label: 'Female' },
];

/**
 * Onboarding FALLBACK calorie estimate.
 *
 * Onboarding now asks for height, age, and sex, so the normal path is
 * calculateTargets() (Mifflin-St Jeor / Katch-McArdle) — the same math Profile
 * and the TDEE layer use. This cal-per-lb shortcut is only used when one of
 * those three fields is somehow missing (e.g. a user skips ahead on a future
 * variant of the flow), so we still produce *something* usable rather than 0s.
 *
 * The MACRO SPLIT still goes through the shared deriveMacrosFromCalories so
 * protein and fat follow the same goal-aware rules as everywhere else.
 *
 * This used to be a fourth private copy of the macro math, and its protein
 * ratios were backwards relative to the evidence (more protein for gaining than
 * for cutting; the ISSN position stand says the opposite).
 */
function calcMacros(goal: string, activity: string, weight_lbs: number) {
  const baseCalMap: Record<string, number> = { lose: 12, gain: 16, maintain: 14 };
  const multMap: Record<string, number> = { sedentary: 1.0, light: 1.1, active: 1.2, very_active: 1.35 };

  const baseCal = (baseCalMap[goal] ?? 14) * weight_lbs;
  const calories = Math.round(baseCal * (multMap[activity] ?? 1.0));
  return deriveMacrosFromCalories(calories, { weight_lbs, goal });
}

export default function OnboardingScreen({
  onComplete,
}: {
  onComplete: (p: any, openTab?: string) => void;
}) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { user } = useAuth();
  const health = useHealth();

  // 0=goal 1=activity 2=weight 3=body stats (height+age+sex) 4=source 5=summary
  const QUESTION_COUNT = 5;
  const SUMMARY_STEP   = QUESTION_COUNT;
  /** Readable names so funnel drop-off is legible without decoding indices. */
  const STEP_NAMES = ['goal', 'activity', 'weight', 'body_stats', 'source', 'summary'];

  const [step, setStep]       = useState(0);
  const [goal, setGoal]       = useState('');
  const [activity, setActivity] = useState('');
  const [source, setSource]   = useState('');
  const [weightStr, setWeightStr] = useState('');
  const [heightFtStr, setHeightFtStr]   = useState('');
  const [heightInStr, setHeightInStr]   = useState('');
  const [heightCmStr, setHeightCmStr]   = useState('');
  const [ageStr, setAgeStr]   = useState('');
  const [sex, setSex]         = useState('');
  const [isKg, setIsKg]       = useState(false);
  const [loading, setLoading] = useState(false);

  const weight_lbs = isKg
    ? (parseFloat(weightStr) || 0) * LB_PER_KG
    : parseFloat(weightStr) || 0;

  // Canonical storage is always imperial (see constants/units.tsx) — the metric
  // toggle only changes what we ask for at the input edge.
  const height_in = isKg
    ? (parseFloat(heightCmStr) || 0) / CM_PER_IN
    : (parseInt(heightFtStr, 10) || 0) * 12 + (parseInt(heightInStr, 10) || 0);

  const age = parseInt(ageStr, 10) || 0;

  // Mifflin-St Jeor needs all three. When we have them, targets come from the
  // shared calculateTargets() — the same function Profile uses — so a new user
  // gets accurate numbers on day one instead of only after visiting Profile.
  const hasFullStats = height_in > 0 && age > 0 && !!sex;

  const macros = step === SUMMARY_STEP && goal && activity && weight_lbs
    ? (hasFullStats
        ? calculateTargets({ weight_lbs, height_in, age, sex, activity, goal })
        : calcMacros(goal, activity, weight_lbs))
    : null;

  const canNext = () => {
    if (step === 0) return !!goal;
    if (step === 1) return !!activity;
    if (step === 2) return weight_lbs > 0;
    if (step === 3) return hasFullStats;
    if (step === 4) return !!source;
    return false;
  };

  const save = async (openTab?: string) => {
    if (!user || !macros) return;
    setLoading(true);
    try {
      const profile = {
        id: user.id,
        name: '',
        weight_lbs,
        height_in: height_in || null,
        age: age || null,
        sex: sex || null,
        unit_system: isKg ? 'metric' : 'imperial',
        goal,
        activity,
        acquisition_source: source || null,
        ...macros,
      };
      const { error } = await supabase.from('profiles').upsert(profile);
      if (error) { Alert.alert('Error', error.message); return; }

      // Fire the Health permission prompt HERE, while we have the user's
      // attention, instead of leaving it to whichever tab happens to ask
      // first. A fresh device that never visits Stats/Recover otherwise shows
      // zeros everywhere with no prompt ever fired (device-test finding).
      // iOS prompts once per device; this is a no-op when already decided.
      // Notifications are requested by App.tsx right after onboarding, so
      // Health is the only prompt that needs a home here.
      try {
        if (!health.isAuthorized) await health.requestPermissions();
      } catch { /* denied or unavailable is fine — screens degrade gracefully */ }

      await AsyncStorage.setItem('fuelog_onboarding_complete', Date.now().toString());
      await AsyncStorage.setItem('fuelog_weight_unit', isKg ? 'kg' : 'lbs');
      // New users answered height/age/sex here, so they never need the
      // one-time backfill banner that existing users get.
      await AsyncStorage.setItem(STATS_BACKFILL_KEY, 'onboarded');
      track(EVENTS.ONBOARDING_COMPLETED, {
        goal, activity, source: source || null,
        // Did they give us enough for the accurate BMR path?
        accurate_targets: !!(height_in && age && sex),
      });
      onComplete(profile, openTab);
    } finally {
      setLoading(false);
    }
  };

  // ── Step renderers ──────────────────────────────────────────────────────────

  const stepGoal = (
    <View style={s.stepWrap}>
      <Text style={s.question}>What's your primary goal?</Text>
      <View style={s.cardList}>
        {GOAL_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.key}
            style={[s.card, goal === opt.key && s.cardActive]}
            onPress={() => setGoal(opt.key)}
            accessibilityRole="radio"
            accessibilityLabel={`${opt.label}. ${opt.sub}`}
            accessibilityState={{ selected: goal === opt.key }}
            activeOpacity={0.75}
          >
            <Text style={[s.cardLabel, goal === opt.key && s.cardLabelActive]}>{opt.label}</Text>
            <Text style={[s.cardSub,   goal === opt.key && s.cardSubActive]}>{opt.sub}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const stepActivity = (
    <View style={s.stepWrap}>
      <Text style={s.question}>How active are you?</Text>
      <View style={s.cardList}>
        {ACTIVITY_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.key}
            style={[s.card, activity === opt.key && s.cardActive]}
            onPress={() => setActivity(opt.key)}
            accessibilityRole="radio"
            accessibilityLabel={`${opt.label}. ${opt.sub}`}
            accessibilityState={{ selected: activity === opt.key }}
            activeOpacity={0.75}
          >
            <Text style={[s.cardLabel, activity === opt.key && s.cardLabelActive]}>{opt.label}</Text>
            <Text style={[s.cardSub,   activity === opt.key && s.cardSubActive]}>{opt.sub}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const stepWeight = (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.stepWrap}>
      <Text style={s.question}>What's your current weight?</Text>
      <View style={s.unitRow}>
        {(['lbs', 'kg'] as const).map(u => (
          <TouchableOpacity
            key={u}
            style={[s.unitBtn, (u === 'kg') === isKg && s.unitBtnActive]}
            onPress={() => setIsKg(u === 'kg')}
          >
            <Text style={[(u === 'kg') === isKg ? s.unitBtnTextActive : s.unitBtnText]}>{u}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={s.weightInput}
        value={weightStr}
        onChangeText={setWeightStr}
        placeholder={isKg ? '78' : '172'}
        placeholderTextColor={colors.textTertiary}
        keyboardType="decimal-pad"
        autoFocus
      />
      <Text style={s.weightUnit}>{isKg ? 'kg' : 'lbs'}</Text>
    </KeyboardAvoidingView>
  );

  // Height + age + sex in ONE step. These three are what Mifflin-St Jeor needs;
  // splitting them across three screens would add friction at the top of the
  // funnel for no benefit.
  const stepBodyStats = (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.stepWrap}>
      <Text style={s.question}>A few quick stats</Text>
      <Text style={s.questionSub}>
        Height, age, and sex let us calculate your calorie needs properly instead of estimating.
      </Text>

      <Text style={s.inlineLabel}>Height</Text>
      {isKg ? (
        <View style={s.statRow}>
          <TextInput
            style={[s.statInput, { flex: 1 }]}
            value={heightCmStr}
            onChangeText={setHeightCmStr}
            placeholder="178"
            placeholderTextColor={colors.textTertiary}
            keyboardType="number-pad"
          />
          <Text style={s.statSuffix}>cm</Text>
        </View>
      ) : (
        <View style={s.statRow}>
          <TextInput
            style={[s.statInput, { flex: 1 }]}
            value={heightFtStr}
            onChangeText={setHeightFtStr}
            placeholder="5"
            placeholderTextColor={colors.textTertiary}
            keyboardType="number-pad"
          />
          <Text style={s.statSuffix}>ft</Text>
          <TextInput
            style={[s.statInput, { flex: 1 }]}
            value={heightInStr}
            onChangeText={setHeightInStr}
            placeholder="10"
            placeholderTextColor={colors.textTertiary}
            keyboardType="number-pad"
          />
          <Text style={s.statSuffix}>in</Text>
        </View>
      )}

      <Text style={s.inlineLabel}>Age</Text>
      <View style={s.statRow}>
        <TextInput
          style={[s.statInput, { flex: 1 }]}
          value={ageStr}
          onChangeText={setAgeStr}
          placeholder="28"
          placeholderTextColor={colors.textTertiary}
          keyboardType="number-pad"
        />
        <Text style={s.statSuffix}>years</Text>
      </View>

      <Text style={s.inlineLabel}>Sex</Text>
      <View style={s.unitRow}>
        {SEX_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.key}
            style={[s.unitBtn, sex === opt.key && s.unitBtnActive]}
            onPress={() => setSex(opt.key)}
            activeOpacity={0.75}
            accessibilityRole="radio"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected: sex === opt.key }}
          >
            <Text style={sex === opt.key ? s.unitBtnTextActive : s.unitBtnText}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.statHint}>Used only for the Mifflin-St Jeor metabolic formula.</Text>
    </KeyboardAvoidingView>
  );

  const stepSource = (
    <View style={s.stepWrap}>
      <Text style={s.question}>How did you hear about Fuelog?</Text>
      <View style={s.cardList}>
        {SOURCE_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.key}
            style={[s.card, source === opt.key && s.cardActive]}
            onPress={() => setSource(opt.key)}
            accessibilityRole="radio"
            accessibilityLabel={`${opt.label}. ${opt.sub}`}
            accessibilityState={{ selected: source === opt.key }}
            activeOpacity={0.75}
          >
            <Text style={[s.cardLabel, source === opt.key && s.cardLabelActive]}>{opt.label}</Text>
            <Text style={[s.cardSub,   source === opt.key && s.cardSubActive]}>{opt.sub}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const stepSummary = macros ? (
    <View style={s.summaryWrap}>
      <Text style={s.summaryHeading}>You're all set</Text>
      <Text style={s.summarySubheading}>
        {hasFullStats
          ? 'Your daily targets, from your metabolic rate'
          : 'Your suggested daily targets'}
      </Text>

      <View style={s.macroGrid}>
        <View style={s.macroCard}>
          <Text style={s.macroValue}>{macros.calories}</Text>
          <Text style={s.macroLabel}>Calories</Text>
        </View>
        <View style={s.macroCard}>
          <Text style={[s.macroValue, { color: '#4A9EFF' }]}>{macros.protein}g</Text>
          <Text style={s.macroLabel}>Protein</Text>
        </View>
        <View style={s.macroCard}>
          <Text style={[s.macroValue, { color: '#F5A623' }]}>{macros.carbs}g</Text>
          <Text style={s.macroLabel}>Carbs</Text>
        </View>
        <View style={s.macroCard}>
          <Text style={[s.macroValue, { color: '#F472B6' }]}>{macros.fat}g</Text>
          <Text style={s.macroLabel}>Fat</Text>
        </View>
      </View>
    </View>
  ) : null;

  const steps = [stepGoal, stepActivity, stepWeight, stepBodyStats, stepSource];

  // ── Render ──────────────────────────────────────────────────────────────────

  if (step === SUMMARY_STEP) {
    return (
      <SafeAreaView style={s.safe}>
        <ScrollView contentContainerStyle={s.summaryScroll} showsVerticalScrollIndicator={false}>
          {stepSummary}
        </ScrollView>
        <View style={s.footer}>
          <TouchableOpacity style={s.adjustBtn} onPress={() => save('profile')} disabled={loading} activeOpacity={0.8}>
            <Text style={s.adjustBtnText}>Adjust →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.nextBtn, { flex: 1 }]} onPress={() => save()} disabled={loading} activeOpacity={0.8}>
            {loading
              ? <ActivityIndicator color={colors.accentText} />
              : <Text style={s.nextBtnText}>Looks good →</Text>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      {/* Progress dots — one per question */}
      <View style={s.dots}>
        {Array.from({ length: QUESTION_COUNT }, (_, i) => (
          <View key={i} style={[s.dot, i === step && s.dotActive, i < step && s.dotDone]} />
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {steps[step]}
      </ScrollView>

      <View style={s.footer}>
        {step > 0 && (
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => setStep(step - 1)}
            accessibilityRole="button"
            accessibilityLabel="Back">
            <Text style={s.backBtnText}>Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.nextBtn, step > 0 ? { flex: 1 } : { width: '100%' }]}
          onPress={() => {
            // Step-level funnel event — this is what shows WHERE people abandon
            // onboarding, which is currently invisible.
            track(EVENTS.ONBOARDING_STEP_COMPLETED, { step, name: STEP_NAMES[step] ?? String(step) });
            setStep(step + 1);
          }}
          disabled={!canNext()}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Continue"
          accessibilityState={{ disabled: !canNext() }}
          accessibilityHint={canNext() ? undefined : 'Answer the question above to continue'}
        >
          <Text style={s.nextBtnText}>Continue →</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe:   { flex: 1, backgroundColor: c.bg },
    dots:   { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: spacing.lg },
    dot:       { width: 8,  height: 4, borderRadius: radius.pill, backgroundColor: c.border },
    dotActive: { width: 20, height: 4, borderRadius: radius.pill, backgroundColor: c.accent },
    dotDone:   { width: 8,  height: 4, borderRadius: radius.pill, backgroundColor: c.accent },
    content: { padding: spacing.xl, paddingBottom: 12 },
    stepWrap: { flex: 1 },
    question: { fontSize: 26, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5, marginBottom: spacing.xxl },
    questionSub: { fontSize: 14, color: c.textSecondary, fontWeight: weight.regular, marginTop: -spacing.lg, marginBottom: spacing.xl, lineHeight: 20 },
    cardList: { gap: 12 },
    card: {
      backgroundColor: c.card,
      borderRadius: radius.card,
      padding: spacing.xl,
      borderWidth: 1.5,
      borderColor: c.border,
    },
    cardActive:      { backgroundColor: c.accentMuted, borderColor: c.accent },
    cardLabel:       { fontSize: 17, fontWeight: weight.bold, color: c.text, marginBottom: 4 },
    cardLabelActive: { color: c.accent },
    cardSub:         { fontSize: 13, color: c.textSecondary, fontWeight: weight.regular },
    cardSubActive:   { color: c.accent },
    // Weight step
    unitRow: { flexDirection: 'row', gap: 10, marginBottom: spacing.lg },
    unitBtn: {
      flex: 1, backgroundColor: c.card, borderRadius: radius.md, padding: 14,
      alignItems: 'center', borderWidth: 1, borderColor: c.border,
    },
    unitBtnActive:      { backgroundColor: c.accentMuted, borderColor: c.accent },
    unitBtnText:        { color: c.textSecondary, fontSize: 15, fontWeight: weight.semibold },
    unitBtnTextActive:  { color: c.accent, fontSize: 15, fontWeight: weight.semibold },
    weightInput: {
      backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1.5, borderColor: c.accent,
      color: c.text, padding: 20, fontSize: 40, fontWeight: weight.heavy,
      textAlign: 'center', letterSpacing: -1, marginBottom: spacing.sm,
    },
    weightUnit: { textAlign: 'center', fontSize: 14, color: c.textSecondary, fontWeight: weight.medium },
    // Body stats step (height / age / sex)
    inlineLabel: {
      fontSize: 12, color: c.textSecondary, fontWeight: weight.semibold,
      textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm,
    },
    statRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.lg },
    statInput: {
      backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border,
      color: c.text, paddingVertical: 14, paddingHorizontal: 16, fontSize: 22,
      fontWeight: weight.bold, textAlign: 'center',
    },
    statSuffix: { fontSize: 14, color: c.textSecondary, fontWeight: weight.medium, minWidth: 34 },
    statHint: { fontSize: 12, color: c.textTertiary, fontWeight: weight.regular, marginTop: spacing.md },
    // Summary
    summaryScroll: { flexGrow: 1, padding: spacing.xl, justifyContent: 'center' },
    summaryWrap:  { alignItems: 'center' },
    summaryHeading:    { fontSize: 32, fontWeight: weight.heavy, color: c.accent, letterSpacing: -1, marginBottom: spacing.sm, textAlign: 'center' },
    summarySubheading: { fontSize: 15, color: c.textSecondary, fontWeight: weight.medium, marginBottom: spacing.xxl, textAlign: 'center' },
    macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', width: '100%' },
    macroCard: {
      backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.border,
      padding: spacing.xl, alignItems: 'center', width: '46%',
    },
    macroValue: { fontSize: 28, fontWeight: weight.heavy, color: c.text, letterSpacing: -1 },
    macroLabel: { fontSize: 12, color: c.textSecondary, fontWeight: weight.semibold, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
    // Footer
    footer:  { flexDirection: 'row', gap: 10, padding: spacing.xl, paddingTop: 12 },
    backBtn: { backgroundColor: c.card, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', width: 72, borderWidth: 1, borderColor: c.border },
    backBtnText: { color: c.textSecondary, fontSize: 15, fontWeight: weight.semibold },
    nextBtn: { backgroundColor: c.accent, borderRadius: radius.card, padding: spacing.lg, alignItems: 'center', height: 52, justifyContent: 'center' },
    nextBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.bold },
    adjustBtn: { backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg, alignItems: 'center', height: 52, justifyContent: 'center', borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.xl },
    adjustBtnText: { color: c.textSecondary, fontSize: 15, fontWeight: weight.semibold },
  });
}
