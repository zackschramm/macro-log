import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { MC } from '../constants/data';

type MacroKey = 'protein' | 'carbs' | 'fat';
const R = 28;
const CIRC = 2 * Math.PI * R;

export default function MacroRing({ macroKey, value, target, label, unit = 'g' }: {
  macroKey: MacroKey; value: number; target: number; label: string; unit?: string;
}) {
  const pct = Math.min(1, value / (target || 1));
  const offset = CIRC - pct * CIRC;
  const color = MC[macroKey].color;
  const remain = Math.max(0, Math.round(target - value));

  return (
    <View style={styles.card}>
      <View style={styles.ringWrap}>
        <Svg width={72} height={72} style={{ transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={36} cy={36} r={R} fill="none" stroke="#2a2a2a" strokeWidth={6} />
          <Circle cx={36} cy={36} r={R} fill="none" stroke={color} strokeWidth={6}
            strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={offset} />
        </Svg>
        <View style={styles.center}>
          <Text style={[styles.val, { color }]}>{Math.round(value)}</Text>
          <Text style={styles.unit}>{unit}</Text>
        </View>
      </View>
      <Text style={[styles.label, { color }]}>{label}</Text>
      <Text style={styles.remain}>{remain}{unit} left</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 16, padding: 14, alignItems: 'center', gap: 8 },
  ringWrap: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  val: { fontSize: 15, fontWeight: '800', lineHeight: 18 },
  unit: { fontSize: 9, color: '#555', fontWeight: '600' },
  label: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  remain: { fontSize: 10, color: '#444', fontWeight: '500' },
});
