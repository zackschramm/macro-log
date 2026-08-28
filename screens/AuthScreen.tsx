import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../constants/supabase';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { logError } from '../utils/logError';

/**
 * Sign-in.
 *
 * Two paths, one identity model:
 * - Sign in with Apple (native flow → Supabase signInWithIdToken). Supabase
 *   auto-links to an existing account when the emails match; a user who picks
 *   "Hide My Email" gets a fresh account by design, so the divider copy nudges
 *   people with an existing email account to keep using it.
 * - Email/password (the original flow, and the one App Review's demo account
 *   uses — it must never regress behind the Apple button).
 *
 * Guideline 4.8 note: with ONLY first-party email auth we were exempt from
 * offering Apple's button. Adding any third-party login later (Google etc.)
 * requires Apple's to already be here — which after this change it is.
 *
 * Error UX is inline (no more raw Supabase strings in Alert popups), fields
 * carry textContentType/autoComplete so iCloud Keychain autofill works, and
 * return-key chaining submits from the keyboard.
 */

/** sha256(nonce) goes to Apple; the raw nonce goes to Supabase for replay protection. */
async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  const raw = Array.from(bytes as Uint8Array, (b: number) => b.toString(16).padStart(2, '0')).join('');
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  return { raw, hashed };
}

/** Supabase's error strings are engineer-speak; translate the common ones. */
function friendlyAuthError(message: string, mode: 'login' | 'signup'): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Wrong email or password. Try again, or reset your password below.';
  if (m.includes('email not confirmed')) return 'Your email isn’t confirmed yet — check your inbox for the link.';
  if (m.includes('user already registered')) return 'That email already has an account. Switch to Log In.';
  if (m.includes('password should be at least')) return 'Password needs at least 6 characters.';
  if (m.includes('network')) return 'No connection. Check your network and try again.';
  return mode === 'signup' ? 'Could not create the account. Please try again.' : 'Could not sign you in. Please try again.';
}

