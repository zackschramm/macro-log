import React, { useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { useUnits } from '../constants/units';
import type { InBodyLog } from '../screens/InBodySection';

interface Props {
  visible: boolean;
  onClose: () => void;
  logs: InBodyLog[];
}

interface MetricDef {
  key: keyof InBodyLog;
  label: string;
  unit: string;
  lowerIsBetter?: boolean;
  isWeight?: boolean;
}

const COMPARE_METRICS: MetricDef[] = [
  { key: 'weight_lb',               label: 'Weight',            unit: 'lb',   lowerIsBetter: false, isWeight: true },
  { key: 'body_fat_pct',            label: 'Body Fat',          unit: '%',    lowerIsBetter: true  },
  { key: 'skeletal_muscle_mass_lb', label: 'Skeletal Muscle',   unit: 'lb',   lowerIsBetter: false, isWeight: true },
  { key: 'lean_body_mass_lb',       label: 'Lean Mass',         unit: 'lb',   lowerIsBetter: false, isWeight: true },
  { key: 'body_fat_mass_lb',        label: 'Fat Mass',          unit: 'lb',   lowerIsBetter: true,  isWeight: true },
  { key: 'bmi',                     label: 'BMI',               unit: '',     lowerIsBetter: true  },
  { key: 'visceral_fat_level',      label: 'Visceral Fat',      unit: '',     lowerIsBetter: true  },
  { key: 'bmr_kcal',                label: 'BMR',               unit: 'kcal', lowerIsBetter: false },
  { key: 'total_body_water_lb',     label: 'Total Body Water',  unit: 'lb',   lowerIsBetter: false, isWeight: true },
  { key: 'inbody_score',            label: 'InBody Score',      unit: '',     lowerIsBetter: false },
  { key: 'lean_mass_right_arm_lb',  label: 'Right Arm Lean',    unit: 'lb',   lowerIsBetter: false, isWeight: true },
  { key: 'lean_mass_left_arm_lb',   label: 'Left Arm Lean',     unit: 'lb',   lowerIsBetter: false, isWeight: true },
  { key: 'lean_mass_trunk_lb',      label: 'Trunk Lean',        unit: 'lb',   lowerIsBetter: false, isWeight: true },
  { key: 'lean_mass_right_leg_lb',  label: 'Right Leg Lean',    unit: 'lb',   lowerIsBetter: false, isWeight: true },
  { key: 'lean_mass_left_leg_lb',   label: 'Left Leg Lean',     unit: 'lb',   lowerIsBetter: false, isWeight: true },
];

function num(v: any): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
};

