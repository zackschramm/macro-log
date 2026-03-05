import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import LogScreen from './LogScreen';
import WorkoutScreen from './WorkoutScreen';
import ProfileScreen from './ProfileScreen';
import CoachScreen from './CoachScreen';
import MealPlanScreen from './MealPlanScreen';
import ProgressScreen from './ProgressScreen';
import NotificationsScreen from './NotificationsScreen';
import SocialScreen from './SocialScreen';
import FoodsScreen from './FoodsScreen';

type Tab = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
};

const TABS: Tab[] = [
  { key: 'log',      label: 'Log',      icon: 'restaurant-outline',    iconActive: 'restaurant'       },
  { key: 'plan',     label: 'Plan',     icon: 'calendar-outline',      iconActive: 'calendar'         },
  { key: 'workout',  label: 'Train',    icon: 'barbell-outline',       iconActive: 'barbell'          },
  { key: 'progress', label: 'Stats',    icon: 'trending-up-outline',   iconActive: 'trending-up'      },
  { key: 'coach',    label: 'Coach',    icon: 'chatbubble-outline',    iconActive: 'chatbubble'       },
  { key: 'foods',    label: 'Foods',    icon: 'nutrition-outline',     iconActive: 'nutrition'        },
  { key: 'social',   label: 'Social',   icon: 'people-outline',        iconActive: 'people'           },
  { key: 'notifs',   label: 'Alerts',   icon: 'notifications-outline', iconActive: 'notifications'    },
  { key: 'profile',  label: 'Me',       icon: 'person-outline',        iconActive: 'person'           },
];

export default function MainTabs({ profile, onProfileUpdate }: { profile: any; onProfileUpdate: (p: any) => void }) {
  const [activeTab, setActiveTab] = useState('log');

  const targets = {
    calories: profile.calories, protein: profile.protein,
    carbs: profile.carbs, fat: profile.fat,
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#121212' }}>
      <View style={{ flex: 1 }}>
        {activeTab === 'log'      && <LogScreen targets={targets} />}
        {activeTab === 'workout'  && <WorkoutScreen />}
        {activeTab === 'progress' && <ProgressScreen profile={profile} />}
        {activeTab === 'coach'    && <CoachScreen />}
        {activeTab === 'social'   && <SocialScreen profile={profile} />}
        {activeTab === 'profile'  && <ProfileScreen profile={profile} onUpdate={onProfileUpdate} />}
      </View>

      <SafeAreaView edges={['bottom']} style={s.tabBar}>
        {TABS.map(tab => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={s.tab}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={active ? tab.iconActive : tab.icon}
                size={22}
                color={active ? '#fff' : '#404040'}
              />
              <Text style={[s.label, active && s.labelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  tabBar: {
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#1e1e1e',
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
    fontSize: 10,
    fontWeight: '600',
    color: '#3a3a3a',
    letterSpacing: 0.2,
  },
  labelActive: {
    color: '#fff',
    fontWeight: '800',
  },
});
