import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Modal, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { PRESET_PROGRAMS } from '../constants/programs';
import CoachScreen from './CoachScreen';

const todayStr = () => new Date().toISOString().split('T')[0];
function initSets(ex: any) { return Array.from({ length: ex.sets }, () => ({ weight: '', reps: '', done: false })); }

const LEVEL_COLORS: Record<string, string> = {
  Beginner: '#4ade80',
  Intermediate: '#fbbf24',
  Advanced: '#f472b6',
};

export default function WorkoutScreen() {
  const { user } = useAuth();
  const [view, setView] = useState<'select' | 'workout' | 'builder'>('select');
  const [activeProgram, setActiveProgram] = useState<any>(null);
  const [activeDay, setActiveDay] = useState(0);
  const [expandedEx, setExpandedEx] = useState<string | null>(null);
  const [dayLog, setDayLog] = useState<Record<string, any>>({});
  const [customWorkouts, setCustomWorkouts] = useState<any[]>([]);
  const [loadingCustom, setLoadingCustom] = useState(true);
  const [coachExercise, setCoachExercise] = useState<string | null>(null);

  const [builderName, setBuilderName] = useState('My Workout');
  const [builderDays, setBuilderDays] = useState<any[]>([
    { day: 'Day 1', name: 'Day 1', type: 'training', exercises: [] },
  ]);
  const [builderDayIndex, setBuilderDayIndex] = useState(0);
  const [savingWorkout, setSavingWorkout] = useState(false);
  const [exName, setExName] = useState('');
  const [exSets, setExSets] = useState('3');
  const [exReps, setExReps] = useState('10');

  const fetchCustomWorkouts = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('custom_workouts').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    setCustomWorkouts(data || []);
    setLoadingCustom(false);
  }, [user]);

  useEffect(() => { fetchCustomWorkouts(); }, [fetchCustomWorkouts]);

  const date = todayStr();
  const plan = activeProgram?.days?.[activeDay];

  const fetchLog = useCallback(async () => {
    if (!user || !activeProgram) return;
    const { data } = await supabase.from('workout_logs')
      .select('*').eq('user_id', user.id).eq('date', date).eq('day_index', activeDay);
    const log: Record<string, any> = {};
    (data || []).forEach((row: any) => { log[row.exercise_id] = { done: row.done, sets: row.sets || [] }; });
    setDayLog(log);
  }, [user, activeProgram, activeDay, date]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

  const upsertEx = async (exId: string, done: boolean, sets: any[]) => {
    await supabase.from('workout_logs').upsert({
      user_id: user!.id, date, day_index: activeDay, exercise_id: exId, done, sets,
    }, { onConflict: 'user_id,date,day_index,exercise_id' });
  };

  const toggleExDone = async (exId: string) => {
    const ex = plan.exercises.find((e: any) => e.id === exId)!;
    const cur = dayLog[exId] || { done: false, sets: initSets(ex) };
    const updated = { ...cur, done: !cur.done };
    setDayLog(prev => ({ ...prev, [exId]: updated }));
    await upsertEx(exId, updated.done, updated.sets);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const updateSet = async (exId: string, si: number, field: string, value: string) => {
    const ex = plan.exercises.find((e: any) => e.id === exId)!;
    const cur = dayLog[exId] || { done: false, sets: initSets(ex) };
    const sets = cur.sets.map((s: any, i: number) => i === si ? { ...s, [field]: value } : s);
    setDayLog(prev => ({ ...prev, [exId]: { ...cur, sets } }));
    await upsertEx(exId, cur.done, sets);
  };

  const toggleSetDone = async (exId: string, si: number) => {
    const ex = plan.exercises.find((e: any) => e.id === exId)!;
    const cur = dayLog[exId] || { done: false, sets: initSets(ex) };
    const sets = cur.sets.map((s: any, i: number) => i === si ? { ...s, done: !s.done } : s);
    const allDone = sets.every((s: any) => s.done);
    const updated = { ...cur, sets, done: allDone };
    setDayLog(prev => ({ ...prev, [exId]: updated }));
    await upsertEx(exId, allDone, sets);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

  const saveCustomWorkout = async () => {
    setSavingWorkout(true);
    await supabase.from('custom_workouts').insert({ user_id: user!.id, name: builderName, days: builderDays });
    await fetchCustomWorkouts();
    setSavingWorkout(false);
    setView('select');
    setBuilderName('My Workout');
    setBuilderDays([{ day: 'Day 1', name: 'Day 1', type: 'training', exercises: [] }]);
    setBuilderDayIndex(0);
    Alert.alert('Saved!', 'Your custom workout has been saved.');
  };

  const deleteCustomWorkout = (id: number, name: string) => {
    Alert.alert('Delete Workout', `Delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await supabase.from('custom_workouts').delete().eq('id', id); await fetchCustomWorkouts(); } },
    ]);
  };

  if (view === 'select') {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <Text style={s.title}>Workout</Text>
          <TouchableOpacity style={s.buildBtn} onPress={() => setView('builder')}>
            <Text style={s.buildBtnText}>+ Build</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          <Text style={s.sectionTitle}>PRESET PROGRAMS</Text>
          {PRESET_PROGRAMS.map(prog => (
            <TouchableOpacity key={prog.id} style={s.programCard} onPress={() => { setActiveProgram(prog); setActiveDay(0); setView('workout'); }} activeOpacity={0.8}>
              <View style={s.programTop}>
                <Text style={s.programName}>{prog.name}</Text>
                <View style={[s.levelBadge, { backgroundColor: LEVEL_COLORS[prog.level] + '22' }]}>
                  <Text style={[s.levelText, { color: LEVEL_COLORS[prog.level] }]}>{prog.level}</Text>
                </View>
              </View>
              <Text style={s.programDesc}>{prog.description}</Text>
              <Text style={s.programDays}>{prog.days.length} days · {prog.days.filter((d: any) => d.type === 'training').length} training</Text>
            </TouchableOpacity>
          ))}

          <Text style={[s.sectionTitle, { marginTop: 24 }]}>MY CUSTOM WORKOUTS</Text>
          {loadingCustom && <ActivityIndicator color="#fff" style={{ marginTop: 20 }} />}
          {!loadingCustom && customWorkouts.length === 0 && (
            <Text style={s.emptyText}>No custom workouts yet.{'\n'}Tap "+ Build" to create one!</Text>
          )}
          {customWorkouts.map(w => (
            <TouchableOpacity key={w.id} style={s.programCard} onPress={() => { setActiveProgram({ ...w, days: w.days }); setActiveDay(0); setView('workout'); }} activeOpacity={0.8}>
              <View style={s.programTop}>
                <Text style={s.programName}>{w.name}</Text>
                <TouchableOpacity onPress={() => deleteCustomWorkout(w.id, w.name)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={s.deleteCustom}>×</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.programDays}>{w.days.length} days · {w.days.filter((d: any) => d.type === 'training').length} training</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (view === 'builder') {
    const currentDay = builderDays[builderDayIndex];
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => setView('select')}><Text style={s.backBtn}>‹ Back</Text></TouchableOpacity>
          <Text style={s.headerTitle}>Build Workout</Text>
          <TouchableOpacity onPress={saveCustomWorkout} disabled={savingWorkout}>
            {savingWorkout ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtn}>Save</Text>}
          </TouchableOpacity>
        </View>
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={s.fieldLabel}>Workout Name</Text>
          <TextInput style={s.input} value={builderName} onChangeText={setBuilderName} placeholderTextColor="#444" />
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
              <TextInput style={s.dayNameInput} value={currentDay.name} onChangeText={v => { const days = builderDays.map((d, i) => i === builderDayIndex ? { ...d, name: v } : d); setBuilderDays(days); }} placeholderTextColor="#444" />
              <TouchableOpacity style={[s.restToggle, currentDay.type === 'rest' && s.restToggleActive]} onPress={() => toggleDayRest(builderDayIndex)}>
                <Text style={[s.restToggleText, currentDay.type === 'rest' && s.restToggleTextActive]}>😴 Rest</Text>
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
                  <Text style={s.fieldLabel}>Add Exercise</Text>
                  <TextInput style={s.input} value={exName} onChangeText={setExName} placeholder="Exercise name" placeholderTextColor="#444" />
                  <View style={s.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.fieldLabel}>Sets</Text>
                      <TextInput style={s.input} value={exSets} onChangeText={setExSets} keyboardType="number-pad" placeholder="3" placeholderTextColor="#444" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.fieldLabel}>Reps</Text>
                      <TextInput style={s.input} value={exReps} onChangeText={setExReps} placeholder="10" placeholderTextColor="#444" />
                    </View>
                  </View>
                  <TouchableOpacity style={s.addExBtn} onPress={addExerciseToDay}>
                    <Text style={s.addExBtnText}>+ Add Exercise</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            {currentDay.type === 'rest' && <Text style={s.restLabel}>😴 Rest day — no exercises needed</Text>}
          </View>
        </ScrollView>
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
        <TouchableOpacity onPress={() => setView('select')}><Text style={s.backBtn}>‹ Programs</Text></TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{activeProgram?.name}</Text>
        <View style={{ width: 70 }} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.dayPicker} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
        {activeProgram.days.map((p: any, i: number) => (
          <TouchableOpacity key={i} style={[s.dayChip, i === activeDay && s.dayChipActive, p.type === 'rest' && s.dayChipRest, i === activeDay && p.type === 'rest' && s.dayChipRestActive]}
            onPress={() => { setActiveDay(i); setExpandedEx(null); }}>
            <Text style={[s.dayChipText, i === activeDay && s.dayChipTextActive, p.type === 'rest' && i !== activeDay && s.dayChipTextRest]}>{p.day}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.dayHeader}>
          <View>
            <Text style={s.dayTitle}>{plan.name}</Text>
            {plan.type === 'training' && <Text style={s.daySub}>{totalEx} exercises · {plan.exercises.reduce((a: number, e: any) => a + e.sets, 0)} sets</Text>}
          </View>
          {allDone && <View style={s.badge}><Text style={s.badgeText}>✓ Done</Text></View>}
        </View>
        {plan.type === 'rest' ? (
          <View style={s.restMsg}>
            <Text style={s.restIcon}>😴</Text>
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
            {plan.exercises.map((ex: any) => {
              const exLog = dayLog[ex.id] || { done: false, sets: [] };
              const sets = exLog.sets.length === ex.sets ? exLog.sets : initSets(ex);
              const isOpen = expandedEx === ex.id;
              const isDone = exLog.done;
              return (
                <View key={ex.id} style={[s.exCard, isDone && s.exCardDone]}>
                  <TouchableOpacity style={s.exHeader} onPress={() => setExpandedEx(isOpen ? null : ex.id)} activeOpacity={0.7}>
                    <TouchableOpacity style={[s.exCheck, isDone && s.exCheckDone]} onPress={() => toggleExDone(ex.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      {isDone && <Text style={s.exCheckMark}>✓</Text>}
                    </TouchableOpacity>
                    <View style={s.exInfo}>
                      <Text style={[s.exName, isDone && s.exNameDone]} numberOfLines={1}>{ex.name}</Text>
                      <Text style={s.exSets}>{ex.sets} sets × {ex.reps} reps</Text>
                    </View>
                    <TouchableOpacity style={s.coachBtn} onPress={() => setCoachExercise(ex.name)}>
                      <Text style={s.coachBtnText}>💡</Text>
                    </TouchableOpacity>
                    <Text style={[s.arrow, isOpen && s.arrowOpen]}>▾</Text>
                  </TouchableOpacity>
                  {isOpen && (
                    <View style={s.exBody}>
                      <View style={s.setsHeader}>
                        <Text style={[s.setHText, { width: 28 }]}>Set</Text>
                        <Text style={[s.setHText, { flex: 1 }]}>Weight</Text>
                        <Text style={[s.setHText, { flex: 1 }]}>Reps</Text>
                        <Text style={[s.setHText, { width: 36 }]}>✓</Text>
                      </View>
                      {sets.map((set: any, si: number) => (
                        <View key={si} style={s.setRow}>
                          <Text style={s.setNum}>{si + 1}</Text>
                          <TextInput style={s.setInput} placeholder="lbs" placeholderTextColor="#333" value={set.weight} onChangeText={v => updateSet(ex.id, si, 'weight', v)} keyboardType="decimal-pad" selectTextOnFocus />
                          <TextInput style={s.setInput} placeholder="—" placeholderTextColor="#333" value={set.reps} onChangeText={v => updateSet(ex.id, si, 'reps', v)} keyboardType="decimal-pad" selectTextOnFocus />
                          <TouchableOpacity style={[s.setCheckBtn, set.done && s.setCheckBtnDone]} onPress={() => toggleSetDone(ex.id, si)}>
                            <Text style={[s.setCheckText, set.done && s.setCheckTextDone]}>✓</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
      <Modal visible={!!coachExercise} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCoachExercise(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#121212' }} edges={['top']}>
          <View style={s.modalHeaderRow}>
            <Text style={s.modalHeaderTitle}>Exercise Coach</Text>
            <TouchableOpacity style={s.modalCloseBtn} onPress={() => setCoachExercise(null)}>
              <Text style={s.modalCloseBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
          {coachExercise && <CoachScreen initialExercise={coachExercise} />}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff', flex: 1, textAlign: 'center' },
  backBtn: { color: '#fff', fontSize: 16, fontWeight: '600', width: 80 },
  saveBtn: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'right', width: 60 },
  buildBtn: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  buildBtnText: { color: '#000', fontSize: 14, fontWeight: '800' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#444', letterSpacing: 1.5, marginBottom: 12 },
  programCard: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16, marginBottom: 10 },
  programTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  programName: { fontSize: 17, fontWeight: '800', color: '#fff', flex: 1 },
  levelBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  levelText: { fontSize: 11, fontWeight: '700' },
  programDesc: { fontSize: 13, color: '#555', fontWeight: '500', marginBottom: 6 },
  programDays: { fontSize: 12, color: '#444', fontWeight: '600' },
  emptyText: { textAlign: 'center', color: '#333', fontSize: 14, paddingVertical: 32, lineHeight: 24, fontWeight: '500' },
  deleteCustom: { color: '#333', fontSize: 22, paddingLeft: 12 },
  dayPicker: { maxHeight: 52, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  dayChip: { backgroundColor: '#1e1e1e', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  dayChipActive: { backgroundColor: '#fff' },
  dayChipRest: { backgroundColor: '#161616' },
  dayChipRestActive: { backgroundColor: '#1e1e1e' },
  dayChipText: { color: '#555', fontSize: 13, fontWeight: '700' },
  dayChipTextActive: { color: '#000' },
  dayChipTextRest: { color: '#2a2a2a' },
  addDayChip: { backgroundColor: '#252525', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, borderWidth: 1, borderColor: '#333' },
  addDayChipText: { color: '#555', fontSize: 13, fontWeight: '700' },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  dayTitle: { fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  daySub: { fontSize: 12, color: '#444', fontWeight: '600', marginTop: 4 },
  badge: { backgroundColor: '#1a3a1a', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  badgeText: { color: '#4ade80', fontSize: 12, fontWeight: '700' },
  restMsg: { alignItems: 'center', paddingVertical: 60 },
  restIcon: { fontSize: 56, marginBottom: 18 },
  restTitle: { fontSize: 22, fontWeight: '900', color: '#fff', marginBottom: 10 },
  restSub: { fontSize: 13, color: '#444', textAlign: 'center', lineHeight: 22, fontWeight: '500' },
  progressCard: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 16 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  progressLabel: { fontSize: 13, color: '#555', fontWeight: '600' },
  progressVal: { fontSize: 13, color: '#fff', fontWeight: '700' },
  progBg: { backgroundColor: '#2a2a2a', borderRadius: 4, height: 4 },
  progFill: { backgroundColor: '#fff', borderRadius: 4, height: 4 },
  exCard: { backgroundColor: '#1a1a1a', borderRadius: 14, marginBottom: 8, overflow: 'hidden' },
  exCardDone: { backgroundColor: '#161f16' },
  exHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  exCheck: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: '#333', alignItems: 'center', justifyContent: 'center' },
  exCheckDone: { backgroundColor: '#4ade80', borderColor: '#4ade80' },
  exCheckMark: { color: '#000', fontSize: 13, fontWeight: '900' },
  exInfo: { flex: 1 },
  exName: { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 2 },
  exNameDone: { color: '#333', textDecorationLine: 'line-through' },
  exSets: { fontSize: 12, color: '#444', fontWeight: '600' },
  coachBtn: { backgroundColor: '#252525', borderRadius: 8, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  coachBtnText: { fontSize: 16 },
  arrow: { color: '#333', fontSize: 14, fontWeight: '700' },
  arrowOpen: { color: '#555', transform: [{ rotate: '180deg' }] },
  exBody: { borderTopWidth: 1, borderTopColor: '#222', paddingHorizontal: 16, paddingBottom: 14 },
  setsHeader: { flexDirection: 'row', gap: 8, paddingVertical: 10, alignItems: 'center' },
  setHText: { fontSize: 10, fontWeight: '700', color: '#444', textTransform: 'uppercase', textAlign: 'center', letterSpacing: 0.5 },
  setRow: { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' },
  setNum: { width: 28, fontSize: 12, color: '#444', fontWeight: '700', textAlign: 'center' },
  setInput: { flex: 1, backgroundColor: '#222', borderRadius: 8, color: '#fff', padding: 9, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  setCheckBtn: { width: 36, height: 36, borderRadius: 8, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  setCheckBtnDone: { backgroundColor: '#1a3a1a' },
  setCheckText: { color: '#444', fontSize: 14, fontWeight: '700' },
  setCheckTextDone: { color: '#4ade80' },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#1e1e1e', borderRadius: 12, color: '#fff', padding: 14, fontSize: 15, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 10 },
  builderDayCard: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16, marginTop: 8 },
  builderDayHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  dayNameInput: { flex: 1, backgroundColor: '#252525', borderRadius: 10, color: '#fff', padding: 10, fontSize: 15, fontWeight: '700' },
  restToggle: { backgroundColor: '#252525', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  restToggleActive: { backgroundColor: '#1e1e2e' },
  restToggleText: { color: '#555', fontSize: 13, fontWeight: '700' },
  restToggleTextActive: { color: '#4a9eff' },
  restLabel: { textAlign: 'center', color: '#444', fontSize: 14, paddingVertical: 24, fontWeight: '500' },
  builderEx: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#252525', borderRadius: 10, padding: 12, marginBottom: 8 },
  builderExInfo: { flex: 1 },
  builderExName: { fontSize: 14, fontWeight: '700', color: '#fff' },
  builderExDetail: { fontSize: 11, color: '#555', fontWeight: '600', marginTop: 2 },
  removeEx: { color: '#333', fontSize: 20, paddingLeft: 12 },
  addExForm: { borderTopWidth: 1, borderTopColor: '#222', marginTop: 8, paddingTop: 16 },
  addExBtn: { backgroundColor: '#fff', borderRadius: 12, padding: 14, alignItems: 'center' },
  addExBtnText: { color: '#000', fontSize: 14, fontWeight: '800' },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#222' },
  modalHeaderTitle: { fontSize: 17, fontWeight: '800', color: '#fff' },
  modalCloseBtn: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  modalCloseBtnText: { color: '#000', fontSize: 14, fontWeight: '800' },
});
