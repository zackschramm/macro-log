import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Modal, Alert, ActivityIndicator, Dimensions,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import ProgressPhotosScreen from './ProgressPhotosScreen';
import BodyMeasurementsScreen from './BodyMeasurementsScreen';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { useHealthKit, getWeeklyBurnData } from '../hooks/useHealthKit';
import { useUnits } from '../constants/units';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import InBodySection from './InBodySection';
import AdaptiveMacroCard from '../components/AdaptiveMacroCard';
import ShareCardGenerator from '../components/ShareCardGenerator';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import SkeletonBox from '../components/SkeletonBox';
import { toLocalDateString } from '../utils/dateUtils';

const { width } = Dimensions.get('window');
const CHART_WIDTH = width - 64;
const CHART_HEIGHT = 120;

const MEASUREMENTS = [
  { key: 'chest_in', label: 'Chest', unit: 'in', color: '#4F9CFF' },
  { key: 'waist_in', label: 'Waist', unit: 'in', color: '#F472B6' },
  { key: 'hips_in', label: 'Hips', unit: 'in', color: '#F5A623' },
  { key: 'arms_in', label: 'Arms', unit: 'in', color: '#C8FF3D' },
  { key: 'thighs_in', label: 'Thighs', unit: 'in', color: '#a78bfa' },
];

const todayStr = () => toLocalDateString();
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtShort = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function LineChart({ data, color, unit }: { data: { date: string; value: number }[]; color: string; unit: string }) {
  const { colors } = useTheme();

  if (data.length < 2) {
    return <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 8, textAlign: 'center', paddingVertical: 16 }}>Log more entries to see your trend</Text>;
  }

  const pts = data.slice(-10);
  const values = pts.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padH = 24;
  const padV = 16;
  const chartW = CHART_WIDTH - padH * 2;
  const chartH = CHART_HEIGHT - padV * 2;

  const toX = (i: number) => padH + (i / (pts.length - 1)) * chartW;
  const toY = (v: number) => padV + chartH - ((v - min) / range) * chartH;

  const points = pts.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  const first = values[0];
  const last = values[values.length - 1];
  const diff = last - first;
  const lowerIsBetter = ['lbs', 'kg', 'in', 'cm'].includes(unit);
  const trendColor = diff === 0
    ? colors.textTertiary
    : lowerIsBetter ? (diff < 0 ? colors.accent : colors.danger) : (diff > 0 ? colors.accent : colors.danger);

  return (
    <View style={{ marginTop: 8 }}>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
        {[0, 0.5, 1].map((t, i) => (
          <Line key={i} x1={padH} y1={padV + chartH * (1 - t)} x2={padH + chartW} y2={padV + chartH * (1 - t)}
            stroke={colors.border} strokeWidth="1" />
        ))}
        <Polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((d, i) => (
          <Circle key={i} cx={toX(i)} cy={toY(d.value)} r="3.5" fill={color} />
        ))}
        {pts.map((d, i) => (i === 0 || i === pts.length - 1) && (
          <SvgText key={i} x={toX(i)} y={CHART_HEIGHT - 2} textAnchor="middle" fill={colors.textTertiary} fontSize="9" fontWeight="600">
            {fmtShort(d.date)}
          </SvgText>
        ))}
        <SvgText x={padH} y={toY(values[0]) - 6} textAnchor="middle" fill={colors.textTertiary} fontSize="9">{values[0].toFixed(1)}</SvgText>
        <SvgText x={toX(pts.length - 1)} y={toY(last) - 6} textAnchor="middle" fill={color} fontSize="10" fontWeight="700">{last.toFixed(1)}</SvgText>
      </Svg>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <Text style={{ fontSize: 16, fontWeight: weight.heavy, color: trendColor }}>
          {diff > 0 ? '+' : ''}{diff.toFixed(1)}{unit}
        </Text>
        <Text style={{ fontSize: 12, color: colors.textTertiary, fontWeight: weight.medium }}>since first entry</Text>
      </View>
    </View>
  );
}

