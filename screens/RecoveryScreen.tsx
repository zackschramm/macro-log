import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Dimensions, Platform, Modal, Switch,
  TouchableWithoutFeedback, AppState, AppStateStatus,
} from 'react-native';
import BreathworkScreen from './BreathworkScreen';
import GlucoseScreen from './GlucoseScreen';
import CycleTrackingScreen from './CycleTrackingScreen';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Polyline, Line, Text as SvgText } from 'react-native-svg';
import { useHealthKit, RecoveryData, WeeklyTrainingLoad, STORAGE_PREFERRED_TRACKER, STORAGE_HK_SOURCES, STORAGE_LAST_SYNC, buildSourcePrefs } from '../hooks/useHealthKit';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { supabase } from '../constants/supabase';
import { toLocalDateString } from '../utils/dateUtils';
import {
  getConnectedWearables, getWhoopData, getWhoopTrends, getOuraData, getGarminData,
  type Provider, type WhoopData, type WhoopTrends, type OuraData, type GarminData,
} from '../utils/wearables';

const { width } = Dimensions.get('window');
const CHART_W = (width - 64) / 2 - 8;
const CHART_H = 60;

const STORAGE_SOURCE_PREFS = 'recovery_source_prefs';
const STORAGE_VISIBLE_METRICS = 'recovery_visible_metrics';

const SUPABASE_URL = 'https://zbcxuffgmjuqarapfdwb.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQ4NjIsImV4cCI6MjA4NzQwMDg2Mn0.lUng1tY_aAuee_t8-E5MSUHdm2PF3HzsE41L-kzBmJE';

async function callCgmProxy(session: { access_token: string } | null | undefined, body: object) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/cgm-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

function computeCyclePhase(lastPeriodStart: string, cycleLength: number, periodLength: number) {
  const start = new Date(lastPeriodStart + 'T12:00:00');
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const daysDiff = Math.floor((today.getTime() - start.getTime()) / 86400000);
  const cycleDay = (daysDiff % cycleLength) + 1;
  const daysUntilPeriod = cycleLength - cycleDay + 1;
  let name: string, emoji: string;
  if (cycleDay <= periodLength) { name = 'Menstrual'; emoji = '🔴'; }
  else if (cycleDay <= 13) { name = 'Follicular'; emoji = '🌱'; }
  else if (cycleDay <= 16) { name = 'Ovulation'; emoji = '⚡'; }
  else { name = 'Luteal'; emoji = '🌙'; }
  return { name, emoji, day: cycleDay, totalDays: cycleLength, daysUntilPeriod };
}

function trendArrowEmoji(trend: string): string {
  switch (trend) {
    case 'DOUBLE_UP': return '⬆⬆';
    case 'SINGLE_UP': return '⬆';
    case 'FORTY_FIVE_UP': return '↗';
    case 'FLAT': return '→';
    case 'FORTY_FIVE_DOWN': return '↘';
    case 'SINGLE_DOWN': return '⬇';
    case 'DOUBLE_DOWN': return '⬇⬇';
    default: return '—';
  }
}

function cycleInsight(phase: string): string {
  switch (phase) {
    case 'Menstrual': return 'Rest or light movement today. Focus on iron-rich foods.';
    case 'Follicular': return 'Energy rising — good time for strength and high-intensity work.';
    case 'Ovulation': return 'Peak power and strength. Ideal for PRs and max efforts.';
    case 'Luteal': return 'Taper intensity, add complex carbs, manage stress.';
    default: return '';
  }
}

const ALL_METRICS = [
  { key: 'hrv', label: 'HRV' },
  { key: 'rhr', label: 'Resting HR' },
  { key: 'sleep', label: 'Sleep' },
  { key: 'steps', label: 'Steps' },
  { key: 'activeCal', label: 'Active Calories' },
  { key: 'bloodO2', label: 'Blood O₂' },
  { key: 'respRate', label: 'Respiratory Rate' },
  { key: 'vo2', label: 'VO₂ Max' },
] as const;

const DEFAULT_VISIBLE = ALL_METRICS.map(m => m.key);

// Used when HealthKit was never authorized (Whoop-only users) so metrics that
// have no Whoop equivalent (steps, active cal, blood O2, VO2 max) render as
// "No data" instead of the screen requiring HealthKit to load at all.
const EMPTY_RECOVERY_DATA: RecoveryData = {
  hrv: null, restingHR: null, sleepHours: null, sleepDeepHours: null,
  sleepRemHours: null, steps: null, activeCalories: null, basalCalories: null,
  bloodOxygen: null, respiratoryRate: null, vo2Max: null,
  hrvTrend: [], rhrTrend: [], sleepTrend: [], stepsTrend: [], sources: {},
};

// ─── Recovery Score ────────────────────────────────────────────────────────────
function calcScore(data: RecoveryData): number | null {
  let score = 0;

  if (data.hrv !== null) {
    const hrvScore = Math.min(40, Math.max(0, ((data.hrv - 20) / 80) * 40));
    score += hrvScore;
  }

  if (data.restingHR !== null) {
    const rhrScore = Math.min(30, Math.max(0, ((80 - data.restingHR) / 35) * 30));
    score += rhrScore;
  }

  if (data.sleepHours !== null) {
    let sleepScore = 0;
    if (data.sleepHours >= 7 && data.sleepHours <= 8.5) sleepScore = 30;
    else if (data.sleepHours >= 6) sleepScore = 20;
    else if (data.sleepHours >= 5) sleepScore = 10;
    score += sleepScore;
  }

  if (data.hrv === null && data.restingHR === null && data.sleepHours === null) return null;
  const maxPossible = (data.hrv !== null ? 40 : 0) + (data.restingHR !== null ? 30 : 0) + (data.sleepHours !== null ? 30 : 0);
  return Math.round((score / maxPossible) * 100);
}

function scoreColor(score: number | null, c: ThemeColors): string {
  if (score === null) return c.textTertiary;
  if (score >= 70) return c.accent;
  if (score >= 40) return c.carbs;
  return c.danger;
}

function scoreLabel(score: number | null): string {
  if (score === null) return '—';
  if (score >= 70) return 'Recovered';
  if (score >= 40) return 'Moderate';
  return 'Low';
}

// ─── Mini Trend Chart ──────────────────────────────────────────────────────────
function MiniChart({ data, color }: { data: { date: string; value: number }[]; color: string }) {
  const { colors } = useTheme();

  if (data.length < 2) {
    return (
      <View style={{ height: CHART_H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textTertiary, fontSize: 11 }}>Not enough data</Text>
      </View>
    );
  }

  const pts = data.slice(-7);
  const values = pts.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padH = 4;
  const padV = 8;
  const chartW = CHART_W - padH * 2;
  const chartH = CHART_H - padV * 2;

  const toX = (i: number) => padH + (i / (pts.length - 1)) * chartW;
  const toY = (v: number) => padV + chartH - ((v - min) / range) * chartH;
  const points = pts.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');

  return (
    <Svg width={CHART_W} height={CHART_H}>
      <Line x1={padH} y1={padV + chartH} x2={padH + chartW} y2={padV + chartH} stroke={colors.border} strokeWidth="1" />
      <Polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((d, i) => (
        <Circle key={i} cx={toX(i)} cy={toY(d.value)} r="2.5" fill={color} />
      ))}
      <SvgText x={padH} y={CHART_H - 1} fill={colors.borderStrong} fontSize="8">{pts[0].date.slice(5)}</SvgText>
      <SvgText x={padH + chartW} y={CHART_H - 1} fill={colors.textTertiary} fontSize="8" textAnchor="end">{pts[pts.length - 1].date.slice(5)}</SvgText>
    </Svg>
  );
}

