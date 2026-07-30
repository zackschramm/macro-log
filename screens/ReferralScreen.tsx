import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Share, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { hasPro } from '../constants/purchases';
import { colors, weight, radius } from '../constants/theme';
import { logError } from '../utils/logError';

interface Props {
  onBack: () => void;
  profile: any;
}

interface Referral {
  id: string;
  status: string;
  created_at: string;
  signed_up_at: string | null;
  converted_at: string | null;
}

function generateCode(name: string): string {
  const first = (name || '').split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '') || 'FUELOG';
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${first}${digits}`;
}

export default function ReferralScreen({ onBack, profile }: Props) {
  const { user } = useAuth();
  const [code, setCode] = useState<string>(profile.referral_code || '');
  const [loadingCode, setLoadingCode] = useState(!profile.referral_code);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loadingReferrals, setLoadingReferrals] = useState(true);
  const [copied, setCopied] = useState(false);

  const ensureCode = useCallback(async () => {
    if (!user) return;
    if (profile.referral_code) {
      setCode(profile.referral_code);
      setLoadingCode(false);
      return;
    }
    const newCode = generateCode(profile.name || '');
    const { error } = await supabase.from('profiles').update({ referral_code: newCode }).eq('id', user.id);
    if (error) {
      Alert.alert('Error', 'Could not generate your referral code. Please try again.');
    } else {
      setCode(newCode);
      profile.referral_code = newCode;
    }
    setLoadingCode(false);
  }, [user, profile]);

  const loadReferrals = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('referrals')
      .select('id, status, created_at, signed_up_at, converted_at')
      .eq('referrer_id', user.id)
      .order('created_at', { ascending: false });
    setReferrals((data || []) as Referral[]);
    setLoadingReferrals(false);
  }, [user]);

  const markConversions = useCallback(async () => {
    if (!user) return;
    const isPro = await hasPro();
    if (isPro) {
      // Update referral status if this user (the referee) has gone Pro
      await supabase
        .from('referrals')
        .update({ status: 'converted', converted_at: new Date().toISOString() })
        .eq('referee_id', user.id)
        .eq('status', 'signed_up');
      // TODO: Grant referrer 1 free month via RevenueCat promo/coupon API once configured
    }
  }, [user]);

  useEffect(() => {
    ensureCode();
    loadReferrals();
    markConversions();
  }, [ensureCode, loadReferrals, markConversions]);

  const shareLink = async () => {
    if (!code) return;
    try {
      await Share.share({
        message: `Join me on Fuelog — the best fitness & nutrition tracker.\n\nUse my code ${code} or this link to get 1 month of Pro free:\nhttps://fuelog.app/invite/${code}`,
        url: `https://fuelog.app/invite/${code}`,
      });
    } catch (e) { logError('ReferralScreen.shareLink', e); }
  };

  const copyCode = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const signedUpCount = referrals.filter(r => r.status === 'signed_up' || r.status === 'converted').length;
  const convertedCount = referrals.filter(r => r.status === 'converted').length;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <Text style={s.backLabel}>Me</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Refer a Friend</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* Hero */}
        <View style={s.heroCard}>
          <Text style={s.heroEmoji}>🎁</Text>
          <Text style={s.heroTitle}>Give a friend 1 month free</Text>
          <Text style={s.heroSub}>When they upgrade to Pro, you get 1 month free too.</Text>
        </View>

        {/* Code display */}
        <View style={s.codeCard}>
          <Text style={s.codeLabel}>YOUR REFERRAL CODE</Text>
          {loadingCode ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
          ) : (
            <View style={s.codeBox}>
              <Text style={s.codeText}>{code}</Text>
            </View>
          )}

          <View style={s.btnRow}>
            <TouchableOpacity style={s.shareBtn} onPress={shareLink} activeOpacity={0.8} disabled={!code}>
              <Ionicons name="share-outline" size={16} color={colors.accentText} />
              <Text style={s.shareBtnText}>Share Link</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.copyBtn} onPress={copyCode} activeOpacity={0.8} disabled={!code}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.accent} />
              <Text style={[s.copyBtnText, copied && { color: colors.accent }]}>
                {copied ? 'Copied!' : 'Copy Code'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats */}
        {!loadingReferrals && referrals.length > 0 && (
          <View style={s.statsCard}>
            <Text style={s.sectionLabel}>YOUR REFERRALS</Text>
            <View style={s.statsRow}>
              <View style={s.statCol}>
                <Text style={s.statVal}>{signedUpCount}</Text>
                <Text style={s.statLabel}>friends joined</Text>
              </View>
              <View style={s.statDivider} />
              <View style={s.statCol}>
                <Text style={s.statVal}>{convertedCount}</Text>
                <Text style={s.statLabel}>went Pro</Text>
              </View>
              <View style={s.statDivider} />
              <View style={s.statCol}>
                <Text style={[s.statVal, { color: colors.accent }]}>{convertedCount}</Text>
                <Text style={s.statLabel}>free months</Text>
              </View>
            </View>
          </View>
        )}

        {/* How it works */}
        <View style={s.howCard}>
          <Text style={s.sectionLabel}>HOW IT WORKS</Text>
          {[
            { step: '1', icon: 'share-outline', text: 'Share your code with a friend' },
            { step: '2', icon: 'person-add-outline', text: 'They sign up and enter your code' },
            { step: '3', icon: 'trophy-outline', text: 'When they go Pro, you both get 1 month free' },
          ].map(({ step, icon, text }) => (
            <View key={step} style={s.howRow}>
              <View style={s.howStep}>
                <Text style={s.howStepText}>{step}</Text>
              </View>
              <Ionicons name={icon as any} size={18} color={colors.accent} />
              <Text style={s.howText}>{text}</Text>
            </View>
          ))}
        </View>

        {/* Pending rewards */}
        {!loadingReferrals && referrals.length > 0 && (
          <View style={s.rewardsCard}>
            <Text style={s.sectionLabel}>FRIEND ACTIVITY</Text>
            {referrals.map(r => (
              <View key={r.id} style={s.rewardRow}>
                {r.status === 'converted' ? (
                  <>
                    <Text style={s.rewardEmoji}>🎉</Text>
                    <Text style={s.rewardText}>A friend went Pro — +1 month earned!</Text>
                  </>
                ) : (
                  <>
                    <Text style={s.rewardEmoji}>⏳</Text>
                    <Text style={s.rewardText}>A friend joined — remind them to go Pro!</Text>
                  </>
                )}
              </View>
            ))}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 60 },
  backLabel: { fontSize: 16, color: colors.text, fontWeight: weight.medium },
  headerTitle: { fontSize: 17, fontWeight: weight.bold, color: colors.text },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 48, gap: 12 },

  heroCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 24,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  heroEmoji: { fontSize: 40, marginBottom: 10 },
  heroTitle: { fontSize: 22, fontWeight: weight.heavy, color: colors.text, textAlign: 'center', marginBottom: 8 },
  heroSub: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, fontWeight: weight.medium },

  codeCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  codeLabel: { fontSize: 11, fontWeight: weight.semibold, color: colors.textSecondary, letterSpacing: 1.5, marginBottom: 12 },
  codeBox: {
    backgroundColor: colors.accentMuted, borderRadius: radius.md, paddingVertical: 16,
    alignItems: 'center', borderWidth: 1.5, borderColor: colors.accent, marginBottom: 16,
  },
  codeText: { fontSize: 32, fontWeight: weight.heavy, color: colors.accent, letterSpacing: 4 },
  btnRow: { flexDirection: 'row', gap: 10 },
  shareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 12,
  },
  shareBtnText: { color: colors.accentText, fontSize: 14, fontWeight: weight.bold },
  copyBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.accentMuted, borderRadius: radius.md, paddingVertical: 12,
    borderWidth: 1, borderColor: colors.accent,
  },
  copyBtnText: { color: colors.text, fontSize: 14, fontWeight: weight.bold },

  sectionLabel: { fontSize: 11, fontWeight: weight.semibold, color: colors.textSecondary, letterSpacing: 1.5, marginBottom: 14 },

  statsCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statCol: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, height: 36, backgroundColor: colors.border },
  statVal: { fontSize: 26, fontWeight: weight.heavy, color: colors.text },
  statLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: weight.medium, marginTop: 3, textAlign: 'center' },

  howCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  howStep: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accentMuted,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.accent,
  },
  howStepText: { fontSize: 12, fontWeight: weight.bold, color: colors.accent },
  howText: { flex: 1, fontSize: 14, color: colors.text, fontWeight: weight.medium },

  rewardsCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  rewardEmoji: { fontSize: 20 },
  rewardText: { flex: 1, fontSize: 14, color: colors.text, fontWeight: weight.medium },
});
