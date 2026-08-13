/**
 * Single-discipline event fuelling plan.
 *
 * RaceFuelScreen is the triathlon surface: three legs, splits estimated from
 * the distance. This is its sibling for everything with ONE discipline — trail
 * ultras, mountain-bike hundreds, road centuries, big hiking days — where the
 * questions that matter are different: what discipline, how long, and how high.
 * The engine is utils/eventFueling.ts, which reuses the raceFueling constants
 * rather than duplicating them.
 *
 * Altitude is the reason this screen exists (Leadville sits at 3,100-3,800 m),
 * so the course altitude is a first-class input rather than a buried toggle,
 * and the preset row can fill the whole form for the marquee events.
 */

import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { KG_PER_LB, useUnits } from '../constants/units';
import {
  buildEventPlan, DISCIPLINE_LABEL, EVENT_DISCIPLINES,
  type EventDiscipline, type EventPlan,
} from '../utils/eventFueling';
import { track, EVENTS } from '../utils/analytics';

const M_PER_FT = 0.3048;

const DISCIPLINE_ICON: Record<EventDiscipline, React.ComponentProps<typeof Ionicons>['name']> = {
  run:  'walk-outline',
  mtb:  'trail-sign-outline',
  road: 'bicycle-outline',
  hike: 'footsteps-outline',
};

/** Sensible starting discipline from the profile sport, mirroring RaceFuel. */
const SPORT_TO_DISCIPLINE: Record<string, EventDiscipline> = {
  running: 'run',
  cycling: 'road',
  hiking:  'hike',
};

interface Preset {
  label: string;
  discipline: EventDiscipline;
  hours: number;
  altitudeM?: number;
}

/** One tap fills the form; every value stays editable afterwards. */
const PRESETS: Preset[] = [
  { label: 'Leadville 100 MTB', discipline: 'mtb', hours: 10.5, altitudeM: 3200 },
  { label: '50K',               discipline: 'run', hours: 6 },
  { label: '100 mi run',        discipline: 'run', hours: 24 },
  { label: 'Century',           discipline: 'road', hours: 6.5 },
];

function splitHM(hours: number): { h: string; m: string } {
  const total = Math.round(hours * 60);
  return { h: String(Math.floor(total / 60)), m: String(total % 60).padStart(2, '0') };
}

