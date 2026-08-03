import React, { useState, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, Alert,
  TextInput, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { callAI } from '../constants/ai';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import SkeletonBox from '../components/SkeletonBox';
import FoodAnalysisResults, { AnalysisResult, AnalyzedItem } from '../components/FoodAnalysisResults';
import { useAIGate } from '../hooks/useAIGate';
import { logError } from '../utils/logError';

type Phase = 'input' | 'analyzing' | 'results' | 'editing';

type Props = {
  visible: boolean;
  date: string;
  defaultMeal?: string;
  /** Pre-fills the text field, e.g. from the "Log <food> in Fuelog" Siri intent. */
  initialText?: string;
  onClose: () => void;
  onLogged: () => void;
};

export default function VoiceLogScreen({ visible, date, defaultMeal, initialText, onClose, onLogged }: Props) {
  const { requestAccess, paywall } = useAIGate();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { user } = useAuth();

  const [phase, setPhase] = useState<Phase>('input');
  const [text, setText] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [editItems, setEditItems] = useState<AnalyzedItem[]>([]);
  const [selectedMeal, setSelectedMeal] = useState(defaultMeal || 'Breakfast');
  const [logging, setLogging] = useState(false);

  useEffect(() => {
    if (visible) {
      setPhase('input');
      setText(initialText || '');
      setResult(null);
      setEditItems([]);
      setSelectedMeal(defaultMeal || 'Breakfast');
      setLogging(false);
    }
  }, [visible, initialText]);

  const PARSE_PROMPT = (desc: string) =>
    `Parse this food description and estimate macros for each item. Return ONLY valid JSON, no markdown fences:\n{"items":[{"name":string,"calories":number,"protein":number,"carbs":number,"fat":number,"portion":string}],"totals":{"calories":number,"protein":number,"carbs":number,"fat":number},"confidence":"high"|"medium"|"low","notes":string}\n\nDescription: "${desc}"`;

  // Parses + sanity-checks a model response. Throws if the shape is wrong so
  // the caller can retry on the cloud tier (hybrid plan: local output must be
  // validated before it reaches the log).
  const parseResponse = (rawText: string): AnalysisResult => {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed: AnalysisResult = JSON.parse(cleaned);
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) throw new Error('no items');
    for (const it of parsed.items) {
      if (typeof it.name !== 'string' || !isFinite(it.calories) || !isFinite(it.protein) ||
          !isFinite(it.carbs) || !isFinite(it.fat)) throw new Error('bad item shape');
    }
    return parsed;
  };

  const handleSubmit = async () => {
  // Pro gate: consumes one free trial use, then paywalls.
  if (!(await requestAccess('voice_log'))) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setPhase('analyzing');
    const prompt = PARSE_PROMPT(trimmed);
    try {
      let parsed: AnalysisResult;
      try {
        // Local-first (on-device model, iOS 26+); callAI silently falls back
        // to the ai-proxy if the device can't run it.
        parsed = parseResponse(await callAI([{ role: 'user', content: prompt }], undefined, 1024, 'local'));
      } catch {
        // Local tier returned malformed JSON — retry once explicitly on cloud.
        parsed = parseResponse(await callAI([{ role: 'user', content: prompt }], undefined, 8192, 'cloud'));
      }
      setResult(parsed);
      setEditItems(parsed.items.map(it => ({ ...it })));
      setPhase('results');
    } catch (e) {
      // Bare `catch {}` here meant a dead ai-proxy and a genuinely ambiguous
      // meal description produced the identical, misleading "could not parse".
      logError('VoiceLog.parse', e);
      Alert.alert('Could not parse', 'Try describing the meal differently, or enter macros manually.');
      setPhase('input');
    }
  };

  const handleLog = async (items?: AnalyzedItem[]) => {
    if (!result || !user) return;
    setLogging(true);
    try {
      const logItems = items ?? result.items;
      const entries = logItems.map(item => ({
        user_id: user.id,
        date,
        meal: selectedMeal,
        food: item.name,
        qty: 1,
        calories: Math.round(item.calories),
        protein: Math.round(item.protein * 10) / 10,
        carbs: Math.round(item.carbs * 10) / 10,
        fat: Math.round(item.fat * 10) / 10,
      }));
      const { error } = await supabase.from('macro_logs').insert(entries);
      if (error) { Alert.alert('Log failed', error.message); return; }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onLogged();
      onClose();
    } finally {
      setLogging(false);
    }
  };

  const updateEditItem = (idx: number, field: keyof AnalyzedItem, value: string) => {
    setEditItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      if (field === 'name' || field === 'portion') return { ...it, [field]: value };
      const num = parseFloat(value);
      return { ...it, [field]: isNaN(num) ? 0 : num };
    }));
  };

  return (
    <>
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[s.safe, { flex: 1 }]} edges={['top', 'bottom']}>
        <View style={s.handle} />
        <View style={s.headerRow}>
          <Text style={s.title}>
            {phase === 'input' ? 'Describe Meal' : phase === 'analyzing' ? 'Parsing…' : phase === 'editing' ? 'Edit Items' : 'Review Meal'}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={s.closeBtn}>×</Text>
          </TouchableOpacity>
        </View>

        {phase === 'input' && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={s.inputContent} keyboardShouldPersistTaps="handled">
              <Ionicons name="mic" size={40} color={colors.textTertiary} />
              <Text style={s.inputHeading}>What did you eat?</Text>
              <Text style={s.inputSub}>Speak using the keyboard mic, or type what you ate.</Text>
              <TextInput
                style={s.textArea}
                value={text}
                onChangeText={setText}
                placeholder="e.g. two scrambled eggs, whole wheat toast with butter, black coffee"
                placeholderTextColor={colors.textTertiary}
                multiline
                autoFocus
                returnKeyType="done"
                blurOnSubmit
              />
              <TouchableOpacity
                style={[s.primaryBtn, !text.trim() && s.primaryBtnDisabled]}
                onPress={handleSubmit}
                activeOpacity={0.8}
                disabled={!text.trim()}
              >
                <Text style={s.primaryBtnText}>Analyze Meal</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        )}

        {phase === 'analyzing' && (
          <View style={s.analyzingContainer}>
            <Ionicons name="sparkles-outline" size={30} color={colors.textTertiary} />
            <Text style={s.analyzingText}>Parsing your meal…</Text>
            <View style={s.skeletonStack}>
              <SkeletonBox width="100%" height={18} borderRadius={6} />
              <SkeletonBox width="85%" height={18} borderRadius={6} />
              <SkeletonBox width="60%" height={18} borderRadius={6} />
              <SkeletonBox width="100%" height={80} borderRadius={radius.md} />
            </View>
          </View>
        )}

        {phase === 'results' && result && (
          <FoodAnalysisResults
            result={result}
            selectedMeal={selectedMeal}
            onMealChange={setSelectedMeal}
            onLog={() => handleLog()}
            onEdit={() => { setEditItems(result.items.map(it => ({ ...it }))); setPhase('editing'); }}
            logging={logging}
          />
        )}

        {phase === 'editing' && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={s.editContent}>
              {editItems.map((item, i) => (
                <View key={i} style={s.editCard}>
                  <Text style={s.editCardLabel}>Item {i + 1}</Text>
                  <TextInput
                    style={s.editInput}
                    value={item.name}
                    onChangeText={v =>updateEditItem(i, 'name', v)}
                    placeholder="Food name"
                    placeholderTextColor={colors.textTertiary}
                  />
                  <TextInput
                    style={s.editInput}
                    value={item.portion}
                    onChangeText={v =>updateEditItem(i, 'portion', v)}
                    placeholder="Portion (e.g. 1 cup)"
                    placeholderTextColor={colors.textTertiary}
                  />
                  <View style={s.editMacroRow}>
                    {(['calories', 'protein', 'carbs', 'fat'] as const).map(field => (
                      <View key={field} style={s.editMacroField}>
                        <Text style={s.editMacroLabel}>{field === 'calories' ? 'cal' : field[0].toUpperCase()}</Text>
                        <TextInput
                          style={s.editMacroInput}
                          value={String(item[field])}
                          onChangeText={v =>updateEditItem(i, field, v)}
                          keyboardType="decimal-pad"
                          placeholderTextColor={colors.textTertiary}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              ))}
              <TouchableOpacity
                style={[s.primaryBtn, { marginTop: 8 }]}
                onPress={() => handleLog(editItems)}
                activeOpacity={0.8}
                disabled={logging}
              >
                {logging
                  ? <ActivityIndicator color="#000" />
                  : <Text style={s.primaryBtnText}>Confirm &amp; Log</Text>}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </Modal>
      {paywall}
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { backgroundColor: c.bgSecondary },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, alignSelf: 'center', marginTop: spacing.sm, marginBottom: spacing.md },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginBottom: spacing.md },
    title: { fontSize: 18, fontWeight: weight.bold, color: c.text },
    closeBtn: { fontSize: 28, color: c.textSecondary, lineHeight: 32 },
    inputContent: { padding: spacing.lg, gap: 14, alignItems: 'center', paddingBottom: spacing.xxxl },
    micEmoji: { fontSize: 52, marginTop: spacing.xl },
    inputHeading: { fontSize: 22, fontWeight: weight.heavy, color: c.text, textAlign: 'center' },
    inputSub: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20 },
    textArea: {
      width: '100%', minHeight: 130, backgroundColor: c.card, borderRadius: radius.md,
      borderWidth: 1, borderColor: c.border, padding: 14, color: c.text,
      fontSize: 15, lineHeight: 22, textAlignVertical: 'top',
    },
    primaryBtn: { width: '100%', backgroundColor: c.accent, borderRadius: radius.md, padding: 15, alignItems: 'center' },
    primaryBtnDisabled: { opacity: 0.45 },
    primaryBtnText: { color: c.accentText, fontWeight: weight.bold, fontSize: 15 },
    analyzingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
    analyzingEmoji: { fontSize: 56 },
    analyzingText: { fontSize: 16, color: c.textSecondary, fontWeight: weight.medium },
    skeletonStack: { width: '100%', gap: 10, marginTop: spacing.sm },
    editContent: { padding: spacing.lg, gap: 12, paddingBottom: spacing.xxxl },
    editCard: { backgroundColor: c.card, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border, gap: 8 },
    editCardLabel: { fontSize: 11, color: c.textSecondary, fontWeight: weight.semibold, letterSpacing: 1 },
    editInput: {
      backgroundColor: c.bg, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border,
      paddingHorizontal: 12, paddingVertical: 9, color: c.text, fontSize: 14,
    },
    editMacroRow: { flexDirection: 'row', gap: 8 },
    editMacroField: { flex: 1, gap: 4 },
    editMacroLabel: { fontSize: 11, color: c.textSecondary, fontWeight: weight.semibold, textAlign: 'center' },
    editMacroInput: {
      backgroundColor: c.bg, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border,
      paddingHorizontal: 8, paddingVertical: 9, color: c.text, fontSize: 14, textAlign: 'center',
    },
  });
}
