import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import { supabase } from '../constants/supabase';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { useUnits } from '../constants/units';
import { toLocalDateString } from '../utils/dateUtils';

const { width } = Dimensions.get('window');
const CHART_WIDTH = width - 64;
const CHART_HEIGHT = 120;

const fmtShort = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const fmtFull = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

interface HistoryRow {
  date: string;
  sets: { weight: string; reps: string; done: boolean }[];
  bestWeight: number;
  bestReps: string;
  setCount: number;
  isPR: boolean;
}

function ExerciseLineChart({ data }: { data: { date: string; value: number }[] }) {
  const { colors } = useTheme();

  if (data.length < 2) {
    return (
      <Text style={{ color: colors.textTertiary, fontSize: 12, textAlign: 'center', paddingVertical: 20 }}>
        Complete more sessions to see your trend
      </Text>
    );
  }

  const pts = data;
  const values = pts.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padH = 28;
  const padV = 16;
  const chartW = CHART_WIDTH - padH * 2;
  const chartH = CHART_HEIGHT - padV * 2;

  const toX = (i: number) => padH + (i / (pts.length - 1)) * chartW;
  const toY = (v: number) => padV + chartH - ((v - min) / range) * chartH;
  const points = pts.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  const last = values[values.length - 1];

  return (
    <View style={{ marginTop: 8 }}>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
        {[0, 0.5, 1].map((t, i) => (
          <Line key={i} x1={padH} y1={padV + chartH * (1 - t)} x2={padH + chartW} y2={padV + chartH * (1 - t)}
            stroke={colors.border} strokeWidth="1" />
        ))}
        <Polyline points={points} fill="none" stroke={colors.accent} strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((d, i) => (
          <Circle key={i} cx={toX(i)} cy={toY(d.value)} r="3.5" fill={colors.accent} />
        ))}
        {[0, pts.length - 1].map(i => (
          <SvgText key={i} x={toX(i)} y={CHART_HEIGHT - 2} textAnchor="middle"
            fill={colors.textTertiary} fontSize="9" fontWeight="600">
            {fmtShort(pts[i].date)}
          </SvgText>
        ))}
        <SvgText x={padH} y={toY(values[0]) - 6} textAnchor="middle"
          fill={colors.textTertiary} fontSize="9">{values[0].toFixed(0)}</SvgText>
        <SvgText x={toX(pts.length - 1)} y={toY(last) - 6} textAnchor="middle"
          fill={colors.accent} fontSize="10" fontWeight="700">{last.toFixed(0)}</SvgText>
      </Svg>
    </View>
  );
}

interface Props {
  visible: boolean;
  exercise: { id: string; name: string } | null;
  userId: string | undefined;
  onClose: () => void;
}

