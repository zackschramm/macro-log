import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './hooks/useAuth';
import AuthScreen from './screens/AuthScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import MainTabs from './screens/MainTabs';
import { supabase } from './constants/supabase';
import { configureRevenueCat, loginRevenueCat, logoutRevenueCat } from './constants/purchases';
import { UnitsProvider } from './constants/units';

// Configure RevenueCat once when the module loads — before any component mounts.
configureRevenueCat();

function AppContent() {
  const { session, loading } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);

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
