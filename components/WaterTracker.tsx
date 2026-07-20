import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput, Modal, ScrollView, AppState,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { toLocalDateString } from '../utils/dateUtils';

export const WATER_GOAL_KEY = 'fuelog_water_goal_cups';
const WATER_LOG_KEY = 'fuelog_water_log';
const WATER_BLUE = '#3B82F6';
export const DEFAULT_WATER_GOAL = 8;

type WaterEntry = { time: string; cups: number };
type WaterLog = { date: string; entries: WaterEntry[] };

function todayStr() { return toLocalDateString(); }

async function loadTodayEntries(): Promise<WaterEntry[]> {
  const raw = await AsyncStorage.getItem(WATER_LOG_KEY);
  if (!raw) return [];
  const log: WaterLog = JSON.parse(raw);
  return log.date === todayStr() ? log.entries : [];
}

async function saveEntries(entries: WaterEntry[]): Promise<void> {
  await AsyncStorage.setItem(WATER_LOG_KEY, JSON.stringify({ date: todayStr(), entries }));
}

function r1(n: number) { return Math.round(n * 10) / 10; }

export default function WaterTracker() {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [entries, setEntries] = useState<WaterEntry[]>([]);
  const [goal, setGoal] = useState(DEFAULT_WATER_GOAL);
  const [showDetail, setShowDetail] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const prevGoalHitRef = useRef(false);

  const load = useCallback(async () => {
    const [e, g] = await Promise.all([
      loadTodayEntries(),
      AsyncStorage.getItem(WATER_GOAL_KEY),
    ]);
    setEntries(e);
    if (g) setGoal(parseInt(g, 10) || DEFAULT_WATER_GOAL);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Reload goal if it was changed in ProfileScreen when app comes back to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        AsyncStorage.getItem(WATER_GOAL_KEY).then(g => {
          if (g) setGoal(parseInt(g, 10) || DEFAULT_WATER_GOAL);
        });
      }
    });
    return () => sub.remove();
  }, []);

  const total = entries.reduce((a, e) => a + e.cups, 0);
  const pct = Math.min(1, total / goal);
  const goalHit = pct >= 1;
  const barColor = goalHit ? colors.accent : WATER_BLUE;

  useEffect(() => {
    if (goalHit && !prevGoalHitRef.current) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    prevGoalHitRef.current = goalHit;
  }, [goalHit]);

  const addCups = async (cups: number) => {
    const next = [...entries, { time: new Date().toISOString(), cups }];
    setEntries(next);
    await saveEntries(next);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const removeEntry = async (index: number) => {
    const next = entries.filter((_, i) => i !== index);
    setEntries(next);
    await saveEntries(next);
  };

  const addCustom = async () => {
    const cups = parseFloat(customInput);
    if (!cups || cups <= 0) return;
    await addCups(cups);
    setCustomInput('');
  };

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <>
      <View style={s.card}>
        <View style={s.row}>
          <Text style={s.label}>WATER</Text>
          <Text style={s.counter}>
            <Text style={[s.counterVal, goalHit && s.counterHit]}>{r1(total)}</Text>
            <Text style={s.counterGoal}> / {goal} cups</Text>
          </Text>
        </View>

        <TouchableOpacity onPress={() => setShowDetail(true)} activeOpacity={0.85}>
          <View style={s.barBg}>
            <View style={[s.barFill, { width: `${pct * 100}%` as any, backgroundColor: barColor }]} />
          </View>
          <Text style={s.barSub}>
            {goalHit ? 'Goal reached! 💧' : `${r1(Math.max(0, goal - total))} cups to go`}
          </Text>
        </TouchableOpacity>

        <View style={s.quickAdd}>
          {([1, 2, 3] as const).map(cups => (
            <TouchableOpacity key={cups} style={s.addBtn} onPress={() => addCups(cups)} activeOpacity={0.7}>
              <Text style={[s.addBtnText, { color: barColor }]}>
                {cups === 3 ? '🍼 +3 cups' : cups === 1 ? '💧 +1 cup' : '💧 +2 cups'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <Modal visible={showDetail} transparent animationType="slide" onRequestClose={() => setShowDetail(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setShowDetail(false)}>
          <TouchableOpacity activeOpacity={1} style={s.sheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Water Log</Text>
            <Text style={s.sheetSub}>{r1(total)} / {goal} cups today</Text>

            <ScrollView style={s.entryList} showsVerticalScrollIndicator={false}>
              {entries.length === 0 && <Text style={s.empty}>No entries yet</Text>}
              {[...entries].reverse().map((e, revIdx) => {
                const realIdx = entries.length - 1 - revIdx;
                return (
                  <View key={revIdx} style={s.entryRow}>
                    <Text style={s.entryTime}>{fmtTime(e.time)}</Text>
                    <Text style={s.entryAmt}>{r1(e.cups)} cup{e.cups !== 1 ? 's' : ''}</Text>
                    <TouchableOpacity onPress={() => removeEntry(realIdx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={s.entryDel}>×</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>

            <View style={s.customRow}>
              <TextInput
                style={s.customInput}
                placeholder="Custom amount (cups)"
                placeholderTextColor={colors.textTertiary}
                value={customInput}
                onChangeText={setCustomInput}
                keyboardType="decimal-pad"
                returnKeyType="done"
                onSubmitEditing={addCustom}
              />
              <TouchableOpacity style={[s.customBtn, { backgroundColor: WATER_BLUE }]} onPress={addCustom}>
                <Text style={s.customBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg,
      marginBottom: spacing.xl, borderWidth: 1, borderColor: c.border,
    },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    label: { fontSize: 11, fontWeight: weight.semibold, color: c.textSecondary, letterSpacing: 1.5 },
    counter: {},
    counterVal: { fontSize: 18, fontWeight: weight.heavy, color: c.text },
    counterHit: { color: c.accent },
    counterGoal: { fontSize: 13, color: c.textSecondary, fontWeight: weight.regular },
    barBg: { backgroundColor: c.border, borderRadius: 6, height: 10, marginBottom: 6, overflow: 'hidden' },
    barFill: { height: 10, borderRadius: 6 },
    barSub: { fontSize: 11, color: c.textSecondary, fontWeight: weight.medium, marginBottom: 14 },
    quickAdd: { flexDirection: 'row', gap: 8 },
    addBtn: { flex: 1, backgroundColor: c.cardAlt, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center' },
    addBtnText: { fontSize: 12, fontWeight: weight.bold },
    // Sheet modal
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: c.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
      padding: spacing.xl, paddingBottom: 40, maxHeight: '75%',
    },
    sheetHandle: { width: 36, height: 4, backgroundColor: c.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    sheetTitle: { fontSize: 18, fontWeight: weight.heavy, color: c.text, marginBottom: 4 },
    sheetSub: { fontSize: 13, color: c.textSecondary, marginBottom: 16 },
    entryList: { maxHeight: 240 },
    empty: { color: c.textTertiary, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
    entryRow: {
      flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    entryTime: { flex: 1, fontSize: 13, color: c.textSecondary, fontWeight: weight.medium },
    entryAmt: { fontSize: 14, fontWeight: weight.semibold, color: c.text, marginRight: 12 },
    entryDel: { fontSize: 20, color: c.textTertiary, paddingHorizontal: 4 },
    customRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
    customInput: {
      flex: 1, backgroundColor: c.cardAlt, borderRadius: radius.sm,
      color: c.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    },
    customBtn: { borderRadius: radius.sm, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
    customBtnText: { color: '#fff', fontWeight: weight.bold, fontSize: 14 },
  });
}