export default function ExerciseHistoryModal({ visible, exercise, userId, onClose }: Props) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const u = useUnits();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [prWeight, setPrWeight] = useState(0);
  const [prReps, setPrReps] = useState('');
  const [chartData, setChartData] = useState<{ date: string; value: number }[]>([]);

  useEffect(() => {
    if (!visible || !exercise || !userId) return;
    setLoading(true);
    setRows([]);
    setPrWeight(0);
    setPrReps('');
    setChartData([]);

    (async () => {
      const { data } = await supabase
        .from('workout_logs')
        .select('date, sets, exercise_name')
        .eq('user_id', userId)
        .eq('exercise_id', exercise.id)
        .eq('done', true)
        .order('date', { ascending: false })
        .limit(30);

      if (!data || data.length === 0) {
        setLoading(false);
        return;
      }

      let globalPRWeight = 0;
      let globalPRReps = '';

      // First pass: find overall PR weight
      for (const row of data) {
        for (const set of (row.sets || [])) {
          const w = parseFloat(set.weight);
          if (!isNaN(w) && w > globalPRWeight) {
            globalPRWeight = w;
            globalPRReps = set.reps || '';
          }
        }
      }

      // Second pass: build history rows
      const historyRows: HistoryRow[] = data.map(row => {
        const sets: { weight: string; reps: string; done: boolean }[] = row.sets || [];
        let bestW = 0;
        let bestR = '';
        for (const set of sets) {
          const w = parseFloat(set.weight);
          if (!isNaN(w) && w > bestW) {
            bestW = w;
            bestR = set.reps || '';
          }
        }
        return {
          date: row.date,
          sets,
          bestWeight: bestW,
          bestReps: bestR,
          setCount: sets.length,
          isPR: bestW === globalPRWeight && bestW > 0,
        };
      });

      // Chart data: ascending by date, max weight per session, past 8 weeks only
      const eightWeeksAgo = toLocalDateString(new Date(Date.now() - 56 * 86400000));
      const chartPts = [...historyRows]
        .reverse()
        .filter(r => r.bestWeight > 0 && r.date >= eightWeeksAgo)
        .map(r => ({ date: r.date, value: r.bestWeight }));

      setPrWeight(globalPRWeight);
      setPrReps(globalPRReps);
      setRows(historyRows);
      setChartData(chartPts);
      setLoading(false);
    })();
  }, [visible, exercise?.id, userId]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <View style={s.headerLeft} />
          <Text style={s.headerTitle} numberOfLines={1}>{exercise?.name ?? ''}</Text>
          <TouchableOpacity style={s.doneBtn} onPress={onClose}>
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 60 }} color={colors.accent} />
        ) : rows.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>📊</Text>
            <Text style={s.emptyTitle}>No history yet</Text>
            <Text style={s.emptySub}>Complete some sets to see your progress here.</Text>
          </View>
        ) : (
          <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            {/* PR banner */}
            {prWeight > 0 && (
              <View style={s.prBanner}>
                <Text style={s.prBannerText}>🏆 Best: {prWeight} {u.weightUnit} × {prReps} reps</Text>
              </View>
            )}

            {/* Chart */}
            <View style={s.chartCard}>
              <Text style={s.sectionLabel}>WEIGHT — LAST 8 WEEKS</Text>
              <ExerciseLineChart data={chartData} />
            </View>

            {/* History list */}
            <Text style={s.sectionLabel}>SESSION HISTORY</Text>
            {rows.map((row, i) => (
              <View key={i} style={s.historyRow}>
                <View style={s.historyLeft}>
                  <Text style={s.historyDate}>{fmtFull(row.date)}</Text>
                  <Text style={s.historyDetail}>
                    {row.setCount} set{row.setCount !== 1 ? 's' : ''}
                    {row.bestWeight > 0 ? ` · best: ${row.bestWeight} ${u.weightUnit} × ${row.bestReps} reps` : ''}
                  </Text>
                </View>
                {row.isPR && <Text style={s.prBadge}>🏆</Text>}
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    headerLeft: { width: 60 },
    headerTitle: { flex: 1, fontSize: 17, fontWeight: weight.heavy, color: c.text, textAlign: 'center' },
    doneBtn: {
      backgroundColor: c.accent,
      borderRadius: radius.pill,
      paddingHorizontal: 16,
      paddingVertical: 8,
      width: 60,
      alignItems: 'center',
    },
    doneBtnText: { color: c.accentText, fontSize: 14, fontWeight: weight.heavy },
    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: 40 },
    prBanner: {
      backgroundColor: c.accentMuted,
      borderRadius: radius.md,
      padding: 14,
      marginBottom: 16,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.accent + '44',
    },
    prBannerText: { color: c.accent, fontSize: 16, fontWeight: weight.heavy },
    chartCard: {
      backgroundColor: c.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      marginBottom: 24,
      borderWidth: 1,
      borderColor: c.border,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: weight.semibold,
      color: c.textSecondary,
      letterSpacing: 1.5,
      marginBottom: 12,
    },
    historyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.card,
      borderRadius: radius.md,
      padding: 14,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: c.border,
    },
    historyLeft: { flex: 1 },
    historyDate: { fontSize: 14, fontWeight: weight.medium, color: c.text, marginBottom: 2 },
    historyDetail: { fontSize: 12, color: c.textSecondary },
    prBadge: { fontSize: 20, marginLeft: 8 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 8 },
    emptyIcon: { fontSize: 40 },
    emptyTitle: { fontSize: 17, fontWeight: weight.bold, color: c.text },
    emptySub: { fontSize: 13, color: c.textTertiary, textAlign: 'center', lineHeight: 20, paddingHorizontal: 32 },
  });
}
