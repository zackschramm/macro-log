import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import * as Linking from 'expo-linking';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './hooks/useAuth';
import AuthScreen from './screens/AuthScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import MainTabs from './screens/MainTabs';
import ResetPasswordScreen from './screens/ResetPasswordScreen';
import { supabase } from './constants/supabase';
import { configureRevenueCat, loginRevenueCat, logoutRevenueCat } from './constants/purchases';
import { UnitsProvider } from './constants/units';

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

function AppContent() {
  const { session, loading } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  // Handle the fuelog://reset-password deep link, both when the app is opened
  // fresh from the link (getInitialURL) and when it's already running (addEventListener).
  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!isPasswordRecoveryUrl(url) || !url) return;
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
      loginRevenueCat(session.user.id);
      supabase.from('profiles').select('*').eq('id', session.user.id).single()
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error && error.code !== 'PGRST116') {
            // PGRST116 = "no rows" — expected for brand-new accounts that hit onboarding next.
            console.log('profile fetch error:', error.message);
          }
          setProfile(data ?? null);
          setProfileLoading(false);
        });
    } else {
      logoutRevenueCat();
      setProfile(null);
      setProfileLoading(false);
    }
    return () => { cancelled = true; };
  }, [session]);

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
  // Gate onboarding on profile completion markers set in OnboardingScreen.handleFinish
  // (name + weight_lbs). Using `calories` here was unsafe — recalcs could zero it out
  // and re-onboard a returning user.
  const onboarded = profile && profile.name && profile.weight_lbs;
  if (!onboarded) return <OnboardingScreen onComplete={setProfile} />;
  return (
    <UnitsProvider initialSystem={profile.unit_system}>
      <MainTabs profile={profile} onProfileUpdate={setProfile} />
    </UnitsProvider>
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
