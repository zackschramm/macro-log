import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Modal, Alert, ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { useHealthKit } from '../hooks/useHealthKit';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';

const { width } = Dimensions.get('window');
const CHART_WIDTH = width - 64;
const CHART_HEIGHT = 120;

const MEASUREMENTS = [
  { key: 'chest_in', label: 'Chest', unit: 'in', color: '#4a9eff' },
  { key: 'waist_in', label: 'Waist', unit: 'in', color: '#f472b6' },
  { key: 'hips_in', label: 'Hips', unit: 'in', color: '#fbbf24' },
  { key: 'arms_in', label: 'Arms', unit: 'in', color: '#4ade80' },
  { key: 'thighs_in', label: 'Thighs', unit: 'in', color: '#a78bfa' },
];

const todayStr = () => new Date().toISOString().split('T')[0];
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtShort = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function LineChart({ data, color, unit }: { data: { date: string; value: number }[]; color: string; unit: string }) {
  if (data.length < 2) {
    return <Text style={{ color: '#333', fontSize: 12, marginTop: 8, textAlign: 'center', paddingVertical: 16 }}>Log more entries to see your trend</Text>;
  }

  const pts = data.slice(-10);
  const values = pts.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padH = 24;
  const padV = 16;
  const chartW = CHART_WIDTH - padH * 2;
  const chartH = CHART_HEIGHT - padV * 2;

  const toX = (i: number) => padH + (i / (pts.length - 1)) * chartW;
  const toY = (v: number) => padV + chartH - ((v - min) / range) * chartH;

  const points = pts.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  const first = values[0];
  const last = values[values.length - 1];
  const diff = last - first;
  const trendColor = diff === 0 ? '#555' : (unit === 'lbs' || unit === 'in') ? (diff < 0 ? '#4ade80' : '#ff4f4f') : (diff > 0 ? '#4ade80' : '#ff4f4f');

  return (
    <View style={{ marginTop: 8 }}>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
        {/* Grid lines */}
        {[0, 0.5, 1].map((t, i) => (
          <Line key={i} x1={padH} y1={padV + chartH * (1 - t)} x2={padH + chartW} y2={padV + chartH * (1 - t)}
            stroke="#222" strokeWidth="1" />
        ))}
        {/* Line */}
        <Polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* Dots */}
        {pts.map((d, i) => (
          <Circle key={i} cx={toX(i)} cy={toY(d.value)} r="3.5" fill={color} />
        ))}
        {/* Labels */}
        {pts.map((d, i) => (i === 0 || i === pts.length - 1) && (
          <SvgText key={i} x={toX(i)} y={CHART_HEIGHT - 2} textAnchor="middle" fill="#444" fontSize="9" fontWeight="600">
            {fmtShort(d.date)}
          </SvgText>
        ))}
        {/* Values */}
        <SvgText x={padH} y={toY(values[0]) - 6} textAnchor="middle" fill="#555" fontSize="9">{values[0].toFixed(1)}</SvgText>
        <SvgText x={toX(pts.length - 1)} y={toY(last) - 6} textAnchor="middle" fill={color} fontSize="10" fontWeight="700">{last.toFixed(1)}</SvgText>
      </Svg>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <Text style={{ fontSize: 16, fontWeight: '900', color: trendColor }}>
          {diff > 0 ? '+' : ''}{diff.toFixed(1)}{unit}
        </Text>
        <Text style={{ fontSize: 12, color: '#444', fontWeight: '500' }}>since first entry</Text>
      </View>
    </View>
  );
}

