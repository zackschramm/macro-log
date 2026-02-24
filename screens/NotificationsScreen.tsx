import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

interface NotifSetting {
  id: string;
  label: string;
  emoji: string;
  description: string;
  hour: number;
  minute: number;
  enabled: boolean;
}

const DEFAULT_SETTINGS: NotifSetting[] = [
  { id: 'breakfast', label: 'Breakfast Reminder', emoji: '🍳', description: 'Log your breakfast', hour: 8, minute: 0, enabled: false },
  { id: 'lunch', label: 'Lunch Reminder', emoji: '🥗', description: 'Log your lunch', hour: 12, minute: 0, enabled: false },
  { id: 'dinner', label: 'Dinner Reminder', emoji: '🍽️', description: 'Log your dinner', hour: 18, minute: 30, enabled: false },
  { id: 'water', label: 'Water Reminder', emoji: '💧', description: 'Stay hydrated!', hour: 14, minute: 0, enabled: false },
  { id: 'workout', label: 'Workout Reminder', emoji: '💪', description: 'Time to train!', hour: 17, minute: 0, enabled: false },
  { id: 'checkin', label: 'Daily Check-in', emoji: '📊', description: 'Review your macros for the day', hour: 21, minute: 0, enabled: false },
];

const STORAGE_KEY = 'notif_settings';

function fmtTime(hour: number, minute: number) {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  const m = minute.toString().padStart(2, '0');
  return `${h}:${m} ${ampm}`;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];

