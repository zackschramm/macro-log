/**
 * The trial-end moment.
 *
 * Apple already sends a reminder before a trial converts, but it is a
 * transactional receipt — it names a price and a date and nothing else, and it
 * arrives in a notification tray next to twelve other things. It gives the user
 * no reason to keep the subscription, only a reason to remember they have one.
 *
 * ── WHY AN IN-APP CARD RATHER THAN A LOCAL NOTIFICATION ──────────────────────
 * `expo-notifications` is wired up (see utils/notifications.ts) and scheduling
 * one more local notification would have been easy, but it's the wrong shape:
 *
 *  1. A notification is a title and two lines. The whole point of this moment is
 *     to re-show what the user would LOSE — their targets, their race, the plan
 *     they've been following. That doesn't fit in a payload, so a notification
 *     would end up being a second transactional ping, i.e. exactly the thing
 *     that already isn't working.
 *  2. Notification permission is optional and often declined. The card reaches
 *     every trialist.
 *  3. A scheduled notification has to be booked when the trial starts and
 *     rebooked if the trial's end date moves (extensions, restores, Family
 *     Sharing). This reads the live expiry from RevenueCat on every launch, so
 *     it cannot drift out of sync with StoreKit.
 *  4. Someone on a 7-day trial opens the app during those 7 days — that is what
 *     a trial is. Next-launch delivery inside a 2-day window is near-certain,
 *     and it lands when they're already engaged rather than mid-commute.
 *
 * Shown once per trial expiry date, so a later trial re-arms it by itself.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { getTrialStatus, isTrialEndingSoon, type TrialStatus } from '../utils/trialStatus';
import { daysUntilRace } from '../utils/enduranceFueling';
import { SPORT_TO_DISTANCE } from '../utils/enduranceContext';
import { TRI_COURSES } from '../utils/raceFueling';
import { isEnduranceSport } from '../constants/data';
import { track, EVENTS } from '../utils/analytics';
import PaywallScreen from '../screens/PaywallScreen';

const SHOWN_KEY = 'fuelog_trial_end_moment_shown';

interface Props {
  profile: any;
}

export default function TrialEndingCard({ profile }: Props) {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [status, setStatus] = useState<TrialStatus | null>(null);
  const [visible, setVisible] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await getTrialStatus();
      if (cancelled || !isTrialEndingSoon(t) || !t) return;

      // Keyed by the expiry itself rather than a boolean, so a second trial
      // (new expiry) shows the moment again and the same trial never does.
      const seen = await AsyncStorage.getItem(SHOWN_KEY);
      if (cancelled || seen === String(t.expiresAtMs)) return;

      setStatus(t);
      setVisible(true);
      track(EVENTS.TRIAL_ENDING_SHOWN, { daysLeft: t.daysLeft, willRenew: t.willRenew });
    })();
    return () => { cancelled = true; };
  }, []);

  const dismiss = async () => {
    if (status?.expiresAtMs) {
      await AsyncStorage.setItem(SHOWN_KEY, String(status.expiresAtMs)).catch(() => {});
    }
    setVisible(false);
  };

  const openPaywall = () => {
    track(EVENTS.TRIAL_ENDING_CTA);
    setShowPaywall(true);
  };

  if (!status) return null;

  const daysLeft = status.daysLeft ?? 0;
  const when = daysLeft <= 1 ? 'tomorrow' : `in ${daysLeft} days`;

  // What they'd actually be handing back. Targets first — they're the thing the
  // user recognises as theirs, and the reason the rest of the app works.
  const losses: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string }[] = [];

  if (profile?.calories) {
    losses.push({
      icon: 'flame-outline',
      label: 'Your daily targets',
      value: `${profile.calories} cal · ${profile.protein ?? 0}P / ${profile.carbs ?? 0}C / ${profile.fat ?? 0}F`,
    });
  }

  const raceLabel = raceLine(profile);
  if (raceLabel) {
    losses.push({ icon: 'medal-outline', label: 'Your race plan', value: raceLabel });
  }

  losses.push({
    icon: 'chatbubbles-outline',
    label: 'Your AI Coach',
    value: 'Everything it has learned about your training',
  });

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.pill}>
              <Ionicons name="time-outline" size={13} color={colors.accentText} />
              <Text style={s.pillText}>TRIAL ENDS {when.toUpperCase()}</Text>
            </View>

            <Text style={s.heading}>Here's what you'd be giving up</Text>

            <View style={s.list}>
              {losses.map(l => (
                <View key={l.label} style={s.row}>
                  <Ionicons name={l.icon} size={18} color={colors.accent} style={s.rowIcon} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowLabel}>{l.label}</Text>
                    <Text style={s.rowValue}>{l.value}</Text>
                  </View>
                </View>
              ))}
            </View>

            {status.willRenew ? (
              <>
                {/* Auto-renew is on: there is nothing to sell them. Say plainly
                    what happens next and where to stop it. Anything else here
                    would be manufacturing urgency about a decision they've
                    already made. */}
                <Text style={s.body}>
                  Your subscription continues automatically {when}. You can cancel any time
                  from Settings on your device.
                </Text>
                <TouchableOpacity style={s.primaryBtn} onPress={dismiss} activeOpacity={0.85}>
                  <Text style={s.primaryBtnText}>Keep going</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.body}>
                  Auto-renew is off, so this all switches back to the free plan {when}.
                </Text>
                <TouchableOpacity style={s.primaryBtn} onPress={openPaywall} activeOpacity={0.85}>
                  <Text style={s.primaryBtnText}>Keep Fuelog Pro</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.secondaryBtn} onPress={dismiss} activeOpacity={0.7}>
                  <Text style={s.secondaryBtnText}>Not now</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={showPaywall} animationType="slide" statusBarTranslucent>
        <PaywallScreen
          onClose={() => setShowPaywall(false)}
          onUnlock={() => { setShowPaywall(false); dismiss(); }}
        />
      </Modal>
    </>
  );
}

