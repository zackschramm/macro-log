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

const { width } = Dimensions.get('window');

const MEASUREMENTS = [
  { key: 'chest_in', label: 'Chest', unit: 'in' },
  { key: 'waist_in', label: 'Waist', unit: 'in' },
  { key: 'hips_in', label: 'Hips', unit: 'in' },
  { key: 'arms_in', label: 'Arms', unit: 'in' },
  { key: 'thighs_in', label: 'Thighs', unit: 'in' },
];

const todayStr = () => new Date().toISOString().split('T')[0];
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function SimpleChart({ data, color, unit }: { data: { date: string; value: number }[]; color: string; unit: string }) {
  if (data.length < 2) return <Text style={{ color: '#444', fontSize: 12, marginTop: 8 }}>Log more entries to see your trend</Text>;
  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const first = values[0];
  const last = values[values.length - 1];
  const diff = last - first;
  const isGood = (unit === 'lbs' && diff < 0) || (unit === 'in' && diff < 0) || diff === 0;

  return (
    <View style={ch.wrap}>
      <View style={ch.bars}>
        {data.slice(-8).map((d, i) => {
          const pct = ((d.value - min) / range) * 100;
          return (
            <View key={i} style={ch.barCol}>
              <View style={ch.barBg}>
                <View style={[ch.barFill, { height: `${Math.max(10, pct)}%` as any, backgroundColor: color }]} />
              </View>
              <Text style={ch.barLabel}>{d.date.slice(5)}</Text>
            </View>
          );
        })}
      </View>
      <View style={ch.trend}>
        <Text style={[ch.trendVal, { color: diff === 0 ? '#555' : isGood ? '#4ade80' : '#ff4f4f' }]}>
          {diff > 0 ? '+' : ''}{diff.toFixed(1)}{unit}
        </Text>
        <Text style={ch.trendLabel}>since first entry</Text>
      </View>
    </View>
  );
}

const ch = StyleSheet.create({
  wrap: { marginTop: 12 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 60, gap: 4 },
  barCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' },
  barBg: { width: '100%', backgroundColor: '#2a2a2a', borderRadius: 3, height: '100%', justifyContent: 'flex-end' },
  barFill: { width: '100%', borderRadius: 3, minHeight: 4 },
  barLabel: { fontSize: 8, color: '#444', fontWeight: '600' },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  trendVal: { fontSize: 16, fontWeight: '900' },
  trendLabel: { fontSize: 12, color: '#444', fontWeight: '500' },
});

export default function ProgressScreen({ profile }: { profile: any }) {
  const { user } = useAuth();
  const health = useHealthKit();
  const [logs, setLogs] = useState<any[]>([]);
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
    const { data } = await supabase.from('progress_logs')
      .select('*').eq('user_id', user.id).order('date');
    setLogs(data || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (health.isAvailable && !health.isAuthorized) {
      health.requestPermissions();
    }
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

    if (form.weight_lbs && health.isAuthorized) {
      await health.saveWeight(parseFloat(form.weight_lbs));
    }

    await fetchLogs();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setModalVisible(false);
    setSaving(false);
    setForm({ weight_lbs: '', body_fat: '', chest_in: '', waist_in: '', hips_in: '', arms_in: '', thighs_in: '', notes: '' });
  };

  const importFromHealth = async () => {
    if (!health.isAuthorized) {
      const granted = await health.requestPermissions();
      if (!granted) {
        Alert.alert('Health Access', 'Please allow access to Apple Health in Settings.');
        return;
      }
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
  const startWeight = logs.find(l => l.weight_lbs)?.weight_lbs;
  const currentWeight = [...logs].reverse().find(l => l.weight_lbs)?.weight_lbs;
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
            {weightData.length > 1
              ? <SimpleChart data={weightData} color="#fff" unit="lbs" />
              : <Text style={s.emptyChart}>Log your weight to see your trend 📈</Text>}
          </View>

          {profile && (
            <View style={s.statsRow}>
              <View style={s.statCard}>
                <Text style={s.statVal}>{profile.weight_lbs}</Text>
                <Text style={s.statLabel}>Start Weight</Text>
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
            </View>
          )}

          <Text style={s.sectionTitle}>MEASUREMENTS</Text>
          {MEASUREMENTS.map(m => {
            const mData = logs.filter(l => l[m.key]).map(l => ({ date: l.date, value: l[m.key] }));
            const latestVal = mData[mData.length - 1]?.value;
            return (
              <View key={m.key} style={s.measCard}>
                <View style={s.measHeader}>
                  <Text style={s.measLabel}>{m.label}</Text>
                  {latestVal && <Text style={s.measVal}>{latestVal}" </Text>}
                </View>
                {mData.length > 1
                  ? <SimpleChart data={mData} color="#4a9eff" unit="in" />
                  : <Text style={s.emptyChart}>No data yet</Text>}
              </View>
            );
          })}

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
                    <Text style={s.historyVal}>{log[m.key]}"</Text>
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
                <TextInput style={s.input} value={form.weight_lbs} onChangeText={v => setForm(f => ({ ...f, weight_lbs: v }))} placeholder={String(profile?.weight_lbs || '172')} placeholderTextColor="#444" keyboardType="decimal-pad" />
                <Text style={s.fieldLabel}>Body Fat %</Text>
                <TextInput style={s.input} value={form.body_fat} onChangeText={v => setForm(f => ({ ...f, body_fat: v }))} placeholder="e.g. 15" placeholderTextColor="#444" keyboardType="decimal-pad" />
                <Text style={s.fieldLabel}>Notes</Text>
                <TextInput style={[s.input, { height: 80 }]} value={form.notes} onChangeText={v => setForm(f => ({ ...f, notes: v }))} placeholder="How are you feeling?" placeholderTextColor="#444" multiline />
              </>
            ) : (
              <>
                {MEASUREMENTS.map(m => (
                  <View key={m.key}>
                    <Text style={s.fieldLabel}>{m.label} (inches)</Text>
                    <TextInput style={s.input} value={(form as any)[m.key]} onChangeText={v => setForm(f => ({ ...f, [m.key]: v }))} placeholder='e.g. 14.5' placeholderTextColor="#444" keyboardType="decimal-pad" />
                  </View>
                ))}
              </>
            )}
            <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={saving} activeOpacity={0.8}>
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 11, fontWeight: '700', color: '#444', letterSpacing: 1.5 },
  cardValue: { fontSize: 28, fontWeight: '900', color: '#fff' },
  cardUnit: { fontSize: 14, color: '#555', fontWeight: '600' },
  changeText: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  emptyChart: { color: '#333', fontSize: 13, fontWeight: '500', marginTop: 12, textAlign: 'center', paddingVertical: 16 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, alignItems: 'center' },
  statVal: { fontSize: 18, fontWeight: '900', color: '#fff' },
  statLabel: { fontSize: 10, color: '#555', fontWeight: '600', marginTop: 4 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#444', letterSpacing: 1.5, marginBottom: 12, marginTop: 8 },
  measCard: { backgroundColor: '#1a1a1a', borderRadius: 14, padding: 14, marginBottom: 8 },
  measHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  measLabel: { fontSize: 14, fontWeight: '700', color: '#fff' },
  measVal: { fontSize: 18, fontWeight: '900', color: '#4a9eff' },
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
