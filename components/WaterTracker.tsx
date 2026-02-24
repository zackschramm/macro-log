import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';

const DEFAULT_GOAL = 128;
const QUICK_ADD = [8, 16, 20, 32];
const GOAL_KEY = 'water_goal_oz';
const todayStr = () => new Date().toISOString().split('T')[0];

export default function WaterTracker() {
  const { user } = useAuth();
  const [total, setTotal] = useState(0);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');

  const fetchWater = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('water_logs')
      .select('oz').eq('user_id', user.id).eq('date', todayStr());
    const sum = (data || []).reduce((a: number, r: any) => a + r.oz, 0);
    setTotal(sum);
  }, [user]);

  const loadGoal = useCallback(async () => {
    const stored = await AsyncStorage.getItem(GOAL_KEY);
    if (stored) setGoal(parseInt(stored));
  }, []);

  useEffect(() => { fetchWater(); loadGoal(); }, [fetchWater, loadGoal]);

  const addWater = async (oz: number) => {
    await supabase.from('water_logs').insert({ user_id: user!.id, date: todayStr(), oz });
    setTotal(prev => prev + oz);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const reset = async () => {
    await supabase.from('water_logs').delete().eq('user_id', user!.id).eq('date', todayStr());
    setTotal(0);
  };

  const saveGoal = async () => {
    const val = parseInt(goalInput);
    if (!val || val < 8 || val > 512) {
      Alert.alert('Invalid Goal', 'Please enter a value between 8 and 512 oz.');
      return;
    }
    setGoal(val);
    await AsyncStorage.setItem(GOAL_KEY, String(val));
    setEditingGoal(false);
    setGoalInput('');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const pct = Math.min(1, total / goal);
  const cups = Math.round(total / 8);
  const remaining = Math.max(0, goal - total);

  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <Text style={s.cardTitle}>WATER</Text>
        <View style={s.headerRight}>
          <TouchableOpacity onPress={() => { setGoalInput(String(goal)); setEditingGoal(!editingGoal); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.goalBtn}>Goal: {goal}oz</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={reset} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.resetBtn}>Reset</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Goal editor */}
      {editingGoal && (
        <View style={s.goalEditor}>
          <TextInput
            style={s.goalInput}
            value={goalInput}
            onChangeText={setGoalInput}
            keyboardType="number-pad"
            placeholder="oz per day"
            placeholderTextColor="#444"
            autoFocus
          />
          <View style={s.goalPresets}>
            {[64, 80, 96, 128].map(oz => (
              <TouchableOpacity key={oz} style={[s.presetBtn, goal === oz && s.presetBtnActive]} onPress={() => setGoalInput(String(oz))}>
                <Text style={[s.presetText, goal === oz && s.presetTextActive]}>{oz}oz</Text>
                <Text style={s.presetSub}>{oz === 64 ? '½ gal' : oz === 128 ? '1 gal' : `${(oz/128).toFixed(2).replace(/0+$/, '')}g`}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={s.saveGoalBtn} onPress={saveGoal}>
            <Text style={s.saveGoalBtnText}>Save Goal</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Progress bar */}
      <View style={s.progressWrap}>
        <View style={s.progressBg}>
          <View style={[s.progressFill, { width: `${pct * 100}%` as any }]} />
        </View>
        <Text style={s.progressLabel}>{remaining > 0 ? `${remaining} oz to go` : '🎉 Goal reached!'}</Text>
      </View>

      {/* Stats */}
      <View style={s.stats}>
        <View style={s.stat}>
          <Text style={s.statVal}>{total}</Text>
          <Text style={s.statLabel}>oz</Text>
        </View>
        <View style={s.stat}>
          <Text style={s.statVal}>{cups}</Text>
          <Text style={s.statLabel}>cups</Text>
        </View>
        <View style={s.stat}>
          <Text style={s.statVal}>{(total / 128).toFixed(1)}</Text>
          <Text style={s.statLabel}>gallons</Text>
        </View>
        <View style={s.stat}>
          <Text style={[s.statVal, { color: pct >= 1 ? '#4ade80' : '#4a9eff' }]}>{Math.round(pct * 100)}%</Text>
          <Text style={s.statLabel}>of goal</Text>
        </View>
      </View>

      {/* Quick add */}
      <View style={s.quickAdd}>
        {QUICK_ADD.map(oz => (
          <TouchableOpacity key={oz} style={s.addBtn} onPress={() => addWater(oz)} activeOpacity={0.7}>
            <Text style={s.addBtnIcon}>💧</Text>
            <Text style={s.addBtnText}>+{oz}oz</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16, marginBottom: 20 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  cardTitle: { fontSize: 11, fontWeight: '700', color: '#444', letterSpacing: 1.5 },
  headerRight: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  goalBtn: { fontSize: 12, color: '#4a9eff', fontWeight: '700' },
  resetBtn: { fontSize: 12, color: '#444', fontWeight: '600' },
  goalEditor: { backgroundColor: '#252525', borderRadius: 12, padding: 14, marginBottom: 14, gap: 12 },
  goalInput: { backgroundColor: '#1a1a1a', borderRadius: 10, color: '#fff', padding: 12, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  goalPresets: { flexDirection: 'row', gap: 8 },
  presetBtn: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 10, alignItems: 'center' },
  presetBtnActive: { backgroundColor: '#4a9eff22' },
  presetText: { fontSize: 13, fontWeight: '800', color: '#555' },
  presetTextActive: { color: '#4a9eff' },
  presetSub: { fontSize: 9, color: '#444', fontWeight: '600', marginTop: 2 },
  saveGoalBtn: { backgroundColor: '#fff', borderRadius: 10, padding: 12, alignItems: 'center' },
  saveGoalBtnText: { color: '#000', fontSize: 14, fontWeight: '800' },
  progressWrap: { marginBottom: 14 },
  progressBg: { backgroundColor: '#2a2a2a', borderRadius: 6, height: 10, marginBottom: 6 },
  progressFill: { backgroundColor: '#4a9eff', borderRadius: 6, height: 10 },
  progressLabel: { fontSize: 11, color: '#555', fontWeight: '600' },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  stat: { alignItems: 'center' },
  statVal: { fontSize: 18, fontWeight: '900', color: '#fff' },
  statLabel: { fontSize: 10, color: '#555', fontWeight: '600', marginTop: 2 },
  quickAdd: { flexDirection: 'row', gap: 8 },
  addBtn: { flex: 1, backgroundColor: '#252525', borderRadius: 10, padding: 10, alignItems: 'center', gap: 4 },
  addBtnIcon: { fontSize: 16 },
  addBtnText: { fontSize: 11, color: '#4a9eff', fontWeight: '800' },
});
