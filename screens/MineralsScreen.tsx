import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Props { profile: any; }

const NUTRIENTS = [
  // Vitamins
  { name: 'Vitamin A', unit: 'mcg', category: 'Vitamins', emoji: '🟠', base: 900, perKg: 0, notes: 'Eye health, immune function' },
  { name: 'Vitamin B1 (Thiamine)', unit: 'mg', category: 'Vitamins', emoji: '🟡', base: 1.2, perKg: 0, notes: 'Energy metabolism' },
  { name: 'Vitamin B2 (Riboflavin)', unit: 'mg', category: 'Vitamins', emoji: '🟡', base: 1.3, perKg: 0, notes: 'Energy production' },
  { name: 'Vitamin B3 (Niacin)', unit: 'mg', category: 'Vitamins', emoji: '🟡', base: 16, perKg: 0, notes: 'DNA repair, metabolism' },
  { name: 'Vitamin B5', unit: 'mg', category: 'Vitamins', emoji: '🟡', base: 5, perKg: 0, notes: 'Hormone synthesis' },
  { name: 'Vitamin B6', unit: 'mg', category: 'Vitamins', emoji: '🟡', base: 1.3, perKg: 0, notes: 'Protein metabolism' },
  { name: 'Vitamin B7 (Biotin)', unit: 'mcg', category: 'Vitamins', emoji: '🟡', base: 30, perKg: 0, notes: 'Fat & carb metabolism' },
  { name: 'Vitamin B9 (Folate)', unit: 'mcg', category: 'Vitamins', emoji: '🟡', base: 400, perKg: 0, notes: 'Cell division' },
  { name: 'Vitamin B12', unit: 'mcg', category: 'Vitamins', emoji: '🟡', base: 2.4, perKg: 0, notes: 'Nerve function, red blood cells' },
  { name: 'Vitamin C', unit: 'mg', category: 'Vitamins', emoji: '🟠', base: 90, perKg: 0, notes: 'Antioxidant, collagen synthesis' },
  { name: 'Vitamin D', unit: 'mcg', category: 'Vitamins', emoji: '☀️', base: 20, perKg: 0, notes: 'Bone health, immune function' },
  { name: 'Vitamin E', unit: 'mg', category: 'Vitamins', emoji: '🟢', base: 15, perKg: 0, notes: 'Antioxidant' },
  { name: 'Vitamin K', unit: 'mcg', category: 'Vitamins', emoji: '🟢', base: 120, perKg: 0, notes: 'Blood clotting, bone health' },
  // Minerals
  { name: 'Calcium', unit: 'mg', category: 'Minerals', emoji: '🦴', base: 1000, perKg: 0, notes: 'Bone & muscle function' },
  { name: 'Magnesium', unit: 'mg', category: 'Minerals', emoji: '⚡', base: 400, perKg: 0.8, notes: 'Muscle recovery, sleep' },
  { name: 'Phosphorus', unit: 'mg', category: 'Minerals', emoji: '🔵', base: 700, perKg: 0, notes: 'Bone & energy metabolism' },
  { name: 'Potassium', unit: 'mg', category: 'Minerals', emoji: '🍌', base: 3400, perKg: 0, notes: 'Heart & muscle function' },
  { name: 'Sodium', unit: 'mg', category: 'Minerals', emoji: '🧂', base: 1500, perKg: 0, notes: 'Fluid balance' },
  { name: 'Iron', unit: 'mg', category: 'Minerals', emoji: '🔴', base: 8, perKg: 0, notes: 'Oxygen transport' },
  { name: 'Zinc', unit: 'mg', category: 'Minerals', emoji: '🩶', base: 11, perKg: 0.1, notes: 'Immune function, testosterone' },
  { name: 'Copper', unit: 'mcg', category: 'Minerals', emoji: '🟤', base: 900, perKg: 0, notes: 'Iron metabolism, antioxidant' },
  { name: 'Manganese', unit: 'mg', category: 'Minerals', emoji: '🟤', base: 2.3, perKg: 0, notes: 'Bone formation, antioxidant' },
  { name: 'Selenium', unit: 'mcg', category: 'Minerals', emoji: '⚪', base: 55, perKg: 0, notes: 'Thyroid function, antioxidant' },
  { name: 'Chromium', unit: 'mcg', category: 'Minerals', emoji: '⚪', base: 35, perKg: 0, notes: 'Blood sugar regulation' },
  { name: 'Iodine', unit: 'mcg', category: 'Minerals', emoji: '🫧', base: 150, perKg: 0, notes: 'Thyroid hormone production' },
  // Performance
  { name: 'Omega-3 (EPA+DHA)', unit: 'mg', category: 'Performance', emoji: '🐟', base: 500, perKg: 7, notes: 'Inflammation, brain health' },
  { name: 'Creatine', unit: 'g', category: 'Performance', emoji: '💪', base: 3, perKg: 0.03, notes: 'Strength & power output' },
  { name: 'Electrolytes (total)', unit: 'mg', category: 'Performance', emoji: '⚡', base: 2000, perKg: 10, notes: 'Hydration & muscle function' },
];

