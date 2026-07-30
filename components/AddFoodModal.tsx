import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Modal, Alert, ActivityIndicator, Animated, PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { MEALS, MC } from '../constants/data';
import BarcodeScanner from './BarcodeScanner';
import CreateFoodModal from './CreateFoodModal';
import RecipeBuilderScreen from '../screens/RecipeBuilderScreen';
import { loadRecipes, deleteRecipe as deleteRecipeUtil, Recipe } from '../utils/recipes';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { useAIGate } from '../hooks/useAIGate';

const RECENT_KEY    = 'fuelog_recent_foods';
const FAVORITES_KEY = 'fuelog_favorite_foods';
const SWIPE_WIDTH   = 80;

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQ4NjIsImV4cCI6MjA4NzQwMDg2Mn0.lUng1tY_aAuee_t8-E5MSUHdm2PF3HzsE41L-kzBmJE';

type Food = {
  id?: number;
  name: string;
  serving_size?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source: 'my' | 'usda' | 'barcode';
  brand?: string;
  // micronutrients (optional — only present when source provides them)
  fiber_g?: number | null;
  calcium_mg?: number | null;
  iron_mg?: number | null;
  vitamin_d_mcg?: number | null;
  vitamin_c_mg?: number | null;
  vitamin_b12_mcg?: number | null;
  magnesium_mg?: number | null;
  zinc_mg?: number | null;
  potassium_mg?: number | null;
  omega3_g?: number | null;
};

type RecentFood = Food & { lastQty: number };

type Props = {
  visible: boolean;
  date: string;
  defaultMeal?: string;
  onClose: () => void;
  onOptimisticAdd: (entry: Record<string, any>) => string;
  onLogged: (tempId: string, real: any) => void;
  onLogFailed: (tempId: string, message?: string) => void;
};

function suggestMealForNow(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Breakfast';
  if (h < 15) return 'Lunch';
  if (h < 18) return 'Pre-Workout';
  if (h < 21) return 'Dinner';
  return 'Evening Snack';
}

