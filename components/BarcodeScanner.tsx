import React, { useState, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator, Alert, useWindowDimensions,
} from 'react-native';
import { CameraView, Camera } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { MC } from '../constants/data';

interface NutritionResult {
  name: string;
  brand: string;
  serving_size: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
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
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onResult: (result: NutritionResult) => void;
}

const OVERLAY = 'rgba(0,0,0,0.6)';

export default function BarcodeScanner({ visible, onClose, onResult }: Props) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [found, setFound] = useState<NutritionResult | null>(null);

  const { width, height } = useWindowDimensions();
  const scanBoxSize = Math.round(Math.min(width, height) * 0.62);
  const SCAN_BOX = Math.min(Math.max(scanBoxSize, 180), 320);

  useEffect(() => {
    if (visible) {
      Camera.requestCameraPermissionsAsync().then(({ status }) => {
        setHasPermission(status === 'granted');
      });
      setScanned(false);
      setFound(null);
    }
  }, [visible]);

  const handleBarCodeScanned = async ({ data }: { type: string; data: string }) => {
    if (scanned || loading) return;
    setScanned(true);
    setLoading(true);

    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${data}.json`);
      const json = await res.json();

      if (json.status !== 1 || !json.product) {
        Alert.alert('Not Found', "This barcode wasn't found in the database. Try searching manually.", [
          { text: 'Scan Again', onPress: () => { setScanned(false); setLoading(false); } },
          { text: 'Cancel', onPress: onClose },
        ]);
        setLoading(false);
        return;
      }

      const p = json.product;
      const n = p.nutriments || {};

      // OFF returns both _serving and _100g variants; prefer _serving when available
      const srv = (servKey: string, per100Key: string) => {
        const v = n[servKey] != null ? n[servKey] : n[per100Key];
        return v != null && v > 0 ? Math.round(v * 100) / 100 : null;
      };

      const result: NutritionResult = {
        name: p.product_name || p.generic_name || 'Unknown Food',
        brand: p.brands || '',
        serving_size: p.serving_size || '100g',
        calories:     Math.round(n['energy-kcal_serving'] || n['energy-kcal_100g'] || 0),
        protein:      Math.round((n.proteins_serving || n.proteins_100g || 0) * 10) / 10,
        carbs:        Math.round((n.carbohydrates_serving || n.carbohydrates_100g || 0) * 10) / 10,
        fat:          Math.round((n.fat_serving || n.fat_100g || 0) * 10) / 10,
        fiber_g:         srv('fiber_serving', 'fiber_100g'),
        calcium_mg:      srv('calcium_serving', 'calcium_100g'),
        iron_mg:         srv('iron_serving', 'iron_100g'),
        vitamin_d_mcg:   srv('vitamin-d_serving', 'vitamin-d_100g'),
        vitamin_c_mg:    srv('vitamin-c_serving', 'vitamin-c_100g'),
        vitamin_b12_mcg: srv('vitamin-b12_serving', 'vitamin-b12_100g'),
        magnesium_mg:    srv('magnesium_serving', 'magnesium_100g'),
        zinc_mg:         srv('zinc_serving', 'zinc_100g'),
        potassium_mg:    srv('potassium_serving', 'potassium_100g'),
        omega3_g:        srv('omega-3-fat_serving', 'omega-3-fat_100g'),
      };

      setFound(result);
    } catch (e) {
      Alert.alert('Error', 'Could not look up this barcode. Check your connection.', [
        { text: 'Scan Again', onPress: () => { setScanned(false); setLoading(false); } },
        { text: 'Cancel', onPress: onClose },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Text style={s.title} numberOfLines={1}>Scan Barcode</Text>
        </View>

        {hasPermission === false && (
          <View style={s.center}>
            <Ionicons name="camera-outline" size={40} color={colors.textTertiary} />
            <Text style={s.permTitle}>Camera Access Needed</Text>
            <Text style={s.permSub}>Go to Settings → Fuelog → Camera to enable access.</Text>
            <TouchableOpacity style={s.cancelBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={s.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {hasPermission === true && !found && (
          <View style={s.scannerWrap}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              facing="back"
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
            />
            <View style={s.overlay}>
              <View style={s.overlayTop} />
              <View style={[s.overlayMiddle, { height: SCAN_BOX }]}>
                <View style={s.overlaySide} />
                <View style={[s.scanBox, { width: SCAN_BOX, height: SCAN_BOX }]}>
                  <View style={[s.corner, s.cornerTL]} />
                  <View style={[s.corner, s.cornerTR]} />
                  <View style={[s.corner, s.cornerBL]} />
                  <View style={[s.corner, s.cornerBR]} />
                </View>
                <View style={s.overlaySide} />
              </View>
              <View style={s.overlayBottom}>
                {loading
                  ? <ActivityIndicator color={colors.text} size="large" />
                  : <Text style={s.hint}>Point at a barcode to scan</Text>}
                <TouchableOpacity style={s.cancelBtn} onPress={onClose} activeOpacity={0.8}>
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {found && (
          <View style={s.result}>
            <Text style={s.resultCheck}>✓</Text>
            <Text style={s.resultName} numberOfLines={2}>{found.name}</Text>
            {!!found.brand && <Text style={s.resultBrand}>{found.brand}</Text>}
            <Text style={s.resultServing}>Per {found.serving_size}</Text>
            <View style={s.macroGrid}>
              <View style={s.macroBox}>
                <Text style={s.macroVal}>{found.calories}</Text>
                <Text style={s.macroLabel}>Calories</Text>
              </View>
              <View style={s.macroBox}>
                <Text style={[s.macroVal, { color: MC.protein.color }]}>{found.protein}g</Text>
                <Text style={s.macroLabel}>Protein</Text>
              </View>
              <View style={s.macroBox}>
                <Text style={[s.macroVal, { color: MC.carbs.color }]}>{found.carbs}g</Text>
                <Text style={s.macroLabel}>Carbs</Text>
              </View>
              <View style={s.macroBox}>
                <Text style={[s.macroVal, { color: MC.fat.color }]}>{found.fat}g</Text>
                <Text style={s.macroLabel}>Fat</Text>
              </View>
            </View>
            <TouchableOpacity style={s.useBtn} onPress={() => { onResult(found); onClose(); }} activeOpacity={0.8}>
              <Text style={s.useBtnText}>Add to Log</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.scanAgainBtn} onPress={() => { setFound(null); setScanned(false); }}>
              <Text style={s.scanAgainText}>Scan Another</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.scanAgainBtn} onPress={onClose}>
              <Text style={s.scanAgainText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
    title: { fontSize: 20, fontWeight: weight.heavy, color: c.text },
    cancelBtn: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.45)', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: radius.pill, paddingHorizontal: 32, paddingVertical: 12 },
    cancelBtnText: { color: c.text, fontSize: 15, fontWeight: weight.heavy },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16 },
    permIcon: { fontSize: 48 },
    permTitle: { fontSize: 20, fontWeight: weight.heavy, color: c.text, textAlign: 'center' },
    permSub: { fontSize: 14, color: c.textTertiary, textAlign: 'center', lineHeight: 22 },
    scannerWrap: { flex: 1, position: 'relative' },
    overlay: { ...StyleSheet.absoluteFillObject, flexDirection: 'column' },
    overlayTop: { flex: 1, backgroundColor: OVERLAY },
    overlayMiddle: { flexDirection: 'row' },
    overlaySide: { flex: 1, backgroundColor: OVERLAY },
    scanBox: { position: 'relative' },
    corner: { position: 'absolute', width: 24, height: 24, borderColor: c.accent, borderWidth: 3 },
    cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
    cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
    cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
    cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
    overlayBottom: { flex: 1, backgroundColor: OVERLAY, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 28, gap: 20 },
    hint: { color: c.text, fontSize: 14, fontWeight: weight.semibold, opacity: 0.8 },
    result: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 8 },
    resultCheck: { fontSize: 56, marginBottom: 8 },
    resultName: { fontSize: 22, fontWeight: weight.heavy, color: c.text, textAlign: 'center', letterSpacing: -0.5 },
    resultBrand: { fontSize: 14, color: c.textTertiary, fontWeight: weight.semibold },
    resultServing: { fontSize: 12, color: c.textTertiary, fontWeight: weight.medium, marginBottom: 8 },
    macroGrid: { flexDirection: 'row', gap: 12, marginVertical: 16, width: '100%' },
    macroBox: { backgroundColor: c.card, borderRadius: radius.card, padding: 16, alignItems: 'center', flex: 1, borderWidth: 1, borderColor: c.border },
    macroVal: { fontSize: 20, fontWeight: weight.heavy, color: c.text },
    macroLabel: { fontSize: 10, color: c.textTertiary, fontWeight: weight.semibold, marginTop: 4 },
    useBtn: { backgroundColor: c.accent, borderRadius: radius.card, paddingVertical: 16, marginTop: 8, width: '100%', alignItems: 'center' },
    useBtnText: { color: c.accentText, fontSize: 16, fontWeight: weight.heavy },
    scanAgainBtn: { paddingVertical: 14, width: '100%', alignItems: 'center' },
    scanAgainText: { color: c.textSecondary, fontSize: 14, fontWeight: weight.bold },
  });
}