export default function AuthScreen() {
  const { colors, isDark } = useTheme();
  const s = makeStyles(colors);

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [signupSent, setSignupSent] = useState(false);

  const [appleAvailable, setAppleAvailable] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  React.useEffect(() => {
    // Native module exists only in real iOS builds — Expo Go and Android
    // simply never show the button.
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  const [forgotVisible, setForgotVisible] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const handleApple = async () => {
    setFormError(null);
    setAppleLoading(true);
    try {
      const nonce = await makeNonce();
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: nonce.hashed,
      });
      if (!credential.identityToken) throw new Error('Apple returned no identity token');

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        nonce: nonce.raw,
      });
      if (error) throw error;

      // Apple's 5.1.1(v) deletion rule: revoking tokens on account deletion
      // needs a refresh token, and the authorizationCode that buys one is only
      // valid for minutes — so the exchange happens NOW, server-side, and the
      // delete-account function spends it later. Fire-and-forget: a failed
      // exchange must never block a successful sign-in.
      if (credential.authorizationCode && data?.user) {
        supabase.functions
          .invoke('apple-token-exchange', { body: { authorization_code: credential.authorizationCode } })
          .catch(e => logError('Auth.appleTokenExchange', e));
      }

      // Apple only reveals the name on FIRST authorization; save it or lose it.
      const name = credential.fullName;
      const displayName = [name?.givenName, name?.familyName].filter(Boolean).join(' ');
      if (displayName && data?.user) {
        supabase.auth.updateUser({ data: { full_name: displayName } }).catch(() => {});
      }
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') {
        // User closed the sheet — not an error, say nothing.
      } else {
        logError('Auth.apple', e);
        setFormError('Sign in with Apple didn’t complete. You can try again or use email below.');
      }
    } finally {
      setAppleLoading(false);
    }
  };

  const handleAuth = async () => {
    setFormError(null);
    if (!email || !password) { setFormError('Enter your email and password first.'); return; }
    setLoading(true);
    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) setFormError(friendlyAuthError(error.message, 'signup'));
      else setSignupSent(true);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setFormError(friendlyAuthError(error.message, 'login'));
    }
    setLoading(false);
  };

  const openForgotPassword = () => {
    setResetEmail(email);
    setForgotVisible(true);
  };

  const handleSendResetEmail = async () => {
    if (!resetEmail) { Alert.alert('Please enter your email'); return; }
    setResetLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: 'fuelog://reset-password',
    });
    setResetLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setForgotVisible(false);
      Alert.alert('Check your email', 'If an account exists for that email, we sent a link to reset your password.');
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.hero}>
            <Text style={s.appName}>Fuelog</Text>
            <Text style={s.tagline}>Your race, fueled leg by leg.</Text>
          </View>

          <View style={s.card}>
            {appleAvailable && (
              <>
                {appleLoading ? (
                  <View style={s.appleBtnLoading}><ActivityIndicator color={colors.text} /></View>
                ) : (
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                    buttonStyle={isDark
                      ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                      : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={12}
                    style={s.appleBtn}
                    onPress={handleApple}
                  />
                )}
                <View style={s.dividerRow}>
                  <View style={s.dividerLine} />
                  <Text style={s.dividerText}>or use email</Text>
                  <View style={s.dividerLine} />
                </View>
                <Text style={s.linkHint}>
                  Already have a Fuelog account? Sign in with the same email to keep your data.
                </Text>
              </>
            )}

            <View style={s.toggle}>
              <TouchableOpacity style={[s.toggleBtn, mode === 'login' && s.toggleActive]} onPress={() => { setMode('login'); setFormError(null); setSignupSent(false); }}>
                <Text style={[s.toggleText, mode === 'login' && s.toggleTextActive]}>Log In</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.toggleBtn, mode === 'signup' && s.toggleActive]} onPress={() => { setMode('signup'); setFormError(null); }}>
                <Text style={[s.toggleText, mode === 'signup' && s.toggleTextActive]}>Sign Up</Text>
              </TouchableOpacity>
            </View>

            {signupSent ? (
              <View style={s.sentBox}>
                <Ionicons name="mail-unread-outline" size={28} color={colors.accent} />
                <Text style={s.sentTitle}>Check your email</Text>
                <Text style={s.sentBody}>We sent a confirmation link to {email.trim()}. Tap it, then come back and log in.</Text>
                <TouchableOpacity onPress={() => { setSignupSent(false); setMode('login'); }}>
                  <Text style={s.sentAction}>Back to Log In</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={s.label}>Email</Text>
                <TextInput style={s.input} value={email} onChangeText={setEmail}
                  placeholder="you@example.com" placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
                  textContentType={mode === 'signup' ? 'username' : 'emailAddress'}
                  autoComplete="email"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()} />

                <Text style={s.label}>Password</Text>
                <View style={s.passwordRow}>
                  <TextInput ref={passwordRef} style={[s.input, s.passwordInput]} value={password} onChangeText={setPassword}
                    placeholder="••••••••" placeholderTextColor={colors.textTertiary}
                    secureTextEntry={!showPassword}
                    textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    returnKeyType="go"
                    onSubmitEditing={handleAuth} />
                  <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPassword(v => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
                {mode === 'signup' && <Text style={s.pwHint}>At least 6 characters.</Text>}

                {formError && (
                  <View style={s.errorBox} accessibilityLiveRegion="polite">
                    <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                    <Text style={s.errorText}>{formError}</Text>
                  </View>
                )}

                {mode === 'login' && (
                  <TouchableOpacity onPress={openForgotPassword} style={s.forgotBtn}>
                    <Text style={s.forgotText}>Forgot password?</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity style={s.btn} onPress={handleAuth} disabled={loading} activeOpacity={0.8}>
                  {loading
                    ? <ActivityIndicator color={colors.accentText} />
                    : <Text style={s.btnText}>{mode === 'login' ? 'Log In' : 'Create Account'}</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={forgotVisible} animationType="slide" transparent onRequestClose={() => setForgotVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Reset Password</Text>
            <Text style={s.modalSubtitle}>Enter your email and we'll send you a link to reset your password.</Text>

            <Text style={s.label}>Email</Text>
            <TextInput style={s.input} value={resetEmail} onChangeText={setResetEmail}
              placeholder="you@example.com" placeholderTextColor={colors.textTertiary}
              autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
              textContentType="emailAddress" autoComplete="email" />

            <TouchableOpacity style={s.btn} onPress={handleSendResetEmail} disabled={resetLoading} activeOpacity={0.8}>
              {resetLoading
                ? <ActivityIndicator color={colors.accentText} />
                : <Text style={s.btnText}>Send Reset Link</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={s.modalCancel} onPress={() => setForgotVisible(false)}>
              <Text style={s.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    scroll: { flexGrow: 1, padding: spacing.xl, justifyContent: 'center' },
    hero: { alignItems: 'center', marginBottom: 40 },
    appName: { fontSize: 48, fontWeight: weight.heavy, color: c.text, letterSpacing: -2 },
    tagline: { fontSize: 15, color: c.textSecondary, fontWeight: weight.medium, marginTop: 8 },
    card: { backgroundColor: c.card, borderRadius: radius.card, padding: spacing.xl, borderWidth: 1, borderColor: c.border },
    appleBtn: { width: '100%', height: 48 },
    appleBtnLoading: { width: '100%', height: 48, alignItems: 'center', justifyContent: 'center' },
    dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.lg },
    dividerLine: { flex: 1, height: 1, backgroundColor: c.border },
    dividerText: { color: c.textTertiary, fontSize: 12, fontWeight: weight.semibold, marginHorizontal: spacing.md, textTransform: 'uppercase', letterSpacing: 0.5 },
    linkHint: { color: c.textTertiary, fontSize: 12, lineHeight: 16, marginBottom: spacing.lg, textAlign: 'center' },
    toggle: { flexDirection: 'row', backgroundColor: c.cardAlt, borderRadius: radius.md, padding: 4, marginBottom: spacing.xl },
    toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
    toggleActive: { backgroundColor: c.accent },
    toggleText: { fontSize: 14, fontWeight: weight.semibold, color: c.textTertiary },
    toggleTextActive: { color: c.accentText },
    label: { fontSize: 11, fontWeight: weight.semibold, color: c.textSecondary, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
    input: { backgroundColor: c.cardAlt, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, color: c.text, padding: 14, fontSize: 15, marginBottom: spacing.lg, height: 48 },
    passwordRow: { position: 'relative' },
    passwordInput: { paddingRight: 46 },
    eyeBtn: { position: 'absolute', right: 12, top: 14, height: 20, width: 24, alignItems: 'center', justifyContent: 'center' },
    pwHint: { color: c.textTertiary, fontSize: 12, marginTop: -10, marginBottom: spacing.md },
    errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: c.cardAlt, borderRadius: radius.md, borderWidth: 1, borderColor: c.danger, padding: spacing.md, marginBottom: spacing.md },
    errorText: { color: c.danger, fontSize: 13, lineHeight: 18, flex: 1 },
    sentBox: { alignItems: 'center', paddingVertical: spacing.lg, gap: 8 },
    sentTitle: { color: c.text, fontSize: 17, fontWeight: weight.bold },
    sentBody: { color: c.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    sentAction: { color: c.accent, fontSize: 14, fontWeight: weight.semibold, marginTop: spacing.md },
    btn: { backgroundColor: c.accent, borderRadius: radius.card, padding: spacing.lg, alignItems: 'center', marginTop: spacing.sm, height: 52, justifyContent: 'center' },
    btnText: { color: c.accentText, fontSize: 16, fontWeight: weight.bold },
    forgotBtn: { alignSelf: 'flex-end', marginTop: -8, marginBottom: spacing.sm },
    forgotText: { color: c.textSecondary, fontSize: 13, fontWeight: weight.semibold },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: spacing.xl },
    modalCard: { backgroundColor: c.card, borderRadius: radius.card, padding: spacing.xl, borderWidth: 1, borderColor: c.border },
    modalTitle: { fontSize: 20, fontWeight: weight.bold, color: c.text, marginBottom: spacing.sm },
    modalSubtitle: { fontSize: 13, color: c.textSecondary, marginBottom: spacing.xl, lineHeight: 18 },
    modalCancel: { alignItems: 'center', marginTop: spacing.md, padding: spacing.sm },
    modalCancelText: { color: c.textSecondary, fontSize: 14, fontWeight: weight.semibold },
  });
}
