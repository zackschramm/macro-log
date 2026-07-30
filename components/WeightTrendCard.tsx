import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Polyline, Circle, Line } from 'react-native-svg';
import { WeightTrend, describeTrend, explainDeviation } from '../utils/weightTrend';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';

const { width } = Dimensions.get('window');
const W = width - 64;
const H = 120;
const PAD_H = 8;
const PAD_V = 12;

/**
 * Weight trend card: raw weigh-ins as faint dots, the smoothed trend as the
 * solid line.
 *
 * Drawing both is the point. Users need to *see* that their scale bounces
 * around while the real line moves steadily — that's what stops the "I gained
 * 2 lbs overnight, this isn't working" spiral. Showing only the smooth line
 * would look like the app was hiding data.
 */
export default function WeightTrendCard({
  trend, unit = 'lbs',
}: { trend: WeightTrend; unit?: string }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  if (trend.points.length < 2) {
    return (
      <View style={s.card}>
        <Text style={s.title}>WEIGHT TREND</Text>
        <Text style={s.empty}>{describeTrend(trend, unit)}</Text>
      </View>
    );
  }

  const pts = trend.points;
  const t0 = new Date(pts[0].date + 'T12:00:00').getTime();
  const tN = new Date(pts[pts.length - 1].date + 'T12:00:00').getTime();
  const span = tN - t0 || 1;

  const all = [...pts.map(p => p.raw), ...pts.map(p => p.trend)];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;

  const chartW = W - PAD_H * 2;
  const chartH = H - PAD_V * 2;
  // x is time-proportional, not index-proportional — a 3-week gap should look
  // like a gap, otherwise sporadic logging reads as a steady line.
  const toX = (d: string) =>
    PAD_H + ((new Date(d + 'T12:00:00').getTime() - t0) / span) * chartW;
  const toY = (v: number) => PAD_V + chartH - ((v - min) / range) * chartH;

  const trendLine = pts.map(p => `${toX(p.date)},${toY(p.trend)}`).join(' ');

  const losing = trend.direction === 'losing';
  const holding = trend.direction === 'holding';
  const lineColor = holding ? colors.textSecondary : losing ? colors.accent : colors.warning;

  const deviationNote = explainDeviation(trend, unit);

  return (
    <View style={s.card}>
      <Text style={s.title}>WEIGHT TREND</Text>

      <View style={s.headline}>
        <Text style={s.current}>
          {trend.current?.toFixed(1)}
          <Text style={s.unit}> {unit}</Text>
        </Text>
        <Text style={[s.summary, { color: lineColor }]}>{describeTrend(trend, unit)}</Text>
      </View>

      {/* An SVG is invisible to VoiceOver — without this the whole chart is a
          silent gap. The summary carries the same information the line does. */}
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={
          `Weight trend chart. ${describeTrend(trend, unit)}. ` +
          `Current trend weight ${trend.current?.toFixed(1)} ${unit}. ` +
          `${pts.length} weigh-ins over ${trend.daysTracked} days.`
        }
      >
      <Svg width={W} height={H}>
        {[0, 0.5, 1].map((t, i) => (
          <Line
            key={i}
            x1={PAD_H} y1={PAD_V + chartH * (1 - t)}
            x2={PAD_H + chartW} y2={PAD_V + chartH * (1 - t)}
            stroke={colors.border} strokeWidth="1"
          />
        ))}

        {/* Raw readings — deliberately faint; they're context, not the story */}
        {pts.map((p, i) => (
          <Circle
            key={i} cx={toX(p.date)} cy={toY(p.raw)} r="2"
            fill={colors.textTertiary} opacity={0.55}
          />
        ))}

        <Polyline
          points={trendLine} fill="none" stroke={lineColor}
          strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
        />
        <Circle
          cx={toX(pts[pts.length - 1].date)} cy={toY(pts[pts.length - 1].trend)}
          r="4" fill={lineColor}
        />
      </Svg>
      </View>

      <View style={s.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={s.legendItem}>
          <View style={[s.dot, { backgroundColor: colors.textTertiary, opacity: 0.55 }]} />
          <Text style={s.legendText}>Daily weigh-ins</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.dash, { backgroundColor: lineColor }]} />
          <Text style={s.legendText}>Trend</Text>
        </View>
      </View>

      {deviationNote && <Text style={s.note}>{deviationNote}</Text>}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg,
    marginBottom: 12, borderWidth: 1, borderColor: c.border,
  },
  title: {
    fontSize: 11, fontWeight: weight.bold, color: c.textTertiary,
    letterSpacing: 1.5, marginBottom: 2,
  },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: 4 },
  current: { fontSize: 26, fontWeight: weight.bold, color: c.text },
  unit: { fontSize: 13, fontWeight: weight.medium, color: c.textSecondary },
  summary: { fontSize: 12, fontWeight: weight.semibold, flex: 1 },
  empty: { color: c.textTertiary, fontSize: 12, paddingVertical: 12, textAlign: 'center' },

  legend: { flexDirection: 'row', gap: spacing.lg, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  dash: { width: 12, height: 2.5, borderRadius: 2 },
  legendText: { fontSize: 10, color: c.textTertiary },

  note: {
    marginTop: spacing.sm, fontSize: 11, lineHeight: 16,
    color: c.textSecondary, backgroundColor: c.bgSecondary,
    padding: spacing.sm, borderRadius: radius.sm,
  },
});
