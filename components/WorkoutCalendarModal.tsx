import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { toLocalDateString } from '../utils/dateUtils';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type SessionRow = { date: string; name: string; source: string; source_id: string | null; day_index: number; is_complete: boolean };

const toDateStr = (y: number, m: number, d: number) => {
  const mm = String(m + 1).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
};

const todayStr = () => toLocalDateString();

interface Props {
  visible: boolean;
  userId: string | undefined;
  selectedDate: string;
  onClose: () => void;
  onSelectDate: (dateStr: string, session: SessionRow | undefined) => void;
}

export default function WorkoutCalendarModal({ visible, userId, selectedDate, onClose, onSelectDate }: Props) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [cursor, setCursor] = useState(() => {
    const d = new Date(selectedDate + 'T12:00:00');
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [sessions, setSessions] = useState<Record<string, SessionRow>>({});
  const [loading, setLoading] = useState(false);

  const loadMonth = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const start = toDateStr(cursor.year, cursor.month, 1);
    const lastDay = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const end = toDateStr(cursor.year, cursor.month, lastDay);
    const { data } = await supabase
      .from('workout_sessions')
      .select('date, name, source, source_id, day_index, is_complete')
      .eq('user_id', userId)
      .gte('date', start)
      .lte('date', end);
    const map: Record<string, SessionRow> = {};
    (data || []).forEach((row: any) => { map[row.date] = row; });
    setSessions(map);
    setLoading(false);
  }, [userId, cursor]);

  useEffect(() => { if (visible) loadMonth(); }, [visible, loadMonth]);

  useEffect(() => {
    if (!visible) return;
    const d = new Date(selectedDate + 'T12:00:00');
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  }, [visible, selectedDate]);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const firstWeekday = new Date(cursor.year, cursor.month, 1).getDay();
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const today = todayStr();

  const cells: Array<{ day: number; dateStr: string } | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, dateStr: toDateStr(cursor.year, cursor.month, d) });

  const goMonth = (delta: number) => {
    setCursor(prev => {
      let month = prev.month + delta;
      let year = prev.year;
      if (month < 0) { month = 11; year -= 1; }
      if (month > 11) { month = 0; year += 1; }
      return { year, month };
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.header}>
          <View style={{ width: 60 }} />
          <Text style={s.headerTitle}>Workout Calendar</Text>
          <TouchableOpacity style={s.doneBtn} onPress={onClose}>
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>

        <View style={s.monthRow}>
          <TouchableOpacity onPress={() => goMonth(-1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={s.monthArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={s.monthLabel}>{monthLabel}</Text>
          <TouchableOpacity onPress={() => goMonth(1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={s.monthArrow}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={s.weekdayRow}>
          {WEEKDAYS.map((w, i) => <Text key={i} style={s.weekdayText}>{w}</Text>)}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.text} style={{ marginTop: 40 }} />
        ) : (
          <View style={s.grid}>
            {cells.map((cell, i) => {
              if (!cell) return <View key={i} style={s.cell} />;
              const session = sessions[cell.dateStr];
              const isToday = cell.dateStr === today;
              const isSelected = cell.dateStr === selectedDate;
              const isFuture = cell.dateStr > today;
              return (
                <TouchableOpacity
                  key={i}
                  style={[s.cell, isSelected && s.cellSelected, isToday && !isSelected && s.cellToday]}
                  onPress={() => onSelectDate(cell.dateStr, session)}
                  disabled={isFuture && !session}
                  activeOpacity={0.7}
                >
                  <Text style={[s.cellText, isSelected && s.cellTextSelected, isFuture && !session && s.cellTextDisabled]}>{cell.day}</Text>
                  {session && (
                    <View style={[s.dot, session.is_complete ? s.dotComplete : s.dotIncomplete, isSelected && s.dotSelected]} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={s.legendRow}>
          <View style={s.legendItem}>
            <View style={[s.dot, s.dotComplete]} />
            <Text style={s.legendText}>Completed</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.dot, s.dotIncomplete]} />
            <Text style={s.legendText}>In progress</Text>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    headerTitle: { flex: 1, fontSize: 17, fontWeight: weight.heavy, color: c.text, textAlign: 'center' },
    doneBtn: { backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8, width: 60, alignItems: 'center' },
    doneBtnText: { color: c.accentText, fontSize: 14, fontWeight: weight.heavy },
    monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.sm },
    monthArrow: { fontSize: 26, color: c.text, fontWeight: weight.bold, paddingHorizontal: 12 },
    monthLabel: { fontSize: 17, fontWeight: weight.heavy, color: c.text },
    weekdayRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginBottom: 4 },
    weekdayText: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: weight.bold, color: c.textTertiary },
    grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.lg },
    cell: {
      width: `${100 / 7}%` as any, aspectRatio: 1, alignItems: 'center', justifyContent: 'center',
      borderRadius: radius.md, marginVertical: 2,
    },
    cellSelected: { backgroundColor: c.accent },
    cellToday: { borderWidth: 1.5, borderColor: c.accent },
    cellText: { fontSize: 15, fontWeight: weight.semibold, color: c.text },
    cellTextSelected: { color: c.accentText, fontWeight: weight.heavy },
    cellTextDisabled: { color: c.textTertiary, opacity: 0.4 },
    dot: { width: 6, height: 6, borderRadius: 3, marginTop: 3 },
    dotComplete: { backgroundColor: c.accent },
    dotIncomplete: { backgroundColor: c.warning },
    dotSelected: { backgroundColor: c.accentText },
    legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 24, paddingVertical: spacing.lg },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendText: { fontSize: 12, color: c.textTertiary, fontWeight: weight.medium },
  });
}
