import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, SafeAreaView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';

const STORAGE_KEY = 'fuelog_plate_unit';

type Unit = 'lbs' | 'kg';

const LBS_PLATES = [45, 35, 25, 10, 5, 2.5];
const KG_PLATES  = [20, 15, 10,  5, 2.5, 1.25];

const PLATE_COLORS: Record<number, string> = {
  // lbs
  45: '#EF4444',
  35: '#3B82F6',
  25: '#22C55E',
  10: '#6B7280',
  5:  '#FCA5A5',
  2.5:'#D1D5DB',
  // kg (reuse same colors by matching index)
  20: '#EF4444',
  15: '#3B82F6',
  // 10 already defined above
  // 5 already defined above
  // 2.5 already defined above
  1.25: '#9CA3AF',
};

// Height in px per plate, proportional to weight
function plateHeight(size: number, unit: Unit): number {
  const maxSize = unit === 'lbs' ? 45 : 20;
  const minH = 22;
  const maxH = 70;
  return Math.round(minH + (size / maxSize) * (maxH - minH));
}

function plateColor(size: number, unit: Unit, idx: number): string {
  const palette = ['#EF4444', '#3B82F6', '#22C55E', '#6B7280', '#FCA5A5', '#D1D5DB'];
  return palette[idx] ?? '#888';
}

interface PlateResult {
  size: number;
  count: number;
}

function calcPlates(targetStr: string, barStr: string, unit: Unit): PlateResult[] | null {
  const target = parseFloat(targetStr);
  const bar = parseFloat(barStr);
  if (isNaN(target) || isNaN(bar) || target <= bar) return null;

  const plates = unit === 'lbs' ? LBS_PLATES : KG_PLATES;
  let remaining = (target - bar) / 2;
  const result: PlateResult[] = [];

  for (const size of plates) {
    if (remaining <= 0) break;
    const count = Math.floor(remaining / size);
    if (count > 0) {
      result.push({ size, count });
      remaining = Math.round((remaining - count * size) * 1000) / 1000;
    }
  }

  return result;
}

