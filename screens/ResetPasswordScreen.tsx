import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';

interface ResetPasswordScreenProps {
  onDone: () => void;
}

export default function ResetPasswordScreen({ onDone }: ResetPasswordScreenProps) {
  const { colors } = useTheme();
  const s = makeStyles(colors);

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
              placeholder="••••••••" placeholderTextColor={colors.textTertiary} secureTextEntry />

            <Text style={s.label}>Confirm Password</Text>
            <TextInput style={s.input} value={confirmPassword} onChangeText={setConfirmPassword}
              placeholder="••••••••" placeholderTextColor={colors.textTertiary} secureTextEntry />

            <TouchableOpacity style={s.btn} onPress={handleSubmit} disabled={loading} activeOpacity={0.8}>
              {loading
                ? <ActivityIndicator color={colors.accentText} />
                : <Text style={s.btnText}>Update Password</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    label: { fontSize: 11, fontWeight: weight.semibold, color: c.textSecondary, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
    input: { backgroundColor: c.cardAlt, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, color: c.text, padding: 14, fontSize: 15, marginBottom: spacing.lg, height: 48 },
    btn: { backgroundColor: c.accent, borderRadius: radius.card, padding: spacing.lg, alignItems: 'center', marginTop: spacing.sm, height: 52, justifyContent: 'center' },
    btnText: { color: c.accentText, fontSize: 16, fontWeight: weight.bold },
  });
}
