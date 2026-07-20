import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { MC } from '../constants/data';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';

const UNITS = ['g', 'oz', 'ml', 'cup', 'piece'] as const;
type ServingUnit = typeof UNITS[number];

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
};

const EMPTY = {
  name: '', brand: '', servingAmt: '100', unit: 'g' as ServingUnit,
  calories: '', protein: '', carbs: '', fat: '', fiber: '', sugar: '',
};

export default function CreateFoodModal({ visible, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);

  const set = (field: keyof typeof EMPTY) => (v: string) =>
    setForm(f => ({ ...f, [field]: v }));

  const reset = () => { setForm(EMPTY); setUnitOpen(false); };

  const handleClose = () => { reset(); onClose(); };

  const handleSave = async () => {
    if (!form.name.trim()) { Alert.alert('Name required', 'Enter a food name.'); return; }
    if (!form.calories.trim()) { Alert.alert('Calories required', 'Enter a calorie value.'); return; }
    if (!user) return;
    setSaving(true);
    try {
      const serving_size = `${form.servingAmt} ${form.unit}`;
      const { error } = await supabase.from('user_foods').insert({
        user_id: user.id,
        name: form.name.trim(),
        brand: form.brand.trim() || null,
        serving_size,
        calories: parseFloat(form.calories) || 0,
        protein: parseFloat(form.protein) || 0,
        carbs: parseFloat(form.carbs) || 0,
        fat: parseFloat(form.fat) || 0,
        fiber: form.fiber.trim() ? parseFloat(form.fiber) : null,
        sugar: form.sugar.trim() ? parseFloat(form.sugar) : null,
      });
      if (error) { Alert.alert('Save failed', error.message); return; }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleClose}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
            <View style={s.handle} />
            <View style={s.header}>
              <Text style={s.title}>Create Food</Text>
              <TouchableOpacity style={s.closeBtn} onPress={handleClose}>
                <Text style={s.closeTxt}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={s.scroll}
              contentContainerStyle={{ paddingBottom: 48 }}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={s.label}>Food Name *</Text>
              <TextInput
                style={s.input}
                value={form.name}
                onChangeText={set('name')}
                placeholder="e.g. Homemade Chicken Tikka"
                placeholderTextColor={colors.textTertiary}
                autoFocus
              />

              <Text style={s.label}>Brand</Text>
              <TextInput
                style={s.input}
                value={form.brand}
                onChangeText={set('brand')}
                placeholder="Optional"
                placeholderTextColor={colors.textTertiary}
              />

              <Text style={s.label}>Serving Size</Text>
              <View style={s.servingRow}>
                <TextInput
                  style={[s.input, { flex: 1, marginBottom: 0 }]}
                  value={form.servingAmt}
                  onChangeText={set('servingAmt')}
                  keyboardType="decimal-pad"
                  placeholder="100"
                  placeholderTextColor={colors.textTertiary}
                />
                <TouchableOpacity style={s.unitBtn} onPress={() => setUnitOpen(true)}>
                  <Text style={s.unitBtnText}>{form.unit}</Text>
                  <Text style={{ color: colors.textTertiary, fontSize: 10, marginLeft: 4 }}>▼</Text>
                </TouchableOpacity>
              </View>

              <Text style={[s.label, { marginTop: 16 }]}>Calories *</Text>
              <TextInput
                style={s.input}
                value={form.calories}
                onChangeText={set('calories')}
                placeholder="0"
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
              />

              <Text style={s.label}>Macros per Serving</Text>
              <View style={s.macroRow}>
                {([
                  { key: 'protein', label: 'Protein', color: MC.protein.color },
                  { key: 'carbs',   label: 'Carbs',   color: MC.carbs.color   },
                  { key: 'fat',     label: 'Fat',      color: MC.fat.color     },
                ] as const).map(m => (
                  <View key={m.key} style={s.macroCell}>
                    <Text style={[s.macroLbl, { color: m.color }]}>{m.label} (g)</Text>
                    <TextInput
                      style={s.macroInput}
                      value={form[m.key]}
                      onChangeText={set(m.key)}
                      placeholder="0"
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="decimal-pad"
                    />
                  </View>
                ))}
              </View>

              <Text style={[s.label, { marginTop: 4 }]}>Optional</Text>
              <View style={[s.macroRow, { marginBottom: 0 }]}>
                {([
                  { key: 'fiber', label: 'Fiber' },
                  { key: 'sugar', label: 'Sugar' },
                ] as const).map(m => (
                  <View key={m.key} style={s.macroCell}>
                    <Text style={s.macroLbl}>{m.label} (g)</Text>
                    <TextInput
                      style={s.macroInput}
                      value={form[m.key]}
                      onChangeText={set(m.key)}
                      placeholder="0"
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="decimal-pad"
                    />
                  </View>
                ))}
                <View style={s.macroCell} />
              </View>

              <TouchableOpacity
                style={[s.saveBtn, { marginTop: 24 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color={colors.accentText} />
                  : <Text style={s.saveBtnText}>Save Food</Text>}
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Unit picker */}
      <Modal
        visible={unitOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setUnitOpen(false)}
      >
        <TouchableOpacity
          style={s.unitBackdrop}
          activeOpacity={1}
          onPress={() => setUnitOpen(false)}
        >
          <View style={s.unitSheet}>
            <Text style={s.unitSheetTitle}>Serving Unit</Text>
            {UNITS.map(u => (
              <TouchableOpacity
                key={u}
                style={s.unitRow}
                onPress={() => { setForm(f => ({ ...f, unit: u })); setUnitOpen(false); }}
              >
                <Text style={[s.unitRowText, form.unit === u && { color: colors.accent }]}>
                  {u}
                </Text>
                {form.unit === u && <Text style={{ color: colors.accent, fontSize: 16 }}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bgSecondary },
    handle: { width: 36, height: 4, backgroundColor: c.borderStrong, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, marginBottom: spacing.lg },
    title: { fontSize: 22, fontWeight: weight.heavy, color: c.text },
    closeBtn: { backgroundColor: c.cardAlt, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    closeTxt: { color: c.textSecondary, fontSize: 20, lineHeight: 22 },
    scroll: { flex: 1, paddingHorizontal: spacing.xl },
    label: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    input: { backgroundColor: c.card, borderRadius: radius.md, color: c.text, padding: 14, fontSize: 15, marginBottom: 16, borderWidth: 1, borderColor: c.border },
    servingRow: { flexDirection: 'row', gap: 8 },
    unitBtn: { backgroundColor: c.card, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: c.border, minWidth: 80 },
    unitBtnText: { color: c.text, fontSize: 15, fontWeight: weight.bold },
    macroRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    macroCell: { flex: 1 },
    macroLbl: { fontSize: 10, fontWeight: weight.bold, color: c.textTertiary, marginBottom: 6, textTransform: 'uppercase' },
    macroInput: { backgroundColor: c.card, borderRadius: radius.sm, color: c.text, padding: 12, fontSize: 14, borderWidth: 1, borderColor: c.border, textAlign: 'center' },
    saveBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 16, alignItems: 'center' },
    saveBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.heavy },
    unitBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
    unitSheet: { backgroundColor: c.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 40, borderWidth: 1, borderColor: c.border },
    unitSheetTitle: { fontSize: 16, fontWeight: weight.heavy, color: c.text, marginBottom: 16 },
    unitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border },
    unitRowText: { fontSize: 15, fontWeight: weight.medium, color: c.text },
  });
}
