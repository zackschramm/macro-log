import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { MC } from '../constants/data';
import { callAI } from '../constants/ai';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

function getMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

function todayStr() { return new Date().toISOString().split('T')[0]; }

interface MealItem {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving?: string;
}

interface DayPlan {
  day: string;
  meals: {
    meal: string;
    items: MealItem[];
    totals: { calories: number; protein: number; carbs: number; fat: number };
  }[];
  totals: { calories: number; protein: number; carbs: number; fat: number };
}

export default function MealPlanScreen({ targets, profile }: {
  targets: { calories: number; protein: number; carbs: number; fat: number };
  profile: any;
}) {
  const { user } = useAuth();
  const [plan, setPlan] = useState<DayPlan[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [activeDay, setActiveDay] = useState(0);
  const [logModal, setLogModal] = useState<{ meal: string; items: MealItem[] } | null>(null);
  const [logging, setLogging] = useState(false);
  const weekStart = getMonday();

  const fetchExisting = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.from('meal_plans')
      .select('*').eq('user_id', user.id).eq('week_start', weekStart)
      .order('created_at', { ascending: false }).limit(1);
    console.log('fetchExisting:', JSON.stringify({ count: data?.length, error: error?.message, weekStart }));
    if (data?.[0]?.plan) setPlan(data[0].plan);
    setLoadingExisting(false);
  }, [user, weekStart]);

  useEffect(() => { fetchExisting(); }, [fetchExisting]);

  const generatePlan = async () => {
    setLoading(true);
    try {
      // Fetch user's pantry foods
      const { data: pantryFoods } = await supabase
        .from('user_foods').select('*').eq('user_id', user!.id);

      const pantryList = pantryFoods && pantryFoods.length > 0
        ? pantryFoods.map((f: any) => `${f.name} (${f.serving_size || 'per serving'}: ${f.calories}cal, P${f.protein}g, C${f.carbs}g, F${f.fat}g)`).join('\n')
        : 'No pantry foods — use common healthy foods';

      const prompt = `Create a 7-day meal plan as a JSON array. Daily targets: ${targets.calories}cal, ${targets.protein}g protein, ${targets.carbs}g carbs, ${targets.fat}g fat.
Pantry: ${pantryList}
Fill gaps with: chicken, rice, eggs, oats, Greek yogurt, vegetables, whey protein.
Output ONLY a raw JSON array (no markdown). Each day: 4 meals (Breakfast, Lunch, Dinner, Snack). Max 3 items per meal. Short names. Hit macro targets.
Format: [{"day":"Monday","meals":[{"meal":"Breakfast","items":[{"name":"Oats","serving":"1 cup dry","calories":300,"protein":10,"carbs":54,"fat":6}],"totals":{"calories":300,"protein":10,"carbs":54,"fat":6}}],"totals":{"calories":${targets.calories},"protein":${targets.protein},"carbs":${targets.carbs},"fat":${targets.fat}}}]
Complete all 7 days. Valid JSON only.`;

      const rawText = await callAI([{ role: 'user', content: prompt }]);
      console.log('AI response:', rawText.slice(0, 300));

      // Strip markdown code blocks
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\[\s*\{[\s\S]*\}/);
      if (!match) throw new Error('Could not parse meal plan response');
      let text = match[0];
      if (!text.trimEnd().endsWith(']')) text = text + ']';

      let parsed: DayPlan[];
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        console.log('Parse error:', e);
        throw new Error('Could not parse meal plan response');
      }

      // Save to Supabase
      const { error: saveError } = await supabase.from('meal_plans').upsert({
        user_id: user!.id,
        week_start: weekStart,
        plan: parsed,
      }, { onConflict: 'user_id,week_start' });
      console.log('Save result:', saveError?.message || 'success');

      setPlan(parsed);
    } catch (e) {
      Alert.alert('Error', 'Could not generate meal plan. Please try again.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const logMeal = async () => {
    if (!logModal) return;
    setLogging(true);
    const date = todayStr();
    const entries = logModal.items.map((item: MealItem) => ({
      user_id: user!.id,
      date,
      meal: logModal.meal,
      food: item.name,
      qty: 1,
      calories: Math.round(item.calories),
      protein: Math.round(item.protein * 10) / 10,
      carbs: Math.round(item.carbs * 10) / 10,
      fat: Math.round(item.fat * 10) / 10,
    }));
    await supabase.from('macro_logs').insert(entries);
    setLogging(false);
    setLogModal(null);
    Alert.alert('✓ Logged!', `${logModal.meal} added to today's log.`);
  };

  const dayPlan = plan?.[activeDay];

  if (loadingExisting) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.center}><ActivityIndicator color="#fff" size="large" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Meal Plan</Text>
        <TouchableOpacity style={s.genBtn} onPress={generatePlan} disabled={loading}>
          {loading ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.genBtnText}>✨ Generate Week</Text>}
        </TouchableOpacity>
      </View>

      {!plan && !loading && (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>🥗</Text>
          <Text style={s.emptyTitle}>No meal plan yet</Text>
          <Text style={s.emptySub}>Tap "Generate Week" and AI will build{'\n'}a full 7-day plan hitting your macros.</Text>
          <TouchableOpacity style={s.genBtnLarge} onPress={generatePlan} disabled={loading}>
            <Text style={s.genBtnLargeText}>✨ Generate My Week</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && (
        <View style={s.center}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={s.loadingText}>Building your 7-day plan…{'\n'}This takes about 15 seconds.</Text>
        </View>
      )}

      {plan && !loading && (
        <>
          {/* Day tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.dayPicker} contentContainerStyle={s.dayPickerContent}>
            {DAYS.map((day, i) => (
              <TouchableOpacity key={day} style={[s.dayChip, activeDay === i && s.dayChipActive]} onPress={() => setActiveDay(i)}>
                <Text style={[s.dayChipText, activeDay === i && s.dayChipTextActive]}>{day.slice(0, 3)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            {/* Day totals */}
            {dayPlan && (
              <>
                <View style={s.dayTotals}>
                  <Text style={s.dayTotalsTitle}>{dayPlan.day}</Text>
                  <View style={s.macroRow}>
                    <View style={s.macroItem}>
                      <Text style={s.macroVal}>{Math.round(dayPlan.totals?.calories || 0)}</Text>
                      <Text style={s.macroLabel}>Cal</Text>
                    </View>
                    <View style={s.macroItem}>
                      <Text style={[s.macroVal, { color: MC.protein.color }]}>{Math.round(dayPlan.totals?.protein || 0)}g</Text>
                      <Text style={s.macroLabel}>Protein</Text>
                    </View>
                    <View style={s.macroItem}>
                      <Text style={[s.macroVal, { color: MC.carbs.color }]}>{Math.round(dayPlan.totals?.carbs || 0)}g</Text>
                      <Text style={s.macroLabel}>Carbs</Text>
                    </View>
                    <View style={s.macroItem}>
                      <Text style={[s.macroVal, { color: MC.fat.color }]}>{Math.round(dayPlan.totals?.fat || 0)}g</Text>
                      <Text style={s.macroLabel}>Fat</Text>
                    </View>
                  </View>
                  {/* Target comparison bars */}
                  {(['calories', 'protein', 'carbs', 'fat'] as const).map(key => {
                    const val = dayPlan.totals?.[key] || 0;
                    const target = targets[key];
                    const pct = Math.min(100, Math.round(val / (target || 1) * 100));
                    const color = key === 'calories' ? '#fff' : MC[key as keyof typeof MC]?.color || '#fff';
                    return (
                      <View key={key} style={s.targetBar}>
                        <View style={s.targetBarBg}>
                          <View style={[s.targetBarFill, { width: `${pct}%` as any, backgroundColor: color }]} />
                        </View>
                        <Text style={s.targetBarPct}>{pct}%</Text>
                      </View>
                    );
                  })}
                </View>

                {/* Meals */}
                {dayPlan.meals?.map((mealGroup, mi) => (
                  <View key={mi} style={s.mealCard}>
                    <View style={s.mealCardHeader}>
                      <Text style={s.mealName}>{mealGroup.meal}</Text>
                      <View style={s.mealMacros}>
                        <Text style={s.mealCal}>{Math.round(mealGroup.totals?.calories || 0)} cal</Text>
                        <Text style={[s.mealMacro, { color: MC.protein.color }]}>P{Math.round(mealGroup.totals?.protein || 0)}</Text>
                        <Text style={[s.mealMacro, { color: MC.carbs.color }]}>C{Math.round(mealGroup.totals?.carbs || 0)}</Text>
                        <Text style={[s.mealMacro, { color: MC.fat.color }]}>F{Math.round(mealGroup.totals?.fat || 0)}</Text>
                      </View>
                    </View>
                    {mealGroup.items?.map((item, ii) => (
                      <View key={ii} style={s.foodItem}>
                        <View style={s.foodItemInfo}>
                          <Text style={s.foodItemName}>{item.name}</Text>
                          {item.serving && <Text style={s.foodItemServing}>{item.serving}</Text>}
                        </View>
                        <Text style={s.foodItemCal}>{Math.round(item.calories)} cal</Text>
                      </View>
                    ))}
                    <TouchableOpacity style={s.logBtn} onPress={() => setLogModal({ meal: mealGroup.meal, items: mealGroup.items })}>
                      <Text style={s.logBtnText}>+ Log to Today</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </>
      )}

      {/* Log confirmation modal */}
      <Modal visible={!!logModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLogModal(null)}>
        <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
          <View style={s.handle} />
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Log {logModal?.meal}</Text>
            <TouchableOpacity style={s.modalClose} onPress={() => setLogModal(null)}>
              <Text style={s.modalCloseText}>×</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1, paddingHorizontal: 20 }}>
            <Text style={s.modalSub}>These items will be added to today's log:</Text>
            {logModal?.items.map((item, i) => (
              <View key={i} style={s.modalItem}>
                <View style={{ flex: 1 }}>
                  <Text style={s.modalItemName}>{item.name}</Text>
                  {item.serving && <Text style={s.modalItemServing}>{item.serving}</Text>}
                </View>
                <View style={s.modalItemMacros}>
                  <Text style={s.modalItemCal}>{Math.round(item.calories)} cal</Text>
                  <Text style={[s.modalItemMacro, { color: MC.protein.color }]}>P{Math.round(item.protein)}g</Text>
                  <Text style={[s.modalItemMacro, { color: MC.carbs.color }]}>C{Math.round(item.carbs)}g</Text>
                  <Text style={[s.modalItemMacro, { color: MC.fat.color }]}>F{Math.round(item.fat)}g</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={{ padding: 20 }}>
            <TouchableOpacity style={s.confirmBtn} onPress={logMeal} disabled={logging}>
              {logging ? <ActivityIndicator color="#000" /> : <Text style={s.confirmBtnText}>Log to Today's Diary</Text>}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  genBtn: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, minWidth: 44, alignItems: 'center' },
  genBtnText: { color: '#000', fontSize: 13, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyIcon: { fontSize: 56 },
  emptyTitle: { fontSize: 22, fontWeight: '900', color: '#fff' },
  emptySub: { fontSize: 14, color: '#444', textAlign: 'center', lineHeight: 22, fontWeight: '500' },
  genBtnLarge: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 16, marginTop: 12 },
  genBtnLargeText: { color: '#000', fontSize: 16, fontWeight: '800' },
  loadingText: { color: '#444', fontSize: 14, textAlign: 'center', lineHeight: 24, fontWeight: '500' },
  dayPicker: { maxHeight: 52, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  dayPickerContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  dayChip: { backgroundColor: '#1e1e1e', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  dayChipActive: { backgroundColor: '#fff' },
  dayChipText: { color: '#555', fontSize: 13, fontWeight: '700' },
  dayChipTextActive: { color: '#000' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  dayTotals: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16, marginBottom: 16 },
  dayTotalsTitle: { fontSize: 18, fontWeight: '900', color: '#fff', marginBottom: 14, letterSpacing: -0.5 },
  macroRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  macroItem: { alignItems: 'center' },
  macroVal: { fontSize: 20, fontWeight: '900', color: '#fff' },
  macroLabel: { fontSize: 10, color: '#555', fontWeight: '600', marginTop: 2 },
  targetBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  targetBarBg: { flex: 1, backgroundColor: '#2a2a2a', borderRadius: 3, height: 3 },
  targetBarFill: { height: 3, borderRadius: 3 },
  targetBarPct: { fontSize: 10, color: '#444', fontWeight: '700', width: 32, textAlign: 'right' },
  mealCard: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16, marginBottom: 10 },
  mealCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  mealName: { fontSize: 16, fontWeight: '800', color: '#fff' },
  mealMacros: { flexDirection: 'row', gap: 6 },
  mealCal: { fontSize: 11, color: '#555', fontWeight: '600' },
  mealMacro: { fontSize: 11, fontWeight: '700' },
  foodItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#222' },
  foodItemInfo: { flex: 1 },
  foodItemName: { fontSize: 14, fontWeight: '600', color: '#ccc' },
  foodItemServing: { fontSize: 11, color: '#444', fontWeight: '500', marginTop: 2 },
  foodItemCal: { fontSize: 12, color: '#555', fontWeight: '600' },
  logBtn: { backgroundColor: '#252525', borderRadius: 10, padding: 10, alignItems: 'center', marginTop: 12 },
  logBtnText: { color: '#888', fontSize: 13, fontWeight: '700' },
  modalSafe: { flex: 1, backgroundColor: '#1a1a1a' },
  handle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 8 },
  modalTitle: { fontSize: 22, fontWeight: '900', color: '#fff' },
  modalClose: { backgroundColor: '#252525', width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  modalCloseText: { color: '#888', fontSize: 20, lineHeight: 22 },
  modalSub: { fontSize: 13, color: '#555', fontWeight: '500', marginBottom: 16, paddingHorizontal: 0 },
  modalItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#252525', borderRadius: 12, padding: 12, marginBottom: 8 },
  modalItemName: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 2 },
  modalItemServing: { fontSize: 11, color: '#555', fontWeight: '500' },
  modalItemMacros: { alignItems: 'flex-end', gap: 2 },
  modalItemCal: { fontSize: 12, color: '#555', fontWeight: '600' },
  modalItemMacro: { fontSize: 11, fontWeight: '700' },
  confirmBtn: { backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center' },
  confirmBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },
});
