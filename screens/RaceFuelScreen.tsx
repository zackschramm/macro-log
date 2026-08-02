/**
 * Race-day fuelling plan.
 *
 * The engine in utils/raceFueling.ts has been correct and untouched for a
 * while, but nothing in the app called it — the numbers only ever reached the
 * athlete second-hand, through the Coach's context block. This is the direct
 * surface: give it your distance and a target finish, get the leg-by-leg carb,
 * fluid and sodium plan it has always been able to produce.
 *
 * Two things hang off the moment the plan appears:
 *  • the store-review prompt (see the useEffect below) — this is the one point
 *    in the app where the user has just been handed something genuinely
 *    valuable, as opposed to having finished a chore;
 *  • the share card, which is the only artefact in the app another athlete
 *    would actually want to see.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import ShareCardGenerator from '../components/ShareCardGenerator';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { KG_PER_LB } from '../constants/units';
import {
  buildRacePlan, estimateSplits, TRI_COURSES,
  type Leg, type RacePlan, type TriDistance,
} from '../utils/raceFueling';
import { SPORT_TO_DISTANCE } from '../utils/enduranceContext';
import { maybeRequestReview } from '../utils/storeReview';
import { track, EVENTS } from '../utils/analytics';
import { logError } from '../utils/logError';

const DISTANCES: TriDistance[] = ['sprint', 'olympic', 'half', 'full'];

const LEG_META: Record<Leg, { label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  swim: { label: 'Swim', icon: 'water-outline' },
  bike: { label: 'Bike', icon: 'bicycle-outline' },
  run:  { label: 'Run',  icon: 'walk-outline' },
};

/** Midpoint of the typical finishing range — a sane starting guess. */
function defaultFinishHours(d: TriDistance): number {
  const [lo, hi] = TRI_COURSES[d].typicalHours;
  return (lo + hi) / 2;
}

function splitHM(hours: number): { h: string; m: string } {
  const total = Math.round(hours * 60);
  return { h: String(Math.floor(total / 60)), m: String(total % 60).padStart(2, '0') };
}

