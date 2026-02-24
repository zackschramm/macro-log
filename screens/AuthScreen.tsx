import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

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

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.hero}>
            <Text style={s.appName}>Macro Log</Text>
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

            <TouchableOpacity style={s.btn} onPress={handleAuth} disabled={loading} activeOpacity={0.8}>
              {loading
                ? <ActivityIndicator color="#000" />
                : <Text style={s.btnText}>{mode === 'login' ? 'Log In' : 'Create Account'}</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
});
