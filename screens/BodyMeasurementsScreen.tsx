import React, { useState, useEffect, useCallback } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Modal, Alert, ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { useUnits } from '../constants/units';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { toLocalDateString } from '../utils/dateUtils';
import { analyzeWeightTrend, detectMilestones, Milestone, type WeighIn } from '../utils/weightTrend';
import { getWeightHistory, toWeighIns } from '../utils/weightHistory';
import { logError } from '../utils/logError';
import { getUnseenMilestones, celebrateAndMaybeAskForReview } from '../utils/milestones';
import { syncWeightToProfile, describeTargetChange } from '../utils/syncWeightToProfile';
import WeightTrendCard from '../components/WeightTrendCard';
import { track, trackOnce, EVENTS } from '../utils/analytics';

const { width } = Dimensions.get('window');
const CHART_W = width - 64;
const CHART_H = 110;

const MEAS_STORAGE_KEY = 'fuelog_body_measurements';

const todayStr = () => toLocalDateString();
const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtShort = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

type BodyMeasurement = {
  id?: number;
  date: string;
  weight_lb: number | null;
  waist_in: number | null;
  chest_in: number | null;
  hips_in: number | null;
  left_arm_in: number | null;
  right_arm_in: number | null;
  left_thigh_in: number | null;
  right_thigh_in: number | null;
  neck_in: number | null;
  body_fat_pct: number | null;
  notes: string | null;
  source: string;
};

type InBodyEntry = {
  date: string;
  body_fat_pct: number | null;
  weight_lb: number | null;
  muscle_mass_lb: number | null;
};

type TimelineEntry =
  | { date: string; type: 'manual'; manual: BodyMeasurement }
  | { date: string; type: 'inbody'; inbody: InBodyEntry };

type ChartPoint = { date: string; value: number };

function SparklineChart({ data, color, unit }: { data: ChartPoint[]; color: string; unit: string }) {
  const { colors } = useTheme();

  if (data.length < 2) {
    return (
      <Text style={{ color: colors.textTertiary, fontSize: 12, textAlign: 'center', paddingVertical: 12 }}>
        Log more entries to see your trend
      </Text>
    );
  }

  const pts = data.slice(-10);
  const values = pts.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padH = 24;
  const padV = 14;
  const chartW = CHART_W - padH * 2;
  const chartH = CHART_H - padV * 2;

  const toX = (i: number) => padH + (i / (pts.length - 1)) * chartW;
  const toY = (v: number) => padV + chartH - ((v - min) / range) * chartH;

  const points = pts.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  const first = values[0];
  const last = values[values.length - 1];
  const diff = last - first;
  const lowerIsBetter = ['lbs', 'kg', 'in', 'cm', '%'].includes(unit);
  const trendColor =
    diff === 0
      ? colors.textTertiary
      : lowerIsBetter
      ? diff < 0 ? colors.accent : colors.danger
      : diff > 0 ? colors.accent : colors.danger;

  return (
    <View style={{ marginTop: 6 }}>
      <Svg width={CHART_W} height={CHART_H}>
        {[0, 0.5, 1].map((t, i) => (
          <Line
            key={i}
            x1={padH} y1={padV + chartH * (1 - t)}
            x2={padH + chartW} y2={padV + chartH * (1 - t)}
            stroke={colors.border} strokeWidth="1"
          />
        ))}
        <Polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((d, i) => (
          <Circle key={i} cx={toX(i)} cy={toY(d.value)} r="3.5" fill={color} />
        ))}
        {pts.map((d, i) => (i === 0 || i === pts.length - 1) && (
          <SvgText key={i} x={toX(i)} y={CHART_H - 2} textAnchor="middle" fill={colors.textTertiary} fontSize="9" fontWeight="600">
            {fmtShort(d.date)}
          </SvgText>
        ))}
        <SvgText x={padH} y={toY(values[0]) - 6} textAnchor="middle" fill={colors.textTertiary} fontSize="9">
          {values[0].toFixed(1)}
        </SvgText>
        <SvgText x={toX(pts.length - 1)} y={toY(last) - 6} textAnchor="middle" fill={color} fontSize="10" fontWeight="700">
          {last.toFixed(1)}
        </SvgText>
      </Svg>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: weight.heavy, color: trendColor }}>
          {diff > 0 ? '+' : ''}{diff.toFixed(1)}{unit}
        </Text>
        <Text style={{ fontSize: 12, color: colors.textTertiary, fontWeight: weight.medium }}>since first entry</Text>
      </View>
    </View>
  );
}

