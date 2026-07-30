import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, AppState } from 'react-native';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { handleWearableRedirect } from './utils/wearables';
import { getPendingSiriFoodLog } from './utils/widgetSync';
import AuthScreen from './screens/AuthScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import MainTabs from './screens/MainTabs';
import ResetPasswordScreen from './screens/ResetPasswordScreen';
import { supabase } from './constants/supabase';
import { configureRevenueCat, loginRevenueCat, logoutRevenueCat } from './constants/purchases';
import { migrateLegacyTrialCounts } from './utils/proGate';
import { UnitsProvider } from './constants/units';
import { RestTimerProvider } from './contexts/RestTimerContext';
import {
  requestNotificationPermission,
  scheduleOnboardingNotifications,
  maybeScheduleProNotification,
} from './utils/notifications';
import { initErrorReporting, logError, setErrorUser } from './utils/logError';
import { identify } from './utils/analytics';

// Crash reporting first, so anything that blows up during the rest of module
// init is captured. No-ops cleanly until a Sentry DSN is configured —
// see the "WHERE TO PASTE YOUR SENTRY DSN" comment in utils/logError.ts.
initErrorReporting();

// Configure RevenueCat once when the module loads — before any component mounts.
configureRevenueCat();

// Extracts auth params from a "fuelog://reset-password" deep link. Supabase appends
// these either as a URL fragment (#access_token=...&type=recovery) for the implicit
// flow, or as a query string (?code=...) for the PKCE flow.
function parseAuthParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const addParams = (str: string) => {
    for (const part of str.split('&')) {
      if (!part) continue;
      const [key, value] = part.split('=');
      if (key) params[decodeURIComponent(key)] = decodeURIComponent(value ?? '');
    }
  };

  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');
  if (queryIndex !== -1) {
    const end = hashIndex !== -1 && hashIndex > queryIndex ? hashIndex : url.length;
    addParams(url.slice(queryIndex + 1, end));
  }
  if (hashIndex !== -1) {
    addParams(url.slice(hashIndex + 1));
  }
  return params;
}

function isPasswordRecoveryUrl(url: string | null): boolean {
  if (!url) return false;
  return url.includes('reset-password');
}

// Extracts a referral code from fuelog://invite/CODE or https://fuelog.app/invite/CODE
function extractInviteCode(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/invite\/([A-Z0-9]+)/i);
  return match ? match[1].toUpperCase() : null;
}

