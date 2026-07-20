import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';

export default function AuthScreen() {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [forgotVisible, setForgotVisible] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const handleAuth = async () => {
    if (!email || !password) { Alert.alert('Please enter email and password'); return; }
    setLoading(true);
    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) Alert.alert('Error', error.message);
      else Alert.alert('Check your email', 'We sent you a confirmation link!');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) Alert.alert('Error', error.message);
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
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
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
            <Text style={s.tagline}>Track macros. Crush workouts.</Text>
          </View>

          <View style={s.card}>
            <View style={s.toggle}>
              <TouchableOpacity style={[s.toggleBtn, mode === 'login' && s.toggleActive]} onPress={() => setMode('login')}>
                <Text style={[s.toggleText, mode === 'login' && s.toggleTextActive]}>Log In</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.toggleBtn, mode === 'signup' && s.toggleActive]} onPress={() => setMode('signup')}>
                <Text style={[s.toggleText, mode === 'signup' && s.toggleTextActive]}>Sign Up</Text>
              </TouchableOpacity>
            </View>

            <Text style={s.label}>Email</Text>
            <TextInput style={s.input} value={email} onChangeText={setEmail}
              placeholder="you@example.com" placeholderTextColor={colors.textTertiary}
              autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />

            <Text style={s.label}>Password</Text>
            <TextInput style={s.input} value={password} onChangeText={setPassword}
              placeholder="••••••••" placeholderTextColor={colors.textTertiary} secureTextEntry />

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
              autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />

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
    hero: { alignItems: 'center', marginBottom: 48 },
    appName: { fontSize: 48, fontWeight: weight.heavy, color: c.text, letterSpacing: -2 },
    tagline: { fontSize: 15, color: c.textSecondary, fontWeight: weight.medium, marginTop: 8 },
    card: { backgroundColor: c.card, borderRadius: radius.card, padding: spacing.xl, borderWidth: 1, borderColor: c.border },
    toggle: { flexDirection: 'row', backgroundColor: c.cardAlt, borderRadius: radius.md, padding: 4, marginBottom: spacing.xl },
    toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
    toggleActive: { backgroundColor: c.accent },
    toggleText: { fontSize: 14, fontWeight: weight.semibold, color: c.textTertiary },
    toggleTextActive: { color: c.accentText },
    label: { fontSize: 11, fontWeight: weight.semibold, color: c.textSecondary, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
    input: { backgroundColor: c.cardAlt, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, color: c.text, padding: 14, fontSize: 15, marginBottom: spacing.lg, height: 48 },
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
