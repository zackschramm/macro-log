import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { MC } from '../constants/data';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';

export type AnalyzedItem = {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  portion: string;
};

export type AnalysisResult = {
  items: AnalyzedItem[];
  totals: { calories: number; protein: number; carbs: number; fat: number };
  confidence: 'high' | 'medium' | 'low';
  notes: string;
};

const PHOTO_MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

const CONFIDENCE_CONFIG = {
  high:   { color: '#C8FF3D', label: 'High confidence' },
  medium: { color: '#F5A623', label: 'Estimated' },
  low:    { color: '#E74C3C', label: 'Rough estimates — verify before logging' },
};

type Props = {
  result: AnalysisResult;
  selectedMeal: string;
  onMealChange: (meal: string) => void;
  onLog: () => void;
  onEdit: () => void;
  logging: boolean;
};

export default function FoodAnalysisResults({ result, selectedMeal, onMealChange, onLog, onEdit, logging }: Props) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const conf = CONFIDENCE_CONFIG[result.confidence] ?? CONFIDENCE_CONFIG.medium;

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
      {result.items.map((item, i) => (
        <View key={i} style={s.itemCard}>
          <View style={s.itemHeader}>
            <Text style={s.itemName}>{item.name}</Text>
            {!!item.portion && <Text style={s.itemPortion}>{item.portion}</Text>}
          </View>
          <View style={s.itemMacros}>
            <Text style={s.itemCal}>{Math.round(item.calories)} cal</Text>
            <Text style={[s.itemMacro, { color: MC.protein.color }]}>P {item.protein}g</Text>
            <Text style={[s.itemMacro, { color: MC.carbs.color }]}>C {item.carbs}g</Text>
            <Text style={[s.itemMacro, { color: MC.fat.color }]}>F {item.fat}g</Text>
          </View>
        </View>
      ))}

      <View style={s.confidenceRow}>
        <View style={[s.confidenceDot, { backgroundColor: conf.color }]} />
        <Text style={[s.confidenceText, { color: conf.color }]}>{conf.label}</Text>
      </View>

      {!!result.notes && (
        <Text style={s.notes}>{result.notes}</Text>
      )}

      <View style={s.totalsCard}>
        <Text style={s.totalsCalLabel}>Total</Text>
        <Text style={s.totalsCal}>{Math.round(result.totals.calories)}</Text>
        <Text style={s.totalsCalUnit}>calories</Text>
        <View style={s.totalsMacroRow}>
          <View style={[s.totalsMacroPill, { backgroundColor: MC.protein.bg ?? 'rgba(74,158,255,0.15)' }]}>
            <Text style={[s.totalsMacroText, { color: MC.protein.color }]}>P {result.totals.protein}g</Text>
          </View>
          <View style={[s.totalsMacroPill, { backgroundColor: MC.carbs.bg ?? 'rgba(245,166,35,0.15)' }]}>
            <Text style={[s.totalsMacroText, { color: MC.carbs.color }]}>C {result.totals.carbs}g</Text>
          </View>
          <View style={[s.totalsMacroPill, { backgroundColor: MC.fat.bg ?? 'rgba(244,114,182,0.15)' }]}>
            <Text style={[s.totalsMacroText, { color: MC.fat.color }]}>F {result.totals.fat}g</Text>
          </View>
        </View>
      </View>

      <Text style={s.mealLabel}>Log as</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.mealScroll} contentContainerStyle={s.mealScrollContent}>
        {PHOTO_MEALS.map(m => (
          <TouchableOpacity
            key={m}
            style={[s.mealPill, m === selectedMeal && s.mealPillActive]}
            onPress={() => onMealChange(m)}
            activeOpacity={0.7}
          >
            <Text style={[s.mealPillText, m === selectedMeal && s.mealPillTextActive]}>{m}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.actionRow}>
        <TouchableOpacity style={s.editBtn} onPress={onEdit} activeOpacity={0.8}>
          <Text style={s.editBtnText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.logBtn} onPress={onLog} activeOpacity={0.8} disabled={logging}>
          {logging
            ? <ActivityIndicator color="#000" />
            : <Text style={s.logBtnText}>Log It</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    scroll: { flex: 1 },
    scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    itemCard: {
      backgroundColor: c.card, borderRadius: radius.md, padding: spacing.md,
      marginBottom: 8, borderWidth: 1, borderColor: c.border,
    },
    itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
    itemName: { fontSize: 14, fontWeight: weight.semibold, color: c.text, flex: 1, marginRight: 8 },
    itemPortion: { fontSize: 12, color: c.textSecondary },
    itemMacros: { flexDirection: 'row', gap: 10 },
    itemCal: { fontSize: 12, color: c.textSecondary, fontWeight: weight.medium },
    itemMacro: { fontSize: 12, fontWeight: weight.semibold },
    confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginVertical: spacing.md },
    confidenceDot: { width: 8, height: 8, borderRadius: 4 },
    confidenceText: { fontSize: 13, fontWeight: weight.semibold },
    notes: { fontSize: 13, color: c.textSecondary, fontStyle: 'italic', marginBottom: spacing.md, lineHeight: 19 },
    totalsCard: {
      backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg,
      alignItems: 'center', marginBottom: spacing.xl, borderWidth: 1, borderColor: c.border,
    },
    totalsCalLabel: { fontSize: 12, color: c.textSecondary, fontWeight: weight.medium, marginBottom: 2 },
    totalsCal: { fontSize: 36, fontWeight: weight.heavy, color: c.text },
    totalsCalUnit: { fontSize: 13, color: c.textSecondary, marginBottom: spacing.md },
    totalsMacroRow: { flexDirection: 'row', gap: 8 },
    totalsMacroPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill },
    totalsMacroText: { fontSize: 13, fontWeight: weight.semibold },
    mealLabel: { fontSize: 12, color: c.textSecondary, fontWeight: weight.semibold, marginBottom: 8 },
    mealScroll: { marginBottom: spacing.xl },
    mealScrollContent: { gap: 8 },
    mealPill: {
      paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    },
    mealPillActive: { backgroundColor: c.accent, borderColor: c.accent },
    mealPillText: { fontSize: 14, fontWeight: weight.semibold, color: c.textSecondary },
    mealPillTextActive: { color: c.accentText },
    actionRow: { flexDirection: 'row', gap: 12 },
    editBtn: {
      flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: radius.md,
      padding: 14, alignItems: 'center',
    },
    editBtnText: { color: c.textSecondary, fontWeight: weight.semibold, fontSize: 15 },
    logBtn: {
      flex: 2, backgroundColor: c.accent, borderRadius: radius.md,
      padding: 14, alignItems: 'center',
    },
    logBtnText: { color: c.accentText, fontWeight: weight.bold, fontSize: 15 },
  });
}