export default function AddFoodModal({ visible, date, defaultMeal, onClose, onOptimisticAdd, onLogged, onLogFailed }: Props) {
  const { requestAccess, paywall } = useAIGate();
  const { user } = useAuth();
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [meal, setMeal] = useState<string>(defaultMeal || suggestMealForNow());
  const [search, setSearch] = useState('');
  const [myFoods, setMyFoods] = useState<Food[]>([]);
  const [usdaResults, setUsdaResults] = useState<Food[]>([]);
  const [tab, setTab] = useState<'mine' | 'usda' | 'recipes'>('mine');
  const [loadingMine, setLoadingMine] = useState(false);
  const [searchingUSDA, setSearchingUSDA] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [picked, setPicked] = useState<Food | null>(null);
  const [qty, setQty] = useState('1');
  const [logging, setLogging] = useState(false);
  const [recentFoods, setRecentFoods] = useState<RecentFood[]>([]);
  const [favoriteFoods, setFavoriteFoods] = useState<Food[]>([]);

  // New state
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [createFoodVisible, setCreateFoodVisible] = useState(false);
  const [recipeBuilderVisible, setRecipeBuilderVisible] = useState(false);
  const [pickedRecipe, setPickedRecipe] = useState<Recipe | null>(null);
  const [recipeServings, setRecipeServings] = useState('1');

  const loadQuickAdd = useCallback(async () => {
    const [recentRaw, favRaw] = await Promise.all([
      AsyncStorage.getItem(RECENT_KEY),
      AsyncStorage.getItem(FAVORITES_KEY),
    ]);
    setRecentFoods(recentRaw ? JSON.parse(recentRaw) : []);
    setFavoriteFoods(favRaw ? JSON.parse(favRaw) : []);
  }, []);

  const loadMyFoods = useCallback(async () => {
    if (!user) return;
    setLoadingMine(true);
    const { data, error } = await supabase
      .from('user_foods')
      .select('*')
      .eq('user_id', user.id)
      .order('name');
    if (error) console.log('user_foods error:', error.message);
    setMyFoods(((data ?? []) as any[]).map(f => ({ ...f, source: 'my' as const })));
    setLoadingMine(false);
  }, [user]);

  const loadRecipesData = useCallback(async () => {
    if (!user) return;
    const data = await loadRecipes(user.id);
    setRecipes(data);
  }, [user]);

  useEffect(() => {
    if (visible) {
      setMeal(defaultMeal || suggestMealForNow());
      setSearch('');
      setTab('mine');
      setPicked(null);
      setPickedRecipe(null);
      setQty('1');
      setRecipeServings('1');
      setUsdaResults([]);
      void loadQuickAdd();
    }
  }, [visible, defaultMeal, loadQuickAdd]);

  useEffect(() => {
    if (visible) {
      void loadMyFoods();
      void loadRecipesData();
    }
  }, [visible, loadMyFoods, loadRecipesData]);

  const searchUSDA = async () => {
  // Pro gate: consumes one free trial use, then paywalls.
  if (!(await requestAccess('food_text'))) return;
    if (!search.trim()) return;
    setSearchingUSDA(true);
    setTab('usda');
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
          body: JSON.stringify({ query: search.trim() }),
        },
      );
      if (!res.ok) throw new Error(`USDA search failed: ${res.status}`);
      const data = await res.json();
      const foods: Food[] = (data.foods || []).map((f: any) => ({
        name: f.name,
        brand: f.brand,
        serving_size: f.serving_size,
        calories: f.calories || 0,
        protein: f.protein || 0,
        carbs: f.carbs || 0,
        fat: f.fat || 0,
        source: 'usda' as const,
        fiber_g:         f.fiber    > 0 ? f.fiber    : null,
        calcium_mg:      f.calcium  > 0 ? f.calcium  : null,
        iron_mg:         f.iron     > 0 ? f.iron     : null,
        vitamin_d_mcg:   f.vitamin_d > 0 ? f.vitamin_d : null,
        vitamin_c_mg:    f.vitamin_c > 0 ? f.vitamin_c : null,
        vitamin_b12_mcg: f.vitamin_b12 > 0 ? f.vitamin_b12 : null,
        magnesium_mg:    f.magnesium > 0 ? f.magnesium : null,
        zinc_mg:         f.zinc     > 0 ? f.zinc     : null,
        potassium_mg:    f.potassium > 0 ? f.potassium : null,
        omega3_g:        f.omega3   > 0 ? f.omega3   : null,
      }));
      setUsdaResults(foods);
    } catch (e: any) {
      console.log('USDA error:', e?.message);
      Alert.alert('Search failed', 'Could not reach the food database. Please try again.');
    } finally {
      setSearchingUSDA(false);
    }
  };

  const filteredMine = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return myFoods;
    return myFoods.filter(f => f.name.toLowerCase().includes(q));
  }, [myFoods, search]);

  const filteredRecipes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter(r => r.name.toLowerCase().includes(q));
  }, [recipes, search]);

  const list = tab === 'mine' ? filteredMine : usdaResults;

  const onPick = (food: Food) => {
    setPicked(food);
    setQty('1');
  };

  const onBarcodeResult = (r: {
    name: string; brand: string; serving_size: string;
    calories: number; protein: number; carbs: number; fat: number;
    fiber_g?: number | null; calcium_mg?: number | null; iron_mg?: number | null;
    vitamin_d_mcg?: number | null; vitamin_c_mg?: number | null;
    vitamin_b12_mcg?: number | null; magnesium_mg?: number | null;
    zinc_mg?: number | null; potassium_mg?: number | null; omega3_g?: number | null;
  }) => {
    setScannerOpen(false);
    setPicked({ ...r, source: 'barcode' });
    setQty('1');
  };

  const toggleFavorite = async (food: Food) => {
    const isFav = favoriteFoods.some(f => f.name === food.name);
    const updated = isFav
      ? favoriteFoods.filter(f => f.name !== food.name)
      : [food, ...favoriteFoods];
    setFavoriteFoods(updated);
    await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
  };

  const deleteMyFood = useCallback((food: Food, close: () => void) => {
    Alert.alert(
      'Remove Food',
      `Remove "${food.name}" from your foods?`,
      [
        { text: 'Cancel', style: 'cancel', onPress: close },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            close();
            if (!food.id) return;
            await supabase.from('user_foods').delete().eq('id', food.id);
            setMyFoods(prev => prev.filter(f => f.id !== food.id));
            // Sync favorites
            const updatedFavs = favoriteFoods.filter(f => f.id !== food.id);
            if (updatedFavs.length !== favoriteFoods.length) {
              setFavoriteFoods(updatedFavs);
              await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(updatedFavs));
            }
          },
        },
      ],
    );
  }, [favoriteFoods]);

  const deleteRecipeItem = useCallback((recipe: Recipe) => {
    Alert.alert(
      'Delete Recipe',
      `Delete "${recipe.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!user) return;
            await deleteRecipeUtil(user.id, recipe.id);
            setRecipes(prev => prev.filter(r => r.id !== recipe.id));
          },
        },
      ],
    );
  }, [user]);

  const log = async () => {
    if (!picked || !user) return;
    const q = parseFloat(qty);
    if (!Number.isFinite(q) || q <= 0) {
      Alert.alert('Quantity', 'Enter a quantity greater than 0.');
      return;
    }
    setLogging(true);
    try {
      const scaleMicro = (v: number | null | undefined) =>
        v != null && v > 0 ? Math.round(v * q * 100) / 100 : null;

      const entry: Record<string, any> = {
        user_id: user.id,
        date,
        meal,
        food: picked.name,
        qty: q,
        calories: Math.round(picked.calories * q),
        protein: Math.round(picked.protein * q * 10) / 10,
        carbs: Math.round(picked.carbs * q * 10) / 10,
        fat: Math.round(picked.fat * q * 10) / 10,
        fiber_g:         scaleMicro(picked.fiber_g),
        calcium_mg:      scaleMicro(picked.calcium_mg),
        iron_mg:         scaleMicro(picked.iron_mg),
        vitamin_d_mcg:   scaleMicro(picked.vitamin_d_mcg),
        vitamin_c_mg:    scaleMicro(picked.vitamin_c_mg),
        vitamin_b12_mcg: scaleMicro(picked.vitamin_b12_mcg),
        magnesium_mg:    scaleMicro(picked.magnesium_mg),
        zinc_mg:         scaleMicro(picked.zinc_mg),
        potassium_mg:    scaleMicro(picked.potassium_mg),
        omega3_g:        scaleMicro(picked.omega3_g),
      };

      const tempId = onOptimisticAdd(entry);
      onClose();

      const { data, error } = await supabase.from('macro_logs').insert(entry).select().single();
      if (error) { onLogFailed(tempId, error.message); return; }

      if (picked.source !== 'my') {
        await supabase.from('user_foods').insert({
          user_id: user.id,
          name: picked.name,
          serving_size: picked.serving_size || '',
          calories: picked.calories,
          protein: picked.protein,
          carbs: picked.carbs,
          fat: picked.fat,
          fiber: picked.fiber_g ?? null,
        }).then(() => {}, () => {});
      }

      const dedupe = recentFoods.filter(r => r.name !== picked.name);
      const updatedRecent: RecentFood[] = [{ ...picked, lastQty: q }, ...dedupe].slice(0, 10);
      setRecentFoods(updatedRecent);
      await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updatedRecent));

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onLogged(tempId, data);
    } finally {
      setLogging(false);
    }
  };

  const logRecipe = async () => {
    if (!pickedRecipe || !user) return;
    const s = parseFloat(recipeServings);
    if (!Number.isFinite(s) || s <= 0) {
      Alert.alert('Servings', 'Enter a valid number of servings.');
      return;
    }
    setLogging(true);
    try {
      const entry = {
        user_id: user.id,
        date,
        meal,
        food: pickedRecipe.name,
        qty: s,
        calories: Math.round(pickedRecipe.per_serving_calories * s),
        protein: Math.round(pickedRecipe.per_serving_protein * s * 10) / 10,
        carbs: Math.round(pickedRecipe.per_serving_carbs * s * 10) / 10,
        fat: Math.round(pickedRecipe.per_serving_fat * s * 10) / 10,
      };

      const tempId = onOptimisticAdd(entry);
      onClose();

      const { data, error } = await supabase.from('macro_logs').insert(entry).select().single();
      if (error) { onLogFailed(tempId, error.message); return; }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onLogged(tempId, data);
    } finally {
      setLogging(false);
    }
  };

  return (
    <>
      <Modal
        visible={visible && !scannerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onClose}
      >
        <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
          <View style={s.header}>
            <Text style={s.title}>Log Food</Text>
            <TouchableOpacity onPress={onClose} style={s.close}>
              <Text style={s.closeText}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.mealRow}>
            {MEALS.map(m => (
              <TouchableOpacity
                key={m}
                style={[s.mealChip, m === meal && s.mealChipActive]}
                onPress={() => setMeal(m)}
              >
                <Text style={[s.mealChipText, m === meal && s.mealChipTextActive]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {favoriteFoods.length > 0 && (
            <View style={s.quickSection}>
              <Text style={s.quickLabel}>Favorites</Text>
              {favoriteFoods.map((f, i) => (
                <TouchableOpacity key={`fav-${i}`} style={s.foodRow} onPress={() => onPick(f)} activeOpacity={0.7}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.foodName} numberOfLines={1}>{f.name}</Text>
                    {f.brand ? <Text style={s.foodMeta} numberOfLines={1}>{f.brand}</Text> : null}
                    <View style={s.foodMacros}>
                      <Text style={s.foodCal}>{Math.round(f.calories)} cal</Text>
                      <Text style={{ color: MC.protein.color, fontSize: 11, fontWeight: '600' }}>P {f.protein}g</Text>
                      <Text style={{ color: MC.carbs.color, fontSize: 11, fontWeight: '600' }}>C {f.carbs}g</Text>
                      <Text style={{ color: MC.fat.color, fontSize: 11, fontWeight: '600' }}>F {f.fat}g</Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => toggleFavorite(f)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={s.starActive}></Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {favoriteFoods.length === 0 && !search && (
            <Text style={s.quickEmpty}>Tap on any food to save it here</Text>
          )}

          {recentFoods.length > 0 && (
            <View style={s.quickSection}>
              <Text style={s.quickLabel}>Recently Logged</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.recentRow}>
                {recentFoods.map((f, i) => (
                  <TouchableOpacity
                    key={`recent-${i}`}
                    style={s.recentChip}
                    onPress={() => { setPicked(f); setQty(String(f.lastQty)); }}
                    activeOpacity={0.7}
                  >
                    <Text style={s.recentChipName} numberOfLines={1}>{f.name}</Text>
                    <Text style={s.recentChipCal}>{Math.round(f.calories * f.lastQty)} cal</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={s.searchRow}>
            <TextInput
              style={s.search}
              value={search}
              onChangeText={setSearch}
              placeholder="Search foods…"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="search"
              onSubmitEditing={searchUSDA}
              clearButtonMode="while-editing"
            />
            <TouchableOpacity style={s.scanBtn} onPress={() => setScannerOpen(true)}>
              <Text style={s.scanBtnText}></Text>
            </TouchableOpacity>
          </View>

          {/* Quick action buttons */}
          <View style={s.actionRow}>
            <TouchableOpacity style={s.actionBtn} onPress={() => setCreateFoodVisible(true)}>
              <Text style={s.actionBtnText}>＋ Create Food</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, s.actionBtnSecondary]} onPress={() => setRecipeBuilderVisible(true)}>
              <Text style={[s.actionBtnText, { color: colors.text }]}>New Recipe</Text>
            </TouchableOpacity>
          </View>

          <View style={s.tabs}>
            <TouchableOpacity
              style={[s.tab, tab === 'mine' && s.tabActive]}
              onPress={() => setTab('mine')}
            >
              <Text style={[s.tabText, tab === 'mine' && s.tabTextActive]}>My Foods</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.tab, tab === 'recipes' && s.tabActive]}
              onPress={() => setTab('recipes')}
            >
              <Text style={[s.tabText, tab === 'recipes' && s.tabTextActive]}>Recipes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.tab, tab === 'usda' && s.tabActive]}
              onPress={searchUSDA}
            >
              <Text style={[s.tabText, tab === 'usda' && s.tabTextActive]}>
                {searchingUSDA ? '…' : 'Search USDA'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={s.list} contentContainerStyle={{ paddingBottom: 24 }}>

            {/* ── My Foods tab ── */}
            {tab === 'mine' && (
              <>
                {loadingMine
                  ? <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} />
                  : null}
                {!loadingMine && filteredMine.length === 0 ? (
                  <Text style={s.empty}>
                    {search
                      ? 'No matches. Try "Search USDA" or "＋ Create Food".'
                      : 'No custom foods yet. Tap "＋ Create Food" or "Search USDA".'}
                  </Text>
                ) : null}
                {filteredMine.map((f, i) => {
                  const isFav = favoriteFoods.some(fav => fav.name === f.name);
                  return (
                    <SwipeableRow key={`mine-${f.id ?? i}`} onDelete={close => deleteMyFood(f, close)}>
                      <TouchableOpacity style={s.foodRow} onPress={() => onPick(f)} activeOpacity={0.7}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={s.foodName} numberOfLines={1}>{f.name}</Text>
                            <View style={s.customBadge}>
                              <Text style={s.customBadgeText}>Custom</Text>
                            </View>
                          </View>
                          {f.brand || f.serving_size ? (
                            <Text style={s.foodMeta} numberOfLines={1}>
                              {[f.brand, f.serving_size].filter(Boolean).join(' · ')}
                            </Text>
                          ) : null}
                          <View style={s.foodMacros}>
                            <Text style={s.foodCal}>{Math.round(f.calories)} cal</Text>
                            <Text style={{ color: MC.protein.color, fontSize: 11, fontWeight: '600' }}>P {f.protein}g</Text>
                            <Text style={{ color: MC.carbs.color, fontSize: 11, fontWeight: '600' }}>C {f.carbs}g</Text>
                            <Text style={{ color: MC.fat.color, fontSize: 11, fontWeight: '600' }}>F {f.fat}g</Text>
                          </View>
                        </View>
                        <TouchableOpacity onPress={() => toggleFavorite(f)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={isFav ? s.starActive : s.starInactive}>{isFav ? '' : ''}</Text>
                        </TouchableOpacity>
                        <Text style={s.foodAdd}>+</Text>
                      </TouchableOpacity>
                    </SwipeableRow>
                  );
                })}
              </>
            )}

            {/* ── Recipes tab ── */}
            {tab === 'recipes' && (
              <>
                {filteredRecipes.length === 0 ? (
                  <Text style={s.empty}>
                    {search
                      ? 'No matching recipes.'
                      : 'No recipes yet. Tap "New Recipe" to build one.'}
                  </Text>
                ) : null}
                {filteredRecipes.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={s.foodRow}
                    onPress={() => { setPickedRecipe(r); setRecipeServings('1'); }}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.foodName} numberOfLines={1}>{r.name}</Text>
                      <Text style={s.foodMeta}>
                        {r.servings} serving{r.servings !== 1 ? 's' : ''}
                      </Text>
                      <View style={s.foodMacros}>
                        <Text style={s.foodCal}>{Math.round(r.per_serving_calories)} cal/serving</Text>
                        <Text style={{ color: MC.protein.color, fontSize: 11, fontWeight: '600' }}>P {r.per_serving_protein}g</Text>
                        <Text style={{ color: MC.carbs.color, fontSize: 11, fontWeight: '600' }}>C {r.per_serving_carbs}g</Text>
                        <Text style={{ color: MC.fat.color, fontSize: 11, fontWeight: '600' }}>F {r.per_serving_fat}g</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => deleteRecipeItem(r)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[s.starInactive, { fontSize: 16, paddingHorizontal: 6 }]}></Text>
                    </TouchableOpacity>
                    <Text style={s.foodAdd}>+</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* ── USDA tab ── */}
            {tab === 'usda' && (
              <>
                {searchingUSDA ? <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} /> : null}
                {!searchingUSDA && list.length === 0 ? (
                  <Text style={s.empty}>
                    {search ? 'No USDA results.' : 'Type a food name and tap "Search USDA".'}
                  </Text>
                ) : null}
                {list.map((f, i) => {
                  const isFav = favoriteFoods.some(fav => fav.name === f.name);
                  return (
                    <TouchableOpacity
                      key={`usda-${i}-${f.name}`}
                      style={s.foodRow}
                      onPress={() => onPick(f)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.foodName} numberOfLines={1}>{f.name}</Text>
                        {f.brand || f.serving_size ? (
                          <Text style={s.foodMeta} numberOfLines={1}>
                            {[f.brand, f.serving_size].filter(Boolean).join(' · ')}
                          </Text>
                        ) : null}
                        <View style={s.foodMacros}>
                          <Text style={s.foodCal}>{Math.round(f.calories)} cal</Text>
                          <Text style={{ color: MC.protein.color, fontSize: 11, fontWeight: '600' }}>P {f.protein}g</Text>
                          <Text style={{ color: MC.carbs.color, fontSize: 11, fontWeight: '600' }}>C {f.carbs}g</Text>
                          <Text style={{ color: MC.fat.color, fontSize: 11, fontWeight: '600' }}>F {f.fat}g</Text>
                        </View>
                      </View>
                      <TouchableOpacity onPress={() => toggleFavorite(f)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={isFav ? s.starActive : s.starInactive}>{isFav ? '' : ''}</Text>
                      </TouchableOpacity>
                      <Text style={s.foodAdd}>+</Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}

          </ScrollView>

          {/* Food logging sheet */}
          <Modal visible={!!picked} animationType="slide" transparent onRequestClose={() => setPicked(null)}>
            <View style={s.sheetBackdrop}>
              <View style={s.sheet}>
                <Text style={s.sheetTitle}>Log to {meal}</Text>
                {picked && (
                  <>
                    <Text style={s.sheetFood} numberOfLines={2}>{picked.name}</Text>
                    {picked.brand ? <Text style={s.sheetMeta}>{picked.brand}</Text> : null}
                    <View style={s.sheetMacroRow}>
                      <View style={s.sheetMacroCell}><Text style={s.sheetMacroVal}>{Math.round(picked.calories * (parseFloat(qty) || 1))}</Text><Text style={s.sheetMacroLabel}>cal</Text></View>
                      <View style={s.sheetMacroCell}><Text style={[s.sheetMacroVal, { color: MC.protein.color }]}>{round1(picked.protein * (parseFloat(qty) || 1))}</Text><Text style={s.sheetMacroLabel}>g protein</Text></View>
                      <View style={s.sheetMacroCell}><Text style={[s.sheetMacroVal, { color: MC.carbs.color }]}>{round1(picked.carbs * (parseFloat(qty) || 1))}</Text><Text style={s.sheetMacroLabel}>g carbs</Text></View>
                      <View style={s.sheetMacroCell}><Text style={[s.sheetMacroVal, { color: MC.fat.color }]}>{round1(picked.fat * (parseFloat(qty) || 1))}</Text><Text style={s.sheetMacroLabel}>g fat</Text></View>
                    </View>
                    <View style={s.qtyRow}>
                      <Text style={s.qtyLabel}>Servings</Text>
                      <TouchableOpacity style={s.qtyBtn} onPress={() => setQty(String(Math.max(0.5, (parseFloat(qty) || 1) - 0.5)))}>
                        <Text style={s.qtyBtnText}>−</Text>
                      </TouchableOpacity>
                      <TextInput style={s.qtyInput} keyboardType="decimal-pad" value={qty} onChangeText={setQty} />
                      <TouchableOpacity style={s.qtyBtn} onPress={() => setQty(String((parseFloat(qty) || 1) + 0.5))}>
                        <Text style={s.qtyBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={s.sheetButtons}>
                      <TouchableOpacity style={[s.sheetBtn, s.sheetBtnGhost]} onPress={() => setPicked(null)}>
                        <Text style={s.sheetBtnGhostText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.sheetBtn, s.sheetBtnPrimary]} onPress={log} disabled={logging}>
                        {logging ? <ActivityIndicator color={colors.accentText} /> : <Text style={s.sheetBtnPrimaryText}>Log it</Text>}
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            </View>
          </Modal>

          {/* Recipe logging sheet */}
          <Modal visible={!!pickedRecipe} animationType="slide" transparent onRequestClose={() => setPickedRecipe(null)}>
            <View style={s.sheetBackdrop}>
              <View style={s.sheet}>
                <Text style={s.sheetTitle}>Log to {meal}</Text>
                {pickedRecipe && (
                  <>
                    <Text style={s.sheetFood} numberOfLines={2}>{pickedRecipe.name}</Text>
                    <Text style={s.sheetMeta}>
                      Recipe · {pickedRecipe.servings} serving{pickedRecipe.servings !== 1 ? 's' : ''}
                    </Text>
                    <View style={s.sheetMacroRow}>
                      <View style={s.sheetMacroCell}>
                        <Text style={s.sheetMacroVal}>{Math.round(pickedRecipe.per_serving_calories * (parseFloat(recipeServings) || 1))}</Text>
                        <Text style={s.sheetMacroLabel}>cal</Text>
                      </View>
                      <View style={s.sheetMacroCell}>
                        <Text style={[s.sheetMacroVal, { color: MC.protein.color }]}>{round1(pickedRecipe.per_serving_protein * (parseFloat(recipeServings) || 1))}</Text>
                        <Text style={s.sheetMacroLabel}>g protein</Text>
                      </View>
                      <View style={s.sheetMacroCell}>
                        <Text style={[s.sheetMacroVal, { color: MC.carbs.color }]}>{round1(pickedRecipe.per_serving_carbs * (parseFloat(recipeServings) || 1))}</Text>
                        <Text style={s.sheetMacroLabel}>g carbs</Text>
                      </View>
                      <View style={s.sheetMacroCell}>
                        <Text style={[s.sheetMacroVal, { color: MC.fat.color }]}>{round1(pickedRecipe.per_serving_fat * (parseFloat(recipeServings) || 1))}</Text>
                        <Text style={s.sheetMacroLabel}>g fat</Text>
                      </View>
                    </View>
                    <View style={s.qtyRow}>
                      <Text style={s.qtyLabel}>How many servings?</Text>
                      <TouchableOpacity style={s.qtyBtn} onPress={() => setRecipeServings(String(Math.max(0.5, (parseFloat(recipeServings) || 1) - 0.5)))}>
                        <Text style={s.qtyBtnText}>−</Text>
                      </TouchableOpacity>
                      <TextInput style={s.qtyInput} keyboardType="decimal-pad" value={recipeServings} onChangeText={setRecipeServings} />
                      <TouchableOpacity style={s.qtyBtn} onPress={() => setRecipeServings(String((parseFloat(recipeServings) || 1) + 0.5))}>
                        <Text style={s.qtyBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={s.sheetButtons}>
                      <TouchableOpacity style={[s.sheetBtn, s.sheetBtnGhost]} onPress={() => setPickedRecipe(null)}>
                        <Text style={s.sheetBtnGhostText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.sheetBtn, s.sheetBtnPrimary]} onPress={logRecipe} disabled={logging}>
                        {logging ? <ActivityIndicator color={colors.accentText} /> : <Text style={s.sheetBtnPrimaryText}>Log it</Text>}
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            </View>
          </Modal>

        </SafeAreaView>
      </Modal>

      <BarcodeScanner
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onResult={onBarcodeResult}
      />

      <CreateFoodModal
        visible={createFoodVisible}
        onClose={() => setCreateFoodVisible(false)}
        onSaved={() => { void loadMyFoods(); }}
      />

      <RecipeBuilderScreen
        visible={recipeBuilderVisible}
        onClose={() => setRecipeBuilderVisible(false)}
        onSaved={recipe => {
          setRecipes(prev => [recipe, ...prev]);
          setRecipeBuilderVisible(false);
          setTab('recipes');
        }}
      />
      {paywall}
    </>
  );
}

// ──────────────── SwipeableRow ────────────────

function SwipeableRow({
  onDelete,
  children,
}: {
  onDelete: (close: () => void) => void;
  children: React.ReactNode;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const close = useCallback(() => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    isOpen.current = false;
  }, [translateX]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const base = isOpen.current ? -SWIPE_WIDTH : 0;
        translateX.setValue(Math.max(-SWIPE_WIDTH, Math.min(0, base + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        if (!isOpen.current && g.dx < -(SWIPE_WIDTH / 2)) {
          Animated.spring(translateX, { toValue: -SWIPE_WIDTH, useNativeDriver: true }).start();
          isOpen.current = true;
        } else if (isOpen.current && g.dx > SWIPE_WIDTH / 2) {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          isOpen.current = false;
        } else if (!isOpen.current) {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        } else {
          Animated.spring(translateX, { toValue: -SWIPE_WIDTH, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  return (
    <View style={{ overflow: 'hidden', marginBottom: 6, borderRadius: 12 }}>
      <View
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          width: SWIPE_WIDTH, backgroundColor: '#FF3B30',
          alignItems: 'center', justifyContent: 'center', borderRadius: 12,
        }}
      >
        <TouchableOpacity
          onPress={() => onDelete(close)}
          style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

function round1(n: number) { return Math.round(n * 10) / 10; }

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.md },
    title: { fontSize: 22, fontWeight: weight.heavy, color: c.text },
    close: { backgroundColor: c.cardAlt, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: c.textSecondary, fontSize: 22, lineHeight: 22 },
    mealRow: { paddingHorizontal: spacing.lg, paddingBottom: 10, gap: 8 },
    mealChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: c.card, marginRight: 8, borderWidth: 1, borderColor: c.border },
    mealChipActive: { backgroundColor: c.accent, borderColor: c.accent },
    mealChipText: { color: c.textSecondary, fontWeight: weight.bold, fontSize: 12 },
    mealChipTextActive: { color: c.accentText },
    searchRow: { flexDirection: 'row', gap: 8, paddingHorizontal: spacing.lg, paddingBottom: 8 },
    search: { flex: 1, backgroundColor: c.card, borderRadius: radius.md, color: c.text, padding: 12, fontSize: 15, borderWidth: 1, borderColor: c.border },
    scanBtn: { backgroundColor: c.card, borderRadius: radius.md, width: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
    scanBtnText: { fontSize: 20 },
    actionRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, paddingBottom: 8, gap: 8 },
    actionBtn: { backgroundColor: c.accent, borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: 14 },
    actionBtnSecondary: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    actionBtnText: { color: c.accentText, fontSize: 12, fontWeight: weight.bold },
    tabs: { flexDirection: 'row', marginHorizontal: spacing.lg, backgroundColor: c.cardAlt, borderRadius: radius.md, padding: 4, marginBottom: 8 },
    tab: { flex: 1, padding: 8, borderRadius: 10, alignItems: 'center' },
    tabActive: { backgroundColor: c.accent },
    tabText: { fontSize: 12, fontWeight: weight.bold, color: c.textTertiary },
    tabTextActive: { color: c.accentText },
    list: { flex: 1, paddingHorizontal: spacing.lg },
    empty: { color: c.textTertiary, textAlign: 'center', paddingVertical: 32, lineHeight: 22, fontSize: 14, fontWeight: weight.medium },
    foodRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: radius.card, padding: 12, borderWidth: 1, borderColor: c.border },
    foodName: { color: c.text, fontWeight: weight.bold, fontSize: 14, marginBottom: 2 },
    foodMeta: { color: c.textTertiary, fontSize: 11, marginBottom: 4 },
    foodMacros: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    foodCal: { color: c.textSecondary, fontSize: 11, fontWeight: weight.semibold },
    foodAdd: { color: c.accent, fontSize: 22, fontWeight: weight.heavy, paddingHorizontal: 8 },
    customBadge: { backgroundColor: c.accentMuted, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
    customBadgeText: { color: c.accent, fontSize: 9, fontWeight: weight.bold, letterSpacing: 0.3 },
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.card, padding: spacing.xl, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, borderColor: c.border },
    sheetTitle: { fontSize: 12, color: c.textTertiary, fontWeight: weight.semibold, letterSpacing: 1.5, marginBottom: 8, textTransform: 'uppercase' },
    sheetFood: { fontSize: 18, fontWeight: weight.heavy, color: c.text, marginBottom: 4 },
    sheetMeta: { color: c.textTertiary, fontSize: 12, marginBottom: 12 },
    sheetMacroRow: { flexDirection: 'row', gap: 12, marginBottom: spacing.lg },
    sheetMacroCell: { flex: 1, backgroundColor: c.cardAlt, borderRadius: radius.md, padding: 10, alignItems: 'center' },
    sheetMacroVal: { color: c.text, fontSize: 18, fontWeight: weight.heavy },
    sheetMacroLabel: { color: c.textTertiary, fontSize: 10, fontWeight: weight.semibold, marginTop: 2 },
    qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.lg },
    qtyLabel: { flex: 1, color: c.textSecondary, fontWeight: weight.bold, fontSize: 13 },
    qtyBtn: { backgroundColor: c.cardAlt, borderRadius: radius.sm, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    qtyBtnText: { color: c.text, fontSize: 18, fontWeight: weight.heavy },
    qtyInput: { backgroundColor: c.cardAlt, borderRadius: radius.sm, width: 72, padding: 8, color: c.text, fontSize: 15, textAlign: 'center', fontWeight: weight.bold },
    sheetButtons: { flexDirection: 'row', gap: 8 },
    sheetBtn: { flex: 1, borderRadius: radius.md, padding: 14, alignItems: 'center' },
    sheetBtnPrimary: { backgroundColor: c.accent },
    sheetBtnPrimaryText: { color: c.accentText, fontWeight: weight.heavy, fontSize: 14 },
    sheetBtnGhost: { backgroundColor: c.cardAlt },
    sheetBtnGhostText: { color: c.text, fontWeight: weight.bold, fontSize: 14 },
    quickSection: { paddingHorizontal: spacing.lg, paddingBottom: 8 },
    quickLabel: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' },
    quickEmpty: { color: c.textTertiary, fontSize: 12, fontWeight: weight.medium, paddingHorizontal: spacing.lg, paddingBottom: 10, fontStyle: 'italic' },
    recentRow: { paddingRight: 16, gap: 8 },
    recentChip: { backgroundColor: c.card, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 140, borderWidth: 1, borderColor: c.border },
    recentChipName: { fontSize: 12, fontWeight: weight.bold, color: c.text, marginBottom: 1 },
    recentChipCal: { fontSize: 10, color: c.textSecondary, fontWeight: weight.semibold },
    starActive: { color: '#F5A623', fontSize: 18, paddingHorizontal: 6 },
    starInactive: { color: c.textTertiary, fontSize: 18, paddingHorizontal: 6 },
  });
}