function MacroChart({ logs }: { logs: any[] }) {
  const { colors } = useTheme();

  if (logs.length < 2) return null;
  const pts = logs.slice(-7);
  const macroColors = { calories: colors.text, protein: colors.accent, carbs: colors.carbs, fat: colors.fat };
  const keys = ['calories', 'protein', 'carbs', 'fat'] as const;

  return (
    <View style={{ marginTop: 8 }}>
      {keys.map(key => {
        const values = pts.map((l: any) => l[key] || 0);
        const max = Math.max(...values, 1);
        return (
          <View key={key} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 11, color: colors.textTertiary, fontWeight: weight.bold, textTransform: 'uppercase' }}>{key}</Text>
              <Text style={{ fontSize: 11, color: (macroColors as any)[key], fontWeight: weight.bold }}>
                avg {Math.round(values.reduce((a: number, b: number) => a + b, 0) / values.length)}{key === 'calories' ? '' : 'g'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 3, height: 24, alignItems: 'flex-end' }}>
              {pts.map((l: any, i: number) => {
                const pct = (l[key] || 0) / max;
                return (
                  <View key={i} style={{ flex: 1, backgroundColor: colors.border, borderRadius: 3, height: '100%', justifyContent: 'flex-end' }}>
                    <View style={{ backgroundColor: (macroColors as any)[key], borderRadius: 3, height: `${Math.max(10, pct * 100)}%` as any }} />
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function BurnIntakeChart({
  burnData,
  macroLogs,
}: {
  burnData: { date: string; burned: number }[];
  macroLogs: any[];
}) {
  const { colors } = useTheme();

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return toLocalDateString(d);
  });

  const burnMap = Object.fromEntries(burnData.map((d) => [d.date, d.burned]));
  const eatMap: Record<string, number> = {};
  macroLogs.forEach((l: any) => { eatMap[l.date] = l.calories; });

  const pts = days.map((date) => ({
    date,
    burned: burnMap[date] ?? 0,
    eaten: eatMap[date] ?? 0,
  }));

  const hasBurn = pts.some((p) => p.burned > 0);
  const hasEat = pts.some((p) => p.eaten > 0);
  if (!hasBurn && !hasEat) return null;

  const allVals = pts.flatMap((p) => [p.burned, p.eaten]).filter((v) => v > 0);
  if (allVals.length === 0) return null;
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 1;

  const padH = 24;
  const padV = 16;
  const chartW = CHART_WIDTH - padH * 2;
  const chartH = CHART_HEIGHT - padV * 2;

  const toX = (i: number) => padH + (i / (pts.length - 1)) * chartW;
  const toY = (v: number) =>
    v === 0 ? padV + chartH + 2 : padV + chartH - ((v - minV) / range) * chartH;

  const burnPoints = pts.map((p, i) => `${toX(i)},${toY(p.burned)}`).join(' ');
  const eatPoints = pts.map((p, i) => `${toX(i)},${toY(p.eaten)}`).join(' ');

  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', gap: 16, marginBottom: 6 }}>
        {hasBurn && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 12, height: 3, backgroundColor: colors.warning, borderRadius: 2 }} />
            <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: weight.medium }}>Burned</Text>
          </View>
        )}
        {hasEat && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 12, height: 3, backgroundColor: colors.accent, borderRadius: 2 }} />
            <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: weight.medium }}>Eaten</Text>
          </View>
        )}
      </View>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
        {[0, 0.5, 1].map((t, i) => (
          <Line key={i} x1={padH} y1={padV + chartH * (1 - t)} x2={padH + chartW} y2={padV + chartH * (1 - t)}
            stroke={colors.border} strokeWidth="1" />
        ))}
        {hasBurn && (
          <Polyline points={burnPoints} fill="none" stroke={colors.warning} strokeWidth="2.5"
            strokeLinejoin="round" strokeLinecap="round" />
        )}
        {hasEat && (
          <Polyline points={eatPoints} fill="none" stroke={colors.accent} strokeWidth="2.5"
            strokeLinejoin="round" strokeLinecap="round" />
        )}
        {hasBurn && pts.map((p, i) => p.burned > 0 && (i === 0 || i === pts.length - 1) && (
          <Circle key={`b${i}`} cx={toX(i)} cy={toY(p.burned)} r="3.5" fill={colors.warning} />
        ))}
        {hasEat && pts.map((p, i) => p.eaten > 0 && (i === 0 || i === pts.length - 1) && (
          <Circle key={`e${i}`} cx={toX(i)} cy={toY(p.eaten)} r="3.5" fill={colors.accent} />
        ))}
        {pts.map((p, i) => (i === 0 || i === pts.length - 1) && (
          <SvgText key={i} x={toX(i)} y={CHART_HEIGHT - 2} textAnchor="middle"
            fill={colors.textTertiary} fontSize="9" fontWeight="600">
            {fmtShort(p.date)}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

interface WeeklyStats {
  avgCalories: number | null;
  avgProtein: number | null;
  workoutCount: number | null;
  avgHrv: number | null;
}

const getWeekStart = (): string => {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const d = new Date(now);
  d.setDate(now.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return toLocalDateString(d);
};

export default function ProgressScreen({ profile }: { profile: any }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { user } = useAuth();
  const health = useHealthKit();
  const u = useUnits();
  const [logs, setLogs] = useState<any[]>([]);
  const [macroLogs, setMacroLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(true);
  const [weeklyBurnData, setWeeklyBurnData] = useState<{ date: string; burned: number }[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [photosVisible, setPhotosVisible] = useState(false);
  const [measurementsVisible, setMeasurementsVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'weight' | 'measurements'>('weight');
  const [form, setForm] = useState({
    weight_lbs: '', body_fat: '',
    chest_in: '', waist_in: '', hips_in: '', arms_in: '', thighs_in: '',
    notes: '',
  });
  const shareCardRef = useRef<View>(null);
  const [showWeeklyCard, setShowWeeklyCard] = useState(false);
  const [streak, setStreak] = useState(0);

  const fetchLogs = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('progress_logs').select('*').eq('user_id', user.id).order('date');
    setLogs(data || []);

    const since = new Date();
    since.setDate(since.getDate() - 30);
    const { data: mData } = await supabase.from('macro_logs')
      .select('date, calories, protein, carbs, fat')
      .eq('user_id', user.id)
      .gte('date', toLocalDateString(since))
      .order('date');

    const byDate: Record<string, any> = {};
    (mData || []).forEach((row: any) => {
      if (!byDate[row.date]) byDate[row.date] = { date: row.date, calories: 0, protein: 0, carbs: 0, fat: 0 };
      byDate[row.date].calories += row.calories;
      byDate[row.date].protein += row.protein;
      byDate[row.date].carbs += row.carbs;
      byDate[row.date].fat += row.fat;
    });
    setMacroLogs(Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)));
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    AsyncStorage.getItem('fuelog_streak_count').then(v => { if (v) setStreak(parseInt(v, 10) || 0); });
  }, []);

  const handleShareWeek = async () => {
    if (!weeklyStats) return;
    setShowWeeklyCard(true);
    await new Promise(r => setTimeout(r, 80));
    try {
      const uri = await captureRef(shareCardRef, { format: 'jpg', quality: 0.92 });
      setShowWeeklyCard(false);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'Share Weekly Summary' });
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setShowWeeklyCard(false);
    }
  };

  useEffect(() => {
    if (health.isAvailable && !health.isAuthorized) health.requestPermissions();
  }, [health.isAvailable, health.isAuthorized, health.requestPermissions]);

  useEffect(() => {
    if (!health.isAuthorized) return;
    getWeeklyBurnData().then(setWeeklyBurnData);
  }, [health.isAuthorized]);

  useEffect(() => {
    if (!user) return;
    const fetchWeekly = async () => {
      setWeeklyLoading(true);
      const weekStart = getWeekStart();
      const today = todayStr();
      try {
        const [macroRes, workoutRes] = await Promise.all([
          supabase.from('macro_logs')
            .select('date, calories, protein')
            .eq('user_id', user.id)
            .gte('date', weekStart)
            .lte('date', today),
          supabase.from('workout_logs')
            .select('date')
            .eq('user_id', user.id)
            .eq('done', true)
            .gte('date', weekStart)
            .lte('date', today),
        ]);

        const byDate: Record<string, { calories: number; protein: number }> = {};
        (macroRes.data || []).forEach((row: any) => {
          if (!byDate[row.date]) byDate[row.date] = { calories: 0, protein: 0 };
          byDate[row.date].calories += row.calories ?? 0;
          byDate[row.date].protein += row.protein ?? 0;
        });
        const days = Object.values(byDate);
        const avgCalories = days.length ? Math.round(days.reduce((s, d) => s + d.calories, 0) / days.length) : null;
        const avgProtein = days.length ? Math.round(days.reduce((s, d) => s + d.protein, 0) / days.length) : null;

        const workoutDates = new Set((workoutRes.data || []).map((w: any) => w.date));
        const workoutCount = workoutDates.size || null;

        let avgHrv: number | null = null;
        if (health.isAuthorized) {
          try {
            const recoveryData = await Promise.race([
              health.getRecoveryData({}),
              new Promise<null>(resolve => setTimeout(() => resolve(null), 5000)),
            ]);
            const weekHrv = (recoveryData?.hrvTrend ?? []).filter(h => h.date >= weekStart);
            if (weekHrv.length > 0) {
              avgHrv = Math.round(weekHrv.reduce((sum, h) => sum + h.value, 0) / weekHrv.length);
            }
          } catch {}
        }

        setWeeklyStats({ avgCalories, avgProtein, workoutCount, avgHrv });
      } catch {}
      setWeeklyLoading(false);
    };
    fetchWeekly();
  }, [user, health.isAuthorized]);

  const handleSave = async () => {
    if (!user) return;
    if (!form.weight_lbs && !form.chest_in && !form.waist_in) {
      Alert.alert('Please enter at least weight or one measurement'); return;
    }
    setSaving(true);
    const payload: any = { user_id: user.id, date: todayStr(), notes: form.notes };
    if (form.weight_lbs) payload.weight_lbs = u.toLb(form.weight_lbs);
    if (form.body_fat) payload.body_fat = parseFloat(form.body_fat);
    MEASUREMENTS.forEach(m => { if ((form as any)[m.key]) payload[m.key] = u.toInch((form as any)[m.key]); });
    const { error: saveError } = await supabase.from('progress_logs').upsert(payload, { onConflict: 'user_id,date' });
    console.log('Progress save:', saveError?.message || 'success', JSON.stringify(payload));
    if (form.weight_lbs && health.isAuthorized) await health.saveWeight(u.toLb(form.weight_lbs));
    await fetchLogs();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setModalVisible(false);
    setSaving(false);
    setForm({ weight_lbs: '', body_fat: '', chest_in: '', waist_in: '', hips_in: '', arms_in: '', thighs_in: '', notes: '' });
  };

  const importFromHealth = async () => {
    if (!health.isAuthorized) {
      const granted = await health.requestPermissions();
      if (!granted.ok) { Alert.alert('Health Access', 'Please allow access to Apple Health in Settings.'); return; }
    }
    const weight = await health.getLatestWeight();
    if (weight) {
      setForm(f => ({ ...f, weight_lbs: String(u.dispWeight(weight)) }));
      Alert.alert('Imported!', `Latest weight from Health: ${u.fmtWeight(weight)}`);
    } else {
      Alert.alert('No Data', 'No weight data found in Apple Health.');
    }
  };

  const weightData = logs.filter(l => l.weight_lbs).map(l => ({ date: l.date, value: u.dispWeight(l.weight_lbs) }));
  const currentWeight = [...logs].reverse().find(l => l.weight_lbs)?.weight_lbs;
  const startWeight = logs.find(l => l.weight_lbs)?.weight_lbs;
  const dispCurrent = currentWeight != null ? u.dispWeight(currentWeight) : null;
  const dispStart = startWeight != null ? u.dispWeight(startWeight) : null;
  const dispChange = dispStart != null && dispCurrent != null ? Math.round((dispCurrent - dispStart) * 10) / 10 : null;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Progress</Text>
        <TouchableOpacity style={s.logBtn} onPress={() => setModalVisible(true)}>
          <Text style={s.logBtnText}>+ Log</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} scrollEnabled={false} showsVerticalScrollIndicator={false}>
          <View style={[s.card, { marginBottom: 12 }]}>
            <SkeletonBox width={70} height={11} borderRadius={4} style={{ marginBottom: 14 }} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[0, 1, 2, 3].map(i => <SkeletonBox key={i} width="23%" height={52} borderRadius={8} />)}
            </View>
          </View>
          <View style={s.card}>
            <SkeletonBox width={80} height={11} borderRadius={4} style={{ marginBottom: 16 }} />
            <SkeletonBox width="100%" height={120} borderRadius={8} />
          </View>
          <View style={[s.card, { marginTop: 12 }]}>
            <SkeletonBox width={120} height={11} borderRadius={4} style={{ marginBottom: 16 }} />
            {[75, 90, 60, 80].map((pct, i) => (
              <SkeletonBox key={i} width={`${pct}%`} height={24} borderRadius={4} style={{ marginBottom: 10 }} />
            ))}
          </View>
        </ScrollView>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* Weekly summary */}
          {weeklyLoading ? (
            <View style={[s.card, { marginBottom: 12 }]}>
              <SkeletonBox width={70} height={11} borderRadius={4} style={{ marginBottom: 14 }} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[0, 1, 2, 3].map(i => <SkeletonBox key={i} width="23%" height={52} borderRadius={8} />)}
              </View>
            </View>
          ) : (
            <View style={[s.card, { marginBottom: 12 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={s.cardTitle}>THIS WEEK</Text>
                {weeklyStats && (
                  <TouchableOpacity onPress={handleShareWeek} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} activeOpacity={0.7}>
                    <Ionicons name="share-outline" size={14} color={colors.accent} />
                    <Text style={{ fontSize: 12, color: colors.accent, fontWeight: '600' }}>Share</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={s.weeklyRow}>
                {[
                  { val: weeklyStats?.avgCalories != null ? String(weeklyStats.avgCalories) : '—', label: 'cal/day' },
                  { val: weeklyStats?.avgProtein != null ? `${weeklyStats.avgProtein}g` : '—', label: 'prot/day' },
                  { val: weeklyStats?.workoutCount != null ? String(weeklyStats.workoutCount) : '—', label: 'workouts' },
                  { val: weeklyStats?.avgHrv != null ? `${weeklyStats.avgHrv}ms` : '—', label: 'avg hrv' },
                ].map(({ val, label }) => (
                  <View key={label} style={s.weeklyCol}>
                    <Text style={s.weeklyVal}>{val}</Text>
                    <Text style={s.weeklyLabel}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Burn vs. Intake — only shown when HealthKit burn data is available */}
          {weeklyBurnData.length > 0 && (
            <View style={[s.card, { marginBottom: 12 }]}>
              <Text style={s.cardTitle}>BURN VS. INTAKE (7 DAYS)</Text>
              <BurnIntakeChart burnData={weeklyBurnData} macroLogs={macroLogs} />
            </View>
          )}

          {user && <AdaptiveMacroCard userId={user.id} profile={profile} onTargetUpdated={fetchLogs} />}

          {/* Weight card */}
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardTitle}>WEIGHT</Text>
              {dispCurrent != null && <Text style={s.cardValue}>{dispCurrent} <Text style={s.cardUnit}>{u.weightUnit}</Text></Text>}
            </View>
            {dispChange !== null && (
              <Text style={[s.changeText, { color: dispChange <= 0 ? colors.accent : colors.danger }]}>
                {dispChange > 0 ? '+' : ''}{dispChange.toFixed(1)} {u.weightUnit} since start
              </Text>
            )}
            <LineChart data={weightData} color={colors.text} unit={u.weightUnit} />
          </View>

          {/* Stats row */}
          {profile && (
            <View style={s.statsRow}>
              <View style={s.statCard}>
                <Text style={s.statVal}>{profile.weight_lbs ? u.dispWeight(profile.weight_lbs) : '—'}</Text>
                <Text style={s.statLabel}>Start</Text>
              </View>
              <View style={s.statCard}>
                <Text style={s.statVal}>{dispCurrent != null ? dispCurrent : '—'}</Text>
                <Text style={s.statLabel}>Current</Text>
              </View>
              <View style={s.statCard}>
                <Text style={[s.statVal, { color: dispChange !== null && dispChange <= 0 ? colors.accent : colors.danger }]}>
                  {dispChange !== null ? `${dispChange > 0 ? '+' : ''}${dispChange.toFixed(1)}` : '—'}
                </Text>
                <Text style={s.statLabel}>Change</Text>
              </View>
              <View style={s.statCard}>
                <Text style={s.statVal}>{logs.length}</Text>
                <Text style={s.statLabel}>Entries</Text>
              </View>
            </View>
          )}

          {/* Macro trends */}
          {macroLogs.length >= 2 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>MACRO TRENDS (30 DAYS)</Text>
              <MacroChart logs={macroLogs} />
            </View>
          )}

          {/* Measurements */}
          <Text style={s.sectionTitle}>MEASUREMENTS</Text>
          {MEASUREMENTS.map(m => {
            const mData = logs.filter(l => l[m.key]).map(l => ({ date: l.date, value: u.dispLength(l[m.key]) }));
            const latestVal = mData[mData.length - 1]?.value;
            return (
              <View key={m.key} style={s.measCard}>
                <View style={s.measHeader}>
                  <Text style={s.measLabel}>{m.label}</Text>
                  {latestVal != null && <Text style={[s.measVal, { color: m.color }]}>{latestVal} {u.lengthUnit}</Text>}
                </View>
                <LineChart data={mData} color={m.color} unit={u.lengthUnit} />
              </View>
            );
          })}

          {/* InBody body composition */}
          <InBodySection />

          {/* History */}
          <Text style={s.sectionTitle}>HISTORY</Text>
          {logs.length === 0 && <Text style={s.emptyText}>No entries yet.{'\n'}Tap "+ Log" to get started!</Text>}
          {[...logs].reverse().map((log, i) => (
            <View key={i} style={s.historyCard}>
              <Text style={s.historyDate}>{fmtDate(log.date)}</Text>
              <View style={s.historyRow}>
                {log.weight_lbs && <View style={s.historyItem}><Text style={s.historyVal}>{u.dispWeight(log.weight_lbs)}</Text><Text style={s.historyUnit}>{u.weightUnit}</Text></View>}
                {log.body_fat && <View style={s.historyItem}><Text style={s.historyVal}>{log.body_fat}</Text><Text style={s.historyUnit}>% bf</Text></View>}
                {MEASUREMENTS.map(m => log[m.key] ? (
                  <View key={m.key} style={s.historyItem}>
                    <Text style={[s.historyVal, { color: m.color }]}>{u.dispLength(log[m.key])}</Text>
                    <Text style={s.historyUnit}>{m.label.toLowerCase()}</Text>
                  </View>
                ) : null)}
              </View>
              {log.notes ? <Text style={s.historyNotes}>{log.notes}</Text> : null}
            </View>
          ))}

          {/* Progress Photos */}
          <TouchableOpacity style={s.photosCard} onPress={() => setPhotosVisible(true)} activeOpacity={0.8}>
            <View style={s.photosCardLeft}>
              <Text style={s.photosCardIcon}>📸</Text>
              <View>
                <Text style={s.photosCardTitle}>Progress Photos</Text>
                <Text style={s.photosCardSub}>Track your visual transformation</Text>
              </View>
            </View>
            <Text style={s.photosCardChevron}>›</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      <ProgressPhotosScreen visible={photosVisible} onClose={() => setPhotosVisible(false)} />

      {/* Off-screen share card — captured by captureRef, not shown in UI */}
      {showWeeklyCard && (
        <View style={{ position: 'absolute', left: -9999, top: 0 }} pointerEvents="none">
          <View ref={shareCardRef} collapsable={false}>
            <ShareCardGenerator
              type="weekly"
              data={{
                avgCalories: weeklyStats?.avgCalories ?? null,
                avgProtein: weeklyStats?.avgProtein ?? null,
                workoutCount: weeklyStats?.workoutCount ?? null,
                streak,
                weekLabel: `Week of ${new Date(getWeekStart() + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`,
              }}
            />
          </View>
        </View>
      )}

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalVisible(false)}>
        <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
          <View style={s.handle} />
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Log Progress</Text>
            <TouchableOpacity style={s.modalClose} onPress={() => setModalVisible(false)}>
              <Text style={s.modalCloseText}>×</Text>
            </TouchableOpacity>
          </View>
          <View style={s.modalTabs}>
            {(['weight', 'measurements'] as const).map(t => (
              <TouchableOpacity key={t} style={[s.modalTab, activeTab === t && s.modalTabActive]} onPress={() => setActiveTab(t)}>
                <Text style={[s.modalTabText, activeTab === t && s.modalTabTextActive]}>{t === 'weight' ? 'Weight & Body' : 'Measurements'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <ScrollView style={s.modalScroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {activeTab === 'weight' ? (
              <>
                {health.isAvailable && (
                  <TouchableOpacity style={s.healthBtn} onPress={importFromHealth}>
                    <Text style={s.healthBtnIcon}>❤️</Text>
                    <Text style={s.healthBtnText}>Import from Apple Health</Text>
                  </TouchableOpacity>
                )}
                <Text style={s.fieldLabel}>Weight ({u.weightUnit})</Text>
                <TextInput style={s.input} value={form.weight_lbs} onChangeText={v => setForm(f => ({ ...f, weight_lbs: v }))}
                  placeholder={String(profile?.weight_lbs ? u.dispWeight(profile.weight_lbs) : (u.isMetric ? 78 : 172))} placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" />
                <Text style={s.fieldLabel}>Body Fat %</Text>
                <TextInput style={s.input} value={form.body_fat} onChangeText={v => setForm(f => ({ ...f, body_fat: v }))}
                  placeholder="e.g. 15" placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" />
                <Text style={s.fieldLabel}>Notes</Text>
                <TextInput style={[s.input, { height: 80 }]} value={form.notes} onChangeText={v => setForm(f => ({ ...f, notes: v }))}
                  placeholder="How are you feeling?" placeholderTextColor={colors.textTertiary} multiline />
              </>
            ) : (
              MEASUREMENTS.map(m => (
                <View key={m.key}>
                  <Text style={[s.fieldLabel, { color: m.color }]}>{m.label} ({u.isMetric ? 'cm' : 'inches'})</Text>
                  <TextInput style={s.input} value={(form as any)[m.key]} onChangeText={v => setForm(f => ({ ...f, [m.key]: v }))}
                    placeholder="e.g. 14.5" placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" />
                </View>
              ))
            )}
            <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={saving}>
              {saving
                ? <ActivityIndicator color={colors.accentText} />
                : <Text style={s.saveBtnText}>Save Entry</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
    title: { fontSize: 28, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    logBtn: { backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
    logBtnText: { color: c.accentText, fontSize: 14, fontWeight: weight.heavy },
    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: 40 },
    card: { backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg, marginBottom: 12, borderWidth: 1, borderColor: c.border },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    cardTitle: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5 },
    cardValue: { fontSize: 28, fontWeight: weight.heavy, color: c.text },
    cardUnit: { fontSize: 14, color: c.textTertiary, fontWeight: weight.semibold },
    changeText: { fontSize: 13, fontWeight: weight.bold, marginBottom: 4 },
    statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    statCard: { flex: 1, backgroundColor: c.card, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', borderWidth: 1, borderColor: c.border },
    statVal: { fontSize: 16, fontWeight: weight.heavy, color: c.text },
    statLabel: { fontSize: 10, color: c.textTertiary, fontWeight: weight.semibold, marginTop: 4 },
    sectionTitle: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5, marginBottom: 12, marginTop: 8 },
    measCard: { backgroundColor: c.card, borderRadius: radius.card, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: c.border },
    measHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    measLabel: { fontSize: 14, fontWeight: weight.bold, color: c.text },
    measVal: { fontSize: 18, fontWeight: weight.heavy },
    historyCard: { backgroundColor: c.card, borderRadius: radius.md, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: c.border },
    historyDate: { fontSize: 12, color: c.textTertiary, fontWeight: weight.semibold, marginBottom: 8 },
    historyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    historyItem: { alignItems: 'center' },
    historyVal: { fontSize: 16, fontWeight: weight.heavy, color: c.text },
    historyUnit: { fontSize: 10, color: c.textTertiary, fontWeight: weight.semibold },
    historyNotes: { fontSize: 12, color: c.textTertiary, marginTop: 8, fontStyle: 'italic' },
    emptyText: { textAlign: 'center', color: c.textTertiary, fontSize: 14, paddingVertical: 32, lineHeight: 24, fontWeight: weight.medium },
    weeklyRow: { flexDirection: 'row', marginTop: 8 },
    weeklyCol: { flex: 1, alignItems: 'center', paddingVertical: 4 },
    weeklyVal: { fontSize: 20, fontWeight: weight.heavy, color: c.accent },
    weeklyLabel: { fontSize: 10, color: c.textSecondary, fontWeight: weight.semibold, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
    modalSafe: { flex: 1, backgroundColor: c.bgSecondary },
    handle: { width: 36, height: 4, backgroundColor: c.borderStrong, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, marginBottom: 16 },
    modalTitle: { fontSize: 22, fontWeight: weight.heavy, color: c.text },
    modalClose: { backgroundColor: c.cardAlt, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    modalCloseText: { color: c.textSecondary, fontSize: 20, lineHeight: 22 },
    modalTabs: { flexDirection: 'row', marginHorizontal: spacing.xl, backgroundColor: c.cardAlt, borderRadius: radius.md, padding: 4, marginBottom: 20 },
    modalTab: { flex: 1, padding: 10, borderRadius: radius.sm, alignItems: 'center' },
    modalTabActive: { backgroundColor: c.accent },
    modalTabText: { fontSize: 13, fontWeight: weight.bold, color: c.textTertiary },
    modalTabTextActive: { color: c.accentText },
    modalScroll: { flex: 1, paddingHorizontal: spacing.xl },
    fieldLabel: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    input: { backgroundColor: c.card, borderRadius: radius.md, color: c.text, padding: 14, fontSize: 15, marginBottom: 16, borderWidth: 1, borderColor: c.border },
    saveBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 16, alignItems: 'center', marginTop: 8 },
    saveBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.heavy },
    healthBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(244,114,182,0.08)', borderRadius: radius.md, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(244,114,182,0.2)' },
    healthBtnIcon: { fontSize: 18 },
    healthBtnText: { color: c.fat, fontSize: 14, fontWeight: weight.bold },
    photosCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg, marginTop: 8, borderWidth: 1, borderColor: c.border },
    photosCardLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    photosCardIcon: { fontSize: 24 },
    photosCardTitle: { fontSize: 15, fontWeight: weight.heavy, color: c.text },
    photosCardSub: { fontSize: 12, color: c.textTertiary, marginTop: 2, fontWeight: weight.medium },
    photosCardChevron: { fontSize: 22, color: c.textTertiary, fontWeight: weight.regular },
  });
}
