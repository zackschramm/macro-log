import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Modal, Alert, ActivityIndicator, Dimensions, Image,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { hasPro } from '../constants/purchases';
import { useUnits } from '../constants/units';
import PaywallScreen from './PaywallScreen';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import ShareCardGenerator from '../components/ShareCardGenerator';
import { maybeRequestReview } from '../utils/storeReview';
import InBodyCompareModal from '../components/InBodyCompareModal';
import { requireAIAccess } from '../utils/proGate';

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQ4NjIsImV4cCI6MjA4NzQwMDg2Mn0.lUng1tY_aAuee_t8-E5MSUHdm2PF3HzsE41L-kzBmJE';

const { width } = Dimensions.get('window');
const CHART_W = width - 64;
const CHART_H = 120;

export type InBodyLog = {
  id?: number;
  user_id?: string;
  measured_at: string;
  source?: 'scan' | 'manual' | 'api';
  weight_lb?: number | null;
  body_fat_pct?: number | null;
  skeletal_muscle_mass_lb?: number | null;
  body_fat_mass_lb?: number | null;
  lean_body_mass_lb?: number | null;
  total_body_water_lb?: number | null;
  protein_lb?: number | null;
  minerals_lb?: number | null;
  bmi?: number | null;
  inbody_score?: number | null;
  visceral_fat_level?: number | null;
  bmr_kcal?: number | null;
  waist_hip_ratio?: number | null;
  lean_mass_right_arm_lb?: number | null;
  lean_mass_left_arm_lb?: number | null;
  lean_mass_trunk_lb?: number | null;
  lean_mass_right_leg_lb?: number | null;
  lean_mass_left_leg_lb?: number | null;
  fat_mass_right_arm_lb?: number | null;
  fat_mass_left_arm_lb?: number | null;
  fat_mass_trunk_lb?: number | null;
  fat_mass_right_leg_lb?: number | null;
  fat_mass_left_leg_lb?: number | null;
  raw_json?: Record<string, unknown> | null;
  image_url?: string | null;
  notes?: string | null;
};

const CORE_METRICS: { key: keyof InBodyLog; label: string; unit: string; color: string; pro?: boolean }[] = [
  { key: 'weight_lb',               label: 'Weight',          unit: 'lb',   color: '#4a9eff' },
  { key: 'body_fat_pct',            label: 'Body Fat',        unit: '%',    color: '#f472b6' },
  { key: 'skeletal_muscle_mass_lb', label: 'Skeletal Muscle', unit: 'lb',   color: '#4ade80' },
  { key: 'body_fat_mass_lb',        label: 'Fat Mass',        unit: 'lb',   color: '#fbbf24' },
  { key: 'lean_body_mass_lb',       label: 'Lean Mass',       unit: 'lb',   color: '#a78bfa' },
  { key: 'inbody_score',            label: 'InBody Score',    unit: '',     color: '#C8FF3D' },
  { key: 'visceral_fat_level',      label: 'Visceral Fat',    unit: '',     color: '#f472b6', pro: true },
  { key: 'bmr_kcal',                label: 'BMR',             unit: 'kcal', color: '#f472b6', pro: true },
];

const EXTRACTION_PROMPT =
  `Read this InBody body-composition result sheet (InBody 270/370/570/770/H20N etc.).
Extract every numeric value including segmental lean and segmental body fat (RA/LA/TR/RL/LL).
ALL output weights must be in POUNDS (lb). If the sheet shows kilograms, convert: lb = kg * 2.20462. Round to 2 decimals.
BMR is in kcal/day; round to integer.
"Visceral Fat Level" is a unitless number.
"InBody Score" is the integer in the score box.

Return ONLY a JSON object with these keys (omit any that are missing):
{
  "measured_at": "ISO-8601 timestamp from the sheet (use 12:00 local if only date is printed)",
  "weight_lb": number, "body_fat_pct": number, "skeletal_muscle_mass_lb": number,
  "body_fat_mass_lb": number, "lean_body_mass_lb": number, "total_body_water_lb": number,
  "protein_lb": number, "minerals_lb": number, "bmi": number, "inbody_score": integer,
  "visceral_fat_level": number, "bmr_kcal": integer, "waist_hip_ratio": number,
  "lean_mass_right_arm_lb": number, "lean_mass_left_arm_lb": number, "lean_mass_trunk_lb": number,
  "lean_mass_right_leg_lb": number, "lean_mass_left_leg_lb": number,
  "fat_mass_right_arm_lb": number, "fat_mass_left_arm_lb": number, "fat_mass_trunk_lb": number,
  "fat_mass_right_leg_lb": number, "fat_mass_left_leg_lb": number,
  "raw": { "any_other_field": value }
}
If nothing is readable return {"error":"unreadable"}.`;