function hm(hours: number): string {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function EventFuelScreen({ profile }: { profile: any }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const u = useUnits();
  const altUnit = u.isMetric ? 'm' : 'ft';

  const [discipline, setDiscipline] = useState<EventDiscipline>(
    SPORT_TO_DISCIPLINE[profile?.sport ?? ''] ?? 'run'
  );
  const initial = splitHM(6);
  const [hours, setHours] = useState(initial.h);
  const [minutes, setMinutes] = useState(initial.m);
  const [hot, setHot] = useState(false);
  const [raceAltText, setRaceAltText] = useState('');
  const [homeAltText, setHomeAltText] = useState('');
  const [useMeasuredSweat, setUseMeasuredSweat] = useState(true);

  const [plan, setPlan] = useState<EventPlan | null>(null);

  // Same profile-measurement rule as RaceFuelScreen: mass, trained tolerance
  // and sweat rate are measurements, not things to re-ask for on a planner.
  const massKg = profile?.weight_lbs ? profile.weight_lbs * KG_PER_LB : 0;
  const trainedTolerance: number | null = profile?.carb_tolerance_g_per_h ?? null;
  const profileSweat: number | null = profile?.sweat_rate_l_per_h ?? null;

  const finishHours = useMemo(() => {
    const h = parseInt(hours, 10);
    const m = parseInt(minutes, 10);
    const total = (Number.isFinite(h) ? h : 0) + (Number.isFinite(m) ? m : 0) / 60;
    // The planner covers 1-24 h events; the engine clamps again on its side.
    return Math.min(Math.max(total, 0), 24);
  }, [hours, minutes]);

  /** Altitude fields are typed in the display unit and converted to metres. */
  const parseAlt = (txt: string, allowZero: boolean): number | null => {
    const n = parseFloat(txt.trim());
    if (!Number.isFinite(n) || n < 0 || (n === 0 && !allowZero)) return null;
    return u.isMetric ? n : n * M_PER_FT;
  };
  const raceAltM = parseAlt(raceAltText, false);
  const homeAltM = parseAlt(homeAltText, true);

  const canGenerate = massKg > 0 && finishHours >= 1;

  const pickDiscipline = (d: EventDiscipline) => {
    setDiscipline(d);
    setPlan(null);
  };

  const applyPreset = (p: Preset) => {
    setDiscipline(p.discipline);
    const next = splitHM(p.hours);
    setHours(next.h);
    setMinutes(next.m);
    setRaceAltText(
      p.altitudeM
        ? String(u.isMetric ? p.altitudeM : Math.round(p.altitudeM / M_PER_FT))
        : ''
    );
    setPlan(null);
  };

  const generate = () => {
    if (!canGenerate) return;
    const next = buildEventPlan({
      discipline,
      targetHours: finishHours,
      weightKg: massKg,
      trainedCarbTolerance: trainedTolerance,
      sweatRateLPerH: useMeasuredSweat ? profileSweat : null,
      hotRace: hot,
      raceAltitudeM: raceAltM,
      homeAltitudeM: homeAltM,
    });
    setPlan(next);
    track(EVENTS.EVENT_PLAN_GENERATED, {
      discipline,
      hours: next.totalHours,
      rate: next.carbRateGPerH,
      limitedByTolerance: next.limitedByTolerance,
      altitudeM: raceAltM ? Math.round(raceAltM) : 0,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  // Per-hour checkpoint rows; the final partial hour is scaled honestly.
  const hourRows = useMemo(() => {
    if (!plan || plan.totalHours <= 0) return [];
    const rows: { label: string; carbs: number; fluid: number; sodium: number }[] = [];
    const count = Math.ceil(plan.totalHours - 0.01);
    for (let i = 0; i < count; i++) {
      const dur = Math.min(1, plan.totalHours - i);
      rows.push({
        label: hm(Math.min(i + 1, plan.totalHours)),
        carbs: Math.round(plan.carbRateGPerH * dur),
        fluid: Math.round(plan.fluidLPerH * dur * 100) / 100,
        sodium: Math.round(plan.sodiumMgPerH * dur),
      });
    }
    return rows;
  }, [plan]);

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled">

      <Text style={s.blurb}>
        Hour-by-hour carbohydrate, fluid and sodium for single-discipline events,
        capped at the rate you've actually trained and adjusted for altitude.
      </Text>

      {/* ── Inputs ─────────────────────────────────────────────────────────── */}
      <Text style={s.sectionLabel}>EVENT</Text>
      <View style={s.card}>
        <Text style={s.fieldLabel}>Presets</Text>
        <View style={s.chipRow}>
          {PRESETS.map(p => (
            <TouchableOpacity
              key={p.label}
              style={s.chip}
              onPress={() => applyPreset(p)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Prefill ${p.label}`}>
              <Text style={s.chipText}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[s.fieldLabel, { marginTop: spacing.lg }]}>Discipline</Text>
        <View style={s.chipRow}>
          {EVENT_DISCIPLINES.map(d => {
            const active = discipline === d;
            return (
              <TouchableOpacity
                key={d}
                style={[s.chip, active && s.chipActive]}
                onPress={() => pickDiscipline(d)}
                activeOpacity={0.7}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={DISCIPLINE_LABEL[d]}>
                <View style={s.chipInner}>
                  <Ionicons
                    name={DISCIPLINE_ICON[d]}
                    size={14}
                    color={active ? colors.accent : colors.textSecondary}
                  />
                  <Text style={[s.chipText, active && s.chipTextActive]}>
                    {DISCIPLINE_LABEL[d]}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[s.fieldLabel, { marginTop: spacing.lg }]}>Target duration</Text>
        <View style={s.timeRow}>
          <TextInput
            style={[s.input, s.timeInput]}
            value={hours}
            onChangeText={t => { setHours(t); setPlan(null); }}
            keyboardType="number-pad"
            maxLength={2}
            accessibilityLabel="Target duration hours"
          />
          <Text style={s.timeUnit}>h</Text>
          <TextInput
            style={[s.input, s.timeInput]}
            value={minutes}
            onChangeText={t => { setMinutes(t); setPlan(null); }}
            keyboardType="number-pad"
            maxLength={2}
            accessibilityLabel="Target duration minutes"
          />
          <Text style={s.timeUnit}>min</Text>
        </View>
        <Text style={s.help}>
          1–24 hours. The total time on course is what sets the carbohydrate rate.
        </Text>

        <Text style={[s.fieldLabel, { marginTop: spacing.lg }]}>
          Race altitude ({altUnit})
        </Text>
        <TextInput
          style={s.input}
          value={raceAltText}
          onChangeText={t => { setRaceAltText(t); setPlan(null); }}
          keyboardType="number-pad"
          placeholder={u.isMetric ? 'e.g. 3100' : 'e.g. 10200'}
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel={`Race altitude in ${u.isMetric ? 'metres' : 'feet'}`}
        />
        <Text style={s.help}>
          From {u.isMetric ? '2,400 m' : '7,900 ft'} the plan raises fluid and
          switches you to eating on a schedule.
        </Text>

        <Text style={[s.fieldLabel, { marginTop: spacing.lg }]}>
          Home altitude ({altUnit}) — optional
        </Text>
        <TextInput
          style={s.input}
          value={homeAltText}
          onChangeText={t => { setHomeAltText(t); setPlan(null); }}
          keyboardType="number-pad"
          placeholder="Where you live and train"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel={`Home altitude in ${u.isMetric ? 'metres' : 'feet'}`}
        />

        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.fieldLabel}>Hot or humid</Text>
            <Text style={s.help}>Raises the sweat rate 25%.</Text>
          </View>
          <Switch
            value={hot}
            onValueChange={v => { setHot(v); setPlan(null); }}
            trackColor={{ false: colors.borderStrong, true: colors.accent }}
            thumbColor={colors.white}
            accessibilityLabel="Hot or humid conditions"
          />
        </View>

        {profileSweat != null && profileSweat > 0 && (
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>Use measured sweat rate</Text>
              <Text style={s.help}>
                {profileSweat} L/h from your profile. Off uses the population default.
              </Text>
            </View>
            <Switch
              value={useMeasuredSweat}
              onValueChange={v => { setUseMeasuredSweat(v); setPlan(null); }}
              trackColor={{ false: colors.borderStrong, true: colors.accent }}
              thumbColor={colors.white}
              accessibilityLabel="Use measured sweat rate"
            />
          </View>
        )}
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
          value={profileSweat && useMeasuredSweat ? `${profileSweat} L/h` : 'Population default'}
          missing={false} />
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
            No trained carb rate set, so this uses the guideline rate for the duration.
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
        accessibilityLabel="Generate event fuel plan"
        accessibilityState={{ disabled: !canGenerate }}>
        <Text style={s.ctaText}>{plan ? 'Recalculate' : 'Build My Fuel Plan'}</Text>
      </TouchableOpacity>

      {/* ── The plan ───────────────────────────────────────────────────────── */}
      {plan && (
        <>
          <Text style={[s.sectionLabel, { marginTop: spacing.xxl }]}>YOUR PLAN</Text>

          <View style={s.card}>
            <View style={s.heroRow}>
              <View style={s.heroItem}>
                <Text style={s.heroVal}>{plan.carbRateGPerH}</Text>
                <Text style={s.heroLabel}>g carb/h</Text>
              </View>
              <View style={s.heroDivider} />
              <View style={s.heroItem}>
                <Text style={s.heroVal}>{plan.fluidLPerH}</Text>
                <Text style={s.heroLabel}>L fluid/h</Text>
              </View>
              <View style={s.heroDivider} />
              <View style={s.heroItem}>
                <Text style={s.heroVal}>{plan.sodiumMgPerH}</Text>
                <Text style={s.heroLabel}>mg sodium/h</Text>
              </View>
              <View style={s.heroDivider} />
              <View style={s.heroItem}>
                <Text style={s.heroVal}>{plan.totalCarbG}</Text>
                <Text style={s.heroLabel}>g total</Text>
              </View>
            </View>
            <Text style={s.heroSub}>
              {DISCIPLINE_LABEL[plan.discipline]} · {hm(plan.totalHours)} ·{' '}
              {plan.totalFluidL} L fluid · {plan.totalSodiumMg} mg sodium
              {plan.altitudeFluidApplied ? ' · altitude-adjusted' : ''}
            </Text>
          </View>

          {hourRows.length > 0 && (
            <View style={s.card}>
              <View style={s.tableHead}>
                <Text style={[s.tableHeadCell, s.tableHour]}>By</Text>
                <Text style={s.tableHeadCell}>Carbs</Text>
                <Text style={s.tableHeadCell}>Fluid</Text>
                <Text style={s.tableHeadCell}>Sodium</Text>
              </View>
              {hourRows.map(r => (
                <View key={r.label} style={s.tableRow}>
                  <Text style={[s.tableCell, s.tableHour, s.tableHourText]}>{r.label}</Text>
                  <Text style={s.tableCell}>{r.carbs} g</Text>
                  <Text style={s.tableCell}>{r.fluid} L</Text>
                  <Text style={s.tableCell}>{r.sodium} mg</Text>
                </View>
              ))}
              <Text style={s.help}>
                Each row is what to take over that hour. Spread it across the hour
                rather than taking it in one go.
              </Text>
            </View>
          )}

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
    chipInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
    heroRow: { flexDirection: 'row', alignItems: 'center' },
    heroItem: { flex: 1, alignItems: 'center' },
    heroDivider: { width: 1, height: 30, backgroundColor: c.border },
    heroVal: { fontSize: 20, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    heroLabel: { fontSize: 10, fontWeight: weight.semibold, color: c.textTertiary, marginTop: 2 },
    heroSub: {
      fontSize: 12, color: c.textSecondary, fontWeight: weight.medium,
      textAlign: 'center', marginTop: spacing.md,
    },
    tableHead: {
      flexDirection: 'row', paddingBottom: spacing.sm, marginBottom: 2,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    tableHeadCell: {
      flex: 1, fontSize: 11, fontWeight: weight.heavy, color: c.textTertiary,
      textAlign: 'right', letterSpacing: 0.4,
    },
    tableRow: {
      flexDirection: 'row', paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
    },
    tableCell: { flex: 1, fontSize: 13, color: c.text, fontWeight: weight.medium, textAlign: 'right' },
    tableHour: { flex: 0.8, textAlign: 'left' },
    tableHourText: { color: c.textSecondary, fontWeight: weight.semibold },
    noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 5 },
    noteText: { flex: 1, fontSize: 13, color: c.textSecondary, lineHeight: 18 },
  });
}
