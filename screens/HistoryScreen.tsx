import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { MC } from '../constants/data';

const todayStr = () => new Date().toISOString().split('T')[0];
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const pct = (v: number, t: number) => Math.min(100, Math.round((v / (t || 1)) * 100));

export default function HistoryScreen({ targets }: { targets: { calories: number; protein: number; carbs: number; fat: number } }) {
  const { user } = useAuth();
  const [history, setHistory] = useState<{ date: string; calories: number; protein: number; carbs: number; fat: number }[]>([]);

  const fetchHistory = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('macro_logs').select('date,calories,protein,carbs,fat').eq('user_id', user.id).order('date', { ascending: false });
    if (!data) return;
    const byDate: Record<string, any> = {};
    data.forEach((row: any) => {
      if (!byDate[row.date]) byDate[row.date] = { date: row.date, calories: 0, protein: 0, carbs: 0, fat: 0 };
      byDate[row.date].calories += row.calories;
      byDate[row.date].protein += row.protein;
      byDate[row.date].carbs += row.carbs;
      byDate[row.date].fat += row.fat;
    });
    setHistory(Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date)));
  }, [user]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}><Text style={s.title}>History</Text></View>
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.sectionTitle}>PAST LOGS</Text>
        {history.length === 0 && <Text style={s.empty}>No history yet.{'\n'}Start logging today!</Text>}
        {history.map(day => {
          const over = day.calories > targets.calories;
          return (
            <View key={day.date} style={s.card}>
              <View style={s.cardTop}>
                <Text style={s.cardDate}>{day.date === todayStr() ? 'Today' : fmtDate(day.date)}</Text>
                <Text style={[s.cardCal, over && s.cardCalOver]}>{Math.round(day.calories)}<Text style={s.cardCalUnit}> kcal</Text></Text>
              </View>
              <View style={s.macroRows}>
                {([
                  { key: 'protein', label: 'Protein', val: day.protein, target: targets.protein },
                  { key: 'carbs', label: 'Carbs', val: day.carbs, target: targets.carbs },
                  { key: 'fat', label: 'Fat', val: day.fat, target: targets.fat },
                ] as const).map(({ key, label, val, target }) => (
                  <View key={key}>
                    <View style={s.macroRowTop}>
                      <Text style={[s.macroLabel, { color: MC[key].color }]}>{label}</Text>
                      <Text style={s.macroVal}>{Math.round(val)}g</Text>
                    </View>
                    <View style={s.barBg}>
                      <View style={[s.barFill, { width: `${pct(val, target)}%` as any, backgroundColor: MC[key].color }]} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#444', letterSpacing: 1.5, marginBottom: 16 },
  empty: { textAlign: 'center', color: '#333', fontSize: 14, paddingVertical: 48, lineHeight: 26, fontWeight: '500' },
  card: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16, marginBottom: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 },
  cardDate: { fontSize: 15, fontWeight: '700', color: '#fff' },
  cardCal: { fontSize: 22, fontWeight: '900', color: '#fff' },
  cardCalOver: { color: '#ff4f4f' },
  cardCalUnit: { fontSize: 11, fontWeight: '600', color: '#555' },
  macroRows: { gap: 10 },
  macroRowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  macroLabel: { fontSize: 11, fontWeight: '700' },
  macroVal: { fontSize: 11, fontWeight: '700', color: '#555' },
  barBg: { backgroundColor: '#2a2a2a', borderRadius: 3, height: 3 },
  barFill: { height: 3, borderRadius: 3 },
});
