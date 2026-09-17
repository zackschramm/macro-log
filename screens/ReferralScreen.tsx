import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Share, Alert, TextInput, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { colors, weight, radius } from '../constants/theme';
import { logError } from '../utils/logError';
import { parseReferralInput } from '../utils/referral';

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
  // Entering a friend's code. There was no way to do this in 1.0 — the only
  // path was a deep link, and the link the app shared was not the shape the
  // app parsed. Most codes are passed on as text ("my code is ZACK1234"), so
  // this is the path that actually gets used.
  const [friendCode, setFriendCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [referredBy, setReferredBy] = useState<string | null>(profile.referred_by ?? null);

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

  /**
   * Redeem a code a friend gave you.
   *
   * All the rules — code exists, not your own, not already referred — are
   * enforced by the redeem_referral RPC, because the client cannot be the
   * authority on any of them. The old INSERT policy was `auth.uid() =
   * referee_id` and nothing else, which permitted self-referral, unlimited
   * referrers per account, and a client-chosen 'converted' status.
   */
  const redeemFriendCode = useCallback(async () => {
    const parsed = parseReferralInput(friendCode);
    if (!parsed) {
      Alert.alert('Check the code', "That doesn't look like a referral code. It's letters and numbers, like ZACK1234 — you can also paste the whole link your friend sent.");
      return;
    }
    if (parsed === code) {
      Alert.alert('That\u2019s your code', 'You can\u2019t refer yourself. Share it with someone you train with instead.');
      return;
    }
    Keyboard.dismiss();
    setRedeeming(true);
    try {
      const { data, error } = await supabase.rpc('redeem_referral', { p_code: parsed });
      if (error) throw error;
      if (data?.ok) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setReferredBy(data.code);
        profile.referred_by = data.code;
        setFriendCode('');
        Alert.alert('Code applied', `You\u2019re down as referred by ${data.code}. Thanks for telling us who sent you.`);
      } else {
        // Say which rule was hit. A generic failure here is what makes people
        // retype a perfectly good code five times.
        const msg: Record<string, string> = {
          unknown_code: "We don't have that code. Check it with your friend — codes are letters then numbers, like ZACK1234.",
          self_referral: 'That is your own code. Share it with someone else instead.',
          already_referred: `You're already down as referred by ${data?.code ?? 'another athlete'}. Only the first code counts.`,
          invalid_code: "That doesn't look like a referral code.",
          not_signed_in: 'Sign in first, then apply the code.',
        };
        Alert.alert('Could not apply that code', msg[data?.reason] ?? 'Please try again.');
      }
    } catch (e) {
      logError('ReferralScreen.redeemFriendCode', e);
      Alert.alert('Connection problem', 'Could not reach the server. Try again in a moment.');
    } finally {
      setRedeeming(false);
    }
  }, [friendCode, code, profile]);

  useEffect(() => {
    ensureCode();
    loadReferrals();
    // markConversions() used to run here: it asked hasPro() on the referee's
    // own device and wrote status='converted' from the client. RLS silently
    // refused it (there is no UPDATE policy on referrals), so status could
    // never leave 'signed_up' — and had it worked, anyone could have minted
    // the reward by claiming Pro. Conversion belongs to the RevenueCat
    // webhook via mark_referral_converted(), which is the only thing that
    // knows whether money changed hands. Tracked for the reward wiring.
  }, [ensureCode, loadReferrals]);

  const shareLink = async () => {
    if (!code) return;
    try {
      // URL: the site has no /invite route (static export) — the old link was
      // a guaranteed 404 on the app's only viral loop. ?ref= lands on the
      // homepage and still carries the code. Copy: no "1 month of Pro free"
      // until the reward is actually wired to RevenueCat — promising an
      // unwired reward next to a live paywall is the kind of bait athletes
      // torch publicly.
      await Share.share({
        message: `Join me on Fuelog — race fueling and nutrition built for endurance athletes.\n\nUse my code ${code} when you sign up:\nhttps://fuelog.app/?ref=${code}`,
        url: `https://fuelog.app/?ref=${code}`,
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
          <Ionicons name="gift-outline" size={44} color={colors.textTertiary} />
          {/* The reward IS wired now: revenuecat-webhook grants a stacking
              month of Pro on a referee's first PAID renewal, not on a trial
              start. Two things must be true in production before this copy is
              honest — the webhook deployed, and REVENUECAT_SECRET_KEY set. If
              either is missing the conversion is still recorded and the grant
              is skipped with a log line, so revert this string rather than
              leaving a promise the server cannot keep. */}
          <Text style={s.heroTitle}>Invite your training partners</Text>
          <Text style={s.heroSub}>
            When someone you refer subscribes, you get a free month of Pro. Months stack —
            refer three athletes who subscribe and you get three.
          </Text>
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

        {/* A friend's code. Hidden once used — only the first code counts, and
            an input that can no longer do anything is worse than no input. */}
        {referredBy ? (
          <View style={s.friendCard}>
            <Text style={s.sectionLabel}>REFERRED BY</Text>
            <View style={s.referredRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
              <Text style={s.referredCode}>{referredBy}</Text>
            </View>
            <Text style={s.friendHint}>Thanks for telling us who sent you.</Text>
          </View>
        ) : (
          <View style={s.friendCard}>
            <Text style={s.sectionLabel}>HAVE A FRIEND'S CODE?</Text>
            <Text style={s.friendHint}>
              Enter it below, or paste the whole link they sent you.
            </Text>
            <View style={s.friendRow}>
              <TextInput
                style={s.friendInput}
                value={friendCode}
                onChangeText={setFriendCode}
                placeholder="ZACK1234"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="characters"
                autoCorrect={false}
                spellCheck={false}
                returnKeyType="done"
                onSubmitEditing={redeemFriendCode}
                editable={!redeeming}
                maxLength={120}
              />
              <TouchableOpacity
                style={[s.applyBtn, (!friendCode.trim() || redeeming) && s.applyBtnOff]}
                onPress={redeemFriendCode}
                activeOpacity={0.8}
                disabled={!friendCode.trim() || redeeming}
              >
                {redeeming
                  ? <ActivityIndicator color={colors.accentText} size="small" />
                  : <Text style={s.applyBtnText}>Apply</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

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
            </View>
          </View>
        )}

        {/* How it works */}
        <View style={s.howCard}>
          <Text style={s.sectionLabel}>HOW IT WORKS</Text>
          {[
            { step: '1', icon: 'share-outline', text: 'Share your code with a friend' },
            { step: '2', icon: 'person-add-outline', text: 'They sign up and enter your code' },
            { step: '3', icon: 'trophy-outline', text: 'Rewards for both of you are coming soon' },
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
                    <Ionicons name="ribbon-outline" size={22} color={colors.textTertiary} />
                    <Text style={s.rewardText}>A friend went Pro!</Text>
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

  friendCard: {
    backgroundColor: colors.card, borderRadius: radius.card, padding: 18,
    borderWidth: 1, borderColor: colors.border, marginBottom: 14,
  },
  friendHint: { fontSize: 13, color: colors.textTertiary, lineHeight: 19, marginTop: -6, marginBottom: 14 },
  friendRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  friendInput: {
    flex: 1, backgroundColor: colors.bg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 16, fontWeight: weight.semibold, color: colors.text, letterSpacing: 1,
  },
  applyBtn: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingHorizontal: 20, paddingVertical: 14, minWidth: 86, alignItems: 'center',
  },
  applyBtnOff: { opacity: 0.4 },
  applyBtnText: { fontSize: 15, fontWeight: weight.bold, color: colors.accentText },
  referredRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  referredCode: { fontSize: 18, fontWeight: weight.bold, color: colors.text, letterSpacing: 1.5 },
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
