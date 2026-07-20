import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';

const SUPABASE_URL = 'https://zbcxuffgmjuqarapfdwb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQ4NjIsImV4cCI6MjA4NzQwMDg2Mn0.lUng1tY_aAuee_t8-E5MSUHdm2PF3HzsE41L-kzBmJE';

export const PROACTIVE_NOTIF_CONTEXT_KEY = 'fuelog_proactive_notif_context';

// Module-level flag: set eagerly to prevent concurrent or repeated calls within one app session.
let _checkedThisSession = false;

export async function checkAndSendProactiveInsight(userId: string): Promise<void> {
  if (_checkedThisSession) return;
  _checkedThisSession = true;

  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    // Quick client-side rate limit to avoid a round-trip when we already sent one today
    const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('proactive_notifications')
      .select('id')
      .eq('user_id', userId)
      .gte('sent_at', twentyThreeHoursAgo)
      .limit(1);
    if (recent?.length) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/proactive-coach`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ localHour: new Date().getHours() }),
    });
    const result = await res.json();

    if (!result.triggered) return;

    await AsyncStorage.setItem(
      PROACTIVE_NOTIF_CONTEXT_KEY,
      JSON.stringify({ body: result.body, type: result.type })
    );

    await Notifications.scheduleNotificationAsync({
      content: {
        title: result.title,
        body: result.body,
        sound: true,
        data: { deepLink: result.deepLink },
      },
      trigger: null,
    });
  } catch {
    // Never crash the app — proactive coaching is best-effort
  }
}
