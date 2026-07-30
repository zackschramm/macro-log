import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, TextInput, Alert, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { useTheme, spacing, radius, weight } from '../constants/theme';
import { toLocalDateString } from '../utils/dateUtils';
import { logError } from '../utils/logError';

type CycleSettings = {
  cycle_length_days: number;
  period_length_days: number;
  last_period_start: string;
  tracking_enabled: boolean;
};

type CycleLog = {
  date: string;
  phase: string | null;
  period_day: number | null;
  flow_intensity: string | null;
  symptoms: string[];
  energy_level: number | null;
};

type PhaseInfo = {
  name: string;
  emoji: string;
  day: number;
  totalDays: number;
  daysUntilPeriod: number;
};

const SYMPTOMS = ['cramps', 'bloating', 'fatigue', 'headache', 'mood changes'];

const PHASE_COLORS: Record<string, string> = {
  Menstrual: '#FF4444',
  Follicular: '#C8FF3D',
  Ovulation: '#00C8B0',
  Luteal: '#9B59B6',
};

const PHASE_INSIGHTS: Record<string, { training: string; nutrition: string }> = {
  Menstrual: {
    training: 'Focus on restorative movement — yoga, walking, or light cardio. Reduce high-intensity training.',
    nutrition: 'Prioritise iron-rich foods (red meat, spinach, legumes) to replenish iron lost during menstruation.',
  },
  Follicular: {
    training: 'Energy is rising. Great time for strength training, progressive overload, and high-intensity sessions.',
    nutrition: 'Focus on lean protein and complex carbs to fuel increasing activity. Your insulin sensitivity is higher.',
  },
  Ovulation: {
    training: 'Peak strength and energy. Best time for personal records and maximal efforts.',
    nutrition: 'Maintain high protein intake. You may tolerate slightly more carbs well during this phase.',
  },
  Luteal: {
    training: 'Progesterone rises — taper intensity. Moderate workouts and strength training still effective.',
    nutrition: 'You may need 100–300 more calories. Carb cravings are normal and hormonal. Focus on complex carbs and magnesium.',
  },
};

function computePhase(lastPeriodStart: string, cycleLength: number, periodLength: number): PhaseInfo {
  const start = new Date(lastPeriodStart + 'T12:00:00');
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const daysDiff = Math.floor((today.getTime() - start.getTime()) / 86400000);
  const cycleDay = (daysDiff % cycleLength) + 1;
  const daysUntilPeriod = cycleLength - cycleDay + 1;

  let name: string, emoji: string;
  if (cycleDay <= periodLength) { name = 'Menstrual'; emoji = ''; }
  else if (cycleDay <= 13) { name = 'Follicular'; emoji = ''; }
  else if (cycleDay <= 16) { name = 'Ovulation'; emoji = ''; }
  else { name = 'Luteal'; emoji = ''; }

  return { name, emoji, day: cycleDay, totalDays: cycleLength, daysUntilPeriod };
}

function getPhaseForDay(cycleDay: number, periodLength: number): string {
  if (cycleDay <= periodLength) return 'Menstrual';
  if (cycleDay <= 13) return 'Follicular';
  if (cycleDay <= 16) return 'Ovulation';
  return 'Luteal';
}

