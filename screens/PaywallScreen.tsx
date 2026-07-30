import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Purchases, { PurchasesPackage } from 'react-native-purchases';
import { ENTITLEMENT_ID } from '../constants/purchases';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { track, EVENTS } from '../utils/analytics';

const FEATURES = [
  { icon: '🤖', label: 'AI Coaching', desc: 'Unlimited AI-powered nutrition & fitness coach' },
  { icon: '🥗', label: 'AI Meal Plans', desc: 'Generate personalized weekly meal plans' },
  { icon: '🩸', label: 'Blood Work AI Scan', desc: 'AI-powered lab results analysis' },
  { icon: '💪', label: 'AI Workout Fill', desc: 'Auto-fill workouts with AI suggestions' },
  { icon: '📊', label: 'InBody Segmental Analysis', desc: 'Detailed body composition breakdown' },
  { icon: '✨', label: '3 Free Messages', desc: 'Try the coach before you buy' },
];

interface Props {
  onClose: () => void;
  onUnlock: () => void;
  trialMessage?: string;
}

export default function PaywallScreen({ onClose, onUnlock, trialMessage }: Props) {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [selected, setSelected] = useState<'monthly' | 'yearly'>('yearly');
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    // Denominator of the conversion funnel — without this you can't tell
    // whether a low conversion rate is a pricing problem or a traffic problem.
    track(EVENTS.PAYWALL_SHOWN, { trial: !!trialMessage });
    Purchases.getOfferings().then(offerings => {
      const pkgs = offerings.current?.availablePackages ?? [];
      setPackages(pkgs);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const monthlyPkg = packages.find(p =>
    p.packageType === 'MONTHLY' || p.identifier.toLowerCase().includes('monthly')
  );
  const yearlyPkg = packages.find(p =>
    p.packageType === 'ANNUAL' || p.identifier.toLowerCase().includes('annual') || p.identifier.toLowerCase().includes('yearly')
  );

  const monthlyPrice = monthlyPkg?.product.priceString ?? '$2.99';
  const yearlyPrice = yearlyPkg?.product.priceString ?? '$19.99';

  const purchase = async () => {
    const pkg = selected === 'monthly' ? monthlyPkg : yearlyPkg;
    if (!pkg) {
      Alert.alert('Unavailable', 'This plan is not available right now. Please try again later.');
      return;
    }
    setPurchasing(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      if (customerInfo.entitlements.active[ENTITLEMENT_ID]) {
        track(EVENTS.PAYWALL_CONVERTED, { plan: selected });
        onUnlock();
      }
    } catch (e: any) {
      if (!e.userCancelled) {
        Alert.alert('Purchase Failed', e.message ?? 'Something went wrong. Please try again.');
      }
    } finally {
      setPurchasing(false);
    }
  };

  const restore = async () => {
    setRestoring(true);
    try {
      const customerInfo = await Purchases.restorePurchases();
      if (customerInfo.entitlements.active[ENTITLEMENT_ID]) {
        onUnlock();
      } else {
        Alert.alert('Nothing to Restore', 'No active Fuelog Pro subscription found.');
      }
    } catch {
      Alert.alert('Error', 'Could not restore purchases. Please try again.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <TouchableOpacity
        style={s.closeBtn}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        accessibilityHint="Dismisses the upgrade screen">
        <Text style={s.closeBtnText}>×</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.badgeWrap}><Text style={s.badge}>PRO</Text></View>
        <Text style={s.title}>Unlock Fuelog Pro</Text>
        <Text style={s.sub}>14-day free trial, then cancel anytime</Text>

        {trialMessage ? (
          <View style={s.trialMsgBanner}>
            <Text style={s.trialMsgText}>{trialMessage}</Text>
          </View>
        ) : null}

        <View style={s.features}>
          {FEATURES.map(f => (
            <View key={f.label} style={s.featureRow}>
              <Text style={s.featureIcon}>{f.icon}</Text>
              <View style={s.featureTextWrap}>
                <Text style={s.featureLabel}>{f.label}</Text>
                <Text style={s.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 32 }} />
        ) : (
          <View style={s.plans}>
            <TouchableOpacity
              style={[s.planCard, selected === 'yearly' && s.planCardActive]}
              onPress={() => setSelected('yearly')}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityLabel="Yearly plan, best value"
              accessibilityState={{ selected: selected === 'yearly' }}>
              <View style={s.planCardInner}>
                <View style={s.bestValueBadge}>
                  <Text style={s.bestValueText}>BEST VALUE</Text>
                </View>
                <Text style={[s.planName, selected === 'yearly' && s.planNameActive]}>Yearly</Text>
                <Text style={[s.planPrice, selected === 'yearly' && s.planPriceActive]}>{yearlyPrice}</Text>
                <Text style={[s.planNote, selected === 'yearly' && s.planNoteActive]}>per year · ~$1.67/mo</Text>
              </View>
              {selected === 'yearly' && <View style={s.planCheck}><Text style={s.planCheckText}>✓</Text></View>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.planCard, selected === 'monthly' && s.planCardActive]}
              onPress={() => setSelected('monthly')}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityLabel="Monthly plan"
              accessibilityState={{ selected: selected === 'monthly' }}>
              <View style={s.planCardInner}>
                <Text style={[s.planName, selected === 'monthly' && s.planNameActive]}>Monthly</Text>
                <Text style={[s.planPrice, selected === 'monthly' && s.planPriceActive]}>{monthlyPrice}</Text>
                <Text style={[s.planNote, selected === 'monthly' && s.planNoteActive]}>per month</Text>
              </View>
              {selected === 'monthly' && <View style={s.planCheck}><Text style={s.planCheckText}>✓</Text></View>}
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={s.ctaBtn}
          onPress={purchase}
          disabled={purchasing || loading}
          accessibilityRole="button"
          accessibilityLabel={purchasing ? 'Starting your free trial' : 'Start free trial'}
          accessibilityState={{ disabled: purchasing || loading, busy: purchasing }}>
          {purchasing
            ? <ActivityIndicator color={colors.accentText} />
            : <Text style={s.ctaBtnText}>Start Free Trial</Text>}
        </TouchableOpacity>
        <Text style={s.trialNote}>14 days free, then {selected === 'yearly' ? yearlyPrice + '/year' : monthlyPrice + '/month'}. Cancel anytime.</Text>

        <TouchableOpacity style={s.restoreBtn} onPress={restore} disabled={restoring}>
          {restoring
            ? <ActivityIndicator color={colors.textTertiary} size="small" />
            : <Text style={s.restoreBtnText}>Restore Purchases</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    closeBtn: { position: 'absolute', top: 56, right: 20, zIndex: 10, backgroundColor: c.card, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    closeBtnText: { color: c.textSecondary, fontSize: 22, lineHeight: 24 },
    scroll: { paddingHorizontal: spacing.xxl, paddingTop: 60, paddingBottom: 40, alignItems: 'center' },
    badgeWrap: { backgroundColor: c.accent, borderRadius: radius.pill, overflow: 'hidden', marginBottom: 16 },
    badge: { color: c.accentText, fontSize: 11, fontWeight: weight.heavy, letterSpacing: 2, paddingHorizontal: 12, paddingVertical: 4 },
    title: { fontSize: 32, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5, textAlign: 'center', marginBottom: 8 },
    sub: { fontSize: 14, color: c.textTertiary, fontWeight: weight.semibold, textAlign: 'center', marginBottom: 32 },
    trialMsgBanner: { backgroundColor: c.card, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16, width: '100%', borderWidth: 1, borderColor: c.border },
    trialMsgText: { color: c.textSecondary, fontSize: 14, fontWeight: weight.semibold, textAlign: 'center' },
    features: { width: '100%', gap: 14, marginBottom: 32 },
    featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
    featureIcon: { fontSize: 22, width: 30, textAlign: 'center', marginTop: 1 },
    featureTextWrap: { flex: 1 },
    featureLabel: { fontSize: 15, color: c.text, fontWeight: weight.bold },
    featureDesc: { fontSize: 13, color: c.textSecondary, fontWeight: weight.medium, marginTop: 1 },
    plans: { width: '100%', gap: 12, marginBottom: 24 },
    planCard: { borderRadius: radius.card, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    planCardActive: { borderColor: c.accent, backgroundColor: c.accentMuted },
    planCardInner: { flex: 1 },
    bestValueBadge: { backgroundColor: c.accent, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start', marginBottom: 6 },
    bestValueText: { color: c.accentText, fontSize: 9, fontWeight: weight.heavy, letterSpacing: 1 },
    planName: { fontSize: 16, fontWeight: weight.heavy, color: c.textTertiary },
    planNameActive: { color: c.text },
    planPrice: { fontSize: 26, fontWeight: weight.heavy, color: c.textTertiary, letterSpacing: -0.5, marginTop: 2 },
    planPriceActive: { color: c.text },
    planNote: { fontSize: 12, color: c.textTertiary, fontWeight: weight.medium, marginTop: 2 },
    planNoteActive: { color: c.textSecondary },
    planCheck: { backgroundColor: c.accent, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
    planCheckText: { color: c.accentText, fontSize: 13, fontWeight: weight.heavy },
    ctaBtn: { backgroundColor: c.accent, borderRadius: radius.card, paddingVertical: 18, width: '100%', alignItems: 'center', marginBottom: 12 },
    ctaBtnText: { color: c.accentText, fontSize: 17, fontWeight: weight.heavy },
    trialNote: { fontSize: 12, color: c.textTertiary, fontWeight: weight.medium, textAlign: 'center', marginBottom: 20 },
    restoreBtn: { paddingVertical: 8 },
    restoreBtnText: { color: c.textTertiary, fontSize: 13, fontWeight: weight.semibold },
  });
}