export default function BodyMeasurementsScreen({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { user } = useAuth();
  const u = useUnits();

  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([]);
  const [inbodyEntries, setInbodyEntries] = useState<InBodyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [logVisible, setLogVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingMilestone, setPendingMilestone] = useState<Milestone | null>(null);
  const [weightJustLogged, setWeightJustLogged] = useState(false);
  /** Weight merged across progress_logs + body_measurements + inbody_logs. */
  const [mergedWeighIns, setMergedWeighIns] = useState<WeighIn[]>([]);

  const [form, setForm] = useState({
    date: todayStr(),
    weight: '',
    waist: '',
    chest: '',
    hips: '',
    leftArm: '',
    rightArm: '',
    leftThigh: '',
    rightThigh: '',
    neck: '',
    bodyFat: '',
    notes: '',
  });

  const resetForm = () =>
    setForm({ date: todayStr(), weight: '', waist: '', chest: '', hips: '', leftArm: '', rightArm: '', leftThigh: '', rightThigh: '', neck: '', bodyFat: '', notes: '' });

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Try Supabase first, fall back to AsyncStorage
      let measData: BodyMeasurement[] = [];
      try {
        const { data, error } = await supabase
          .from('body_measurements')
          .select('*')
          .eq('user_id', user.id)
          .order('date', { ascending: false });
        if (error) throw error;
        measData = (data || []) as BodyMeasurement[];
      } catch {
        const raw = await AsyncStorage.getItem(MEAS_STORAGE_KEY);
        measData = raw ? JSON.parse(raw) : [];
      }
      setMeasurements(measData);

      // Pull InBody scans for timeline + body fat trend
      const { data: ibData } = await supabase
        .from('inbody_logs')
        .select('measured_at, body_fat_pct, skeletal_muscle_mass_lb, weight_lb')
        .eq('user_id', user.id)
        .order('measured_at', { ascending: false });

      setInbodyEntries(
        (ibData || []).map((r: any) => ({
          date: r.measured_at ? toLocalDateString(new Date(r.measured_at)) : '',
          body_fat_pct: r.body_fat_pct ?? null,
          weight_lb: r.weight_lb ?? null,
          muscle_mass_lb: r.skeletal_muscle_mass_lb ?? null,
        }))
      );

      // Weight also lives in progress_logs (written by the Stats tab). Without
      // this, a weigh-in logged there was invisible to the trend, the milestones
      // and the target sync. See utils/weightHistory.ts.
      try {
        setMergedWeighIns(toWeighIns(await getWeightHistory(user.id)));
      } catch (e) {
        logError('BodyMeasurements.weightHistory', e);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (visible) loadData();
  }, [visible, loadData]);

  const handleSave = async () => {
    if (!user) return;
    const hasData =
      form.weight || form.waist || form.chest || form.hips ||
      form.leftArm || form.rightArm || form.leftThigh || form.rightThigh ||
      form.neck || form.bodyFat;
    if (!hasData) {
      Alert.alert('No Data', 'Please enter at least one measurement.');
      return;
    }
    setSaving(true);

    const toIn = (v: string) => (v ? u.toInch(v) : null);
    const toLb = (v: string) => (v ? u.toLb(v) : null);

    const entry: BodyMeasurement = {
      date: form.date || todayStr(),
      weight_lb: toLb(form.weight),
      waist_in: toIn(form.waist),
      chest_in: toIn(form.chest),
      hips_in: toIn(form.hips),
      left_arm_in: toIn(form.leftArm),
      right_arm_in: toIn(form.rightArm),
      left_thigh_in: toIn(form.leftThigh),
      right_thigh_in: toIn(form.rightThigh),
      neck_in: toIn(form.neck),
      body_fat_pct: form.bodyFat ? parseFloat(form.bodyFat) : null,
      notes: form.notes || null,
      source: 'manual',
    };

    try {
      const { error } = await supabase
        .from('body_measurements')
        .upsert({ ...entry, user_id: user.id }, { onConflict: 'user_id,date' });
      if (error) throw error;
    } catch {
      const updated = [entry, ...measurements.filter(m => m.date !== entry.date)]
        .sort((a, b) => b.date.localeCompare(a.date));
      await AsyncStorage.setItem(MEAS_STORAGE_KEY, JSON.stringify(updated));
    }

    setLogVisible(false);
    setSaving(false);
    resetForm();
    await loadData();

    // Weight changed → BMR changed → targets should follow. Without this the
    // profile stays pinned to the onboarding weight forever.
    if (entry.weight_lb != null) {
      // trackOnce: activation signal, only meaningful the first time.
      trackOnce(EVENTS.FIRST_WEIGH_IN);
      setWeightJustLogged(true);
    }
  };

  const deleteEntry = (date: string) => {
    Alert.alert('Delete Entry', 'Delete this measurement?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase
              .from('body_measurements')
              .delete()
              .eq('user_id', user!.id)
              .eq('date', date);
            if (error) throw error;
          } catch {
            const updated = measurements.filter(m => m.date !== date);
            await AsyncStorage.setItem(MEAS_STORAGE_KEY, JSON.stringify(updated));
          }
          await loadData();
        },
      },
    ]);
  };

  // Build merged timeline (manual + InBody-only entries)
  const manualDates = new Set(measurements.map(m => m.date));
  const inbodyOnly = inbodyEntries.filter(ib => ib.date && !manualDates.has(ib.date));
  const timeline: TimelineEntry[] = [
    ...measurements.map(m => ({ date: m.date, type: 'manual' as const, manual: m })),
    ...inbodyOnly.map(ib => ({ date: ib.date, type: 'inbody' as const, inbody: ib })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  // Trend data (chronological for charts)
  const weightData: ChartPoint[] = measurements
    .filter(m => m.weight_lb != null)
    .map(m => ({ date: m.date, value: u.dispWeight(m.weight_lb!) }))
    .reverse();

  // Smoothed weight trend. Merges manual weigh-ins with InBody weights so a
  // user who only ever scans still gets a trend. Computed in display units so
  // the card's numbers match everything else on screen.
  // Raw weigh-ins in canonical POUNDS, merged manual + InBody so a user who
  // only ever scans still gets a trend.
  const weighInsLb = React.useMemo(() => {
    // Prefer the merged history (covers progress_logs too). Fall back to the
    // locally-loaded rows if that query failed, so the trend degrades rather
    // than disappearing.
    if (mergedWeighIns.length) return mergedWeighIns;

    const manualDatesW = new Set(
      measurements.filter(m => m.weight_lb != null).map(m => m.date)
    );
    return [
      ...measurements
        .filter(m => m.weight_lb != null)
        .map(m => ({ date: m.date, weight: m.weight_lb! })),
      ...inbodyEntries
        .filter(ib => ib.weight_lb != null && ib.date && !manualDatesW.has(ib.date))
        .map(ib => ({ date: ib.date, weight: ib.weight_lb! })),
    ];
  }, [mergedWeighIns, measurements, inbodyEntries]);

  /** Canonical lb trend — this is what gets written to profiles.weight_lbs. */
  const weightTrendLb = React.useMemo(
    () => analyzeWeightTrend(weighInsLb),
    [weighInsLb]
  );

  /**
   * Display-unit trend for the card. Computed separately rather than converting
   * the lb trend, so a metric user's chart and numbers are in kg while the
   * profile write above stays in pounds — mixing those up would store kg in a
   * lbs column.
   */
  const weightTrend = React.useMemo(
    () => analyzeWeightTrend(weighInsLb.map(w => ({ ...w, weight: u.dispWeight(w.weight) }))),
    [weighInsLb, u.isMetric]
  );

  const waistData: ChartPoint[] = measurements
    .filter(m => m.waist_in != null)
    .map(m => ({ date: m.date, value: u.dispLength(m.waist_in!) }))
    .reverse();

  const bodyFatData: ChartPoint[] = [
    ...measurements.filter(m => m.body_fat_pct != null).map(m => ({ date: m.date, value: m.body_fat_pct! })),
    ...inbodyEntries.filter(ib => ib.body_fat_pct != null && ib.date).map(ib => ({ date: ib.date, value: ib.body_fat_pct! })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  // Recompute targets from the new trend weight after a weigh-in, and tell the
  // user why their numbers moved. Runs after loadData so the trend already
  // includes the entry just saved.
  React.useEffect(() => {
    if (!weightJustLogged || !user || !weightTrendLb.hasEnoughData) {
      if (weightJustLogged) setWeightJustLogged(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const latestBf = [...measurements]
        .filter(m => m.body_fat_pct != null)
        .sort((a, b) => b.date.localeCompare(a.date))[0]?.body_fat_pct ?? null;

      // weightTrendLb (not weightTrend) — profiles.weight_lbs is pounds.
      const result = await syncWeightToProfile(user.id, weightTrendLb, { bodyFatPct: latestBf });
      if (cancelled) return;
      setWeightJustLogged(false);
      if (!result.updated) return;

      // Report the change in the user's own units.
      const msg = describeTargetChange({
        ...result,
        previousWeight: result.previousWeight === null ? null : u.dispWeight(result.previousWeight),
        newWeight: result.newWeight === null ? null : u.dispWeight(result.newWeight),
      }, u.weightUnit);
      if (msg) Alert.alert('Targets updated', msg);
    })();
    return () => { cancelled = true; };
  }, [weightJustLogged, user, weightTrendLb, measurements, u.weightUnit]);

  // Surface a newly-earned milestone once the trend is on screen. The review
  // prompt fires only after the user dismisses it — asking mid-celebration
  // hijacks the moment, asking just after it rides the good feeling.
  React.useEffect(() => {
    if (!visible || !weightTrend.hasEnoughData) return;
    let cancelled = false;
    (async () => {
      // No goal-weight field exists yet, so goal_reached can't fire — the
      // change and consistency milestones carry this for now.
      const unseen = await getUnseenMilestones(
        detectMilestones(weightTrend, { unit: u.weightUnit })
      );
      if (cancelled || unseen.length === 0) return;
      // Show the most significant one; the rest stay unseen for next time.
      const m = unseen[unseen.length - 1];
      track(EVENTS.WEIGHT_MILESTONE_SHOWN, { kind: m.kind, key: m.key });
      setPendingMilestone(m);
    })();
    return () => { cancelled = true; };
  }, [visible, weightTrend, u.weightUnit]);

  const dismissMilestone = async () => {
    const m = pendingMilestone;
    setPendingMilestone(null);
    if (m) await celebrateAndMaybeAskForReview(m);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={s.doneBtn}>Done</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>Body Measurements</Text>
          <TouchableOpacity style={s.logBtn} onPress={() => { resetForm(); setLogVisible(true); }}>
            <Text style={s.logBtnText}>+ Log</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

            {/* Trend charts */}
            {weightData.length >= 2 && (
              <WeightTrendCard trend={weightTrend} unit={u.weightUnit} />
            )}
            {waistData.length >= 2 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>WAIST TREND</Text>
                <SparklineChart data={waistData} color="#F472B6" unit={u.lengthUnit} />
              </View>
            )}
            {bodyFatData.length >= 2 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>BODY FAT % TREND</Text>
                <SparklineChart data={bodyFatData} color="#F5A623" unit="%" />
              </View>
            )}

            {/* Timeline */}
            <Text style={s.sectionTitle}>HISTORY</Text>
            {timeline.length === 0 && (
              <Text style={s.emptyText}>No entries yet.{'\n'}Tap "+ Log" to get started!</Text>
            )}
            {timeline.map((entry, i) => (
              <TouchableOpacity
                key={i}
                style={s.timelineCard}
                activeOpacity={entry.type === 'manual' ? 0.7 : 1}
                onPress={() => {
                  if (entry.type !== 'manual') return;
                  Alert.alert(fmtDate(entry.date), undefined, [
                    { text: 'Delete', style: 'destructive', onPress: () => deleteEntry(entry.date) },
                    { text: 'Cancel', style: 'cancel' },
                  ]);
                }}
              >
                <View style={s.timelineRow}>
                  <Text style={s.timelineDate}>{fmtDate(entry.date)}</Text>
                  {entry.type === 'inbody' && (
                    <View style={s.inbodyBadge}>
                      <Text style={s.inbodyBadgeText}>InBody</Text>
                    </View>
                  )}
                </View>
                <View style={s.metricGrid}>
                  {entry.type === 'manual' && (() => {
                    const m = entry.manual;
                    const items: { val: string; label: string }[] = [];
                    if (m.weight_lb != null) items.push({ val: `${u.dispWeight(m.weight_lb)}`, label: u.weightUnit });
                    if (m.body_fat_pct != null) items.push({ val: `${m.body_fat_pct.toFixed(1)}%`, label: 'bf' });
                    if (m.waist_in != null) items.push({ val: `${u.dispLength(m.waist_in)}`, label: 'waist' });
                    if (m.chest_in != null) items.push({ val: `${u.dispLength(m.chest_in)}`, label: 'chest' });
                    if (m.hips_in != null) items.push({ val: `${u.dispLength(m.hips_in)}`, label: 'hips' });
                    if (m.left_arm_in != null) items.push({ val: `${u.dispLength(m.left_arm_in)}`, label: 'L arm' });
                    if (m.right_arm_in != null) items.push({ val: `${u.dispLength(m.right_arm_in)}`, label: 'R arm' });
                    if (m.left_thigh_in != null) items.push({ val: `${u.dispLength(m.left_thigh_in)}`, label: 'L thigh' });
                    if (m.right_thigh_in != null) items.push({ val: `${u.dispLength(m.right_thigh_in)}`, label: 'R thigh' });
                    if (m.neck_in != null) items.push({ val: `${u.dispLength(m.neck_in)}`, label: 'neck' });
                    return items.map((it, j) => (
                      <View key={j} style={s.metricItem}>
                        <Text style={s.metricVal}>{it.val}</Text>
                        <Text style={s.metricLabel}>{it.label}</Text>
                      </View>
                    ));
                  })()}
                  {entry.type === 'inbody' && (() => {
                    const ib = entry.inbody;
                    const items: { val: string; label: string }[] = [];
                    if (ib.weight_lb != null) items.push({ val: `${u.dispWeight(ib.weight_lb)}`, label: u.weightUnit });
                    if (ib.body_fat_pct != null) items.push({ val: `${ib.body_fat_pct.toFixed(1)}%`, label: 'bf' });
                    if (ib.muscle_mass_lb != null) items.push({ val: `${u.dispWeight(ib.muscle_mass_lb)}`, label: 'muscle' });
                    return items.map((it, j) => (
                      <View key={j} style={s.metricItem}>
                        <Text style={s.metricVal}>{it.val}</Text>
                        <Text style={s.metricLabel}>{it.label}</Text>
                      </View>
                    ));
                  })()}
                </View>
                {entry.type === 'manual' && entry.manual.notes ? (
                  <Text style={s.timelineNotes}>{entry.manual.notes}</Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Log form modal */}
        <Modal visible={logVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLogVisible(false)}>
          <SafeAreaView style={s.formSafe} edges={['top', 'bottom']}>
            <View style={s.formHeader}>
              <TouchableOpacity onPress={() => setLogVisible(false)}>
                <Text style={s.formCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={s.formTitle}>Log Measurements</Text>
              <View style={{ width: 60 }} />
            </View>
            <ScrollView
              style={s.formScroll}
              contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={s.fieldLabel}>Date</Text>
              <TextInput
                style={s.input}
                value={form.date}
                onChangeText={v =>setForm(f => ({ ...f, date: v }))}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textTertiary}
              />

              <Text style={s.fieldLabel}>Weight ({u.weightUnit})</Text>
              <TextInput style={s.input} value={form.weight} onChangeText={v =>setForm(f => ({ ...f, weight: v }))} keyboardType="decimal-pad" placeholder={u.isMetric ? 'e.g. 79' : 'e.g. 175'} placeholderTextColor={colors.textTertiary} />

              <Text style={s.fieldLabel}>Body Fat %</Text>
              <TextInput style={s.input} value={form.bodyFat} onChangeText={v =>setForm(f => ({ ...f, bodyFat: v }))} keyboardType="decimal-pad" placeholder="e.g. 15" placeholderTextColor={colors.textTertiary} />

              <Text style={s.fieldLabel}>Waist ({u.lengthUnit})</Text>
              <TextInput style={s.input} value={form.waist} onChangeText={v =>setForm(f => ({ ...f, waist: v }))} keyboardType="decimal-pad" placeholder={u.isMetric ? 'e.g. 81' : 'e.g. 32'} placeholderTextColor={colors.textTertiary} />

              <Text style={s.fieldLabel}>Chest ({u.lengthUnit})</Text>
              <TextInput style={s.input} value={form.chest} onChangeText={v =>setForm(f => ({ ...f, chest: v }))} keyboardType="decimal-pad" placeholder={u.isMetric ? 'e.g. 101' : 'e.g. 40'} placeholderTextColor={colors.textTertiary} />

              <Text style={s.fieldLabel}>Hips ({u.lengthUnit})</Text>
              <TextInput style={s.input} value={form.hips} onChangeText={v =>setForm(f => ({ ...f, hips: v }))} keyboardType="decimal-pad" placeholder={u.isMetric ? 'e.g. 96' : 'e.g. 38'} placeholderTextColor={colors.textTertiary} />

              <View style={s.twoCol}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Left Arm ({u.lengthUnit})</Text>
                  <TextInput style={s.input} value={form.leftArm} onChangeText={v =>setForm(f => ({ ...f, leftArm: v }))} keyboardType="decimal-pad" placeholder={u.isMetric ? '35' : '14'} placeholderTextColor={colors.textTertiary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Right Arm ({u.lengthUnit})</Text>
                  <TextInput style={s.input} value={form.rightArm} onChangeText={v =>setForm(f => ({ ...f, rightArm: v }))} keyboardType="decimal-pad" placeholder={u.isMetric ? '35' : '14'} placeholderTextColor={colors.textTertiary} />
                </View>
              </View>

              <View style={s.twoCol}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Left Thigh ({u.lengthUnit})</Text>
                  <TextInput style={s.input} value={form.leftThigh} onChangeText={v =>setForm(f => ({ ...f, leftThigh: v }))} keyboardType="decimal-pad" placeholder={u.isMetric ? '55' : '22'} placeholderTextColor={colors.textTertiary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Right Thigh ({u.lengthUnit})</Text>
                  <TextInput style={s.input} value={form.rightThigh} onChangeText={v =>setForm(f => ({ ...f, rightThigh: v }))} keyboardType="decimal-pad" placeholder={u.isMetric ? '55' : '22'} placeholderTextColor={colors.textTertiary} />
                </View>
              </View>

              <Text style={s.fieldLabel}>Neck ({u.lengthUnit})</Text>
              <TextInput style={s.input} value={form.neck} onChangeText={v =>setForm(f => ({ ...f, neck: v }))} keyboardType="decimal-pad" placeholder={u.isMetric ? '38' : '15'} placeholderTextColor={colors.textTertiary} />

              <Text style={s.fieldLabel}>Notes</Text>
              <TextInput
                style={[s.input, { height: 80 }]}
                value={form.notes}
                onChangeText={v =>setForm(f => ({ ...f, notes: v }))}
                multiline
                placeholder="Optional notes..."
                placeholderTextColor={colors.textTertiary}
              />

              <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={saving}>
                {saving
                  ? <ActivityIndicator color={colors.accentText} />
                  : <Text style={s.saveBtnText}>Save Entry</Text>}
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </Modal>

        {/* Milestone celebration */}
        <Modal
          visible={!!pendingMilestone}
          transparent
          animationType="fade"
          onRequestClose={dismissMilestone}
        >
          <View style={s.celebrateBackdrop}>
            <View style={s.celebrateCard}>
              <Ionicons name="trophy" size={34} color={colors.textTertiary} />
              <Text style={s.celebrateTitle}>{pendingMilestone?.title}</Text>
              <Text style={s.celebrateBody}>{pendingMilestone?.detail}</Text>
              <TouchableOpacity style={s.celebrateBtn} onPress={dismissMilestone} activeOpacity={0.8}>
                <Text style={s.celebrateBtnText}>Nice</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    doneBtn: { color: c.textSecondary, fontSize: 16, fontWeight: weight.medium, width: 60 },
    headerTitle: { fontSize: 17, fontWeight: weight.heavy, color: c.text },
    logBtn: { backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
    logBtnText: { color: c.accentText, fontSize: 14, fontWeight: weight.heavy },
    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: 40 },
    card: { backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg, marginBottom: 12, borderWidth: 1, borderColor: c.border },
    cardTitle: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5, marginBottom: 2 },
    sectionTitle: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5, marginBottom: 10, marginTop: 8 },
    emptyText: { textAlign: 'center', color: c.textTertiary, fontSize: 14, paddingVertical: 32, lineHeight: 24, fontWeight: weight.medium },
    timelineCard: { backgroundColor: c.card, borderRadius: radius.card, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: c.border },
    timelineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    timelineDate: { fontSize: 12, color: c.textTertiary, fontWeight: weight.semibold },
    inbodyBadge: { backgroundColor: c.info + '22', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: c.info + '44' },
    inbodyBadgeText: { color: c.info, fontSize: 10, fontWeight: weight.bold },
    metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    metricItem: { alignItems: 'center', minWidth: 44 },
    metricVal: { fontSize: 16, fontWeight: weight.heavy, color: c.text },
    metricLabel: { fontSize: 10, color: c.textTertiary, fontWeight: weight.semibold, marginTop: 2 },
    timelineNotes: { fontSize: 12, color: c.textTertiary, marginTop: 8, fontStyle: 'italic' },
    // Milestone celebration
    celebrateBackdrop: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
      alignItems: 'center', justifyContent: 'center', padding: spacing.xl,
    },
    celebrateCard: {
      width: '100%', backgroundColor: c.card, borderRadius: radius.card,
      padding: spacing.xl, alignItems: 'center',
      borderWidth: 1, borderColor: c.accent + '55',
    },
    celebrateEmoji: { fontSize: 40, marginBottom: spacing.sm },
    celebrateTitle: {
      fontSize: 20, fontWeight: weight.heavy, color: c.text,
      textAlign: 'center', marginBottom: spacing.sm,
    },
    celebrateBody: {
      fontSize: 13, lineHeight: 19, color: c.textSecondary,
      textAlign: 'center', marginBottom: spacing.lg,
    },
    celebrateBtn: {
      backgroundColor: c.accent, borderRadius: radius.pill,
      paddingVertical: 12, paddingHorizontal: 44,
    },
    celebrateBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.bold },
    // Form modal
    formSafe: { flex: 1, backgroundColor: c.bgSecondary },
    formHeader: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    formCancel: { color: c.textSecondary, fontSize: 16, fontWeight: weight.medium, width: 60 },
    formTitle: { fontSize: 17, fontWeight: weight.heavy, color: c.text },
    formScroll: { flex: 1 },
    fieldLabel: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16 },
    input: { backgroundColor: c.card, borderRadius: radius.md, color: c.text, padding: 14, fontSize: 15, borderWidth: 1, borderColor: c.border },
    twoCol: { flexDirection: 'row', gap: 10 },
    saveBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 16, alignItems: 'center', marginTop: 24 },
    saveBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.heavy },
  });
}
