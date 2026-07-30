import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, Share, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callAI } from '../constants/ai';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { logError } from '../utils/logError';
import { useAIGate } from '../hooks/useAIGate';

const GROCERY_KEY = 'fuelog_grocery_checklist';

interface GroceryItem {
  id: string;
  name: string;
  amount: string;
  unit: string;
}

interface GrocerySection {
  name: string;
  emoji: string;
  items: GroceryItem[];
}

interface CustomItem {
  id: string;
  name: string;
  sectionIndex: number;
}

interface StoredState {
  planHash: string;
  sections: GrocerySection[];
  checked: string[];
  customItems: CustomItem[];
}

function hashPlan(plan: any[]): string {
  const str = JSON.stringify(plan);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return String(Math.abs(h));
}

function CheckboxItem({
  item,
  checked,
  onToggle,
  colors,
  s,
}: {
  item: GroceryItem;
  checked: boolean;
  onToggle: () => void;
  colors: ThemeColors;
  s: ReturnType<typeof makeStyles>;
}) {
  const scale = useRef(new Animated.Value(checked ? 1 : 0)).current;

  const toggle = () => {
    Animated.spring(scale, {
      toValue: checked ? 0 : 1,
      useNativeDriver: true,
      bounciness: 12,
    }).start();
    onToggle();
  };

  return (
    <TouchableOpacity style={s.itemRow} onPress={toggle} activeOpacity={0.7}>
      <View style={[s.checkbox, checked && s.checkboxChecked]}>
        <Animated.Text style={[s.checkmark, { transform: [{ scale }] }]}>✓</Animated.Text>
      </View>
      <Text style={[s.itemName, checked && s.itemNameChecked]} numberOfLines={1}>
        {item.name}
      </Text>
      <Text style={[s.itemAmount, checked && s.itemAmountChecked]}>
        {item.amount} {item.unit}
      </Text>
    </TouchableOpacity>
  );
}

