import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Modal, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { supabase } from '../constants/supabase';
import BarcodeScanner from '../components/BarcodeScanner';
import { useAuth } from '../hooks/useAuth';
import { MC } from '../constants/data';

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
    setUsdaSearching(true);
    try {
      const res = await fetch('https://zbcxuffgmjuqarapfdwb.supabase.co/functions/v1/ai-proxy/food-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDAyNzIyMDAsImV4cCI6MjA1NTg0ODIwMH0.BHiSHOKsHPaObq0RQJ-4DEiUFjVSQSJwSHRqcGpA8b4',
        },
        body: JSON.stringify({ query: usdaQuery }),
      });
      const data = await res.json();
      setUsdaResults(data.foods || []);
    } catch {
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
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>My Foods</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={[s.addBtn, { backgroundColor: '#1e1e1e' }]} onPress={() => setUsdaVisible(true)}>
            <Text style={[s.addBtnText, { color: '#fff' }]}>🔍 Search</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.addBtn} onPress={openAdd}>
            <Text style={s.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.searchWrap}>
        <TextInput style={s.searchInput} value={search} onChangeText={setSearch}
          placeholder="Search my foods…" placeholderTextColor="#444" clearButtonMode="while-editing" />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color="#fff" /></View>
      ) : (
        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {filtered.length === 0 && (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🥦</Text>
              <Text style={s.emptyTitle}>{search ? 'No results' : 'No foods yet'}</Text>
              <Text style={s.emptySub}>{search ? 'Try a different search' : 'Tap "🔍 Search" or "+ Add" to build your food list'}</Text>
            </View>
          )}
          {filtered.map(food => (
            <TouchableOpacity key={food.id} style={s.foodCard} onPress={() => openEdit(food)} activeOpacity={0.7}>
              {food.image_url
                ? <Image source={{ uri: food.image_url }} style={s.foodThumb} />
                : <View style={s.foodThumbPlaceholder}><Text style={s.foodThumbEmoji}>🍽️</Text></View>
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
                  placeholderTextColor="#444"
                  onSubmitEditing={searchUSDA}
                  returnKeyType="search"
                />
                <TouchableOpacity
                  style={[s.saveBtn, { marginBottom: 0, paddingHorizontal: 20 }]}
                  onPress={searchUSDA}
                  disabled={usdaSearching}>
                  {usdaSearching ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.saveBtnText}>Go</Text>}
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 40 }}>
              {usdaResults.length === 0 && !usdaSearching && (
                <View style={s.empty}>
                  <Text style={s.emptyIcon}>🔍</Text>
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
                  <TouchableOpacity
                    style={{ backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}
                    onPress={() => importUSDAFood(food)}>
                    <Text style={{ color: '#000', fontWeight: '800', fontSize: 13 }}>+ Add</Text>
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
                      <Text style={s.photoPlaceholderIcon}>📷</Text>
                      <Text style={s.photoPlaceholderText}>Add Photo</Text>
                    </View>
                }
              </TouchableOpacity>
              <Text style={s.fieldLabel}>Food Name *</Text>
              <TextInput style={s.input} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))}
                placeholder="e.g. Chicken Breast" placeholderTextColor="#444" />
              <Text style={s.fieldLabel}>Serving Size</Text>
              <TextInput style={s.input} value={form.serving_size} onChangeText={v => setForm(f => ({ ...f, serving_size: v }))}
                placeholder="e.g. 100g, 1 cup" placeholderTextColor="#444" />
              <Text style={s.fieldLabel}>Calories *</Text>
              <TextInput style={s.input} value={form.calories} onChangeText={v => setForm(f => ({ ...f, calories: v }))}
                placeholder="0" placeholderTextColor="#444" keyboardType="decimal-pad" />
              <View style={s.macroGrid}>
                <View style={s.macroGridItem}>
                  <Text style={[s.fieldLabel, { color: MC.protein.color }]}>Protein (g)</Text>
                  <TextInput style={s.input} value={form.protein} onChangeText={v => setForm(f => ({ ...f, protein: v }))}
                    placeholder="0" placeholderTextColor="#444" keyboardType="decimal-pad" />
                </View>
                <View style={s.macroGridItem}>
                  <Text style={[s.fieldLabel, { color: MC.carbs.color }]}>Carbs (g)</Text>
                  <TextInput style={s.input} value={form.carbs} onChangeText={v => setForm(f => ({ ...f, carbs: v }))}
                    placeholder="0" placeholderTextColor="#444" keyboardType="decimal-pad" />
                </View>
                <View style={s.macroGridItem}>
                  <Text style={[s.fieldLabel, { color: MC.fat.color }]}>Fat (g)</Text>
                  <TextInput style={s.input} value={form.fat} onChangeText={v => setForm(f => ({ ...f, fat: v }))}
                    placeholder="0" placeholderTextColor="#444" keyboardType="decimal-pad" />
                </View>
              </View>
              <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={saving || uploadingImage}>
                {saving || uploadingImage ? <ActivityIndicator color="#000" /> : <Text style={s.saveBtnText}>{editingFood ? 'Save Changes' : 'Add Food'}</Text>}
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
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  addBtn: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  addBtnText: { color: '#000', fontSize: 14, fontWeight: '800' },
  searchWrap: { padding: 16, paddingBottom: 8 },
  searchInput: { backgroundColor: '#1e1e1e', borderRadius: 12, color: '#fff', padding: 12, fontSize: 15 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingTop: 8, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 8 },
  emptySub: { fontSize: 13, color: '#444', fontWeight: '500', textAlign: 'center' },
  foodCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 14, padding: 12, marginBottom: 8, gap: 12 },
  foodThumb: { width: 52, height: 52, borderRadius: 10 },
  foodThumbPlaceholder: { width: 52, height: 52, borderRadius: 10, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center' },
  foodThumbEmoji: { fontSize: 24 },
  foodInfo: { flex: 1 },
  foodName: { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 2 },
  foodServing: { fontSize: 11, color: '#555', fontWeight: '500', marginBottom: 4 },
  foodMacros: { flexDirection: 'row', gap: 8 },
  foodCal: { fontSize: 11, color: '#555', fontWeight: '600' },
  foodMacro: { fontSize: 11, fontWeight: '600' },
  deleteBtn: { color: '#333', fontSize: 24, paddingLeft: 8 },
  modalSafe: { flex: 1, backgroundColor: '#1a1a1a' },
  handle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 20 },
  modalTitle: { fontSize: 22, fontWeight: '900', color: '#fff' },
  modalClose: { backgroundColor: '#252525', width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  modalCloseText: { color: '#888', fontSize: 20, lineHeight: 22 },
  modalScroll: { flex: 1, paddingHorizontal: 20 },
  photoPicker: { borderRadius: 16, overflow: 'hidden', marginBottom: 20, height: 180, backgroundColor: '#252525' },
  photoPreview: { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoPlaceholderIcon: { fontSize: 40 },
  photoPlaceholderText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#252525', borderRadius: 12, color: '#fff', padding: 14, fontSize: 15, marginBottom: 16 },
  macroGrid: { flexDirection: 'row', gap: 10 },
  macroGridItem: { flex: 1 },
  saveBtn: { backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  saveBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },
  deleteModalBtn: { backgroundColor: '#2a1010', borderRadius: 12, padding: 16, alignItems: 'center' },
  deleteModalBtnText: { color: '#ff4f4f', fontSize: 15, fontWeight: '700' },
});