/** "70.3 in 34 days" — only when there's a real race to lose. */
function raceLine(profile: any): string | null {
  const sport: string = profile?.sport ?? '';
  if (!isEnduranceSport(sport)) return null;

  const distance = SPORT_TO_DISTANCE[sport];
  const label = distance ? TRI_COURSES[distance].label : null;
  const days = daysUntilRace(profile?.race_date ?? null);

  if (label && days !== null && days >= 0) {
    return `${label} in ${days} day${days === 1 ? '' : 's'}`;
  }
  if (label) return `${label} fuelling plan`;
  if (days !== null && days >= 0) return `Race day in ${days} day${days === 1 ? '' : 's'}`;
  return null;
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: c.card,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      padding: spacing.xxl,
      paddingBottom: spacing.xxxl + 16,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      alignSelf: 'flex-start',
      backgroundColor: c.accent,
      borderRadius: radius.pill,
      paddingHorizontal: 10,
      paddingVertical: 4,
      marginBottom: spacing.md,
    },
    pillText: { color: c.accentText, fontSize: 10, fontWeight: weight.heavy, letterSpacing: 1 },
    heading: {
      fontSize: 22,
      fontWeight: weight.heavy,
      color: c.text,
      letterSpacing: -0.5,
      marginBottom: spacing.lg,
    },
    list: { gap: spacing.md, marginBottom: spacing.xl },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    rowIcon: { marginTop: 1 },
    rowLabel: { fontSize: 14, fontWeight: weight.bold, color: c.text },
    rowValue: { fontSize: 13, fontWeight: weight.medium, color: c.textSecondary, marginTop: 1 },
    body: { fontSize: 14, color: c.textSecondary, lineHeight: 20, marginBottom: spacing.xl },
    primaryBtn: {
      backgroundColor: c.accent,
      borderRadius: radius.card,
      padding: spacing.lg,
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    primaryBtnText: { color: c.accentText, fontSize: 16, fontWeight: weight.bold },
    secondaryBtn: { padding: spacing.md, alignItems: 'center' },
    secondaryBtnText: { color: c.textTertiary, fontSize: 14, fontWeight: weight.medium },
  });
}
