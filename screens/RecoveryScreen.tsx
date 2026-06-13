import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Dimensions, Platform, Modal, Switch,
  TouchableWithoutFeedback, AppState, AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle, Polyline, Line, Text as SvgText } from 'react-native-svg';
import { useHealthKit, RecoveryData, WeeklyTrainingLoad } from '../hooks/useHealthKit';

const { width } = Dimensions.get('window');
const CHART_W = (width - 64) / 2 - 8;
const CHART_H = 60;

const STORAGE_SOURCE_PREFS = 'recovery_source_prefs';
const STORAGE_VISIBLE_METRICS = 'recovery_visible_metrics';

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

function scoreColor(score: number | null): string {
  if (score === null) return '#333';
  if (score >= 70) return '#4ade80';
  if (score >= 40) return '#fbbf24';
  return '#ff4f4f';
}

function scoreLabel(score: number | null): string {
  if (score === null) return '—';
  if (score >= 70) return 'Recovered';
  if (score >= 40) return 'Moderate';
  return 'Low';
}

// ─── Mini Trend Chart ──────────────────────────────────────────────────────────
function MiniChart({ data, color }: { data: { date: string; value: number }[]; color: string }) {
  if (data.length < 2) {
    return (
      <View style={{ height: CHART_H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#333', fontSize: 11 }}>Not enough data</Text>
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
      <Line x1={padH} y1={padV + chartH} x2={padH + chartW} y2={padV + chartH} stroke="#222" strokeWidth="1" />
      <Polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((d, i) => (
        <Circle key={i} cx={toX(i)} cy={toY(d.value)} r="2.5" fill={color} />
      ))}
      <SvgText x={padH} y={CHART_H - 1} fill="#333" fontSize="8">{pts[0].date.slice(5)}</SvgText>
      <SvgText x={padH + chartW} y={CHART_H - 1} fill="#444" fontSize="8" textAnchor="end">{pts[pts.length - 1].date.slice(5)}</SvgText>
    </Svg>
  );
}

// ─── Wide Trend Chart ──────────────────────────────────────────────────────────
function WideChart({ data, color }: { data: { date: string; value: number }[]; color: string }) {
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
      <Line x1={padH} y1={padV + cH} x2={padH + cW} y2={padV + cH} stroke="#222" strokeWidth="1" />
      <Polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((d, i) => <Circle key={i} cx={toX(i)} cy={toY(d.value)} r="2.5" fill={color} />)}
      <SvgText x={padH} y={CHART_H - 1} fill="#333" fontSize="8">{pts[0].date.slice(5)}</SvgText>
      <SvgText x={padH + cW} y={CHART_H - 1} fill="#444" fontSize="8" textAnchor="end">{pts[pts.length - 1].date.slice(5)}</SvgText>
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

const sc = StyleSheet.create({
  card: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 14, flex: 1 },
  label: { fontSize: 10, fontWeight: '700', color: '#444', letterSpacing: 1.2, marginBottom: 6, textTransform: 'uppercase' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  value: { fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  unit: { fontSize: 13, color: '#555', fontWeight: '600' },
  sub: { fontSize: 11, color: '#444', fontWeight: '500', marginTop: 4 },
  source: { fontSize: 10, color: '#333', fontWeight: '500', marginTop: 2 },
  noData: { fontSize: 14, color: '#333', fontWeight: '600', marginTop: 4 },
});

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
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={cs.overlay} />
      </TouchableWithoutFeedback>
      <View style={cs.sheet}>
        <View style={cs.handle} />
        <Text style={cs.sheetTitle}>Customize Recovery</Text>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Visibility */}
          <Text style={cs.section}>VISIBLE METRICS</Text>
          {ALL_METRICS.map(({ key, label }) => (
            <View key={key} style={cs.row}>
              <Text style={cs.rowLabel}>{label}</Text>
              <Switch
                value={visibleMetrics.includes(key)}
                onValueChange={() => onToggleMetric(key)}
                trackColor={{ false: '#2a2a2a', true: '#fff' }}
                thumbColor="#000"
              />
            </View>
          ))}

          {/* Sources */}
          {Object.keys(availableSources).some(k => availableSources[k].length > 1) && (
            <>
              <Text style={[cs.section, { marginTop: 20 }]}>DATA SOURCES</Text>
              <Text style={cs.sourcesNote}>Only shown when multiple apps contribute data for a metric.</Text>
              {ALL_METRICS.filter(({ key }) => (availableSources[key]?.length ?? 0) > 1).map(({ key, label }) => {
                const sources = availableSources[key] ?? [];
                const current = sourcePrefs[key] ?? 'Auto';
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

const cs = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: '#141414', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, maxHeight: '80%',
  },
  handle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: '#fff', marginBottom: 20 },
  section: { fontSize: 10, fontWeight: '700', color: '#444', letterSpacing: 1.5, marginBottom: 12 },
  sourcesNote: { fontSize: 12, color: '#333', fontWeight: '500', marginBottom: 14, marginTop: -8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  rowLabel: { fontSize: 15, fontWeight: '600', color: '#ccc' },
  sourceGroup: { marginBottom: 16 },
  sourceMetricLabel: { fontSize: 13, fontWeight: '700', color: '#888', marginBottom: 8 },
  sourcePills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: '#2a2a2a' },
  pillActive: { backgroundColor: '#fff', borderColor: '#fff' },
  pillText: { fontSize: 13, fontWeight: '600', color: '#555' },
  pillTextActive: { color: '#000' },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function RecoveryScreen() {
  const health = useHealthKit();
  const [data, setData] = useState<RecoveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [noData, setNoData] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [showCustomize, setShowCustomize] = useState(false);
  const [visibleMetrics, setVisibleMetrics] = useState<string[]>(DEFAULT_VISIBLE);
  const [sourcePrefs, setSourcePrefs] = useState<Record<string, string>>({});
  const [availableSources, setAvailableSources] = useState<Record<string, string[]>>({});
  const [trainingLoad, setTrainingLoad] = useState<WeeklyTrainingLoad | null>(null);

  // Load persisted prefs on mount
  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_SOURCE_PREFS, STORAGE_VISIBLE_METRICS]).then(pairs => {
      const [srcRaw, visRaw] = pairs;
      if (srcRaw[1]) setSourcePrefs(JSON.parse(srcRaw[1]));
      if (visRaw[1]) setVisibleMetrics(JSON.parse(visRaw[1]));
    });
  }, []);

  const loadRef = useRef<((prefs?: Record<string, string>, silent?: boolean) => Promise<void>) | null>(null);
  const isInitialLoad = useRef(true);

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
    const [result, load_] = await Promise.all([
      health.getRecoveryData(prefs ?? sourcePrefs),
      health.getWeeklyTrainingLoad(),
    ]);
    setData(result);
    setTrainingLoad(load_);
    // Authorized but every core metric is empty? initHealthKit can't tell
    // "read denied" from "no data" (H2), so probe a 30-day window. If nothing
    // comes back, the per-category toggles are almost certainly off.
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
    // Fetch available sources in background for customize sheet
    health.getAvailableSources().then(setAvailableSources);
  }, [health.isAuthorized, sourcePrefs]);

  // Keep ref current so interval/AppState handler always uses latest version
  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => { load(); }, []);

  // Live polling — silent refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => { loadRef.current?.(undefined, true); }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Silent refresh when app comes back to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') loadRef.current?.(undefined, true);
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

  const score = data ? calcScore(data) : null;
  const color = scoreColor(score);

  const fmtSleep = (h: number | null) => {
    if (h === null) return null;
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    return `${hrs}h ${mins}m`;
  };

  if (unavailable) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <Text style={s.title}>Recovery</Text>
        </View>
        <View style={s.center}>
          <Text style={s.emptyIcon}>❤️</Text>
          <Text style={s.emptyTitle}>Apple Health Not Available</Text>
          <Text style={s.emptySub}>Recovery data requires an iOS device with Apple Health.</Text>
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

  if (noData) {
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

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={s.loadingText}>Reading Apple Health…</Text>
        </View>
      ) : !data ? (
        <View style={s.center}>
          <Text style={s.emptyIcon}>❤️</Text>
          <Text style={s.emptyTitle}>Connect Apple Health</Text>
          <Text style={s.emptySub}>Fuelog reads HRV, sleep, steps, and more from Apple Health. Your Whoop, Garmin, and Apple Watch data all sync here automatically.</Text>
          <TouchableOpacity style={s.connectBtn} onPress={() => load()}>
            <Text style={s.connectBtnText}>Connect Apple Health</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

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
            ❤️ From Apple Health · Whoop, Garmin & Apple Watch sync automatically
          </Text>

          {/* HRV + RHR row */}
          {(isVisible('hrv') || isVisible('rhr')) && (
            <View style={s.row}>
              {isVisible('hrv') && (
                <StatCard
                  label="HRV"
                  value={data.hrv !== null ? String(data.hrv) : null}
                  unit="ms"
                  sub="Heart rate variability"
                  color="#a78bfa"
                  trendData={data.hrvTrend}
                  source={data.sources['hrv']}
                />
              )}
              {isVisible('rhr') && (
                <StatCard
                  label="Resting HR"
                  value={data.restingHR !== null ? String(data.restingHR) : null}
                  unit="bpm"
                  sub="Lower is better"
                  color="#4a9eff"
                  trendData={data.rhrTrend}
                  source={data.sources['rhr']}
                />
              )}
            </View>
          )}

          {/* Sleep */}
          {isVisible('sleep') && (
            <View style={s.sleepCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Text style={s.cardTitle}>SLEEP LAST NIGHT</Text>
                {data.sources['sleep'] ? <Text style={s.cardSource}>from {data.sources['sleep']}</Text> : null}
              </View>
              {data.sleepHours !== null ? (
                <>
                  <View style={s.sleepRow}>
                    <View style={s.sleepItem}>
                      <Text style={[s.sleepVal, { color: '#fff' }]}>{fmtSleep(data.sleepHours)}</Text>
                      <Text style={s.sleepItemLabel}>Total</Text>
                    </View>
                    {data.sleepDeepHours !== null && data.sleepDeepHours > 0 && (
                      <View style={s.sleepItem}>
                        <Text style={[s.sleepVal, { color: '#4a9eff' }]}>{fmtSleep(data.sleepDeepHours)}</Text>
                        <Text style={s.sleepItemLabel}>Deep</Text>
                      </View>
                    )}
                    {data.sleepRemHours !== null && data.sleepRemHours > 0 && (
                      <View style={s.sleepItem}>
                        <Text style={[s.sleepVal, { color: '#a78bfa' }]}>{fmtSleep(data.sleepRemHours)}</Text>
                        <Text style={s.sleepItemLabel}>REM</Text>
                      </View>
                    )}
                  </View>
                  <SleepBar total={data.sleepHours} deep={data.sleepDeepHours} rem={data.sleepRemHours} />
                  {data.sleepTrend.length >= 2 && (
                    <View style={{ marginTop: 12 }}>
                      <Text style={[s.cardTitle, { marginBottom: 6 }]}>7-DAY TREND</Text>
                      <WideChart data={data.sleepTrend} color="#4a9eff" />
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
                  {data.steps !== null ? (
                    <>
                      <View style={sc.valueRow}>
                        <Text style={[sc.value, { color: '#4ade80', fontSize: 22 }]}>
                          {data.steps.toLocaleString()}
                        </Text>
                      </View>
                      <StepsBar steps={data.steps} goal={10000} />
                      <Text style={sc.sub}>{Math.round((data.steps / 10000) * 100)}% of 10k goal</Text>
                      {data.sources['steps'] ? <Text style={sc.source}>from {data.sources['steps']}</Text> : null}
                      {data.stepsTrend.length >= 2 && (
                        <View style={{ marginTop: 8 }}>
                          <MiniChart data={data.stepsTrend} color="#4ade80" />
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
                  value={data.activeCalories !== null ? data.activeCalories.toLocaleString() : null}
                  unit="kcal"
                  sub="Burned today"
                  color="#fbbf24"
                  source={data.sources['activeCal']}
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
                  value={data.bloodOxygen !== null ? String(data.bloodOxygen) : null}
                  unit="%"
                  sub={data.bloodOxygen !== null ? (data.bloodOxygen >= 95 ? 'Normal range' : 'Below normal') : undefined}
                  color={data.bloodOxygen !== null && data.bloodOxygen < 95 ? '#ff4f4f' : '#4ade80'}
                  source={data.sources['bloodO2']}
                />
              )}
              {isVisible('respRate') && (
                <StatCard
                  label="Resp. Rate"
                  value={data.respiratoryRate !== null ? String(data.respiratoryRate) : null}
                  unit="br/min"
                  sub="Breaths per minute"
                  color="#f472b6"
                  source={data.sources['respRate']}
                />
              )}
            </View>
          )}

          {isVisible('vo2') && data.vo2Max !== null && (
            <View style={s.vo2Card}>
              <View>
                <Text style={s.cardTitle}>VO₂ MAX</Text>
                {data.sources['vo2'] ? <Text style={s.cardSource}>from {data.sources['vo2']}</Text> : null}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 6 }}>
                  <Text style={{ fontSize: 36, fontWeight: '900', color: '#4a9eff' }}>{data.vo2Max}</Text>
                  <Text style={{ fontSize: 14, color: '#555', fontWeight: '600' }}>mL/kg/min</Text>
                </View>
              </View>
              <View style={s.vo2Badge}>
                <Text style={s.vo2BadgeText}>{vo2Category(data.vo2Max)}</Text>
              </View>
            </View>
          )}

          {/* Training Load */}
          {trainingLoad && trainingLoad.dailyLoad.length > 0 && (
            <TrainingLoadCard load={trainingLoad} />
          )}

          {/* Recovery tips */}
          {score !== null && (
            <View style={s.tipsCard}>
              <Text style={s.cardTitle}>TODAY'S RECOMMENDATION</Text>
              <Text style={s.tipsText}>{recoveryTip(score, data, trainingLoad)}</Text>
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
    </SafeAreaView>
  );
}

// ─── Score Ring ────────────────────────────────────────────────────────────────
function ScoreRing({ score, color }: { score: number | null; color: string }) {
  const size = 90;
  const strokeWidth = 8;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = score !== null ? score / 100 : 0;
  const dashOffset = circumference * (1 - pct);

  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#222" strokeWidth={strokeWidth} />
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
  if (!total) return null;
  const maxHrs = 10;
  const totalPct = Math.min(100, (total / maxHrs) * 100);
  const deepPct = deep ? Math.min(100, (deep / maxHrs) * 100) : 0;
  const remPct = rem ? Math.min(100, (rem / maxHrs) * 100) : 0;
  const corePct = Math.max(0, totalPct - deepPct - remPct);

  return (
    <View style={{ marginTop: 12, marginBottom: 4 }}>
      <View style={{ height: 8, backgroundColor: '#222', borderRadius: 4, flexDirection: 'row', overflow: 'hidden', width: '100%' }}>
        <View style={{ width: `${corePct}%` as any, backgroundColor: '#4a9eff', opacity: 0.6 }} />
        <View style={{ width: `${deepPct}%` as any, backgroundColor: '#4a9eff' }} />
        <View style={{ width: `${remPct}%` as any, backgroundColor: '#a78bfa' }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#4a9eff', opacity: 0.6 }} />
          <Text style={{ fontSize: 10, color: '#444', fontWeight: '600' }}>Core</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#4a9eff' }} />
          <Text style={{ fontSize: 10, color: '#444', fontWeight: '600' }}>Deep</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#a78bfa' }} />
          <Text style={{ fontSize: 10, color: '#444', fontWeight: '600' }}>REM</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Steps Bar ─────────────────────────────────────────────────────────────────
function StepsBar({ steps, goal }: { steps: number; goal: number }) {
  const pct = Math.min(100, (steps / goal) * 100);
  return (
    <View style={{ marginTop: 8, marginBottom: 2 }}>
      <View style={{ height: 4, backgroundColor: '#222', borderRadius: 2 }}>
        <View style={{ height: 4, backgroundColor: '#4ade80', borderRadius: 2, width: `${pct}%` as any }} />
      </View>
    </View>
  );
}

// ─── Training Load Card ────────────────────────────────────────────────────────
function TrainingLoadCard({ load }: { load: WeeklyTrainingLoad }) {
  const loadLabel = load.totalMinutes > 300 ? 'High' : load.totalMinutes > 150 ? 'Moderate' : 'Low';
  const loadColor = load.totalMinutes > 300 ? '#ff4f4f' : load.totalMinutes > 150 ? '#fbbf24' : '#4ade80';
  const maxMin = Math.max(...load.dailyLoad.map(d => d.minutes), 1);
  const barW = Math.floor((width - 96) / 7);

  // Fill all 7 days (including days with no workouts)
  const days: { date: string; minutes: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
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

const tl = StyleSheet.create({
  card: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16 },
  label: { fontSize: 10, fontWeight: '700', color: '#444', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 2 },
  loadLabel: { fontSize: 18, fontWeight: '900' },
  stat: { fontSize: 22, fontWeight: '900', color: '#fff' },
  statUnit: { fontSize: 13, color: '#555', fontWeight: '600' },
  statSub: { fontSize: 11, color: '#444', fontWeight: '500', marginTop: 2 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 16, height: 60 },
  barCol: { alignItems: 'center', gap: 4 },
  barBg: { flex: 1, width: '70%', backgroundColor: '#222', borderRadius: 3, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: 3 },
  barLabel: { fontSize: 9, color: '#444', fontWeight: '600' },
});

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

// ─── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1e1e1e',
  },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1e1e1e', alignItems: 'center', justifyContent: 'center' },
  iconBtnText: { color: '#888', fontSize: 18, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  loadingText: { color: '#444', fontSize: 14, fontWeight: '500', marginTop: 12 },
  emptyIcon: { fontSize: 52, marginBottom: 8 },
  emptyTitle: { fontSize: 20, fontWeight: '900', color: '#fff', textAlign: 'center' },
  emptySub: { fontSize: 14, color: '#444', textAlign: 'center', lineHeight: 22, fontWeight: '500' },
  connectBtn: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14, marginTop: 8 },
  connectBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },
  errorBox: { backgroundColor: '#1a0000', borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: '#ff4f4f44', maxWidth: 300 },
  errorText: { color: '#ff6b6b', fontSize: 12, fontFamily: 'monospace', textAlign: 'left', lineHeight: 18 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 10 },
  scoreCard: {
    backgroundColor: '#1a1a1a', borderRadius: 20, padding: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5,
  },
  scoreLeft: { flex: 1 },
  scoreSmall: { fontSize: 10, fontWeight: '700', color: '#444', letterSpacing: 1.5, marginBottom: 4 },
  scoreNumber: { fontSize: 64, fontWeight: '900', letterSpacing: -2, lineHeight: 68 },
  scoreLabel: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  scoreRight: { marginLeft: 16 },
  sourceNote: { fontSize: 11, color: '#333', fontWeight: '500', textAlign: 'center', marginTop: -4 },
  row: { flexDirection: 'row', gap: 10 },
  cardTitle: { fontSize: 10, fontWeight: '700', color: '#444', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  cardSource: { fontSize: 10, color: '#333', fontWeight: '500' },
  sleepCard: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16 },
  sleepRow: { flexDirection: 'row', gap: 20, marginTop: 8 },
  sleepItem: { alignItems: 'flex-start' },
  sleepVal: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  sleepItemLabel: { fontSize: 10, color: '#444', fontWeight: '600', marginTop: 2 },
  noDataText: { fontSize: 13, color: '#333', fontWeight: '500', marginTop: 8, lineHeight: 20 },
  vo2Card: {
    backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  vo2Badge: { backgroundColor: '#4a9eff22', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#4a9eff44' },
  vo2BadgeText: { color: '#4a9eff', fontSize: 14, fontWeight: '800' },
  tipsCard: { backgroundColor: '#1a1a2a', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2a2a4a' },
  tipsText: { fontSize: 14, color: '#aaa', lineHeight: 22, fontWeight: '500', marginTop: 8 },
});
