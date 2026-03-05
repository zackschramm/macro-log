import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';

interface Props { profile: any; }

const NUTRIENTS = [
  { key: 'vitamin_a',  name: 'Vitamin A',            unit: 'mcg', category: 'Vitamins',     emoji: '🟠', base: 900,  perKg: 0,    notes: 'Eye health, immune function' },
  { key: 'vitamin_b1', name: 'B1 Thiamine',           unit: 'mg',  category: 'Vitamins',     emoji: '🟡', base: 1.2,  perKg: 0,    notes: 'Energy metabolism' },
  { key: 'vitamin_b2', name: 'B2 Riboflavin',         unit: 'mg',  category: 'Vitamins',     emoji: '🟡', base: 1.3,  perKg: 0,    notes: 'Energy production' },
  { key: 'vitamin_b3', name: 'B3 Niacin',             unit: 'mg',  category: 'Vitamins',     emoji: '🟡', base: 16,   perKg: 0,    notes: 'DNA repair, metabolism' },
  { key: 'vitamin_b5', name: 'B5 Pantothenic',        unit: 'mg',  category: 'Vitamins',     emoji: '🟡', base: 5,    perKg: 0,    notes: 'Hormone synthesis' },
  { key: 'vitamin_b6', name: 'B6',                    unit: 'mg',  category: 'Vitamins',     emoji: '🟡', base: 1.3,  perKg: 0,    notes: 'Protein metabolism' },
  { key: 'vitamin_b7', name: 'B7 Biotin',             unit: 'mcg', category: 'Vitamins',     emoji: '🟡', base: 30,   perKg: 0,    notes: 'Fat & carb metabolism' },
  { key: 'vitamin_b9', name: 'B9 Folate',             unit: 'mcg', category: 'Vitamins',     emoji: '🟡', base: 400,  perKg: 0,    notes: 'Cell division' },
  { key: 'vitamin_b12',name: 'B12',                   unit: 'mcg', category: 'Vitamins',     emoji: '🟡', base: 2.4,  perKg: 0,    notes: 'Nerve function, red blood cells' },
  { key: 'vitamin_c',  name: 'Vitamin C',             unit: 'mg',  category: 'Vitamins',     emoji: '🟠', base: 90,   perKg: 0,    notes: 'Antioxidant, collagen' },
  { key: 'vitamin_d',  name: 'Vitamin D',             unit: 'mcg', category: 'Vitamins',     emoji: '☀️', base: 20,   perKg: 0,    notes: 'Bone health, immune function' },
  { key: 'vitamin_e',  name: 'Vitamin E',             unit: 'mg',  category: 'Vitamins',     emoji: '🟢', base: 15,   perKg: 0,    notes: 'Antioxidant' },
  { key: 'vitamin_k',  name: 'Vitamin K',             unit: 'mcg', category: 'Vitamins',     emoji: '🟢', base: 120,  perKg: 0,    notes: 'Blood clotting, bone health' },
  { key: 'calcium',    name: 'Calcium',               unit: 'mg',  category: 'Minerals',     emoji: '🦴', base: 1000, perKg: 0,    notes: 'Bone & muscle function' },
  { key: 'magnesium',  name: 'Magnesium',             unit: 'mg',  category: 'Minerals',     emoji: '⚡', base: 400,  perKg: 0.8,  notes: 'Muscle recovery, sleep' },
  { key: 'phosphorus', name: 'Phosphorus',            unit: 'mg',  category: 'Minerals',     emoji: '🔵', base: 700,  perKg: 0,    notes: 'Bone & energy metabolism' },
  { key: 'potassium',  name: 'Potassium',             unit: 'mg',  category: 'Minerals',     emoji: '🍌', base: 3400, perKg: 0,    notes: 'Heart & muscle function' },
  { key: 'sodium',     name: 'Sodium',                unit: 'mg',  category: 'Minerals',     emoji: '🧂', base: 1500, perKg: 0,    notes: 'Fluid balance' },
  { key: 'iron',       name: 'Iron',                  unit: 'mg',  category: 'Minerals',     emoji: '🔴', base: 8,    perKg: 0,    notes: 'Oxygen transport' },
  { key: 'zinc',       name: 'Zinc',                  unit: 'mg',  category: 'Minerals',     emoji: '🩶', base: 11,   perKg: 0.1,  notes: 'Immune function, testosterone' },
  { key: 'copper',     name: 'Copper',                unit: 'mcg', category: 'Minerals',     emoji: '🟤', base: 900,  perKg: 0,    notes: 'Iron metabolism, antioxidant' },
  { key: 'manganese',  name: 'Manganese',             unit: 'mg',  category: 'Minerals',     emoji: '🟤', base: 2.3,  perKg: 0,    notes: 'Bone formation, antioxidant' },
  { key: 'selenium',   name: 'Selenium',              unit: 'mcg', category: 'Minerals',     emoji: '⚪', base: 55,   perKg: 0,    notes: 'Thyroid function, antioxidant' },
  { key: 'chromium',   name: 'Chromium',              unit: 'mcg', category: 'Minerals',     emoji: '⚪', base: 35,   perKg: 0,    notes: 'Blood sugar regulation' },
  { key: 'iodine',     name: 'Iodine',                unit: 'mcg', category: 'Minerals',     emoji: '🫧', base: 150,  perKg: 0,    notes: 'Thyroid hormone production' },
  { key: 'omega3',     name: 'Omega-3 (EPA+DHA)',     unit: 'mg',  category: 'Performance',  emoji: '🐟', base: 500,  perKg: 7,    notes: 'Inflammation, brain health' },
];

