import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Modal, StyleSheet, Text, View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../hooks/useAuth';
import { useTheme, ThemeColors, weight as W } from '../constants/theme';
import { ALL_BADGES, BadgeStatus, checkAchievements } from '../utils/achievements';

interface Props {
  profile: { calories: number; protein: number; carbs: number; fat: number };
}

export default function AchievementBadges({ profile }: Props) {
  const { colors, spacing, radius } = useTheme();
  const { user } = useAuth();
  const s = makeStyles(colors, spacing, radius);

  const [statuses, setStatuses] = useState<BadgeStatus[]>(
    ALL_BADGES.map(badge => ({ badge, earned: false })),
  );
  const [toastName, setToastName] = useState<string | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!user) return;
    checkAchievements(user.id, profile).then(result => {
      setStatuses(result.statuses);
      if (result.newlyEarned.length > 0) {
        setToastName(result.newlyEarned[0].name);
        toastAnim.setValue(0);
        Animated.sequence([
          Animated.timing(toastAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.delay(2000),
          Animated.timing(toastAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]).start(() => setToastName(null));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const rows: BadgeStatus[][] = [];
  for (let i = 0; i < statuses.length; i += 2) {
    rows.push(statuses.slice(i, i + 2));
  }

  return (
    <View>
      {rows.map((row, ri) => (
        <View key={ri} style={s.row}>
          {row.map(status => (
            <View key={status.badge.id} style={[s.card, status.earned && s.cardEarned]}>
              <Text style={s.icon}>{status.badge.icon}</Text>
              <Text style={[s.name, status.earned && s.nameEarned]}>{status.badge.name}</Text>
              {status.earned ? (
                <Text style={s.earnedDate}>
                  {status.earnedAt
                    ? new Date(status.earnedAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })
                    : 'Earned'}
                </Text>
              ) : (
                <>
                  <Text style={s.lockIcon}>🔒</Text>
                  {status.progressLabel && (
                    <Text style={s.progress}>{status.progressLabel}</Text>
                  )}
                </>
              )}
            </View>
          ))}
          {row.length === 1 && <View style={[s.card, s.cardGhost]} />}
        </View>
      ))}

      <Modal visible={!!toastName} transparent animationType="none" statusBarTranslucent>
        <Animated.View style={[s.toastOverlay, { opacity: toastAnim }]} pointerEvents="none">
          <View style={s.toast}>
            <Text style={s.toastEmoji}>🏆</Text>
            <Text style={s.toastLabel}>Achievement unlocked</Text>
            <Text style={s.toastName}>{toastName}</Text>
          </View>
        </Animated.View>
      </Modal>
    </View>
  );
}

function makeStyles(colors: ThemeColors, spacing: Record<string, number>, radius: Record<string, number>) {
  return StyleSheet.create({
    row: { flexDirection: 'row', gap: 10, marginBottom: 10 },
    card: {
      flex: 1, backgroundColor: colors.card, borderRadius: radius.card,
      padding: spacing.lg, alignItems: 'center', gap: 6,
      borderWidth: 1, borderColor: colors.border, opacity: 0.55,
    },
    cardEarned: {
      backgroundColor: colors.accentMuted, borderColor: colors.accent, opacity: 1,
    },
    cardGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
    icon: { fontSize: 28 },
    name: {
      fontSize: 13, fontWeight: W.semibold,
      color: colors.textSecondary, textAlign: 'center',
    },
    nameEarned: { color: colors.text },
    lockIcon: { fontSize: 14 },
    earnedDate: {
      fontSize: 11, color: colors.accent,
      fontWeight: W.medium, textAlign: 'center',
    },
    progress: {
      fontSize: 11, color: colors.textTertiary, textAlign: 'center',
    },
    toastOverlay: {
      flex: 1, alignItems: 'center',
      justifyContent: 'flex-start', paddingTop: 72,
    },
    toast: {
      backgroundColor: colors.card, borderRadius: radius.card,
      borderWidth: 2, borderColor: colors.accent,
      paddingHorizontal: 28, paddingVertical: 16,
      alignItems: 'center', gap: 4, marginHorizontal: 32,
    },
    toastEmoji: { fontSize: 28 },
    toastLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: W.medium },
    toastName: { fontSize: 17, color: colors.text, fontWeight: W.heavy },
  });
}
