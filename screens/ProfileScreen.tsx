import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';
import * as ImagePicker from 'expo-image-picker';
import FoodsScreen from './FoodsScreen';
import MealPlanScreen from './MealPlanScreen';
import NotificationsScreen from './NotificationsScreen';
import MineralsScreen from './MineralsScreen';
import { useAuth } from '../hooks/useAuth';
import { calculateTargets, MC } from '../constants/data';

const ACTIVITY_OPTIONS = [
  { key: 'sedentary', label: 'Sedentary' },
  { key: 'light', label: 'Lightly Active' },
  { key: 'moderate', label: 'Moderate' },
  { key: 'active', label: 'Very Active' },
  { key: 'very_active', label: 'Athlete' },
];
const GOAL_OPTIONS = [
  { key: 'lose', label: 'Lose Fat' },
  { key: 'maintain', label: 'Maintain' },
  { key: 'gain', label: 'Build Muscle' },
]; 
const SPORT_OPTIONS = [
  { key: 'none',         label: 'General',       emoji: '🏋️' },
  { key: 'bodybuilding', label: 'Bodybuilding',   emoji: '💪' },
  { key: 'powerlifting', label: 'Powerlifting',   emoji: '🏋️' },
  { key: 'crossfit',     label: 'CrossFit',       emoji: '🔥' },
  { key: 'running',      label: 'Running',        emoji: '🏃' },
  { key: 'cycling',      label: 'Cycling',        emoji: '🚴' },
  { key: 'swimming',     label: 'Swimming',       emoji: '🏊' },
  { key: 'basketball',   label: 'Basketball',     emoji: '🏀' },
  { key: 'soccer',       label: 'Soccer',         emoji: '⚽' },
  { key: 'football',     label: 'Football',       emoji: '🏈' },
  { key: 'baseball',     label: 'Baseball',       emoji: '⚾' },
  { key: 'tennis',       label: 'Tennis',         emoji: '🎾' },
  { key: 'wrestling',    label: 'Wrestling/MMA',  emoji: '🥊' },
  { key: 'gymnastics',   label: 'Gymnastics',     emoji: '🤸' },
  { key: 'volleyball',   label: 'Volleyball',     emoji: '🏐' },
  { key: 'hockey',       label: 'Hockey',         emoji: '🏒' },
  { key: 'golf',         label: 'Golf',           emoji: '⛳' },
  { key: 'climbing',     label: 'Climbing',       emoji: '🧗' },
  { key: 'yoga',         label: 'Yoga',           emoji: '🧘' },
  { key: 'rowing',       label: 'Rowing',         emoji: '🚣' },
];
export default function ProfileScreen({ profile, onUpdate }: { profile: any; onUpdate: (p: any) => void }) {
  const { user, signOut } = useAuth();
  const [name, setName] = useState(profile.name || '');
  const [age, setAge] = useState(String(profile.age || ''));
  const [weight, setWeight] = useState(String(profile.weight_lbs || ''));
  const ftVal = Math.floor((profile.height_in || 0) / 12);
  const inVal = (profile.height_in || 0) % 12;
  const [heightFt, setHeightFt] = useState(String(ftVal || ''));
  const [heightIn, setHeightIn] = useState(String(inVal || ''));
  const [sex, setSex] = useState(profile.sex || 'male');
  const [activity, setActivity] = useState(profile.activity || 'moderate');
  const [goal, setGoal] = useState(profile.goal || 'gain');
<Text style={s.label}>Sport / Training Style</Text>
        <View style={s.optRow}>
          {SPORT_OPTIONS.map(o => (
            <TouchableOpacity key={o.key} style={[s.optBtn, sport === o.key && s.optBtnActive]} onPress={() => setSport(o.key)}>
              <Text style={[s.optBtnText, sport === o.key && s.optBtnTextActive]}>{o.emoji} {o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
const [sport, setSport] = useState(profile.sport || 'none');
  const [loading, setLoading] = useState(false);
  const [customGoals, setCustomGoals] = useState(!!profile.custom_goals);
  const [customCal, setCustomCal] = useState(profile.custom_goals ? String(profile.calories || '') : '');
  const [customProtein, setCustomProtein] = useState(profile.custom_goals ? String(profile.protein || '') : '');
  const [customCarbs, setCustomCarbs] = useState(profile.custom_goals ? String(profile.carbs || '') : '');
  const [customFat, setCustomFat] = useState(profile.custom_goals ? String(profile.fat || '') : '');
  const [saved, setSaved] = useState(false);
  const [profileTab, setProfileTab] = useState<'profile' | 'foods' | 'plan' | 'notifs' | 'minerals'>('profile');
  const [avatarUri, setAvatarUri] = useState(profile.avatar_url || null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [todayNutrients, setTodayNutrients] = useState<Record<string, number>>({});

  React.useEffect(() => {
    const fetchTodayNutrients = async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('macro_logs')
        .select('*')
        .eq('user_id', user?.id)
        .eq('date', today);
      console.log('Fetched macro_logs rows:', data?.length, JSON.stringify(data?.[0]).substring(0, 200));
      if (!data) return;
      const totals: Record<string, number> = {};
      data.forEach((row: any) => {
        const fields = [
          'vitamin_a','vitamin_b1','vitamin_b2','vitamin_b3','vitamin_b5','vitamin_b6','vitamin_b7','vitamin_b9','vitamin_b12',
          'vitamin_c','vitamin_d','vitamin_d3','vitamin_e','vitamin_k','vitamin_k2',
          'calcium','magnesium','phosphorus','potassium','sodium','iron','zinc','copper',
          'manganese','selenium','chromium','iodine','molybdenum','boron','silica',
          'omega3','omega6','fiber','creatine','beta_alanine','caffeine','l_glutamine',
          'l_citrulline','bcaa','coq10','ashwagandha','turmeric','probiotics','collagen',
          'melatonin','electrolytes','protein',
        ];
        fields.forEach(f => {
          totals[f] = (totals[f] || 0) + (row[f] || 0);
        });
        // Map display names to keys
        totals['vitamin a'] = totals['vitamin_a'] || 0;
        totals['vitamin c'] = totals['vitamin_c'] || 0;
        totals['vitamin d'] = totals['vitamin_d'] || 0;
        totals['vitamin e'] = totals['vitamin_e'] || 0;
        totals['vitamin k'] = totals['vitamin_k'] || 0;
        totals['vitamin b1 (thiamine)'] = totals['vitamin_b1'] || 0;
        totals['vitamin b2 (riboflavin)'] = totals['vitamin_b2'] || 0;
        totals['vitamin b3 (niacin)'] = totals['vitamin_b3'] || 0;
        totals['vitamin b5 (pantothenic acid)'] = totals['vitamin_b5'] || 0;
        totals['vitamin b6'] = totals['vitamin_b6'] || 0;
        totals['vitamin b7 (biotin)'] = totals['vitamin_b7'] || 0;
        totals['vitamin b9 (folate)'] = totals['vitamin_b9'] || 0;
        totals['vitamin b12'] = totals['vitamin_b12'] || 0;
      });
      setTodayNutrients(totals);
    };
    if (user?.id) fetchTodayNutrients();
  }, [user?.id, profileTab]);

  const totalHeightIn = (parseInt(heightFt) || 0) * 12 + (parseInt(heightIn) || 0);

  const pickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true, aspect: [1, 1], quality: 0.6, base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setUploadingAvatar(true);
      const asset = result.assets[0];
      const ext = 'jpg';
      const path = `${user!.id}/avatar.${ext}`;
      const binary = Uint8Array.from(atob(asset.base64 || ''), c => c.charCodeAt(0));
      await supabase.storage.from('avatars').upload(path, binary, { contentType: 'image/jpeg', upsert: true });
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = data.publicUrl + '?t=' + Date.now();
      setAvatarUri(url);
      await supabase.from('profiles').update({ avatar_url: url }).eq('id', user!.id);
      setUploadingAvatar(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    const profileData = {
      weight_lbs: parseFloat(weight), height_in: totalHeightIn,
      age: parseInt(age), sex, activity, goal, sport,
    };
    const targets = customGoals ? {
      calories: parseInt(customCal) || calculateTargets(profileData).calories,
      protein: parseInt(customProtein) || calculateTargets(profileData).protein,
      carbs: parseInt(customCarbs) || calculateTargets(profileData).carbs,
      fat: parseInt(customFat) || calculateTargets(profileData).fat,
    } : calculateTargets(profileData);
    const updated = { id: user!.id, name, ...profileData, ...targets, custom_goals: customGoals, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('profiles').upsert(updated);
    if (error) { Alert.alert('Error', error.message); }
    else { onUpdate(updated); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    setLoading(false);
  };

  const autoTargets = calculateTargets({
    weight_lbs: parseFloat(weight) || profile.weight_lbs,
    height_in: totalHeightIn || profile.height_in,
    age: parseInt(age) || profile.age,
    sex, activity, goal,
  });

  const targets = { calories: profile.calories, protein: profile.protein, carbs: profile.carbs, fat: profile.fat };

  if (profileTab === 'foods') return (
    <View style={{ flex: 1 }}>
      <FoodsScreen />
      <View style={pt.subBar}>
        {(['profile','foods','plan','minerals','notifs'] as const).map(t => (
          <TouchableOpacity key={t} style={[pt.subBtn, profileTab===t && pt.subBtnActive]} onPress={() => setProfileTab(t)}>
            <Text style={[pt.subBtnText, profileTab===t && pt.subBtnTextActive]}>{t==='profile'?'👤':t==='foods'?'🥗':t==='plan'?'📅':t==='minerals'?'💊':'🔔'}</Text>
            <Text style={[pt.subLabel, profileTab===t && pt.subLabelActive]}>{t==='profile'?'Profile':t==='foods'?'Foods':t==='plan'?'Plan':t==='minerals'?'Nutrients':'Alerts'}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  if (profileTab === 'plan') return (
    <View style={{ flex: 1 }}>
      <MealPlanScreen targets={targets} profile={profile} />
      <View style={pt.subBar}>
        {(['profile','foods','plan','minerals','notifs'] as const).map(t => (
          <TouchableOpacity key={t} style={[pt.subBtn, profileTab===t && pt.subBtnActive]} onPress={() => setProfileTab(t)}>
            <Text style={[pt.subBtnText, profileTab===t && pt.subBtnTextActive]}>{t==='profile'?'👤':t==='foods'?'🥗':t==='plan'?'📅':t==='minerals'?'💊':'🔔'}</Text>
            <Text style={[pt.subLabel, profileTab===t && pt.subLabelActive]}>{t==='profile'?'Profile':t==='foods'?'Foods':t==='plan'?'Plan':t==='minerals'?'Nutrients':'Alerts'}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  if (profileTab === 'minerals') return (
    <View style={{ flex: 1 }}>
      <MineralsScreen profile={profile} logged={todayNutrients} />
      <View style={pt.subBar}>
        {(['profile','foods','plan','minerals','notifs'] as const).map(t => (
          <TouchableOpacity key={t} style={[pt.subBtn, profileTab===t && pt.subBtnActive]} onPress={() => setProfileTab(t)}>
            <Text style={[pt.subBtnText, profileTab===t && pt.subBtnTextActive]}>
              {t==='profile'?'👤':t==='foods'?'🥗':t==='plan'?'📅':t==='minerals'?'💊':'🔔'}
            </Text>
            <Text style={[pt.subLabel, profileTab===t && pt.subLabelActive]}>
              {t==='profile'?'Profile':t==='foods'?'Foods':t==='plan'?'Plan':t==='minerals'?'Nutrients':'Alerts'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  if (profileTab === 'notifs') return (
    <View style={{ flex: 1 }}>
      <NotificationsScreen />
      <View style={pt.subBar}>
        {(['profile','foods','plan','minerals','notifs'] as const).map(t => (
          <TouchableOpacity key={t} style={[pt.subBtn, profileTab===t && pt.subBtnActive]} onPress={() => setProfileTab(t)}>
            <Text style={[pt.subBtnText, profileTab===t && pt.subBtnTextActive]}>{t==='profile'?'👤':t==='foods'?'🥗':t==='plan'?'📅':t==='minerals'?'💊':'🔔'}</Text>
            <Text style={[pt.subLabel, profileTab===t && pt.subLabelActive]}>{t==='profile'?'Profile':t==='foods'?'Foods':t==='plan'?'Plan':t==='minerals'?'Nutrients':'Alerts'}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Profile</Text>
        <Text style={s.email}>{user?.email}</Text>
      </View>
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Live macro preview */}
        <View style={s.targetsCard}>
          <Text style={s.targetsTitle}>YOUR TARGETS</Text>
          <View style={s.targetsRow}>
            <View style={s.targetItem}>
              <Text style={s.targetVal}>{targets.calories}</Text>
              <Text style={s.targetLabel}>Calories</Text>
            </View>
            <View style={s.targetItem}>
              <Text style={[s.targetVal, { color: MC.protein.color }]}>{targets.protein}g</Text>
              <Text style={s.targetLabel}>Protein</Text>
            </View>
            <View style={s.targetItem}>
              <Text style={[s.targetVal, { color: MC.carbs.color }]}>{targets.carbs}g</Text>
              <Text style={s.targetLabel}>Carbs</Text>
            </View>
            <View style={s.targetItem}>
              <Text style={[s.targetVal, { color: MC.fat.color }]}>{targets.fat}g</Text>
              <Text style={s.targetLabel}>Fat</Text>
            </View>
          </View>
        </View>

        {/* Avatar */}
        <TouchableOpacity style={s.avatarWrap} onPress={pickAvatar} activeOpacity={0.8}>
          {avatarUri
            ? <Image source={{ uri: avatarUri }} style={s.avatar} />
            : <View style={s.avatarPlaceholder}>
                <Text style={s.avatarInitial}>{name?.[0]?.toUpperCase() || '?'}</Text>
              </View>
          }
          {uploadingAvatar
            ? <View style={s.avatarOverlay}><ActivityIndicator color="#fff" /></View>
            : <View style={s.avatarOverlay}><Text style={s.avatarOverlayText}>📷</Text></View>
          }
        </TouchableOpacity>

        <Text style={s.label}>Name</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor="#444" />

        <Text style={s.label}>Sex</Text>
        <View style={s.row}>
          {['male', 'female'].map(v => (
            <TouchableOpacity key={v} style={[s.optBtn, sex === v && s.optBtnActive, { flex: 1 }]} onPress={() => setSex(v)}>
              <Text style={[s.optBtnText, sex === v && s.optBtnTextActive]}>{v === 'male' ? '♂ Male' : '♀ Female'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.label}>Age</Text>
        <TextInput style={s.input} value={age} onChangeText={setAge} placeholder="25" placeholderTextColor="#444" keyboardType="number-pad" />

        <Text style={s.label}>Height</Text>
        <View style={s.row}>
          <TextInput style={[s.input, { flex: 1 }]} value={heightFt} onChangeText={setHeightFt} placeholder="ft" placeholderTextColor="#444" keyboardType="number-pad" />
          <TextInput style={[s.input, { flex: 1 }]} value={heightIn} onChangeText={setHeightIn} placeholder="in" placeholderTextColor="#444" keyboardType="number-pad" />
        </View>

        <Text style={s.label}>Weight (lbs)</Text>
        <TextInput style={s.input} value={weight} onChangeText={setWeight} placeholder="172" placeholderTextColor="#444" keyboardType="decimal-pad" />

        <Text style={s.label}>Activity Level</Text>
        <View style={s.optRow}>
          {ACTIVITY_OPTIONS.map(o => (
            <TouchableOpacity key={o.key} style={[s.optBtn, activity === o.key && s.optBtnActive]} onPress={() => setActivity(o.key)}>
              <Text style={[s.optBtnText, activity === o.key && s.optBtnTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.label}>Goal</Text>
        <View style={s.optRow}>
          {GOAL_OPTIONS.map(o => (
            <TouchableOpacity key={o.key} style={[s.optBtn, goal === o.key && s.optBtnActive]} onPress={() => setGoal(o.key)}>
              <Text style={[s.optBtnText, goal === o.key && s.optBtnTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Custom Goals Toggle */}
        <View style={s.customGoalsCard}>
          <View style={s.customGoalsHeader}>
            <View>
              <Text style={s.customGoalsTitle}>Custom Macro Goals</Text>
              <Text style={s.customGoalsSub}>Override auto-calculated targets</Text>
            </View>
            <TouchableOpacity style={[s.toggle, customGoals && s.toggleOn]} onPress={() => setCustomGoals(!customGoals)}>
              <View style={[s.toggleThumb, customGoals && s.toggleThumbOn]} />
            </TouchableOpacity>
          </View>
          {customGoals && (
            <View style={s.customGoalsForm}>
              <View style={s.customGoalsRow}>
                <View style={s.customGoalItem}>
                  <Text style={s.fieldLabel}>Calories</Text>
                  <TextInput style={s.input} value={customCal} onChangeText={setCustomCal} keyboardType='number-pad' placeholder={String(autoTargets.calories)} placeholderTextColor='#444' />
                </View>
                <View style={s.customGoalItem}>
                  <Text style={[s.fieldLabel, { color: '#4a9eff' }]}>Protein (g)</Text>
                  <TextInput style={s.input} value={customProtein} onChangeText={setCustomProtein} keyboardType='number-pad' placeholder={String(autoTargets.protein)} placeholderTextColor='#444' />
                </View>
              </View>
              <View style={s.customGoalsRow}>
                <View style={s.customGoalItem}>
                  <Text style={[s.fieldLabel, { color: '#fbbf24' }]}>Carbs (g)</Text>
                  <TextInput style={s.input} value={customCarbs} onChangeText={setCustomCarbs} keyboardType='number-pad' placeholder={String(autoTargets.carbs)} placeholderTextColor='#444' />
                </View>
                <View style={s.customGoalItem}>
                  <Text style={[s.fieldLabel, { color: '#f472b6' }]}>Fat (g)</Text>
                  <TextInput style={s.input} value={customFat} onChangeText={setCustomFat} keyboardType='number-pad' placeholder={String(autoTargets.fat)} placeholderTextColor='#444' />
                </View>
              </View>
            </View>
          )}
        </View>

        <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={loading} activeOpacity={0.8}>
          {loading ? <ActivityIndicator color="#000" /> : <Text style={s.saveBtnText}>{saved ? '✓ Saved!' : 'Save & Recalculate'}</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={s.signOutBtn} onPress={() => Alert.alert('Sign Out', 'Are you sure?', [{ text: 'Cancel' }, { text: 'Sign Out', style: 'destructive', onPress: signOut }])}>
          <Text style={s.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
      <View style={pt.subBar}>
        {(['profile','foods','plan','minerals','notifs'] as const).map(t => (
          <TouchableOpacity key={t} style={[pt.subBtn, profileTab===t && pt.subBtnActive]} onPress={() => setProfileTab(t)}>
            <Text style={[pt.subBtnText, profileTab===t && pt.subBtnTextActive]}>{t==='profile'?'👤':t==='foods'?'🥗':t==='plan'?'📅':t==='minerals'?'💊':'🔔'}</Text>
            <Text style={[pt.subLabel, profileTab===t && pt.subLabelActive]}>{t==='profile'?'Profile':t==='foods'?'Foods':t==='plan'?'Plan':t==='minerals'?'Nutrients':'Alerts'}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const pt = StyleSheet.create({
  subBar: { flexDirection: 'row', backgroundColor: '#0a0a0a', borderTopWidth: 1, borderTopColor: '#1e1e1e', paddingVertical: 8 },
  subBtn: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4 },
  subBtnActive: {},
  subBtnText: { fontSize: 20 },
  subLabel: { fontSize: 10, color: '#3a3a3a', fontWeight: '600' },
  subLabelActive: { color: '#fff', fontWeight: '800' },
});

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  email: { fontSize: 13, color: '#555', fontWeight: '500', marginTop: 2 },
  avatarWrap: { width: 90, height: 90, borderRadius: 45, alignSelf: 'center', marginBottom: 20, overflow: 'hidden' },
  avatar: { width: 90, height: 90, borderRadius: 45 },
  avatarPlaceholder: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 36, fontWeight: '900', color: '#fff' },
  avatarOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 28, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  avatarOverlayText: { fontSize: 14 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 60 },
  targetsCard: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16, marginBottom: 24 },
  targetsTitle: { fontSize: 10, fontWeight: '700', color: '#444', letterSpacing: 1.5, marginBottom: 14 },
  targetsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  targetItem: { alignItems: 'center' },
  targetVal: { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  targetLabel: { fontSize: 10, color: '#555', fontWeight: '600', marginTop: 2 },
  label: { fontSize: 11, fontWeight: '700', color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#1e1e1e', borderRadius: 12, color: '#fff', padding: 14, fontSize: 16, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  optRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  optBtn: { backgroundColor: '#1e1e1e', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  optBtnActive: { backgroundColor: '#fff' },
  optBtnText: { color: '#555', fontSize: 13, fontWeight: '700' },
  optBtnTextActive: { color: '#000' },
  saveBtn: { backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  saveBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },
  signOutBtn: { backgroundColor: '#1e1e1e', borderRadius: 12, padding: 16, alignItems: 'center' },
  signOutText: { color: '#ff4f4f', fontSize: 15, fontWeight: '700' },
  customGoalsCard: { backgroundColor: '#1e1e1e', borderRadius: 16, padding: 16, marginBottom: 16 },
  customGoalsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  customGoalsTitle: { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 2 },
  customGoalsSub: { fontSize: 12, color: '#555', fontWeight: '500' },
  toggle: { width: 48, height: 28, borderRadius: 14, backgroundColor: '#333', padding: 2, justifyContent: 'center' },
  toggleOn: { backgroundColor: '#4ade80' },
  toggleThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', alignSelf: 'flex-start' },
  toggleThumbOn: { alignSelf: 'flex-end' },
  customGoalsForm: { marginTop: 16 },
  customGoalsRow: { flexDirection: 'row', gap: 10 },
  customGoalItem: { flex: 1 },
});