// ─── Wide Trend Chart ──────────────────────────────────────────────────────────
function WideChart({ data, color }: { data: { date: string; value: number }[]; color: string }) {
  const { colors } = useTheme();
  const chartW = width - 64;
  if (data.length < 2) return null;
  const pts = data.slice(-7);
  const values = pts.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padH = 4, padV = 8;
  const cW = chartW - padH * 2;
  const cH = CHART_H - padV * 2;
  const toX = (i: number) => padH + (i / (pts.length - 1)) * cW;
  const toY = (v: number) => padV + cH - ((v - min) / range) * cH;
  const points = pts.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  return (
    <Svg width={chartW} height={CHART_H}>
      <Line x1={padH} y1={padV + cH} x2={padH + cW} y2={padV + cH} stroke={colors.border} strokeWidth="1" />
      <Polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((d, i) => <Circle key={i} cx={toX(i)} cy={toY(d.value)} r="2.5" fill={color} />)}
      <SvgText x={padH} y={CHART_H - 1} fill={colors.borderStrong} fontSize="8">{pts[0].date.slice(5)}</SvgText>
      <SvgText x={padH + cW} y={CHART_H - 1} fill={colors.textTertiary} fontSize="8" textAnchor="end">{pts[pts.length - 1].date.slice(5)}</SvgText>
    </Svg>
  );
}

// ─── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, unit, sub, color, trendData, source,
}: {
  label: string;
  value: string | null;
  unit?: string;
  sub?: string;
  color: string;
  trendData?: { date: string; value: number }[];
  source?: string;
}) {
  const { colors } = useTheme();
  const sc = makeStatCardStyles(colors);
  return (
    <View style={sc.card}>
      <Text style={sc.label}>{label}</Text>
      {value !== null ? (
        <View style={sc.valueRow}>
          <Text style={[sc.value, { color }]}>{value}</Text>
          {unit && <Text style={sc.unit}>{unit}</Text>}
        </View>
      ) : (
        <Text style={sc.noData}>No data</Text>
      )}
      {sub && <Text style={sc.sub}>{sub}</Text>}
      {source ? <Text style={sc.source}>from {source}</Text> : null}
      {trendData && trendData.length >= 2 && (
        <View style={{ marginTop: 8 }}>
          <MiniChart data={trendData} color={color} />
        </View>
      )}
    </View>
  );
}

// ─── Customize Sheet ───────────────────────────────────────────────────────────
function CustomizeSheet({
  visible,
  onClose,
  visibleMetrics,
  onToggleMetric,
  availableSources,
  sourcePrefs,
  onSetSource,
}: {
  visible: boolean;
  onClose: () => void;
  visibleMetrics: string[];
  onToggleMetric: (key: string) => void;
  availableSources: Record<string, string[]>;
  sourcePrefs: Record<string, string>;
  onSetSource: (key: string, source: string) => void;
}) {
  const { colors } = useTheme();
  const cs = makeCustomizeStyles(colors);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={cs.overlay} />
      </TouchableWithoutFeedback>
      <View style={cs.sheet}>
        <View style={cs.handle} />
        <Text style={cs.sheetTitle}>Customize Recovery</Text>

        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={cs.section}>VISIBLE METRICS</Text>
          {ALL_METRICS.map(({ key, label }) => (
            <View key={key} style={cs.row}>
              <Text style={cs.rowLabel}>{label}</Text>
              <Switch
                value={visibleMetrics.includes(key)}
                onValueChange={() => onToggleMetric(key)}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.accentText}
              />
            </View>
          ))}

          {Object.keys(availableSources).some(k => availableSources[k].length > 1) && (
            <>
              <Text style={[cs.section, { marginTop: 20 }]}>DATA SOURCES</Text>
              <Text style={cs.sourcesNote}>Only shown when multiple apps contribute data for a metric.</Text>
              {ALL_METRICS.filter(({ key }) => (availableSources[key]?.length ?? 0) > 1).map(({ key, label }) => {
                const sources = availableSources[key] ?? [];
                return (
                  <View key={key} style={cs.sourceGroup}>
                    <Text style={cs.sourceMetricLabel}>{label}</Text>
                    <View style={cs.sourcePills}>
                      <TouchableOpacity
                        style={[cs.pill, !sourcePrefs[key] && cs.pillActive]}
                        onPress={() => onSetSource(key, '')}>
                        <Text style={[cs.pillText, !sourcePrefs[key] && cs.pillTextActive]}>Auto</Text>
                      </TouchableOpacity>
                      {sources.map(src => (
                        <TouchableOpacity
                          key={src}
                          style={[cs.pill, sourcePrefs[key] === src && cs.pillActive]}
                          onPress={() => onSetSource(key, src)}>
                          <Text style={[cs.pillText, sourcePrefs[key] === src && cs.pillTextActive]}>{src}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                );
              })}
            </>
          )}
          <View style={{ height: 32 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Wearable Cards ────────────────────────────────────────────────────────────
function WearableStat({ label, value, color }: { label: string; value: string | null; color: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: '45%', backgroundColor: colors.cardAlt, borderRadius: radius.sm, padding: 10 }}>
      <Text style={{ fontSize: 10, fontWeight: weight.bold, color: colors.textTertiary, letterSpacing: 0.8, textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ fontSize: 18, fontWeight: weight.heavy, color: value ? color : colors.textTertiary, marginTop: 4 }}>{value ?? '—'}</Text>
    </View>
  );
}

function WhoopCard({ data }: { data: WhoopData | null }) {
  const { colors } = useTheme();
  if (!data || data.recoveryScore === null) return null;
  const score = data.recoveryScore;
  const color = score >= 67 ? '#C8FF3D' : score >= 34 ? '#F5A623' : '#FF4444';
  const size = 80;
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - score / 100);
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ fontSize: 10, fontWeight: weight.bold, color: colors.textTertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 }}>WHOOP</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 12 }}>
        <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors.border} strokeWidth={7} />
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={7}
            strokeDasharray={circumference} strokeDashoffset={dashOffset} strokeLinecap="round" />
        </Svg>
        <View>
          <Text style={{ fontSize: 36, fontWeight: weight.heavy, color }}>{score}%</Text>
          <Text style={{ fontSize: 12, color: colors.textTertiary, fontWeight: weight.medium }}>Recovery Score</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <WearableStat label="HRV" value={data.hrv !== null ? `${data.hrv}ms` : null} color="#a78bfa" />
        <WearableStat label="Resting HR" value={data.restingHR !== null ? `${data.restingHR} bpm` : null} color={colors.info} />
        <WearableStat label="Strain" value={data.strain !== null ? data.strain.toFixed(1) : null} color={colors.carbs} />
        <WearableStat label="SpO₂" value={data.spo2 !== null ? `${data.spo2.toFixed(1)}%` : null} color={colors.accent} />
      </View>
    </View>
  );
}

