import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { MC } from '../constants/data';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { saveRecipe, Recipe, RecipeIngredient } from '../utils/recipes';
import { useAIGate } from '../hooks/useAIGate';
import { logError } from '../utils/logError';

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQ4NjIsImV4cCI6MjA4NzQwMDg2Mn0.lUng1tY_aAuee_t8-E5MSUHdm2PF3HzsE41L-kzBmJE';

type FoodItem = {
  name: string;
  brand?: string;
  serving_size?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source: 'mine' | 'usda';
};

type Ingredient = FoodItem & { qty: number };

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: (recipe: Recipe) => void;
};

export default function RecipeBuilderScreen({ visible, onClose, onSaved }: Props) {
  const { requestAccess, paywall } = useAIGate();
  const { user } = useAuth();
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [name, setName] = useState('');
  const [servings, setServings] = useState(1);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  // Step 2
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [myFoods, setMyFoods] = useState<FoodItem[]>([]);
  const [usdaResults, setUsdaResults] = useState<FoodItem[]>([]);
  const [searchTab, setSearchTab] = useState<'mine' | 'usda'>('mine');
  const [loadingMine, setLoadingMine] = useState(false);
  const [searchingUSDA, setSearchingUSDA] = useState(false);

  // Pending ingredient qty selection
  const [pendingFood, setPendingFood] = useState<FoodItem | null>(null);
  const [pendingQty, setPendingQty] = useState('1');

  const [saving, setSaving] = useState(false);
  const prevVisible = useRef(false);

  const loadMyFoods = useCallback(async () => {
    if (!user) return;
    setLoadingMine(true);
    const { data } = await supabase
      .from('user_foods')
      .select('*')
      .eq('user_id', user.id)
      .order('name');
    setMyFoods(
      ((data ?? []) as any[]).map(f => ({
        name: f.name,
        brand: f.brand ?? undefined,
        serving_size: f.serving_size ?? undefined,
        calories: f.calories,
        protein: f.protein,
        carbs: f.carbs,
        fat: f.fat,
        source: 'mine' as const,
      })),
    );
    setLoadingMine(false);
  }, [user]);

  useEffect(() => {
    if (visible && !prevVisible.current) {
      // Reset on open
      setStep(1); setName(''); setServings(1); setPhotoUri(null);
      setIngredients([]); setIngredientSearch(''); setUsdaResults([]);
      setSearchTab('mine'); setPendingFood(null); setPendingQty('1');
      void loadMyFoods();
    }
    prevVisible.current = visible;
  }, [visible, loadMyFoods]);

  const searchUSDA = async () => {
  // Pro gate: consumes one free trial use, then paywalls.
  if (!(await requestAccess('recipe'))) return;
    if (!ingredientSearch.trim()) return;
    setSearchingUSDA(true);
    setSearchTab('usda');
    try {
      const res = await fetch(
        'https://zbcxuffgmjuqarapfdwb.supabase.co/functions/v1/ai-proxy/food-search',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: ANON_KEY,
            Authorization: `Bearer ${ANON_KEY}`,
          },
          body: JSON.stringify({ query: ingredientSearch.trim() }),
        },
      );
      const data = await res.json();
      setUsdaResults(
        (data.foods || []).map((f: any) => ({
          name: f.name,
          brand: f.brand,
          serving_size: f.serving_size,
          calories: f.calories || 0,
          protein: f.protein || 0,
          carbs: f.carbs || 0,
          fat: f.fat || 0,
          source: 'usda' as const,
        })),
      );
    } catch (e) {
      logError('RecipeBuilder.usdaSearch', e);
      Alert.alert('Search failed', 'Could not reach the food database.');
    } finally {
      setSearchingUSDA(false);
    }
  };

  const filteredMine = useMemo(() => {
    const q = ingredientSearch.trim().toLowerCase();
    if (!q) return myFoods;
    return myFoods.filter(f => f.name.toLowerCase().includes(q));
  }, [myFoods, ingredientSearch]);

  const searchList = searchTab === 'mine' ? filteredMine : usdaResults;

  const totalCals  = useMemo(() => ingredients.reduce((s, i) => s + i.calories * i.qty, 0), [ingredients]);
  const totalProt  = useMemo(() => ingredients.reduce((s, i) => s + i.protein * i.qty, 0), [ingredients]);
  const totalCarbs = useMemo(() => ingredients.reduce((s, i) => s + i.carbs * i.qty, 0), [ingredients]);
  const totalFat   = useMemo(() => ingredients.reduce((s, i) => s + i.fat * i.qty, 0), [ingredients]);
  const perCal  = totalCals  / Math.max(1, servings);
  const perProt = totalProt  / Math.max(1, servings);
  const perCarb = totalCarbs / Math.max(1, servings);
  const perFat  = totalFat   / Math.max(1, servings);

  const addIngredient = () => {
    if (!pendingFood) return;
    const q = parseFloat(pendingQty);
    if (!Number.isFinite(q) || q <= 0) {
      Alert.alert('Quantity', 'Enter a quantity greater than 0.');
      return;
    }
    setIngredients(prev => {
      const existing = prev.findIndex(i => i.name === pendingFood.name);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { ...updated[existing], qty: updated[existing].qty + q };
        return updated;
      }
      return [...prev, { ...pendingFood, qty: q }];
    });
    setPendingFood(null);
    setPendingQty('1');
  };

  const removeIngredient = (idx: number) => {
    setIngredients(prev => prev.filter((_, i) => i !== idx));
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.6,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const recipe = await saveRecipe(user.id, {
        name: name.trim(),
        servings,
        ingredients: ingredients.map<RecipeIngredient>(i => ({
          name: i.name,
          brand: i.brand,
          serving_size: i.serving_size,
          calories: i.calories,
          protein: i.protein,
          carbs: i.carbs,
          fat: i.fat,
          qty: i.qty,
        })),
        per_serving_calories: Math.round(perCal),
        per_serving_protein: Math.round(perProt * 10) / 10,
        per_serving_carbs: Math.round(perCarb * 10) / 10,
        per_serving_fat: Math.round(perFat * 10) / 10,
        photo_uri: photoUri ?? undefined,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(recipe);
    } finally {
      setSaving(false);
    }
  };

  // ──────────────── Step headers ────────────────
  const stepHeader = (
    <View style={s.stepBar}>
      {([1, 2, 3] as const).map(n => (
        <View
          key={n}
          style={[s.stepDot, step >= n && s.stepDotActive, n < 3 && { marginRight: 4 }]}
        />
      ))}
      <Text style={s.stepLabel}>
        {step === 1 ? 'Name & Servings' : step === 2 ? 'Add Ingredients' : 'Review & Save'}
      </Text>
    </View>
  );

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onClose}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
            <View style={s.handle} />
            <View style={s.header}>
              <Text style={s.title}>New Recipe</Text>
              <TouchableOpacity style={s.closeBtn} onPress={onClose}>
                <Text style={s.closeTxt}>×</Text>
              </TouchableOpacity>
            </View>

            {stepHeader}

            {/* ── Step 1 ── */}
            {step === 1 && (
              <ScrollView
                style={s.scroll}
                contentContainerStyle={{ paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
              >
                {/* Photo */}
                <TouchableOpacity style={s.photoPicker} onPress={pickPhoto} activeOpacity={0.8}>
                  {photoUri
                    ? <Image source={{ uri: photoUri }} style={s.photoPreview} />
                    : (
                      <View style={s.photoPlaceholder}>
                        <Ionicons name="camera-outline" size={40} color={colors.textTertiary} />
                        <Text style={s.photoPlaceholderTxt}>Add Photo</Text>
                      </View>
                    )}
                </TouchableOpacity>

                <Text style={s.label}>Recipe Name *</Text>
                <TextInput
                  style={s.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Chicken Fried Rice"
                  placeholderTextColor={colors.textTertiary}
                  autoFocus
                />

                <Text style={s.label}>Number of Servings</Text>
                <View style={s.stepperRow}>
                  <TouchableOpacity
                    style={s.stepperBtn}
                    onPress={() => setServings(s => Math.max(1, s - 1))}
                  >
                    <Text style={s.stepperBtnTxt}>−</Text>
                  </TouchableOpacity>
                  <Text style={s.stepperVal}>{servings}</Text>
                  <TouchableOpacity
                    style={s.stepperBtn}
                    onPress={() => setServings(s => Math.min(20, s + 1))}
                  >
                    <Text style={s.stepperBtnTxt}>+</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[s.primaryBtn, !name.trim() && s.primaryBtnDisabled]}
                  onPress={() => {
                    if (!name.trim()) { Alert.alert('Name required', 'Enter a recipe name.'); return; }
                    setStep(2);
                  }}
                >
                  <Text style={s.primaryBtnTxt}>Next: Add Ingredients →</Text>
                </TouchableOpacity>
              </ScrollView>
            )}

            {/* ── Step 2 ── */}
            {step === 2 && (
              <View style={{ flex: 1 }}>
                <ScrollView
                  style={s.scroll}
                  contentContainerStyle={{ paddingBottom: 24 }}
                  keyboardShouldPersistTaps="handled"
                >
                  {/* Added ingredients */}
                  {ingredients.length > 0 && (
                    <View style={s.ingSection}>
                      <Text style={s.sectionLbl}>
                        {ingredients.length} ingredient{ingredients.length !== 1 ? 's' : ''} added
                      </Text>
                      {ingredients.map((ing, idx) => (
                        <View key={`ing-${idx}`} style={s.ingRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.ingName} numberOfLines={1}>{ing.name}</Text>
                            <Text style={s.ingMeta}>
                              ×{ing.qty} · {Math.round(ing.calories * ing.qty)} cal
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => removeIngredient(idx)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Text style={s.ingDelete}>×</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Running total */}
                  {ingredients.length > 0 && (
                    <View style={s.totalRow}>
                      <Text style={s.totalText}>
                        Total: {Math.round(totalCals)} cal
                      </Text>
                      <Text style={[s.totalMacro, { color: MC.protein.color }]}>
                        P {r1(totalProt)}g
                      </Text>
                      <Text style={[s.totalMacro, { color: MC.carbs.color }]}>
                        C {r1(totalCarbs)}g
                      </Text>
                      <Text style={[s.totalMacro, { color: MC.fat.color }]}>
                        F {r1(totalFat)}g
                      </Text>
                    </View>
                  )}

                  {/* Search */}
                  <View style={s.searchRow}>
                    <TextInput
                      style={s.searchInput}
                      value={ingredientSearch}
                      onChangeText={setIngredientSearch}
                      placeholder="Search ingredients…"
                      placeholderTextColor={colors.textTertiary}
                      returnKeyType="search"
                      onSubmitEditing={searchUSDA}
                      clearButtonMode="while-editing"
                    />
                  </View>

                  <View style={s.tabs}>
                    <TouchableOpacity
                      style={[s.tab, searchTab === 'mine' && s.tabActive]}
                      onPress={() => setSearchTab('mine')}
                    >
                      <Text style={[s.tabTxt, searchTab === 'mine' && s.tabTxtActive]}>
                        My Foods
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.tab, searchTab === 'usda' && s.tabActive]}
                      onPress={searchUSDA}
                    >
                      <Text style={[s.tabTxt, searchTab === 'usda' && s.tabTxtActive]}>
                        {searchingUSDA ? '…searching' : 'Search USDA'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {loadingMine && searchTab === 'mine' && (
                    <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} />
                  )}
                  {!loadingMine && searchList.length === 0 && (
                    <Text style={s.emptyTxt}>
                      {searchTab === 'mine'
                        ? (ingredientSearch ? 'No matches.' : 'No saved foods. Try "Search USDA".')
                        : (ingredientSearch ? 'No results.' : 'Type a food name and tap "Search USDA".')}
                    </Text>
                  )}
                  {searchList.map((f, i) => (
                    <TouchableOpacity
                      key={`${f.source}-${i}-${f.name}`}
                      style={s.foodRow}
                      onPress={() => { setPendingFood(f); setPendingQty('1'); }}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.foodName} numberOfLines={1}>{f.name}</Text>
                        {(f.brand || f.serving_size) && (
                          <Text style={s.foodMeta} numberOfLines={1}>
                            {[f.brand, f.serving_size].filter(Boolean).join(' · ')}
                          </Text>
                        )}
                        <View style={s.foodMacros}>
                          <Text style={s.foodCal}>{Math.round(f.calories)} cal</Text>
                          <Text style={{ color: MC.protein.color, fontSize: 11, fontWeight: '600' }}>P {f.protein}g</Text>
                          <Text style={{ color: MC.carbs.color,   fontSize: 11, fontWeight: '600' }}>C {f.carbs}g</Text>
                          <Text style={{ color: MC.fat.color,     fontSize: 11, fontWeight: '600' }}>F {f.fat}g</Text>
                        </View>
                      </View>
                      <Text style={s.foodAdd}>+</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={s.stepNavRow}>
                  <TouchableOpacity style={s.backBtn} onPress={() => setStep(1)}>
                    <Text style={s.backBtnTxt}>← Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.primaryBtn, { flex: 1, marginLeft: 8 }, ingredients.length === 0 && s.primaryBtnDisabled]}
                    onPress={() => {
                      if (ingredients.length === 0) {
                        Alert.alert('Add ingredients', 'Add at least one ingredient to continue.');
                        return;
                      }
                      setStep(3);
                    }}
                  >
                    <Text style={s.primaryBtnTxt}>Review →</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── Step 3 ── */}
            {step === 3 && (
              <View style={{ flex: 1 }}>
                <ScrollView
                  style={s.scroll}
                  contentContainerStyle={{ paddingBottom: 40 }}
                >
                  {/* Recipe card */}
                  <View style={s.reviewCard}>
                    {photoUri && (
                      <Image source={{ uri: photoUri }} style={s.reviewPhoto} />
                    )}
                    <Text style={s.reviewName}>{name}</Text>
                    <Text style={s.reviewServings}>{servings} serving{servings !== 1 ? 's' : ''}</Text>

                    <Text style={[s.sectionLbl, { marginTop: 16, marginBottom: 8 }]}>Per Serving</Text>
                    <View style={s.macroGrid}>
                      {[
                        { val: Math.round(perCal),    lbl: 'cal',      color: colors.text           },
                        { val: r1(perProt),            lbl: 'g protein', color: MC.protein.color      },
                        { val: r1(perCarb),            lbl: 'g carbs',   color: MC.carbs.color        },
                        { val: r1(perFat),             lbl: 'g fat',     color: MC.fat.color          },
                      ].map((m, idx) => (
                        <View key={idx} style={s.macroCell}>
                          <Text style={[s.macroCellVal, { color: m.color }]}>{m.val}</Text>
                          <Text style={s.macroCellLbl}>{m.lbl}</Text>
                        </View>
                      ))}
                    </View>

                    <Text style={[s.sectionLbl, { marginTop: 16, marginBottom: 8 }]}>
                      Ingredients ({ingredients.length})
                    </Text>
                    {ingredients.map((ing, idx) => (
                      <View key={idx} style={s.reviewIngRow}>
                        <Text style={s.reviewIngName} numberOfLines={1}>{ing.name}</Text>
                        <Text style={s.reviewIngMeta}>
                          ×{ing.qty} · {Math.round(ing.calories * ing.qty)} cal
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>

                <View style={s.stepNavRow}>
                  <TouchableOpacity style={s.backBtn} onPress={() => setStep(2)}>
                    <Text style={s.backBtnTxt}>← Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.primaryBtn, { flex: 1, marginLeft: 8 }, saving && s.primaryBtnDisabled]}
                    onPress={handleSave}
                    disabled={saving}
                  >
                    {saving
                      ? <ActivityIndicator color={colors.accentText} />
                      : <Text style={s.primaryBtnTxt}>Save Recipe</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Ingredient qty picker */}
      <Modal
        visible={!!pendingFood}
        transparent
        animationType="slide"
        onRequestClose={() => setPendingFood(null)}
      >
        <View style={s.sheetBackdrop}>
          <View style={s.sheet}>
            {pendingFood && (
              <>
                <Text style={s.sheetTitle}>Add to Recipe</Text>
                <Text style={s.sheetFood} numberOfLines={2}>{pendingFood.name}</Text>
                {pendingFood.brand && <Text style={s.sheetMeta}>{pendingFood.brand}</Text>}
                <View style={s.sheetMacroRow}>
                  <View style={s.sheetMacroCell}>
                    <Text style={s.sheetMacroVal}>
                      {Math.round(pendingFood.calories * (parseFloat(pendingQty) || 1))}
                    </Text>
                    <Text style={s.sheetMacroLbl}>cal</Text>
                  </View>
                  <View style={s.sheetMacroCell}>
                    <Text style={[s.sheetMacroVal, { color: MC.protein.color }]}>
                      {r1(pendingFood.protein * (parseFloat(pendingQty) || 1))}
                    </Text>
                    <Text style={s.sheetMacroLbl}>g protein</Text>
                  </View>
                  <View style={s.sheetMacroCell}>
                    <Text style={[s.sheetMacroVal, { color: MC.carbs.color }]}>
                      {r1(pendingFood.carbs * (parseFloat(pendingQty) || 1))}
                    </Text>
                    <Text style={s.sheetMacroLbl}>g carbs</Text>
                  </View>
                  <View style={s.sheetMacroCell}>
                    <Text style={[s.sheetMacroVal, { color: MC.fat.color }]}>
                      {r1(pendingFood.fat * (parseFloat(pendingQty) || 1))}
                    </Text>
                    <Text style={s.sheetMacroLbl}>g fat</Text>
                  </View>
                </View>

                <View style={s.qtyRow}>
                  <Text style={s.qtyLabel}>Servings</Text>
                  <TouchableOpacity
                    style={s.qtyBtn}
                    onPress={() => setPendingQty(String(Math.max(0.5, (parseFloat(pendingQty) || 1) - 0.5)))}
                  >
                    <Text style={s.qtyBtnTxt}>−</Text>
                  </TouchableOpacity>
                  <TextInput
                    style={s.qtyInput}
                    keyboardType="decimal-pad"
                    value={pendingQty}
                    onChangeText={setPendingQty}
                  />
                  <TouchableOpacity
                    style={s.qtyBtn}
                    onPress={() => setPendingQty(String((parseFloat(pendingQty) || 1) + 0.5))}
                  >
                    <Text style={s.qtyBtnTxt}>+</Text>
                  </TouchableOpacity>
                </View>

                <View style={s.sheetBtns}>
                  <TouchableOpacity
                    style={[s.sheetBtn, s.sheetBtnGhost]}
                    onPress={() => setPendingFood(null)}
                  >
                    <Text style={s.sheetBtnGhostTxt}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.sheetBtn, s.sheetBtnPrimary]} onPress={addIngredient}>
                    <Text style={s.sheetBtnPrimaryTxt}>Add to Recipe</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
      {paywall}
    </>
  );
}

function r1(n: number) { return Math.round(n * 10) / 10; }

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bgSecondary },
    handle: { width: 36, height: 4, backgroundColor: c.borderStrong, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, marginBottom: spacing.sm },
    title: { fontSize: 22, fontWeight: weight.heavy, color: c.text },
    closeBtn: { backgroundColor: c.cardAlt, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    closeTxt: { color: c.textSecondary, fontSize: 20, lineHeight: 22 },
    stepBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: 4 },
    stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.border },
    stepDotActive: { backgroundColor: c.accent },
    stepLabel: { marginLeft: 8, fontSize: 12, fontWeight: weight.semibold, color: c.textTertiary },
    scroll: { flex: 1, paddingHorizontal: spacing.xl },

    // Step 1
    photoPicker: { height: 160, borderRadius: radius.card, overflow: 'hidden', marginBottom: 20, backgroundColor: c.cardAlt },
    photoPreview: { width: '100%', height: '100%' },
    photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
    photoPlaceholderTxt: { fontSize: 14, fontWeight: weight.bold, color: c.textSecondary },
    label: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    input: { backgroundColor: c.card, borderRadius: radius.md, color: c.text, padding: 14, fontSize: 15, marginBottom: 16, borderWidth: 1, borderColor: c.border },
    stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 24, backgroundColor: c.card, borderRadius: radius.md, padding: 8, borderWidth: 1, borderColor: c.border, alignSelf: 'flex-start' },
    stepperBtn: { backgroundColor: c.cardAlt, width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
    stepperBtnTxt: { color: c.text, fontSize: 20, fontWeight: weight.heavy },
    stepperVal: { fontSize: 22, fontWeight: weight.heavy, color: c.text, minWidth: 32, textAlign: 'center' },

    // Step 2
    ingSection: { backgroundColor: c.card, borderRadius: radius.card, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: c.border },
    sectionLbl: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
    ingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border },
    ingName: { color: c.text, fontWeight: weight.bold, fontSize: 13 },
    ingMeta: { color: c.textTertiary, fontSize: 11, marginTop: 1 },
    ingDelete: { color: c.textTertiary, fontSize: 22, paddingLeft: 8 },
    totalRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.cardAlt, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 12, marginBottom: spacing.md },
    totalText: { fontSize: 12, fontWeight: weight.bold, color: c.text, flex: 1 },
    totalMacro: { fontSize: 11, fontWeight: weight.semibold },
    searchRow: { marginBottom: 8 },
    searchInput: { backgroundColor: c.card, borderRadius: radius.md, color: c.text, padding: 12, fontSize: 15, borderWidth: 1, borderColor: c.border },
    tabs: { flexDirection: 'row', backgroundColor: c.cardAlt, borderRadius: radius.md, padding: 4, marginBottom: 8 },
    tab: { flex: 1, padding: 10, borderRadius: 10, alignItems: 'center' },
    tabActive: { backgroundColor: c.accent },
    tabTxt: { fontSize: 13, fontWeight: weight.bold, color: c.textTertiary },
    tabTxtActive: { color: c.accentText },
    emptyTxt: { color: c.textTertiary, textAlign: 'center', paddingVertical: 24, fontSize: 14, fontWeight: weight.medium },
    foodRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: radius.card, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: c.border },
    foodName: { color: c.text, fontWeight: weight.bold, fontSize: 14, marginBottom: 2 },
    foodMeta: { color: c.textTertiary, fontSize: 11, marginBottom: 4 },
    foodMacros: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    foodCal: { color: c.textSecondary, fontSize: 11, fontWeight: weight.semibold },
    foodAdd: { color: c.accent, fontSize: 22, fontWeight: weight.heavy, paddingHorizontal: 8 },

    stepNavRow: { flexDirection: 'row', paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, paddingTop: 8, gap: 0 },
    backBtn: { backgroundColor: c.cardAlt, borderRadius: radius.md, padding: 14, alignItems: 'center', paddingHorizontal: 20 },
    backBtnTxt: { color: c.text, fontWeight: weight.bold, fontSize: 14 },
    primaryBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 14, alignItems: 'center' },
    primaryBtnDisabled: { opacity: 0.45 },
    primaryBtnTxt: { color: c.accentText, fontSize: 14, fontWeight: weight.heavy },

    // Step 3
    reviewCard: { backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg, borderWidth: 1, borderColor: c.border },
    reviewPhoto: { width: '100%', height: 160, borderRadius: radius.md, marginBottom: 16 },
    reviewName: { fontSize: 22, fontWeight: weight.heavy, color: c.text, marginBottom: 4 },
    reviewServings: { fontSize: 13, color: c.textTertiary, fontWeight: weight.medium, marginBottom: 4 },
    macroGrid: { flexDirection: 'row', gap: 8 },
    macroCell: { flex: 1, backgroundColor: c.cardAlt, borderRadius: radius.md, padding: 10, alignItems: 'center' },
    macroCellVal: { fontSize: 18, fontWeight: weight.heavy, color: c.text },
    macroCellLbl: { fontSize: 10, color: c.textTertiary, fontWeight: weight.semibold, marginTop: 2 },
    reviewIngRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border },
    reviewIngName: { flex: 1, color: c.text, fontWeight: weight.medium, fontSize: 13 },
    reviewIngMeta: { color: c.textTertiary, fontSize: 12, marginLeft: 8 },

    // Ingredient qty sheet
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.card, padding: spacing.xl, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, borderColor: c.border },
    sheetTitle: { fontSize: 12, color: c.textTertiary, fontWeight: weight.semibold, letterSpacing: 1.5, marginBottom: 8, textTransform: 'uppercase' },
    sheetFood: { fontSize: 18, fontWeight: weight.heavy, color: c.text, marginBottom: 4 },
    sheetMeta: { color: c.textTertiary, fontSize: 12, marginBottom: 12 },
    sheetMacroRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.lg },
    sheetMacroCell: { flex: 1, backgroundColor: c.cardAlt, borderRadius: radius.md, padding: 10, alignItems: 'center' },
    sheetMacroVal: { color: c.text, fontSize: 18, fontWeight: weight.heavy },
    sheetMacroLbl: { color: c.textTertiary, fontSize: 10, fontWeight: weight.semibold, marginTop: 2 },
    qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.lg },
    qtyLabel: { flex: 1, color: c.textSecondary, fontWeight: weight.bold, fontSize: 13 },
    qtyBtn: { backgroundColor: c.cardAlt, borderRadius: radius.sm, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    qtyBtnTxt: { color: c.text, fontSize: 18, fontWeight: weight.heavy },
    qtyInput: { backgroundColor: c.cardAlt, borderRadius: radius.sm, width: 72, padding: 8, color: c.text, fontSize: 15, textAlign: 'center', fontWeight: weight.bold },
    sheetBtns: { flexDirection: 'row', gap: 8 },
    sheetBtn: { flex: 1, borderRadius: radius.md, padding: 14, alignItems: 'center' },
    sheetBtnPrimary: { backgroundColor: c.accent },
    sheetBtnPrimaryTxt: { color: c.accentText, fontWeight: weight.heavy, fontSize: 14 },
    sheetBtnGhost: { backgroundColor: c.cardAlt },
    sheetBtnGhostTxt: { color: c.text, fontWeight: weight.bold, fontSize: 14 },
  });
}
