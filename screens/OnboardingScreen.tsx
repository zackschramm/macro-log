import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { calculateTargets } from '../constants/data';

const ACTIVITY_OPTIONS = [
  { key: 'sedentary', label: 'Sedentary', sub: 'Little or no exercise' },
  { key: 'light', label: 'Lightly Active', sub: '1-3 days/week' },
  { key: 'moderate', label: 'Moderate', sub: '3-5 days/week' },
  { key: 'active', label: 'Very Active', sub: '6-7 days/week' },
  { key: 'very_active', label: 'Athlete', sub: 'Twice daily' },
];

const GOAL_OPTIONS = [
  { key: 'lose', label: 'Lose Fat', sub: '-300 cal deficit' },
  { key: 'maintain', label: 'Maintain', sub: 'Stay at current weight' },
  { key: 'gain', label: 'Build Muscle', sub: '+300 cal surplus' },
];

export default function OnboardingScreen({ onComplete }: { onComplete: (p: any) => void }) {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [sex, setSex] = useState('male');
  const [age, setAge] = useState('');
  const [heightFt, setHeightFt] = useState('');
  const [heightIn, setHeightIn] = useState('');
  const [weight, setWeight] = useState('');
  const [activity, setActivity] = useState('moderate');
  const [goal, setGoal] = useState('gain');
  const [loading, setLoading] = useState(false);

  const totalHeightIn = (parseInt(heightFt) || 0) * 12 + (parseInt(heightIn) || 0);

  const handleFinish = async () => {
    if (!name || !age || !totalHeightIn || !weight) {
      Alert.alert('Please fill in all fields'); return;
    }
    setLoading(true);
    const profileData = {
      weight_lbs: parseFloat(weight), height_in: totalHeightIn,
      age: parseInt(age), sex, activity, goal,
    };
    const targets = calculateTargets(profileData);
    const profile = { id: user!.id, name, ...profileData, ...targets };
    const { error } = await supabase.from('profiles').upsert(profile);
    if (error) { Alert.alert('Error', error.message); setLoading(false); return; }
    onComplete(profile);
    setLoading(false);
  };

  const steps = [
    // Step 0 - Name & basics
    <View key={0}>
      <Text style={s.stepTitle}>Let's get started 👋</Text>
      <Text style={s.stepSub}>We'll calculate your personal macro targets.</Text>

      <Text style={s.label}>Your Name</Text>
      <TextInput style={s.input} value={name} onChangeText={setName}
        placeholder="e.g. Zack" placeholderTextColor="#444" autoCorrect={false} />

      <Text style={s.label}>Sex</Text>
      <View style={s.row}>
        {['male', 'female'].map(v => (
          <TouchableOpacity key={v} style={[s.optBtn, sex === v && s.optBtnActive, { flex: 1 }]} onPress={() => setSex(v)}>
            <Text style={[s.optBtnText, sex === v && s.optBtnTextActive]}>{v === 'male' ? '♂ Male' : '♀ Female'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.label}>Age</Text>
      <TextInput style={s.input} value={age} onChangeText={setAge}
        placeholder="25" placeholderTextColor="#444" keyboardType="number-pad" />
    </View>,

    // Step 1 - Height & weight
    <View key={1}>
      <Text style={s.stepTitle}>Body Stats 📏</Text>
      <Text style={s.stepSub}>Used to calculate your calorie needs.</Text>

      <Text style={s.label}>Height</Text>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <TextInput style={s.input} value={heightFt} onChangeText={setHeightFt}
            placeholder="ft" placeholderTextColor="#444" keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <TextInput style={s.input} value={heightIn} onChangeText={setHeightIn}
            placeholder="in" placeholderTextColor="#444" keyboardType="number-pad" />
        </View>
      </View>

      <Text style={s.label}>Weight (lbs)</Text>
      <TextInput style={s.input} value={weight} onChangeText={setWeight}
        placeholder="172" placeholderTextColor="#444" keyboardType="decimal-pad" />
    </View>,

    // Step 2 - Activity
    <View key={2}>
      <Text style={s.stepTitle}>Activity Level 🏃</Text>
      <Text style={s.stepSub}>How active are you on a typical week?</Text>
      {ACTIVITY_OPTIONS.map(opt => (
        <TouchableOpacity key={opt.key} style={[s.bigOptBtn, activity === opt.key && s.bigOptBtnActive]}
          onPress={() => setActivity(opt.key)}>
          <Text style={[s.bigOptLabel, activity === opt.key && s.bigOptLabelActive]}>{opt.label}</Text>
          <Text style={[s.bigOptSub, activity === opt.key && s.bigOptSubActive]}>{opt.sub}</Text>
        </TouchableOpacity>
      ))}
    </View>,

    // Step 3 - Goal
    <View key={3}>
      <Text style={s.stepTitle}>Your Goal 🎯</Text>
      <Text style={s.stepSub}>This adjusts your daily calorie target.</Text>
      {GOAL_OPTIONS.map(opt => (
        <TouchableOpacity key={opt.key} style={[s.bigOptBtn, goal === opt.key && s.bigOptBtnActive]}
          onPress={() => setGoal(opt.key)}>
          <Text style={[s.bigOptLabel, goal === opt.key && s.bigOptLabelActive]}>{opt.label}</Text>
          <Text style={[s.bigOptSub, goal === opt.key && s.bigOptSubActive]}>{opt.sub}</Text>
        </TouchableOpacity>
      ))}
    </View>,
  ];

  return (
    <SafeAreaView style={s.safe}>
      {/* Progress dots */}
      <View style={s.dots}>
        {steps.map((_, i) => (
          <View key={i} style={[s.dot, i === step && s.dotActive, i < step && s.dotDone]} />
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {steps[step]}
      </ScrollView>

      <View style={s.footer}>
        {step > 0 && (
          <TouchableOpacity style={s.backBtn} onPress={() => setStep(step - 1)}>
            <Text style={s.backBtnText}>Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.nextBtn, { flex: step > 0 ? 1 : undefined, width: step === 0 ? '100%' : undefined }]}
          onPress={step < steps.length - 1 ? () => setStep(step + 1) : handleFinish}
          disabled={loading} activeOpacity={0.8}>
          {loading
            ? <ActivityIndicator color="#000" />
            : <Text style={s.nextBtnText}>{step < steps.length - 1 ? 'Continue' : 'Calculate My Macros'}</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2a2a2a' },
  dotActive: { backgroundColor: '#fff', width: 24 },
  dotDone: { backgroundColor: '#4ade80' },
  content: { padding: 24, paddingBottom: 12 },
  stepTitle: { fontSize: 26, fontWeight: '900', color: '#fff', letterSpacing: -0.5, marginBottom: 8 },
  stepSub: { fontSize: 14, color: '#555', fontWeight: '500', marginBottom: 28 },
  label: { fontSize: 11, fontWeight: '700', color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#1e1e1e', borderRadius: 12, color: '#fff', padding: 14, fontSize: 16, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  optBtn: { backgroundColor: '#1e1e1e', borderRadius: 12, padding: 14, alignItems: 'center' },
  optBtnActive: { backgroundColor: '#fff' },
  optBtnText: { color: '#555', fontSize: 14, fontWeight: '700' },
  optBtnTextActive: { color: '#000' },
  bigOptBtn: { backgroundColor: '#1e1e1e', borderRadius: 14, padding: 16, marginBottom: 10 },
  bigOptBtnActive: { backgroundColor: '#fff' },
  bigOptLabel: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 2 },
  bigOptLabelActive: { color: '#000' },
  bigOptSub: { fontSize: 12, color: '#555', fontWeight: '500' },
  bigOptSubActive: { color: '#333' },
  footer: { flexDirection: 'row', gap: 10, padding: 24, paddingTop: 12 },
  backBtn: { backgroundColor: '#1e1e1e', borderRadius: 12, padding: 16, alignItems: 'center', width: 80 },
  backBtnText: { color: '#888', fontSize: 15, fontWeight: '700' },
  nextBtn: { backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center' },
  nextBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },
});