function calcRDA(n: typeof NUTRIENTS[0], weightKg: number, age: number, sex: string) {
  let base = n.base + n.perKg * weightKg;
  if (sex === 'female') {
    if (n.key === 'iron') base = 18;
    if (n.key === 'vitamin_b3') base = 14;
    if (n.key === 'magnesium') base = 310 + n.perKg * weightKg;
    if (n.key === 'zinc') base = 8 + n.perKg * weightKg;
    if (n.key === 'chromium') base = 25;
  }
  if (age > 50) {
    if (n.key === 'vitamin_d') base = 25;
    if (n.key === 'calcium') base = 1200;
    if (n.key === 'vitamin_b12') base = 2.6;
  }
  return Math.round(base * 10) / 10;
}

const CAT_COLORS: Record<string, string> = {
  Vitamins: '#fbbf24', Minerals: '#4a9eff', Performance: '#4ade80',
};

function ProgressBar({ value, target, color }: { value: number; target: number; color: string }) {
  const pct = Math.min(100, target > 0 ? (value / target) * 100 : 0);
  const barColor = pct >= 100 ? '#4ade80' : pct >= 50 ? color : '#ff4f4f';
  return (
    <View style={pb.wrap}>
      <View style={[pb.fill, { width: `${pct}%` as any, backgroundColor: barColor }]} />
    </View>
  );
}

const pb = StyleSheet.create({
  wrap: { height: 4, backgroundColor: '#2a2a2a', borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
});

const todayStr = () => new Date().toISOString().split('T')[0];

export default function MineralsScreen({ profile }: Props) {
  const { user } = useAuth();
  const [todayIntake, setTodayIntake] = useState<Record<string, number>>({});

  const weightKg = (profile?.weight_lbs || 170) / 2.205;
  const weightLbs = profile?.weight_lbs || 170;
  const heightIn = profile?.height_in || 70;
  const heightFt = Math.floor(heightIn / 12);
  const heightRemIn = heightIn % 12;
  const age = profile?.age || 25;
  const sex = profile?.sex || 'male';

  const fetchTodayIntake = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('macro_logs')
      .select('*').eq('user_id', user.id).eq('date', todayStr());
    if (!data?.length) return;
    const totals: Record<string, number> = {};
    NUTRIENTS.forEach(n => {
      totals[n.key] = data.reduce((sum, row) => sum + (row[n.key] || 0), 0);
    });
    setTodayIntake(totals);
  }, [user]);

  useEffect(() => { fetchTodayIntake(); }, [fetchTodayIntake]);

  const categories = useMemo(() => {
    const cats: Record<string, typeof NUTRIENTS> = {};
    NUTRIENTS.forEach(n => { if (!cats[n.category]) cats[n.category] = []; cats[n.category].push(n); });
    return cats;
  }, []);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Vitamins & Minerals</Text>
        <Text style={s.subtitle}>Daily targets · log foods to track progress</Text>
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statVal}>{weightLbs} lbs</Text>
            <Text style={s.statLabel}>Weight</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statVal}>{heightFt}'{heightRemIn}"</Text>
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
              <View style={[s.categoryDot, { backgroundColor: CAT_COLORS[category] }]} />
              <Text style={[s.categoryTitle, { color: CAT_COLORS[category] }]}>{category.toUpperCase()}</Text>
            </View>
            {nutrients.map(n => {
              const rda = calcRDA(n, weightKg, age, sex);
              const intake = todayIntake[n.key] || 0;
              const pct = rda > 0 ? Math.min(100, Math.round((intake / rda) * 100)) : 0;
              return (
                <View key={n.key} style={s.row}>
                  <Text style={s.emoji}>{n.emoji}</Text>
                  <View style={s.info}>
                    <View style={s.nameRow}>
                      <Text style={s.name}>{n.name}</Text>
                      <Text style={[s.pct, { color: pct >= 100 ? '#4ade80' : pct >= 50 ? CAT_COLORS[category] : '#555' }]}>
                        {pct}%
                      </Text>
                    </View>
                    <Text style={s.notes}>{n.notes}</Text>
                    <ProgressBar value={intake} target={rda} color={CAT_COLORS[category]} />
                    <View style={s.intakeRow}>
                      <Text style={s.intakeText}>{intake > 0 ? `${Math.round(intake * 10) / 10} / ` : ''}{rda} {n.unit}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        ))}

        <View style={s.disclaimer}>
          <Text style={s.disclaimerText}>
            ⚠️ Progress bars reflect micronutrients from USDA-imported foods logged today. Manually entered foods won't have micronutrient data. Consult a healthcare provider for personalized recommendations.
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
  subtitle: { fontSize: 12, color: '#555', fontWeight: '500', marginTop: 2 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 10, alignItems: 'center' },
  statVal: { fontSize: 13, fontWeight: '900', color: '#fff' },
  statLabel: { fontSize: 10, color: '#555', fontWeight: '600', marginTop: 2 },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 8 },
  categoryDot: { width: 8, height: 8, borderRadius: 4 },
  categoryTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  row: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, marginBottom: 6, gap: 12 },
  emoji: { fontSize: 20, width: 28, textAlign: 'center', marginTop: 2 },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 14, fontWeight: '700', color: '#fff' },
  pct: { fontSize: 13, fontWeight: '800' },
  notes: { fontSize: 11, color: '#555', fontWeight: '500', marginTop: 2 },
  intakeRow: { marginTop: 4 },
  intakeText: { fontSize: 10, color: '#444', fontWeight: '600' },
  disclaimer: { backgroundColor: '#1a1410', borderRadius: 12, padding: 14, marginTop: 8 },
  disclaimerText: { fontSize: 12, color: '#666', lineHeight: 18 },
});
