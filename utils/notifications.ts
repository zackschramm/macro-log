import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasPro } from '../constants/purchases';
import { logError } from './logError';

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    const granted = status === 'granted';
    await AsyncStorage.setItem('fuelog_notifications_enabled', granted ? '1' : '0');
    return granted;
  } catch {
    return false;
  }
}

export async function scheduleOnboardingNotifications(): Promise<void> {
  try {
    const completedStr = await AsyncStorage.getItem('fuelog_onboarding_complete');
    if (!completedStr) return;

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const completedDate = new Date(parseInt(completedStr, 10) || Date.parse(completedStr));
    const now = new Date();

    const day3Scheduled = await AsyncStorage.getItem('fuelog_day3_notif_scheduled');
    if (!day3Scheduled) {
      const day3 = new Date(completedDate);
      day3.setDate(day3.getDate() + 3);
      if (day3 > now) {
        await Notifications.scheduleNotificationAsync({
          identifier: 'fuelog_day3_notif',
          content: {
            title: 'Your AI Coach is ready',
            body: 'Ask it anything about your macros, recovery, or workout plan',
            sound: true,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: day3,
          },
        });
      }
      await AsyncStorage.setItem('fuelog_day3_notif_scheduled', '1');
    }

    const day7Scheduled = await AsyncStorage.getItem('fuelog_day7_notif_scheduled');
    if (!day7Scheduled) {
      const day7 = new Date(completedDate);
      day7.setDate(day7.getDate() + 7);
      if (day7 > now) {
        await Notifications.scheduleNotificationAsync({
          identifier: 'fuelog_day7_notif',
          content: {
            title: "You've been using Fuelog for a week!",
            body: 'Check your Stats tab to see your macro trend',
            sound: true,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: day7,
          },
        });
      }
      await AsyncStorage.setItem('fuelog_day7_notif_scheduled', '1');
    }
  } catch (e) { logError('notifications.scheduleOnboardingNotifications', e); }
}

export async function scheduleWeeklyInsightNotification(): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const existingId = await AsyncStorage.getItem('fuelog_weekly_insight_notif_id');
    if (existingId) {
      await Notifications.cancelScheduledNotificationAsync(existingId).catch(() => {});
    }

    // Next Monday at 8:00 AM
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon
    const daysUntil = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + daysUntil);
    nextMonday.setHours(8, 0, 0, 0);

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Your weekly fitness insight is ready',
        body: 'See how last week went and get your focus for this week.',
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: nextMonday,
      },
    });

    await AsyncStorage.setItem('fuelog_weekly_insight_notif_id', id);
  } catch (e) { logError('notifications.scheduleWeeklyInsightNotification', e); }
}

export async function maybeScheduleProNotification(): Promise<void> {
  try {
    const isPro = await hasPro();
    if (!isPro) return;

    const proStartKey = 'fuelog_pro_start_date';
    let proStartStr = await AsyncStorage.getItem(proStartKey);
    if (!proStartStr) {
      proStartStr = new Date().toISOString();
      await AsyncStorage.setItem(proStartKey, proStartStr);
    }

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const day30Scheduled = await AsyncStorage.getItem('fuelog_day30_notif_scheduled');
    if (!day30Scheduled) {
      const proStart = new Date(proStartStr);
      const day30 = new Date(proStart);
      day30.setDate(day30.getDate() + 30);
      if (day30 > new Date()) {
        await Notifications.scheduleNotificationAsync({
          identifier: 'fuelog_day30_notif',
          content: {
            title: 'Your 30-day check-in',
            body: 'Ask your AI Coach to review your progress and adjust your targets',
            sound: true,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: day30,
          },
        });
      }
      await AsyncStorage.setItem('fuelog_day30_notif_scheduled', '1');
    }
  } catch (e) { logError('notifications.maybeScheduleProNotification', e); }
}