export default function CycleTrackingScreen({
  onClose,
  onNavigateToCoach,
}: {
  onClose: () => void;
  onNavigateToCoach?: () => void;
}) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(colors);
  const [settings, setSettings] = useState<CycleSettings | null>(null);
  const [phase, setPhase] = useState<PhaseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [calendarMonth, setCalendarMonth] = useState(new Date());

  // Log modal state
  const [showLogModal, setShowLogModal] = useState(false);
  const [logIsPeriod, setLogIsPeriod] = useState(false);
  const [logFlow, setLogFlow] = useState<string | null>(null);
  const [logSymptoms, setLogSymptoms] = useState<string[]>([]);
  const [logEnergy, setLogEnergy] = useState<number>(3);
  const [logNotes, setLogNotes] = useState('');
  const [savingLog, setSavingLog] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('cycle_settings')
        .select('cycle_length_days,period_length_days,last_period_start,tracking_enabled')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data) {
        setSettings(data as CycleSettings);
        if (data.tracking_enabled && data.last_period_start) {
          setPhase(computePhase(data.last_period_start, data.cycle_length_days, data.period_length_days));
        }
      }
    } catch (e) { logError('CycleTrackingScreen.CycleTrackingScreen', e); }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const handleSaveLog = async () => {
    if (!user?.id) return;
    setSavingLog(true);
    const today = toLocalDateString();
    try {
      await supabase.from('cycle_logs').upsert({
        user_id: user.id,
        date: today,
        phase: phase?.name ?? null,
        period_day: logIsPeriod ? (phase?.day ?? 1) : null,
        flow_intensity: logIsPeriod ? logFlow : null,
        symptoms: logSymptoms,
        energy_level: logEnergy,
        notes: logNotes || null,
      }, { onConflict: 'user_id,date' });
      setShowLogModal(false);
      setLogIsPeriod(false);
      setLogFlow(null);
      setLogSymptoms([]);
      setLogEnergy(3);
      setLogNotes('');
    } catch {
      Alert.alert('Error', 'Could not save log. Please try again.');
    }
    setSavingLog(false);
  };

  // Calendar grid helpers
  const calYear = calendarMonth.getFullYear();
  const calMonthIdx = calendarMonth.getMonth();
  const firstDay = new Date(calYear, calMonthIdx, 1).getDay();
  const daysInMonth = new Date(calYear, calMonthIdx + 1, 0).getDate();
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function getDayPhase(dayNum: number): string | null {
    if (!settings?.last_period_start) return null;
    const cellDate = new Date(calYear, calMonthIdx, dayNum);
    cellDate.setHours(12, 0, 0, 0);
    const periodStart = new Date(settings.last_period_start + 'T12:00:00');
    const daysDiff = Math.floor((cellDate.getTime() - periodStart.getTime()) / 86400000);
    if (daysDiff < 0) return null;
    const cycleDay = (daysDiff % settings.cycle_length_days) + 1;
    return getPhaseForDay(cycleDay, settings.period_length_days);
  }

  const today = new Date();
  const todayNum = today.getDate();
  const isCurrentMonth = today.getFullYear() === calYear && today.getMonth() === calMonthIdx;

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Text style={s.title}>Cycle Tracking</Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.text} size="large" />
        </View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* Overview */}
          {phase ? (
            <View style={[s.phaseCard, { borderColor: PHASE_COLORS[phase.name] + '60' }]}>
              <View style={s.phaseRow}>
                <View>
                  <Text style={s.phaseEmoji}>{phase.emoji} {phase.name}</Text>
                  <Text style={s.phaseDay}>Day {phase.day} of {phase.totalDays}</Text>
                </View>
                <View style={s.daysUntilBlock}>
                  <Text style={[s.daysUntilNum, { color: PHASE_COLORS[phase.name] }]}>{phase.daysUntilPeriod}</Text>
                  <Text style={s.daysUntilLabel}>days until{'\n'}next period</Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={s.noSettingsCard}>
              <Text style={s.noSettingsText}>No cycle data set up. Enable cycle tracking in Profile → Cycle Tracking.</Text>
            </View>
          )}

          {/* Calendar */}
          <View style={s.calendarCard}>
            <View style={s.calHeader}>
              <TouchableOpacity
                onPress={() => setCalendarMonth(new Date(calYear, calMonthIdx - 1, 1))}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              <Text style={s.calMonthLabel}>{MONTH_NAMES[calMonthIdx]} {calYear}</Text>
              <TouchableOpacity
                onPress={() => setCalendarMonth(new Date(calYear, calMonthIdx + 1, 1))}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={s.calDayHeaders}>
              {['S','M','T','W','T','F','S'].map((d, i) => (
                <Text key={i} style={s.calDayHeader}>{d}</Text>
              ))}
            </View>
            <View style={s.calGrid}>
              {cells.map((day, i) => {
                if (!day) return <View key={i} style={s.calCell} />;
                const dayPhase = getDayPhase(day);
                const phaseColor = dayPhase ? PHASE_COLORS[dayPhase] : null;
                const isToday = isCurrentMonth && day === todayNum;
                return (
                  <View key={i} style={s.calCell}>
                    <View style={[
                      s.calDot,
                      phaseColor ? { backgroundColor: phaseColor + '30', borderColor: phaseColor + '60', borderWidth: 1 } : {},
                      isToday ? { borderColor: colors.accent, borderWidth: 2 } : {},
                    ]}>
                      <Text style={[s.calDayNum, isToday && { color: colors.accent, fontWeight: weight.bold }]}>
                        {day}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
            {/* Legend */}
            <View style={s.legendRow}>
              {Object.entries(PHASE_COLORS).map(([name, color]) => (
                <View key={name} style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: color }]} />
                  <Text style={s.legendText}>{name}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Phase insights */}
          {phase && PHASE_INSIGHTS[phase.name] && (
            <View style={s.insightsCard}>
              <Text style={s.sectionLabel}>{phase.emoji} {phase.name.toUpperCase()} PHASE INSIGHTS</Text>
              <View style={s.insightBlock}>
                <Text style={s.insightCategory}>Training</Text>
                <Text style={s.insightText}>{PHASE_INSIGHTS[phase.name].training}</Text>
              </View>
              <View style={[s.insightBlock, { marginTop: 12 }]}>
                <Text style={s.insightCategory}>Nutrition</Text>
                <Text style={s.insightText}>{PHASE_INSIGHTS[phase.name].nutrition}</Text>
              </View>
            </View>
          )}

          {/* Log Today */}
          <TouchableOpacity style={s.logBtn} onPress={() => setShowLogModal(true)} activeOpacity={0.8}>
            <Ionicons name="add-circle-outline" size={16} color={colors.accentText} /><Text style={s.logBtnText}>Log Today</Text>
          </TouchableOpacity>

          {/* Ask Coach */}
          <TouchableOpacity style={s.coachBtn} onPress={onNavigateToCoach} activeOpacity={0.8}>
            <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.accent} /><Text style={s.coachBtnText}>Ask Coach About My Cycle</Text>
          </TouchableOpacity>

        </ScrollView>
      )}

      {/* Log Modal */}
      <Modal visible={showLogModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowLogModal(false)}>
        <SafeAreaView style={s.safe}>
          <View style={s.header}>
            <Text style={s.title}>Log Today</Text>
            <TouchableOpacity onPress={() => setShowLogModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>

            {/* Period toggle */}
            <View style={s.logSection}>
              <Text style={s.sectionLabel}>PERIOD DAY?</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                {['Yes', 'No'].map(opt => (
                  <TouchableOpacity
                    key={opt}
                    style={[s.toggleChip, (opt === 'Yes') === logIsPeriod && s.toggleChipActive]}
                    onPress={() => setLogIsPeriod(opt === 'Yes')}
                  >
                    <Text style={[(opt === 'Yes') === logIsPeriod ? s.toggleChipTextActive : s.toggleChipText]}>{opt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Flow intensity (period days only) */}
            {logIsPeriod && (
              <View style={s.logSection}>
                <Text style={s.sectionLabel}>FLOW</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                  {['light', 'medium', 'heavy'].map(f => (
                    <TouchableOpacity
                      key={f}
                      style={[s.toggleChip, logFlow === f && s.toggleChipActive]}
                      onPress={() => setLogFlow(f)}
                    >
                      <Text style={[logFlow === f ? s.toggleChipTextActive : s.toggleChipText]}>
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* Symptoms */}
            <View style={s.logSection}>
              <Text style={s.sectionLabel}>SYMPTOMS</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {SYMPTOMS.map(sym => {
                  const active = logSymptoms.includes(sym);
                  return (
                    <TouchableOpacity
                      key={sym}
                      style={[s.toggleChip, active && s.toggleChipActive]}
                      onPress={() => setLogSymptoms(prev =>
                        active ? prev.filter(s => s !== sym) : [...prev, sym]
                      )}
                    >
                      <Text style={[active ? s.toggleChipTextActive : s.toggleChipText]}>
                        {sym}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Energy */}
            <View style={s.logSection}>
              <Text style={s.sectionLabel}>ENERGY LEVEL</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <TouchableOpacity
                    key={n}
                    style={[s.energyBtn, logEnergy === n && s.energyBtnActive]}
                    onPress={() => setLogEnergy(n)}
                  >
                    <Text style={[s.energyBtnText, logEnergy === n && s.energyBtnTextActive]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[s.legendText, { marginTop: 6 }]}>1 = Very Low  ·  5 = High</Text>
            </View>

            {/* Notes */}
            <View style={s.logSection}>
              <Text style={s.sectionLabel}>NOTES (OPTIONAL)</Text>
              <TextInput
                style={s.notesInput}
                value={logNotes}
                onChangeText={setLogNotes}
                placeholder="How are you feeling today?"
                placeholderTextColor="#444"
                multiline
                numberOfLines={3}
              />
            </View>

            <TouchableOpacity style={s.saveLogBtn} onPress={handleSaveLog} disabled={savingLog} activeOpacity={0.8}>
              {savingLog
                ? <ActivityIndicator color="#000" />
                : <Text style={s.saveLogBtnText}>Save Log</Text>
              }
            </TouchableOpacity>

          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: { fontSize: 22, fontWeight: weight.bold, color: colors.text },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    scroll: { flex: 1 },
    content: { padding: 20, gap: 16, paddingBottom: 40 },
    sectionLabel: {
      fontSize: 10,
      fontWeight: weight.bold,
      color: colors.textTertiary,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },
    phaseCard: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      borderWidth: 1.5,
    },
    phaseRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    phaseEmoji: { fontSize: 24, fontWeight: weight.heavy, color: colors.text },
    phaseDay: { fontSize: 14, color: colors.textTertiary, marginTop: 4 },
    daysUntilBlock: { alignItems: 'flex-end' },
    daysUntilNum: { fontSize: 36, fontWeight: weight.heavy },
    daysUntilLabel: { fontSize: 11, color: colors.textTertiary, textAlign: 'right', lineHeight: 15 },
    noSettingsCard: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    noSettingsText: { fontSize: 14, color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
    calendarCard: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    calHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    calMonthLabel: { fontSize: 16, fontWeight: weight.semibold, color: colors.text },
    calDayHeaders: { flexDirection: 'row', marginBottom: 6 },
    calDayHeader: { flex: 1, textAlign: 'center', fontSize: 11, color: colors.textTertiary, fontWeight: weight.semibold },
    calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    calCell: { width: '14.285714%', alignItems: 'center', paddingVertical: 3 },
    calDot: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
    calDayNum: { fontSize: 12, color: colors.textSecondary },
    legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12, justifyContent: 'center' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { fontSize: 11, color: colors.textTertiary },
    insightsCard: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 8,
    },
    insightBlock: {},
    insightCategory: { fontSize: 13, fontWeight: weight.semibold, color: colors.text, marginBottom: 4 },
    insightText: { fontSize: 13, color: colors.textSecondary, lineHeight: 20 },
    logBtn: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    },
    logBtnText: { fontSize: 16, fontWeight: weight.semibold, color: colors.text },
    coachBtn: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.accent,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    },
    coachBtnText: { fontSize: 16, fontWeight: weight.semibold, color: colors.accent },
    logSection: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    toggleChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgSecondary,
    },
    toggleChipActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    toggleChipText: { fontSize: 13, color: colors.textSecondary, fontWeight: weight.medium },
    toggleChipTextActive: { fontSize: 13, color: '#000', fontWeight: weight.semibold },
    energyBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.bgSecondary,
    },
    energyBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    energyBtnText: { fontSize: 16, fontWeight: weight.semibold, color: colors.textSecondary },
    energyBtnTextActive: { color: '#000' },
    notesInput: {
      marginTop: 10,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      color: colors.text,
      fontSize: 14,
      minHeight: 72,
      textAlignVertical: 'top',
    },
    saveLogBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.card,
      padding: spacing.lg,
      alignItems: 'center',
    },
    saveLogBtnText: { fontSize: 16, fontWeight: weight.bold, color: '#000' },
  });
}
