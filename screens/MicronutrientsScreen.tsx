import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { callAI } from '../constants/ai';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { toLocalDateString } from '../utils/dateUtils';
import { useAIGate } from '../hooks/useAIGate';

type MicroKey =
  | 'fiber_g' | 'calcium_mg' | 'iron_mg' | 'vitamin_d_mcg' | 'vitamin_c_mg'
  | 'vitamin_b12_mcg' | 'magnesium_mg' | 'zinc_mg' | 'potassium_mg' | 'omega3_g';

interface NutrientDef {
  key: MicroKey;
  label: string;
  unit: string;
  defaultTarget: number;
}

const NUTRIENTS: NutrientDef[] = [
  { key: 'fiber_g',         label: 'Fiber',       unit: 'g',   defaultTarget: 25 },
  { key: 'calcium_mg',      label: 'Calcium',     unit: 'mg',  defaultTarget: 1000 },
  { key: 'iron_mg',         label: 'Iron',        unit: 'mg',  defaultTarget: 18 },
  { key: 'vitamin_d_mcg',   label: 'Vitamin D',   unit: 'mcg', defaultTarget: 15 },
  { key: 'vitamin_b12_mcg', label: 'Vitamin B12', unit: 'mcg', defaultTarget: 2.4 },
  { key: 'magnesium_mg',    label: 'Magnesium',   unit: 'mg',  defaultTarget: 320 },
  { key: 'zinc_mg',         label: 'Zinc',        unit: 'mg',  defaultTarget: 8 },
  { key: 'potassium_mg',    label: 'Potassium',   unit: 'mg',  defaultTarget: 2600 },
  { key: 'omega3_g',        label: 'Omega-3',     unit: 'g',   defaultTarget: 1.1 },
];

const DEFAULT_TARGETS = Object.fromEntries(
  NUTRIENTS.map(n => [n.key, n.defaultTarget])
) as Record<MicroKey, number>;

type FoodRow = { food: string } & Partial<Record<MicroKey, number | null>>;
type DayRow  = { date: string } & Partial<Record<MicroKey, number | null>>;

const MICRO_SELECT =
  'fiber_g,calcium_mg,iron_mg,vitamin_d_mcg,vitamin_c_mg,vitamin_b12_mcg,magnesium_mg,zinc_mg,potassium_mg,omega3_g';