function deltaColor(metricKey: string, delta: number, c: ThemeColors) {
  const lowerIsBetter = ['weight_lb', 'body_fat_pct', 'body_fat_mass_lb', 'visceral_fat_level'].includes(metricKey);
  if (delta === 0) return { color: c.textTertiary };
  if (lowerIsBetter) return { color: delta < 0 ? c.accent : c.danger };
  return { color: delta > 0 ? c.accent : c.danger };
}

export default function InBodySection() {
  const { user } = useAuth();
  const u = useUnits();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const cv = (val: number | null, unit: string) => (unit === 'lb' && val != null ? u.dispWeight(val) : val);
  const ul = (unit: string) => (unit === 'lb' ? u.weightUnit : unit);
  const [logs, setLogs] = useState<InBodyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState<InBodyLog | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showInbodyCard, setShowInbodyCard] = useState(false);
  const inbodyShareRef = useRef<View>(null);

  useEffect(() => { (async () => setIsPro(await hasPro()))(); }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('inbody_logs')
      .select('*')
      .eq('user_id', user.id)
      .order('measured_at', { ascending: true });
    if (error) console.log('inbody load error:', error.message);
    setLogs((data ?? []) as InBodyLog[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const onScan = async () => {
    // The scan is a VISION call — the display gate below only hid the results,
    // so free users could burn unlimited vision calls reading InBody sheets.
    const gate = await requireAIAccess('inbody_scan');
    if (!gate.allowed) { setShowPaywall(true); return; }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        base64: true, quality: 0.5, allowsEditing: false,
        mediaTypes: ['images'],
      });
      if (result.canceled || !result.assets[0]?.base64) return;

      setScanning(true);

      const jpeg = await ImageManipulator.manipulateAsync(
        result.assets[0].uri, [], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      const base64 = jpeg.base64!;
      const mime = 'image/jpeg';

      const res = await fetch('https://zbcxuffgmjuqarapfdwb.supabase.co/functions/v1/ai-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({
          system: 'You are an extraction tool for InBody body-composition result sheets. Return only valid JSON, no prose, no markdown.',
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
            { type: 'text', text: EXTRACTION_PROMPT },
          ]}],
          max_tokens: 2000,
        }),
      });
      const data = await res.json();
      const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(text);
      if (parsed.error) { Alert.alert('Could not read result sheet', 'Please try a clearer photo.'); return; }

      const draft: InBodyLog = {
        measured_at: parsed.measured_at || new Date().toISOString(),
        source: 'scan',
        weight_lb: parsed.weight_lb ?? null,
        body_fat_pct: parsed.body_fat_pct ?? null,
        skeletal_muscle_mass_lb: parsed.skeletal_muscle_mass_lb ?? null,
        body_fat_mass_lb: parsed.body_fat_mass_lb ?? null,
        lean_body_mass_lb: parsed.lean_body_mass_lb ?? null,
        total_body_water_lb: parsed.total_body_water_lb ?? null,
        protein_lb: parsed.protein_lb ?? null,
        minerals_lb: parsed.minerals_lb ?? null,
        bmi: parsed.bmi ?? null,
        inbody_score: parsed.inbody_score ?? null,
        visceral_fat_level: parsed.visceral_fat_level ?? null,
        bmr_kcal: parsed.bmr_kcal ?? null,
        waist_hip_ratio: parsed.waist_hip_ratio ?? null,
        lean_mass_right_arm_lb: parsed.lean_mass_right_arm_lb ?? null,
        lean_mass_left_arm_lb:  parsed.lean_mass_left_arm_lb  ?? null,
        lean_mass_trunk_lb:     parsed.lean_mass_trunk_lb     ?? null,
        lean_mass_right_leg_lb: parsed.lean_mass_right_leg_lb ?? null,
        lean_mass_left_leg_lb:  parsed.lean_mass_left_leg_lb  ?? null,
        fat_mass_right_arm_lb:  parsed.fat_mass_right_arm_lb  ?? null,
        fat_mass_left_arm_lb:   parsed.fat_mass_left_arm_lb   ?? null,
        fat_mass_trunk_lb:      parsed.fat_mass_trunk_lb      ?? null,
        fat_mass_right_leg_lb:  parsed.fat_mass_right_leg_lb  ?? null,
        fat_mass_left_leg_lb:   parsed.fat_mass_left_leg_lb   ?? null,
        raw_json: parsed.raw && Object.keys(parsed.raw).length ? parsed.raw : null,
        image_url: `data:${mime};base64,${base64}`,
      };
      setEditing(draft);
    } catch (e: any) {
      console.log('inbody scan error:', e);
      Alert.alert('Scan failed', 'Could not extract InBody data. Try a clearer photo.');
    } finally {
      setScanning(false);
    }
  };

  const onManual = () => setEditing({ measured_at: new Date().toISOString(), source: 'manual' });

  const onSave = async (log: InBodyLog) => {
    if (!user) return;
    const { error } = await supabase
      .from('inbody_logs')
      .upsert({ ...log, user_id: user.id }, { onConflict: 'user_id,measured_at' });
    if (error) { Alert.alert('Save failed', error.message); return; }
    const firstDone = await AsyncStorage.getItem('fuelog_first_inbody_done');
    if (!firstDone) {
      await AsyncStorage.setItem('fuelog_first_inbody_done', '1');
      await maybeRequestReview();
    }
    setEditing(null);
    await load();
  };

  const onDelete = (id?: number) => {
    if (!id) return;
    Alert.alert('Delete entry?', 'This removes the InBody record.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          const { error } = await supabase.from('inbody_logs').delete().eq('id', id);
          if (error) Alert.alert('Delete failed', error.message);
          else await load();
        } },
    ]);
  };

  const latest = logs.length ? logs[logs.length - 1] : null;
  const prev   = logs.length > 1 ? logs[logs.length - 2] : null;
  const oldest = logs.length ? logs[0] : null;

  const handleShareProgress = async () => {
    if (logs.length < 2 || !oldest || !latest) return;
    setShowInbodyCard(true);
    await new Promise(r => setTimeout(r, 80));
    try {
      const uri = await captureRef(inbodyShareRef, { format: 'jpg', quality: 0.92 });
      setShowInbodyCard(false);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'Share Body Composition' });
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setShowInbodyCard(false);
    }
  };

  const inbodyCardData = oldest && latest ? (() => {
    const fatChangeLb = ((latest.body_fat_mass_lb ?? 0) - (oldest.body_fat_mass_lb ?? 0));
    const muscleChangeLb = ((latest.skeletal_muscle_mass_lb ?? 0) - (oldest.skeletal_muscle_mass_lb ?? 0));
    const msOldest = new Date(oldest.measured_at).getTime();
    const msLatest = new Date(latest.measured_at).getTime();
    const weeksTracked = Math.max(1, Math.round((msLatest - msOldest) / (7 * 24 * 60 * 60 * 1000)));
    return { fatChangeLb, muscleChangeLb, weeksTracked };
  })() : null;

  return (
    <View>
      <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
        <PaywallScreen
          onClose={() => setShowPaywall(false)}
          onUnlock={() => { setShowPaywall(false); setIsPro(true); }}
        />
      </Modal>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={s.sectionTitle}>BODY COMPOSITION · INBODY</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {logs.length >= 2 && (
            <TouchableOpacity onPress={handleShareProgress}>
              <Text style={s.compareLink}>Share</Text>
            </TouchableOpacity>
          )}
          {logs.length >= 2 && (
            <TouchableOpacity onPress={() => setShowCompare(true)}>
              <Text style={s.compareLink}>Compare Scans</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Off-screen share card */}
      {showInbodyCard && inbodyCardData && (
        <View style={{ position: 'absolute', left: -9999, top: 0 }} pointerEvents="none">
          <View ref={inbodyShareRef} collapsable={false}>
            <ShareCardGenerator type="inbody" data={inbodyCardData} />
          </View>
        </View>
      )}

      <InBodyCompareModal visible={showCompare} onClose={() => setShowCompare(false)} logs={logs} />

      <View style={s.actionRow}>
        <TouchableOpacity style={s.scanBtn} onPress={onScan} disabled={scanning}>
          {scanning ? <ActivityIndicator color={colors.accentText} /> : (<><Ionicons name="scan-outline" size={16} color={colors.accentText} /><Text style={s.scanBtnText}>Scan InBody</Text></>)}
        </TouchableOpacity>
        <TouchableOpacity style={s.manualBtn} onPress={onManual}>
          <Text style={s.manualBtnText}>Enter</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
      ) : logs.length === 0 ? (
        <Text style={s.empty}>No InBody scans yet.{'\n'}Tap "Scan InBody" to upload a result sheet.</Text>
      ) : (
        <>
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardLabel}>Latest scan</Text>
              <Text style={s.cardDate}>{fmtDate(latest!.measured_at)}</Text>
            </View>
            <View style={s.grid}>
              {CORE_METRICS.map(m => {
                if (m.pro && !isPro) return <ProCell key={m.key as string} label={m.label} onUnlock={() => setShowPaywall(true)} />;
                const v  = num(latest![m.key] as any);
                const pv = prev ? num(prev[m.key] as any) : null;
                const delta = v != null && pv != null ? v - pv : null;
                return (
                  <View key={m.key as string} style={s.cell}>
                    <Text style={s.cellLabel}>{m.label}</Text>
                    <Text style={[s.cellValue, { color: v == null ? colors.textTertiary : m.color }]}>
                      {v == null ? '—' : `${v}`}
                      {m.unit ? <Text style={s.cellUnit}>{m.unit}</Text> : null}
                    </Text>
                    {delta != null && Math.abs(delta) > 0.05 && (
                      <Text style={[s.cellDelta, deltaColor(m.key as string, delta, colors)]}>
                        {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}{m.unit}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>

          <MetricChart logs={logs} metricKey="weight_lb"               label="Weight"          color="#4a9eff" unit="lb" />
          <MetricChart logs={logs} metricKey="body_fat_pct"            label="Body Fat"        color="#f472b6" unit="%"  />
          <MetricChart logs={logs} metricKey="skeletal_muscle_mass_lb" label="Skeletal Muscle" color="#4ade80" unit="lb" />
          <MetricChart logs={logs} metricKey="inbody_score"  label="InBody Score"    color="#C8FF3D" unit=""   />

          {isPro && latest && <SegmentalView log={latest} />}
          {!isPro && (
            <TouchableOpacity style={s.proTeaseCard} onPress={() => setShowPaywall(true)} activeOpacity={0.8}>
              <Text style={s.proTeaseText}>Unlock segmental lean-mass analysis with Fuelog Pro</Text>
              <Text style={s.proTeaseUnlock}>Unlock with Pro →</Text>
            </TouchableOpacity>
          )}

          <Text style={s.sectionTitle}>INBODY HISTORY</Text>
          {[...logs].reverse().map(log => (
            <TouchableOpacity key={log.id} style={s.histCard} onPress={() => setEditing(log)} onLongPress={() => onDelete(log.id)}>
              <Text style={s.histDate}>{fmtDate(log.measured_at)}</Text>
              <View style={s.histRow}>
                {log.weight_lb != null && <View style={s.histItem}><Text style={[s.histVal, { color: '#4a9eff' }]}>{log.weight_lb}</Text><Text style={s.histUnit}>lb</Text></View>}
                {log.body_fat_pct != null && <View style={s.histItem}><Text style={[s.histVal, { color: '#f472b6' }]}>{log.body_fat_pct}</Text><Text style={s.histUnit}>% bf</Text></View>}
                {log.skeletal_muscle_mass_lb != null && <View style={s.histItem}><Text style={[s.histVal, { color: '#4ade80' }]}>{log.skeletal_muscle_mass_lb}</Text><Text style={s.histUnit}>lb smm</Text></View>}
                {log.inbody_score != null && <View style={s.histItem}><Text style={s.histVal}>{log.inbody_score}</Text><Text style={s.histUnit}>score</Text></View>}
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}

      <EntryEditor visible={!!editing} initial={editing} onCancel={() => setEditing(null)} onSave={onSave} />
    </View>
  );
}

function MetricChart({
  logs, metricKey, label, color, unit
}: { logs: InBodyLog[]; metricKey: keyof InBodyLog; label: string; color: string; unit: string }) {
  const { colors: tc } = useTheme();
  const s = makeStyles(tc);

  const pts = useMemo(() => logs
    .map(l => ({ t: +new Date(l.measured_at), v: num(l[metricKey] as any) }))
    .filter(p => p.v != null), [logs, metricKey]) as { t: number; v: number }[];

  if (pts.length < 2) {
    return (
      <View style={s.card}>
        <Text style={s.cardLabel}>{label}</Text>
        <Text style={s.muted}>Need at least 2 scans to chart.</Text>
      </View>
    );
  }

  const slice = pts.slice(-10);
  const values = slice.map(p => p.v);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const padH = 24, padV = 16;
  const cw = CHART_W - padH * 2, ch = CHART_H - padV * 2;
  const toX = (i: number) => padH + (i / (slice.length - 1)) * cw;
  const toY = (v: number) => padV + ch - ((v - min) / range) * ch;
  const polyPts = slice.map((p, i) => `${toX(i)},${toY(p.v)}`).join(' ');
  const last = values[values.length - 1];
  const first = values[0];
  const diff = last - first;
  const lowerIsBetter = metricKey === 'weight_lb' || metricKey === 'body_fat_pct' || metricKey === 'body_fat_mass_lb' || metricKey === 'visceral_fat_level';
  const trendColor = diff === 0 ? tc.textTertiary : lowerIsBetter ? (diff < 0 ? tc.accent : tc.danger) : (diff > 0 ? tc.accent : tc.danger);

  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <Text style={s.cardLabel}>{label}</Text>
        <Text style={[s.diffText, { color: trendColor }]}>{diff > 0 ? '+' : ''}{diff.toFixed(1)}{unit}</Text>
      </View>
      <Svg width={CHART_W} height={CHART_H}>
        {[0, 0.5, 1].map((t, i) => (
          <Line key={i} x1={padH} y1={padV + ch * (1 - t)} x2={padH + cw} y2={padV + ch * (1 - t)} stroke={tc.border} strokeWidth="1" />
        ))}
        <Polyline points={polyPts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {slice.map((p, i) => (<Circle key={i} cx={toX(i)} cy={toY(p.v)} r="3.5" fill={color} />))}
        <SvgText x={toX(0)} y={toY(values[0]) - 6} textAnchor="middle" fill={tc.textTertiary} fontSize="9">{values[0].toFixed(1)}</SvgText>
        <SvgText x={toX(slice.length - 1)} y={toY(last) - 6} textAnchor="middle" fill={color} fontSize="10" fontWeight="700">{last.toFixed(1)}</SvgText>
      </Svg>
    </View>
  );
}

function SegmentalView({ log }: { log: InBodyLog }) {
  const { colors: tc } = useTheme();
  const s = makeStyles(tc);
  const rows = [
    { label: 'Right arm', v: log.lean_mass_right_arm_lb },
    { label: 'Left arm',  v: log.lean_mass_left_arm_lb  },
    { label: 'Trunk',     v: log.lean_mass_trunk_lb     },
    { label: 'Right leg', v: log.lean_mass_right_leg_lb },
    { label: 'Left leg',  v: log.lean_mass_left_leg_lb  },
  ];
  const mx = Math.max(...rows.map(r => num(r.v) ?? 0), 1);
  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>Segmental Lean Mass</Text>
      {rows.map(r => (
        <View key={r.label} style={s.segRow}>
          <Text style={s.segLabel}>{r.label}</Text>
          <View style={s.segBarTrack}>
            <View style={[s.segBarFill, { width: `${((num(r.v) ?? 0) / mx) * 100}%` as any }]} />
          </View>
          <Text style={s.segVal}>{num(r.v) ?? '—'} lb</Text>
        </View>
      ))}
    </View>
  );
}

function ProCell({ label, onUnlock }: { label: string; onUnlock: () => void }) {
  const { colors: tc } = useTheme();
  const s = makeStyles(tc);
  return (
    <View style={s.cell}>
      <Text style={s.cellLabel}>{label}</Text>
      <Text style={s.proLockMini}>Pro</Text>
      <TouchableOpacity onPress={onUnlock} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Text style={s.proTeaseUnlock}>Unlock →</Text>
      </TouchableOpacity>
    </View>
  );
}

function EntryEditor({
  visible, initial, onCancel, onSave
}: { visible: boolean; initial: InBodyLog | null; onCancel: () => void; onSave: (l: InBodyLog) => void }) {
  const { colors: tc } = useTheme();
  const s = makeStyles(tc);
  const [form, setForm] = useState<InBodyLog | null>(initial);
  useEffect(() => setForm(initial), [initial]);

  if (!form) return null;

  const field = (key: keyof InBodyLog, label: string, unit = '') => (
    <View key={String(key)}>
      <Text style={s.fieldLabel}>{label}{unit ? ` (${unit})` : ''}</Text>
      <TextInput
        style={s.input}
        keyboardType="decimal-pad"
        placeholderTextColor={tc.textTertiary}
        value={form[key] == null ? '' : String(form[key])}
        onChangeText={t =>setForm({ ...form, [key]: t === '' ? null : Number(t) } as InBodyLog)}
      />
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
        <View style={s.modalHeader}>
          <Text style={s.modalTitle}>InBody entry</Text>
          <TouchableOpacity onPress={onCancel} style={s.modalClose}><Text style={s.modalCloseText}>×</Text></TouchableOpacity>
        </View>
        <ScrollView style={s.modalScroll} contentContainerStyle={{ paddingBottom: 32 }}>
          <Text style={s.cardDate}>{fmtDate(form.measured_at)}</Text>
          {form.image_url ? (
            <Image source={{ uri: form.image_url }} style={{ width: '100%', height: 220, borderRadius: 12, marginVertical: 12, backgroundColor: tc.bgSecondary }} resizeMode="contain" />
          ) : null}

          {field('weight_lb', 'Weight', 'lb')}
          {field('body_fat_pct', 'Body Fat', '%')}
          {field('skeletal_muscle_mass_lb', 'Skeletal Muscle Mass', 'lb')}
          {field('body_fat_mass_lb', 'Body Fat Mass', 'lb')}
          {field('lean_body_mass_lb', 'Lean Body Mass', 'lb')}
          {field('total_body_water_lb', 'Total Body Water', 'lb')}
          {field('protein_lb', 'Protein', 'lb')}
          {field('minerals_lb', 'Minerals', 'lb')}
          {field('bmi', 'BMI')}
          {field('inbody_score', 'InBody Score')}
          {field('visceral_fat_level', 'Visceral Fat Level')}
          {field('bmr_kcal', 'BMR', 'kcal')}

          <Text style={[s.fieldLabel, { marginTop: 12 }]}>SEGMENTAL LEAN (LB)</Text>
          {field('lean_mass_right_arm_lb', 'Right arm')}
          {field('lean_mass_left_arm_lb',  'Left arm')}
          {field('lean_mass_trunk_lb',     'Trunk')}
          {field('lean_mass_right_leg_lb', 'Right leg')}
          {field('lean_mass_left_leg_lb',  'Left leg')}

          <TouchableOpacity style={s.saveBtn} onPress={() => onSave(form)}>
            <Text style={s.saveBtnText}>Save entry</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function num(v: any): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    sectionTitle: { fontSize: 11, fontWeight: weight.semibold, color: c.textTertiary, letterSpacing: 1.5, marginTop: 16, textTransform: 'uppercase' },
    compareLink: { fontSize: 12, fontWeight: weight.bold, color: c.accent, marginTop: 16 },
    actionRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    scanBtn: { flex: 1, backgroundColor: c.accent, borderRadius: radius.md, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    scanBtnText: { color: c.accentText, fontSize: 14, fontWeight: weight.heavy },
    manualBtn: { backgroundColor: c.card, borderRadius: radius.md, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
    manualBtnText: { color: c.text, fontSize: 13, fontWeight: weight.bold },
    card: { backgroundColor: c.card, borderRadius: radius.card, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: c.border },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    cardLabel: { fontSize: 13, fontWeight: weight.heavy, color: c.text },
    cardDate: { fontSize: 12, color: c.textTertiary, fontWeight: weight.semibold },
    diffText: { fontSize: 14, fontWeight: weight.heavy },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: { width: '33%', paddingVertical: 6 },
    cellLabel: { color: c.textTertiary, fontSize: 11, fontWeight: weight.semibold },
    cellValue: { fontSize: 20, fontWeight: weight.heavy, marginTop: 2 },
    cellUnit: { fontSize: 11, color: c.textTertiary, fontWeight: weight.semibold },
    cellDelta: { fontSize: 10, marginTop: 2, fontWeight: weight.bold },
    empty: { textAlign: 'center', color: c.textTertiary, fontSize: 14, paddingVertical: 24, lineHeight: 22, fontWeight: weight.medium },
    muted: { color: c.textTertiary, fontSize: 12 },
    segRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 4 },
    segLabel: { width: 80, color: c.textSecondary, fontSize: 12, fontWeight: weight.semibold },
    segBarTrack: { flex: 1, height: 8, backgroundColor: c.bgSecondary, borderRadius: 4, marginHorizontal: 8, overflow: 'hidden' },
    segBarFill: { height: 8, backgroundColor: c.accent, borderRadius: 4 },
    segVal: { width: 64, textAlign: 'right', color: c.text, fontSize: 12, fontWeight: weight.bold },
    proLockMini: { color: c.textTertiary, fontStyle: 'italic', fontSize: 12, marginTop: 2 },
    proTeaseCard: { backgroundColor: c.card, borderRadius: radius.md, padding: 14, alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: c.border, gap: 6 },
    proTeaseText: { color: c.textSecondary, fontSize: 13, fontWeight: weight.semibold },
    proTeaseUnlock: { color: c.accent, fontSize: 12, fontWeight: weight.bold },
    histCard: { backgroundColor: c.card, borderRadius: radius.md, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: c.border },
    histDate: { fontSize: 12, color: c.textTertiary, fontWeight: weight.semibold, marginBottom: 8 },
    histRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    histItem: { alignItems: 'center' },
    histVal: { fontSize: 16, fontWeight: weight.heavy, color: c.text },
    histUnit: { fontSize: 10, color: c.textTertiary, fontWeight: weight.semibold },
    modalSafe: { flex: 1, backgroundColor: c.bg },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.sm, marginBottom: spacing.lg },
    modalTitle: { fontSize: 22, fontWeight: weight.heavy, color: c.text },
    modalClose: { backgroundColor: c.cardAlt, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    modalCloseText: { color: c.textSecondary, fontSize: 20, lineHeight: 22 },
    modalScroll: { flex: 1, paddingHorizontal: spacing.xl },
    fieldLabel: { fontSize: 11, fontWeight: weight.semibold, color: c.textTertiary, marginBottom: 8, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    input: { backgroundColor: c.cardAlt, borderRadius: radius.md, color: c.text, padding: 14, fontSize: 15, marginBottom: 8, borderWidth: 1, borderColor: c.border },
    saveBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 16, alignItems: 'center', marginTop: 16 },
    saveBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.heavy },
  });
}
