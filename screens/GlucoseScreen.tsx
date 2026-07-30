import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Dimensions, SafeAreaView,
} from 'react-native';
import Svg, { Polyline, Line, Rect, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../constants/supabase';
import { callAI } from '../constants/ai';
import { useTheme, spacing, radius, weight } from '../constants/theme';
import { logError } from '../utils/logError';
import { useAIGate } from '../hooks/useAIGate';

const { width } = Dimensions.get('window');
const CHART_W = width - 40;
const CHART_H = 180;
const PAD_L = 36;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 24;
const GLUCOSE_MIN = 40;
const GLUCOSE_MAX = 300;
const SUPABASE_URL = 'https://zbcxuffgmjuqarapfdwb.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQ4NjIsImV4cCI6MjA4NzQwMDg2Mn0.lUng1tY_aAuee_t8-E5MSUHdm2PF3HzsE41L-kzBmJE';

type GlucoseReading = {
  systemTime: string;
  displayTime: string;
  value: number;
  trend: string;
  trendRate: number;
};

type GlucoseStats = {
  average: number;
  timeInRange: number;
  timeAboveRange: number;
  timeBelowRange: number;
  high: number;
  low: number;
};

async function callCgmProxy(body: object) {
  const { data: { session } } = await supabase.auth.getSession();
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

function trendArrow(trend: string): string {
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

function toX(systemTime: string, startMs: number, endMs: number): number {
  const t = new Date(systemTime).getTime();
  const frac = (t - startMs) / (endMs - startMs);
  return PAD_L + frac * (CHART_W - PAD_L - PAD_R);
}

function toY(value: number): number {
  const clamped = Math.min(GLUCOSE_MAX, Math.max(GLUCOSE_MIN, value));
  const frac = (clamped - GLUCOSE_MIN) / (GLUCOSE_MAX - GLUCOSE_MIN);
  return PAD_T + (1 - frac) * (CHART_H - PAD_T - PAD_B);
}

function yForValue(v: number): number {
  return toY(v);
}

export default function GlucoseScreen({ onClose }: { onClose: () => void }) {
  const { requestAccess, paywall } = useAIGate();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [readings, setReadings] = useState<GlucoseReading[]>([]);
  const [stats, setStats] = useState<GlucoseStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAI, setShowAI] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await callCgmProxy({ action: 'readings' });
      if (resp.data?.readings) setReadings(resp.data.readings);
      if (resp.data?.stats) setStats(resp.data.stats);
    } catch (e) { logError('GlucoseScreen.GlucoseScreen', e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAIExplain = async () => {
  // Pro gate: consumes one free trial use, then paywalls.
  if (!(await requestAccess('glucose_insight'))) return;
    if (!stats) return;
    setAiLoading(true);
    setShowAI(true);
    try {
      const result = await callAI([{
        role: 'user',
        content: `My CGM shows these stats for the last 24 hours: average ${stats.average} mg/dL, time in range (70-180) ${stats.timeInRange}%, time above range ${stats.timeAboveRange}%, time below range ${stats.timeBelowRange}%, high ${stats.high} mg/dL, low ${stats.low} mg/dL. What does this mean for my health and nutrition today? Keep the explanation brief and practical.`,
      }]);
      setAiExplanation(result);
    } catch {
      setAiExplanation('Unable to generate explanation. Please try again.');
    }
    setAiLoading(false);
  };

  const lastReading = readings[readings.length - 1] ?? null;
  const startMs = readings.length > 0 ? new Date(readings[0].systemTime).getTime() : Date.now() - 86400000;
  const endMs = readings.length > 0 ? new Date(readings[readings.length - 1].systemTime).getTime() : Date.now();

  const tirColor = stats
    ? stats.timeInRange >= 70 ? '#C8FF3D'
    : stats.timeInRange >= 50 ? '#F5A623'
    : '#FF4444'
    : colors.textTertiary;

  return (
    <>
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Text style={s.title}>Glucose</Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.text} size="large" />
          <Text style={s.loadingText}>Loading glucose data…</Text>
        </View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* Current reading */}
          {lastReading && (
            <View style={s.currentCard}>
              <View>
                <Text style={s.sectionLabel}>CURRENT</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
                  <Text style={s.bigNumber}>{lastReading.value}</Text>
                  <Text style={s.unit}>mg/dL</Text>
                  <Text style={s.trendArrow}>{trendArrow(lastReading.trend)}</Text>
                </View>
              </View>
              {stats && (
                <View style={[s.tirPill, { borderColor: tirColor, backgroundColor: `${tirColor}18` }]}>
                  <Text style={[s.tirText, { color: tirColor }]}>{stats.timeInRange}% TIR</Text>
                </View>
              )}
            </View>
          )}

          {/* 24h chart */}
          {readings.length > 1 && (
            <View style={s.chartCard}>
              <Text style={s.sectionLabel}>LAST 24 HOURS</Text>
              <Svg width={CHART_W} height={CHART_H} style={{ marginTop: 8 }}>
                {/* Zone bands */}
                <Rect
                  x={PAD_L} y={PAD_T}
                  width={CHART_W - PAD_L - PAD_R}
                  height={yForValue(180) - PAD_T}
                  fill="#F5A62318"
                />
                <Rect
                  x={PAD_L} y={yForValue(180)}
                  width={CHART_W - PAD_L - PAD_R}
                  height={yForValue(70) - yForValue(180)}
                  fill="#C8FF3D18"
                />
                <Rect
                  x={PAD_L} y={yForValue(70)}
                  width={CHART_W - PAD_L - PAD_R}
                  height={CHART_H - PAD_B - yForValue(70)}
                  fill="#FF444418"
                />

                {/* Reference lines */}
                <Line
                  x1={PAD_L} y1={yForValue(180)}
                  x2={CHART_W - PAD_R} y2={yForValue(180)}
                  stroke="#F5A623" strokeWidth="1" strokeDasharray="4,3"
                />
                <Line
                  x1={PAD_L} y1={yForValue(70)}
                  x2={CHART_W - PAD_R} y2={yForValue(70)}
                  stroke="#FF4444" strokeWidth="1" strokeDasharray="4,3"
                />

                {/* Y-axis labels */}
                <SvgText x={PAD_L - 4} y={yForValue(180) + 4} textAnchor="end" fill="#F5A623" fontSize="9" fontWeight="600">180</SvgText>
                <SvgText x={PAD_L - 4} y={yForValue(70) + 4} textAnchor="end" fill="#FF4444" fontSize="9" fontWeight="600">70</SvgText>

                {/* Readings polyline */}
                <Polyline
                  points={readings.map(r => `${toX(r.systemTime, startMs, endMs)},${toY(r.value)}`).join(' ')}
                  fill="none"
                  stroke="#C8FF3D"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />

                {/* X-axis time labels */}
                <SvgText x={PAD_L} y={CHART_H - 4} textAnchor="middle" fill={colors.textTertiary} fontSize="9">
                  {new Date(startMs).getHours()}:00
                </SvgText>
                <SvgText x={CHART_W - PAD_R} y={CHART_H - 4} textAnchor="middle" fill={colors.textTertiary} fontSize="9">
                  {new Date(endMs).getHours()}:00
                </SvgText>
              </Svg>
              <View style={s.legendRow}>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: '#FF4444' }]} />
                  <Text style={s.legendText}>Low (&lt;70)</Text>
                </View>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: '#C8FF3D' }]} />
                  <Text style={s.legendText}>In Range</Text>
                </View>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: '#F5A623' }]} />
                  <Text style={s.legendText}>High (&gt;180)</Text>
                </View>
              </View>
            </View>
          )}

          {/* Stats row */}
          {stats && (
            <View style={s.statsRow}>
              <View style={s.statCard}>
                <Text style={[s.statValue, { color: tirColor }]}>{stats.timeInRange}%</Text>
                <Text style={s.statLabel}>Time in Range</Text>
              </View>
              <View style={s.statCard}>
                <Text style={s.statValue}>{stats.average}</Text>
                <Text style={s.statLabel}>Average mg/dL</Text>
              </View>
              <View style={s.statCard}>
                <Text style={[s.statValue, { color: '#F5A623' }]}>{stats.high}</Text>
                <Text style={s.statLabel}>High</Text>
              </View>
              <View style={s.statCard}>
                <Text style={[s.statValue, { color: '#FF4444' }]}>{stats.low}</Text>
                <Text style={s.statLabel}>Low</Text>
              </View>
            </View>
          )}

          {/* Time breakdown */}
          {stats && (
            <View style={s.breakdownCard}>
              <Text style={s.sectionLabel}>TIME BREAKDOWN</Text>
              <View style={{ gap: 8, marginTop: 10 }}>
                {[
                  { label: 'Below 70 mg/dL', value: stats.timeBelowRange, color: '#FF4444' },
                  { label: '70–180 mg/dL (target)', value: stats.timeInRange, color: '#C8FF3D' },
                  { label: 'Above 180 mg/dL', value: stats.timeAboveRange, color: '#F5A623' },
                ].map(item => (
                  <View key={item.label}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={s.breakdownLabel}>{item.label}</Text>
                      <Text style={[s.breakdownPct, { color: item.color }]}>{item.value}%</Text>
                    </View>
                    <View style={s.barBg}>
                      <View style={[s.barFill, { width: `${item.value}%`, backgroundColor: item.color }]} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* AI Explain */}
          {stats && (
            <TouchableOpacity
              style={s.aiBtn}
              onPress={handleAIExplain}
              activeOpacity={0.8}
              disabled={aiLoading}
            >
              <Text style={s.aiBtnText}>
                {aiLoading ? 'Analyzing…' : showAI && aiExplanation ? 'Refresh AI Explanation' : '✨ What does this mean?'}
              </Text>
            </TouchableOpacity>
          )}

          {showAI && (
            <View style={s.aiCard}>
              {aiLoading ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={s.aiText}>{aiExplanation}</Text>
              )}
            </View>
          )}

        </ScrollView>
      )}
    </SafeAreaView>
      {paywall}
    </>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: { fontSize: 22, fontWeight: weight.bold, color: colors.text },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
    loadingText: { fontSize: 14, color: colors.textTertiary },
    scroll: { flex: 1 },
    content: { padding: 20, gap: 16 },
    sectionLabel: {
      fontSize: 10,
      fontWeight: weight.bold,
      color: colors.textTertiary,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },
    currentCard: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    bigNumber: { fontSize: 48, fontWeight: weight.heavy, color: colors.text, lineHeight: 52 },
    unit: { fontSize: 16, color: colors.textTertiary, fontWeight: weight.semibold },
    trendArrow: { fontSize: 28 },
    tirPill: {
      borderRadius: radius.pill,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderWidth: 1.5,
    },
    tirText: { fontSize: 15, fontWeight: weight.heavy },
    chartCard: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 10 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { fontSize: 11, color: colors.textTertiary },
    statsRow: { flexDirection: 'row', gap: 10 },
    statCard: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    statValue: { fontSize: 22, fontWeight: weight.heavy, color: colors.text },
    statLabel: { fontSize: 10, color: colors.textTertiary, textAlign: 'center', marginTop: 3 },
    breakdownCard: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    breakdownLabel: { fontSize: 13, color: colors.textSecondary },
    breakdownPct: { fontSize: 13, fontWeight: weight.bold },
    barBg: { height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
    barFill: { height: 6, borderRadius: 3 },
    aiBtn: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.accent,
      alignItems: 'center',
    },
    aiBtnText: { fontSize: 15, fontWeight: weight.semibold, color: colors.accent },
    aiCard: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    aiText: { fontSize: 14, color: colors.text, lineHeight: 22 },
  });
}
