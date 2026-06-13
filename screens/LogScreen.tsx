import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import MacroRing from '../components/MacroRing';
import WaterTracker from '../components/WaterTracker';
import AddFoodModal from '../components/AddFoodModal';
import { MEALS, MC } from '../constants/data';
import { colors, radius, weight } from '../constants/theme';

const todayStr = () => new Date().toISOString().split('T')[0];
const r1 = (n: number) => Math.round(n * 10) / 10;
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

export default function LogScreen({ targets }: { targets: { calories: number; protein: number; carbs: number; fat: number } }) {
  const { user } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [activeDate, setActiveDate] = useState(todayStr());
  const [addFoodMeal, setAddFoodMeal] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('macro_logs')
      .select('*').eq('user_id', user.id).eq('date', activeDate).order('created_at');
    setLogs(data || []);
  }, [user, activeDate]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const totals = logs.reduce(
    (a, e) => ({ calories: a.calories + e.calories, protein: a.protein + e.protein, carbs: a.carbs + e.carbs, fat: a.fat + e.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const calOver = totals.calories > targets.calories;
  const calRemain = targets.calories - Math.round(totals.calories);

  const changeDate = (delta: number) => {
    const d = new Date(activeDate + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    const next = d.toISOString().split('T')[0];
    if (next <= todayStr()) setActiveDate(next);
  };

  const removeEntry = async (id: number) => {
    await supabase.from('macro_logs').delete().eq('id', id);
    await fetchLogs();
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Fuelog</Text>
        <Text style={s.date}>{activeDate === todayStr() ? 'Today' : fmtDate(activeDate)}</Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Date nav */}
        <View style={s.dateNav}>
          <TouchableOpacity style={s.dateBtn} onPress={() => changeDate(-1)}>
            <Text style={s.dateArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={s.dateLabel}>{activeDate === todayStr() ? 'Today' : fmtDate(activeDate)}</Text>
          <TouchableOpacity style={[s.dateBtn, activeDate === todayStr() && s.dateBtnDisabled]}
            onPress={() => changeDate(1)} disabled={activeDate === todayStr()}>
            <Text style={s.dateArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Calorie hero */}
        <View style={s.hero}>
          <Text style={s.heroLabel}>CALORIES</Text>
          <Text style={[s.heroNum, calOver && s.heroOver]}>{Math.round(totals.calories)}</Text>
          <Text style={s.heroSub}>
            {calOver ? `${Math.abs(calRemain)} over your ${targets.calories} goal` : `${calRemain} remaining of ${targets.calories}`}
          </Text>
        </View>

        {/* Rings */}
        <View style={s.rings}>
          <MacroRing macroKey="protein" value={totals.protein} target={targets.protein} label="Protein" />
          <MacroRing macroKey="carbs" value={totals.carbs} target={targets.carbs} label="Carbs" />
          <MacroRing macroKey="fat" value={totals.fat} target={targets.fat} label="Fat" />
        </View>

        {/* Water tracker */}
        <WaterTracker />

        {/* Primary add-food button */}
        <TouchableOpacity style={s.addFoodBtn} onPress={() => setAddFoodMeal('')} activeOpacity={0.8}>
          <Text style={s.addFoodBtnText}>+ Log Food</Text>
        </TouchableOpacity>

        {/* Entries */}
        {MEALS.map(meal => {
          const entries = logs.filter(e => e.meal === meal);
          if (!entries.length) {
            return (
              <TouchableOpacity key={meal} style={s.mealSectionEmpty} onPress={() => setAddFoodMeal(meal)} activeOpacity={0.7}>
                <Text style={s.mealHeaderEmpty}>{meal.toUpperCase()}</Text>
                <Text style={s.mealAdd}>+ Add</Text>
              </TouchableOpacity>
            );
          }
          return (
            <View key={meal} style={s.mealSection}>
              <View style={s.mealHeaderRow}>
                <Text style={s.mealHeader}>{meal.toUpperCase()}</Text>
                <TouchableOpacity onPress={() => setAddFoodMeal(meal)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={s.mealAdd}>+ Add</Text>
                </TouchableOpacity>
              </View>
              {entries.map(e => (
                <View key={e.id} style={s.entry}>
                  <View style={s.entryInfo}>
                    <Text style={s.entryName}>{e.qty !== 1 ? `${e.qty}× ` : ''}{e.food}</Text>
                    <View style={s.entryMacros}>
                      <Text style={s.entryCal}>{e.calories} cal</Text>
                      <Text style={{ color: MC.protein.color, fontSize: 11, fontWeight: '600' }}>P {e.protein}g</Text>
                      <Text style={{ color: MC.carbs.color, fontSize: 11, fontWeight: '600' }}>C {e.carbs}g</Text>
                      <Text style={{ color: MC.fat.color, fontSize: 11, fontWeight: '600' }}>F {e.fat}g</Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => removeEntry(e.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Text style={s.del}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          );
        })}
        {logs.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>🍽️</Text>
            <Text style={s.emptyTitle}>Nothing logged yet</Text>
            <Text style={s.emptySub}>Tap “+ Log Food” above to start tracking your day.</Text>
          </View>
        )}
      </ScrollView>

      <AddFoodModal
        visible={addFoodMeal !== null}
        date={activeDate}
        defaultMeal={addFoodMeal || undefined}
        onClose={() => setAddFoodMeal(null)}
        onLogged={() => { void fetchLogs(); }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 28, fontWeight: weight.bold, color: colors.text, letterSpacing: -0.5 },
  date: { fontSize: 13, color: colors.textSecondary, fontWeight: weight.regular, marginTop: 2 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  dateNav: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  dateBtn: { backgroundColor: colors.card, borderRadius: radius.sm, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  dateBtnDisabled: { opacity: 0.25 },
  dateArrow: { color: colors.text, fontSize: 22 },
  dateLabel: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: weight.medium, color: colors.text },
  hero: { alignItems: 'center', marginBottom: 28 },
  heroLabel: { fontSize: 11, fontWeight: weight.semibold, color: colors.textSecondary, letterSpacing: 2, marginBottom: 6 },
  heroNum: { fontSize: 72, fontWeight: weight.heavy, color: colors.text, letterSpacing: -3, lineHeight: 80 },
  heroOver: { color: colors.danger },
  heroSub: { fontSize: 13, color: colors.textMuted, marginTop: 6, fontWeight: weight.regular },
  rings: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  addFoodBtn: { backgroundColor: colors.accent, borderRadius: radius.md, padding: 16, alignItems: 'center', marginBottom: 16 },
  addFoodBtnText: { color: colors.accentText, fontWeight: weight.bold, fontSize: 15 },
  mealSection: { marginBottom: 8 },
  mealSectionEmpty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 4, opacity: 0.6 },
  mealHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  mealHeader: { fontSize: 11, fontWeight: weight.semibold, color: colors.textSecondary, letterSpacing: 1.5, paddingVertical: 10 },
  mealHeaderEmpty: { fontSize: 11, fontWeight: weight.semibold, color: colors.textMuted, letterSpacing: 1.5 },
  mealAdd: { color: colors.accent, fontSize: 12, fontWeight: weight.semibold },
  entry: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: colors.borderSubtle },
  entryInfo: { flex: 1 },
  entryName: { fontSize: 14, fontWeight: weight.medium, color: colors.text, marginBottom: 3 },
  entryMacros: { flexDirection: 'row', gap: 8 },
  entryCal: { fontSize: 11, color: colors.textSecondary, fontWeight: weight.medium },
  del: { color: colors.textFaint, fontSize: 22, paddingLeft: 12 },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 17, fontWeight: weight.bold, color: colors.text },
  emptySub: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20, fontWeight: weight.regular, paddingHorizontal: 32 },
});
