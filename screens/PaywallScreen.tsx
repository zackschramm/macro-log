import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Purchases, { PurchasesPackage } from 'react-native-purchases';
import { ENTITLEMENT_ID } from '../constants/purchases';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { FEATURE_ICONS, type IconName } from '../constants/icons';
import { track, EVENTS } from '../utils/analytics';
import { logError } from '../utils/logError';

const FEATURES: { icon: IconName; label: string; desc: string }[] = [
  { icon: FEATURE_ICONS.coaching,     label: 'AI Coaching', desc: 'Unlimited AI-powered nutrition & fitness coach' },
  { icon: FEATURE_ICONS.mealPlans,    label: 'AI Meal Plans', desc: 'Generate personalized weekly meal plans' },
  { icon: FEATURE_ICONS.bloodwork,    label: 'Blood Work AI Scan', desc: 'AI-powered lab results analysis' },
  { icon: FEATURE_ICONS.workoutFill,  label: 'AI Workout Fill', desc: 'Auto-fill workouts with AI suggestions' },
  { icon: FEATURE_ICONS.inbody,       label: 'InBody Segmental Analysis', desc: 'Detailed body composition breakdown' },
  { icon: FEATURE_ICONS.freeMessages, label: '3 Free Messages', desc: 'Try the coach before you buy' },
];

interface Props {
  onClose: () => void;
  onUnlock: () => void;
  trialMessage?: string;
}

/**
 * Length of the introductory free trial, in days.
 *
 * MUST match the introductory offer configured on BOTH subscriptions in App
 * Store Connect. Apple bills according to ASC, not this constant — if they
 * disagree, the app advertises a trial the user never receives, which is both
 * an App Review rejection and a consumer-protection problem. This was hardcoded
 * as "14-day" in three places while ASC had zero introductory offers.
 */
const TRIAL_DAYS = 7;

/**
 * Render `amount` in the same currency as a real StoreKit price.
 *
 * Anything derived (the per-month equivalent of the annual plan, the annual
 * cost at the monthly rate) starts life as a bare `product.price` number.
 * Printing "$" in front of it is wrong in every storefront that isn't the US,
 * and the App Store sells in ~40 currencies — so go through Intl, which knows
 * the symbol, its placement and the decimal separator.
 *
 * The fallback splices the number into the shape of the real `priceString`
 * ("59,99 €" → "5,00 €") in case the JS engine ships without full-ICU Intl.
 * Returns null rather than guessing when neither route works, and every caller
 * degrades to not showing the derived line at all.
 */
function formatLikePrice(
  amount: number,
  product: { priceString?: string; currencyCode?: string } | undefined
): string | null {
  if (!product || !Number.isFinite(amount)) return null;

  if (product.currencyCode) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: product.currencyCode,
      }).format(amount);
    } catch {
      /* No Intl, or a currency code it doesn't know — fall through. */
    }
  }

  const raw = product.priceString ?? '';
  const match = raw.match(/\d[\d., \s]*\d|\d/);
  if (!match) return null;
  // Mirror whatever decimal separator the storefront already used.
  const usesComma = /,\d{1,2}$/.test(match[0]);
  const body = usesComma ? amount.toFixed(2).replace('.', ',') : amount.toFixed(2);
  return raw.replace(match[0], body);
}

