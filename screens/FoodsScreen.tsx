import React, { useState, useEffect, useCallback } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Modal, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { supabase } from '../constants/supabase';
import { aiProxyHeaders } from '../constants/ai';
import BarcodeScanner from '../components/BarcodeScanner';
import { useAuth } from '../hooks/useAuth';
import { MC } from '../constants/data';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { useAIGate } from '../hooks/useAIGate';
import { logError } from '../utils/logError';

interface Food {
  id: number;
  name: string;
  serving_size: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  image_url?: string;
}

const EMPTY_FORM = { name: '', serving_size: '', calories: '', protein: '', carbs: '', fat: '' };

export default function FoodsScreen() {
  const { requestAccess, paywall } = useAIGate();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { user } = useAuth();
  const [foods, setFoods] = useState<Food[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingFood, setEditingFood] = useState<Food | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [scannerVisible, setScannerVisible] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState('image/jpeg');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [usdaQuery, setUsdaQuery] = useState('');
  const [usdaResults, setUsdaResults] = useState<any[]>([]);
  const [usdaSearching, setUsdaSearching] = useState(false);
  const [usdaVisible, setUsdaVisible] = useState(false);

  const fetchFoods = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('user_foods').select('*').eq('user_id', user.id).order('name');
    setFoods(data || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchFoods(); }, [fetchFoods]);

  const searchUSDA = async () => {
    if (!usdaQuery.trim()) return;
    // Pro gate: consumes one free trial use, then paywalls.
    if (!(await requestAccess('food_text'))) return;
    setUsdaSearching(true);
    try {
      const res = await fetch('https://zbcxuffgmjuqarapfdwb.supabase.co/functions/v1/ai-proxy/food-search', {
        method: 'POST',
        // ai-proxy's auth gate resolves the bearer via auth.getUser(); the anon
        // key cannot resolve to a user, so it 401s every request (build-161
        // food-search outage). Session token required.
        headers: await aiProxyHeaders(),
        body: JSON.stringify({ query: usdaQuery }),
      });
      if (!res.ok) throw new Error(`USDA search failed: ${res.status}`);
      const data = await res.json();
      setUsdaResults(data.foods || []);
    } catch (e) {
      logError('Foods.usdaSearch', e);
      Alert.alert('Search failed', 'Could not search food database.');
    } finally {
      setUsdaSearching(false);
    }
  };

  const importUSDAFood = async (food: any) => {
    await supabase.from('user_foods').insert({
      user_id: user!.id,
      name: food.name,
      serving_size: food.serving_size,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
    });
    await fetchFoods();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Added!', `"${food.name}" added to your foods.`);
  };

  const openAdd = () => {
    setEditingFood(null);
    setForm(EMPTY_FORM);
    setImageUri(null);
    setImageBase64(null);
    setModalVisible(true);
  };

  const openEdit = (food: Food) => {
    setEditingFood(food);
    setForm({
      name: food.name,
      serving_size: food.serving_size || '',
      calories: String(food.calories),
      protein: String(food.protein),
      carbs: String(food.carbs),
      fat: String(food.fat),
    });
    setImageUri(food.image_url || null);
    setImageBase64(null);
    setModalVisible(true);
  };

  const pickImage = async (fromCamera: boolean) => {
    const fn = fromCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const result = await fn({ base64: true, quality: 0.6, allowsEditing: true, aspect: [1, 1] });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setImageUri(asset.uri);
      setImageBase64(asset.base64 || null);
      setImageMime(asset.mimeType || 'image/jpeg');
    }
  };

  const showImagePicker = () => {
    Alert.alert('Add Photo', 'Choose a source', [
      { text: 'Camera', onPress: () => pickImage(true) },
      { text: 'Photo Library', onPress: () => pickImage(false) },
      { text: 'Remove Photo', style: 'destructive', onPress: () => { setImageUri(null); setImageBase64(null); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const uploadImage = async (): Promise<string | null> => {
    if (!imageBase64 || !user) return imageUri;
    setUploadingImage(true);
    try {
      const ext = imageMime === 'image/png' ? 'png' : 'jpg';
      const path = `${user.id}/${Date.now()}.${ext}`;
      const binary = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
      const { error } = await supabase.storage.from('food-images').upload(path, binary, { contentType: imageMime, upsert: true });
      if (error) return null;
      const { data } = supabase.storage.from('food-images').getPublicUrl(path);
      return data.publicUrl;
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { Alert.alert('Please enter a food name'); return; }
    if (!form.calories) { Alert.alert('Please enter calories'); return; }
    setSaving(true);
    const image_url = await uploadImage();
    const payload: any = {
      user_id: user!.id,
      name: form.name.trim(),
      serving_size: form.serving_size.trim(),
      calories: parseFloat(form.calories) || 0,
      protein: parseFloat(form.protein) || 0,
      carbs: parseFloat(form.carbs) || 0,
      fat: parseFloat(form.fat) || 0,
      image_url: image_url || null,
    };
    if (editingFood) {
      await supabase.from('user_foods').update(payload).eq('id', editingFood.id);
    } else {
      await supabase.from('user_foods').insert(payload);
    }
    await fetchFoods();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setModalVisible(false);
    setSaving(false);
  };

  const handleDelete = (food: Food) => {
    Alert.alert('Delete Food', `Remove "${food.name}" from your list?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await supabase.from('user_foods').delete().eq('id', food.id);
        await fetchFoods();
      }},
    ]);
  };

  const filtered = foods.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>My Foods</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={[s.addBtn, { backgroundColor: colors.card }]} onPress={() => setUsdaVisible(true)}>
            <Text style={[s.addBtnText, { color: colors.text }]}>Search</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.addBtn} onPress={openAdd}>
            <Text style={s.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.searchWrap}>
        <TextInput style={s.searchInput} value={search} onChangeText={setSearch}
          placeholder="Search my foods…" placeholderTextColor={colors.textTertiary} clearButtonMode="while-editing" />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.text} /></View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {filtered.length === 0 && (
            <View style={s.empty}>
              <Ionicons name="restaurant-outline" size={40} color={colors.textTertiary} />
              <Text style={s.emptyTitle}>{search ? 'No results' : 'No foods yet'}</Text>
              <Text style={s.emptySub}>{search ? 'Try a different search' : 'Tap "Search" or "+ Add" to build your food list'}</Text>
            </View>
          )}
          {filtered.map(food => (
            <TouchableOpacity key={food.id} style={s.foodCard} onPress={() => openEdit(food)} activeOpacity={0.7}>
              {food.image_url
                ? <Image source={{ uri: food.image_url }} style={s.foodThumb} />
                : <View style={s.foodThumbPlaceholder}><Ionicons name="nutrition-outline" size={20} color={colors.textTertiary} /></View>
              }
              <View style={s.foodInfo}>
                <Text style={s.foodName}>{food.name}</Text>
                {food.serving_size ? <Text style={s.foodServing}>per {food.serving_size}</Text> : null}
                <View style={s.foodMacros}>
                  <Text style={s.foodCal}>{food.calories} cal</Text>
                  <Text style={[s.foodMacro, { color: MC.protein.color }]}>P {food.protein}g</Text>
                  <Text style={[s.foodMacro, { color: MC.carbs.color }]}>C {food.carbs}g</Text>
                  <Text style={[s.foodMacro, { color: MC.fat.color }]}>F {food.fat}g</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => handleDelete(food)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.deleteBtn}>×</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* USDA Search Modal */}
      <Modal visible={usdaVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setUsdaVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
            <View style={s.handle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Food Database</Text>
              <TouchableOpacity style={s.modalClose} onPress={() => setUsdaVisible(false)}>
                <Text style={s.modalCloseText}>×</Text>
              </TouchableOpacity>
            </View>
            <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[s.input, { flex: 1, marginBottom: 0 }]}
                  value={usdaQuery}
                  onChangeText={setUsdaQuery}
                  placeholder="Search millions of foods..."
                  placeholderTextColor={colors.textTertiary}
                  onSubmitEditing={searchUSDA}
                  returnKeyType="search"
                />
                <TouchableOpacity
                  style={[s.saveBtn, { marginBottom: 0, paddingHorizontal: 20 }]}
                  onPress={searchUSDA}
                  disabled={usdaSearching}>
                  {usdaSearching
                    ? <ActivityIndicator color={colors.accentText} size="small" />
                    : <Text style={s.saveBtnText}>Go</Text>}
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 40 }}>
              {usdaResults.length === 0 && !usdaSearching && (
                <View style={s.empty}>
                  <Ionicons name="restaurant-outline" size={40} color={colors.textTertiary} />
                  <Text style={s.emptyTitle}>Search Foods</Text>
                  <Text style={s.emptySub}>Powered by the USDA food database</Text>
                </View>
              )}
              {usdaResults.map((food, i) => (
                <View key={i} style={[s.foodCard, { marginBottom: 8 }]}>
                  <View style={s.foodInfo}>
                    <Text style={s.foodName} numberOfLines={2}>{food.name}</Text>
                    {food.brand && <Text style={s.foodServing}>{food.brand}</Text>}
                    <Text style={s.foodServing}>per {food.serving_size}</Text>
                    <View style={s.foodMacros}>
                      <Text style={s.foodCal}>{food.calories} cal</Text>
                      <Text style={[s.foodMacro, { color: MC.protein.color }]}>P {food.protein}g</Text>
                      <Text style={[s.foodMacro, { color: MC.carbs.color }]}>C {food.carbs}g</Text>
                      <Text style={[s.foodMacro, { color: MC.fat.color }]}>F {food.fat}g</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={s.importBtn} onPress={() => importUSDAFood(food)}>
                    <Text style={s.importBtnText}>+ Add</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add / Edit Modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
            <View style={s.handle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{editingFood ? 'Edit Food' : 'Add Food'}</Text>
              <TouchableOpacity style={s.modalClose} onPress={() => setModalVisible(false)}>
                <Text style={s.modalCloseText}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={s.modalScroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <TouchableOpacity style={s.photoPicker} onPress={showImagePicker} activeOpacity={0.8}>
                {imageUri
                  ? <Image source={{ uri: imageUri }} style={s.photoPreview} />
                  : <View style={s.photoPlaceholder}>
                      <Ionicons name="camera-outline" size={26} color={colors.textTertiary} />
                      <Text style={s.photoPlaceholderText}>Add Photo</Text>
                    </View>
                }
              </TouchableOpacity>
              <Text style={s.fieldLabel}>Food Name *</Text>
              <TextInput style={s.input} value={form.name} onChangeText={v =>setForm(f => ({ ...f, name: v }))}
                placeholder="e.g. Chicken Breast" placeholderTextColor={colors.textTertiary} />
              <Text style={s.fieldLabel}>Serving Size</Text>
              <TextInput style={s.input} value={form.serving_size} onChangeText={v =>setForm(f => ({ ...f, serving_size: v }))}
                placeholder="e.g. 100g, 1 cup" placeholderTextColor={colors.textTertiary} />
              <Text style={s.fieldLabel}>Calories *</Text>
              <TextInput style={s.input} value={form.calories} onChangeText={v =>setForm(f => ({ ...f, calories: v }))}
                placeholder="0" placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" />
              <View style={s.macroGrid}>
                <View style={s.macroGridItem}>
                  <Text style={[s.fieldLabel, { color: MC.protein.color }]}>Protein (g)</Text>
                  <TextInput style={s.input} value={form.protein} onChangeText={v =>setForm(f => ({ ...f, protein: v }))}
                    placeholder="0" placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" />
                </View>
                <View style={s.macroGridItem}>
                  <Text style={[s.fieldLabel, { color: MC.carbs.color }]}>Carbs (g)</Text>
                  <TextInput style={s.input} value={form.carbs} onChangeText={v =>setForm(f => ({ ...f, carbs: v }))}
                    placeholder="0" placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" />
                </View>
                <View style={s.macroGridItem}>
                  <Text style={[s.fieldLabel, { color: MC.fat.color }]}>Fat (g)</Text>
                  <TextInput style={s.input} value={form.fat} onChangeText={v =>setForm(f => ({ ...f, fat: v }))}
                    placeholder="0" placeholderTextColor={colors.textTertiary} keyboardType="decimal-pad" />
                </View>
              </View>
              <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={saving || uploadingImage}>
                {saving || uploadingImage
                  ? <ActivityIndicator color={colors.accentText} />
                  : <Text style={s.saveBtnText}>{editingFood ? 'Save Changes' : 'Add Food'}</Text>}
              </TouchableOpacity>
              {editingFood && (
                <TouchableOpacity style={s.deleteModalBtn} onPress={() => { setModalVisible(false); handleDelete(editingFood); }}>
                  <Text style={s.deleteModalBtnText}>Delete Food</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      <BarcodeScanner
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onResult={(r) => {
          setForm({ name: r.name, serving_size: r.serving_size, calories: String(r.calories), protein: String(r.protein), carbs: String(r.carbs), fat: String(r.fat) });
          setScannerVisible(false);
          setModalVisible(true);
        }}
      />
    </SafeAreaView>
      {paywall}
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
    title: { fontSize: 28, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    addBtn: { backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
    addBtnText: { color: c.accentText, fontSize: 14, fontWeight: weight.heavy },
    searchWrap: { padding: spacing.lg, paddingBottom: spacing.sm },
    searchInput: { backgroundColor: c.card, borderRadius: radius.md, color: c.text, padding: spacing.md, fontSize: 15, borderWidth: 1, borderColor: c.border },
    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: 40 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    empty: { alignItems: 'center', paddingVertical: 60 },
    emptyIcon: { fontSize: 48, marginBottom: 16 },
    emptyTitle: { fontSize: 18, fontWeight: weight.heavy, color: c.text, marginBottom: 8 },
    emptySub: { fontSize: 13, color: c.textTertiary, fontWeight: weight.medium, textAlign: 'center' },
    foodCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: radius.card, padding: spacing.md, marginBottom: 8, gap: 12, borderWidth: 1, borderColor: c.border },
    foodThumb: { width: 52, height: 52, borderRadius: radius.sm },
    foodThumbPlaceholder: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: c.cardAlt, alignItems: 'center', justifyContent: 'center' },
    foodThumbEmoji: { fontSize: 24 },
    foodInfo: { flex: 1 },
    foodName: { fontSize: 15, fontWeight: weight.bold, color: c.text, marginBottom: 2 },
    foodServing: { fontSize: 11, color: c.textTertiary, fontWeight: weight.medium, marginBottom: 4 },
    foodMacros: { flexDirection: 'row', gap: 8 },
    foodCal: { fontSize: 11, color: c.textTertiary, fontWeight: weight.semibold },
    foodMacro: { fontSize: 11, fontWeight: weight.semibold },
    deleteBtn: { color: c.textTertiary, fontSize: 24, paddingLeft: 8 },
    modalSafe: { flex: 1, backgroundColor: c.bgSecondary },
    handle: { width: 36, height: 4, backgroundColor: c.borderStrong, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, marginBottom: 20 },
    modalTitle: { fontSize: 22, fontWeight: weight.heavy, color: c.text },
    modalClose: { backgroundColor: c.cardAlt, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    modalCloseText: { color: c.textSecondary, fontSize: 20, lineHeight: 22 },
    modalScroll: { flex: 1, paddingHorizontal: spacing.xl },
    photoPicker: { borderRadius: radius.card, overflow: 'hidden', marginBottom: 20, height: 180, backgroundColor: c.cardAlt },
    photoPreview: { width: '100%', height: '100%' },
    photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
    photoPlaceholderIcon: { fontSize: 40 },
    photoPlaceholderText: { fontSize: 16, fontWeight: weight.bold, color: c.text },
    fieldLabel: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    input: { backgroundColor: c.card, borderRadius: radius.md, color: c.text, padding: 14, fontSize: 15, marginBottom: 16, borderWidth: 1, borderColor: c.border },
    macroGrid: { flexDirection: 'row', gap: 10 },
    macroGridItem: { flex: 1 },
    saveBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 16, alignItems: 'center', marginBottom: 12 },
    saveBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.heavy },
    importBtn: { backgroundColor: c.accent, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
    importBtnText: { color: c.accentText, fontWeight: weight.heavy, fontSize: 13 },
    deleteModalBtn: { backgroundColor: c.dangerSoft, borderRadius: radius.md, padding: 16, alignItems: 'center' },
    deleteModalBtnText: { color: c.danger, fontSize: 15, fontWeight: weight.bold },
  });
}
