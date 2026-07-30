import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';
import { callAI } from '../constants/ai';
import { useAuth } from '../hooks/useAuth';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { toLocalDateString } from '../utils/dateUtils';
import { useAIGate } from '../hooks/useAIGate';

export interface ProgramExercise {
  name: string;
  sets: number;
  reps: string;
  rest_seconds: number;
  notes: string;
  isSuperset: boolean;
  supersetGroup: number | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onStartDay: (exercises: ProgramExercise[], meta: { programId: string; week: number; day: number }) => void;
}

const GOALS = [
  { key: 'muscle_gain', label: 'Muscle Gain' },
  { key: 'strength', label: 'Strength' },
  { key: 'fat_loss', label: 'Fat Loss' },
  { key: 'endurance', label: 'Endurance' },
  { key: 'general', label: 'General Fitness' },
];
const DAYS_OPTIONS = [3, 4, 5, 6];
const EQUIPMENT = [
  { key: 'full_gym', label: 'Full Gym' },
  { key: 'dumbbells_only', label: 'Dumbbells Only' },
  { key: 'bodyweight', label: 'Bodyweight Only' },
];
const EXPERIENCE = [
  { key: 'beginner', label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced', label: 'Advanced' },
];

export default function WorkoutProgramScreen({ visible, onClose, onStartDay }: Props) {
  const { requestAccess, paywall } = useAIGate();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { user } = useAuth();

  const [tab, setTab] = useState<'program' | 'generate'>('program');
  const [activeProgram, setActiveProgram] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [completedToday, setCompletedToday] = useState(false);
  const [showFullProgram, setShowFullProgram] = useState(false);

  const [goal, setGoal] = useState('muscle_gain');
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [equipment, setEquipment] = useState('full_gym');
  const [experience, setExperience] = useState('intermediate');
  const [injuries, setInjuries] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedProgram, setGeneratedProgram] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const loadActiveProgram = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('workout_programs')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();
    setActiveProgram(data ?? null);
    if (data) {
      const today = toLocalDateString();
      const { data: done } = await supabase
        .from('program_completed_days')
        .select('id')
        .eq('user_id', user.id)
        .eq('program_id', data.id)
        .eq('week', data.current_week)
        .eq('day', data.current_day)
        .gte('completed_at', today + 'T00:00:00Z');
      setCompletedToday((done?.length ?? 0) > 0);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (visible) {
      setShowFullProgram(false);
      loadActiveProgram();
    }
  }, [visible, loadActiveProgram]);

  const currentWeekData = activeProgram
    ? (activeProgram.program_data?.weeks ?? []).find((w: any) => w.week === activeProgram.current_week)
    : null;
  const currentDayData = currentWeekData
    ? (currentWeekData.days ?? []).find((d: any) => d.day === activeProgram.current_day)
    : null;

  const handleStartDay = () => {
    if (!currentDayData || !activeProgram) return;
    onStartDay(currentDayData.exercises ?? [], {
      programId: activeProgram.id,
      week: activeProgram.current_week,
      day: activeProgram.current_day,
    });
  };

  const buildPrompt = () => {
    const goalLabel = GOALS.find(g => g.key === goal)?.label ?? goal;
    const equipLabel = EQUIPMENT.find(e => e.key === equipment)?.label ?? equipment;
    const expLabel = EXPERIENCE.find(e => e.key === experience)?.label ?? experience;
    return `Generate a complete 12-week ${goalLabel} workout program for a ${expLabel} level athlete training ${daysPerWeek} days per week with ${equipLabel} access.

Return a JSON object with this exact structure:
{
  "name": string,
  "description": string,
  "weeks": [
    {
      "week": number,
      "theme": string,
      "days": [
        {
          "day": number,
          "name": string,
          "isRest": boolean,
          "exercises": [
            {
              "name": string,
              "sets": number,
              "reps": string,
              "rest_seconds": number,
              "notes": string,
              "isSuperset": boolean,
              "supersetGroup": number | null
            }
          ]
        }
      ]
    }
  ]
}

Requirements:
- Progressive overload: increase volume/intensity each week (periodization)
- Week 4 and 8 should be deload weeks (reduced volume)
- Include warm-up recommendations as notes on first exercise
- For muscle gain: focus on hypertrophy rep ranges (8-15), compound movements first
- For strength: heavier loads, lower reps (3-6), powerlifting movements
- Include supersets where appropriate (mark with isSuperset: true and matching supersetGroup number)
- Avoid: ${injuries.trim() || 'nothing specific'}
- Return ONLY valid JSON with no markdown fences and no explanation text`;
  };

  const generateProgram = async () => {
  // Pro gate: consumes one free trial use, then paywalls.
  if (!(await requestAccess('workout_program'))) return;
    setGenerating(true);
    setGeneratedProgram(null);
    try {
      const response = await callAI([{ role: 'user', content: buildPrompt() }], undefined, 8000);
      const cleaned = response.replace(/```json|```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('No JSON found in response');
      const data = JSON.parse(cleaned.slice(start, end + 1));
      if (!Array.isArray(data.weeks)) throw new Error('Invalid program structure');
      setGeneratedProgram(data);
    } catch {
      Alert.alert('Generation Failed', 'Could not generate program. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const saveGeneratedProgram = async () => {
    if (!generatedProgram || !user) return;
    setSaving(true);
    try {
      await supabase.from('workout_programs')
        .update({ is_active: false })
        .eq('user_id', user.id)
        .eq('is_active', true);
      const { data, error } = await supabase.from('workout_programs').insert({
        user_id: user.id,
        name: generatedProgram.name,
        description: generatedProgram.description ?? '',
        goal,
        days_per_week: daysPerWeek,
        duration_weeks: 12,
        program_data: generatedProgram,
        is_active: true,
        current_week: 1,
        current_day: 1,
      }).select().single();
      if (error) throw error;
      setActiveProgram(data);
      setGeneratedProgram(null);
      setTab('program');
    } catch {
      Alert.alert('Error', 'Could not save program. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const deleteProgram = () => {
    if (!activeProgram) return;
    Alert.alert('Delete Program', 'Delete your current program and start fresh?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('workout_programs').delete().eq('id', activeProgram.id);
          setActiveProgram(null);
          setCompletedToday(false);
        },
      },
    ]);
  };

  const renderMyProgram = () => {
    if (loading) {
      return (
        <View style={s.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      );
    }
    if (!activeProgram) {
      return (
        <View style={s.center}>
          <Text style={s.emptyIcon}></Text>
          <Text style={s.emptyTitle}>No Active Program</Text>
          <Text style={s.emptyDesc}>Generate a 12-week program tailored to your goals.</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => setTab('generate')} activeOpacity={0.85}>
            <Text style={s.primaryBtnText}>Generate My Program →</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const prog = activeProgram;
    const durationWeeks = prog.duration_weeks ?? 12;
    const progPct = Math.min((prog.current_week - 1) / durationWeeks, 1);
    const isRestDay = currentDayData?.isRest ?? false;

    return (
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.weekHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.weekLabel}>WEEK {prog.current_week} OF {durationWeeks}</Text>
            <Text style={s.programName}>{prog.name}</Text>
          </View>
          <TouchableOpacity onPress={deleteProgram} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={s.deleteBtn}>×</Text>
          </TouchableOpacity>
        </View>
        <View style={s.progBg}>
          <View style={[s.progFill, { width: `${Math.round(progPct * 100)}%` as any }]} />
        </View>
        {currentWeekData?.theme ? (
          <Text style={s.weekTheme}>{currentWeekData.theme}</Text>
        ) : null}

        {currentDayData ? (
          <View style={s.dayCard}>
            <Text style={s.dayCardTitle}>
              Week {prog.current_week}, Day {prog.current_day} — {currentDayData.name}
            </Text>
            {isRestDay ? (
              <View style={s.restDay}>
                <Text style={s.restDayIcon}></Text>
                <Text style={s.restDayText}>Rest Day — recover and come back stronger</Text>
              </View>
            ) : (
              <>
                {(currentDayData.exercises ?? []).map((ex: ProgramExercise, i: number) => {
                  const prevEx: ProgramExercise | undefined = i > 0 ? currentDayData.exercises[i - 1] : undefined;
                  const showSupersetLabel = ex.isSuperset && (!prevEx?.isSuperset || prevEx.supersetGroup !== ex.supersetGroup);
                  return (
                    <View key={i}>
                      {showSupersetLabel && <Text style={s.supersetLabel}>SUPERSET</Text>}
                      <View style={[s.exRow, ex.isSuperset && s.exRowSuperset]}>
                        <View style={s.exRowInner}>
                          <Text style={s.exName}>{ex.name}</Text>
                          <Text style={s.exDetail}>{ex.sets} × {ex.reps}</Text>
                        </View>
                        {ex.notes ? <Text style={s.exNotes}>{ex.notes}</Text> : null}
                      </View>
                    </View>
                  );
                })}
                {completedToday ? (
                  <View style={s.completedBadge}>
                    <Text style={s.completedBadgeText}>✓ Already completed today</Text>
                  </View>
                ) : (
                  <TouchableOpacity style={s.startBtn} onPress={handleStartDay} activeOpacity={0.85}>
                    <Text style={s.startBtnText}>▶  Start This Workout</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        ) : null}

        <TouchableOpacity style={s.accordionHeader} onPress={() => setShowFullProgram(v => !v)}>
          <Text style={s.accordionTitle}>View Full Program</Text>
          <Text style={s.accordionArrow}>{showFullProgram ? '▲' : '▾'}</Text>
        </TouchableOpacity>

        {showFullProgram && (
          <View>
            {(prog.program_data?.weeks ?? []).map((week: any) => (
              <View key={week.week} style={s.weekBlock}>
                <Text style={s.weekBlockTitle}>
                  Week {week.week}{week.theme ? ` — ${week.theme}` : ''}
                </Text>
                {(week.days ?? []).map((day: any) => (
                  <View key={day.day} style={s.dayBlock}>
                    <Text style={s.dayBlockTitle}>Day {day.day}: {day.name}</Text>
                    {!day.isRest && (day.exercises ?? []).map((ex: ProgramExercise, ei: number) => (
                      <Text key={ei} style={s.dayBlockEx}>  {ex.name} — {ex.sets}×{ex.reps}</Text>
                    ))}
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    );
  };

  const renderGenerate = () => (
    <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={s.sectionLabel}>GOAL</Text>
      <View style={s.chipRow}>
        {GOALS.map(g => (
          <TouchableOpacity key={g.key} style={[s.chip, goal === g.key && s.chipActive]} onPress={() => setGoal(g.key)}>
            <Text style={[s.chipText, goal === g.key && s.chipTextActive]}>{g.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.sectionLabel}>DAYS PER WEEK</Text>
      <View style={s.chipRow}>
        {DAYS_OPTIONS.map(d => (
          <TouchableOpacity key={d} style={[s.chip, daysPerWeek === d && s.chipActive]} onPress={() => setDaysPerWeek(d)}>
            <Text style={[s.chipText, daysPerWeek === d && s.chipTextActive]}>{d}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.sectionLabel}>EQUIPMENT</Text>
      <View style={s.chipRow}>
        {EQUIPMENT.map(e => (
          <TouchableOpacity key={e.key} style={[s.chip, equipment === e.key && s.chipActive]} onPress={() => setEquipment(e.key)}>
            <Text style={[s.chipText, equipment === e.key && s.chipTextActive]}>{e.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.sectionLabel}>EXPERIENCE</Text>
      <View style={s.chipRow}>
        {EXPERIENCE.map(e => (
          <TouchableOpacity key={e.key} style={[s.chip, experience === e.key && s.chipActive]} onPress={() => setExperience(e.key)}>
            <Text style={[s.chipText, experience === e.key && s.chipTextActive]}>{e.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.sectionLabel}>INJURIES / AVOID (OPTIONAL)</Text>
      <TextInput
        style={s.input}
        value={injuries}
        onChangeText={setInjuries}
        placeholder="e.g. bad left knee, shoulder impingement"
        placeholderTextColor={colors.textTertiary}
        multiline
        numberOfLines={2}
      />

      {generating ? (
        <View style={s.generatingBox}>
          <ActivityIndicator color={colors.accent} size="large" style={{ marginBottom: 16 }} />
          <Text style={s.generatingText}>Building your 12-week program...</Text>
          <Text style={s.generatingSubText}>This takes 15–30 seconds</Text>
        </View>
      ) : (
        <TouchableOpacity style={[s.primaryBtn, { marginTop: 8 }]} onPress={generateProgram} activeOpacity={0.85}>
          <Text style={s.primaryBtnText}> Generate My Program</Text>
        </TouchableOpacity>
      )}

      {generatedProgram && !generating && (
        <View style={s.previewBox}>
          <Text style={s.previewTitle}>{generatedProgram.name}</Text>
          {generatedProgram.description ? (
            <Text style={s.previewDesc}>{generatedProgram.description}</Text>
          ) : null}
          <Text style={s.previewWeekLabel}>WEEK 1 PREVIEW</Text>
          {(generatedProgram.weeks?.[0]?.days ?? []).map((day: any, di: number) => (
            <View key={di} style={s.previewDay}>
              <Text style={s.previewDayName}>Day {day.day}: {day.name}</Text>
              {!day.isRest && (day.exercises ?? []).slice(0, 4).map((ex: ProgramExercise, ei: number) => (
                <Text key={ei} style={s.previewEx}>  {ex.name} — {ex.sets}×{ex.reps}</Text>
              ))}
              {!day.isRest && (day.exercises ?? []).length > 4 && (
                <Text style={s.previewMore}>  +{(day.exercises ?? []).length - 4} more exercises</Text>
              )}
            </View>
          ))}
          <View style={s.previewActions}>
            <TouchableOpacity
              style={[s.primaryBtn, { flex: 1, marginBottom: 0 }]}
              onPress={saveGeneratedProgram}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color={colors.accentText} size="small" />
                : <Text style={s.primaryBtnText}>✓ Start Program</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.secondaryBtn, { flex: 1 }]}
              onPress={generateProgram}
              disabled={generating}
              activeOpacity={0.85}
            >
              <Text style={s.secondaryBtnText}>↻ Regenerate</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );

  return (
    <>
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Programs</Text>
          <TouchableOpacity style={s.closeBtn} onPress={onClose}>
            <Text style={s.closeBtnText}>Done</Text>
          </TouchableOpacity>
        </View>

        <View style={s.tabBar}>
          <TouchableOpacity style={[s.tabBtn, tab === 'program' && s.tabBtnActive]} onPress={() => setTab('program')}>
            <Text style={[s.tabBtnText, tab === 'program' && s.tabBtnTextActive]}>My Program</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tabBtn, tab === 'generate' && s.tabBtnActive]} onPress={() => setTab('generate')}>
            <Text style={[s.tabBtnText, tab === 'generate' && s.tabBtnTextActive]}>Generate</Text>
          </TouchableOpacity>
        </View>

        {tab === 'program' ? renderMyProgram() : renderGenerate()}
      </SafeAreaView>
    </Modal>
      {paywall}
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    headerTitle: { fontSize: 20, fontWeight: weight.heavy, color: c.text },
    closeBtn: { backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
    closeBtnText: { color: c.accentText, fontSize: 14, fontWeight: weight.heavy },
    tabBar: {
      flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border,
      paddingHorizontal: spacing.xl,
    },
    tabBtn: { paddingVertical: 12, paddingHorizontal: 4, marginRight: 20, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabBtnActive: { borderBottomColor: c.accent },
    tabBtnText: { fontSize: 14, fontWeight: weight.bold, color: c.textTertiary },
    tabBtnTextActive: { color: c.accent },
    scroll: { flex: 1 },
    content: { padding: spacing.xl, paddingBottom: 48 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl * 1.5 },
    emptyIcon: { fontSize: 52, marginBottom: 16 },
    emptyTitle: { fontSize: 20, fontWeight: weight.heavy, color: c.text, marginBottom: 8, textAlign: 'center' },
    emptyDesc: { fontSize: 14, color: c.textTertiary, fontWeight: weight.medium, textAlign: 'center', marginBottom: 28, lineHeight: 22 },
    primaryBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 16, alignItems: 'center', marginBottom: 12 },
    primaryBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.heavy },
    secondaryBtn: { backgroundColor: c.card, borderRadius: radius.md, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: c.border },
    secondaryBtnText: { color: c.text, fontSize: 15, fontWeight: weight.bold },
    weekHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
    weekLabel: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5, marginBottom: 4 },
    programName: { fontSize: 20, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    deleteBtn: { color: c.textTertiary, fontSize: 26, paddingLeft: 12 },
    progBg: { backgroundColor: c.border, borderRadius: 4, height: 6, marginBottom: 8 },
    progFill: { backgroundColor: c.accent, borderRadius: 4, height: 6 },
    weekTheme: { fontSize: 12, color: c.textTertiary, fontWeight: weight.semibold, marginBottom: 20, fontStyle: 'italic' },
    dayCard: { backgroundColor: c.card, borderRadius: radius.card, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: c.border },
    dayCardTitle: { fontSize: 16, fontWeight: weight.heavy, color: c.text, marginBottom: 14, letterSpacing: -0.3 },
    restDay: { alignItems: 'center', paddingVertical: 20 },
    restDayIcon: { fontSize: 36, marginBottom: 10 },
    restDayText: { fontSize: 14, color: c.textTertiary, textAlign: 'center', fontWeight: weight.medium },
    exRow: { paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.border },
    exRowSuperset: { paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: c.accent, marginLeft: 2 },
    exRowInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    exName: { fontSize: 14, fontWeight: weight.bold, color: c.text, flex: 1, marginRight: 8 },
    exDetail: { fontSize: 13, fontWeight: weight.heavy, color: c.accent },
    exNotes: { fontSize: 11, color: c.textTertiary, fontWeight: weight.medium, marginTop: 3, fontStyle: 'italic' },
    supersetLabel: { fontSize: 9, fontWeight: weight.heavy, color: c.accent, letterSpacing: 1.5, marginTop: 8, marginBottom: 2 },
    completedBadge: { backgroundColor: c.accentMuted, borderRadius: radius.md, padding: 14, alignItems: 'center', marginTop: 14 },
    completedBadgeText: { color: c.accent, fontSize: 14, fontWeight: weight.bold },
    startBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 14, alignItems: 'center', marginTop: 14 },
    startBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.heavy },
    accordionHeader: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.border,
    },
    accordionTitle: { fontSize: 14, fontWeight: weight.bold, color: c.textSecondary },
    accordionArrow: { fontSize: 14, color: c.textTertiary },
    weekBlock: { marginBottom: 16 },
    weekBlockTitle: { fontSize: 13, fontWeight: weight.heavy, color: c.text, marginBottom: 8, letterSpacing: -0.2 },
    dayBlock: { backgroundColor: c.card, borderRadius: radius.md, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: c.border },
    dayBlockTitle: { fontSize: 13, fontWeight: weight.bold, color: c.textSecondary, marginBottom: 4 },
    dayBlockEx: { fontSize: 12, color: c.textTertiary, fontWeight: weight.medium, marginBottom: 2 },
    sectionLabel: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5, marginBottom: 10, marginTop: 20 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
    chip: { backgroundColor: c.card, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: c.border },
    chipActive: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { fontSize: 13, fontWeight: weight.bold, color: c.textTertiary },
    chipTextActive: { color: c.accentText },
    input: {
      backgroundColor: c.card, borderRadius: radius.md, color: c.text,
      padding: 14, fontSize: 14, marginBottom: 8, borderWidth: 1, borderColor: c.border,
      minHeight: 60, textAlignVertical: 'top',
    },
    generatingBox: { alignItems: 'center', paddingVertical: 40 },
    generatingText: { fontSize: 16, fontWeight: weight.bold, color: c.text, marginBottom: 6 },
    generatingSubText: { fontSize: 13, color: c.textTertiary, fontWeight: weight.medium },
    previewBox: { backgroundColor: c.card, borderRadius: radius.card, padding: 16, marginTop: 20, borderWidth: 1, borderColor: c.accent + '44' },
    previewTitle: { fontSize: 18, fontWeight: weight.heavy, color: c.text, marginBottom: 6, letterSpacing: -0.5 },
    previewDesc: { fontSize: 13, color: c.textTertiary, marginBottom: 16, lineHeight: 20, fontWeight: weight.medium },
    previewWeekLabel: { fontSize: 10, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5, marginBottom: 10 },
    previewDay: { marginBottom: 12 },
    previewDayName: { fontSize: 14, fontWeight: weight.bold, color: c.textSecondary, marginBottom: 4 },
    previewEx: { fontSize: 12, color: c.textTertiary, fontWeight: weight.medium, marginBottom: 2 },
    previewMore: { fontSize: 12, color: c.textTertiary, fontStyle: 'italic' },
    previewActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  });
}
