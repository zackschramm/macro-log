import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Purchases, { PurchasesPackage } from 'react-native-purchases';
import { ENTITLEMENT_ID } from '../constants/purchases';

const FEATURES = [
  { icon: '🤖', label: 'AI Coaching' },
  { icon: '🥗', label: 'AI Meal Plans' },
  { icon: '🩸', label: 'Blood Work Upload' },
  { icon: '📊', label: 'Nutrient Tracking' },
  { icon: '🏆', label: 'Sport Optimization' },
  { icon: '📈', label: 'Progress Analytics' },
];

interface Props {
  onClose: () => void;
  onUnlock: () => void;
}

export default function PaywallScreen({ onClose, onUnlock }: Props) {
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [selected, setSelected] = useState<'monthly' | 'yearly'>('yearly');
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
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
      <TouchableOpacity style={s.closeBtn} onPress={onClose}>
        <Text style={s.closeBtnText}>×</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.badgeWrap}><Text style={s.badge}>PRO</Text></View>
        <Text style={s.title}>Unlock Fuelog Pro</Text>
        <Text style={s.sub}>14-day free trial, then cancel anytime</Text>

        <View style={s.features}>
          {FEATURES.map(f => (
            <View key={f.label} style={s.featureRow}>
              <Text style={s.featureIcon}>{f.icon}</Text>
              <Text style={s.featureLabel}>{f.label}</Text>
            </View>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color="#fff" style={{ marginVertical: 32 }} />
        ) : (
          <View style={s.plans}>
            <TouchableOpacity
              style={[s.planCard, selected === 'yearly' && s.planCardActive]}
              onPress={() => setSelected('yearly')}
              activeOpacity={0.8}>
              <View style={s.planCardInner}>
                <View style={s.bestValueBadge}>
                  <Text style={s.bestValueText}>BEST VALUE</Text>
                </View>
                <Text style={[s.planName, selected === 'yearly' && s.planNameActive]}>Yearly</Text>
                <Text style={[s.planPrice, selected === 'yearly' && s.planPriceActive]}>{yearlyPrice}</Text>
                <Text style={[s.planNote, selected === 'yearly' && s.planNoteActive]}>per year · ~{Math.round(1999 / 12 / 100 * 100) / 100 < 2 ? '$1.67' : '$1.67'}/mo</Text>
              </View>
              {selected === 'yearly' && <View style={s.planCheck}><Text style={s.planCheckText}>✓</Text></View>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.planCard, selected === 'monthly' && s.planCardActive]}
              onPress={() => setSelected('monthly')}
              activeOpacity={0.8}>
              <View style={s.planCardInner}>
                <Text style={[s.planName, selected === 'monthly' && s.planNameActive]}>Monthly</Text>
                <Text style={[s.planPrice, selected === 'monthly' && s.planPriceActive]}>{monthlyPrice}</Text>
                <Text style={[s.planNote, selected === 'monthly' && s.planNoteActive]}>per month</Text>
              </View>
              {selected === 'monthly' && <View style={s.planCheck}><Text style={s.planCheckText}>✓</Text></View>}
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={s.ctaBtn} onPress={purchase} disabled={purchasing || loading}>
          {purchasing
            ? <ActivityIndicator color="#000" />
            : <Text style={s.ctaBtnText}>Start Free Trial</Text>}
        </TouchableOpacity>
        <Text style={s.trialNote}>14 days free, then {selected === 'yearly' ? yearlyPrice + '/year' : monthlyPrice + '/month'}. Cancel anytime.</Text>

        <TouchableOpacity style={s.restoreBtn} onPress={restore} disabled={restoring}>
          {restoring
            ? <ActivityIndicator color="#555" size="small" />
            : <Text style={s.restoreBtnText}>Restore Purchases</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0e0e0e' },
  closeBtn: { position: 'absolute', top: 56, right: 20, zIndex: 10, backgroundColor: '#1e1e1e', width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#888', fontSize: 22, lineHeight: 24 },
  scroll: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40, alignItems: 'center' },
  badgeWrap: { backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden', marginBottom: 16 },
  badge: { color: '#000', fontSize: 11, fontWeight: '900', letterSpacing: 2, paddingHorizontal: 10, paddingVertical: 4 },
  title: { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: -0.5, textAlign: 'center', marginBottom: 8 },
  sub: { fontSize: 14, color: '#555', fontWeight: '600', textAlign: 'center', marginBottom: 32 },
  features: { width: '100%', gap: 12, marginBottom: 32 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  featureIcon: { fontSize: 22, width: 30, textAlign: 'center' },
  featureLabel: { fontSize: 16, color: '#ccc', fontWeight: '600' },
  plans: { width: '100%', gap: 12, marginBottom: 24 },
  planCard: { borderRadius: 16, borderWidth: 1.5, borderColor: '#2a2a2a', backgroundColor: '#1a1a1a', padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planCardActive: { borderColor: '#fff', backgroundColor: '#1e1e1e' },
  planCardInner: { flex: 1 },
  bestValueBadge: { backgroundColor: '#fff', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start', marginBottom: 6 },
  bestValueText: { color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  planName: { fontSize: 16, fontWeight: '800', color: '#555' },
  planNameActive: { color: '#fff' },
  planPrice: { fontSize: 26, fontWeight: '900', color: '#555', letterSpacing: -0.5, marginTop: 2 },
  planPriceActive: { color: '#fff' },
  planNote: { fontSize: 12, color: '#333', fontWeight: '500', marginTop: 2 },
  planNoteActive: { color: '#555' },
  planCheck: { backgroundColor: '#fff', width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  planCheckText: { color: '#000', fontSize: 13, fontWeight: '900' },
  ctaBtn: { backgroundColor: '#fff', borderRadius: 14, paddingVertical: 16, width: '100%', alignItems: 'center', marginBottom: 12 },
  ctaBtnText: { color: '#000', fontSize: 17, fontWeight: '900' },
  trialNote: { fontSize: 12, color: '#333', fontWeight: '500', textAlign: 'center', marginBottom: 20 },
  restoreBtn: { paddingVertical: 8 },
  restoreBtnText: { color: '#444', fontSize: 13, fontWeight: '600' },
});
