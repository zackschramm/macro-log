import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './hooks/useAuth';
import AuthScreen from './screens/AuthScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import MainTabs from './screens/MainTabs';
import { supabase } from './constants/supabase';
import { configureRevenueCat, loginRevenueCat, logoutRevenueCat } from './constants/purchases';

// Configure RevenueCat once when the module loads — before any component mounts.
configureRevenueCat();

function AppContent() {
  const { session, loading } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    if (session?.user) {
      loginRevenueCat(session.user.id);
      supabase.from('profiles').select('*').eq('id', session.user.id).single()
        .then(({ data }) => { setProfile(data); setProfileLoading(false); });
    } else {
      logoutRevenueCat();
      setProfile(null);
      setProfileLoading(false);
    }
  }, [session]);

  if (loading || (session && profileLoading)) {
    return (
      <View style={{ flex: 1, backgroundColor: '#121212', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  if (!session) return <AuthScreen />;
  if (!profile?.calories) return <OnboardingScreen onComplete={setProfile} />;
  return <MainTabs profile={profile} onProfileUpdate={setProfile} />;
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