export default function MicronutrientsScreen({
  date,
  onBack,
}: {
  date: string;
  onBack: () => void;
}) {
  const { requestAccess, paywall } = useAIGate();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { user } = useAuth();

  const [viewMode, setViewMode] = useState<'today' | 'week'>('today');
  const [loading, setLoading] = useState(true);
  const [todayRows, setTodayRows] = useState<FoodRow[]>([]);
  const [weeklyAvg, setWeeklyAvg] = useState<Partial<Record<MicroKey, number>>>({});
  const [targets, setTargets] = useState<Record<MicroKey, number>>(DEFAULT_TARGETS);
  const [expanded, setExpanded] = useState<MicroKey | null>(null);
  const [tips, setTips] = useState<Partial<Record<MicroKey, string>>>({});
  const [loadingTip, setLoadingTip] = useState<MicroKey | null>(null);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = toLocalDateString(sevenDaysAgo);

    const [todayRes, weekRes, targetsRes] = await Promise.allSettled([
      supabase.from('macro_logs')
        .select(`food,${MICRO_SELECT}`)
        .eq('user_id', user.id)
        .eq('date', date),
      supabase.from('macro_logs')
        .select(`date,${MICRO_SELECT}`)
        .eq('user_id', user.id)
        .gte('date', sevenDaysAgoStr),
      supabase.from('micronutrient_targets')
        .select('*')
        .eq('user_id', user.id)
        .single(),
    ]);

    if (todayRes.status === 'fulfilled' && todayRes.value.data) {
      setTodayRows(todayRes.value.data as FoodRow[]);
    }

    if (weekRes.status === 'fulfilled' && weekRes.value.data) {
      const rows = weekRes.value.data as DayRow[];
      const byDay: Record<string, Partial<Record<MicroKey, number>>> = {};
      rows.forEach(r => {
        if (!byDay[r.date]) byDay[r.date] = {};
        NUTRIENTS.forEach(n => {
          const v = r[n.key] as number | null | undefined;
          if (v != null && v > 0) byDay[r.date][n.key] = (byDay[r.date][n.key] ?? 0) + v;
        });
      });
      const days = Object.values(byDay);
      if (days.length > 0) {
        const avg: Partial<Record<MicroKey, number>> = {};
        NUTRIENTS.forEach(n => {
          const total = days.reduce((s, d) => s + (d[n.key] ?? 0), 0);
          if (total > 0) avg[n.key] = Math.round((total / days.length) * 10) / 10;
        });
        setWeeklyAvg(avg);
      }
    }

    if (targetsRes.status === 'fulfilled' && targetsRes.value.data) {
      const t = targetsRes.value.data as any;
      setTargets(prev => ({
        ...prev,
        ...Object.fromEntries(
          NUTRIENTS.filter(n => t[n.key] != null).map(n => [n.key, t[n.key]])
        ),
      }));
    }

    setLoading(false);
  }, [user, date]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const todayTotals = useMemo(() => {
    const totals: Partial<Record<MicroKey, number>> = {};
    NUTRIENTS.forEach(n => {
      const sum = todayRows.reduce((s, r) => {
        const v = r[n.key] as number | null | undefined;
        return s + (v != null && v > 0 ? v : 0);
      }, 0);
      if (sum > 0) totals[n.key] = Math.round(sum * 10) / 10;
    });
    return totals;
  }, [todayRows]);

  const fetchTip = async (n: NutrientDef) => {
  // Pro gate: consumes one free trial use, then paywalls.
  if (!(await requestAccess('micronutrients'))) return;
    if (tips[n.key] !== undefined || loadingTip === n.key) return;
    setLoadingTip(n.key);
    try {
      const sources = todayRows
        .filter(r => (r[n.key] as number | null | undefined) != null && (r[n.key] as number) > 0)
        .sort((a, b) => ((b[n.key] as number) ?? 0) - ((a[n.key] as number) ?? 0))
        .slice(0, 3)
        .map(r => r.food)
        .join(', ');
      const prompt = sources
        ? `User had ${n.label} from: ${sources}. In one sentence (max 15 words), name 2-3 great food sources of ${n.label}.`
        : `In one sentence (max 15 words), name 2-3 of the best food sources of ${n.label}.`;
      const text = await callAI([{ role: 'user', content: prompt }], undefined, 100);
      setTips(prev => ({ ...prev, [n.key]: text.trim() }));
    } catch {
      setTips(prev => ({ ...prev, [n.key]: '' }));
    }
    setLoadingTip(null);
  };

  const handleExpand = (n: NutrientDef) => {
    const next = expanded === n.key ? null : n.key;
    setExpanded(next);
    if (next) fetchTip(n);
  };

  const currentValues = viewMode === 'today' ? todayTotals : weeklyAvg;

  return (
    <>
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>Micronutrients</Text>
        <View style={s.toggle}>
          <TouchableOpacity
            style={[s.toggleBtn, viewMode === 'today' && s.toggleBtnActive]}
            onPress={() => setViewMode('today')}
          >
            <Text style={[s.toggleText, viewMode === 'today' && s.toggleTextActive]}>Today</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.toggleBtn, viewMode === 'week' && s.toggleBtnActive]}
            onPress={() => setViewMode('week')}
          >
            <Text style={[s.toggleText, viewMode === 'week' && s.toggleTextActive]}>7-Day Avg</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={s.centerLoad}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {viewMode === 'week' && (
            <Text style={s.weekNote}>
              Average daily intake over the last 7 days. Only nutrients with logged data are shown.
            </Text>
          )}
          {NUTRIENTS.map(n => {
            const value = currentValues[n.key] ?? 0;
            const target = targets[n.key];
            const pct = target > 0 && value > 0 ? Math.min(value / target, 1) : 0;
            const hasData = value > 0;
            const barColor = pct >= 0.8 ? colors.accent : pct >= 0.5 ? colors.warning : colors.danger;
            const isOpen = expanded === n.key;

            const contributors = todayRows
              .filter(r => {
                const v = r[n.key] as number | null | undefined;
                return v != null && v > 0;
              })
              .sort((a, b) => ((b[n.key] as number) ?? 0) - ((a[n.key] as number) ?? 0));

            return (
              <TouchableOpacity
                key={n.key}
                style={s.row}
                onPress={() => handleExpand(n)}
                activeOpacity={0.7}
              >
                <View style={s.rowTop}>
                  <Text style={s.nutrientLabel}>{n.label}</Text>
                  <View style={s.rowRight}>
                    <Text style={s.valueText}>
                      {hasData ? `${value}${n.unit}` : '—'}{' '}
                      <Text style={s.targetText}>/ {target}{n.unit}</Text>
                    </Text>
                    <Text style={s.chevron}>{isOpen ? '▲' : '▼'}</Text>
                  </View>
                </View>
                <View style={s.barBg}>
                  {hasData && (
                    <View
                      style={[s.barFill, { width: `${pct * 100}%` as any, backgroundColor: barColor }]}
                    />
                  )}
                </View>

                {isOpen && (
                  <View style={s.expanded}>
                    {viewMode === 'today' && contributors.length > 0 && (
                      <>
                        <Text style={s.sourceLabel}>Today's sources</Text>
                        {contributors.map((r, i) => (
                          <Text key={i} style={s.sourceItem}>
                            · {r.food}
                            {'  '}
                            <Text style={s.sourceAmt}>
                              {Math.round(((r[n.key] as number) ?? 0) * 10) / 10}{n.unit}
                            </Text>
                          </Text>
                        ))}
                      </>
                    )}
                    {viewMode === 'today' && contributors.length === 0 && (
                      <Text style={s.noData}>No {n.label} logged today.</Text>
                    )}
                    {loadingTip === n.key ? (
                      <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 10 }} />
                    ) : tips[n.key] ? (
                      <Text style={s.tip}>{tips[n.key]}</Text>
                    ) : null}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
      {paywall}
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe:            { flex: 1, backgroundColor: c.bg },
    header:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border, gap: 12 },
    back:            { fontSize: 22, color: c.text, fontWeight: weight.bold, paddingRight: 4 },
    title:           { flex: 1, fontSize: 20, fontWeight: weight.heavy, color: c.text },
    toggle:          { flexDirection: 'row', backgroundColor: c.cardAlt, borderRadius: radius.pill, padding: 3 },
    toggleBtn:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
    toggleBtnActive: { backgroundColor: c.accent },
    toggleText:      { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary },
    toggleTextActive:{ color: c.accentText },
    centerLoad:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll:          { flex: 1 },
    content:         { padding: spacing.lg, paddingBottom: 40, gap: 8 },
    weekNote:        { fontSize: 12, color: c.textTertiary, fontWeight: weight.medium, marginBottom: 4, lineHeight: 18 },
    row:             { backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg, borderWidth: 1, borderColor: c.border },
    rowTop:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    nutrientLabel:   { fontSize: 14, fontWeight: weight.bold, color: c.text },
    rowRight:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
    valueText:       { fontSize: 12, color: c.text, fontWeight: weight.semibold },
    targetText:      { color: c.textTertiary, fontWeight: weight.regular },
    chevron:         { fontSize: 10, color: c.textTertiary },
    barBg:           { height: 6, backgroundColor: c.cardAlt, borderRadius: radius.pill, overflow: 'hidden' },
    barFill:         { height: '100%' as any, borderRadius: radius.pill },
    expanded:        { marginTop: 12, gap: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border },
    sourceLabel:     { fontSize: 11, fontWeight: weight.semibold, color: c.textTertiary, letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' },
    sourceItem:      { fontSize: 13, color: c.textSecondary, fontWeight: weight.medium, paddingLeft: 4 },
    sourceAmt:       { color: c.textTertiary },
    noData:          { fontSize: 13, color: c.textTertiary, fontStyle: 'italic' },
    tip:             { fontSize: 13, color: c.accent, fontWeight: weight.medium, marginTop: 8, lineHeight: 18 },
  });
}
