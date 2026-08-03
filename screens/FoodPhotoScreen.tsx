import React, { useState, useEffect, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, Alert, Image,
  ScrollView, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import SkeletonBox from '../components/SkeletonBox';
import FoodAnalysisResults, { AnalysisResult, AnalyzedItem } from '../components/FoodAnalysisResults';
import { useAIGate } from '../hooks/useAIGate';
import { logError } from '../utils/logError';

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQ4NjIsImV4cCI6MjA4NzQwMDg2Mn0.lUng1tY_aAuee_t8-E5MSUHdm2PF3HzsE41L-kzBmJE';

const PHOTO_PROMPT = `Analyze this food photo and estimate the nutritional content. Identify each distinct food item visible, including sauces, oils, dressings, or toppings that add meaningful calories. Estimate portion sizes using visible reference objects (plate size, utensils, hand) when available. If nothing edible is visible, return an empty items array.
Return ONLY valid JSON, no markdown fences, no explanation, no text before or after the JSON:
{"items":[{"name":string,"calories":number,"protein":number,"carbs":number,"fat":number,"portion":string}],"totals":{"calories":number,"protein":number,"carbs":number,"fat":number},"confidence":"high"|"medium"|"low","notes":string}`;

const CYCLE_EMOJIS = ['', '', '', '', ''];

type Phase = 'capture' | 'analyzing' | 'results' | 'editing';

type Props = {
  visible: boolean;
  date: string;
  defaultMeal?: string;
  onClose: () => void;
  onLogged: () => void;
};

export default function FoodPhotoScreen({ visible, date, defaultMeal, onClose, onLogged }: Props) {
  const { requestAccess, paywall } = useAIGate();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { user } = useAuth();

  const [phase, setPhase] = useState<Phase>('capture');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageWidth, setImageWidth] = useState<number | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [editItems, setEditItems] = useState<AnalyzedItem[]>([]);
  const [selectedMeal, setSelectedMeal] = useState(defaultMeal || 'Breakfast');
  const [logging, setLogging] = useState(false);
  const [emojiIdx, setEmojiIdx] = useState(0);
  const emojiTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (visible) {
      setPhase('capture');
      setImageUri(null);
      setImageWidth(null);
      setResult(null);
      setEditItems([]);
      setSelectedMeal(defaultMeal || 'Breakfast');
      setLogging(false);
    }
  }, [visible]);

  useEffect(() => {
    if (phase === 'analyzing') {
      setEmojiIdx(0);
      emojiTimer.current = setInterval(() => {
        setEmojiIdx(i => (i + 1) % CYCLE_EMOJIS.length);
      }, 600);
    } else {
      if (emojiTimer.current) { clearInterval(emojiTimer.current); emojiTimer.current = null; }
    }
    return () => { if (emojiTimer.current) clearInterval(emojiTimer.current); };
  }, [phase]);

  const pickCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera permission required', 'Please enable camera access in Settings.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.8, mediaTypes: ['images'] as any });
    if (!res.canceled && res.assets[0]) {
      setImageUri(res.assets[0].uri);
      setImageWidth(res.assets[0].width ?? null);
    }
  };

  const pickLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Photo library permission required', 'Please enable photo library access in Settings.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: false, mediaTypes: ['images'] as any });
    if (!res.canceled && res.assets[0]) {
      setImageUri(res.assets[0].uri);
      setImageWidth(res.assets[0].width ?? null);
    }
  };

  const MAX_UPLOAD_WIDTH = 1024;

  const analyzePhoto = async () => {
  // Pro gate: consumes one free trial use, then paywalls.
  if (!(await requestAccess('food_photo'))) return;
    if (!imageUri) return;
    setPhase('analyzing');
    try {
      const actions = imageWidth && imageWidth > MAX_UPLOAD_WIDTH
        ? [{ resize: { width: MAX_UPLOAD_WIDTH } }]
        : [];
      const jpeg = await ImageManipulator.manipulateAsync(
        imageUri, actions, { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      const base64 = jpeg.base64!;
      const res = await fetch('https://zbcxuffgmjuqarapfdwb.supabase.co/functions/v1/ai-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({
          system: 'You are a nutrition analysis tool. Return only valid JSON, no markdown.',
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: PHOTO_PROMPT },
          ]}],
          max_tokens: 2000,
        }),
      });
      if (!res.ok) throw new Error(`ai-proxy responded ${res.status}`);
      const data = await res.json();
      const raw = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      const parsed: AnalysisResult = JSON.parse(jsonMatch[0]);
      if (!parsed.items || parsed.items.length === 0) {
        Alert.alert('No food detected', 'Try a clearer, well-lit photo of your meal.');
        setPhase('capture');
        return;
      }
      setResult(parsed);
      setEditItems(parsed.items.map(it => ({ ...it })));
      setPhase('results');
    } catch (err) {
      logError('FoodPhoto.analyze', err);
      Alert.alert('Analysis failed', 'Could not analyze the photo. Try again or enter manually.');
      setPhase('capture');
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
            {phase === 'capture' ? 'Photo Log' : phase === 'analyzing' ? 'Analyzing…' : phase === 'editing' ? 'Edit Items' : 'Review Meal'}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={s.closeBtn}>×</Text>
          </TouchableOpacity>
        </View>

        {phase === 'capture' && (
          <ScrollView contentContainerStyle={s.captureContent}>
            {imageUri && (
              <Image source={{ uri: imageUri }} style={s.preview} resizeMode="cover" />
            )}
            {!imageUri && (
              <View style={s.placeholderBox}>
                <Ionicons name="camera-outline" size={40} color={colors.textTertiary} />
                <Text style={s.placeholderText}>Take a photo of your meal</Text>
              </View>
            )}
            <TouchableOpacity style={s.primaryBtn} onPress={pickCamera} activeOpacity={0.8}>
              <Text style={s.primaryBtnText}>{imageUri ? 'Retake Photo' : 'Take Photo'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondaryBtn} onPress={pickLibrary} activeOpacity={0.8}>
              <Text style={s.secondaryBtnText}>Choose from Library</Text>
            </TouchableOpacity>
            {imageUri && (
              <TouchableOpacity style={s.analyzeBtn} onPress={analyzePhoto} activeOpacity={0.8}>
                <Text style={s.primaryBtnText}>Analyze Meal</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {phase === 'analyzing' && (
          <View style={s.analyzingContainer}>
            <Text style={s.analyzingEmoji}>{CYCLE_EMOJIS[emojiIdx]}</Text>
            <Text style={s.analyzingText}>Analyzing your meal…</Text>
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
    captureContent: { padding: spacing.lg, gap: 12 },
    preview: { width: '100%', height: 240, borderRadius: radius.card },
    placeholderBox: {
      width: '100%', height: 200, borderRadius: radius.card,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      alignItems: 'center', justifyContent: 'center', gap: 10,
    },
    placeholderEmoji: { fontSize: 48 },
    placeholderText: { fontSize: 14, color: c.textSecondary },
    primaryBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 15, alignItems: 'center' },
    primaryBtnText: { color: c.accentText, fontWeight: weight.bold, fontSize: 15 },
    secondaryBtn: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 15, alignItems: 'center' },
    secondaryBtnText: { color: c.textSecondary, fontWeight: weight.semibold, fontSize: 15 },
    analyzeBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 15, alignItems: 'center', marginTop: 4 },
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
