import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Modal, Alert, ActivityIndicator, Platform, Animated, Share,
} from 'react-native';
import { Audio } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { useRestTimer } from '../contexts/RestTimerContext';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { PRESET_PROGRAMS } from '../constants/programs';
import CoachScreen from './CoachScreen';
import { callAI } from '../constants/ai';
import { getSportProfile } from '../constants/sportProfiles';
import { publishTodaySessions } from '../utils/sessionMapping';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useHealthKit, HealthKitWorkout, WeeklyTrainingLoad, STORAGE_PREFERRED_TRACKER, buildSourcePrefs } from '../hooks/useHealthKit';
import { useUnits } from '../constants/units';
import PaywallScreen from './PaywallScreen';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import ExerciseHistoryModal from '../components/ExerciseHistoryModal';
import WorkoutProgramScreen, { ProgramExercise } from './WorkoutProgramScreen';
import WorkoutCalendarModal from '../components/WorkoutCalendarModal';
import MusicControlWidget from '../components/MusicControlWidget';
import { toLocalDateString } from '../utils/dateUtils';
import { requireAIAccess } from '../utils/proGate';

const TEMPLATES_KEY = 'fuelog_workout_templates';

type WorkoutTemplate = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  exercises: Array<{
    exercise_id: string;
    exercise_name: string;
    sets: number;
    reps: string;
  }>;
};

const todayStr = () => toLocalDateString();
function initSets(ex: any) { return Array.from({ length: ex.sets }, () => ({ weight: '', reps: '', done: false })); }

function getLevelColor(level: string, c: ThemeColors): string {
  return ({ Beginner: c.accent, Intermediate: c.warning, Advanced: c.danger } as Record<string, string>)[level] ?? c.textSecondary;
}

type POResult = {
  message: string;
  fillWeight: string | null;
  fillReps: string | null;
};

const BODYWEIGHT_PATTERNS = /pull.?up|push.?up|plank|dip|chin.?up|box jump|broad jump|dead bug|nordic|handstand|burpee|sit.?up|mountain climber/i;

function groupExercisesWithSupersets(
  exercises: any[],
  supersets: Record<string, string>
): Array<{ isSuperset: boolean; supersetId?: string; exercises: any[] }>{
  const groups: Array<{ isSuperset: boolean; supersetId?: string; exercises: any[] }> = [];
  const rendered = new Set<string>();
  for (const ex of exercises) {
    if (rendered.has(ex.id)) continue;
    const ssId = supersets[ex.id];
    if (!ssId) {
      groups.push({ isSuperset: false, exercises: [ex] });
      rendered.add(ex.id);
    } else {
      const group = exercises.filter(e => supersets[e.id] === ssId);
      group.forEach(e => rendered.add(e.id));
      groups.push({ isSuperset: true, supersetId: ssId, exercises: group });
    }
  }
  return groups;
}