function MacroChart({ logs }: { logs: any[] }) {
  if (logs.length < 2) return null;
  const pts = logs.slice(-7);
  const colors = { calories: '#fff', protein: '#4ade80', carbs: '#fbbf24', fat: '#f472b6' };
  const keys = ['calories', 'protein', 'carbs', 'fat'] as const;

  return (
    <View style={{ marginTop: 8 }}>
      {keys.map(key => {
        const values = pts.map((l: any) => l[key] || 0);
        const max = Math.max(...values, 1);
        return (
          <View key={key} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 11, color: '#555', fontWeight: '700', textTransform: 'uppercase' }}>{key}</Text>
              <Text style={{ fontSize: 11, color: (colors as any)[key], fontWeight: '700' }}>
                avg {Math.round(values.reduce((a: number, b: number) => a + b, 0) / values.length)}{key === 'calories' ? '' : 'g'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 3, height: 24, alignItems: 'flex-end' }}>
              {pts.map((l: any, i: number) => {
                const pct = (l[key] || 0) / max;
                return (
                  <View key={i} style={{ flex: 1, backgroundColor: '#222', borderRadius: 3, height: '100%', justifyContent: 'flex-end' }}>
                    <View style={{ backgroundColor: (colors as any)[key], borderRadius: 3, height: `${Math.max(10, pct * 100)}%` as any }} />
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function ProgressScreen({ profile }: { profile: any }) {
  const { user } = useAuth();
  const health = useHealthKit();
  const [logs, setLogs] = useState<any[]>([]);
  const [macroLogs, setMacroLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'weight' | 'measurements'>('weight');
  const [form, setForm] = useState({
    weight_lbs: '', body_fat: '',
    chest_in: '', waist_in: '', hips_in: '', arms_in: '', thighs_in: '',
    notes: '',
  });

  const fetchLogs = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('progress_logs').select('*').eq('user_id', user.id).order('date');
    setLogs(data || []);

    // Fetch macro logs aggregated by day for last 30 days
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const { data: mData } = await supabase.from('macro_logs')
      .select('date, calories, protein, carbs, fat')
      .eq('user_id', user.id)
      .gte('date', since.toISOString().split('T')[0])
      .order('date');

    // Aggregate by date
    const byDate: Record<string, any> = {};
    (mData || []).forEach((row: any) => {
      if (!byDate[row.date]) byDate[row.date] = { date: row.date, calories: 0, protein: 0, carbs: 0, fat: 0 };
      byDate[row.date].calories += row.calories;
      byDate[row.date].protein += row.protein;
      byDate[row.date].carbs += row.carbs;
      byDate[row.date].fat += row.fat;
    });
    setMacroLogs(Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)));
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (health.isAvailable && !health.isAuthorized) health.requestPermissions();
  }, [health.isAvailable]);

  const handleSave = async () => {
    if (!form.weight_lbs && !form.chest_in && !form.waist_in) {
      Alert.alert('Please enter at least weight or one measurement'); return;
    }
    setSaving(true);
    const payload: any = { user_id: user!.id, date: todayStr(), notes: form.notes };
    if (form.weight_lbs) payload.weight_lbs = parseFloat(form.weight_lbs);
    if (form.body_fat) payload.body_fat = parseFloat(form.body_fat);
    MEASUREMENTS.forEach(m => { if ((form as any)[m.key]) payload[m.key] = parseFloat((form as any)[m.key]); });
    await supabase.from('progress_logs').upsert(payload, { onConflict: 'user_id,date' });
    if (form.weight_lbs && health.isAuthorized) await health.saveWeight(parseFloat(form.weight_lbs));
    await fetchLogs();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setModalVisible(false);
    setSaving(false);
    setForm({ weight_lbs: '', body_fat: '', chest_in: '', waist_in: '', hips_in: '', arms_in: '', thighs_in: '', notes: '' });
  };

  const importFromHealth = async () => {
    if (!health.isAuthorized) {
      const granted = await health.requestPermissions();
      if (!granted) { Alert.alert('Health Access', 'Please allow access to Apple Health in Settings.'); return; }
    }
    const weight = await health.getLatestWeight();
    if (weight) {
      setForm(f => ({ ...f, weight_lbs: weight.toFixed(1) }));
      Alert.alert('Imported!', `Latest weight from Health: ${weight.toFixed(1)} lbs`);
    } else {
      Alert.alert('No Data', 'No weight data found in Apple Health.');
    }
  };

  const weightData = logs.filter(l => l.weight_lbs).map(l => ({ date: l.date, value: l.weight_lbs }));
  const currentWeight = [...logs].reverse().find(l => l.weight_lbs)?.weight_lbs;
  const startWeight = logs.find(l => l.weight_lbs)?.weight_lbs;
  const weightChange = startWeight && currentWeight ? currentWeight - startWeight : null;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Progress</Text>
        <TouchableOpacity style={s.logBtn} onPress={() => setModalVisible(true)}>
          <Text style={s.logBtnText}>+ Log</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color="#fff" /></View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* Weight card */}
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardTitle}>WEIGHT</Text>
              {currentWeight && <Text style={s.cardValue}>{currentWeight} <Text style={s.cardUnit}>lbs</Text></Text>}
            </View>
            {weightChange !== null && (
              <Text style={[s.changeText, { color: weightChange <= 0 ? '#4ade80' : '#ff4f4f' }]}>
                {weightChange > 0 ? '+' : ''}{weightChange.toFixed(1)} lbs since start
              </Text>
            )}
            <LineChart data={weightData} color="#fff" unit="lbs" />
          </View>

          {/* Stats row */}
          {profile && (
            <View style={s.statsRow}>
              <View style={s.statCard}>
                <Text style={s.statVal}>{profile.weight_lbs || '—'}</Text>
                <Text style={s.statLabel}>Start</Text>
              </View>
              <View style={s.statCard}>
                <Text style={s.statVal}>{currentWeight || '—'}</Text>
                <Text style={s.statLabel}>Current</Text>
              </View>
              <View style={s.statCard}>
                <Text style={[s.statVal, { color: weightChange !== null && weightChange <= 0 ? '#4ade80' : '#ff4f4f' }]}>
                  {weightChange !== null ? `${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)}` : '—'}
                </Text>
                <Text style={s.statLabel}>Change</Text>
              </View>
              <View style={s.statCard}>
                <Text style={s.statVal}>{logs.length}</Text>
                <Text style={s.statLabel}>Entries</Text>
              </View>
            </View>
          )}

          {/* Macro trends */}
          {macroLogs.length >= 2 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>MACRO TRENDS (30 DAYS)</Text>
              <MacroChart logs={macroLogs} />
            </View>
          )}

          {/* Measurements */}
          <Text style={s.sectionTitle}>MEASUREMENTS</Text>
          {MEASUREMENTS.map(m => {
            const mData = logs.filter(l => l[m.key]).map(l => ({ date: l.date, value: l[m.key] }));
            const latestVal = mData[mData.length - 1]?.value;
            return (
              <View key={m.key} style={s.measCard}>
                <View style={s.measHeader}>
                  <Text style={s.measLabel}>{m.label}</Text>
                  {latestVal && <Text style={[s.measVal, { color: m.color }]}>{latestVal}"</Text>}
                </View>
                <LineChart data={mData} color={m.color} unit="in" />
              </View>
            );
          })}

          {/* History */}
          <Text style={s.sectionTitle}>HISTORY</Text>
          {logs.length === 0 && <Text style={s.emptyText}>No entries yet.{'\n'}Tap "+ Log" to get started!</Text>}
          {[...logs].reverse().map((log, i) => (
            <View key={i} style={s.historyCard}>
              <Text style={s.historyDate}>{fmtDate(log.date)}</Text>
              <View style={s.historyRow}>
                {log.weight_lbs && <View style={s.historyItem}><Text style={s.historyVal}>{log.weight_lbs}</Text><Text style={s.historyUnit}>lbs</Text></View>}
                {log.body_fat && <View style={s.historyItem}><Text style={s.historyVal}>{log.body_fat}</Text><Text style={s.historyUnit}>% bf</Text></View>}
                {MEASUREMENTS.map(m => log[m.key] ? (
                  <View key={m.key} style={s.historyItem}>
                    <Text style={[s.historyVal, { color: m.color }]}>{log[m.key]}"</Text>
                    <Text style={s.historyUnit}>{m.label.toLowerCase()}</Text>
                  </View>
                ) : null)}
              </View>
              {log.notes ? <Text style={s.historyNotes}>{log.notes}</Text> : null}
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalVisible(false)}>
        <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
          <View style={s.handle} />
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Log Progress</Text>
            <TouchableOpacity style={s.modalClose} onPress={() => setModalVisible(false)}>
              <Text style={s.modalCloseText}>×</Text>
            </TouchableOpacity>
          </View>
          <View style={s.modalTabs}>
            {(['weight', 'measurements'] as const).map(t => (
              <TouchableOpacity key={t} style={[s.modalTab, activeTab === t && s.modalTabActive]} onPress={() => setActiveTab(t)}>
                <Text style={[s.modalTabText, activeTab === t && s.modalTabTextActive]}>{t === 'weight' ? 'Weight & Body' : 'Measurements'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <ScrollView style={s.modalScroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {activeTab === 'weight' ? (
              <>
                {health.isAvailable && (
                  <TouchableOpacity style={s.healthBtn} onPress={importFromHealth}>
                    <Text style={s.healthBtnIcon}>❤️</Text>
                    <Text style={s.healthBtnText}>Import from Apple Health</Text>
                  </TouchableOpacity>
                )}
                <Text style={s.fieldLabel}>Weight (lbs)</Text>
                <TextInput style={s.input} value={form.weight_lbs} onChangeText={v => setForm(f => ({ ...f, weight_lbs: v }))}
                  placeholder={String(profile?.weight_lbs || '172')} placeholderTextColor="#444" keyboardType="decimal-pad" />
                <Text style={s.fieldLabel}>Body Fat %</Text>
                <TextInput style={s.input} value={form.body_fat} onChangeText={v => setForm(f => ({ ...f, body_fat: v }))}
                  placeholder="e.g. 15" placeholderTextColor="#444" keyboardType="decimal-pad" />
                <Text style={s.fieldLabel}>Notes</Text>
                <TextInput style={[s.input, { height: 80 }]} value={form.notes} onChangeText={v => setForm(f => ({ ...f, notes: v }))}
                  placeholder="How are you feeling?" placeholderTextColor="#444" multiline />
              </>
            ) : (
              MEASUREMENTS.map(m => (
                <View key={m.key}>
                  <Text style={[s.fieldLabel, { color: m.color }]}>{m.label} (inches)</Text>
                  <TextInput style={s.input} value={(form as any)[m.key]} onChangeText={v => setForm(f => ({ ...f, [m.key]: v }))}
                    placeholder="e.g. 14.5" placeholderTextColor="#444" keyboardType="decimal-pad" />
                </View>
              ))
            )}
            <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator color="#000" /> : <Text style={s.saveBtnText}>Save Entry</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  logBtn: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  logBtnText: { color: '#000', fontSize: 14, fontWeight: '800' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardTitle: { fontSize: 11, fontWeight: '700', color: '#444', letterSpacing: 1.5 },
  cardValue: { fontSize: 28, fontWeight: '900', color: '#fff' },
  cardUnit: { fontSize: 14, color: '#555', fontWeight: '600' },
  changeText: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, alignItems: 'center' },
  statVal: { fontSize: 16, fontWeight: '900', color: '#fff' },
  statLabel: { fontSize: 10, color: '#555', fontWeight: '600', marginTop: 4 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#444', letterSpacing: 1.5, marginBottom: 12, marginTop: 8 },
  measCard: { backgroundColor: '#1a1a1a', borderRadius: 14, padding: 14, marginBottom: 8 },
  measHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  measLabel: { fontSize: 14, fontWeight: '700', color: '#fff' },
  measVal: { fontSize: 18, fontWeight: '900' },
  historyCard: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 8 },
  historyDate: { fontSize: 12, color: '#555', fontWeight: '600', marginBottom: 8 },
  historyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  historyItem: { alignItems: 'center' },
  historyVal: { fontSize: 16, fontWeight: '800', color: '#fff' },
  historyUnit: { fontSize: 10, color: '#555', fontWeight: '600' },
  historyNotes: { fontSize: 12, color: '#444', marginTop: 8, fontStyle: 'italic' },
  emptyText: { textAlign: 'center', color: '#333', fontSize: 14, paddingVertical: 32, lineHeight: 24, fontWeight: '500' },
  modalSafe: { flex: 1, backgroundColor: '#1a1a1a' },
  handle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 16 },
  modalTitle: { fontSize: 22, fontWeight: '900', color: '#fff' },
  modalClose: { backgroundColor: '#252525', width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  modalCloseText: { color: '#888', fontSize: 20, lineHeight: 22 },
  modalTabs: { flexDirection: 'row', marginHorizontal: 20, backgroundColor: '#252525', borderRadius: 12, padding: 4, marginBottom: 20 },
  modalTab: { flex: 1, padding: 10, borderRadius: 10, alignItems: 'center' },
  modalTabActive: { backgroundColor: '#fff' },
  modalTabText: { fontSize: 13, fontWeight: '700', color: '#555' },
  modalTabTextActive: { color: '#000' },
  modalScroll: { flex: 1, paddingHorizontal: 20 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#252525', borderRadius: 12, color: '#fff', padding: 14, fontSize: 15, marginBottom: 16 },
  saveBtn: { backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },
  healthBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1f1520', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#3a1a2a' },
  healthBtnIcon: { fontSize: 18 },
  healthBtnText: { color: '#ff6b9d', fontSize: 14, fontWeight: '700' },
});
