import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Modal, Image, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import MacroRing from '../components/MacroRing';
import WaterTracker from '../components/WaterTracker';
import BarcodeScanner from '../components/BarcodeScanner';
import { MEALS, MC } from '../constants/data';

const todayStr = () => new Date().toISOString().split('T')[0];
const r1 = (n: number) => Math.round(n * 10) / 10;
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

interface UserFood { id: number; name: string; serving_size: string; calories: number; protein: number; carbs: number; fat: number; }

export default function LogScreen({ targets }: { targets: { calories: number; protein: number; carbs: number; fat: number } }) {
  const { user } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [userFoods, setUserFoods] = useState<UserFood[]>([]);
  const [activeDate, setActiveDate] = useState(todayStr());
  const [selectedMeal, setSelectedMeal] = useState('Breakfast');
  const [selectedFood, setSelectedFood] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [saving, setSaving] = useState(false);
  const [scanVisible, setScanVisible] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannedFood, setScannedFood] = useState<any>(null);
  const [scanImage, setScanImage] = useState<string | null>(null);
  const [scanBase64, setScanBase64] = useState<string | null>(null);
  const [scanType, setScanType] = useState('image/jpeg');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanMeal, setScanMeal] = useState('Breakfast');
  const [scanServings, setScanServings] = useState('1');
  const [manualVisible, setManualVisible] = useState(false);
  const [manualMeal, setManualMeal] = useState('Breakfast');
  const [manualName, setManualName] = useState('');
  const [manualCalories, setManualCalories] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');
  const [manualSaving, setManualSaving] = useState(false);

  const fetchLogs = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('macro_logs')
      .select('*').eq('user_id', user.id).eq('date', activeDate).order('created_at');
    setLogs(data || []);
  }, [user, activeDate]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const totals = logs.reduce(
    (a, e) => ({ calories: a.calories + e.calories, protein: a.protein + e.protein, carbs: a.carbs + e.carbs, fat: a.fat + e.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const calOver = totals.calories > targets.calories;
  const calRemain = targets.calories - Math.round(totals.calories);

  const changeDate = (delta: number) => {
    const d = new Date(activeDate + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    const next = d.toISOString().split('T')[0];
    if (next <= todayStr()) setActiveDate(next);
  };

  const addEntry = async () => {
    const food = userFoods.find(f => f.name === selectedFood); if (!food) return;
    const q = parseFloat(quantity) || 1;
    setSaving(true);
    await supabase.from('macro_logs').insert({
      user_id: user!.id, date: activeDate, meal: selectedMeal, food: food.name, qty: q,
      calories: Math.round(food.calories * q), protein: r1(food.protein * q),
      carbs: r1(food.carbs * q), fat: r1(food.fat * q),
    });
    await fetchLogs();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSaving(false);
  };

  const addManualEntry = async () => {
    if (!manualName.trim() || !manualCalories) {
      Alert.alert('Please enter at least a name and calories.');
      return;
    }
    setManualSaving(true);
    let micros = {};
    try {
      const res = await fetch('https://zbcxuffgmjuqarapfdwb.supabase.co/functions/v1/ai-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQ4NjIsImV4cCI6MjA4NzQwMDg2Mn0.lUng1tY_aAuee_t8-E5MSUHdm2PF3HzsE41L-kzBmJE' },
        body: JSON.stringify({
          system: 'You are a nutrition expert. Return only valid JSON, no explanation.',
          messages: [{ role: 'user', content: 'Estimate micronutrients for: ' + manualName.trim() + ', ' + manualCalories + ' calories, ' + manualProtein + 'g protein, ' + manualCarbs + 'g carbs, ' + manualFat + 'g fat. Return ONLY a JSON object with these exact numeric keys: vitamin_a, vitamin_c, vitamin_d, vitamin_e, vitamin_k, vitamin_b1, vitamin_b2, vitamin_b3, vitamin_b5, vitamin_b6, vitamin_b7, vitamin_b9, vitamin_b12, calcium, iron, magnesium, phosphorus, potassium, sodium, zinc, copper, manganese, selenium, chromium, iodine, omega3.' }],
          max_tokens: 500,
        }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      micros = JSON.parse(clean);
    } catch(e) { console.log('Micro estimate failed:', e); }
    await supabase.from('macro_logs').insert({
      user_id: user!.id, date: activeDate, meal: manualMeal, food: manualName.trim(), qty: 1,
      calories: Math.round(parseFloat(manualCalories) || 0),
      protein: r1(parseFloat(manualProtein) || 0),
      carbs: r1(parseFloat(manualCarbs) || 0),
      fat: r1(parseFloat(manualFat) || 0),
      ...micros,
    });
    await fetchLogs();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setManualSaving(false);
    setManualVisible(false);
    setManualName(''); setManualCalories(''); setManualProtein(''); setManualCarbs(''); setManualFat('');
  };

  const removeEntry = async (id: number) => {
    await supabase.from('macro_logs').delete().eq('id', id);
    await fetchLogs();
  };

  const pickImage = async (fromCamera: boolean) => {
    const fn = fromCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const result = await fn({
      base64: true, quality: 0.5, allowsEditing: true, exif: false,
      mediaTypes: ['images'],
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      // Always re-encode as JPEG via canvas to avoid HEIC issues
      const jpegBase64 = asset.base64 || null;
      setScanImage(asset.uri);
      setScanBase64(jpegBase64);
      setScanType('image/jpeg');
      setScanResult(null); setScanError(null);
    }
  };

  const scanLabel = async () => {
    if (!scanImage) return;
    console.log('Uploading image for scan, uri:', scanImage);
    setScanning(true); setScanError(null); setScanResult(null);
    try {
      if (!scanBase64) throw new Error('No image data');
      const res = await fetch('https://zbcxuffgmjuqarapfdwb.supabase.co/functions/v1/ai-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQ4NjIsImV4cCI6MjA4NzQwMDg2Mn0.lUng1tY_aAuee_t8-E5MSUHdm2PF3HzsE41L-kzBmJE', 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQ4NjIsImV4cCI6MjA4NzQwMDg2Mn0.lUng1tY_aAuee_t8-E5MSUHdm2PF3HzsE41L-kzBmJE' },
        body: JSON.stringify({
          system: 'You are a nutrition label reader. Return only valid JSON, no explanation.',
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: scanBase64 } },
            { type: 'text', text: 'Read this nutrition label and respond ONLY with JSON:\n{"name":"product name","serving_size":"e.g. 1 cup","calories":number,"protein":number,"carbs":number,"fat":number}\nIf unreadable: {"error":"message"}' },
          ]}],
          max_tokens: 1000,
        }),
      });
      const raw = await res.text();
      console.log('Proxy raw response:', raw);
      const data = JSON.parse(raw);
      const text = (data.content?.find((b: any) => b.type === 'text')?.text || '').replace(/```json|```/g, '').trim();
      console.log('AI text response:', text);
      const parsed = JSON.parse(text);
      if (parsed.error) setScanError(parsed.error); else setScanResult(parsed);
    } catch (e: any) {
      console.log('Scan error:', e);
      setScanError('Error: ' + (e?.message || JSON.stringify(e)));
    }
    finally { setScanning(false); }
  };

  const addScannedEntry = async () => {
    if (!scanResult) return;
    const s = parseFloat(scanServings) || 1;
    await supabase.from('macro_logs').insert({
      user_id: user!.id, date: activeDate, meal: scanMeal, food: scanResult.name, qty: s,
      calories: Math.round(scanResult.calories * s), protein: r1(scanResult.protein * s),
      carbs: r1(scanResult.carbs * s), fat: r1(scanResult.fat * s),
    });
    await fetchLogs();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setScanVisible(false); setScanImage(null); setScanBase64(null);
    setScanResult(null); setScanError(null); setScanServings('1');
  };

  const food = userFoods.find(f => f.name === selectedFood);
  const q = parseFloat(quantity) || 1;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Macro Log{saving ? '  •' : ''}</Text>
        <Text style={s.date}>{activeDate === todayStr() ? 'Today' : fmtDate(activeDate)}</Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Date nav */}
        <View style={s.dateNav}>
          <TouchableOpacity style={s.dateBtn} onPress={() => changeDate(-1)}>
            <Text style={s.dateArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={s.dateLabel}>{activeDate === todayStr() ? 'Today' : fmtDate(activeDate)}</Text>
          <TouchableOpacity style={[s.dateBtn, activeDate === todayStr() && s.dateBtnDisabled]}
            onPress={() => changeDate(1)} disabled={activeDate === todayStr()}>
            <Text style={s.dateArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Calorie hero */}
        <View style={s.hero}>
          <Text style={s.heroLabel}>CALORIES</Text>
          <Text style={[s.heroNum, calOver && s.heroOver]}>{Math.round(totals.calories)}</Text>
          <Text style={s.heroSub}>
            {calOver ? `${Math.abs(calRemain)} over your ${targets.calories} goal` : `${calRemain} remaining of ${targets.calories}`}
          </Text>
        </View>

        {/* Rings */}
        <View style={s.rings}>
          <MacroRing macroKey="protein" value={totals.protein} target={targets.protein} label="Protein" />
          <MacroRing macroKey="carbs" value={totals.carbs} target={targets.carbs} label="Carbs" />
          <MacroRing macroKey="fat" value={totals.fat} target={targets.fat} label="Fat" />
        </View>

        {/* Water tracker */}
        <WaterTracker />

        {/* Add food */}
        <BarcodeScanner
          visible={scannerVisible}
          onClose={() => setScannerVisible(false)}
          onResult={(r) => {
            setScannedFood(r);
            setScannerVisible(false);
            setAddModal(true);
          }}
        />
        <View style={s.panel}>
          <View style={s.panelTop}>
            <Text style={s.sectionTitle}>ADD FOOD</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={s.scanBtn} onPress={() => { setManualVisible(true); setManualMeal(selectedMeal); }}>
                <Text style={s.scanBtnText}>✏️  Manual</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.scanBtn} onPress={() => { setScanVisible(true); setScanMeal(selectedMeal); }}>
                <Text style={s.scanBtnText}>📷  Scan</Text>
              </TouchableOpacity>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.mealPicker}>
            {MEALS.map(m => (
              <TouchableOpacity key={m} style={[s.chip, selectedMeal === m && s.chipActive]} onPress={() => setSelectedMeal(m)}>
                <Text style={[s.chipText, selectedMeal === m && s.chipTextActive]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {userFoods.length === 0
              ? <Text style={s.noFoodsText}>No foods yet — add some in the Foods tab 🥦</Text>
              : userFoods.map(f => (
                <TouchableOpacity key={f.name} style={[s.foodChip, selectedFood === f.name && s.foodChipActive]} onPress={() => setSelectedFood(f.name)}>
                  <Text style={[s.foodChipText, selectedFood === f.name && s.foodChipTextActive]} numberOfLines={1}>{f.name}</Text>
                </TouchableOpacity>
              ))
            }
          </ScrollView>
          <View style={s.qtyRow}>
            <Text style={s.qtyLabel}>Qty</Text>
            <TextInput style={s.qtyInput} value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" selectTextOnFocus />
            {food && (
              <View style={s.previewChips}>
                <View style={[s.previewChip, { backgroundColor: 'rgba(255,255,255,0.07)' }]}><Text style={[s.previewChipText, { color: '#666' }]}>Cal {Math.round(food.calories * q)}</Text></View>
                <View style={[s.previewChip, { backgroundColor: MC.protein.bg }]}><Text style={[s.previewChipText, { color: MC.protein.color }]}>P {r1(food.protein * q)}g</Text></View>
                <View style={[s.previewChip, { backgroundColor: MC.carbs.bg }]}><Text style={[s.previewChipText, { color: MC.carbs.color }]}>C {r1(food.carbs * q)}g</Text></View>
                <View style={[s.previewChip, { backgroundColor: MC.fat.bg }]}><Text style={[s.previewChipText, { color: MC.fat.color }]}>F {r1(food.fat * q)}g</Text></View>
              </View>
            )}
          </View>
          <TouchableOpacity style={s.addBtn} onPress={addEntry} activeOpacity={0.8}>
            <Text style={s.addBtnText}>Add to Log</Text>
          </TouchableOpacity>
        </View>

        {/* Entries */}
        {MEALS.map(meal => {
          const entries = logs.filter(e => e.meal === meal); if (!entries.length) return null;
          return (
            <View key={meal} style={s.mealSection}>
              <Text style={s.mealHeader}>{meal.toUpperCase()}</Text>
              {entries.map(e => (
                <View key={e.id} style={s.entry}>
                  <View style={s.entryInfo}>
                    <Text style={s.entryName}>{e.qty !== 1 ? `${e.qty}× ` : ''}{e.food}</Text>
                    <View style={s.entryMacros}>
                      <Text style={s.entryCal}>{e.calories} cal</Text>
                      <Text style={{ color: MC.protein.color, fontSize: 11, fontWeight: '600' }}>P {e.protein}g</Text>
                      <Text style={{ color: MC.carbs.color, fontSize: 11, fontWeight: '600' }}>C {e.carbs}g</Text>
                      <Text style={{ color: MC.fat.color, fontSize: 11, fontWeight: '600' }}>F {e.fat}g</Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => removeEntry(e.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Text style={s.del}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          );
        })}
        {logs.length === 0 && <Text style={s.empty}>Nothing logged yet.{'\n'}Add a food above or scan a label.</Text>}
      </ScrollView>

      {/* Scan Modal */}
      <Modal visible={scanVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setScanVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
            <View style={s.handle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Scan Food Label</Text>
              <TouchableOpacity style={s.modalClose} onPress={() => { setScanVisible(false); setScanImage(null); setScanBase64(null); setScanResult(null); setScanError(null); }}>
                <Text style={s.modalCloseText}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={s.modalScroll} contentContainerStyle={{ paddingBottom: 40 }}>
              {!scanImage ? (
                <View>
                  <TouchableOpacity style={s.uploadArea} onPress={() => pickImage(true)}>
                    <Text style={s.uploadIcon}>📷</Text>
                    <Text style={s.uploadTitle}>Take a Photo</Text>
                    <Text style={s.uploadSub}>Point camera at the nutrition label</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.libraryBtn} onPress={() => pickImage(false)}>
                    <Text style={s.libraryBtnText}>Choose from Library</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View>
                  <Image source={{ uri: scanImage }} style={s.previewImg} resizeMode="contain" />
                  <TouchableOpacity style={s.libraryBtn} onPress={() => { setScanImage(null); setScanBase64(null); setScanResult(null); setScanError(null); }}>
                    <Text style={s.libraryBtnText}>Choose Different Image</Text>
                  </TouchableOpacity>
                </View>
              )}
              {scanImage && !scanResult && (
                <TouchableOpacity style={[s.scanApiBtn, scanning && { backgroundColor: '#222' }]} onPress={scanLabel} disabled={scanning}>
                  {scanning ? <ActivityIndicator color="#000" /> : <Text style={s.scanApiBtnText}>🔍  Scan with AI</Text>}
                </TouchableOpacity>
              )}
              {scanError && <View style={s.errorBox}><Text style={s.errorText}>{scanError}</Text></View>}
              {scanResult && (
                <View style={s.resultBox}>
                  <Text style={s.resultName}>{scanResult.name}</Text>
                  <Text style={s.resultServing}>Per serving · {scanResult.serving_size}</Text>
                  <View style={s.resultMacros}>
                    {[
                      { l: 'Cal', v: Math.round(scanResult.calories * (parseFloat(scanServings)||1)), c: '#fff' },
                      { l: 'Protein', v: r1(scanResult.protein * (parseFloat(scanServings)||1)) + 'g', c: MC.protein.color },
                      { l: 'Carbs', v: r1(scanResult.carbs * (parseFloat(scanServings)||1)) + 'g', c: MC.carbs.color },
                      { l: 'Fat', v: r1(scanResult.fat * (parseFloat(scanServings)||1)) + 'g', c: MC.fat.color },
                    ].map(({ l, v, c }) => (
                      <View key={l} style={s.resultMacro}>
                        <Text style={[s.resultMacroVal, { color: c }]}>{v}</Text>
                        <Text style={s.resultMacroLabel}>{l}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={s.fieldLabel}>Meal</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                    {MEALS.map(m => (
                      <TouchableOpacity key={m} style={[s.chip, scanMeal === m && s.chipActive, { marginRight: 8 }]} onPress={() => setScanMeal(m)}>
                        <Text style={[s.chipText, scanMeal === m && s.chipTextActive]}>{m}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={s.fieldLabel}>Servings</Text>
                  <TextInput style={s.input} value={scanServings} onChangeText={setScanServings} keyboardType="decimal-pad" selectTextOnFocus />
                  <TouchableOpacity style={s.confirmBtn} onPress={addScannedEntry} activeOpacity={0.8}>
                    <Text style={s.confirmBtnText}>Add to Log</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
      {/* Manual Entry Modal */}
      <Modal visible={manualVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setManualVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
            <View style={s.handle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Manual Entry</Text>
              <TouchableOpacity style={s.modalClose} onPress={() => setManualVisible(false)}>
                <Text style={s.modalCloseText}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={s.modalScroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <Text style={s.fieldLabel}>Food Name</Text>
              <TextInput style={s.input} value={manualName} onChangeText={setManualName} placeholder="e.g. Chicken Breast" placeholderTextColor="#444" />
              
              <Text style={s.fieldLabel}>Meal</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                {MEALS.map(m => (
                  <TouchableOpacity key={m} style={[s.chip, manualMeal === m && s.chipActive, { marginRight: 8 }]} onPress={() => setManualMeal(m)}>
                    <Text style={[s.chipText, manualMeal === m && s.chipTextActive]}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={s.fieldLabel}>Calories</Text>
              <TextInput style={s.input} value={manualCalories} onChangeText={setManualCalories} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#444" />

              <Text style={s.fieldLabel}>Protein (g)</Text>
              <TextInput style={s.input} value={manualProtein} onChangeText={setManualProtein} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#444" />

              <Text style={s.fieldLabel}>Carbs (g)</Text>
              <TextInput style={s.input} value={manualCarbs} onChangeText={setManualCarbs} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#444" />

              <Text style={s.fieldLabel}>Fat (g)</Text>
              <TextInput style={s.input} value={manualFat} onChangeText={setManualFat} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#444" />

              <TouchableOpacity style={s.confirmBtn} onPress={addManualEntry} disabled={manualSaving}>
                {manualSaving ? <ActivityIndicator color="#000" /> : <Text style={s.confirmBtnText}>Add to Log</Text>}
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  date: { fontSize: 13, color: '#555', fontWeight: '500', marginTop: 2 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  dateNav: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  dateBtn: { backgroundColor: '#1e1e1e', borderRadius: 10, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  dateBtnDisabled: { opacity: 0.25 },
  dateArrow: { color: '#fff', fontSize: 22 },
  dateLabel: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '600', color: '#fff' },
  hero: { alignItems: 'center', marginBottom: 28 },
  heroLabel: { fontSize: 11, fontWeight: '700', color: '#444', letterSpacing: 2, marginBottom: 6 },
  heroNum: { fontSize: 72, fontWeight: '900', color: '#fff', letterSpacing: -3, lineHeight: 80 },
  heroOver: { color: '#ff4f4f' },
  heroSub: { fontSize: 13, color: '#444', marginTop: 6, fontWeight: '500' },
  rings: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  panel: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16, marginBottom: 20 },
  panelTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#555', letterSpacing: 1.5 },
  scanBtn: { backgroundColor: '#252525', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  scanBtnText: { color: '#888', fontSize: 12, fontWeight: '700' },
  mealPicker: { marginBottom: 10 },
  chip: { backgroundColor: '#252525', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, marginRight: 8 },
  chipActive: { backgroundColor: '#fff' },
  chipText: { color: '#555', fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#000' },
  foodChip: { backgroundColor: '#252525', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, maxWidth: 160 },
  foodChipActive: { backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#444' },
  foodChipText: { color: '#555', fontSize: 12, fontWeight: '600' },
  foodChipTextActive: { color: '#fff' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' },
  qtyLabel: { fontSize: 12, color: '#555', fontWeight: '600' },
  qtyInput: { backgroundColor: '#252525', borderRadius: 10, color: '#fff', padding: 10, fontSize: 15, fontWeight: '700', width: 70, textAlign: 'center' },
  previewChips: { flexDirection: 'row', gap: 6, flex: 1, flexWrap: 'wrap' },
  previewChip: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  previewChipText: { fontSize: 11, fontWeight: '700' },
  addBtn: { backgroundColor: '#fff', borderRadius: 12, padding: 14, alignItems: 'center' },
  addBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },
  mealSection: { marginBottom: 8 },
  mealHeader: { fontSize: 11, fontWeight: '700', color: '#444', letterSpacing: 1.5, paddingVertical: 10, paddingHorizontal: 4 },
  entry: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, marginBottom: 6 },
  entryInfo: { flex: 1 },
  entryName: { fontSize: 14, fontWeight: '600', color: '#fff', marginBottom: 3 },
  entryMacros: { flexDirection: 'row', gap: 8 },
  entryCal: { fontSize: 11, color: '#555', fontWeight: '600' },
  del: { color: '#333', fontSize: 22, paddingLeft: 12 },
  empty: { textAlign: 'center', color: '#333', fontSize: 14, paddingVertical: 48, lineHeight: 26, fontWeight: '500' },
  modalSafe: { flex: 1, backgroundColor: '#1a1a1a' },
  handle: { width: 36, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#fff' },
  modalClose: { backgroundColor: '#252525', width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  modalCloseText: { color: '#888', fontSize: 20, lineHeight: 22 },
  modalScroll: { flex: 1, paddingHorizontal: 20 },
  uploadArea: { borderWidth: 2, borderColor: '#2a2a2a', borderStyle: 'dashed', borderRadius: 16, padding: 40, alignItems: 'center', marginBottom: 14 },
  uploadIcon: { fontSize: 44, marginBottom: 14 },
  uploadTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 6 },
  uploadSub: { fontSize: 13, color: '#555' },
  libraryBtn: { borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 14 },
  libraryBtnText: { color: '#666', fontSize: 14, fontWeight: '600' },
  previewImg: { width: '100%', height: 200, borderRadius: 12, backgroundColor: '#111', marginBottom: 10 },
  scanApiBtn: { backgroundColor: '#fff', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 14 },
  scanApiBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },
  errorBox: { backgroundColor: '#2a1010', borderRadius: 12, padding: 14, marginBottom: 14 },
  errorText: { color: '#ff6b6b', fontSize: 13, fontWeight: '500' },
  resultBox: { backgroundColor: '#111', borderRadius: 16, padding: 16, marginBottom: 14 },
  resultName: { fontSize: 17, fontWeight: '800', color: '#fff', marginBottom: 4 },
  resultServing: { fontSize: 12, color: '#555', fontWeight: '600', marginBottom: 16 },
  resultMacros: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  resultMacro: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 10, alignItems: 'center' },
  resultMacroVal: { fontSize: 15, fontWeight: '800' },
  resultMacroLabel: { fontSize: 10, color: '#555', marginTop: 2, fontWeight: '600' },
  fieldLabel: { fontSize: 11, color: '#555', fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#1e1e1e', borderRadius: 10, color: '#fff', padding: 12, fontSize: 14, marginBottom: 14 },
  confirmBtn: { backgroundColor: '#fff', borderRadius: 12, padding: 14, alignItems: 'center' },
  confirmBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },
  noFoodsText: { color: '#444', fontSize: 13, fontWeight: '500', paddingVertical: 10, paddingHorizontal: 4 },
});
