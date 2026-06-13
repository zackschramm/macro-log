import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Modal, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { MEALS, MC } from '../constants/data';
import BarcodeScanner from './BarcodeScanner';

// Re-uses the existing public Supabase anon key. Same one as constants/supabase.ts
// (kept inline to avoid a circular dep; rotate via that file when it changes).
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
};

type Props = {
  visible: boolean;
  date: string;                  // YYYY-MM-DD
  defaultMeal?: string;
  onClose: () => void;
  onLogged: () => void;          // refetch hook for parent
};

function suggestMealForNow(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Breakfast';
  if (h < 15) return 'Lunch';
  if (h < 18) return 'Pre-Workout';
  if (h < 21) return 'Dinner';
  return 'Evening Snack';
}

export default function AddFoodModal({ visible, date, defaultMeal, onClose, onLogged }: Props) {
  const { user } = useAuth();
  const [meal, setMeal] = useState<string>(defaultMeal || suggestMealForNow());
  const [search, setSearch] = useState('');
  const [myFoods, setMyFoods] = useState<Food[]>([]);
  const [usdaResults, setUsdaResults] = useState<Food[]>([]);
  const [tab, setTab] = useState<'mine' | 'usda'>('mine');
  const [loadingMine, setLoadingMine] = useState(false);
  const [searchingUSDA, setSearchingUSDA] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [picked, setPicked] = useState<Food | null>(null);
  const [qty, setQty] = useState('1');
  const [logging, setLogging] = useState(false);

  useEffect(() => {
    if (visible) {
      setMeal(defaultMeal || suggestMealForNow());
      setSearch('');
      setTab('mine');
      setPicked(null);
      setQty('1');
      setUsdaResults([]);
    }
  }, [visible, defaultMeal]);

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

  useEffect(() => { if (visible) void loadMyFoods(); }, [visible, loadMyFoods]);

  const searchUSDA = async () => {
    if (!search.trim()) return;
    setSearchingUSDA(true);
    setTab('usda');
    try {
      const res = await fetch('https://zbcxuffgmjuqarapfdwb.supabase.co/functions/v1/ai-proxy/food-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ query: search.trim() }),
      });
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
        source: 'usda',
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

  const list = tab === 'mine' ? filteredMine : usdaResults;

  const onPick = (food: Food) => {
    setPicked(food);
    setQty('1');
  };

  const onBarcodeResult = (r: { name: string; brand: string; serving_size: string; calories: number; protein: number; carbs: number; fat: number }) => {
    setScannerOpen(false);
    setPicked({ ...r, source: 'barcode' });
    setQty('1');
  };

  const log = async () => {
    if (!picked || !user) return;
    const q = parseFloat(qty);
    if (!Number.isFinite(q) || q <= 0) {
      Alert.alert('Quantity', 'Enter a quantity greater than 0.');
      return;
    }
    setLogging(true);
    try {
      const entry = {
        user_id: user.id,
        date,
        meal,
        food: picked.name,
        qty: q,
        calories: Math.round(picked.calories * q),
        protein: Math.round(picked.protein * q * 10) / 10,
        carbs: Math.round(picked.carbs * q * 10) / 10,
        fat: Math.round(picked.fat * q * 10) / 10,
      };
      const { error } = await supabase.from('macro_logs').insert(entry);
      if (error) { Alert.alert('Could not log', error.message); return; }

      // If logged from USDA or barcode, optionally save to My Foods for next time
      if (picked.source !== 'my') {
        await supabase.from('user_foods').insert({
          user_id: user.id,
          name: picked.name,
          serving_size: picked.serving_size || '',
          calories: picked.calories,
          protein: picked.protein,
          carbs: picked.carbs,
          fat: picked.fat,
        }).then(() => {}, () => {});  // best-effort; don't block on conflicts
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onLogged();
      onClose();
    } finally {
      setLogging(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.safe} edges={['top','bottom']}>
        <View style={s.header}>
          <Text style={s.title}>Log Food</Text>
          <TouchableOpacity onPress={onClose} style={s.close}><Text style={s.closeText}>×</Text></TouchableOpacity>
        </View>

        {/* Meal selector */}
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

        {/* Search */}
        <View style={s.searchRow}>
          <TextInput
            style={s.search}
            value={search}
            onChangeText={setSearch}
            placeholder="Search foods…"
            placeholderTextColor="#444"
            returnKeyType="search"
            onSubmitEditing={searchUSDA}
            clearButtonMode="while-editing"
          />
          <TouchableOpacity style={s.scanBtn} onPress={() => setScannerOpen(true)}>
            <Text style={s.scanBtnText}>📷</Text>
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={s.tabs}>
          <TouchableOpacity style={[s.tab, tab === 'mine' && s.tabActive]} onPress={() => setTab('mine')}>
            <Text style={[s.tabText, tab === 'mine' && s.tabTextActive]}>My Foods</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tab, tab === 'usda' && s.tabActive]} onPress={searchUSDA}>
            <Text style={[s.tabText, tab === 'usda' && s.tabTextActive]}>
              {searchingUSDA ? '…searching' : 'Search USDA'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.list} contentContainerStyle={{ paddingBottom: 24 }}>
          {loadingMine && tab === 'mine' ? <ActivityIndicator color="#fff" style={{ marginTop: 16 }} /> : null}
          {!loadingMine && list.length === 0 ? (
            <Text style={s.empty}>
              {tab === 'mine'
                ? (search ? 'No matches in your foods. Try “Search USDA”.' : 'No saved foods yet.\nSearch USDA or scan a barcode to start.')
                : (search ? 'No USDA results.' : 'Type a food name and tap “Search USDA”.')}
            </Text>
          ) : null}
          {list.map((f, i) => (
            <TouchableOpacity key={`${f.source}-${f.id ?? i}-${f.name}`} style={s.foodRow} onPress={() => onPick(f)} activeOpacity={0.7}>
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
              <Text style={s.foodAdd}>+</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Pick → confirm sheet */}
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
                      {logging ? <ActivityIndicator color="#000" /> : <Text style={s.sheetBtnPrimaryText}>Log it</Text>}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>

        <BarcodeScanner
          visible={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onResult={onBarcodeResult}
        />
      </SafeAreaView>
    </Modal>
  );
}

function round1(n: number) { return Math.round(n * 10) / 10; }

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0d0d2b' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '900', color: '#fff' },
  close: { backgroundColor: '#252525', width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#888', fontSize: 22, lineHeight: 22 },
  mealRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  mealChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#1a1a1a', marginRight: 8 },
  mealChipActive: { backgroundColor: '#fff' },
  mealChipText: { color: '#888', fontWeight: '700', fontSize: 12 },
  mealChipTextActive: { color: '#000' },
  searchRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  search: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, color: '#fff', padding: 12, fontSize: 15 },
  scanBtn: { backgroundColor: '#1a1a1a', borderRadius: 12, width: 48, alignItems: 'center', justifyContent: 'center' },
  scanBtnText: { fontSize: 20 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 4, marginBottom: 8 },
  tab: { flex: 1, padding: 10, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: '#fff' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#555' },
  tabTextActive: { color: '#000' },
  list: { flex: 1, paddingHorizontal: 16 },
  empty: { color: '#444', textAlign: 'center', paddingVertical: 32, lineHeight: 22, fontSize: 14, fontWeight: '500' },
  foodRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, marginBottom: 6 },
  foodName: { color: '#fff', fontWeight: '700', fontSize: 14, marginBottom: 2 },
  foodMeta: { color: '#666', fontSize: 11, marginBottom: 4 },
  foodMacros: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  foodCal: { color: '#888', fontSize: 11, fontWeight: '600' },
  foodAdd: { color: '#fff', fontSize: 22, fontWeight: '900', paddingHorizontal: 8 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1a1a1a', padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sheetTitle: { fontSize: 12, color: '#555', fontWeight: '700', letterSpacing: 1.5, marginBottom: 8 },
  sheetFood: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 4 },
  sheetMeta: { color: '#666', fontSize: 12, marginBottom: 12 },
  sheetMacroRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  sheetMacroCell: { flex: 1, backgroundColor: '#252525', borderRadius: 10, padding: 10, alignItems: 'center' },
  sheetMacroVal: { color: '#fff', fontSize: 18, fontWeight: '900' },
  sheetMacroLabel: { color: '#555', fontSize: 10, fontWeight: '600', marginTop: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  qtyLabel: { flex: 1, color: '#888', fontWeight: '700', fontSize: 13 },
  qtyBtn: { backgroundColor: '#252525', borderRadius: 8, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  qtyInput: { backgroundColor: '#252525', borderRadius: 8, width: 72, padding: 8, color: '#fff', fontSize: 15, textAlign: 'center', fontWeight: '700' },
  sheetButtons: { flexDirection: 'row', gap: 8 },
  sheetBtn: { flex: 1, borderRadius: 12, padding: 14, alignItems: 'center' },
  sheetBtnPrimary: { backgroundColor: '#fff' },
  sheetBtnPrimaryText: { color: '#000', fontWeight: '900', fontSize: 14 },
  sheetBtnGhost: { backgroundColor: '#252525' },
  sheetBtnGhostText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
