import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasPro } from '../constants/purchases';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import PaywallScreen from '../screens/PaywallScreen';

const WAS_PRO_KEY       = 'fuelog_was_pro';
const OFFER_SHOWN_KEY   = 'fuelog_save_offer_shown';

export default function CancellationSaveModal() {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [visible, setVisible]         = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const isPro = await hasPro();
      if (cancelled) return;
      if (isPro) {
        await AsyncStorage.setItem(WAS_PRO_KEY, '1');
        return;
      }
      const [wasPro, offerShown] = await Promise.all([
        AsyncStorage.getItem(WAS_PRO_KEY),
        AsyncStorage.getItem(OFFER_SHOWN_KEY),
      ]);
      if (!cancelled && wasPro === '1' && !offerShown) {
        setVisible(true);
      }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  const dismiss = async () => {
    await AsyncStorage.setItem(OFFER_SHOWN_KEY, '1');
    setVisible(false);
  };

  const handleUnlock = () => {
    setShowPaywall(false);
    setVisible(false);
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.heading}>Don't lose your progress</Text>
            <Text style={s.body}>
              As a thank-you for being a Pro member, we'd like to offer you 7 days free to continue.
            </Text>
            <TouchableOpacity style={s.claimBtn} onPress={() => setShowPaywall(true)} activeOpacity={0.85}>
              <Text style={s.claimBtnText}>Claim 7 Days Free →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.noThanksBtn} onPress={dismiss} activeOpacity={0.7}>
              <Text style={s.noThanksText}>No thanks</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showPaywall} animationType="slide" statusBarTranslucent>
        <PaywallScreen
          onClose={() => setShowPaywall(false)}
          onUnlock={handleUnlock}
        />
      </Modal>
    </>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.65)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: c.card,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      padding: spacing.xxl,
      paddingBottom: spacing.xxxl + 16,
    },
    heading: {
      fontSize: 22,
      fontWeight: weight.heavy,
      color: c.text,
      marginBottom: spacing.md,
      letterSpacing: -0.5,
    },
    body: {
      fontSize: 15,
      color: c.textSecondary,
      lineHeight: 22,
      marginBottom: spacing.xxl,
    },
    claimBtn: {
      backgroundColor: c.accent,
      borderRadius: radius.card,
      padding: spacing.lg,
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    claimBtnText: {
      color: c.accentText,
      fontSize: 16,
      fontWeight: weight.bold,
    },
    noThanksBtn: {
      padding: spacing.md,
      alignItems: 'center',
    },
    noThanksText: {
      color: c.textTertiary,
      fontSize: 14,
      fontWeight: weight.medium,
    },
  });
}