function calcRDA(nutrient: typeof NUTRIENTS[0], weightKg: number, heightCm: number, age: number, sex: string) {
  let base = nutrient.base;
  // Adjust for body weight
  if (nutrient.perKg > 0) base += nutrient.perKg * weightKg;
  // Sex adjustments
  if (sex === 'female') {
    if (nutrient.name === 'Iron') base = 18;
    if (nutrient.name === 'Vitamin B3 (Niacin)') base = 14;
    if (nutrient.name === 'Magnesium') base = 310 + nutrient.perKg * weightKg;
    if (nutrient.name === 'Zinc') base = 8 + nutrient.perKg * weightKg;
    if (nutrient.name === 'Chromium') base = 25;
  }
  // Age adjustments (older = more D, B12, calcium)
  if (age > 50) {
    if (nutrient.name === 'Vitamin D') base = 25;
    if (nutrient.name === 'Calcium') base = 1200;
    if (nutrient.name === 'Vitamin B12') base = 2.6;
  }
  return Math.round(base * 10) / 10;
}

const CATEGORY_COLORS: Record<string, string> = {
  Vitamins: '#fbbf24',
  Minerals: '#4a9eff',
  Performance: '#4ade80',
};

export default function MineralsScreen({ profile }: Props) {
  const weightKg = (profile?.weight_lbs || 170) / 2.205;
  const heightCm = (profile?.height_in || 70) * 2.54;
  const age = profile?.age || 25;
  const sex = profile?.sex || 'male';

  const categories = useMemo(() => {
    const cats: Record<string, typeof NUTRIENTS> = {};
    NUTRIENTS.forEach(n => {
      if (!cats[n.category]) cats[n.category] = [];
      cats[n.category].push(n);
    });
    return cats;
  }, []);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Vitamins & Minerals</Text>
        <Text style={s.subtitle}>Daily targets for your body</Text>
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statVal}>{Math.round(weightKg)}kg</Text>
            <Text style={s.statLabel}>Weight</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statVal}>{Math.round(heightCm)}cm</Text>
            <Text style={s.statLabel}>Height</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statVal}>{age}</Text>
            <Text style={s.statLabel}>Age</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statVal}>{sex === 'male' ? '♂' : '♀'}</Text>
            <Text style={s.statLabel}>Sex</Text>
          </View>
        </View>

        {Object.entries(categories).map(([category, nutrients]) => (
          <View key={category}>
            <View style={s.categoryHeader}>
              <View style={[s.categoryDot, { backgroundColor: CATEGORY_COLORS[category] }]} />
              <Text style={[s.categoryTitle, { color: CATEGORY_COLORS[category] }]}>{category.toUpperCase()}</Text>
            </View>
            {nutrients.map(n => {
              const rda = calcRDA(n, weightKg, heightCm, age, sex);
              return (
                <View key={n.name} style={s.row}>
                  <Text style={s.emoji}>{n.emoji}</Text>
                  <View style={s.info}>
                    <Text style={s.name}>{n.name}</Text>
                    <Text style={s.notes}>{n.notes}</Text>
                  </View>
                  <View style={s.rdaWrap}>
                    <Text style={[s.rdaVal, { color: CATEGORY_COLORS[category] }]}>{rda}</Text>
                    <Text style={s.rdaUnit}>{n.unit}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ))}

        <View style={s.disclaimer}>
          <Text style={s.disclaimerText}>
            ⚠️ These are general RDA estimates based on your profile. Consult a healthcare provider for personalized recommendations.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: '#555', fontWeight: '500', marginTop: 2 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 10, alignItems: 'center' },
  statVal: { fontSize: 16, fontWeight: '900', color: '#fff' },
  statLabel: { fontSize: 10, color: '#555', fontWeight: '600', marginTop: 2 },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 8 },
  categoryDot: { width: 8, height: 8, borderRadius: 4 },
  categoryTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, marginBottom: 6, gap: 12 },
  emoji: { fontSize: 22, width: 32, textAlign: 'center' },
  info: { flex: 1 },
  name: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 2 },
  notes: { fontSize: 11, color: '#555', fontWeight: '500' },
  rdaWrap: { alignItems: 'flex-end' },
  rdaVal: { fontSize: 18, fontWeight: '900' },
  rdaUnit: { fontSize: 10, color: '#555', fontWeight: '600' },
  disclaimer: { backgroundColor: '#1a1410', borderRadius: 12, padding: 14, marginTop: 8 },
  disclaimerText: { fontSize: 12, color: '#666', lineHeight: 18 },
});