function AppContent() {
  const { session, loading } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [initialTab, setInitialTab] = useState<string | undefined>(undefined);
  const [pendingTab, setPendingTab] = useState<string | undefined>(undefined);
  const [pendingSiriFood, setPendingSiriFood] = useState<string | undefined>(undefined);
  const notifSetupDone = useRef(false);

  // Handle the fuelog://reset-password deep link, both when the app is opened
  // fresh from the link (getInitialURL) and when it's already running (addEventListener).
  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url) return;

      // Store any referral invite code for processing after sign-up
      const inviteCode = extractInviteCode(url);
      if (inviteCode) {
        await AsyncStorage.setItem('fuelog_pending_referral_code', inviteCode);
      }

      // Whoop/Oura OAuth normally completes inside WebBrowser.openAuthSessionAsync's own
      // promise (see connectWearable in utils/wearables.ts). But if iOS backgrounds the app
      // during the auth session, the redirect can come back through this normal deep-link
      // path instead — without this handler, the code was silently dropped and the user was
      // just bounced back into the app with nothing connected.
      if (url.includes('wearable-callback')) {
        WebBrowser.dismissAuthSession();
        await handleWearableRedirect(url);
        return;
      }

      if (!isPasswordRecoveryUrl(url)) return;
      const params = parseAuthParams(url);

      try {
        if (params.access_token && params.refresh_token) {
          // Implicit flow: tokens are passed directly in the link.
          const { error } = await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          });
          if (error) {
            console.log('password recovery setSession error:', error.message);
            return;
          }
        } else if (params.code) {
          // PKCE flow: exchange the code for a session.
          const { error } = await supabase.auth.exchangeCodeForSession(params.code);
          if (error) {
            console.log('password recovery exchangeCodeForSession error:', error.message);
            return;
          }
        } else {
          return;
        }
        setPasswordRecovery(true);
      } catch (e: any) {
        console.log('password recovery link handling error:', e?.message ?? e);
      }
    };

    Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (session?.user) {
      setErrorUser(session.user.id);
      identify(session.user.id);
      loginRevenueCat(session.user.id);
      // One-time move of the old device-local AI trial counters to the server.
      // Without it, everyone updating from a previous build would get a fresh
      // set of free uses. No-ops after the first success; retries on failure.
      migrateLegacyTrialCounts();
      supabase.from('profiles').select('*').eq('id', session.user.id).single()
        .then(async ({ data, error }) => {
          if (cancelled) return;
          if (error && error.code !== 'PGRST116') {
            // PGRST116 = "no rows" — expected for brand-new accounts that hit onboarding next.
            console.log('profile fetch error:', error.message);
          }
          setProfile(data ?? null);
          setProfileLoading(false);

          // Link this user as a referee if they signed up via a referral invite
          if (data && !data.referred_by) {
            const pendingCode = await AsyncStorage.getItem('fuelog_pending_referral_code');
            if (pendingCode) {
              const { data: referrer } = await supabase
                .from('profiles')
                .select('id')
                .eq('referral_code', pendingCode)
                .single();
              if (referrer && referrer.id !== session.user.id) {
                await supabase.from('referrals').insert({
                  referrer_id: referrer.id,
                  referee_id: session.user.id,
                  referral_code: pendingCode,
                  status: 'signed_up',
                  signed_up_at: new Date().toISOString(),
                });
                await supabase.from('profiles').update({ referred_by: pendingCode }).eq('id', session.user.id);
              }
              await AsyncStorage.removeItem('fuelog_pending_referral_code');
            }
          }
        });
    } else {
      setErrorUser(null);
      identify(null);
      logoutRevenueCat();
      setProfile(null);
      setProfileLoading(false);
    }
    return () => { cancelled = true; };
  }, [session]);

  const onboarded = profile && profile.weight_lbs;

  // Handle proactive coach notification taps — both cold-start and background→foreground
  useEffect(() => {
    if (!session) return;
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (response?.notification.request.content.data?.deepLink === 'fuelog://coach') {
        AsyncStorage.setItem('fuelog_coach_from_proactive', '1').catch(() => {});
        setInitialTab('coach');
      }
    });
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      if (response.notification.request.content.data?.deepLink === 'fuelog://coach') {
        AsyncStorage.setItem('fuelog_coach_from_proactive', '1').catch(() => {});
        setPendingTab('coach');
      }
    });
    return () => sub.remove();
  }, [!!session]);

  // Handle the "Log <food> in Fuelog" Siri App Intent — it hands off the food
  // description via the shared App Group rather than a deep link, since the
  // intent runs before the app is guaranteed to be foregrounded. Check on
  // cold start and every time the app comes back to the foreground.
  useEffect(() => {
    if (!session) return;
    const checkPendingSiriFood = async () => {
      const pending = await getPendingSiriFoodLog();
      if (!pending) return;
      // Ignore stale entries in case the app never got foregrounded to clear
      // them (e.g. Siri only spoke a confirmation and never actually opened it).
      if (Date.now() / 1000 - pending.timestamp > 600) return;
      setPendingSiriFood(pending.food);
      setPendingTab('log');
    };
    checkPendingSiriFood();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkPendingSiriFood();
    });
    return () => sub.remove();
  }, [!!session]);

  useEffect(() => {
    if (!onboarded || notifSetupDone.current) return;
    notifSetupDone.current = true;
    (async () => {
      const notifEnabled = await AsyncStorage.getItem('fuelog_notifications_enabled');
      if (notifEnabled === null) await requestNotificationPermission();

      const completionDate = await AsyncStorage.getItem('fuelog_onboarding_complete');
      if (!completionDate) {
        await AsyncStorage.setItem('fuelog_onboarding_complete', String(Date.now()));
      }

      await scheduleOnboardingNotifications();
      await maybeScheduleProNotification();
    })();
  }, [onboarded]);

  if (loading || (session && profileLoading)) {
    return (
      <View style={{ flex: 1, backgroundColor: '#121212', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  // Password recovery takes priority over the normal session/onboarding flow —
  // the user has a valid (recovery) session at this point but still needs to set
  // a new password before continuing into the app.
  if (passwordRecovery) {
    return <ResetPasswordScreen onDone={() => setPasswordRecovery(false)} />;
  }

  if (!session) return <AuthScreen />;
  if (!onboarded) return (
    <OnboardingScreen onComplete={(p, tab) => { setProfile(p); if (tab) setInitialTab(tab); }} />
  );
  return (
    <RestTimerProvider>
      <UnitsProvider initialSystem={profile.unit_system}>
        <MainTabs
          profile={profile}
          onProfileUpdate={setProfile}
          initialTab={initialTab}
          forceTab={pendingTab}
          onTabApplied={() => setPendingTab(undefined)}
          pendingSiriFood={pendingSiriFood}
          onSiriFoodApplied={() => setPendingSiriFood(undefined)}
        />
      </UnitsProvider>
    </RestTimerProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