function hm(hours: number): string {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function RaceFuelScreen({ profile }: { profile: any }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const profileDistance = SPORT_TO_DISTANCE[profile?.sport ?? ''] ?? 'half';
  const [distance, setDistance] = useState<TriDistance>(profileDistance);

  const initial = splitHM(defaultFinishHours(profileDistance));
  const [hours, setHours] = useState(initial.h);
  const [minutes, setMinutes] = useState(initial.m);
  const [raceName, setRaceName] = useState('');
  const [hot, setHot] = useState(false);

  const [plan, setPlan] = useState<RacePlan | null>(null);
  const [showCard, setShowCard] = useState(false);
  const shareRef = useRef<View>(null);

  // Everything the plan is capped by comes from the profile — these are
  // measurements, not things to re-ask for on a planning screen.
  const massKg = profile?.weight_lbs ? profile.weight_lbs * KG_PER_LB : 0;
  const trainedTolerance: number | null = profile?.carb_tolerance_g_per_h ?? null;
  const sweatRate: number | null = profile?.sweat_rate_l_per_h ?? null;

  const finishHours = useMemo(() => {
    const h = parseInt(hours, 10);
    const m = parseInt(minutes, 10);
    const total = (Number.isFinite(h) ? h : 0) + (Number.isFinite(m) ? m : 0) / 60;
    return total > 0 ? total : 0;
  }, [hours, minutes]);

  const canGenerate = massKg > 0 && finishHours > 0;

  const pickDistance = (d: TriDistance) => {
    setDistance(d);
    const next = splitHM(defaultFinishHours(d));
    setHours(next.h);
    setMinutes(next.m);
    setPlan(null);
  };

  const generate = () => {
    if (!canGenerate) return;
    const splits = estimateSplits(distance, finishHours);
    const next = buildRacePlan({
      splits,
      massKg,
      // buildRacePlan treats a non-positive tolerance as "unset" and falls back
      // to the guideline rate for the duration, which is what the banner below
      // warns about.
      trainedToleranceGPerH: trainedTolerance ?? 0,
      sweatRateLPerH: sweatRate,
      hot,
    });
    setPlan(next);
    track(EVENTS.RACE_PLAN_GENERATED, {
      distance,
      hours: next.totalHours,
      rate: next.prescribedRateGPerH,
      limitedByTolerance: next.limitedByTolerance,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  /**
   * Ask for a review off the back of the plan, not off the back of logging a
   * meal. Logging is a chore — nobody has ever felt delighted keying in a
   * chicken breast — and prompting there was buying 1-star reflexes. Handing
   * someone a nine-hour fuelling plan they'd otherwise have built in a
   * spreadsheet is the opposite.
   *
   * The delay lets the plan actually paint before the system sheet slides over
   * it; `maybeRequestReview` still enforces its own 60-day floor on top.
   */
  useEffect(() => {
    if (!plan) return;
    const t = setTimeout(() => { maybeRequestReview(); }, 1500);
    return () => clearTimeout(t);
  }, [plan]);

  const cardData = plan && plan.legs.length > 0 ? {
    raceName: raceName.trim() || `${TRI_COURSES[distance].label} race fuel`,
    distanceLabel: TRI_COURSES[distance].label,
    totalHours: plan.totalHours,
    totalCarbG: plan.totalCarbG,
    legs: plan.legs.map(l => ({
      leg: l.leg,
      hours: l.hours,
      carbRateGPerH: l.carbRateGPerH,
      fluidL: l.fluidL,
      sodiumMg: l.sodiumMg,
    })),
  } : null;

  const share = async () => {
    if (!cardData) return;
    setShowCard(true);
    // Give the off-screen card a frame to lay out before capturing it.
    await new Promise(r => setTimeout(r, 80));
    try {
      const uri = await captureRef(shareRef, { format: 'jpg', quality: 0.92 });
      setShowCard(false);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'Share Race Fuel Plan' });
      }
      track(EVENTS.RACE_PLAN_SHARED, { distance });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setShowCard(false);
      logError('RaceFuelScreen.share', e);
    }
  };

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled">

      <Text style={s.blurb}>
        Leg-by-leg carbohydrate, fluid and sodium for race day, capped at the rate
        you've actually trained.
      </Text>

      {/* ── Inputs ─────────────────────────────────────────────────────────── */}
      <Text style={s.sectionLabel}>RACE</Text>
      <View style={s.card}>
        <Text style={s.fieldLabel}>Race name</Text>
        <TextInput
          style={s.input}
          value={raceName}
          onChangeText={setRaceName}
          placeholder="e.g. Ironman Wisconsin"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Race name"
        />

        <Text style={[s.fieldLabel, { marginTop: spacing.lg }]}>Distance</Text>
        <View style={s.chipRow}>
          {DISTANCES.map(d => {
            const active = distance === d;
            return (
              <TouchableOpacity
                key={d}
                style={[s.chip, active && s.chipActive]}
                onPress={() => pickDistance(d)}
                activeOpacity={0.7}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={TRI_COURSES[d].label}>
                <Text style={[s.chipText, active && s.chipTextActive]}>{TRI_COURSES[d].label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={s.help}>
          {TRI_COURSES[distance].swimKm}km swim · {TRI_COURSES[distance].bikeKm}km bike ·{' '}
          {TRI_COURSES[distance].runKm}km run
        </Text>

        <Text style={[s.fieldLabel, { marginTop: spacing.lg }]}>Target finish time</Text>
        <View style={s.timeRow}>
          <TextInput
            style={[s.input, s.timeInput]}
            value={hours}
            onChangeText={setHours}
            keyboardType="number-pad"
            maxLength={2}
            accessibilityLabel="Target finish hours"
          />
          <Text style={s.timeUnit}>h</Text>
          <TextInput
            style={[s.input, s.timeInput]}
            value={minutes}
            onChangeText={setMinutes}
            keyboardType="number-pad"
            maxLength={2}
            accessibilityLabel="Target finish minutes"
          />
          <Text style={s.timeUnit}>min</Text>
        </View>
        <Text style={s.help}>
          Splits are estimated from typical {TRI_COURSES[distance].label} pacing. The total
          duration is what sets the carbohydrate rate.
        </Text>

        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.fieldLabel}>Hot or humid</Text>
            <Text style={s.help}>Raises the sweat rate 25%.</Text>
          </View>
          <Switch
            value={hot}
            onValueChange={setHot}
            trackColor={{ false: colors.borderStrong, true: colors.accent }}
            thumbColor={colors.white}
            accessibilityLabel="Hot or humid conditions"
          />
        </View>
      </View>

      {/* ── What the plan is built from ────────────────────────────────────── */}
      <Text style={s.sectionLabel}>FROM YOUR PROFILE</Text>
      <View style={s.card}>
        <ProfileRow
          s={s} colors={colors} icon="barbell-outline" label="Body mass"
          value={massKg > 0 ? `${massKg.toFixed(1)} kg` : 'Not set'} missing={massKg <= 0} />
        <ProfileRow
          s={s} colors={colors} icon="nutrition-outline" label="Trained carb rate"
          value={trainedTolerance ? `${trainedTolerance} g/h` : 'Not set'} missing={!trainedTolerance} />
        <ProfileRow
          s={s} colors={colors} icon="water-outline" label="Sweat rate"
          value={sweatRate ? `${sweatRate} L/h` : 'Population default'} missing={false} />
      </View>

      {massKg <= 0 && (
        <View style={s.warnCard}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
          <Text style={s.warnText}>
            Add your weight in Me → Personal. Every number in the plan scales off body mass.
          </Text>
        </View>
      )}

      {!trainedTolerance && (
        <View style={s.warnCard}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
          <Text style={s.warnText}>
            No trained carb rate set, so this uses the guideline rate for the distance.
            Set it in Me → Training and the plan will be capped at what you've practised —
            an untrained rate causes GI distress no matter how fit you are.
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[s.cta, !canGenerate && s.ctaDisabled]}
        onPress={generate}
        disabled={!canGenerate}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Generate race fuel plan"
        accessibilityState={{ disabled: !canGenerate }}>
        <Text style={s.ctaText}>{plan ? 'Recalculate' : 'Build My Fuel Plan'}</Text>
      </TouchableOpacity>

      {/* ── The plan ───────────────────────────────────────────────────────── */}
      {plan && (
        <>
          <View style={s.planHeaderRow}>
            <Text style={s.sectionLabel}>YOUR PLAN</Text>
            <TouchableOpacity
              onPress={share}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Share race fuel plan">
              <View style={s.shareBtn}>
                <Ionicons name="share-outline" size={15} color={colors.accent} />
                <Text style={s.shareBtnText}>Share</Text>
              </View>
            </TouchableOpacity>
          </View>

          <View style={s.card}>
            <View style={s.heroRow}>
              <View style={s.heroItem}>
                <Text style={s.heroVal}>{plan.prescribedRateGPerH}</Text>
                <Text style={s.heroLabel}>g carb/h</Text>
              </View>
              <View style={s.heroDivider} />
              <View style={s.heroItem}>
                <Text style={s.heroVal}>{plan.totalCarbG}</Text>
                <Text style={s.heroLabel}>g total</Text>
              </View>
              <View style={s.heroDivider} />
              <View style={s.heroItem}>
                <Text style={s.heroVal}>{plan.totalFluidL}</Text>
                <Text style={s.heroLabel}>L fluid</Text>
              </View>
              <View style={s.heroDivider} />
              <View style={s.heroItem}>
                <Text style={s.heroVal}>{plan.totalSodiumMg}</Text>
                <Text style={s.heroLabel}>mg sodium</Text>
              </View>
            </View>
            <Text style={s.heroSub}>
              Over {hm(plan.totalHours)} · caffeine {plan.caffeineMg.min}–{plan.caffeineMg.max} mg
            </Text>
          </View>

          {plan.legs.map(l => (
            <View key={l.leg} style={s.legCard}>
              <View style={s.legHead}>
                <Ionicons name={LEG_META[l.leg].icon} size={18} color={colors.accent} />
                <Text style={s.legName}>{LEG_META[l.leg].label}</Text>
                <View style={{ flex: 1 }} />
                <Text style={s.legHours}>{hm(l.hours)}</Text>
              </View>
              <View style={s.legStats}>
                <View style={s.legStat}>
                  <Text style={s.legStatVal}>{l.carbRateGPerH}</Text>
                  <Text style={s.legStatLabel}>g carb/h</Text>
                </View>
                <View style={s.legStat}>
                  <Text style={s.legStatVal}>{l.fluidL}</Text>
                  <Text style={s.legStatLabel}>L fluid</Text>
                </View>
                <View style={s.legStat}>
                  <Text style={s.legStatVal}>{l.sodiumMg}</Text>
                  <Text style={s.legStatLabel}>mg sodium</Text>
                </View>
              </View>
              {l.leg === 'swim' && l.carbRateGPerH === 0 && (
                <Text style={s.legNote}>Nothing practical to take in the water.</Text>
              )}
              {l.mixedSourceRequired && (
                <Text style={s.legNote}>Mixed glucose:fructose required at this rate.</Text>
              )}
            </View>
          ))}

          {plan.notes.length > 0 && (
            <View style={s.card}>
              {plan.notes.map(n => (
                <View key={n} style={s.noteRow}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.textTertiary} />
                  <Text style={s.noteText}>{n}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* Off-screen share card — captured by captureRef, never visible. */}
      {showCard && cardData && (
        <View style={{ position: 'absolute', left: -9999, top: 0 }} pointerEvents="none">
          <View ref={shareRef} collapsable={false}>
            <ShareCardGenerator type="race" data={cardData} />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function ProfileRow({
  s, colors, icon, label, value, missing,
}: {
  s: any;
  colors: ThemeColors;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  missing: boolean;
}) {
  return (
    <View style={s.profileRow}>
      <Ionicons name={icon} size={16} color={colors.textTertiary} />
      <Text style={s.profileLabel}>{label}</Text>
      <View style={{ flex: 1 }} />
      <Text style={[s.profileValue, missing && { color: colors.warning }]}>{value}</Text>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll: { flex: 1, backgroundColor: c.bg },
    content: { padding: spacing.xl, paddingBottom: 60 },
    blurb: { fontSize: 14, color: c.textSecondary, lineHeight: 20, marginBottom: spacing.xl },
    sectionLabel: {
      fontSize: 11, fontWeight: weight.heavy, color: c.textTertiary,
      letterSpacing: 1.4, marginBottom: spacing.sm, marginTop: spacing.md,
    },
    card: {
      backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border, marginBottom: spacing.md,
    },
    fieldLabel: { fontSize: 13, fontWeight: weight.bold, color: c.text },
    help: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginTop: 6 },
    input: {
      fontSize: 15, color: c.text, backgroundColor: c.cardAlt,
      borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
      paddingHorizontal: 12, paddingVertical: 10, marginTop: 8,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    chip: {
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill,
      backgroundColor: c.cardAlt, borderWidth: 1.5, borderColor: 'transparent',
    },
    chipActive: { borderColor: c.accent, backgroundColor: c.accentMuted },
    chipText: { fontSize: 13, fontWeight: weight.semibold, color: c.textSecondary },
    chipTextActive: { color: c.accent },
    timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    timeInput: { width: 64, textAlign: 'center' },
    timeUnit: { fontSize: 13, color: c.textSecondary, fontWeight: weight.semibold, marginTop: 8 },
    switchRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      marginTop: spacing.lg, paddingTop: spacing.lg,
      borderTopWidth: 1, borderTopColor: c.border,
    },
    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
    profileLabel: { fontSize: 14, color: c.textSecondary, fontWeight: weight.medium },
    profileValue: { fontSize: 14, color: c.text, fontWeight: weight.bold },
    warnCard: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 10,
      backgroundColor: c.card, borderRadius: radius.md, padding: spacing.md,
      borderWidth: 1, borderColor: c.warning, marginBottom: spacing.md,
    },
    warnText: { flex: 1, fontSize: 13, color: c.textSecondary, lineHeight: 18 },
    cta: {
      backgroundColor: c.accent, borderRadius: radius.card,
      paddingVertical: 16, alignItems: 'center', marginTop: spacing.sm,
    },
    ctaDisabled: { opacity: 0.4 },
    ctaText: { color: c.accentText, fontSize: 16, fontWeight: weight.heavy },
    planHeaderRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginTop: spacing.xxl,
    },
    shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    shareBtnText: { fontSize: 13, fontWeight: weight.bold, color: c.accent },
    heroRow: { flexDirection: 'row', alignItems: 'center' },
    heroItem: { flex: 1, alignItems: 'center' },
    heroDivider: { width: 1, height: 30, backgroundColor: c.border },
    heroVal: { fontSize: 20, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    heroLabel: { fontSize: 10, fontWeight: weight.semibold, color: c.textTertiary, marginTop: 2 },
    heroSub: {
      fontSize: 12, color: c.textSecondary, fontWeight: weight.medium,
      textAlign: 'center', marginTop: spacing.md,
    },
    legCard: {
      backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border, marginBottom: spacing.md,
    },
    legHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md },
    legName: { fontSize: 15, fontWeight: weight.heavy, color: c.text },
    legHours: { fontSize: 13, fontWeight: weight.semibold, color: c.textTertiary },
    legStats: {
      flexDirection: 'row', backgroundColor: c.cardAlt,
      borderRadius: radius.md, paddingVertical: spacing.md,
    },
    legStat: { flex: 1, alignItems: 'center' },
    legStatVal: { fontSize: 18, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    legStatLabel: { fontSize: 10, fontWeight: weight.semibold, color: c.textTertiary, marginTop: 2 },
    legNote: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginTop: spacing.sm },
    noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 5 },
    noteText: { flex: 1, fontSize: 13, color: c.textSecondary, lineHeight: 18 },
  });
}
