import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';

export default function AuthScreen() {
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
              placeholder="you@example.com" placeholderTextColor="#444"
              autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />

            <Text style={s.label}>Password</Text>
            <TextInput style={s.input} value={password} onChangeText={setPassword}
              placeholder="••••••••" placeholderTextColor="#444" secureTextEntry />

            {mode === 'login' && (
              <TouchableOpacity onPress={openForgotPassword} style={s.forgotBtn}>
                <Text style={s.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={s.btn} onPress={handleAuth} disabled={loading} activeOpacity={0.8}>
              {loading
                ? <ActivityIndicator color="#000" />
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
              placeholder="you@example.com" placeholderTextColor="#444"
              autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />

            <TouchableOpacity style={s.btn} onPress={handleSendResetEmail} disabled={resetLoading} activeOpacity={0.8}>
              {resetLoading
                ? <ActivityIndicator color="#000" />
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

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  scroll: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  hero: { alignItems: 'center', marginBottom: 48 },
  appName: { fontSize: 48, fontWeight: '900', color: '#fff', letterSpacing: -2 },
  tagline: { fontSize: 15, color: '#444', fontWeight: '500', marginTop: 8 },
  card: { backgroundColor: '#1a1a1a', borderRadius: 20, padding: 24 },
  toggle: { flexDirection: 'row', backgroundColor: '#252525', borderRadius: 12, padding: 4, marginBottom: 24 },
  toggleBtn: { flex: 1, padding: 10, borderRadius: 10, alignItems: 'center' },
  toggleActive: { backgroundColor: '#fff' },
  toggleText: { fontSize: 14, fontWeight: '700', color: '#555' },
  toggleTextActive: { color: '#000' },
  label: { fontSize: 12, fontWeight: '700', color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#252525', borderRadius: 12, color: '#fff', padding: 14, fontSize: 15, marginBottom: 16 },
  btn: { backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#000', fontSize: 16, fontWeight: '800' },
  forgotBtn: { alignSelf: 'flex-end', marginTop: -8, marginBottom: 8 },
  forgotText: { color: '#888', fontSize: 13, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#1a1a1a', borderRadius: 20, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 8 },
  modalSubtitle: { fontSize: 13, color: '#888', marginBottom: 20, lineHeight: 18 },
  modalCancel: { alignItems: 'center', marginTop: 12, padding: 8 },
  modalCancelText: { color: '#888', fontSize: 14, fontWeight: '600' },
});