export default function WorkoutScreen({ profile }: { profile?: any }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { user } = useAuth();
  const health = useHealthKit();
  const u = useUnits();
  const [recentWorkouts, setRecentWorkouts] = useState<HealthKitWorkout[]>([]);
  const [weeklyLoad, setWeeklyLoad] = useState<WeeklyTrainingLoad | null>(null);
  const [view, setView] = useState<'select' | 'workout' | 'builder' | 'day'>('select');
  const [activeProgram, setActiveProgram] = useState<any>(null);
  const [activeDay, setActiveDay] = useState(0);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [showCalendar, setShowCalendar] = useState(false);
  const [resumeSession, setResumeSession] = useState<{ name: string; date: string; source: string; source_id: string | null; day_index: number } | null>(null);
  const [dayRows, setDayRows] = useState<Array<{ id: number; exercise_id: string; exercise_name: string; day_index: number; sets: any[] }>>([]);
  const [dayRowsLoading, setDayRowsLoading] = useState(false);
  const [expandedEx, setExpandedEx] = useState<string | null>(null);
  const [dayLog, setDayLog] = useState<Record<string, any>>({});
  const [customWorkouts, setCustomWorkouts] = useState<any[]>([]);
  const [loadingCustom, setLoadingCustom] = useState(true);
  const [coachExercise, setCoachExercise] = useState<string | null>(null);
  const [lastSession, setLastSession] = useState<Record<string, { sets: any[]; date: string }>>({});
  const [lastSessionLoaded, setLastSessionLoaded] = useState(false);
  // Progressive overload: keyed `${exId}_${setIndex}` ->tip text shown after set completion
  const [nextSessionTips, setNextSessionTips] = useState<Record<string, string>>({});
  // Refs for dual-writing completed sets into workout_exercises / workout_sets
  const sessionIdRef = useRef<number | null>(null);
  const exerciseDbIdsRef = useRef<Record<string, number>>({});

  const [builderName, setBuilderName] = useState('My Workout');
  const [builderDays, setBuilderDays] = useState<any[]>([
    { day: 'Day 1', name: 'Day 1', type: 'training', exercises: [] },
  ]);
  const [builderDayIndex, setBuilderDayIndex] = useState(0);
  const [editingWorkoutId, setEditingWorkoutId] = useState<number | null>(null);
  const [builderReturnView, setBuilderReturnView] = useState<'select' | 'workout'>('select');
  const [savingWorkout, setSavingWorkout] = useState(false);
  const [generatingWorkout, setGeneratingWorkout] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [exName, setExName] = useState('');
  const [exSets, setExSets] = useState('3');
  const [exReps, setExReps] = useState('10');

  const [historyExercise, setHistoryExercise] = useState<{ id: string; name: string } | null>(null);
  const [showProgramScreen, setShowProgramScreen] = useState(false);
  const [fromProgram, setFromProgram] = useState<{ programId: string; week: number; day: number } | null>(null);
  const [supersets, setSupersets] = useState<Record<string, string>>({});

  // Feature state
  const restTimer = useRestTimer();
  const [prInfo, setPrInfo] = useState<{ exerciseName: string; weight: number } | null>(null);
  const prAnim = useRef(new Animated.Value(0)).current;
  const [hypeSongUri, setHypeSongUri] = useState<string | null>(null);
  const [hypeSongName, setHypeSongName] = useState<string | null>(null);
  const [hypeSoundObj, setHypeSoundObj] = useState<Audio.Sound | null>(null);
  const [isHypePlaying, setIsHypePlaying] = useState(false);
  const [isLastSetMap, setIsLastSetMap] = useState<Record<string, boolean[]>>({});
  const workoutStartTimeRef = useRef<Date | null>(null);
  const shareCardRef = useRef<View>(null);
  const [shareData, setShareData] = useState<{
    totalVolume: number;
    totalSets: number;
    top3: Array<{ name: string; bestSet: { weight: string; reps: string } }>;
    durationMin: number;
  } | null>(null);
  const [showShareCard, setShowShareCard] = useState(false);
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [previewTemplate, setPreviewTemplate] = useState<WorkoutTemplate | null>(null);
  const templatePreFillRef = useRef<Record<string, any> | null>(null);

  const fetchCustomWorkouts = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('custom_workouts').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    setCustomWorkouts(data || []);
    setLoadingCustom(false);
  }, [user]);

  const loadTemplates = useCallback(async () => {
    const raw = await AsyncStorage.getItem(TEMPLATES_KEY);
    setTemplates(raw ? JSON.parse(raw) : []);
  }, []);

  useEffect(() => { fetchCustomWorkouts(); loadTemplates(); }, [fetchCustomWorkouts, loadTemplates]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    (async () => {
      const authorized = health.isAuthorized || (await health.requestPermissions()).ok;
      if (!authorized) return;
      const tracker = await AsyncStorage.getItem(STORAGE_PREFERRED_TRACKER);
      const sourcePrefs = buildSourcePrefs(tracker);
      const [workouts, load] = await Promise.all([
        health.getWorkoutHistory(7, sourcePrefs),
        health.getWeeklyTrainingLoad(sourcePrefs),
      ]);
      setRecentWorkouts(workouts);
      setWeeklyLoad(load);
      // Hand today's sessions to the endurance engine. getWorkoutHistory only
      // exists on the hook, and buildCoachContext can't use hooks, so this is
      // the hand-off point. Fails soft — the coach just loses today's detail.
      publishTodaySessions(workouts as any, todayStr());
    })();
  }, []);

  const date = selectedDate;
  const isToday = selectedDate === todayStr();
  const plan = activeProgram?.days?.[activeDay];

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('workout_sessions')
        .select('name, date, source, source_id, day_index')
        .eq('user_id', user.id)
        .eq('date', todayStr())
        .eq('is_complete', false)
        .maybeSingle();
      if (data) setResumeSession(data);
    })();
  }, [user]);

  const upsertSession = useCallback(async (opts: {
    name: string; source: string; sourceId?: string; dayIndex: number; forDate?: string;
  }) => {
    if (!user) return;
    const { data } = await supabase.from('workout_sessions').upsert({
      user_id: user.id,
      date: opts.forDate ?? date,
      name: opts.name,
      source: opts.source,
      source_id: opts.sourceId ?? null,
      day_index: opts.dayIndex,
      is_complete: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,date' }).select('id').single();
    if (data?.id) {
      sessionIdRef.current = data.id;
      exerciseDbIdsRef.current = {}; // reset per-session exercise id cache
    }
  }, [user, date]);

  const openDayDetail = useCallback(async (dateStr: string) => {
    if (!user) return;
    setSelectedDate(dateStr);
    setView('day');
    setDayRowsLoading(true);
    const { data } = await supabase
      .from('workout_logs')
      .select('id, exercise_id, exercise_name, day_index, sets')
      .eq('user_id', user.id)
      .eq('date', dateStr)
      .order('id', { ascending: true });
    setDayRows(data || []);
    setDayRowsLoading(false);
  }, [user]);

  const resumeToDate = useCallback(async (session: { name: string; date: string; source: string; source_id: string | null; day_index: number }) => {
    setSelectedDate(session.date);
    if (session.source === 'preset') {
      const prog = PRESET_PROGRAMS.find(p => p.id === session.source_id);
      if (prog) {
        setActiveProgram(prog); setActiveDay(session.day_index); setExpandedEx(null); setView('workout');
        return;
      }
    }
    if (session.source === 'custom') {
      let w = customWorkouts.find(cw => String(cw.id) === session.source_id);
      if (!w && user) {
        const { data } = await supabase.from('custom_workouts').select('*').eq('id', session.source_id!).eq('user_id', user.id).maybeSingle();
        w = data;
      }
      if (w) {
        setActiveProgram({ ...w, days: w.days, isCustom: true }); setActiveDay(session.day_index); setExpandedEx(null); setView('workout');
        return;
      }
    }
    await openDayDetail(session.date);
  }, [customWorkouts, user, openDayDetail]);

  const updateDayRowSet = async (rowId: number, si: number, field: 'weight' | 'reps', value: string) => {
    const row = dayRows.find(r => r.id === rowId);
    if (!row) return;
    const newSets = row.sets.map((s: any, i: number) => i === si ? { ...s, [field]: value } : s);
    setDayRows(prev => prev.map(r => r.id === rowId ? { ...r, sets: newSets } : r));
    await supabase.from('workout_logs').update({ sets: newSets }).eq('id', rowId);
  };

  const toggleDayRowSetDone = async (rowId: number, si: number) => {
    const row = dayRows.find(r => r.id === rowId);
    if (!row) return;
    const newSets = row.sets.map((s: any, i: number) => i === si ? { ...s, done: !s.done } : s);
    const allDone = newSets.every((s: any) => s.done);
    setDayRows(prev => prev.map(r => r.id === rowId ? { ...r, sets: newSets } : r));
    await supabase.from('workout_logs').update({ sets: newSets, done: allDone }).eq('id', rowId);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const fetchLog = useCallback(async () => {
    if (!user || !activeProgram) return;
    const { data } = await supabase.from('workout_logs')
      .select('*').eq('user_id', user.id).eq('date', date).eq('day_index', activeDay);
    const log: Record<string, any> = {};
    (data || []).forEach((row: any) => { log[row.exercise_id] = { done: row.done, sets: row.sets || [] }; });
    if (templatePreFillRef.current) {
      Object.entries(templatePreFillRef.current).forEach(([exId, exData]) => {
        if (!log[exId]) log[exId] = exData;
      });
      templatePreFillRef.current = null;
    }
    setDayLog(log);
  }, [user, activeProgram, activeDay, date]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

  const fetchLastSessions = useCallback(async () => {
    if (!user || !plan?.exercises?.length) return;
    const ids = plan.exercises.map((e: any) => e.id);
    const { data } = await supabase
      .from('workout_logs')
      .select('exercise_id, sets, date')
      .eq('user_id', user.id)
      .eq('done', true)
      .in('exercise_id', ids)
      .neq('date', date)
      .order('date', { ascending: false });
    const last: Record<string, { sets: any[]; date: string }> = {};
    for (const row of (data || [])) {
      if (!last[row.exercise_id]) last[row.exercise_id] = { sets: row.sets, date: row.date };
    }
    setLastSession(last);
    setLastSessionLoaded(true);
  }, [user, plan, date]);

  useEffect(() => { fetchLastSessions(); }, [fetchLastSessions]);

  const upsertEx = async (exId: string, exName: string, done: boolean, sets: any[]) => {
    await supabase.from('workout_logs').upsert({
      user_id: user!.id, date, day_index: activeDay, exercise_id: exId, exercise_name: exName, done, sets,
    }, { onConflict: 'user_id,date,day_index,exercise_id' });
  };

  const toggleExDone = async (exId: string) => {
    const ex = plan.exercises.find((e: any) => e.id === exId)!;
    const cur = dayLog[exId] || { done: false, sets: initSets(ex) };
    const updated = { ...cur, done: !cur.done };
    setDayLog(prev => ({ ...prev, [exId]: updated }));
    await upsertEx(exId, ex.name, updated.done, updated.sets);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const updateSet = async (exId: string, si: number, field: string, value: string) => {
    const ex = plan.exercises.find((e: any) => e.id === exId)!;
    const cur = dayLog[exId] || { done: false, sets: initSets(ex) };
    const sets = cur.sets.map((s: any, i: number) => i === si ? { ...s, [field]: value } : s);
    setDayLog(prev => ({ ...prev, [exId]: { ...cur, sets } }));
    await upsertEx(exId, ex.name, cur.done, sets);
  };

  const toggleSetDone = async (exId: string, si: number) => {
    const ex = plan.exercises.find((e: any) => e.id === exId)!;
    const cur = dayLog[exId] || { done: false, sets: initSets(ex) };
    const sets = cur.sets.map((s: any, i: number) => i === si ? { ...s, done: !s.done } : s);
    const allDone = sets.every((s: any) => s.done);
    const updated = { ...cur, sets, done: allDone };
    const updatedDayLog = { ...dayLog, [exId]: updated };
    setDayLog(prev => ({ ...prev, [exId]: updated }));
    await upsertEx(exId, ex.name, allDone, sets);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const myGroup = supersets[exId];
    if (!myGroup) {
      restTimer.startTimer();
    } else {
      const groupExIds = plan.exercises
        .filter((e: any) => supersets[e.id] === myGroup)
        .map((e: any) => e.id);
      const allCompleted = groupExIds.every((id: string) => updatedDayLog[id]?.sets?.[si]?.done === true);
      if (allCompleted) restTimer.startTimer();
    }
    const toggledSet = sets[si];
    if (toggledSet?.done && toggledSet.weight) {
      const w = parseFloat(toggledSet.weight);
      if (!isNaN(w) && w > 0) void checkPR(exId, ex.name, w);
    }

    // ── Progressive overload: compute "Next session: try X" tip ──────────────
    if (toggledSet?.done && toggledSet.weight && toggledSet.reps) {
      const prevSet = lastSession[exId]?.sets?.[si];
      if (prevSet) {
        const currWeight = parseFloat(toggledSet.weight);
        const currReps   = parseInt(toggledSet.reps, 10);
        const prevWeight = parseFloat(prevSet.weight  || '0');
        const prevReps   = parseInt(prevSet.reps     || '0', 10);
        if (
          !isNaN(currWeight) && !isNaN(currReps) &&
          !isNaN(prevWeight) && !isNaN(prevReps) &&
          currWeight > 0 && currWeight >= prevWeight && currReps >= prevReps
        ) {
          const tipKey = `${exId}_${si}`;
          if (BODYWEIGHT_PATTERNS.test(ex.name)) {
            setNextSessionTips(prev => ({ ...prev, [tipKey]: `try ${currReps + 1} reps` }));
          } else {
            const increment = currWeight >= 60 ? 2.5 : 1.25;
            const nextW = Math.round((currWeight + increment) * 100) / 100;
            setNextSessionTips(prev => ({ ...prev, [tipKey]: `try ${nextW}${u.weightUnit}` }));
          }
        }
      }
    }

    // ── Dual-write to normalized workout_exercises / workout_sets tables ──────
    if (toggledSet?.done && sessionIdRef.current) {
      void (async () => {
        try {
          const sessId = sessionIdRef.current!;
          if (!exerciseDbIdsRef.current[exId]) {
            const { data: exRow } = await supabase
              .from('workout_exercises')
              .upsert(
                { session_id: sessId, exercise_name: ex.name, order: (plan.exercises as any[]).findIndex((e: any) => e.id === exId) },
                { onConflict: 'session_id,exercise_name' }
              )
              .select('id')
              .single();
            if (exRow?.id) exerciseDbIdsRef.current[exId] = exRow.id;
          }
          const dbExId = exerciseDbIdsRef.current[exId];
          if (dbExId) {
            await supabase.from('workout_sets').upsert(
              {
                exercise_id: dbExId,
                set_number:  si + 1,
                weight_kg:   parseFloat(toggledSet.weight)  || null,
                reps:        parseInt(toggledSet.reps, 10)  || null,
                completed_at: new Date().toISOString(),
              },
              { onConflict: 'exercise_id,set_number' }
            );
          }
        } catch { /* non-critical: existing workout_logs is source of truth */ }
      })();
    }
  };

  const selectDay = async (i: number) => {
    setActiveDay(i);
    setExpandedEx(null);
    if (activeProgram?.isCustom && activeProgram?.id) {
      setActiveProgram((prev: any) => prev ? { ...prev, current_day_index: i } : prev);
      setCustomWorkouts(prev => prev.map(w => w.id === activeProgram.id ? { ...w, current_day_index: i } : w));
      await supabase.from('custom_workouts').update({ current_day_index: i, updated_at: new Date().toISOString() }).eq('id', activeProgram.id);
    }
  };

  const addExerciseToDay = () => {
    if (!exName.trim()) return;
    const newEx = { id: `custom_${Date.now()}`, name: exName.trim(), sets: parseInt(exSets) || 3, reps: exReps || '10' };
    const days = builderDays.map((d, i) => i === builderDayIndex ? { ...d, exercises: [...d.exercises, newEx] } : d);
    setBuilderDays(days);
    setExName(''); setExSets('3'); setExReps('10');
  };

  const removeExercise = (dayIdx: number, exIdx: number) => {
    const days = builderDays.map((d, i) => i === dayIdx ? { ...d, exercises: d.exercises.filter((_: any, ei: number) => ei !== exIdx) } : d);
    setBuilderDays(days);
  };

  const addDay = () => {
    const n = builderDays.length + 1;
    setBuilderDays([...builderDays, { day: `Day ${n}`, name: `Day ${n}`, type: 'training', exercises: [] }]);
    setBuilderDayIndex(builderDays.length);
  };

  const toggleDayRest = (i: number) => {
    const days = builderDays.map((d, di) => di === i ? { ...d, type: d.type === 'rest' ? 'training' : 'rest', exercises: d.type === 'rest' ? d.exercises : [] } : d);
    setBuilderDays(days);
  };

  const generateWorkoutDay = async () => {
    const gate = await requireAIAccess('workout_fill');
    if (!gate.allowed) { setShowPaywall(true); return; }

    setGeneratingWorkout(true);
    try {
      const sport = getSportProfile(profile?.sport);
      const prompt = `Generate 5-6 exercises for a workout called "${builderName}" for a ${sport.label} athlete.

ATHLETE CONTEXT:
- Sport: ${sport.label}
- Training focus: ${sport.trainingFocus}
- Key qualities to develop: ${sport.keyQualities.join(', ')}
- Recommended exercises for this sport: ${sport.keyExercises.join(', ')}

RULES:
- Prioritise exercises relevant to "${builderName}" AND beneficial for ${sport.label}
- If the workout name indicates specific muscles (e.g. "Leg Day", "Push Day", "Back & Biceps"), stick to those muscles but choose sport-appropriate variations
- Common abbreviations: Bi's = Biceps, Tri's = Triceps, Delts = Shoulders, Lats = Back, Quads/Hams = Legs
- If the name is generic (e.g. "Workout", "Training"), use sport-specific exercises
- Set and rep ranges should match the sport's training demands

Return ONLY a JSON array, nothing else:
[{"name":"Exercise Name","sets":3,"reps":"8-12"}]`;

      console.log('Sending prompt:', prompt.slice(0, 200));
      const response = await callAI([{ role: 'user', content: prompt }], undefined, 1000);
      console.log('AI response:', response.slice(0, 500));
      const cleaned = response.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (!match) throw new Error('Could not parse response');
      const exercises = JSON.parse(match[0]);
      const newExercises = exercises.map((ex: any, i: number) => ({
        id: `ai_${Date.now()}_${i}`,
        name: ex.name,
        sets: ex.sets || 3,
        reps: ex.reps || '10',
      }));
      const days = builderDays.map((d, i) =>
        i === builderDayIndex ? { ...d, exercises: [...d.exercises, ...newExercises] } : d
      );
      setBuilderDays(days);
    } catch (e) {
      Alert.alert('Error', 'Could not generate workout. Try again.');
    } finally {
      setGeneratingWorkout(false);
    }
  };

  const openEditWorkout = (w: any) => {
    setBuilderName(w.name);
    setBuilderDays(JSON.parse(JSON.stringify(w.days)));
    setBuilderDayIndex(Math.min(activeDay, w.days.length - 1));
    setEditingWorkoutId(w.id);
    setBuilderReturnView('workout');
    setView('builder');
  };

  const resetBuilderState = () => {
    setBuilderName('My Workout');
    setBuilderDays([{ day: 'Day 1', name: 'Day 1', type: 'training', exercises: [] }]);
    setBuilderDayIndex(0);
    setEditingWorkoutId(null);
  };

  const exitBuilder = () => {
    setView(builderReturnView);
    resetBuilderState();
    setBuilderReturnView('select');
  };

  const saveCustomWorkout = async () => {
    setSavingWorkout(true);
    if (editingWorkoutId) {
      await supabase.from('custom_workouts')
        .update({ name: builderName, days: builderDays, updated_at: new Date().toISOString() })
        .eq('id', editingWorkoutId);
      await fetchCustomWorkouts();
      setSavingWorkout(false);
      setView(builderReturnView);
      if (builderReturnView === 'workout') {
        const newDayIndex = Math.min(activeDay, builderDays.length - 1);
        setActiveProgram({ id: editingWorkoutId, name: builderName, days: builderDays, isCustom: true, current_day_index: newDayIndex });
        setActiveDay(newDayIndex);
        setExpandedEx(null);
      }
      resetBuilderState();
      setBuilderReturnView('select');
      Alert.alert('Saved!', 'Your workout has been updated.');
      return;
    }
    await supabase.from('custom_workouts').insert({ user_id: user!.id, name: builderName, days: builderDays });
    await fetchCustomWorkouts();
    setSavingWorkout(false);
    setView('select');
    resetBuilderState();
    setBuilderReturnView('select');
    Alert.alert('Saved!', 'Your custom workout has been saved.');
  };

  const deleteCustomWorkout = (id: number, name: string) => {
    Alert.alert('Delete Workout', `Delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await supabase.from('custom_workouts').delete().eq('id', id); await fetchCustomWorkouts(); } },
    ]);
  };

  const saveAsTemplate = () => {
    if (!plan) return;
    const exercises = (plan.exercises || [])
      .filter((ex: any) => ex.type !== 'rest')
      .map((ex: any) => ({
        exercise_id: ex.id as string,
        exercise_name: ex.name as string,
        sets: ex.sets as number,
        reps: (ex.reps || '10') as string,
      }));
    Alert.prompt(
      'Save as Template',
      'Name this template:',
      async (name) => {
        if (!name?.trim()) return;
        const template: WorkoutTemplate = {
          id: Date.now().toString(),
          name: name.trim(),
          createdAt: new Date().toISOString(),
          exercises,
        };
        const updated = [template, ...templates];
        setTemplates(updated);
        await AsyncStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
        Alert.alert('Saved!', `"${name.trim()}" saved as a template.`);
      },
      'plain-text',
      activeProgram?.name || '');
  };

  const startWorkoutFromTemplate = async (template: WorkoutTemplate) => {
    const lastSets: Record<string, any[]> = {};
    if (user) {
      await Promise.all(template.exercises.map(async (ex) => {
        const { data } = await supabase
          .from('workout_logs')
          .select('sets, date')
          .eq('user_id', user.id)
          .eq('exercise_id', ex.exercise_id)
          .order('date', { ascending: false })
          .limit(1);
        if (data?.[0]?.sets?.length) {
          lastSets[ex.exercise_id] = data[0].sets;
        }
      }));
    }

    const syntheticProgram = {
      id: `template_${template.id}`,
      name: template.name,
      isCustom: false,
      days: [{
        day: 'Day 1',
        name: template.name,
        type: 'training' as const,
        exercises: template.exercises.map(ex => ({
          id: ex.exercise_id,
          name: ex.exercise_name,
          sets: ex.sets,
          reps: ex.reps,
        })),
      }],
      current_day_index: 0,
    };

    const initialLog: Record<string, any> = {};
    template.exercises.forEach(ex => {
      const prev = lastSets[ex.exercise_id];
      initialLog[ex.exercise_id] = {
        done: false,
        sets: prev
          ? prev.map((s: any) => ({ weight: s.weight || '', reps: s.reps || '', done: false }))
          : Array.from({ length: ex.sets }, () => ({ weight: '', reps: '', done: false })),
      };
    });

    const updatedTemplates = templates.map(t =>
      t.id === template.id ? { ...t, lastUsedAt: new Date().toISOString() } : t
    );
    setTemplates(updatedTemplates);
    await AsyncStorage.setItem(TEMPLATES_KEY, JSON.stringify(updatedTemplates));

    templatePreFillRef.current = initialLog;
    setActiveProgram(syntheticProgram);
    setActiveDay(0);
    setExpandedEx(null);
    setPreviewTemplate(null);
    setView('workout');
    workoutStartTimeRef.current = new Date();
    void upsertSession({ name: template.name, source: 'template', sourceId: template.id, dayIndex: 0 });
  };

  const deleteTemplate = (id: string) => {
    Alert.alert('Delete Template', 'Delete this template?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const updated = templates.filter(t => t.id !== id);
          setTemplates(updated);
          await AsyncStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
        },
      },
    ]);
  };

  const handleStartProgramDay = (exercises: ProgramExercise[], meta: { programId: string; week: number; day: number }) => {
    setShowProgramScreen(false);
    const virtualProgram = {
      id: `ai_program_${meta.programId}`,
      name: `Week ${meta.week} · Day ${meta.day}`,
      isAIProgram: true,
      days: [{
        day: `Day ${meta.day}`,
        name: `Day ${meta.day}`,
        type: 'training',
        exercises: exercises.map((ex, i) => ({
          id: `prog_${meta.week}_${meta.day}_${i}`,
          name: ex.name,
          sets: ex.sets,
          reps: ex.reps,
          supersetGroup: ex.supersetGroup ?? null,
        })),
      }],
    };
    // Pre-assign superset groups from program data
    const newSupersets: Record<string, string> = {};
    exercises.forEach((ex, i) => {
      if (ex.isSuperset && ex.supersetGroup !== null) {
        const exId = `prog_${meta.week}_${meta.day}_${i}`;
        newSupersets[exId] = `prog_ss_${meta.week}_${meta.day}_${ex.supersetGroup}`;
      }
    });
    setSupersets(newSupersets);
    setActiveProgram(virtualProgram);
    setActiveDay(0);
    setFromProgram(meta);
    setExpandedEx(null);
    setView('workout');
    workoutStartTimeRef.current = new Date();
    void upsertSession({ name: virtualProgram.name, source: 'ai_program', sourceId: meta.programId, dayIndex: 0 });
  };

  const removeSupersetExercise = (exId: string) => {
    setSupersets(prev => { const next = { ...prev }; delete next[exId]; return next; });
  };

  const pickSupersetPair = (ex: any) => {
    const others = (plan?.exercises ?? []).filter((e: any) => e.id !== ex.id && e.type !== 'rest');
    if (others.length === 0) {
      Alert.alert('No other exercises', 'Add more exercises to create a superset.');
      return;
    }
    Alert.alert(
      'Pair with...',
      `Superset ${ex.name} with:`,
      [
        ...others.slice(0, 6).map((other: any) => ({
          text: other.name,
          onPress: () => {
            const ssId = Date.now().toString();
            setSupersets(prev => ({ ...prev, [ex.id]: ssId, [other.id]: ssId }));
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  };

  const showExerciseContextMenu = (ex: any) => {
    const inSuperset = !!supersets[ex.id];
    Alert.alert(ex.name, undefined, [
      {
        text: inSuperset ? 'Remove from Superset' : 'Add to Superset',
        onPress: () => inSuperset ? removeSupersetExercise(ex.id) : pickSupersetPair(ex),
      },
      { text: 'View History', onPress: () => setHistoryExercise({ id: ex.id, name: ex.name }) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  // Load hype song preference
  useEffect(() => {
    AsyncStorage.getItem('fuelog_hype_song_uri').then(u => { if (u) setHypeSongUri(u); });
    AsyncStorage.getItem('fuelog_hype_song_name').then(n => { if (n) setHypeSongName(n); });
  }, []);

  // Cleanup sound on unmount
  useEffect(() => {
    return () => { hypeSoundObj?.unloadAsync(); };
  }, [hypeSoundObj]);

  // Animate PR overlay in/out
  useEffect(() => {
    if (prInfo) {
      prAnim.setValue(0);
      Animated.sequence([
        Animated.timing(prAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.delay(1200),
        Animated.timing(prAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(() => setPrInfo(null));
    }
  }, [prInfo]);

  // Track workout start time and reset per-workout state
  useEffect(() => {
    if (view === 'workout') {
      workoutStartTimeRef.current = new Date();
      setIsLastSetMap({}); // reset  "last set" flags for fresh workout
    }
  }, [view]);

  const checkPR = useCallback(async (exId: string, exName: string, currentWeight: number) => {
    if (!user || currentWeight <= 0) return;
    const { data } = await supabase
      .from('workout_logs')
      .select('sets')
      .eq('user_id', user.id)
      .eq('exercise_id', exId)
      .neq('date', date)
      .not('sets', 'is', null);
    if (!data || data.length === 0) return;
    let historicalMax = 0;
    for (const row of data) {
      for (const s of (row.sets || [])) {
        if (s.done && s.weight) {
          const w = parseFloat(s.weight);
          if (!isNaN(w) && w > historicalMax) historicalMax = w;
        }
      }
    }
    if (historicalMax <= 0) return;
    if (currentWeight > historicalMax) {
      setPrInfo({ exerciseName: exName, weight: currentWeight });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [user, date]);

  const autoFillFromPO = async (exId: string, result: POResult) => {
    if (!plan) return;
    const ex = plan.exercises.find((e: any) => e.id === exId);
    if (!ex) return;
    const cur = dayLog[exId] || { done: false, sets: initSets(ex) };
    const newSets = cur.sets.map((s: any, i: number) =>
      i === 0
        ? { ...s, weight: s.weight || result.fillWeight || s.weight, reps: s.reps || result.fillReps || s.reps }
        : s
    );
    setDayLog(prev => ({ ...prev, [exId]: { ...cur, sets: newSets } }));
    setExpandedEx(exId);
    await upsertEx(exId, ex.name, cur.done, newSets);
    await Haptics.selectionAsync();
  };

  const pickHypeSong = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        setHypeSongUri(asset.uri);
        setHypeSongName(asset.name);
        await AsyncStorage.setItem('fuelog_hype_song_uri', asset.uri);
        await AsyncStorage.setItem('fuelog_hype_song_name', asset.name);
      }
    } catch {
      Alert.alert('Error', 'Could not open file picker.');
    }
  };

  const playHypeSong = async (uri: string) => {
    try {
      if (hypeSoundObj) {
        await hypeSoundObj.stopAsync().catch(() => {});
        await hypeSoundObj.unloadAsync().catch(() => {});
      }
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false });
      const { sound } = await Audio.Sound.createAsync({ uri });
      setHypeSoundObj(sound);
      setIsHypePlaying(true);
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate(status => {
        if (status.isLoaded && status.didJustFinish) {
          setIsHypePlaying(false);
        }
      });
    } catch {
      Alert.alert('Playback Error', 'Could not play the selected audio file.');
    }
  };

  const pauseHype = async () => {
    if (hypeSoundObj) {
      await hypeSoundObj.pauseAsync().catch(() => {});
      setIsHypePlaying(false);
    }
  };

  /** Toggles play/pause for the loaded hype song — used by MusicControlWidget. */
  const toggleHypePlayback = async () => {
    if (isHypePlaying) {
      await pauseHype();
    } else if (hypeSongUri) {
      await playHypeSong(hypeSongUri);
    }
  };

  const toggleLastSet = async (exId: string, si: number) => {
    const prev = isLastSetMap[exId] || [];
    const wasOn = prev[si] || false;
    const newFlags = [...prev];
    newFlags[si] = !wasOn;
    setIsLastSetMap(cur => ({ ...cur, [exId]: newFlags }));
    if (!wasOn) {
      if (!hypeSongUri) {
        Alert.alert('No Hype Song', 'Tap "" in the header to pick a track first.');
        return;
      }
      await playHypeSong(hypeSongUri);
    } else {
      await pauseHype();
    }
  };

  const handleFinishWorkout = () => {
    if (!plan) return;
    let totalVolume = 0;
    let totalSets = 0;
    const exVolumes: Array<{ name: string; volume: number; bestSet: { weight: string; reps: string } }> = [];
    plan.exercises.forEach((ex: any) => {
      const log = dayLog[ex.id] || {};
      const sets: any[] = log.sets || [];
      let exVol = 0;
      let bestWeight = 0;
      let bestSet = { weight: '—', reps: '—' };
      sets.forEach((s: any) => {
        if (s.done && s.weight && s.reps) {
          const w = parseFloat(s.weight) || 0;
          const r = parseFloat(s.reps) || 0;
          exVol += w * r;
          totalVolume += w * r;
          totalSets++;
          if (w > bestWeight) { bestWeight = w; bestSet = { weight: s.weight, reps: s.reps }; }
        }
      });
      if (exVol > 0) exVolumes.push({ name: ex.name, volume: exVol, bestSet });
    });
    const top3 = exVolumes.sort((a, b) => b.volume - a.volume).slice(0, 3);
    const durationMs = workoutStartTimeRef.current ? Date.now() - workoutStartTimeRef.current.getTime() : 0;
    const durationMin = Math.round(durationMs / 60000);
    setShareData({ totalVolume: Math.round(totalVolume), totalSets, top3, durationMin });
    setShowShareCard(true);
    if (user) {
      void supabase.from('workout_sessions').update({
        is_complete: true,
        total_volume: Math.round(totalVolume),
        total_sets: totalSets,
        duration_min: durationMin || null,
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id).eq('date', date);
      setResumeSession(null);
    }
    if (fromProgram && user) {
      void (async () => {
        await supabase.from('program_completed_days').insert({
          user_id: user.id,
          program_id: fromProgram.programId,
          week: fromProgram.week,
          day: fromProgram.day,
        });
        const { data: prog } = await supabase
          .from('workout_programs').select('*').eq('id', fromProgram.programId).single();
        if (prog) {
          const weeks: any[] = prog.program_data?.weeks ?? [];
          const currentWeekData = weeks.find((w: any) => w.week === prog.current_week);
          const currentDays: any[] = currentWeekData?.days ?? [];
          const maxDay = currentDays.reduce((m: number, d: any) => Math.max(m, d.day), 0);
          let nextWeek = prog.current_week;
          let nextDay = prog.current_day;
          if (prog.current_day < maxDay) {
            nextDay = prog.current_day + 1;
          } else if (prog.current_week < (prog.duration_weeks ?? 12)) {
            nextWeek = prog.current_week + 1;
            nextDay = 1;
          } else {
            await supabase.from('workout_programs').update({ is_active: false }).eq('id', fromProgram.programId);
            setFromProgram(null);
            return;
          }
          await supabase.from('workout_programs')
            .update({ current_week: nextWeek, current_day: nextDay })
            .eq('id', fromProgram.programId);
        }
        setFromProgram(null);
      })();
    }
  };

  const handleShare = async () => {
    if (!shareData) return;
    const top3Text = shareData.top3
      .map(e => `• ${e.name} — ${e.bestSet.weight} × ${e.bestSet.reps}`)
      .join('\n');
    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const text = [
      ' Workout Complete — Fuelog',
      ` ${dateStr}`,
      ` ${activeProgram?.name || 'Workout'}`,
      ` Volume: ${shareData.totalVolume.toLocaleString()} ${u.weightUnit} · Sets: ${shareData.totalSets}${shareData.durationMin > 0 ? ` · ${shareData.durationMin} min` : ''}`,
      '',
      top3Text ? `Top lifts:\n${top3Text}` : '',
      '',
      'Tracked with Fuelog ',
    ].filter(Boolean).join('\n').trim();

    try {
      const canShare = await Sharing.isAvailableAsync();
      if (shareCardRef.current && canShare) {
        const uri = await captureRef(shareCardRef, { format: 'jpg', quality: 0.92 });
        await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'Share Workout' });
        return;
      }
    } catch { /* fall through */ }

    await Share.share({ message: text });
  };

  const getProgressiveOverloadSuggestion = (ex: any, prev: { sets: any[]; date: string } | null): POResult | null => {
    if (!prev) return null;
    const daysDiff = (Date.now() - new Date(prev.date + 'T12:00:00').getTime()) / 86400000;
    if (daysDiff > 60) return null;
    const completedSets = (prev.sets || []).filter((s: any) => s.done && (s.weight || s.reps));
    if (!completedSets.length) return null;
    const isBodyweight = BODYWEIGHT_PATTERNS.test(ex.name) || completedSets.every((s: any) => !parseFloat(s.weight));
    if (isBodyweight) {
      const maxReps = Math.max(...completedSets.map((s: any) => parseInt(s.reps) || 0));
      if (maxReps <= 0) return null;
      return { message: ` Last time: ${maxReps} reps — try ${maxReps + 1} today`, fillWeight: null, fillReps: String(maxReps + 1) };
    }
    let bestSet = completedSets[0];
    for (const s of completedSets) {
      if ((parseFloat(s.weight) || 0) > (parseFloat(bestSet.weight) || 0)) bestSet = s;
    }
    const lastWeight = parseFloat(bestSet.weight);
    const lastReps = parseFloat(bestSet.reps);
    if (isNaN(lastWeight) || lastWeight <= 0 || isNaN(lastReps)) return null;
    const repsStr = ex.reps?.toString() || '';
    const match = repsStr.match(/(\d+)(?:-(\d+))?/);
    if (!match) return null;
    const targetMin = parseInt(match[1]);
    const targetMax = parseInt(match[2] || match[1]);
    const increment = lastWeight >= 100 ? 5 : 2.5;
    if (lastReps >= targetMax + 3) {
      return { message: ` Last: ${lastWeight} × ${Math.round(lastReps)} — you crushed it! Same weight`, fillWeight: String(lastWeight), fillReps: String(targetMax) };
    } else if (lastReps >= targetMin) {
      return { message: ` Last: ${lastWeight} × ${Math.round(lastReps)} — try ${lastWeight + increment} ${u.weightUnit} today`, fillWeight: String(lastWeight + increment), fillReps: String(targetMin) };
    } else {
      return { message: ` Last: ${lastWeight} × ${Math.round(lastReps)} — focus on form, same weight`, fillWeight: String(lastWeight), fillReps: String(targetMin) };
    }
  };

  if (view === 'select') {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <Text style={s.title}>Workout</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TouchableOpacity style={s.programsBtn} onPress={() => setShowCalendar(true)}>
              <Text style={s.programsBtnText}></Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.programsBtn} onPress={() => setShowProgramScreen(true)}>
              <Text style={s.programsBtnText}>Programs</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.buildBtn} onPress={() => { resetBuilderState(); setBuilderReturnView('select'); setView('builder'); }}>
              <Text style={s.buildBtnText}>+ Build</Text>
            </TouchableOpacity>
          </View>
        </View>
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {!isToday && (
            <View style={s.dateBanner}>
              <Text style={s.dateBannerText}>Logging for {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</Text>
              <TouchableOpacity onPress={() => setSelectedDate(todayStr())}>
                <Text style={s.dateBannerReset}>Today</Text>
              </TouchableOpacity>
            </View>
          )}
          {resumeSession && isToday && (
            <TouchableOpacity style={s.resumeBanner} onPress={() => resumeToDate(resumeSession)} activeOpacity={0.8}>
              <View style={{ flex: 1 }}>
                <Text style={s.resumeBannerTitle}>Continue today's workout</Text>
                <Text style={s.resumeBannerSub}>{resumeSession.name}</Text>
              </View>
              <Text style={s.resumeBannerArrow}>→</Text>
            </TouchableOpacity>
          )}
          {weeklyLoad !== null && <TrainingSuggestionBanner load={weeklyLoad} />}
          {recentWorkouts.length > 0 && <RecentActivitySection workouts={recentWorkouts} />}

          <Text style={s.sectionTitle}>PRESET PROGRAMS</Text>
          {PRESET_PROGRAMS.map(prog => (
            <TouchableOpacity key={prog.id} style={s.programCard} onPress={() => { setActiveProgram(prog); setActiveDay(0); setView('workout'); void upsertSession({ name: prog.name, source: 'preset', sourceId: prog.id, dayIndex: 0 }); }} activeOpacity={0.8}>
              <View style={s.programTop}>
                <Text style={s.programName}>{prog.name}</Text>
                <View style={[s.levelBadge, { backgroundColor: getLevelColor(prog.level, colors) + '22' }]}>
                  <Text style={[s.levelText, { color: getLevelColor(prog.level, colors) }]}>{prog.level}</Text>
                </View>
              </View>
              <Text style={s.programDesc}>{prog.description}</Text>
              <Text style={s.programDays}>{prog.days.length} days · {prog.days.filter((d: any) => d.type === 'training').length} training</Text>
            </TouchableOpacity>
          ))}

          <Text style={[s.sectionTitle, { marginTop: 24 }]}>MY CUSTOM WORKOUTS</Text>
          {loadingCustom && <ActivityIndicator color={colors.text} style={{ marginTop: 20 }} />}
          {!loadingCustom && customWorkouts.length === 0 && (
            <Text style={s.emptyText}>No custom workouts yet.{'\n'}Tap "+ Build" to create one!</Text>
          )}
          {customWorkouts.map(w => (
            <TouchableOpacity key={w.id} style={s.programCard} onPress={() => { const di = w.current_day_index || 0; setActiveProgram({ ...w, days: w.days, isCustom: true }); setActiveDay(di); setExpandedEx(null); setView('workout'); void upsertSession({ name: w.name, source: 'custom', sourceId: String(w.id), dayIndex: di }); }} activeOpacity={0.8}>
              <View style={s.programTop}>
                <Text style={s.programName}>{w.name}</Text>
                <TouchableOpacity onPress={() => deleteCustomWorkout(w.id, w.name)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={s.deleteCustom}>×</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.programDays}>{w.days.length} days · {w.days.filter((d: any) => d.type === 'training').length} training</Text>
            </TouchableOpacity>
          ))}

          <Text style={[s.sectionTitle, { marginTop: 24 }]}>MY TEMPLATES</Text>
          {templates.length === 0 && (
            <Text style={s.emptyText}>No templates yet.{'\n'}Start a workout and tap ⋯ → Save as Template.</Text>
          )}
          {templates.map(t => (
            <TouchableOpacity key={t.id} style={s.programCard} onPress={() => setPreviewTemplate(t)} activeOpacity={0.8}>
              <View style={s.programTop}>
                <Text style={s.programName}>{t.name}</Text>
                <TouchableOpacity onPress={() => deleteTemplate(t.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={s.deleteCustom}>×</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.programDays}>
                {t.exercises.length} exercise{t.exercises.length !== 1 ? 's' : ''}
                {t.lastUsedAt ? ` · Last used ${new Date(t.lastUsedAt).toLocaleDateString()}` : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <WorkoutProgramScreen
          visible={showProgramScreen}
          onClose={() => setShowProgramScreen(false)}
          onStartDay={handleStartProgramDay}
        />

        <WorkoutCalendarModal
          visible={showCalendar}
          userId={user?.id}
          selectedDate={selectedDate}
          onClose={() => setShowCalendar(false)}
          onSelectDate={async (dateStr, session) => {
            setShowCalendar(false);
            if (session) {
              await resumeToDate({ name: session.name, date: dateStr, source: session.source, source_id: session.source_id, day_index: session.day_index });
            } else if (dateStr === todayStr()) {
              setSelectedDate(dateStr);
            } else {
              await openDayDetail(dateStr);
            }
          }}
        />

        <Modal visible={!!previewTemplate} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPreviewTemplate(null)}>
          <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
            <View style={s.modalHeaderRow}>
              <Text style={s.modalHeaderTitle} numberOfLines={1}>{previewTemplate?.name || 'Template'}</Text>
              <TouchableOpacity style={s.modalCloseBtn} onPress={() => setPreviewTemplate(null)}>
                <Text style={s.modalCloseBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={s.scroll} contentContainerStyle={s.content}>
              {(previewTemplate?.exercises || []).map((ex, i) => (
                <View key={i} style={s.templateExRow}>
                  <View style={s.templateExNum}>
                    <Text style={s.templateExNumText}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.templateExName}>{ex.exercise_name}</Text>
                    <Text style={s.templateExDetail}>{ex.sets} sets × {ex.reps} reps</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={{ paddingHorizontal: spacing.xl, paddingBottom: 32, paddingTop: 12 }}>
              <TouchableOpacity
                style={s.startTemplateBtn}
                onPress={() => previewTemplate && startWorkoutFromTemplate(previewTemplate)}
                activeOpacity={0.85}>
                <Text style={s.startTemplateBtnText}>Start Workout</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    );
  }

  if (view === 'day') {
    const dateLabel = new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => setView('select')}><Text style={s.backBtn}>‹ Back</Text></TouchableOpacity>
          <Text style={s.headerTitle} numberOfLines={1}>{dateLabel}</Text>
          <View style={{ width: 80 }} />
        </View>
        {dayRowsLoading ? (
          <ActivityIndicator color={colors.text} style={{ marginTop: 60 }} />
        ) : dayRows.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 }}>
            <Text style={{ fontSize: 40 }}></Text>
            <Text style={{ fontSize: 17, fontWeight: weight.bold, color: colors.text }}>No workout logged</Text>
            <Text style={s.emptyText}>Nothing was logged on {dateLabel}.</Text>
            <TouchableOpacity style={s.addExBtn} onPress={() => setView('select')}>
              <Text style={s.addExBtnText}>Log a Workout</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            {dayRows.map(row => (
              <View key={row.id} style={s.exCard}>
                <View style={s.exHeader}>
                  <View style={s.exInfo}>
                    {/* Tapping the exercise name opens the weight-progression chart */}
                    <TouchableOpacity onPress={() => setHistoryExercise({ id: row.exercise_id, name: row.exercise_name })} activeOpacity={0.7}>
                      <Text style={[s.exName, s.exNameTappable]}>{row.exercise_name}</Text>
                    </TouchableOpacity>
                    <Text style={s.exSets}>{row.sets.length} set{row.sets.length !== 1 ? 's' : ''}</Text>
                  </View>
                </View>
                <View style={s.exBody}>
                  <View style={s.setsHeader}>
                    <Text style={[s.setHText, { width: 28 }]}>Set</Text>
                    <Text style={[s.setHText, { flex: 1 }]}>Weight</Text>
                    <Text style={[s.setHText, { flex: 1 }]}>Reps</Text>
                    <Text style={[s.setHText, { width: 36 }]}>✓</Text>
                  </View>
                  {row.sets.map((set: any, si: number) => (
                    <View key={si} style={s.setRow}>
                      <Text style={s.setNum}>{si + 1}</Text>
                      <TextInput style={s.setInput} placeholderTextColor={colors.textTertiary} value={set.weight} onChangeText={v => updateDayRowSet(row.id, si, 'weight', v)} keyboardType="decimal-pad" selectTextOnFocus />
                      <TextInput style={s.setInput} placeholderTextColor={colors.textTertiary} value={set.reps} onChangeText={v => updateDayRowSet(row.id, si, 'reps', v)} keyboardType="decimal-pad" selectTextOnFocus />
                      <TouchableOpacity style={[s.setCheckBtn, set.done && s.setCheckBtnDone]} onPress={() => toggleDayRowSetDone(row.id, si)}>
                        <Text style={[s.setCheckText, set.done && s.setCheckTextDone]}>✓</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
        {/* Progress chart accessible from historical day view */}
        <ExerciseHistoryModal
          visible={!!historyExercise}
          exercise={historyExercise}
          userId={user?.id}
          onClose={() => setHistoryExercise(null)}
        />
      </SafeAreaView>
    );
  }

  if (view === 'builder') {
    const currentDay = builderDays[builderDayIndex];
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity onPress={exitBuilder}><Text style={s.backBtn}>‹ Back</Text></TouchableOpacity>
          <Text style={s.headerTitle}>{editingWorkoutId ? 'Edit Workout' : 'Build Workout'}</Text>
          <TouchableOpacity onPress={saveCustomWorkout} disabled={savingWorkout}>
            {savingWorkout ? <ActivityIndicator color={colors.text} /> : <Text style={s.saveBtn}>Save</Text>}
          </TouchableOpacity>
        </View>
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={s.fieldLabel}>Workout Name</Text>
          <TextInput style={s.input} value={builderName} onChangeText={setBuilderName} placeholderTextColor={colors.textTertiary} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.dayPicker} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
            {builderDays.map((d, i) => (
              <TouchableOpacity key={i} style={[s.dayChip, builderDayIndex === i && s.dayChipActive]} onPress={() => setBuilderDayIndex(i)}>
                <Text style={[s.dayChipText, builderDayIndex === i && s.dayChipTextActive]}>{d.day}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.addDayChip} onPress={addDay}>
              <Text style={s.addDayChipText}>+ Day</Text>
            </TouchableOpacity>
          </ScrollView>
          <View style={s.builderDayCard}>
            <View style={s.builderDayHeader}>
              <TouchableOpacity style={[s.restToggle, currentDay.type === 'rest' && s.restToggleActive]} onPress={() => toggleDayRest(builderDayIndex)}>
                <Text style={[s.restToggleText, currentDay.type === 'rest' && s.restToggleTextActive]}>Rest Day</Text>
              </TouchableOpacity>
            </View>
            {currentDay.type === 'training' && (
              <>
                {currentDay.exercises.map((ex: any, ei: number) => (
                  <View key={ei} style={s.builderEx}>
                    <View style={s.builderExInfo}>
                      <Text style={s.builderExName}>{ex.name}</Text>
                      <Text style={s.builderExDetail}>{ex.sets} sets × {ex.reps}</Text>
                    </View>
                    <TouchableOpacity onPress={() => removeExercise(builderDayIndex, ei)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={s.removeEx}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={s.addExForm}>
                  <View style={s.aiRow}>
                    <Text style={s.fieldLabel}>Add Exercise</Text>
                    <TouchableOpacity style={s.aiGenBtn} onPress={generateWorkoutDay} disabled={generatingWorkout}>
                      {generatingWorkout ? <ActivityIndicator color={colors.accentText} size="small" /> : <Text style={s.aiGenBtnText}>AI Fill</Text>}
                    </TouchableOpacity>
                  </View>
                  <TextInput style={s.input} value={exName} onChangeText={setExName} placeholder="Exercise name" placeholderTextColor={colors.textTertiary} />
                  <View style={s.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.fieldLabel}>Sets</Text>
                      <TextInput style={s.input} value={exSets} onChangeText={setExSets} keyboardType="number-pad" placeholder="3" placeholderTextColor={colors.textTertiary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.fieldLabel}>Reps</Text>
                      <TextInput style={s.input} value={exReps} onChangeText={setExReps} placeholder="10" placeholderTextColor={colors.textTertiary} />
                    </View>
                  </View>
                  <TouchableOpacity style={s.addExBtn} onPress={addExerciseToDay}>
                    <Text style={s.addExBtnText}>+ Add Exercise</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            {currentDay.type === 'rest' && <Text style={s.restLabel}>Rest day — no exercises needed</Text>}
          </View>
        </ScrollView>
        <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
          <PaywallScreen
            onClose={() => setShowPaywall(false)}
            onUnlock={() => setShowPaywall(false)}
          />
        </Modal>
      </SafeAreaView>
    );
  }

  if (!plan) return null;
  const totalEx = plan.exercises?.length || 0;
  const doneEx = plan.exercises?.filter((ex: any) => (dayLog[ex.id] || {}).done).length || 0;
  const allDone = totalEx > 0 && doneEx === totalEx;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => { setView('select'); setSupersets({}); setFromProgram(null); }}><Text style={s.backBtn}>‹ Programs</Text></TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{activeProgram?.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, width: 100 }}>
          {activeProgram?.isCustom && (
            <TouchableOpacity onPress={() => openEditWorkout(activeProgram)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[s.saveBtn, { width: 28 }]}>Edit</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => Alert.alert('Workout Options', undefined, [
              { text: 'Save as Template', onPress: saveAsTemplate },
              { text: 'Cancel', style: 'cancel' },
            ])}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[s.saveBtn, { width: 22, textAlign: 'center' }]}>⋯</Text>
          </TouchableOpacity>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.dayPicker} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
        {activeProgram.days.map((p: any, i: number) => (
          <TouchableOpacity key={i} style={[s.dayChip, i === activeDay && s.dayChipActive, p.type === 'rest' && s.dayChipRest, i === activeDay && p.type === 'rest' && s.dayChipRestActive]}
            onPress={() => selectDay(i)}>
            <Text style={[s.dayChipText, i === activeDay && s.dayChipTextActive, p.type === 'rest' && i !== activeDay && s.dayChipTextRest]}>{p.day}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <MusicControlWidget
        hypeSongUri={hypeSongUri}
        hypeSongName={hypeSongName}
        isHypePlaying={isHypePlaying}
        onPickSong={pickHypeSong}
        onPlayPause={toggleHypePlayback}
      />
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {fromProgram && (
          <View style={s.fromProgramBadge}>
            <Text style={s.fromProgramBadgeText}>Week {fromProgram.week}, Day {fromProgram.day}</Text>
          </View>
        )}
        <View style={s.dayHeader}>
          <View>
            <Text style={s.dayTitle}>{plan.name}</Text>
            {plan.type === 'training' && <Text style={s.daySub}>{totalEx} exercises · {plan.exercises.reduce((a: number, e: any) => a + e.sets, 0)} sets</Text>}
          </View>
          {allDone && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={s.badge}><Text style={s.badgeText}>✓ Done</Text></View>
              <TouchableOpacity style={s.finishBtn} onPress={handleFinishWorkout}>
                <Text style={s.finishBtnText}>Share </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        {plan.type === 'rest' ? (
          <View style={s.restMsg}>
            <Text style={s.restIcon}></Text>
            <Text style={s.restTitle}>Rest & Recover</Text>
            <Text style={s.restSub}>Growth happens outside the gym.{'\n'}Eat your macros and sleep well.</Text>
          </View>
        ) : (
          <>
            <View style={s.progressCard}>
              <View style={s.progressTop}>
                <Text style={s.progressLabel}>Progress</Text>
                <Text style={s.progressVal}>{doneEx} / {totalEx}</Text>
              </View>
              <View style={s.progBg}>
                <View style={[s.progFill, { width: `${totalEx > 0 ? Math.round(doneEx / totalEx * 100) : 0}%` as any }]} />
              </View>
            </View>
            {groupExercisesWithSupersets(plan.exercises, supersets).map((group) => {
              const renderExCard = (ex: any) => {
                const exLog = dayLog[ex.id] || { done: false, sets: [] };
                const sets = exLog.sets.length === ex.sets ? exLog.sets : initSets(ex);
                const isOpen = expandedEx === ex.id;
                const isDone = exLog.done;
                const prev = lastSession[ex.id] ?? null;
                const poResult = getProgressiveOverloadSuggestion(ex, prev);
                const isNewExercise = lastSessionLoaded && !(ex.id in lastSession);

                // ── "Last time: 3×10 @ 80kg" label shown above set inputs ──────
                const prevSets: any[] = prev?.sets ?? [];
                const prevRelevant = prevSets.filter((s: any) => s.weight || s.reps);
                let lastTimeLabel: string | null = null;
                if (prevRelevant.length > 0) {
                  let bestW = 0, bestR = '—';
                  prevRelevant.forEach((s: any) => {
                    const w = parseFloat(s.weight || '0');
                    if (!isNaN(w) && w > bestW) { bestW = w; bestR = s.reps || '—'; }
                  });
                  if (bestW > 0) {
                    lastTimeLabel = `Last time: ${prevRelevant.length}×${bestR} @ ${bestW}kg`;
                  }
                }

                return (
                  <View key={ex.id} style={[s.exCard, isDone && s.exCardDone]}>
                    <TouchableOpacity
                      style={s.exHeader}
                      onPress={() => setExpandedEx(isOpen ? null : ex.id)}
                      onLongPress={() => showExerciseContextMenu(ex)}
                      activeOpacity={0.7}
                    >
                      <TouchableOpacity style={[s.exCheck, isDone && s.exCheckDone]} onPress={() => toggleExDone(ex.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        {isDone && <Text style={s.exCheckMark}>✓</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity style={s.exInfo} onPress={() => setHistoryExercise({ id: ex.id, name: ex.name })} activeOpacity={0.7}>
                        <Text style={[s.exName, isDone && s.exNameDone]} numberOfLines={1}>{ex.name}</Text>
                        <Text style={s.exSets}>{ex.sets} sets × {ex.reps} reps</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.coachBtn} onPress={() => setCoachExercise(ex.name)}>
                        <Text style={s.coachBtnText}></Text>
                      </TouchableOpacity>
                      <Text style={[s.arrow, isOpen && s.arrowOpen]}>▾</Text>
                    </TouchableOpacity>
                    {poResult && (
                      <TouchableOpacity style={s.poChipRow} onPress={() => autoFillFromPO(ex.id, poResult)} activeOpacity={0.8}>
                        <Text style={s.poChipText} numberOfLines={1}>{poResult.message}</Text>
                        <Text style={s.poChipArrow}>→</Text>
                      </TouchableOpacity>
                    )}
                    {!poResult && isNewExercise && (
                      <View style={s.poNewChip}>
                        <Text style={s.poNewChipText}>First time logging this exercise</Text>
                      </View>
                    )}
                    {isOpen && (
                      <View style={s.exBody}>
                        {/* ── Last-time reference label ── */}
                        {lastTimeLabel && (
                          <Text style={s.lastTimeLabelText}>{lastTimeLabel}</Text>
                        )}
                        <View style={s.setsHeader}>
                          <Text style={[s.setHText, { width: 28 }]}>Set</Text>
                          <Text style={[s.setHText, { flex: 1 }]}>Weight</Text>
                          <Text style={[s.setHText, { flex: 1 }]}>Reps</Text>
                          <Text style={[s.setHText, { width: 36 }]}>✓</Text>
                          <Text style={[s.setHText, { width: 28 }]}></Text>
                        </View>
                        {sets.map((set: any, si: number) => {
                          const prevSet = lastSession[ex.id]?.sets?.[si];
                          const isLastSet = isLastSetMap[ex.id]?.[si] ?? false;
                          const nextTip = nextSessionTips[`${ex.id}_${si}`];
                          return (
                            <React.Fragment key={si}>
                              <View style={s.setRow}>
                                <Text style={s.setNum}>{si + 1}</Text>
                                <TextInput style={s.setInput} placeholder={prevSet?.weight || u.weightUnit} placeholderTextColor={colors.textTertiary} value={set.weight} onChangeText={v => updateSet(ex.id, si, 'weight', v)} keyboardType="decimal-pad" selectTextOnFocus />
                                <TextInput style={s.setInput} placeholder={prevSet?.reps || '—'} placeholderTextColor={colors.textTertiary} value={set.reps} onChangeText={v => updateSet(ex.id, si, 'reps', v)} keyboardType="decimal-pad" selectTextOnFocus />
                                <TouchableOpacity style={[s.setCheckBtn, set.done && s.setCheckBtnDone]} onPress={() => toggleSetDone(ex.id, si)}>
                                  <Text style={[s.setCheckText, set.done && s.setCheckTextDone]}>✓</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={s.lastSetBtn} onPress={() => toggleLastSet(ex.id, si)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                                  <Text style={{ fontSize: 16, opacity: isLastSet ? 1 : 0.22 }}></Text>
                                </TouchableOpacity>
                              </View>
                              {/* ── Auto-progression badge shown after set completion ── */}
                              {nextTip && (
                                <View style={s.nextSessionChip}>
                                  <Text style={s.nextSessionChipText}>⬆ Next session: {nextTip}</Text>
                                </View>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              };

              if (!group.isSuperset) return renderExCard(group.exercises[0]);
              return (
                <View key={group.supersetId} style={s.supersetGroup}>
                  <Text style={s.supersetGroupLabel}>SUPERSET</Text>
                  {group.exercises.map(ex => renderExCard(ex))}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
      <Modal visible={!!coachExercise} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCoachExercise(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
          <View style={s.modalHeaderRow}>
            <Text style={s.modalHeaderTitle}>Exercise Coach</Text>
            <TouchableOpacity style={s.modalCloseBtn} onPress={() => setCoachExercise(null)}>
              <Text style={s.modalCloseBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
          {coachExercise && <CoachScreen initialExercise={coachExercise} />}
        </SafeAreaView>
      </Modal>

      {/* PR Celebration Overlay */}
      <Modal visible={!!prInfo} transparent animationType="none" statusBarTranslucent>
        <Animated.View style={[s.prOverlay, { opacity: prAnim }]}>
          <View style={s.prCard}>
            <Text style={s.prEmoji}></Text>
            <Text style={s.prTitle}>New PR!</Text>
            <Text style={s.prExercise}>{prInfo?.exerciseName}</Text>
            <Text style={s.prWeight}>{prInfo?.weight} {u.weightUnit}</Text>
          </View>
        </Animated.View>
      </Modal>

      <ExerciseHistoryModal
        visible={!!historyExercise}
        exercise={historyExercise}
        userId={user?.id}
        onClose={() => setHistoryExercise(null)}
      />

      {/* Share Card Modal */}
      <Modal visible={showShareCard} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowShareCard(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
          <View style={s.shareHeader}>
            <TouchableOpacity onPress={() => setShowShareCard(false)}>
              <Text style={s.shareCloseBtn}>Done</Text>
            </TouchableOpacity>
            <Text style={s.shareHeaderTitle}>Workout Complete </Text>
            <TouchableOpacity onPress={handleShare}>
              <Text style={s.shareActionBtn}>Share</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            {shareData && (
              <View ref={shareCardRef} collapsable={false} style={s.shareCard}>
                <View style={s.shareCardTop}>
                  <Text style={s.shareCardBrand}>FUELOG</Text>
                  <Text style={s.shareCardDate}>
                    {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </Text>
                </View>
                <View style={s.shareCardDivider} />
                <Text style={s.shareCardWorkout}>{activeProgram?.name || 'Workout'}</Text>
                <View style={s.shareCardStats}>
                  <View style={s.shareCardStat}>
                    <Text style={s.shareCardStatVal}>{shareData.totalVolume.toLocaleString()}</Text>
                    <Text style={s.shareCardStatLabel}>{u.weightUnit} volume</Text>
                  </View>
                  <View style={s.shareCardStat}>
                    <Text style={s.shareCardStatVal}>{shareData.totalSets}</Text>
                    <Text style={s.shareCardStatLabel}>sets</Text>
                  </View>
                  {shareData.durationMin > 0 && (
                    <View style={s.shareCardStat}>
                      <Text style={s.shareCardStatVal}>{shareData.durationMin}</Text>
                      <Text style={s.shareCardStatLabel}>min</Text>
                    </View>
                  )}
                </View>
                {shareData.top3.length > 0 && (
                  <>
                    <Text style={s.shareCardTopLabel}>TOP LIFTS</Text>
                    {shareData.top3.map((e, i) => (
                      <View key={i} style={s.shareCardExRow}>
                        <Text style={s.shareCardExName}>{e.name}</Text>
                        <Text style={s.shareCardExBest}>{e.bestSet.weight} × {e.bestSet.reps}</Text>
                      </View>
                    ))}
                  </>
                )}
                <View style={s.shareCardDivider} />
                <Text style={s.shareCardFooter}>fuelog.app</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function sourceBadge(src: string): string {
  const l = src.toLowerCase();
  if (l.includes('whoop')) return 'WHOOP';
  if (l.includes('garmin')) return 'Garmin';
  if (l.includes('apple watch') || l.includes("watch")) return 'Watch';
  if (l.includes('apple health') || l.includes('health')) return 'Health';
  return src.split(' ')[0];
}

function TrainingSuggestionBanner({ load }: { load: WeeklyTrainingLoad }) {
  const { colors } = useTheme();
  const ws = makeBannerStyles(colors);
  const loadLevel = load.totalMinutes > 300 ? 'high' : load.totalMinutes > 150 ? 'mid' : 'low';
  const tips: Record<string, string> = {
    high: `Heavy week (${load.totalMinutes} min) — consider a deload or recovery session today.`,
    mid: `Moderate week (${load.totalMinutes} min) — a quality session today fits well.`,
    low: `Light week so far (${load.totalMinutes} min) — good time to push hard today.`,
  };
  const levelColors: Record<string, string> = { high: colors.danger, mid: colors.warning, low: colors.accent };
  return (
    <View style={[ws.suggestionCard, { borderColor: levelColors[loadLevel] + '44' }]}>
      <Text style={[ws.suggestionDot, { color: levelColors[loadLevel] }]}>●</Text>
      <Text style={ws.suggestionText}>{tips[loadLevel]}</Text>
    </View>
  );
}

function RecentActivitySection({ workouts }: { workouts: HealthKitWorkout[] }) {
  const { colors } = useTheme();
  const ws = makeActivityStyles(colors);
  const u = useUnits();
  const grouped: Record<string, HealthKitWorkout[]> = {};
  for (const w of workouts) {
    const date = toLocalDateString(new Date(w.startDate));
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(w);
  }
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const fmtDate = (d: string) => {
    const today = toLocalDateString();
    const yest = toLocalDateString(new Date(Date.now() - 86400000));
    if (d === today) return 'Today';
    if (d === yest) return 'Yesterday';
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={ws.activityTitle}>RECENT ACTIVITY</Text>
      <Text style={ws.activityNote}>From Apple Health · duplicate entries from multiple devices are merged, but calories may still differ slightly from a tracker's own app</Text>
      {sortedDates.map(date => (
        <View key={date}>
          <Text style={ws.activityDate}>{fmtDate(date)}</Text>
          {grouped[date].map(w => (
            <View key={w.id} style={ws.activityRow}>
              <View style={ws.activityInfo}>
                <Text style={ws.activityName}>{w.name}</Text>
                <Text style={ws.activityMeta}>
                  {Math.round(w.duration)} min{w.calories ? ` · ${Math.round(w.calories)} kcal` : ''}{w.distance ? ` · ${u.dispDistance(w.distance).toFixed(1)} ${u.distanceUnit}` : ''}
                </Text>
              </View>
              <View style={ws.sourceBadge}>
                <Text style={ws.sourceBadgeText}>{sourceBadge(w.source)}</Text>
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function makeBannerStyles(c: ThemeColors) {
  return StyleSheet.create({
    suggestionCard: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      backgroundColor: c.card, borderRadius: radius.md, padding: 12,
      borderWidth: 1, marginBottom: 16,
    },
    suggestionDot: { fontSize: 10, marginTop: 3 },
    suggestionText: { flex: 1, fontSize: 13, color: c.textSecondary, fontWeight: weight.medium, lineHeight: 20 },
  });
}

function makeActivityStyles(c: ThemeColors) {
  return StyleSheet.create({
    activityTitle: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5, marginBottom: 10 },
    activityNote: { fontSize: 10, color: c.textTertiary, fontWeight: weight.medium, marginTop: -6, marginBottom: 10, lineHeight: 15 },
    activityDate: { fontSize: 12, fontWeight: weight.bold, color: c.textTertiary, marginBottom: 6, marginTop: 4 },
    activityRow: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: c.card,
      borderRadius: radius.md, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: c.border,
    },
    activityInfo: { flex: 1 },
    activityName: { fontSize: 14, fontWeight: weight.bold, color: c.text, marginBottom: 2 },
    activityMeta: { fontSize: 12, color: c.textTertiary, fontWeight: weight.medium },
    sourceBadge: { backgroundColor: c.cardAlt, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
    sourceBadgeText: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary },
  });
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
    title: { fontSize: 28, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    headerTitle: { fontSize: 17, fontWeight: weight.bold, color: c.text, flex: 1, textAlign: 'center' },
    backBtn: { color: c.text, fontSize: 16, fontWeight: weight.semibold, width: 80 },
    saveBtn: { color: c.text, fontSize: 16, fontWeight: weight.bold, textAlign: 'right', width: 60 },
    buildBtn: { backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
    buildBtnText: { color: c.accentText, fontSize: 14, fontWeight: weight.heavy },
    programsBtn: { backgroundColor: c.cardAlt, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: c.border },
    programsBtnText: { color: c.text, fontSize: 14, fontWeight: weight.bold },
    fromProgramBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: 6 },
    fromProgramBadgeText: { fontSize: 12, fontWeight: weight.bold, color: c.accent },
    dateBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.cardAlt, borderRadius: radius.md, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: c.border },
    dateBannerText: { color: c.text, fontSize: 13, fontWeight: weight.semibold },
    dateBannerReset: { color: c.accent, fontSize: 13, fontWeight: weight.bold },
    resumeBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.accentMuted, borderRadius: radius.md, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: c.accent + '44' },
    resumeBannerTitle: { color: c.accent, fontSize: 13, fontWeight: weight.bold },
    resumeBannerSub: { color: c.text, fontSize: 15, fontWeight: weight.heavy, marginTop: 2 },
    resumeBannerArrow: { color: c.accent, fontSize: 20, fontWeight: weight.bold, marginLeft: 8 },
    supersetGroup: { borderLeftWidth: 3, borderLeftColor: c.accent, paddingLeft: 8, marginBottom: 4 },
    supersetGroupLabel: { fontSize: 9, fontWeight: weight.heavy, color: c.accent, letterSpacing: 1.8, marginBottom: 4 },
    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: 40 },
    sectionTitle: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1.5, marginBottom: 12 },
    programCard: { backgroundColor: c.card, borderRadius: radius.card, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    programTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    programName: { fontSize: 17, fontWeight: weight.heavy, color: c.text, flex: 1 },
    levelBadge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
    levelText: { fontSize: 11, fontWeight: weight.bold },
    programDesc: { fontSize: 13, color: c.textTertiary, fontWeight: weight.medium, marginBottom: 6 },
    programDays: { fontSize: 12, color: c.textTertiary, fontWeight: weight.semibold },
    emptyText: { textAlign: 'center', color: c.textTertiary, fontSize: 14, paddingVertical: 32, lineHeight: 24, fontWeight: weight.medium },
    deleteCustom: { color: c.textTertiary, fontSize: 22, paddingLeft: 12 },
    dayPicker: { maxHeight: 52, borderBottomWidth: 1, borderBottomColor: c.border },
    dayChip: { backgroundColor: c.card, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 6, borderWidth: 1, borderColor: c.border },
    dayChipActive: { backgroundColor: c.accent, borderColor: c.accent },
    dayChipRest: { backgroundColor: c.bgSecondary, borderColor: 'transparent' },
    dayChipRestActive: { backgroundColor: c.card, borderColor: c.border },
    dayChipText: { color: c.textTertiary, fontSize: 13, fontWeight: weight.bold },
    dayChipTextActive: { color: c.accentText },
    dayChipTextRest: { color: c.textTertiary, opacity: 0.5 },
    addDayChip: { backgroundColor: c.cardAlt, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 6, borderWidth: 1, borderColor: c.borderStrong },
    addDayChipText: { color: c.textTertiary, fontSize: 13, fontWeight: weight.bold },
    dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
    dayTitle: { fontSize: 22, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    daySub: { fontSize: 12, color: c.textTertiary, fontWeight: weight.semibold, marginTop: 4 },
    badge: { backgroundColor: c.accentMuted, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
    badgeText: { color: c.accent, fontSize: 12, fontWeight: weight.bold },
    restMsg: { alignItems: 'center', paddingVertical: 60 },
    restIcon: { fontSize: 56, marginBottom: 18 },
    restTitle: { fontSize: 22, fontWeight: weight.heavy, color: c.text, marginBottom: 10 },
    restSub: { fontSize: 13, color: c.textTertiary, textAlign: 'center', lineHeight: 22, fontWeight: weight.medium },
    progressCard: { backgroundColor: c.card, borderRadius: radius.md, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: c.border },
    progressTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    progressLabel: { fontSize: 13, color: c.textTertiary, fontWeight: weight.semibold },
    progressVal: { fontSize: 13, color: c.text, fontWeight: weight.bold },
    progBg: { backgroundColor: c.border, borderRadius: 4, height: 4 },
    progFill: { backgroundColor: c.accent, borderRadius: 4, height: 4 },
    exCard: { backgroundColor: c.card, borderRadius: radius.card, marginBottom: 8, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
    exCardDone: { backgroundColor: c.accentMuted },
    exHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
    exCheck: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
    exCheckDone: { backgroundColor: c.accent, borderColor: c.accent },
    exCheckMark: { color: c.accentText, fontSize: 13, fontWeight: weight.heavy },
    exInfo: { flex: 1 },
    exName: { fontSize: 15, fontWeight: weight.bold, color: c.text, marginBottom: 2 },
    exNameDone: { color: c.textTertiary, textDecorationLine: 'line-through' },
    exNameTappable: { textDecorationLine: 'underline', textDecorationColor: c.textTertiary },
    exSets: { fontSize: 12, color: c.textTertiary, fontWeight: weight.semibold },
    coachBtn: { backgroundColor: c.cardAlt, borderRadius: radius.sm, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    coachBtnText: { fontSize: 16 },
    arrow: { color: c.textTertiary, fontSize: 14, fontWeight: weight.bold },
    arrowOpen: { color: c.textSecondary, transform: [{ rotate: '180deg' }] },
    exBody: { borderTopWidth: 1, borderTopColor: c.border, paddingHorizontal: 16, paddingBottom: 14 },
    // "Last time: 3×10 @ 80kg" label shown above set inputs
    lastTimeLabelText: {
      fontSize: 11, fontWeight: weight.semibold,
      color: c.accent, opacity: 0.75,
      paddingTop: 10, paddingBottom: 2,
    },
    // "⬆ Next session: try 82.5kg" chip shown after a matched/exceeded set
    nextSessionChip: {
      backgroundColor: c.cardAlt,
      borderRadius: radius.sm,
      paddingHorizontal: 10, paddingVertical: 5,
      marginBottom: 6,
      alignSelf: 'flex-start',
    },
    nextSessionChipText: {
      fontSize: 11, fontWeight: weight.semibold, color: c.textSecondary,
    },
    setsHeader: { flexDirection: 'row', gap: 8, paddingVertical: 10, alignItems: 'center' },
    setHText: { fontSize: 10, fontWeight: weight.bold, color: c.textTertiary, textTransform: 'uppercase', textAlign: 'center', letterSpacing: 0.5 },
    setRow: { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' },
    setNum: { width: 28, fontSize: 12, color: c.textTertiary, fontWeight: weight.bold, textAlign: 'center' },
    setInput: { flex: 1, backgroundColor: c.cardAlt, borderRadius: radius.sm, color: c.text, padding: 9, fontSize: 14, fontWeight: weight.semibold, textAlign: 'center' },
    setCheckBtn: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: c.cardAlt, alignItems: 'center', justifyContent: 'center' },
    setCheckBtnDone: { backgroundColor: c.accentMuted },
    setCheckText: { color: c.textTertiary, fontSize: 14, fontWeight: weight.bold },
    setCheckTextDone: { color: c.accent },
    fieldLabel: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    input: { backgroundColor: c.card, borderRadius: radius.md, color: c.text, padding: 14, fontSize: 15, marginBottom: 16, borderWidth: 1, borderColor: c.border },
    row: { flexDirection: 'row', gap: 10 },
    builderDayCard: { backgroundColor: c.card, borderRadius: radius.card, padding: 16, marginTop: 8, borderWidth: 1, borderColor: c.border },
    builderDayHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
    dayNameInput: { flex: 1, backgroundColor: c.cardAlt, borderRadius: radius.md, color: c.text, padding: 10, fontSize: 15, fontWeight: weight.bold },
    restToggle: { backgroundColor: c.cardAlt, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
    restToggleActive: { backgroundColor: c.bgSecondary, borderWidth: 1, borderColor: c.info },
    restToggleText: { color: c.textTertiary, fontSize: 13, fontWeight: weight.bold },
    restToggleTextActive: { color: c.info },
    restLabel: { textAlign: 'center', color: c.textTertiary, fontSize: 14, paddingVertical: 24, fontWeight: weight.medium },
    builderEx: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.cardAlt, borderRadius: radius.md, padding: 12, marginBottom: 8 },
    builderExInfo: { flex: 1 },
    builderExName: { fontSize: 14, fontWeight: weight.bold, color: c.text },
    builderExDetail: { fontSize: 11, color: c.textTertiary, fontWeight: weight.semibold, marginTop: 2 },
    removeEx: { color: c.textTertiary, fontSize: 20, paddingLeft: 12 },
    addExForm: { borderTopWidth: 1, borderTopColor: c.border, marginTop: 8, paddingTop: 16 },
    addExBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 14, alignItems: 'center' },
    aiRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    aiGenBtn: { backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6, minWidth: 44, alignItems: 'center' },
    aiGenBtnText: { color: c.accentText, fontSize: 12, fontWeight: weight.heavy },
    addExBtnText: { color: c.accentText, fontSize: 14, fontWeight: weight.heavy },
    poSuggestion: { backgroundColor: c.accentMuted, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10 },
    poSuggestionText: { color: c.accent, fontSize: 12, fontWeight: weight.bold },
    lastSessionLabel: { fontSize: 11, color: c.textTertiary, fontWeight: weight.semibold, marginBottom: 6 },
    poChipRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.accentMuted, paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.accentDim + '30' },
    poChipText: { flex: 1, color: c.accent, fontSize: 12, fontWeight: weight.semibold },
    poChipArrow: { color: c.accent, fontSize: 14, fontWeight: weight.bold, marginLeft: 8, opacity: 0.7 },
    poNewChip: { paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border },
    poNewChipText: { color: c.textTertiary, fontSize: 12, fontWeight: weight.medium },
    modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
    modalHeaderTitle: { fontSize: 17, fontWeight: weight.heavy, color: c.text },
    modalCloseBtn: { backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
    modalCloseBtnText: { color: c.accentText, fontSize: 14, fontWeight: weight.heavy },
    // Now-playing bar
    nowPlayingBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: c.cardAlt, paddingHorizontal: spacing.lg, paddingVertical: 10,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    nowPlayingName: { flex: 1, fontSize: 13, fontWeight: weight.semibold, color: c.accent, marginRight: 12 },
    nowPlayingPause: { fontSize: 20, color: c.text },
    // Finish workout button
    finishBtn: { backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
    finishBtnText: { color: c.accentText, fontSize: 12, fontWeight: weight.heavy },
    // Last set button
    lastSetBtn: { width: 28, alignItems: 'center', justifyContent: 'center' },
    // PR overlay
    prOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.88)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    prCard: {
      backgroundColor: '#1A1A0A',
      borderRadius: radius.xl,
      borderWidth: 2,
      borderColor: '#F5A623',
      paddingHorizontal: 40,
      paddingVertical: 36,
      alignItems: 'center',
      gap: 8,
    },
    prEmoji: { fontSize: 52 },
    prTitle: { fontSize: 28, fontWeight: weight.heavy, color: '#F5A623', letterSpacing: -0.5 },
    prExercise: { fontSize: 16, fontWeight: weight.semibold, color: c.text, textAlign: 'center' },
    prWeight: { fontSize: 22, fontWeight: weight.heavy, color: '#F5A623', marginTop: 4 },
    // Share card modal
    shareHeader: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    shareCloseBtn: { fontSize: 15, color: c.textSecondary, fontWeight: weight.medium, width: 48 },
    shareHeaderTitle: { fontSize: 16, fontWeight: weight.heavy, color: c.text },
    shareActionBtn: { fontSize: 15, color: c.accent, fontWeight: weight.heavy, width: 48, textAlign: 'right' },
    shareCard: {
      backgroundColor: '#08090B',
      borderRadius: radius.xl,
      padding: 24,
      borderWidth: 1,
      borderColor: '#232527',
    },
    shareCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    shareCardBrand: { fontSize: 18, fontWeight: weight.heavy, color: '#C8FF3D', letterSpacing: 2 },
    shareCardDate: { fontSize: 12, color: '#5A5A5A', fontWeight: weight.semibold },
    shareCardDivider: { height: 1, backgroundColor: '#C8FF3D', marginVertical: 16, opacity: 0.4 },
    shareCardWorkout: { fontSize: 22, fontWeight: weight.heavy, color: '#F5F5F5', marginBottom: 16, letterSpacing: -0.5 },
    shareCardStats: { flexDirection: 'row', gap: 24, marginBottom: 16 },
    shareCardStat: { alignItems: 'flex-start' },
    shareCardStatVal: { fontSize: 22, fontWeight: weight.heavy, color: '#F5F5F5', letterSpacing: -0.5 },
    shareCardStatLabel: { fontSize: 11, color: '#5A5A5A', fontWeight: weight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },
    shareCardTopLabel: { fontSize: 10, fontWeight: weight.bold, color: '#5A5A5A', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 },
    shareCardExRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    shareCardExName: { fontSize: 14, fontWeight: weight.semibold, color: '#9A9A9A', flex: 1 },
    shareCardExBest: { fontSize: 14, fontWeight: weight.heavy, color: '#F5F5F5' },
    shareCardFooter: { fontSize: 11, color: '#3A3A3A', fontWeight: weight.semibold, textAlign: 'right', marginTop: 4 },
    templateExRow: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: c.card,
      borderRadius: radius.md, padding: 12, marginBottom: 8,
      borderWidth: 1, borderColor: c.border, gap: 12,
    },
    templateExNum: {
      width: 28, height: 28, borderRadius: 14,
      backgroundColor: c.cardAlt, alignItems: 'center', justifyContent: 'center',
    },
    templateExNumText: { fontSize: 12, fontWeight: weight.bold, color: c.textTertiary },
    templateExName: { fontSize: 14, fontWeight: weight.bold, color: c.text, marginBottom: 2 },
    templateExDetail: { fontSize: 11, color: c.textTertiary, fontWeight: weight.semibold },
    startTemplateBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 16, alignItems: 'center' },
    startTemplateBtnText: { color: c.accentText, fontSize: 16, fontWeight: weight.heavy },
  });
}
