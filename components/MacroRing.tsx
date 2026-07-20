import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { MC } from '../constants/data';
import { useTheme } from '../constants/theme';

type MacroKey = 'protein' | 'carbs' | 'fat';

export default function MacroRing({
  macroKey, value, target, label, unit = 'g', size = 72,
}: {
  macroKey: MacroKey; value: number; target: number; label: string; unit?: string; size?: number;
}) {
  const { colors } = useTheme();
  const R = size * 0.39;
  const CIRC = 2 * Math.PI * R;
  const strokeW = size < 70 ? 5 : 6;

  const pct = Math.min(1, value / (target || 1));
  const offset = CIRC - pct * CIRC;
  const color = MC[macroKey].color;
  const remain = Math.max(0, Math.round(target - value));

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.ringWrap, { width: size, height: size }]}>
        <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke={colors.border} strokeWidth={strokeW} />
          <Circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke={color} strokeWidth={strokeW}
            strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={offset} />
        </Svg>
        <View style={styles.center}>
          <Text style={[styles.val, { color }]}>{Math.round(value)}</Text>
          <Text style={[styles.unit, { color: colors.textTertiary }]}>{unit}</Text>
        </View>
      </View>
      <Text style={[styles.label, { color }]}>{label}</Text>
      <Text style={[styles.remain, { color: colors.textTertiary }]}>{remain}{unit} left</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, borderRadius: 16, borderWidth: 1, padding: 14, alignItems: 'center', gap: 6 },
  ringWrap: { alignItems: 'center', justifyContent: 'center' },
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  val: { fontSize: 15, fontWeight: '700', lineHeight: 18 },
  unit: { fontSize: 9, fontWeight: '600' },
  label: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  remain: { fontSize: 10, fontWeight: '500' },
});