export default function PaywallScreen({ onClose, onUnlock, trialMessage }: Props) {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  // Annual is pre-selected. It is genuinely the better deal at half the
  // per-month price, and burying it behind a tap meant most people never
  // compared. Monthly stays a single tap away and is never disabled or hidden —
  // this is emphasis, not a trap door.
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

  // Live prices from StoreKit via RevenueCat. The fallbacks only appear if the
  // packages fail to load (no network, StoreKit unavailable, simulator) — keep
  // them in sync with App Store Connect so a load failure can't advertise a
  // price you don't charge. They previously read $2.99/$19.99, which is what
  // ended up in the App Review screenshot.
  const monthlyPrice = monthlyPkg?.product.priceString ?? '$9.99';
  const yearlyPrice = yearlyPkg?.product.priceString ?? '$59.99';

  // Per-month equivalent of the annual plan, DERIVED from the live price rather
  // than hardcoded. It previously read "~$1.67/mo" — correct for a $19.99 year,
  // wildly wrong for anything else, and exactly the kind of string that rots
  // silently after a price change.
  //
  // RevenueCat already computes a localized per-month string for subscription
  // products; prefer it, and only fall back to dividing by 12 ourselves.
  const yearlyPerMonth =
    yearlyPkg?.product.pricePerMonthString ||
    (yearlyPkg?.product.price
      ? formatLikePrice(yearlyPkg.product.price / 12, yearlyPkg.product)
      : null);

  // What twelve months at the monthly rate would actually cost, and the saving
  // that implies. Both come from the two live prices, so they stay correct
  // after a price change, in any currency, and simply disappear if either
  // package failed to load rather than advertising a discount we don't offer.
  const monthlyAmount = monthlyPkg?.product.price ?? 0;
  const yearlyAmount = yearlyPkg?.product.price ?? 0;
  const canCompare = monthlyAmount > 0 && yearlyAmount > 0 && yearlyAmount < monthlyAmount * 12;

  const yearlyAtMonthlyRate = canCompare
    ? formatLikePrice(monthlyAmount * 12, monthlyPkg?.product)
    : null;
  const savingsPct = canCompare
    ? Math.round((1 - yearlyAmount / (monthlyAmount * 12)) * 100)
    : null;
  const showSavings = savingsPct !== null && savingsPct >= 1;

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
      // A user backing out is not an error. Anything else is lost revenue we
      // had no signal for — this path reported nothing anywhere.
      if (!e.userCancelled) {
        logError('Paywall.purchase', e, { plan: selected });
        // RevenueCat's messages are written for end users ("payment is
        // pending", "already subscribed"), so passing them through is more
        // useful here than a generic string.
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
    } catch (e) {
      logError('Paywall.restore', e);
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
        <Text style={s.sub}>{TRIAL_DAYS}-day free trial, then cancel anytime</Text>

        {trialMessage ? (
          <View style={s.trialMsgBanner}>
            <Text style={s.trialMsgText}>{trialMessage}</Text>
          </View>
        ) : null}

        <View style={s.features}>
          {FEATURES.map(f => (
            <View key={f.label} style={s.featureRow}>
              <Ionicons name={f.icon} size={20} color={colors.accent} style={s.featureIcon} />
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
              accessibilityLabel={
                showSavings
                  ? `Yearly plan, ${yearlyPerMonth ?? yearlyPrice} per month billed annually, save ${savingsPct} percent`
                  : 'Yearly plan, best value'
              }
              accessibilityState={{ selected: selected === 'yearly' }}>
              <View style={s.planCardInner}>
                <View style={s.bestValueBadge}>
                  <Text style={s.bestValueText}>
                    {showSavings ? `SAVE ${savingsPct}%` : 'BEST VALUE'}
                  </Text>
                </View>
                <Text style={[s.planName, selected === 'yearly' && s.planNameActive]}>Yearly</Text>
                {/* Lead with the per-month figure — it's the number people
                    actually compare against the monthly plan. The annual total
                    stays on the line below so nobody is surprised at checkout. */}
                <Text style={[s.planPrice, selected === 'yearly' && s.planPriceActive]}>
                  {yearlyPerMonth ?? yearlyPrice}
                  {yearlyPerMonth ? <Text style={s.planPricePer}>/mo</Text> : null}
                </Text>
                <View style={s.planNoteRow}>
                  {yearlyAtMonthlyRate ? (
                    <Text style={s.planStrike}>{yearlyAtMonthlyRate}</Text>
                  ) : null}
                  <Text style={[s.planNote, { marginTop: 0 }, selected === 'yearly' && s.planNoteActive]}>
                    {yearlyPerMonth ? `${yearlyPrice}, billed annually` : 'per year'}
                  </Text>
                </View>
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
        <Text style={s.trialNote}>{TRIAL_DAYS} days free, then {selected === 'yearly' ? yearlyPrice + '/year' : monthlyPrice + '/month'}. Cancel anytime.</Text>

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
    featureIcon: { width: 30, textAlign: 'center', marginTop: 2 },
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
    planPricePer: { fontSize: 14, fontWeight: weight.bold, letterSpacing: 0 },
    planNoteRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 2 },
    planStrike: { fontSize: 12, color: c.textTertiary, fontWeight: weight.medium, textDecorationLine: 'line-through' },
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
