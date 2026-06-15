import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';

interface ResetPasswordScreenProps {
  onDone: () => void;
}

export default function ResetPasswordScreen({ onDone }: ResetPasswordScreenProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!password || !confirmPassword) {
      Alert.alert('Please fill out both fields');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Password too short', 'Your password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Passwords do not match');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Password updated', 'Your password has been reset successfully.', [
        { text: 'OK', onPress: onDone },
      ]);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.hero}>
            <Text style={s.appName}>Fuelog</Text>
            <Text style={s.tagline}>Set a new password</Text>
          </View>

          <View style={s.card}>
            <Text style={s.label}>New Password</Text>
            <TextInput style={s.input} value={password} onChangeText={setPassword}
              placeholder="••••••••" placeholderTextColor="#444" secureTextEntry />

            <Text style={s.label}>Confirm Password</Text>
            <TextInput style={s.input} value={confirmPassword} onChangeText={setConfirmPassword}
              placeholder="••••••••" placeholderTextColor="#444" secureTextEntry />

            <TouchableOpacity style={s.btn} onPress={handleSubmit} disabled={loading} activeOpacity={0.8}>
              {loading
                ? <ActivityIndicator color="#000" />
                : <Text style={s.btnText}>Update Password</Text>}
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
  label: { fontSize: 12, fontWeight: '700', color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#252525', borderRadius: 12, color: '#fff', padding: 14, fontSize: 15, marginBottom: 16 },
  btn: { backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#000', fontSize: 16, fontWeight: '800' },
});