function OuraCard({ data }: { data: OuraData | null }) {
  const { colors } = useTheme();
  if (!data || data.readinessScore === null) return null;
  const score = data.readinessScore;
  const color = score >= 70 ? '#C8FF3D' : score >= 50 ? '#F5A623' : '#FF4444';
  const size = 80;
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - score / 100);
  const contributorEntries = data.contributors
    ? Object.entries(data.contributors)
        .filter(([, v]) => typeof v === 'number')
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 4)
    : [];
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ fontSize: 10, fontWeight: weight.bold, color: colors.textTertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 }}>OURA RING</Text>
      <View style={{ flexDirection: 'row', gap: 16, marginBottom: 12 }}>
        <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors.border} strokeWidth={7} />
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={7}
            strokeDasharray={circumference} strokeDashoffset={dashOffset} strokeLinecap="round" />
        </Svg>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 36, fontWeight: weight.heavy, color }}>{score}</Text>
          <Text style={{ fontSize: 12, color: colors.textTertiary }}>Readiness</Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
            {data.sleepScore !== null && (
              <View>
                <Text style={{ fontSize: 18, fontWeight: weight.heavy, color: colors.info }}>{data.sleepScore}</Text>
                <Text style={{ fontSize: 10, color: colors.textTertiary }}>Sleep</Text>
              </View>
            )}
            {data.activityScore !== null && (
              <View>
                <Text style={{ fontSize: 18, fontWeight: weight.heavy, color: colors.accent }}>{data.activityScore}</Text>
                <Text style={{ fontSize: 10, color: colors.textTertiary }}>Activity</Text>
              </View>
            )}
          </View>
        </View>
      </View>
      {contributorEntries.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {contributorEntries.map(([key, val]) => (
            <View key={key} style={{ backgroundColor: colors.cardAlt, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 11, color: colors.textTertiary, fontWeight: weight.semibold }}>
                {key.replace(/_/g, ' ')}: {val}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function GarminCard({ data }: { data: GarminData | null }) {
  const { colors } = useTheme();
  if (!data || data.bodyBattery === null) return null;
  const battery = data.bodyBattery;
  const batteryColor = battery >= 60 ? '#C8FF3D' : battery >= 30 ? '#F5A623' : '#FF4444';
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ fontSize: 10, fontWeight: weight.bold, color: colors.textTertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 }}>GARMIN</Text>
      <Text style={{ fontSize: 10, color: colors.textTertiary, fontWeight: weight.medium, marginBottom: 6 }}>Body Battery</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Text style={{ fontSize: 32, fontWeight: weight.heavy, color: batteryColor }}>{battery}</Text>
        <View style={{ flex: 1 }}>
          <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4 }}>
            <View style={{ height: 8, backgroundColor: batteryColor, borderRadius: 4, width: `${battery}%` as any }} />
          </View>
          <Text style={{ fontSize: 10, color: colors.textTertiary, marginTop: 3 }}>out of 100</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        {data.stressLevel !== null && (
          <View>
            <Text style={{ fontSize: 18, fontWeight: weight.heavy, color: colors.carbs }}>{data.stressLevel}</Text>
            <Text style={{ fontSize: 10, color: colors.textTertiary }}>Stress</Text>
          </View>
        )}
        {data.steps !== null && (
          <View>
            <Text style={{ fontSize: 18, fontWeight: weight.heavy, color: colors.accent }}>{data.steps.toLocaleString()}</Text>
            <Text style={{ fontSize: 10, color: colors.textTertiary }}>Steps</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function RecoveryScreen({
  onNavigateToProfile,
  onNavigateToCoach,
}: {
  onNavigateToProfile?: () => void;
  onNavigateToCoach?: () => void;
}) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const sc = makeStatCardStyles(colors);
  const health = useHealthKit();
  const [data, setData] = useState<RecoveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [noData, setNoData] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [showCustomize, setShowCustomize] = useState(false);
  const [visibleMetrics, setVisibleMetrics] = useState<string[]>(DEFAULT_VISIBLE);
  const [sourcePrefs, setSourcePrefs] = useState<Record<string, string>>({});
  const [preferredTracker, setPreferredTracker] = useState<string>('auto');
  const [availableSources, setAvailableSources] = useState<Record<string, string[]>>({});
  const [trainingLoad, setTrainingLoad] = useState<WeeklyTrainingLoad | null>(null);
  const [showBreathwork, setShowBreathwork] = useState(false);
  const [lastSyncMs, setLastSyncMs] = useState<number | null>(null);
  const [connectedWearables, setConnectedWearables] = useState<Provider[]>([]);
  const [wearablesChecked, setWearablesChecked] = useState(false);
  const [whoopData, setWhoopData] = useState<WhoopData | null>(null);
  const [whoopTrends, setWhoopTrends] = useState<WhoopTrends | null>(null);
  const [ouraData, setOuraData] = useState<OuraData | null>(null);
  const [garminData, setGarminData] = useState<GarminData | null>(null);
  const [wearableLoading, setWearableLoading] = useState(false);
  const [dexcomData, setDexcomData] = useState<{
    stats: { average: number; timeInRange: number; timeAboveRange: number; timeBelowRange: number; high: number; low: number };
    currentReading: number | null;
    currentTrend: string | null;
  } | null>(null);
  const [cyclePhase, setCyclePhase] = useState<{
    name: string; emoji: string; day: number; totalDays: number; daysUntilPeriod: number;
  } | null>(null);
  const [showGlucose, setShowGlucose] = useState(false);
  const [showCycleTracking, setShowCycleTracking] = useState(false);

  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_SOURCE_PREFS, STORAGE_VISIBLE_METRICS, STORAGE_PREFERRED_TRACKER]).then(pairs => {
      const [srcRaw, visRaw, trackerRaw] = pairs;
      if (srcRaw[1]) setSourcePrefs(JSON.parse(srcRaw[1]));
      if (visRaw[1]) setVisibleMetrics(JSON.parse(visRaw[1]));
      if (trackerRaw[1]) setPreferredTracker(trackerRaw[1]);
    });
  }, []);

  const loadRef = useRef<((prefs?: Record<string, string>, silent?: boolean) => Promise<void>) | null>(null);

  const load = useCallback(async (prefs?: Record<string, string>, silent = false) => {
    if (!silent) {
      setLoading(true);
      setUnavailable(false);
      setNoData(false);
      setHealthError(null);
    }
    if (Platform.OS !== 'ios') {
      setUnavailable(true); setHealthError('Not iOS'); setLoading(false); return;
    }
    let authorized = health.isAuthorized;
    if (!authorized) {
      const result = await health.requestPermissions();
      authorized = result.ok;
      if (!result.ok && !silent) setHealthError(result.error ?? 'Unknown error');
    }
    if (!authorized) {
      if (!silent) { setUnavailable(true); setLoading(false); }
      return;
    }
    const [trackerRaw, hkSourcesRaw, syncRaw] = await AsyncStorage.multiGet([
      STORAGE_PREFERRED_TRACKER, STORAGE_HK_SOURCES, STORAGE_LAST_SYNC,
    ]).then(pairs => pairs.map(p => p[1]));
    const tracker = trackerRaw ?? preferredTracker;
    if (trackerRaw && trackerRaw !== preferredTracker) setPreferredTracker(trackerRaw);
    const hkSources = hkSourcesRaw ? (() => { try { return JSON.parse(hkSourcesRaw); } catch { return {}; } })() : {};
    // Source priority: RecoveryScreen fine-grained override > ProfileScreen per-metric > global tracker
    const effectivePrefs = buildSourcePrefs(tracker, { ...hkSources, ...(prefs ?? sourcePrefs) });
    const [result, load_] = await Promise.all([
      health.getRecoveryData(effectivePrefs),
      health.getWeeklyTrainingLoad(effectivePrefs),
    ]);
    setData(result);
    setTrainingLoad(load_);
    // Update last-sync display (getRecoveryData writes STORAGE_LAST_SYNC on completion)
    const freshSyncRaw = await AsyncStorage.getItem(STORAGE_LAST_SYNC);
    const syncMs = freshSyncRaw ? Number(freshSyncRaw) : (syncRaw ? Number(syncRaw) : null);
    if (syncMs) setLastSyncMs(syncMs);
    const allEmpty = result.hrv == null && result.restingHR == null &&
      result.sleepHours == null && result.steps == null &&
      result.activeCalories == null && (load_?.totalMinutes ?? 0) === 0;
    if (allEmpty) {
      const { hasData } = await health.probeData();
      if (!silent) setNoData(!hasData);
    } else if (!silent) {
      setNoData(false);
    }
    if (!silent) setLoading(false);
    health.getAvailableSources().then(setAvailableSources);
  }, [health.isAuthorized, sourcePrefs, preferredTracker]);

  const loadWearableData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setWearablesChecked(true); return; }
    let connected: Provider[] = [];
    try {
      connected = await getConnectedWearables(user.id);
      setConnectedWearables(connected);
    } finally {
      // Always unblock the screen's loading gate, even if the connected-wearables
      // lookup fails — otherwise a network hiccup here would spin the Recovery
      // screen forever (unavailable/noData gating waits on this flag).
      setWearablesChecked(true);
    }
    if (connected.length === 0) return;
    setWearableLoading(true);
    await Promise.all([
      connected.includes('whoop') ? getWhoopData(user.id).then(setWhoopData) : null,
      connected.includes('whoop') ? getWhoopTrends(user.id).then(setWhoopTrends) : null,
      connected.includes('oura') ? getOuraData(user.id).then(setOuraData) : null,
      connected.includes('garmin') ? getGarminData(user.id).then(setGarminData) : null,
    ]);
    setWearableLoading(false);

    // Load Dexcom CGM data
    try {
      const { data: dexRow } = await supabase.from('wearable_tokens')
        .select('provider').eq('user_id', user.id).eq('provider', 'dexcom').maybeSingle();
      if (dexRow) {
        const { data: { session } } = await supabase.auth.getSession();
        const cgmResp = await callCgmProxy(session, { action: 'readings' });
        if (cgmResp.data?.stats) {
          const last = cgmResp.data.readings?.[cgmResp.data.readings.length - 1];
          setDexcomData({
            stats: cgmResp.data.stats,
            currentReading: last?.value ?? null,
            currentTrend: last?.trend ?? null,
          });
        }
      }
    } catch {}

    // Load cycle phase
    try {
      const { data: cs } = await supabase.from('cycle_settings')
        .select('tracking_enabled,cycle_length_days,period_length_days,last_period_start')
        .eq('user_id', user.id).maybeSingle();
      if (cs?.tracking_enabled && cs.last_period_start) {
        setCyclePhase(computeCyclePhase(cs.last_period_start, cs.cycle_length_days, cs.period_length_days));
      }
    } catch {}
  }, []);

  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { load(); loadWearableData(); }, []);

  useEffect(() => {
    const interval = setInterval(() => { loadRef.current?.(undefined, true); }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        loadRef.current?.(undefined, true);
        loadWearableData();
      }
    });
    return () => sub.remove();
  }, []);

  const handleToggleMetric = async (key: string) => {
    const next = visibleMetrics.includes(key)
      ? visibleMetrics.filter(k => k !== key)
      : [...visibleMetrics, key];
    setVisibleMetrics(next);
    await AsyncStorage.setItem(STORAGE_VISIBLE_METRICS, JSON.stringify(next));
  };

  const handleSetSource = async (key: string, source: string) => {
    const next = { ...sourcePrefs };
    if (source) next[key] = source;
    else delete next[key];
    setSourcePrefs(next);
    await AsyncStorage.setItem(STORAGE_SOURCE_PREFS, JSON.stringify(next));
    load(next);
  };

  const isVisible = (key: string) => visibleMetrics.includes(key);

  const handleNavigateToCoach = useCallback(() => {
    setShowCycleTracking(false);
    setShowGlucose(false);
    onNavigateToCoach?.();
  }, [onNavigateToCoach]);

  // When Whoop is connected, it's the sole source of truth for recovery
  // score, HRV, resting HR, and sleep — HealthKit's versions of these can
  // reflect Apple Watch (or another synced source) and disagree with Whoop's
  // own algorithm, which is what made this screen look "wrong" when a Whoop
  // was also connected. Other metrics (steps, active cal, VO2, blood O2) have
  // no Whoop equivalent surfaced here, so they keep coming from HealthKit.
  const whoopConnected = connectedWearables.includes('whoop');
  // Whoop-only users (no HealthKit permission) still get a full recovery
  // score/HRV/RHR/sleep view — HealthKit is only required as a data source
  // when Whoop isn't connected, not as a gate on the whole screen.
  const safeData = data ?? EMPTY_RECOVERY_DATA;
  const effectiveData: RecoveryData | null = whoopConnected && whoopData
    ? {
        ...safeData,
        hrv: whoopData.hrv,
        restingHR: whoopData.restingHR,
        sleepHours: whoopData.sleepHours,
        sleepDeepHours: whoopData.sleepDeepHours,
        sleepRemHours: whoopData.sleepRemHours,
        hrvTrend: whoopTrends?.hrvTrend.length ? whoopTrends.hrvTrend : [],
        rhrTrend: whoopTrends?.rhrTrend.length ? whoopTrends.rhrTrend : [],
        sleepTrend: whoopTrends?.sleepTrend.length ? whoopTrends.sleepTrend : [],
        sources: { ...safeData.sources, hrv: 'Whoop', rhr: 'Whoop', sleep: 'Whoop' },
      }
    : data;
  const score = whoopConnected && whoopData?.recoveryScore != null
    ? whoopData.recoveryScore
    : (effectiveData ? calcScore(effectiveData) : null);
  const color = scoreColor(score, colors);

  const fmtSleep = (h: number | null) => {
    if (h === null) return null;
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    return `${hrs}h ${mins}m`;
  };

  const formatLastSync = (ms: number): string => {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const date = new Date(ms);
    const isToday = date.toDateString() === new Date().toDateString();
    if (isToday) return `today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return date.toLocaleDateString();
  };

  // HealthKit permission/availability only gates the screen when Whoop isn't
  // connected — a Whoop-only user has a full recovery view without it. Wait
  // on wearablesChecked too so this doesn't flash before we know whether
  // Whoop is connected.
  if (unavailable && !whoopConnected && wearablesChecked) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <Text style={s.title}>Recovery</Text>
        </View>
        <View style={s.center}>
          <Text style={s.emptyIcon}>❤️</Text>
          <Text style={s.emptyTitle}>Apple Health Not Available</Text>
          <Text style={s.emptySub}>Recovery data requires an iOS device with Apple Health, or a connected Whoop.</Text>
          {healthError && (
            <View style={s.errorBox}>
              <Text style={s.errorText}>Debug: {healthError}</Text>
            </View>
          )}
          <TouchableOpacity style={s.connectBtn} onPress={() => load()}>
            <Text style={s.connectBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (noData && !whoopConnected && wearablesChecked) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <Text style={s.title}>Recovery</Text>
        </View>
        <View style={s.center}>
          <Text style={s.emptyIcon}>🔒</Text>
          <Text style={s.emptyTitle}>No Health Data Yet</Text>
          <Text style={s.emptySub}>
            Fuelog is connected, but Apple Health isn't sharing any data. Open the
            Health app → tap your profile → Privacy → Apps → Fuelog, and turn on the
            categories you want (HRV, Sleep, Steps, Workouts, Heart Rate). Data from a
            Whoop, Garmin, or Apple Watch can take a few minutes to sync.
          </Text>
          <TouchableOpacity style={s.connectBtn} onPress={() => load()}>
            <Text style={s.connectBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Recovery</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={s.iconBtn} onPress={() => setShowCustomize(true)}>
            <Text style={s.iconBtnText}>⚙</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={() => load(undefined, false)}>
            <Text style={s.iconBtnText}>↻</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading || !wearablesChecked ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.text} size="large" />
          <Text style={s.loadingText}>Loading recovery data…</Text>
        </View>
      ) : !data && !whoopConnected ? (
        <View style={s.center}>
          <Text style={s.emptyIcon}>❤️</Text>
          <Text style={s.emptyTitle}>Connect Apple Health</Text>
          <Text style={s.emptySub}>Fuelog reads HRV, sleep, steps, and more from Apple Health. Your Whoop, Garmin, and Apple Watch data all sync here automatically. Or connect a Whoop from your profile to skip Apple Health entirely.</Text>
          <TouchableOpacity style={s.connectBtn} onPress={() => load()}>
            <Text style={s.connectBtnText}>Connect Apple Health</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* Wearable Scores */}
          {connectedWearables.length > 0 ? (
            <>
              <Text style={s.wearableSectionLabel}>WEARABLE SCORES</Text>
              {wearableLoading ? (
                <ActivityIndicator color={colors.textTertiary} style={{ alignSelf: 'flex-start', marginBottom: 4 }} />
              ) : (
                <>
                  <WhoopCard data={whoopData} />
                  <OuraCard data={ouraData} />
                  <GarminCard data={garminData} />
                </>
              )}
            </>
          ) : (
            <TouchableOpacity style={s.wearablePrompt} activeOpacity={0.75} onPress={onNavigateToProfile}>
              <Text style={s.wearablePromptText}>Connect a wearable for richer scores</Text>
              <Text style={{ fontSize: 14, color: colors.textTertiary }}>›</Text>
            </TouchableOpacity>
          )}

          {/* Glucose Card */}
          {dexcomData && (
            <TouchableOpacity
              style={s.wearableDataCard}
              activeOpacity={0.8}
              onPress={() => setShowGlucose(true)}
            >
              <Text style={s.wearableDataLabel}>GLUCOSE</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                    <Text style={s.wearableDataBig}>
                      {dexcomData.currentReading ?? dexcomData.stats.average.toFixed(0)}
                    </Text>
                    <Text style={s.wearableDataUnit}>mg/dL</Text>
                    {dexcomData.currentTrend ? (
                      <Text style={{ fontSize: 20 }}>{trendArrowEmoji(dexcomData.currentTrend)}</Text>
                    ) : null}
                  </View>
                  <Text style={s.wearableDataSub}>Current reading</Text>
                </View>
                <View style={[
                  s.tirPill,
                  {
                    borderColor: dexcomData.stats.timeInRange >= 70 ? '#C8FF3D'
                      : dexcomData.stats.timeInRange >= 50 ? '#F5A623' : '#FF4444',
                    backgroundColor: dexcomData.stats.timeInRange >= 70 ? '#C8FF3D18'
                      : dexcomData.stats.timeInRange >= 50 ? '#F5A62318' : '#FF444418',
                  },
                ]}>
                  <Text style={[
                    s.tirPillText,
                    { color: dexcomData.stats.timeInRange >= 70 ? '#C8FF3D' : dexcomData.stats.timeInRange >= 50 ? '#F5A623' : '#FF4444' },
                  ]}>
                    {dexcomData.stats.timeInRange}% TIR
                  </Text>
                </View>
              </View>
              <Text style={s.wearableDataTapHint}>Tap for 24h chart →</Text>
            </TouchableOpacity>
          )}

          {/* Cycle Phase Card */}
          {cyclePhase && (
            <TouchableOpacity
              style={s.wearableDataCard}
              activeOpacity={0.8}
              onPress={() => setShowCycleTracking(true)}
            >
              <Text style={s.wearableDataLabel}>CYCLE TRACKING</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <View>
                  <Text style={s.wearableDataBig}>{cyclePhase.emoji} {cyclePhase.name}</Text>
                  <Text style={s.wearableDataSub}>Day {cyclePhase.day} of {cyclePhase.totalDays}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.wearableDataBig, { color: '#C8FF3D', fontSize: 28 }]}>{cyclePhase.daysUntilPeriod}</Text>
                  <Text style={s.wearableDataSub}>days until period</Text>
                </View>
              </View>
              <Text style={[s.wearableDataTapHint, { marginTop: 4 }]}>{cycleInsight(cyclePhase.name)}</Text>
            </TouchableOpacity>
          )}

          {/* Recovery Score */}
          <View style={[s.scoreCard, { borderColor: color }]}>
            <View style={s.scoreLeft}>
              <Text style={s.scoreSmall}>TODAY'S RECOVERY</Text>
              <Text style={[s.scoreNumber, { color }]}>{score ?? '—'}</Text>
              <Text style={[s.scoreLabel, { color }]}>{scoreLabel(score)}</Text>
            </View>
            <View style={s.scoreRight}>
              <ScoreRing score={score} color={color} />
            </View>
          </View>

          <Text style={s.sourceNote}>
            {whoopConnected
              ? '⌚ Recovery score, HRV, resting HR & sleep from Whoop'
              : '❤️ From Apple Health · Whoop, Garmin & Apple Watch sync automatically'}
          </Text>
          {lastSyncMs && (
            <Text style={s.lastSyncText}>Updated {formatLastSync(lastSyncMs)}</Text>
          )}

          {/* Breathwork */}
          <TouchableOpacity style={s.breathCard} onPress={() => setShowBreathwork(true)} activeOpacity={0.8}>
            <View>
              <Text style={s.breathCardTitle}>🌬️  Breathwork</Text>
              <Text style={s.breathCardSub}>Box · 4-7-8 · Physiological Sigh</Text>
            </View>
            <Text style={s.breathCardArrow}>›</Text>
          </TouchableOpacity>

          {/* HRV + RHR row */}
          {(isVisible('hrv') || isVisible('rhr')) && effectiveData && (
            <View style={s.row}>
              {isVisible('hrv') && (
                <StatCard
                  label="HRV"
                  value={effectiveData.hrv !== null ? String(effectiveData.hrv) : null}
                  unit="ms"
                  sub="Heart rate variability"
                  color="#a78bfa"
                  trendData={effectiveData.hrvTrend}
                  source={effectiveData.sources['hrv']}
                />
              )}
              {isVisible('rhr') && (
                <StatCard
                  label="Resting HR"
                  value={effectiveData.restingHR !== null ? String(effectiveData.restingHR) : null}
                  unit="bpm"
                  sub="Lower is better"
                  color={colors.info}
                  trendData={effectiveData.rhrTrend}
                  source={effectiveData.sources['rhr']}
                />
              )}
            </View>
          )}

          {/* Sleep */}
          {isVisible('sleep') && effectiveData && (
            <View style={s.sleepCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Text style={s.cardTitle}>SLEEP LAST NIGHT</Text>
                {effectiveData.sources['sleep'] ? <Text style={s.cardSource}>from {effectiveData.sources['sleep']}</Text> : null}
              </View>
              {effectiveData.sleepHours !== null ? (
                <>
                  <View style={s.sleepRow}>
                    <View style={s.sleepItem}>
                      <Text style={[s.sleepVal, { color: colors.text }]}>{fmtSleep(effectiveData.sleepHours)}</Text>
                      <Text style={s.sleepItemLabel}>Total</Text>
                    </View>
                    {effectiveData.sleepDeepHours !== null && effectiveData.sleepDeepHours > 0 && (
                      <View style={s.sleepItem}>
                        <Text style={[s.sleepVal, { color: colors.info }]}>{fmtSleep(effectiveData.sleepDeepHours)}</Text>
                        <Text style={s.sleepItemLabel}>Deep</Text>
                      </View>
                    )}
                    {effectiveData.sleepRemHours !== null && effectiveData.sleepRemHours > 0 && (
                      <View style={s.sleepItem}>
                        <Text style={[s.sleepVal, { color: '#a78bfa' }]}>{fmtSleep(effectiveData.sleepRemHours)}</Text>
                        <Text style={s.sleepItemLabel}>REM</Text>
                      </View>
                    )}
                  </View>
                  <SleepBar total={effectiveData.sleepHours} deep={effectiveData.sleepDeepHours} rem={effectiveData.sleepRemHours} />
                  {effectiveData.sleepTrend.length >= 2 && (
                    <View style={{ marginTop: 12 }}>
                      <Text style={[s.cardTitle, { marginBottom: 6 }]}>7-DAY TREND</Text>
                      <WideChart data={effectiveData.sleepTrend} color={colors.info} />
                    </View>
                  )}
                </>
              ) : (
                <Text style={s.noDataText}>No sleep data — make sure your device is recording sleep</Text>
              )}
            </View>
          )}

          {/* Steps + Active Cals row */}
          {(isVisible('steps') || isVisible('activeCal')) && (
            <View style={s.row}>
              {isVisible('steps') && (
                <View style={[sc.card, { flex: 1 }]}>
                  <Text style={sc.label}>Steps Today</Text>
                  {safeData.steps !== null ? (
                    <>
                      <View style={sc.valueRow}>
                        <Text style={[sc.value, { color: colors.accent, fontSize: 22 }]}>
                          {safeData.steps.toLocaleString()}
                        </Text>
                      </View>
                      <StepsBar steps={safeData.steps} goal={10000} />
                      <Text style={sc.sub}>{Math.round((safeData.steps / 10000) * 100)}% of 10k goal</Text>
                      {safeData.sources['steps'] ? <Text style={sc.source}>from {safeData.sources['steps']}</Text> : null}
                      {safeData.stepsTrend.length >= 2 && (
                        <View style={{ marginTop: 8 }}>
                          <MiniChart data={safeData.stepsTrend} color={colors.accent} />
                        </View>
                      )}
                    </>
                  ) : (
                    <Text style={sc.noData}>No data</Text>
                  )}
                </View>
              )}
              {isVisible('activeCal') && (
                <StatCard
                  label="Active Cal"
                  value={safeData.activeCalories !== null ? safeData.activeCalories.toLocaleString() : null}
                  unit="kcal"
                  sub="Burned today · may differ from your tracker's app"
                  color={colors.carbs}
                  source={safeData.sources['activeCal']}
                />
              )}
            </View>
          )}

          {/* Vitals row */}
          {(isVisible('bloodO2') || isVisible('respRate')) && (
            <View style={s.row}>
              {isVisible('bloodO2') && (
                <StatCard
                  label="Blood O₂"
                  value={safeData.bloodOxygen !== null ? String(safeData.bloodOxygen) : null}
                  unit="%"
                  sub={safeData.bloodOxygen !== null ? (safeData.bloodOxygen >= 95 ? 'Normal range' : 'Below normal') : undefined}
                  color={safeData.bloodOxygen !== null && safeData.bloodOxygen < 95 ? colors.danger : colors.accent}
                  source={safeData.sources['bloodO2']}
                />
              )}
              {isVisible('respRate') && (
                <StatCard
                  label="Resp. Rate"
                  value={safeData.respiratoryRate !== null ? String(safeData.respiratoryRate) : null}
                  unit="br/min"
                  sub="Breaths per minute"
                  color={colors.fat}
                  source={safeData.sources['respRate']}
                />
              )}
            </View>
          )}

          {isVisible('vo2') && safeData.vo2Max !== null && (
            <View style={s.vo2Card}>
              <View>
                <Text style={s.cardTitle}>VO₂ MAX</Text>
                {safeData.sources['vo2'] ? <Text style={s.cardSource}>from {safeData.sources['vo2']}</Text> : null}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 6 }}>
                  <Text style={{ fontSize: 36, fontWeight: weight.heavy, color: colors.info }}>{safeData.vo2Max}</Text>
                  <Text style={{ fontSize: 14, color: colors.textTertiary, fontWeight: weight.semibold }}>mL/kg/min</Text>
                </View>
              </View>
              <View style={s.vo2Badge}>
                <Text style={s.vo2BadgeText}>{vo2Category(safeData.vo2Max)}</Text>
              </View>
            </View>
          )}

          {/* Training Load */}
          {trainingLoad && trainingLoad.dailyLoad.length > 0 && (
            <TrainingLoadCard load={trainingLoad} />
          )}

          {/* Recovery tips */}
          {score !== null && effectiveData && (
            <View style={s.tipsCard}>
              <Text style={s.cardTitle}>TODAY'S RECOMMENDATION</Text>
              <Text style={s.tipsText}>{recoveryTip(score, effectiveData, trainingLoad)}</Text>
            </View>
          )}

        </ScrollView>
      )}

      <CustomizeSheet
        visible={showCustomize}
        onClose={() => setShowCustomize(false)}
        visibleMetrics={visibleMetrics}
        onToggleMetric={handleToggleMetric}
        availableSources={availableSources}
        sourcePrefs={sourcePrefs}
        onSetSource={handleSetSource}
      />

      <Modal visible={showBreathwork} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowBreathwork(false)}>
        <BreathworkScreen onClose={() => setShowBreathwork(false)} />
      </Modal>

      <Modal visible={showGlucose} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowGlucose(false)}>
        <GlucoseScreen onClose={() => setShowGlucose(false)} />
      </Modal>

      <Modal visible={showCycleTracking} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCycleTracking(false)}>
        <CycleTrackingScreen onClose={() => setShowCycleTracking(false)} onNavigateToCoach={handleNavigateToCoach} />
      </Modal>
    </SafeAreaView>
  );
}

// ─── Score Ring ────────────────────────────────────────────────────────────────
function ScoreRing({ score, color }: { score: number | null; color: string }) {
  const { colors } = useTheme();
  const size = 90;
  const strokeWidth = 8;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = score !== null ? score / 100 : 0;
  const dashOffset = circumference * (1 - pct);

  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors.border} strokeWidth={strokeWidth} />
      {score !== null && (
        <Circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
      )}
    </Svg>
  );
}

// ─── Sleep Bar ─────────────────────────────────────────────────────────────────
function SleepBar({ total, deep, rem }: { total: number | null; deep: number | null; rem: number | null }) {
  const { colors } = useTheme();
  if (!total) return null;
  const maxHrs = 10;
  const totalPct = Math.min(100, (total / maxHrs) * 100);
  const deepPct = deep ? Math.min(100, (deep / maxHrs) * 100) : 0;
  const remPct = rem ? Math.min(100, (rem / maxHrs) * 100) : 0;
  const corePct = Math.max(0, totalPct - deepPct - remPct);

  return (
    <View style={{ marginTop: 12, marginBottom: 4 }}>
      <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, flexDirection: 'row', overflow: 'hidden', width: '100%' }}>
        <View style={{ width: `${corePct}%` as any, backgroundColor: colors.info, opacity: 0.6 }} />
        <View style={{ width: `${deepPct}%` as any, backgroundColor: colors.info }} />
        <View style={{ width: `${remPct}%` as any, backgroundColor: '#a78bfa' }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.info, opacity: 0.6 }} />
          <Text style={{ fontSize: 10, color: colors.textTertiary, fontWeight: weight.semibold }}>Core</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.info }} />
          <Text style={{ fontSize: 10, color: colors.textTertiary, fontWeight: weight.semibold }}>Deep</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#a78bfa' }} />
          <Text style={{ fontSize: 10, color: colors.textTertiary, fontWeight: weight.semibold }}>REM</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Steps Bar ─────────────────────────────────────────────────────────────────
function StepsBar({ steps, goal }: { steps: number; goal: number }) {
  const { colors } = useTheme();
  const pct = Math.min(100, (steps / goal) * 100);
  return (
    <View style={{ marginTop: 8, marginBottom: 2 }}>
      <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2 }}>
        <View style={{ height: 4, backgroundColor: colors.accent, borderRadius: 2, width: `${pct}%` as any }} />
      </View>
    </View>
  );
}

// ─── Training Load Card ────────────────────────────────────────────────────────
function TrainingLoadCard({ load }: { load: WeeklyTrainingLoad }) {
  const { colors } = useTheme();
  const tl = makeTrainingLoadStyles(colors);
  const loadLabel = load.totalMinutes > 300 ? 'High' : load.totalMinutes > 150 ? 'Moderate' : 'Low';
  const loadColor = load.totalMinutes > 300 ? colors.danger : load.totalMinutes > 150 ? colors.carbs : colors.accent;
  const maxMin = Math.max(...load.dailyLoad.map(d => d.minutes), 1);
  const barW = Math.floor((width - 96) / 7);

  const days: { date: string; minutes: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = toLocalDateString(d);
    const found = load.dailyLoad.find(x => x.date === key);
    days.push({ date: key, minutes: found?.minutes ?? 0 });
  }

  return (
    <View style={tl.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <Text style={tl.label}>WEEKLY TRAINING LOAD</Text>
          <Text style={[tl.loadLabel, { color: loadColor }]}>{loadLabel}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={tl.stat}>{load.totalMinutes}<Text style={tl.statUnit}> min</Text></Text>
          {load.totalCalories > 0 && <Text style={tl.statSub}>{load.totalCalories.toLocaleString()} kcal</Text>}
        </View>
      </View>
      <Text style={tl.note}>From Apple Health workouts · overlapping entries from multiple devices are merged, but totals may still differ slightly from a tracker's own app</Text>
      <View style={tl.bars}>
        {days.map((d, i) => {
          const pct = d.minutes / maxMin;
          const dayLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' });
          return (
            <View key={i} style={[tl.barCol, { width: barW }]}>
              <View style={tl.barBg}>
                <View style={[tl.barFill, { height: `${Math.max(pct * 100, d.minutes > 0 ? 4 : 0)}%` as any, backgroundColor: loadColor }]} />
              </View>
              <Text style={tl.barLabel}>{dayLabel}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function vo2Category(vo2: number): string {
  if (vo2 >= 60) return 'Superior';
  if (vo2 >= 52) return 'Excellent';
  if (vo2 >= 44) return 'Good';
  if (vo2 >= 36) return 'Fair';
  return 'Low';
}

function recoveryTip(score: number, data: RecoveryData, load: WeeklyTrainingLoad | null): string {
  const recoveryLevel: 'high' | 'mid' | 'low' = score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low';
  const loadLevel: 'high' | 'mid' | 'low' = load === null ? 'low'
    : load.totalMinutes > 300 ? 'high'
    : load.totalMinutes > 150 ? 'mid' : 'low';

  const issues: string[] = [];
  if (data.sleepHours !== null && data.sleepHours < 7) issues.push('sleep was below 7 hours');
  if (data.hrv !== null && data.hrv < 40) issues.push('HRV is low');
  if (data.restingHR !== null && data.restingHR > 65) issues.push('resting heart rate is elevated');
  const issueStr = issues.length > 0 ? ` (${issues.join(', ')})` : '';

  const tips: Record<string, Record<string, string>> = {
    high: {
      high: 'Well recovered despite a heavy training week — your body is adapting well. Today is great for a hard session, but tomorrow consider a deload.',
      mid: 'Good recovery and moderate training load. Today is ideal for a quality session — push hard and aim for PRs.',
      low: 'Excellent recovery and low training load this week. Push hard today — your body is ready for it.',
    },
    mid: {
      high: `Moderate recovery with a heavy training week${issueStr}. Keep today moderate-intensity — your body needs recovery, not more load. Focus on sleep and hydration.`,
      mid: `Moderate recovery${issueStr}. Stick to moderate-intensity training today. Prioritise sleep tonight and consider extra protein and hydration.`,
      low: `Moderate recovery${issueStr}. You have room to train, but keep intensity in check. A solid moderate session today with focus on sleep tonight is the move.`,
    },
    low: {
      high: `Low recovery + heavy training load this week${issueStr}. Rest day strongly recommended. Continuing to train hard risks injury and overtraining — let your body catch up.`,
      mid: `Low recovery with moderate training load${issueStr}. Take a rest or active recovery day — light walk or mobility only. Prioritise sleep above all else tonight.`,
      low: `Low recovery today${issues.length > 0 ? ` — ${issues.join(', ')}` : ''}. Consider a rest day, light walk, or mobility work. Pushing hard when poorly recovered increases injury risk and impairs adaptation.`,
    },
  };

  return tips[recoveryLevel][loadLevel];
}

// ─── Style Functions ───────────────────────────────────────────────────────────
function makeStatCardStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: radius.card, padding: 14, flex: 1, borderWidth: 1, borderColor: c.border },
    label: { fontSize: 10, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.2, marginBottom: 6, textTransform: 'uppercase' },
    valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
    value: { fontSize: 26, fontWeight: weight.heavy, letterSpacing: -0.5 },
    unit: { fontSize: 13, color: c.textTertiary, fontWeight: weight.semibold },
    sub: { fontSize: 11, color: c.textTertiary, fontWeight: weight.medium, marginTop: 4 },
    source: { fontSize: 10, color: c.textTertiary, fontWeight: weight.medium, marginTop: 2 },
    noData: { fontSize: 14, color: c.textTertiary, fontWeight: weight.semibold, marginTop: 4 },
  });
}

function makeCustomizeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
    sheet: {
      backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl, paddingTop: spacing.md, maxHeight: '80%',
    },
    handle: { width: 36, height: 4, backgroundColor: c.borderStrong, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    sheetTitle: { fontSize: 18, fontWeight: weight.heavy, color: c.text, marginBottom: 20 },
    section: { fontSize: 10, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5, marginBottom: 12 },
    sourcesNote: { fontSize: 12, color: c.textTertiary, fontWeight: weight.medium, marginBottom: 14, marginTop: -8 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.card },
    rowLabel: { fontSize: 15, fontWeight: weight.semibold, color: c.textSecondary },
    sourceGroup: { marginBottom: 16 },
    sourceMetricLabel: { fontSize: 13, fontWeight: weight.bold, color: c.textSecondary, marginBottom: 8 },
    sourcePills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: { borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    pillActive: { backgroundColor: c.accent, borderColor: c.accent },
    pillText: { fontSize: 13, fontWeight: weight.semibold, color: c.textTertiary },
    pillTextActive: { color: c.accentText },
  });
}

function makeTrainingLoadStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg, borderWidth: 1, borderColor: c.border },
    label: { fontSize: 10, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 2 },
    loadLabel: { fontSize: 18, fontWeight: weight.heavy },
    stat: { fontSize: 22, fontWeight: weight.heavy, color: c.text },
    statUnit: { fontSize: 13, color: c.textTertiary, fontWeight: weight.semibold },
    statSub: { fontSize: 11, color: c.textTertiary, fontWeight: weight.medium, marginTop: 2 },
    note: { fontSize: 10, color: c.textTertiary, fontWeight: weight.medium, marginTop: 8, lineHeight: 15 },
    bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 16, height: 60 },
    barCol: { alignItems: 'center', gap: 4 },
    barBg: { flex: 1, width: '70%', backgroundColor: c.border, borderRadius: 3, justifyContent: 'flex-end', overflow: 'hidden' },
    barFill: { width: '100%', borderRadius: 3 },
    barLabel: { fontSize: 9, color: c.textTertiary, fontWeight: weight.semibold },
  });
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    title: { fontSize: 28, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
    iconBtnText: { color: c.textSecondary, fontSize: 18, fontWeight: weight.bold },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
    loadingText: { color: c.textTertiary, fontSize: 14, fontWeight: weight.medium, marginTop: 12 },
    emptyIcon: { fontSize: 52, marginBottom: 8 },
    emptyTitle: { fontSize: 20, fontWeight: weight.heavy, color: c.text, textAlign: 'center' },
    emptySub: { fontSize: 14, color: c.textTertiary, textAlign: 'center', lineHeight: 22, fontWeight: weight.medium },
    connectBtn: { backgroundColor: c.accent, borderRadius: radius.md, paddingHorizontal: 24, paddingVertical: 14, marginTop: 8 },
    connectBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.heavy },
    errorBox: { backgroundColor: c.dangerSoft, borderRadius: radius.sm, padding: 12, marginTop: 8, borderWidth: 1, borderColor: 'rgba(255,68,68,0.3)', maxWidth: 300 },
    errorText: { color: c.danger, fontSize: 12, fontFamily: 'monospace', textAlign: 'left', lineHeight: 18 },
    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: 48, gap: 10 },
    scoreCard: {
      backgroundColor: c.card, borderRadius: radius.xl, padding: spacing.xl,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderWidth: 1.5,
    },
    scoreLeft: { flex: 1 },
    scoreSmall: { fontSize: 10, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5, marginBottom: 4 },
    scoreNumber: { fontSize: 64, fontWeight: weight.heavy, letterSpacing: -2, lineHeight: 68 },
    scoreLabel: { fontSize: 18, fontWeight: weight.heavy, marginTop: 2 },
    scoreRight: { marginLeft: 16 },
    sourceNote: { fontSize: 11, color: c.textTertiary, fontWeight: weight.medium, textAlign: 'center', marginTop: -4 },
    lastSyncText: { fontSize: 11, color: c.textTertiary, fontWeight: weight.regular, textAlign: 'center', marginTop: 2, marginBottom: 4, opacity: 0.7 },
    row: { flexDirection: 'row', gap: 10 },
    cardTitle: { fontSize: 10, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
    cardSource: { fontSize: 10, color: c.textTertiary, fontWeight: weight.medium },
    sleepCard: { backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg, borderWidth: 1, borderColor: c.border },
    sleepRow: { flexDirection: 'row', gap: 20, marginTop: 8 },
    sleepItem: { alignItems: 'flex-start' },
    sleepVal: { fontSize: 22, fontWeight: weight.heavy, letterSpacing: -0.5 },
    sleepItemLabel: { fontSize: 10, color: c.textTertiary, fontWeight: weight.semibold, marginTop: 2 },
    noDataText: { fontSize: 13, color: c.textTertiary, fontWeight: weight.medium, marginTop: 8, lineHeight: 20 },
    vo2Card: {
      backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderWidth: 1, borderColor: c.border,
    },
    vo2Badge: { backgroundColor: 'rgba(74,158,255,0.12)', borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(74,158,255,0.25)' },
    vo2BadgeText: { color: c.info, fontSize: 14, fontWeight: weight.heavy },
    tipsCard: { backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg, borderWidth: 1, borderColor: c.border },
    tipsText: { fontSize: 14, color: c.textSecondary, lineHeight: 22, fontWeight: weight.medium, marginTop: 8 },
    breathCard: {
      backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    breathCardTitle: { fontSize: 16, fontWeight: weight.bold, color: c.text, marginBottom: 3 },
    breathCardSub: { fontSize: 12, color: c.textTertiary, fontWeight: weight.medium },
    breathCardArrow: { fontSize: 22, color: c.textTertiary, fontWeight: weight.medium },
    wearableSectionLabel: {
      fontSize: 10, fontWeight: weight.bold, color: c.textTertiary,
      letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: -2,
    },
    wearablePrompt: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 4, paddingVertical: 12,
    },
    wearablePromptText: { fontSize: 13, color: c.textTertiary, fontWeight: weight.medium },
    wearableDataCard: {
      backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border,
    },
    wearableDataLabel: {
      fontSize: 10, fontWeight: weight.bold, color: c.textTertiary,
      letterSpacing: 1.5, textTransform: 'uppercase',
    },
    wearableDataBig: { fontSize: 28, fontWeight: weight.heavy, color: c.text, lineHeight: 32 },
    wearableDataUnit: { fontSize: 14, color: c.textTertiary, fontWeight: weight.semibold },
    wearableDataSub: { fontSize: 12, color: c.textTertiary, fontWeight: weight.medium, marginTop: 2 },
    wearableDataTapHint: { fontSize: 11, color: c.textTertiary, marginTop: 6 },
    tirPill: {
      borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1.5,
    },
    tirPillText: { fontSize: 14, fontWeight: weight.heavy },
  });
}
