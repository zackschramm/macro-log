import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView,
  Image, Alert, TextInput, Dimensions, ActivityIndicator,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRef } from 'react-native-view-shot';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { useUnits } from '../constants/units';
import { useHealthKit } from '../hooks/useHealthKit';
import { logError } from '../utils/logError';

const PHOTOS_KEY = 'fuelog_progress_photos';
const MAX_PHOTOS = 50;
const PHOTO_DIR = FileSystem.documentDirectory + 'progress_photos/';

const { width } = Dimensions.get('window');
const THUMB = (width - spacing.lg * 2 - spacing.sm) / 2;

export interface ProgressPhoto {
  id: string;
  uri: string;
  date: string;
  weight?: number;
  weightUnit?: string;
  note?: string;
}

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(PHOTO_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
}

async function loadPhotos(): Promise<ProgressPhoto[]> {
  try {
    const raw = await AsyncStorage.getItem(PHOTOS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function savePhotos(photos: ProgressPhoto[]) {
  await AsyncStorage.setItem(PHOTOS_KEY, JSON.stringify(photos));
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtShort = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function ProgressPhotosScreen({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const u = useUnits();
  const health = useHealthKit();

  const [photos, setPhotos] = useState<ProgressPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [weightInput, setWeightInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [weightPromptVisible, setWeightPromptVisible] = useState(false);

  const [viewPhoto, setViewPhoto] = useState<ProgressPhoto | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [compareView, setCompareView] = useState<[ProgressPhoto, ProgressPhoto] | null>(null);

  const compareRef = useRef<View>(null);

  const refresh = useCallback(async () => {
    setPhotos(await loadPhotos());
  }, []);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  const pickPhoto = async () => {
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert('Storage Full', `You can store up to ${MAX_PHOTOS} progress photos. Delete some to add more.`);
      return;
    }
    if (photos.length >= MAX_PHOTOS - 5) {
      Alert.alert('Almost Full', `You have ${MAX_PHOTOS - photos.length} photo slots remaining.`);
    }

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    const libStatus = await ImagePicker.requestMediaLibraryPermissionsAsync();

    Alert.alert('Add Photo', 'Choose a source', [
      {
        text: 'Camera',
        onPress: async () => {
          if (status !== 'granted') {
            Alert.alert('Permission required', 'Camera access is needed to take a photo.'); return;
          }
          const result = await ImagePicker.launchCameraAsync({ quality: 0.85, allowsEditing: true });
          if (!result.canceled) await handlePicked(result.assets[0].uri);
        },
      },
      {
        text: 'Photo Library',
        onPress: async () => {
          if (libStatus.status !== 'granted') {
            Alert.alert('Permission required', 'Photo library access is needed.'); return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, allowsEditing: true, mediaTypes: ['images'] });
          if (!result.canceled) await handlePicked(result.assets[0].uri);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handlePicked = async (sourceUri: string) => {
    setAddingPhoto(true);
    try {
      await ensureDir();
      const id = Date.now().toString();
      const destUri = PHOTO_DIR + id + '.jpg';
      await FileSystem.copyAsync({ from: sourceUri, to: destUri });
      setPendingUri(destUri);

      let prefillWeight = '';
      if (health.isAuthorized) {
        const w = await health.getLatestWeight();
        if (w != null) prefillWeight = String(u.dispWeight(w));
      }
      setWeightInput(prefillWeight);
      setNoteInput('');
      setWeightPromptVisible(true);
    } catch (e: any) {
      Alert.alert('Error', 'Could not save photo. Please try again.');
    } finally {
      setAddingPhoto(false);
    }
  };

  const confirmAdd = async () => {
    if (!pendingUri) return;
    const id = pendingUri.split('/').pop()!.replace('.jpg', '');
    const wLbs = weightInput ? u.toLb(weightInput) : undefined;
    const photo: ProgressPhoto = {
      id,
      uri: pendingUri,
      date: new Date().toISOString(),
      weight: isNaN(wLbs!) ? undefined : wLbs,
      weightUnit: u.weightUnit,
      note: noteInput.trim() || undefined,
    };
    const updated = [photo, ...photos];
    await savePhotos(updated);
    setPhotos(updated);
    setWeightPromptVisible(false);
    setPendingUri(null);
    setWeightInput('');
    setNoteInput('');
  };

  const cancelAdd = async () => {
    if (pendingUri) {
      try { await FileSystem.deleteAsync(pendingUri, { idempotent: true }); } catch (e) { logError('ProgressPhotosScreen.cancelAdd', e); }
    }
    setWeightPromptVisible(false);
    setPendingUri(null);
  };

  const deletePhoto = (photo: ProgressPhoto) => {
    Alert.alert('Delete Photo', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await FileSystem.deleteAsync(photo.uri, { idempotent: true }); } catch (e) { logError('ProgressPhotosScreen.deletePhoto', e); }
          const updated = photos.filter(p => p.id !== photo.id);
          await savePhotos(updated);
          setPhotos(updated);
          setViewPhoto(null);
        },
      },
    ]);
  };

  const toggleSelect = (photo: ProgressPhoto) => {
    setSelected(prev => {
      if (prev.includes(photo.id)) return prev.filter(id => id !== photo.id);
      if (prev.length >= 2) return prev;
      return [...prev, photo.id];
    });
  };

  const startCompare = () => {
    if (selected.length !== 2) return;
    const [a, b] = selected.map(id => photos.find(p => p.id === id)!);
    const sorted = [a, b].sort((x, y) => new Date(x.date).getTime() - new Date(y.date).getTime());
    setCompareView([sorted[0], sorted[1]]);
    setCompareMode(false);
    setSelected([]);
  };

  const shareComparison = async () => {
    if (!compareRef.current) return;
    try {
      const uri = await captureRef(compareRef, { format: 'jpg', quality: 0.92 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'Share Progress' });
      } else {
        Alert.alert('Sharing not available on this device');
      }
    } catch {
      Alert.alert('Error', 'Could not capture comparison image.');
    }
  };

  const renderThumb = ({ item }: { item: ProgressPhoto }) => {
    const isSelected = selected.includes(item.id);
    return (
      <TouchableOpacity
        style={[s.thumb, isSelected && s.thumbSelected]}
        onPress={() => compareMode ? toggleSelect(item) : setViewPhoto(item)}
        activeOpacity={0.8}
      >
        <Image source={{ uri: item.uri }} style={s.thumbImg} resizeMode="cover" />
        {isSelected && (
          <View style={s.checkOverlay}>
            <Text style={s.checkMark}>✓</Text>
          </View>
        )}
        <View style={s.thumbMeta}>
          <Text style={s.thumbDate}>{fmtShort(item.date)}</Text>
          {item.weight != null && (
            <Text style={s.thumbWeight}>
              {u.dispWeight(item.weight)} {u.weightUnit}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={s.header}>
          {compareMode ? (
            <>
              <TouchableOpacity onPress={() => { setCompareMode(false); setSelected([]); }}>
                <Text style={s.headerCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={s.headerTitle}>
                {selected.length === 0 ? 'Select 2 Photos' : selected.length === 1 ? 'Select 1 More' : 'Ready to Compare'}
              </Text>
              <TouchableOpacity
                onPress={startCompare}
                disabled={selected.length !== 2}
                style={[s.compareBtn, selected.length !== 2 && s.compareBtnDisabled]}
              >
                <Text style={[s.compareBtnText, selected.length !== 2 && s.compareBtnTextDisabled]}>Compare</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={s.closeBtn} onPress={onClose}>
                <Text style={s.closeBtnText}>×</Text>
              </TouchableOpacity>
              <Text style={s.headerTitle}>Progress Photos</Text>
              <TouchableOpacity
                style={s.addBtn}
                onPress={pickPhoto}
                disabled={addingPhoto}
              >
                {addingPhoto ? <ActivityIndicator color={colors.accentText} size="small" /> : <Text style={s.addBtnText}>+ Add</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>

        {photos.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}></Text>
            <Text style={s.emptyTitle}>No photos yet</Text>
            <Text style={s.emptyText}>Tap "+ Add" to take or upload{'\n'}your first progress photo.</Text>
          </View>
        ) : (
          <>
            {photos.length > 1 && !compareMode && (
              <TouchableOpacity style={s.compareModeBtn} onPress={() => setCompareMode(true)}>
                <Text style={s.compareModeBtnText}>Before / After</Text>
              </TouchableOpacity>
            )}
            <FlashList
              data={photos}
              keyExtractor={p => p.id}
              renderItem={renderThumb}
              estimatedItemSize={220}
              numColumns={2}
              contentContainerStyle={s.grid}
              showsVerticalScrollIndicator={false}
            />
          </>
        )}

        {/* Weight prompt after picking photo */}
        <Modal visible={weightPromptVisible} transparent animationType="fade" onRequestClose={cancelAdd}>
          <View style={s.overlay}>
            <View style={s.sheet}>
              <Text style={s.sheetTitle}>Add Details</Text>
              <Text style={s.fieldLabel}>Current Weight ({u.weightUnit})</Text>
              <TextInput
                style={s.input}
                value={weightInput}
                onChangeText={setWeightInput}
                keyboardType="decimal-pad"
                placeholder={`e.g. ${u.isMetric ? '75' : '165'}`}
                placeholderTextColor={colors.textTertiary}
                autoFocus
              />
              <Text style={s.fieldLabel}>Note (optional)</Text>
              <TextInput
                style={[s.input, { height: 72 }]}
                value={noteInput}
                onChangeText={setNoteInput}
                placeholder="How are you feeling?"
                placeholderTextColor={colors.textTertiary}
                multiline
              />
              <TouchableOpacity style={s.saveBtn} onPress={confirmAdd}>
                <Text style={s.saveBtnText}>Save Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.skipBtn} onPress={confirmAdd}>
                <Text style={s.skipBtnText}>Skip weight</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Full-screen photo viewer */}
        {viewPhoto && (
          <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={() => setViewPhoto(null)}>
            <View style={s.fullScreen}>
              <Image source={{ uri: viewPhoto.uri }} style={s.fullImg} resizeMode="contain" />
              <SafeAreaView style={s.fullOverlay} edges={['top', 'bottom']}>
                <TouchableOpacity style={s.fullClose} onPress={() => setViewPhoto(null)}>
                  <Text style={s.fullCloseText}>×</Text>
                </TouchableOpacity>
                <View style={s.fullMeta}>
                  <Text style={s.fullDate}>{fmtDate(viewPhoto.date)}</Text>
                  {viewPhoto.weight != null && (
                    <Text style={s.fullWeight}>{u.dispWeight(viewPhoto.weight)} {u.weightUnit}</Text>
                  )}
                  {viewPhoto.note ? <Text style={s.fullNote}>{viewPhoto.note}</Text> : null}
                  <View style={s.fullActions}>
                    <TouchableOpacity style={s.fullDeleteBtn} onPress={() => deletePhoto(viewPhoto)}>
                      <Text style={s.fullDeleteText}>Delete</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.fullCompareBtn}
                      onPress={() => {
                        setViewPhoto(null);
                        setCompareMode(true);
                        setSelected([viewPhoto.id]);
                      }}
                    >
                      <Text style={s.fullCompareBtnText}>Compare</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </SafeAreaView>
            </View>
          </Modal>
        )}

        {/* Side-by-side comparison */}
        {compareView && (
          <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setCompareView(null)}>
            <View style={{ flex: 1, backgroundColor: '#000' }}>
              <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
                <View style={s.cmpHeader}>
                  <TouchableOpacity onPress={() => setCompareView(null)}>
                    <Text style={s.headerCancel}>Done</Text>
                  </TouchableOpacity>
                  <Text style={[s.headerTitle, { color: '#fff' }]}>Comparison</Text>
                  <TouchableOpacity onPress={shareComparison}>
                    <Text style={[s.addBtnText, { color: colors.accent }]}>Share</Text>
                  </TouchableOpacity>
                </View>

                <View ref={compareRef} collapsable={false} style={s.cmpContainer}>
                  {compareView.map((photo, idx) => (
                    <View key={photo.id} style={s.cmpSide}>
                      <Image source={{ uri: photo.uri }} style={s.cmpImg} resizeMode="cover" />
                      <View style={s.cmpLabel}>
                        <Text style={s.cmpLabelDate}>{fmtShort(photo.date)}</Text>
                        {photo.weight != null && (
                          <Text style={s.cmpLabelWeight}>
                            {u.dispWeight(photo.weight)} {u.weightUnit}
                          </Text>
                        )}
                        <Text style={s.cmpLabelTag}>{idx === 0 ? 'BEFORE' : 'AFTER'}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </SafeAreaView>
            </View>
          </Modal>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border },
    headerTitle: { fontSize: 17, fontWeight: weight.heavy, color: c.text },
    closeBtn: { backgroundColor: c.cardAlt, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    closeBtnText: { color: c.textSecondary, fontSize: 20, lineHeight: 22 },
    addBtn: { backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6, minWidth: 68, alignItems: 'center' },
    addBtnText: { color: c.accentText, fontSize: 13, fontWeight: weight.heavy },
    headerCancel: { color: c.accent, fontSize: 15, fontWeight: weight.semibold },
    compareBtn: { backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
    compareBtnDisabled: { backgroundColor: c.cardAlt },
    compareBtnText: { color: c.accentText, fontSize: 13, fontWeight: weight.heavy },
    compareBtnTextDisabled: { color: c.textTertiary },

    compareModeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.sm, backgroundColor: c.card, borderRadius: radius.md, borderWidth: 1, borderColor: c.border },
    compareModeBtnText: { color: c.accent, fontSize: 13, fontWeight: weight.bold },

    grid: { paddingVertical: spacing.lg, paddingHorizontal: spacing.lg - spacing.sm / 2 },

    thumb: { flex: 1, marginHorizontal: spacing.sm / 2, marginBottom: spacing.sm, borderRadius: radius.md, overflow: 'hidden', backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    thumbSelected: { borderColor: c.accent, borderWidth: 2 },
    thumbImg: { width: '100%', height: THUMB, backgroundColor: c.cardAlt },
    checkOverlay: { position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
    checkMark: { color: c.accentText, fontSize: 15, fontWeight: weight.heavy },
    thumbMeta: { padding: spacing.sm },
    thumbDate: { fontSize: 11, color: c.textSecondary, fontWeight: weight.semibold },
    thumbWeight: { fontSize: 13, color: c.text, fontWeight: weight.heavy, marginTop: 2 },

    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
    emptyIcon: { fontSize: 48, marginBottom: 16 },
    emptyTitle: { fontSize: 18, fontWeight: weight.heavy, color: c.text, marginBottom: 8 },
    emptyText: { fontSize: 14, color: c.textTertiary, textAlign: 'center', lineHeight: 22 },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.bgSecondary, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xxl, paddingBottom: spacing.xxxl + 16 },
    sheetTitle: { fontSize: 20, fontWeight: weight.heavy, color: c.text, marginBottom: spacing.xl },
    fieldLabel: { fontSize: 11, fontWeight: weight.bold, color: c.textTertiary, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
    input: { backgroundColor: c.card, borderRadius: radius.md, color: c.text, padding: 14, fontSize: 15, marginBottom: spacing.lg, borderWidth: 1, borderColor: c.border },
    saveBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 16, alignItems: 'center', marginTop: 4 },
    saveBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.heavy },
    skipBtn: { alignItems: 'center', padding: 12, marginTop: 4 },
    skipBtnText: { color: c.textTertiary, fontSize: 14, fontWeight: weight.medium },

    fullScreen: { flex: 1, backgroundColor: '#000' },
    fullImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    fullOverlay: { flex: 1, justifyContent: 'space-between' },
    fullClose: { alignSelf: 'flex-end', margin: spacing.lg, backgroundColor: 'rgba(0,0,0,0.5)', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    fullCloseText: { color: '#fff', fontSize: 22, lineHeight: 24 },
    fullMeta: { backgroundColor: 'rgba(0,0,0,0.7)', padding: spacing.xl, paddingBottom: spacing.xxl },
    fullDate: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: weight.semibold, marginBottom: 2 },
    fullWeight: { fontSize: 28, fontWeight: weight.heavy, color: '#fff' },
    fullNote: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4, fontStyle: 'italic' },
    fullActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    fullDeleteBtn: { flex: 1, borderRadius: radius.md, padding: 14, alignItems: 'center', backgroundColor: 'rgba(255,68,68,0.2)', borderWidth: 1, borderColor: 'rgba(255,68,68,0.4)' },
    fullDeleteText: { color: '#FF4444', fontSize: 14, fontWeight: weight.bold },
    fullCompareBtn: { flex: 1, borderRadius: radius.md, padding: 14, alignItems: 'center', backgroundColor: c.accent },
    fullCompareBtnText: { color: c.accentText, fontSize: 14, fontWeight: weight.bold },

    cmpHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    cmpContainer: { flex: 1, flexDirection: 'row', backgroundColor: '#000' },
    cmpSide: { flex: 1 },
    cmpImg: { flex: 1, width: '100%' },
    cmpLabel: { backgroundColor: 'rgba(0,0,0,0.75)', padding: spacing.md, alignItems: 'center' },
    cmpLabelDate: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: weight.semibold },
    cmpLabelWeight: { fontSize: 16, color: '#fff', fontWeight: weight.heavy, marginTop: 2 },
    cmpLabelTag: { fontSize: 9, color: 'rgba(255,255,255,0.4)', fontWeight: weight.bold, letterSpacing: 1.5, marginTop: 4 },
  });
}