export default function GroceryListScreen({
  plan,
  onBack,
}: {
  plan: any[] | null;
  onBack: () => void;
}) {
  const { requestAccess, paywall } = useAIGate();
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [sections, setSections] = useState<GrocerySection[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [loaded, setLoaded] = useState(false);

  const currentHash = plan ? hashPlan(plan) : '';

  const loadStored = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(GROCERY_KEY);
      if (raw) {
        const stored: StoredState = JSON.parse(raw);
        if (stored.planHash === currentHash) {
          setSections(stored.sections ?? []);
          setChecked(new Set(stored.checked ?? []));
          setCustomItems(stored.customItems ?? []);
        }
      }
    } catch (e) { logError('GroceryListScreen.GroceryListScreen', e); }
    setLoaded(true);
  }, [currentHash]);

  useEffect(() => { loadStored(); }, [loadStored]);

  const persist = useCallback(async (
    nextSections: GrocerySection[],
    nextChecked: Set<string>,
    nextCustom: CustomItem[],
  ) => {
    const stored: StoredState = {
      planHash: currentHash,
      sections: nextSections,
      checked: Array.from(nextChecked),
      customItems: nextCustom,
    };
    await AsyncStorage.setItem(GROCERY_KEY, JSON.stringify(stored));
  }, [currentHash]);

  const generate = async () => {
  // Pro gate: consumes one free trial use, then paywalls.
  if (!(await requestAccess('grocery_list'))) return;
    if (!plan) return;
    setGenerating(true);
    try {
      const planJSON = JSON.stringify(plan);
      const prompt = `Given this meal plan: ${planJSON}

Generate a grocery list organized by store section.
Consolidate duplicate ingredients (if chicken appears in 3 meals, show the total amount needed).
Return ONLY valid JSON in this exact shape, no commentary:
{"sections":[{"name":"string","emoji":"string","items":[{"name":"string","amount":"string","unit":"string"}]}]}

Use these sections (include only sections that have items):
- 🥩 Proteins (meat, fish, eggs, protein powder)
- 🥦 Produce (vegetables, fruits)
- 🌾 Grains & Carbs (oats, rice, bread, pasta)
- 🥛 Dairy (milk, cheese, yogurt)
- 🥫 Pantry (oils, sauces, canned goods, nuts, nut butters)
- 💊 Supplements (creatine, vitamins, protein powder if supplement-focused)`;

      const raw = await callAI([{ role: 'user', content: prompt }]);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');
      const parsed = JSON.parse(match[0]) as { sections: GrocerySection[] };

      // Assign stable IDs to items
      const withIds: GrocerySection[] = (parsed.sections ?? []).map((sec, si) => ({
        ...sec,
        items: (sec.items ?? []).map((item, ii) => ({
          ...item,
          id: `${si}-${ii}-${item.name.slice(0, 8)}`,
        })),
      }));

      const nextChecked = new Set<string>();
      setSections(withIds);
      setChecked(nextChecked);
      setCustomItems([]);
      await persist(withIds, nextChecked, []);
    } catch (e: any) {
      console.log('grocery generate error:', e?.message);
    }
    setGenerating(false);
  };

  const toggleItem = useCallback(async (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persist(sections, next, customItems);
      return next;
    });
  }, [sections, customItems, persist]);

  const addCustomItem = async () => {
    const name = customInput.trim();
    if (!name) return;
    const item: CustomItem = { id: `custom-${Date.now()}`, name, sectionIndex: -1 };
    const nextCustom = [...customItems, item];
    setCustomItems(nextCustom);
    setCustomInput('');
    await persist(sections, checked, nextCustom);
  };

  const buildShareText = (): string => {
    const lines: string[] = ['🛒 Grocery List\n'];
    sections.forEach(sec => {
      lines.push(`${sec.emoji} ${sec.name}`);
      sec.items.forEach(item => {
        const done = checked.has(item.id) ? '✓ ' : '  ';
        lines.push(`${done}${item.name} — ${item.amount} ${item.unit}`);
      });
      lines.push('');
    });
    if (customItems.length > 0) {
      lines.push('➕ Added manually');
      customItems.forEach(i => lines.push(`  ${i.name}`));
    }
    return lines.join('\n');
  };

  const handleShare = async () => {
    await Share.share({ message: buildShareText() });
  };

  const hasPlan = plan != null && plan.length > 0;
  const hasGenerated = sections.length > 0;

  return (
    <>
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>Grocery List</Text>
        {hasGenerated && (
          <TouchableOpacity onPress={handleShare} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.shareBtn}>Share</Text>
          </TouchableOpacity>
        )}
      </View>

      {!hasPlan && (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>🛒</Text>
          <Text style={s.emptyTitle}>No meal plan yet</Text>
          <Text style={s.emptySub}>Generate a meal plan first, then come back here to build your grocery list.</Text>
        </View>
      )}

      {hasPlan && !hasGenerated && !generating && loaded && (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>📋</Text>
          <Text style={s.emptyTitle}>Ready to generate</Text>
          <Text style={s.emptySub}>Tap the button below to build a categorized grocery list from your meal plan.</Text>
          <TouchableOpacity style={s.generateBtn} onPress={generate} activeOpacity={0.8}>
            <Text style={s.generateBtnText}>Generate Grocery List</Text>
          </TouchableOpacity>
        </View>
      )}

      {generating && (
        <View style={s.empty}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={s.loadingText}>Building your list…</Text>
        </View>
      )}

      {hasGenerated && !generating && (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {sections.map((sec, si) => (
            <View key={si} style={s.section}>
              <Text style={s.sectionHeader}>{sec.emoji}  {sec.name}</Text>
              {sec.items.map(item => (
                <CheckboxItem
                  key={item.id}
                  item={item}
                  checked={checked.has(item.id)}
                  onToggle={() => toggleItem(item.id)}
                  colors={colors}
                  s={s}
                />
              ))}
            </View>
          ))}

          {customItems.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionHeader}>➕  Added by you</Text>
              {customItems.map(i => (
                <View key={i.id} style={s.itemRow}>
                  <View style={s.checkbox}>
                    <Text style={s.checkmark}> </Text>
                  </View>
                  <Text style={s.itemName}>{i.name}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={s.addRow}>
            <TextInput
              style={s.addInput}
              value={customInput}
              onChangeText={setCustomInput}
              placeholder="＋ Add item…"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              onSubmitEditing={addCustomItem}
            />
            {customInput.trim().length > 0 && (
              <TouchableOpacity style={s.addConfirm} onPress={addCustomItem}>
                <Text style={s.addConfirmText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity style={s.regenBtn} onPress={generate} activeOpacity={0.8}>
            <Text style={s.regenBtnText}>↺ Regenerate List</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
      {paywall}
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe:              { flex: 1, backgroundColor: c.bg },
    header:            { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border, gap: 12 },
    back:              { fontSize: 22, color: c.text, fontWeight: weight.bold, paddingRight: 4 },
    title:             { flex: 1, fontSize: 20, fontWeight: weight.heavy, color: c.text },
    shareBtn:          { fontSize: 14, color: c.accent, fontWeight: weight.bold },
    empty:             { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
    emptyIcon:         { fontSize: 52 },
    emptyTitle:        { fontSize: 20, fontWeight: weight.heavy, color: c.text, textAlign: 'center' },
    emptySub:          { fontSize: 14, color: c.textTertiary, textAlign: 'center', lineHeight: 22 },
    generateBtn:       { backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 16, paddingHorizontal: 32, marginTop: 8 },
    generateBtnText:   { color: c.accentText, fontWeight: weight.heavy, fontSize: 15 },
    loadingText:       { fontSize: 15, color: c.textSecondary, fontWeight: weight.medium, marginTop: 16 },
    scroll:            { flex: 1 },
    content:           { padding: spacing.lg, paddingBottom: 48, gap: 20 },
    section:           { gap: 4 },
    sectionHeader:     { fontSize: 13, fontWeight: weight.bold, color: c.textSecondary, letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
    itemRow:           { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: c.border, gap: 12 },
    checkbox:          { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
    checkboxChecked:   { backgroundColor: c.accent, borderColor: c.accent },
    checkmark:         { color: c.accentText, fontSize: 13, fontWeight: weight.heavy, lineHeight: 16 },
    itemName:          { flex: 1, fontSize: 15, fontWeight: weight.medium, color: c.text },
    itemNameChecked:   { color: c.textTertiary, textDecorationLine: 'line-through' },
    itemAmount:        { fontSize: 13, color: c.textSecondary, fontWeight: weight.medium },
    itemAmountChecked: { color: c.textTertiary },
    addRow:            { flexDirection: 'row', gap: 8, marginTop: 4 },
    addInput:          { flex: 1, backgroundColor: c.card, borderRadius: radius.md, color: c.text, padding: 12, fontSize: 15, borderWidth: 1, borderColor: c.border },
    addConfirm:        { backgroundColor: c.accent, borderRadius: radius.md, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
    addConfirmText:    { color: c.accentText, fontWeight: weight.bold, fontSize: 14 },
    regenBtn:          { alignItems: 'center', paddingVertical: 14 },
    regenBtnText:      { color: c.textTertiary, fontSize: 13, fontWeight: weight.semibold },
  });
}
