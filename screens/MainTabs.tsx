import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import LogScreen from './LogScreen';
import WorkoutScreen from './WorkoutScreen';
import ProfileScreen from './ProfileScreen';
import CoachScreen from './CoachScreen';
import MealPlanScreen from './MealPlanScreen';
import ProgressScreen from './ProgressScreen';
import ErrorBoundary from '../components/ErrorBoundary';
import NotificationsScreen from './NotificationsScreen';
import RecoveryScreen from './RecoveryScreen';
import FoodsScreen from './FoodsScreen';
import PlateCalculatorScreen from './PlateCalculatorScreen';
import SocialScreen from './SocialScreen';
import { useTheme, ThemeColors, weight } from '../constants/theme';
import { useRestTimer } from '../contexts/RestTimerContext';
import CancellationSaveModal from '../components/CancellationSaveModal';
import StatsBackfillPrompt from '../components/StatsBackfillPrompt';

type Tab = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
};

const TABS: Tab[] = [
  { key: 'log',        label: 'Home',    icon: 'restaurant-outline',  iconActive: 'restaurant'   },
  { key: 'workout',    label: 'Train',   icon: 'barbell-outline',     iconActive: 'barbell'      },
  { key: 'progress',   label: 'Stats',   icon: 'trending-up-outline', iconActive: 'trending-up'  },
  { key: 'coach',      label: 'Coach',   icon: 'chatbubble-outline',  iconActive: 'chatbubble'   },
  { key: 'recovery',   label: 'Recover', icon: 'heart-outline',       iconActive: 'heart'        },
  { key: 'calculator', label: 'Plates',  icon: 'calculator-outline',  iconActive: 'calculator'   },
  { key: 'social',     label: 'Social',  icon: 'people-outline',      iconActive: 'people'       },
  { key: 'profile',    label: 'Me',      icon: 'person-outline',      iconActive: 'person'       },
];

function RestTimerPill({ colors }: { colors: ThemeColors }) {
  const { remaining, dismiss } = useRestTimer();
  if (remaining === null) return null;

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const display = mins > 0
    ? `${mins}:${String(secs).padStart(2, '0')}`
    : `${secs}s`;

  const isWarning = remaining <= 10 && remaining > 0;
  const isDone = remaining === 0;

  return (
    <TouchableOpacity
      style={[
        pillStyles.pill,
        { backgroundColor: isDone ? '#F5A623' : isWarning ? '#1E2022' : '#161819' },
        isDone && { borderColor: '#F5A623' },
        isWarning && !isDone && { borderColor: '#F5A623' },
      ]}
      onPress={dismiss}
      activeOpacity={0.8}
    >
      <Text style={pillStyles.icon}>⏱</Text>
      <Text style={[pillStyles.time, isDone && { color: '#000' }]}>
        {isDone ? 'Go!' : display}
      </Text>
      <Text style={[pillStyles.tap, isDone && { color: '#000' }]}>tap to dismiss</Text>
    </TouchableOpacity>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#232527',
    marginBottom: 8,
  },
  icon: { fontSize: 14 },
  time: { fontSize: 16, fontWeight: '800', color: '#C8FF3D', letterSpacing: -0.5 },
  tap: { fontSize: 11, color: '#5A5A5A', fontWeight: '500' },
});

export default function MainTabs({ profile, onProfileUpdate, initialTab, forceTab, onTabApplied, pendingSiriFood, onSiriFoodApplied }: { profile: any; onProfileUpdate: (p: any) => void; initialTab?: string; forceTab?: string; onTabApplied?: () => void; pendingSiriFood?: string; onSiriFoodApplied?: () => void }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [activeTab, setActiveTab] = useState(initialTab ?? 'log');

  useEffect(() => {
    if (!forceTab) return;
    setActiveTab(forceTab);
    onTabApplied?.();
  }, [forceTab]);

  const targets = {
    calories: profile.calories, protein: profile.protein,
    carbs: profile.carbs, fat: profile.fat,
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <CancellationSaveModal />
      <View style={{ flex: 1 }}>
        {activeTab === 'log'        && <LogScreen targets={targets} profile={profile} periodizationSettings={profile.periodization_settings ?? null} pendingSiriFood={pendingSiriFood} onSiriFoodApplied={onSiriFoodApplied} />}
        {activeTab === 'workout'    && <WorkoutScreen profile={profile} />}
        {activeTab === 'progress'   && <ErrorBoundary fallbackTitle="Stats unavailable"><ProgressScreen profile={profile} /></ErrorBoundary>}
        {activeTab === 'coach'      && <CoachScreen profile={profile} />}
        {activeTab === 'recovery'   && <RecoveryScreen onNavigateToProfile={() => setActiveTab('profile')} onNavigateToCoach={() => setActiveTab('coach')} />}
        {activeTab === 'calculator' && <PlateCalculatorScreen />}
        {activeTab === 'social'     && <ErrorBoundary fallbackTitle="Social unavailable"><SocialScreen profile={profile} /></ErrorBoundary>}
        {activeTab === 'profile'    && <ProfileScreen profile={profile} onUpdate={onProfileUpdate} />}
      </View>

      {/* One-time nudge for pre-existing users whose profile predates the
          height/age/sex onboarding step — without those, their targets are
          still the crude cal-per-lb estimate. Sits above the tab bar so it
          never blocks the screen, and self-hides once seen. */}
      <StatsBackfillPrompt profile={profile} onUpdate={onProfileUpdate} />

      <RestTimerPill colors={colors} />

      <SafeAreaView edges={['bottom']} style={s.tabBar}>
        {TABS.map(tab => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={s.tab}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
              // Tab role + selected state let VoiceOver announce "Coach, tab,
              // 4 of 8, selected" instead of just reading the label.
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: active }}
              accessibilityHint={`Opens the ${tab.label} screen`}
            >
              <Ionicons
                name={active ? tab.iconActive : tab.icon}
                size={22}
                color={active ? colors.accent : colors.textTertiary}
              />
              <Text style={[s.label, active && s.labelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    tabBar: {
      backgroundColor: c.bgSecondary,
      borderTopWidth: 1,
      borderTopColor: c.border,
      flexDirection: 'row',
      paddingTop: 8,
      paddingBottom: 4,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 4,
    },
    label: {
      fontSize: 9,
      fontWeight: weight.medium,
      color: c.textTertiary,
      letterSpacing: 0.2,
    },
    labelActive: {
      color: c.accent,
      fontWeight: weight.bold,
    },
  });
}