export default function NotificationsScreen() {
  const [settings, setSettings] = useState<NotifSetting[]>(DEFAULT_SETTINGS);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
    checkPermission();
  }, []);

  const checkPermission = async () => {
    const { status } = await Notifications.getPermissionsAsync();
    setHasPermission(status === 'granted');
  };

  const requestPermission = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    setHasPermission(status === 'granted');
    return status === 'granted';
  };

  const loadSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) setSettings(JSON.parse(stored));
    } catch {}
  };

  const saveSettings = async (newSettings: NotifSetting[]) => {
    setSettings(newSettings);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
  };

  const scheduleNotification = async (setting: NotifSetting) => {
    await Notifications.cancelScheduledNotificationAsync(setting.id).catch(() => {});
    if (!setting.enabled) return;
    await Notifications.scheduleNotificationAsync({
      identifier: setting.id,
      content: {
        title: setting.label,
        body: setting.description,
        sound: true,
      },
      trigger: {
        hour: setting.hour,
        minute: setting.minute,
        repeats: true,
      } as any,
    });
  };

  const toggleNotif = async (id: string) => {
    let granted = hasPermission;
    if (!granted) {
      granted = await requestPermission();
      if (!granted) {
        Alert.alert('Permission Required', 'Enable notifications in Settings to use reminders.');
        return;
      }
    }
    const updated = settings.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s);
    await saveSettings(updated);
    const setting = updated.find(s => s.id === id)!;
    await scheduleNotification(setting);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const updateTime = async (id: string, hour: number, minute: number) => {
    const updated = settings.map(s => s.id === id ? { ...s, hour, minute } : s);
    await saveSettings(updated);
    const setting = updated.find(s => s.id === id)!;
    if (setting.enabled) await scheduleNotification(setting);
  };

  const testNotif = async () => {
    let granted = hasPermission;
    if (!granted) granted = await requestPermission();
    if (!granted) return;
    await Notifications.scheduleNotificationAsync({
      content: { title: '🔔 MacroLog', body: 'Notifications are working!', sound: true },
      trigger: { seconds: 2 } as any,
    });
    Alert.alert('Test Sent', 'You\'ll get a notification in 2 seconds.');
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Reminders</Text>
        <TouchableOpacity style={s.testBtn} onPress={testNotif}>
          <Text style={s.testBtnText}>Test</Text>
        </TouchableOpacity>
      </View>

      {hasPermission === false && (
        <TouchableOpacity style={s.permBanner} onPress={requestPermission}>
          <Text style={s.permBannerIcon}>🔔</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.permBannerTitle}>Enable Notifications</Text>
            <Text style={s.permBannerSub}>Tap to allow reminders</Text>
          </View>
          <Text style={s.permBannerArrow}>›</Text>
        </TouchableOpacity>
      )}

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.sectionTitle}>DAILY REMINDERS</Text>
        {settings.map(setting => (
          <View key={setting.id} style={s.card}>
            <TouchableOpacity style={s.cardRow} onPress={() => toggleNotif(setting.id)} activeOpacity={0.7}>
              <Text style={s.cardEmoji}>{setting.emoji}</Text>
              <View style={s.cardInfo}>
                <Text style={s.cardLabel}>{setting.label}</Text>
                <Text style={s.cardDesc}>{setting.description}</Text>
              </View>
              <View style={s.cardRight}>
                <Text style={[s.cardTime, setting.enabled && s.cardTimeActive]}>
                  {fmtTime(setting.hour, setting.minute)}
                </Text>
                <View style={[s.toggle, setting.enabled && s.toggleOn]}>
                  <View style={[s.toggleThumb, setting.enabled && s.toggleThumbOn]} />
                </View>
              </View>
            </TouchableOpacity>

            {setting.enabled && (
              <View style={s.timePicker}>
                <Text style={s.timePickerLabel}>Time</Text>
                <View style={s.timePickerRow}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.timeChips}>
                    {HOURS.map(h => (
                      <TouchableOpacity
                        key={h}
                        style={[s.timeChip, setting.hour === h && s.timeChipActive]}
                        onPress={() => updateTime(setting.id, h, setting.minute)}>
                        <Text style={[s.timeChipText, setting.hour === h && s.timeChipTextActive]}>
                          {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
                <View style={s.minuteRow}>
                  {MINUTES.map(m => (
                    <TouchableOpacity
                      key={m}
                      style={[s.minuteChip, setting.minute === m && s.minuteChipActive]}
                      onPress={() => updateTime(setting.id, setting.hour, m)}>
                      <Text style={[s.minuteChipText, setting.minute === m && s.minuteChipTextActive]}>
                        :{m.toString().padStart(2, '0')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        ))}

        <Text style={s.footnote}>
          Reminders repeat daily at the time you set. Toggle off to disable.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  testBtn: { backgroundColor: '#252525', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  testBtnText: { color: '#888', fontSize: 13, fontWeight: '700' },
  permBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', margin: 16, borderRadius: 14, padding: 14, gap: 12 },
  permBannerIcon: { fontSize: 24 },
  permBannerTitle: { fontSize: 14, fontWeight: '800', color: '#fff' },
  permBannerSub: { fontSize: 12, color: '#4a9eff', fontWeight: '500', marginTop: 2 },
  permBannerArrow: { color: '#4a9eff', fontSize: 20, fontWeight: '700' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#444', letterSpacing: 1.5, marginBottom: 12 },
  card: { backgroundColor: '#1a1a1a', borderRadius: 16, marginBottom: 10, overflow: 'hidden' },
  cardRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  cardEmoji: { fontSize: 26 },
  cardInfo: { flex: 1 },
  cardLabel: { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 2 },
  cardDesc: { fontSize: 12, color: '#555', fontWeight: '500' },
  cardRight: { alignItems: 'flex-end', gap: 6 },
  cardTime: { fontSize: 12, color: '#444', fontWeight: '700' },
  cardTimeActive: { color: '#4ade80' },
  toggle: { width: 44, height: 26, borderRadius: 13, backgroundColor: '#2a2a2a', padding: 2, justifyContent: 'center' },
  toggleOn: { backgroundColor: '#4ade80' },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#555', alignSelf: 'flex-start' },
  toggleThumbOn: { backgroundColor: '#fff', alignSelf: 'flex-end' },
  timePicker: { borderTopWidth: 1, borderTopColor: '#222', paddingHorizontal: 16, paddingBottom: 14, paddingTop: 12 },
  timePickerLabel: { fontSize: 10, fontWeight: '700', color: '#444', letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' },
  timePickerRow: { marginBottom: 10 },
  timeChips: { gap: 6, paddingRight: 8 },
  timeChip: { backgroundColor: '#252525', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  timeChipActive: { backgroundColor: '#fff' },
  timeChipText: { color: '#555', fontSize: 12, fontWeight: '700' },
  timeChipTextActive: { color: '#000' },
  minuteRow: { flexDirection: 'row', gap: 8 },
  minuteChip: { backgroundColor: '#252525', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  minuteChipActive: { backgroundColor: '#fff' },
  minuteChipText: { color: '#555', fontSize: 13, fontWeight: '700' },
  minuteChipTextActive: { color: '#000' },
  footnote: { fontSize: 12, color: '#333', textAlign: 'center', marginTop: 16, lineHeight: 20, fontWeight: '500' },
});