function DropdownPicker({
  logs,
  selectedId,
  onSelect,
  label,
  colors,
}: {
  logs: InBodyLog[];
  selectedId: number | undefined;
  onSelect: (id: number) => void;
  label: string;
  colors: ThemeColors;
}) {
  const [open, setOpen] = useState(false);
  const selected = logs.find(l => l.id === selectedId);
  const s = makeStyles(colors);

  return (
    <View style={{ flex: 1 }}>
      <Text style={s.dropLabel}>{label}</Text>
      <TouchableOpacity style={s.dropBtn} onPress={() => setOpen(true)}>
        <Text style={s.dropBtnText} numberOfLines={1}>
          {selected ? fmtDate(selected.measured_at) : 'Select…'}
        </Text>
        <Text style={s.dropChevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={s.dropOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={s.dropSheet}>
            <Text style={s.dropSheetTitle}>{label}</Text>
            <ScrollView>
              {logs.map(log => (
                <TouchableOpacity
                  key={log.id}
                  style={[s.dropItem, log.id === selectedId && s.dropItemActive]}
                  onPress={() => { onSelect(log.id!); setOpen(false); }}
                >
                  <Text style={[s.dropItemDate, log.id === selectedId && s.dropItemDateActive]}>
                    {fmtDate(log.measured_at)}
                  </Text>
                  {log.body_fat_pct != null && (
                    <Text style={s.dropItemSub}>{log.body_fat_pct}% bf</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

export default function InBodyCompareModal({ visible, onClose, logs }: Props) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const u = useUnits();

  const [scanAId, setScanAId] = useState<number | undefined>(logs[0]?.id);
  const [scanBId, setScanBId] = useState<number | undefined>(logs[logs.length - 1]?.id);

  const scanA = logs.find(l => l.id === scanAId) ?? logs[0];
  const scanB = logs.find(l => l.id === scanBId) ?? logs[logs.length - 1];

  const summary = useMemo(() => {
    if (!scanA || !scanB) return null;
    const bfA = num(scanA.body_fat_pct);
    const bfB = num(scanB.body_fat_pct);
    const mmA = num(scanA.skeletal_muscle_mass_lb);
    const mmB = num(scanB.skeletal_muscle_mass_lb);
    const bfDelta = bfA != null && bfB != null ? bfB - bfA : null;
    const mmDelta = mmA != null && mmB != null ? mmB - mmA : null;
    return { bfDelta, mmDelta };
  }, [scanA, scanB]);

  const dispVal = (m: MetricDef, log: InBodyLog): string => {
    const v = num(log[m.key] as any);
    if (v == null) return '—';
    if (m.isWeight) return `${u.dispWeight(v)}`;
    if (m.unit === 'kcal') return String(Math.round(v));
    return v % 1 === 0 ? String(v) : v.toFixed(1);
  };

  const dispUnit = (m: MetricDef): string => {
    if (m.isWeight) return u.weightUnit;
    return m.unit;
  };

  const deltaColor = (m: MetricDef, delta: number): string => {
    if (delta === 0) return colors.textTertiary;
    const improved = m.lowerIsBetter ? delta < 0 : delta > 0;
    return improved ? colors.accent : colors.danger;
  };

  const deltaArrow = (delta: number): string => {
    if (delta === 0) return '—';
    return delta > 0 ? '↑' : '↓';
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Compare Scans</Text>
          <TouchableOpacity style={s.closeBtn} onPress={onClose}>
            <Text style={s.closeBtnText}>×</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {/* Pickers */}
          <View style={s.pickers}>
            <DropdownPicker logs={logs} selectedId={scanAId} onSelect={setScanAId} label="Scan A" colors={colors} />
            <View style={s.pickerDivider} />
            <DropdownPicker logs={logs} selectedId={scanBId} onSelect={setScanBId} label="Scan B" colors={colors} />
          </View>

          {/* Table */}
          <View style={s.table}>
            {/* Column headers */}
            <View style={[s.tableRow, s.tableHeaderRow]}>
              <Text style={[s.tableCell, s.tableMetricCell, s.tableHeaderText]}>Metric</Text>
              <Text style={[s.tableCell, s.tableValCell, s.tableHeaderText]} numberOfLines={1}>
                {scanA ? fmtDate(scanA.measured_at) : 'A'}
              </Text>
              <Text style={[s.tableCell, s.tableValCell, s.tableHeaderText]} numberOfLines={1}>
                {scanB ? fmtDate(scanB.measured_at) : 'B'}
              </Text>
              <Text style={[s.tableCell, s.tableDeltaCell, s.tableHeaderText]}>Δ</Text>
            </View>

            {COMPARE_METRICS.map((m, idx) => {
              const vA = num(scanA?.[m.key] as any);
              const vB = num(scanB?.[m.key] as any);
              const rawDelta = vA != null && vB != null ? vB - vA : null;
              const dispDelta = rawDelta != null
                ? (m.isWeight ? u.dispWeight(Math.abs(rawDelta)) : Math.abs(rawDelta) % 1 === 0 ? Math.abs(rawDelta) : parseFloat(Math.abs(rawDelta).toFixed(1)))
                : null;
              const unitStr = dispUnit(m);
              const hasBoth = vA != null && vB != null;

              return (
                <View key={m.key as string} style={[s.tableRow, idx % 2 === 1 && s.tableRowAlt]}>
                  <Text style={[s.tableCell, s.tableMetricCell, s.tableCellText]}>{m.label}</Text>
                  <Text style={[s.tableCell, s.tableValCell, s.tableCellText]}>
                    {dispVal(m, scanA!)}{vA != null && unitStr ? ` ${unitStr}` : ''}
                  </Text>
                  <Text style={[s.tableCell, s.tableValCell, s.tableCellText]}>
                    {dispVal(m, scanB!)}{vB != null && unitStr ? ` ${unitStr}` : ''}
                  </Text>
                  <Text style={[s.tableCell, s.tableDeltaCell, s.tableCellText, hasBoth && rawDelta !== null ? { color: deltaColor(m, rawDelta) } : { color: colors.textTertiary }]}>
                    {rawDelta == null ? '—' : rawDelta === 0 ? '—' : `${deltaArrow(rawDelta)} ${dispDelta}${unitStr ? ` ${unitStr}` : ''}`}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Summary card */}
          {summary && (summary.bfDelta != null || summary.mmDelta != null) && (
            <View style={s.summaryCard}>
              <Text style={s.summaryTitle}>Summary</Text>
              <Text style={s.summaryText}>
                {summary.bfDelta != null
                  ? summary.bfDelta < 0
                    ? `You lost ${Math.abs(summary.bfDelta).toFixed(1)}% body fat`
                    : `Body fat increased ${summary.bfDelta.toFixed(1)}%`
                  : ''}
                {summary.bfDelta != null && summary.mmDelta != null ? ' and ' : ''}
                {summary.mmDelta != null
                  ? summary.mmDelta >= 0
                    ? `gained ${u.fmtWeight(summary.mmDelta)} of muscle`
                    : `lost ${u.fmtWeight(Math.abs(summary.mmDelta))} of muscle`
                  : ''}
                {' '}between these scans.
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border },
    headerTitle: { fontSize: 20, fontWeight: weight.heavy, color: c.text },
    closeBtn: { backgroundColor: c.cardAlt, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    closeBtnText: { color: c.textSecondary, fontSize: 20, lineHeight: 22 },
    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: 40 },

    pickers: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginBottom: spacing.lg },
    pickerDivider: { width: 1, height: 36, backgroundColor: c.border, marginBottom: 4 },

    dropLabel: { fontSize: 10, fontWeight: weight.bold, color: c.textTertiary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
    dropBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.card, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: c.border },
    dropBtnText: { flex: 1, color: c.text, fontSize: 13, fontWeight: weight.semibold },
    dropChevron: { color: c.textTertiary, fontSize: 12, marginLeft: 4 },
    dropOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    dropSheet: { backgroundColor: c.bgSecondary, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, maxHeight: 360 },
    dropSheetTitle: { fontSize: 16, fontWeight: weight.heavy, color: c.text, marginBottom: spacing.md },
    dropItem: { paddingVertical: 12, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
    dropItemActive: { backgroundColor: c.accentMuted },
    dropItemDate: { fontSize: 14, fontWeight: weight.semibold, color: c.text },
    dropItemDateActive: { color: c.accent },
    dropItemSub: { fontSize: 11, color: c.textTertiary, marginTop: 2 },

    table: { backgroundColor: c.card, borderRadius: radius.card, overflow: 'hidden', borderWidth: 1, borderColor: c.border, marginBottom: spacing.lg },
    tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border },
    tableHeaderRow: { backgroundColor: c.cardAlt },
    tableRowAlt: { backgroundColor: c.bgSecondary },
    tableCell: { paddingVertical: 10, paddingHorizontal: 8 },
    tableMetricCell: { flex: 2, borderRightWidth: 1, borderRightColor: c.border },
    tableValCell: { flex: 2, borderRightWidth: 1, borderRightColor: c.border },
    tableDeltaCell: { flex: 2 },
    tableHeaderText: { fontSize: 10, fontWeight: weight.bold, color: c.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
    tableCellText: { fontSize: 12, color: c.text, fontWeight: weight.medium },

    summaryCard: { backgroundColor: c.accent, borderRadius: radius.card, padding: spacing.xl },
    summaryTitle: { fontSize: 11, fontWeight: weight.bold, color: c.accentText, opacity: 0.7, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 },
    summaryText: { fontSize: 16, fontWeight: weight.heavy, color: c.accentText, lineHeight: 24 },
  });
}
