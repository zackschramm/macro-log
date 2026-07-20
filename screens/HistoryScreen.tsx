import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { MC } from '../constants/data';
import { toLocalDateString } from '../utils/dateUtils';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';

const todayStr = () => toLocalDateString();
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const pct = (v: number, t: number) => Math.min(100, Math.round((v / (t || 1)) * 100));

export default function HistoryScreen({ targets }: { targets: { calories: number; protein: number; carbs: number; fat: number } }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
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

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
    title: { fontSize: 28, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: 40 },
    sectionTitle: { fontSize: 11, fontWeight: weight.semibold, color: c.textSecondary, letterSpacing: 1.5, marginBottom: spacing.lg, textTransform: 'uppercase' },
    empty: { textAlign: 'center', color: c.textTertiary, fontSize: 14, paddingVertical: 48, lineHeight: 26, fontWeight: weight.medium },
    card: { backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 },
    cardDate: { fontSize: 15, fontWeight: weight.bold, color: c.text },
    cardCal: { fontSize: 22, fontWeight: weight.heavy, color: c.text },
    cardCalOver: { color: c.danger },
    cardCalUnit: { fontSize: 11, fontWeight: weight.semibold, color: c.textTertiary },
    macroRows: { gap: 10 },
    macroRowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
    macroLabel: { fontSize: 11, fontWeight: weight.semibold },
    macroVal: { fontSize: 11, fontWeight: weight.semibold, color: c.textTertiary },
    barBg: { backgroundColor: c.border, borderRadius: 3, height: 3 },
    barFill: { height: 3, borderRadius: 3 },
  });
}