export default function PlateCalculatorScreen() {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [unit, setUnit] = useState<Unit>('lbs');
  const [targetWeight, setTargetWeight] = useState('');
  const [barWeight, setBarWeight] = useState('45');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      if (val === 'kg' || val === 'lbs') {
        setUnit(val);
        setBarWeight(val === 'kg' ? '20' : '45');
      }
    });
  }, []);

  const switchUnit = async (u: Unit) => {
    setUnit(u);
    setBarWeight(u === 'kg' ? '20' : '45');
    setTargetWeight('');
    await AsyncStorage.setItem(STORAGE_KEY, u);
  };

  const plates = targetWeight ? calcPlates(targetWeight, barWeight, unit) : null;

  const perSideLabel = () => {
    if (!plates) return null;
    const total = parseFloat(targetWeight);
    const bar = parseFloat(barWeight);
    if (isNaN(total) || isNaN(bar)) return null;
    const perSide = (total - bar) / 2;
    return `${perSide % 1 === 0 ? perSide : perSide.toFixed(2)} ${unit} per side`;
  };

  const plateListText = () => {
    if (!plates || plates.length === 0) return null;
    return plates.map(p => `${p.count}× ${p.size} ${unit}`).join(', ');
  };

  const platesSizes = unit === 'lbs' ? LBS_PLATES : KG_PLATES;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Text style={s.title}>Plate Calculator</Text>
        <View style={s.unitToggle}>
          {(['lbs', 'kg'] as Unit[]).map(u => (
            <TouchableOpacity
              key={u}
              style={[s.unitBtn, unit === u && s.unitBtnActive]}
              onPress={() => switchUnit(u)}
            >
              <Text style={[s.unitBtnText, unit === u && s.unitBtnTextActive]}>{u}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

        {/* Inputs */}
        <View style={s.inputsRow}>
          <View style={s.inputGroup}>
            <Text style={s.inputLabel}>Target Weight ({unit})</Text>
            <TextInput
              style={s.input}
              value={targetWeight}
              onChangeText={setTargetWeight}
              keyboardType="decimal-pad"
              placeholder={unit === 'lbs' ? '225' : '100'}
              placeholderTextColor={colors.textTertiary}
            />
          </View>
          <View style={s.inputGroup}>
            <Text style={s.inputLabel}>Bar Weight ({unit})</Text>
            <TextInput
              style={s.input}
              value={barWeight}
              onChangeText={setBarWeight}
              keyboardType="decimal-pad"
              placeholder={unit === 'lbs' ? '45' : '20'}
              placeholderTextColor={colors.textTertiary}
            />
          </View>
        </View>

        {/* Result */}
        {plates !== null && (
          <>
            {plates.length === 0 ? (
              <View style={s.emptyResult}>
                <Text style={s.emptyResultText}>No plates needed — just the bar!</Text>
              </View>
            ) : (
              <>
                {/* Per-side label */}
                <Text style={s.perSideLabel}>{perSideLabel()}</Text>

                {/* Visual barbell */}
                <View style={s.barbellWrap}>
                  {/* Bar sleeve */}
                  <View style={s.barSleeve} />
                  {/* Plates: stack from collar outward */}
                  <View style={s.platesStack}>
                    {plates.map((p, pi) =>
                      Array.from({ length: p.count }).map((_, ci) => (
                        <View
                          key={`${pi}-${ci}`}
                          style={[
                            s.plate,
                            {
                              height: plateHeight(p.size, unit),
                              backgroundColor: plateColor(p.size, unit, platesSizes.indexOf(p.size)),
                            },
                          ]}
                        />
                      ))
                    )}
                    {/* Collar */}
                    <View style={s.collar} />
                  </View>
                </View>

                {/* Text list */}
                <View style={s.textResultCard}>
                  <Text style={s.textResultTitle}>PER SIDE</Text>
                  <Text style={s.textResultList}>{plateListText()}</Text>
                </View>

                {/* Legend */}
                <View style={s.legendCard}>
                  <Text style={s.legendTitle}>PLATE LEGEND</Text>
                  <View style={s.legendGrid}>
                    {platesSizes.map((size, i) => (
                      <View key={size} style={s.legendItem}>
                        <View style={[s.legendSwatch, { backgroundColor: plateColor(size, unit, i) }]} />
                        <Text style={s.legendLabel}>{size} {unit}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </>
            )}
          </>
        )}

        {!targetWeight && (
          <View style={s.hintCard}>
            <Text style={s.hintText}>Enter a target weight above to calculate the plates you need.</Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
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
    title: { fontSize: 28, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    unitToggle: { flexDirection: 'row', backgroundColor: c.card, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, overflow: 'hidden' },
    unitBtn: { paddingHorizontal: 16, paddingVertical: 7 },
    unitBtnActive: { backgroundColor: c.accent },
    unitBtnText: { fontSize: 13, fontWeight: weight.bold, color: c.textSecondary },
    unitBtnTextActive: { color: c.accentText },
    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: 60, gap: 16 },
    inputsRow: { flexDirection: 'row', gap: 12 },
    inputGroup: { flex: 1 },
    inputLabel: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
    input: {
      backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
      color: c.text, fontSize: 22, fontWeight: weight.heavy, padding: 14, textAlign: 'center',
    },
    perSideLabel: { fontSize: 13, fontWeight: weight.semibold, color: c.textSecondary, textAlign: 'center' },
    barbellWrap: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border, minHeight: 110,
    },
    barSleeve: {
      flex: 1, height: 8, backgroundColor: c.textTertiary, borderRadius: 4,
    },
    platesStack: {
      flexDirection: 'row', alignItems: 'center', gap: 3,
    },
    plate: {
      width: 20, borderRadius: 3,
    },
    collar: {
      width: 10, height: 40, backgroundColor: c.textSecondary, borderRadius: 2,
    },
    textResultCard: {
      backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border,
    },
    textResultTitle: { fontSize: 10, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5, marginBottom: 6 },
    textResultList: { fontSize: 16, fontWeight: weight.semibold, color: c.text, lineHeight: 26 },
    legendCard: {
      backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border,
    },
    legendTitle: { fontSize: 10, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5, marginBottom: 12 },
    legendGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '30%' },
    legendSwatch: { width: 16, height: 24, borderRadius: 3 },
    legendLabel: { fontSize: 12, fontWeight: weight.semibold, color: c.textSecondary },
    emptyResult: { alignItems: 'center', paddingVertical: 32 },
    emptyResultText: { fontSize: 15, color: c.textSecondary, fontWeight: weight.medium },
    hintCard: {
      backgroundColor: c.card, borderRadius: radius.card, padding: spacing.xl,
      borderWidth: 1, borderColor: c.border, alignItems: 'center',
    },
    hintText: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 22, fontWeight: weight.medium },
  });
}
