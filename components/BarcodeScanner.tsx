import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator, Alert,
} from 'react-native';
import { CameraView, Camera } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';

interface NutritionResult {
  name: string;
  brand: string;
  serving_size: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onResult: (result: NutritionResult) => void;
}

export default function BarcodeScanner({ visible, onClose, onResult }: Props) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [found, setFound] = useState<NutritionResult | null>(null);

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

      const result: NutritionResult = {
        name: p.product_name || p.generic_name || 'Unknown Food',
        brand: p.brands || '',
        serving_size: p.serving_size || '100g',
        calories: Math.round(n['energy-kcal_serving'] || n['energy-kcal_100g'] || 0),
        protein: Math.round((n.proteins_serving || n.proteins_100g || 0) * 10) / 10,
        carbs: Math.round((n.carbohydrates_serving || n.carbohydrates_100g || 0) * 10) / 10,
        fat: Math.round((n.fat_serving || n.fat_100g || 0) * 10) / 10,
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
          <Text style={s.title}>Scan Barcode</Text>
          <TouchableOpacity style={s.closeBtn} onPress={onClose}>
            <Text style={s.closeBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {hasPermission === false && (
          <View style={s.center}>
            <Text style={s.permIcon}>📷</Text>
            <Text style={s.permTitle}>Camera Access Needed</Text>
            <Text style={s.permSub}>Go to Settings → MacroLog → Camera to enable access.</Text>
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
              <View style={s.overlayMiddle}>
                <View style={s.overlaySide} />
                <View style={s.scanBox}>
                  <View style={[s.corner, s.cornerTL]} />
                  <View style={[s.corner, s.cornerTR]} />
                  <View style={[s.corner, s.cornerBL]} />
                  <View style={[s.corner, s.cornerBR]} />
                </View>
                <View style={s.overlaySide} />
              </View>
              <View style={s.overlayBottom}>
                {loading
                  ? <ActivityIndicator color="#fff" size="large" />
                  : <Text style={s.hint}>Point at a barcode to scan</Text>}
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
                <Text style={[s.macroVal, { color: '#4a9eff' }]}>{found.protein}g</Text>
                <Text style={s.macroLabel}>Protein</Text>
              </View>
              <View style={s.macroBox}>
                <Text style={[s.macroVal, { color: '#fbbf24' }]}>{found.carbs}g</Text>
                <Text style={s.macroLabel}>Carbs</Text>
              </View>
              <View style={s.macroBox}>
                <Text style={[s.macroVal, { color: '#f472b6' }]}>{found.fat}g</Text>
                <Text style={s.macroLabel}>Fat</Text>
              </View>
            </View>
            <TouchableOpacity style={s.useBtn} onPress={() => { onResult(found); onClose(); }} activeOpacity={0.8}>
              <Text style={s.useBtnText}>Add to Log</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.scanAgainBtn} onPress={() => { setFound(null); setScanned(false); }}>
              <Text style={s.scanAgainText}>Scan Another</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const SCAN_BOX = 240;
const OVERLAY = 'rgba(0,0,0,0.6)';

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { fontSize: 20, fontWeight: '900', color: '#fff' },
  closeBtn: { backgroundColor: '#252525', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  closeBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16 },
  permIcon: { fontSize: 48 },
  permTitle: { fontSize: 20, fontWeight: '900', color: '#fff', textAlign: 'center' },
  permSub: { fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 22 },
  scannerWrap: { flex: 1, position: 'relative' },
  overlay: { ...StyleSheet.absoluteFillObject, flexDirection: 'column' },
  overlayTop: { flex: 1, backgroundColor: OVERLAY },
  overlayMiddle: { flexDirection: 'row', height: SCAN_BOX },
  overlaySide: { flex: 1, backgroundColor: OVERLAY },
  scanBox: { width: SCAN_BOX, height: SCAN_BOX, position: 'relative' },
  corner: { position: 'absolute', width: 24, height: 24, borderColor: '#fff', borderWidth: 3 },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  overlayBottom: { flex: 1, backgroundColor: OVERLAY, alignItems: 'center', justifyContent: 'center' },
  hint: { color: '#fff', fontSize: 14, fontWeight: '600', opacity: 0.8 },
  result: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 8 },
  resultCheck: { fontSize: 56, marginBottom: 8 },
  resultName: { fontSize: 22, fontWeight: '900', color: '#fff', textAlign: 'center', letterSpacing: -0.5 },
  resultBrand: { fontSize: 14, color: '#555', fontWeight: '600' },
  resultServing: { fontSize: 12, color: '#444', fontWeight: '500', marginBottom: 8 },
  macroGrid: { flexDirection: 'row', gap: 12, marginVertical: 16, width: '100%' },
  macroBox: { backgroundColor: '#1a1a1a', borderRadius: 14, padding: 16, alignItems: 'center', flex: 1 },
  macroVal: { fontSize: 20, fontWeight: '900', color: '#fff' },
  macroLabel: { fontSize: 10, color: '#555', fontWeight: '600', marginTop: 4 },
  useBtn: { backgroundColor: '#fff', borderRadius: 14, paddingVertical: 16, marginTop: 8, width: '100%', alignItems: 'center' },
  useBtnText: { color: '#000', fontSize: 16, fontWeight: '800' },
  scanAgainBtn: { paddingVertical: 14, width: '100%', alignItems: 'center' },
  scanAgainText: { color: '#555', fontSize: 14, fontWeight: '700' },
});
