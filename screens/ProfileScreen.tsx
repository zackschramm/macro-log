import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../constants/supabase';
import * as ImagePicker from 'expo-image-picker';
import FoodsScreen from './FoodsScreen';
import MealPlanScreen from './MealPlanScreen';
import NotificationsScreen from './NotificationsScreen';
import MineralsScreen from './MineralsScreen';
import { useAuth } from '../hooks/useAuth';
import { calculateTargets, MC } from '../constants/data';
import { useUnits, UnitSystem, KG_PER_LB, CM_PER_IN } from '../constants/units';

const ACTIVITY_OPTIONS = [
  { key: 'sedentary', label: 'Sedentary' },
  { key: 'light', label: 'Light' },
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
  { key: 'running',      label: 'Running',        emoji: '🏃' },
  { key: 'cycling',      label: 'Cycling',        emoji: '🚴' },
  { key: 'triathlon',    label: 'Triathlon',      emoji: '🏅' },
  { key: 'swimming',     label: 'Swimming',       emoji: '🏊' },
  { key: 'crossfit',     label: 'CrossFit',       emoji: '🔥' },
  { key: 'powerlifting', label: 'Powerlifting',   emoji: '🏋️' },
  { key: 'bodybuilding', label: 'Bodybuilding',   emoji: '💪' },
  { key: 'hiking',       label: 'Hiking',         emoji: '🥾' },
  { key: 'rowing',       label: 'Rowing',         emoji: '🚣' },
  { key: 'tennis',       label: 'Tennis',         emoji: '🎾' },
  { key: 'golf',         label: 'Golf',           emoji: '⛳' },
  { key: 'yoga',         label: 'Yoga',           emoji: '🧘' },
  { key: 'climbing',     label: 'Climbing',       emoji: '🧗' },
  { key: 'wrestling',    label: 'Wrestling/MMA',  emoji: '🥊' },
];

type SubScreen = 'foods' | 'plan' | 'minerals' | 'notifs';

function SubScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={s.subHeader}>
      <TouchableOpacity onPress={onBack} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="chevron-back" size={20} color="#fff" />
        <Text style={s.backLabel}>Me</Text>
      </TouchableOpacity>
      <Text style={s.subHeaderTitle}>{title}</Text>
      <View style={{ width: 60 }} />
    </View>
  );
}

export default function ProfileScreen({ profile, onUpdate }: { profile: any; onUpdate: (p: any) => void }) {
  const { user, signOut } = useAuth();
  const u = useUnits();
  const [name, setName] = useState(profile.name || '');
  const [age, setAge] = useState(String(profile.age || ''));
  const [weight, setWeight] = useState(profile.weight_lbs ? String(u.dispWeight(profile.weight_lbs)) : '');
  const hf = u.heightFields(profile.height_in || 0);
  const [heightFt, setHeightFt] = useState(hf.ft);
  const [heightIn, setHeightIn] = useState(hf.in);
  const [heightCm, setHeightCm] = useState(hf.cm);
  const [sex, setSex] = useState(profile.sex || 'male');
  const [activity, setActivity] = useState(profile.activity || 'moderate');
  const [goal, setGoal] = useState(profile.goal || 'gain');
  const [sport, setSport] = useState(profile.sport || 'none');
  const [loading, setLoading] = useState(false);
  const [customGoals, setCustomGoals] = useState(!!profile.custom_goals);
  const [customCal, setCustomCal] = useState(profile.custom_goals ? String(profile.calories || '') : '');
  const [customProtein, setCustomProtein] = useState(profile.custom_goals ? String(profile.protein || '') : '');
  const [customCarbs, setCustomCarbs] = useState(profile.custom_goals ? String(profile.carbs || '') : '');
  const [customFat, setCustomFat] = useState(profile.custom_goals ? String(profile.fat || '') : '');
  const [saved, setSaved] = useState(false);
  const [subScreen, setSubScreen] = useState<SubScreen | null>(null);
  const [avatarUri, setAvatarUri] = useState(profile.avatar_url || null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [todayNutrients, setTodayNutrients] = useState<Record<string, number>>({});

  React.useEffect(() => {
    if (subScreen !== 'minerals' || !user?.id) return;
    (async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase.from('macro_logs').select('*').eq('user_id', user.id).eq('date', today);
      if (!data) return;
      const totals: Record<string, number> = {};
      const fields = [
        'vitamin_a','vitamin_b1','vitamin_b2','vitamin_b3','vitamin_b5','vitamin_b6','vitamin_b7','vitamin_b9','vitamin_b12',
        'vitamin_c','vitamin_d','vitamin_d3','vitamin_e','vitamin_k','vitamin_k2',
        'calcium','magnesium','phosphorus','potassium','sodium','iron','zinc','copper',
        'manganese','selenium','chromium','iodine','molybdenum','boron','silica',
        'omega3','omega6','fiber','creatine','beta_alanine','caffeine','l_glutamine',
        'l_citrulline','bcaa','coq10','ashwagandha','turmeric','probiotics','collagen',
        'melatonin','electrolytes','protein',
      ];
      data.forEach((row: any) => {
        fields.forEach(f => { totals[f] = (totals[f] || 0) + (row[f] || 0); });
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
    })();
  }, [subScreen, user?.id]);

  const totalHeightIn = Math.round(u.fieldsToInch({ ft: heightFt, in: heightIn, cm: heightCm }));

  // Switching systems converts whatever the user has currently typed, so the
  // displayed numbers stay physically equivalent.
  const changeUnits = (next: UnitSystem) => {
    if (next === u.system) return;
    const lb = u.toLb(weight);
    const inch = u.fieldsToInch({ ft: heightFt, in: heightIn, cm: heightCm });
    if (next === 'metric') {
      setWeight(isNaN(lb) ? '' : String(Math.round(lb * KG_PER_LB * 10) / 10));
      setHeightCm(inch ? String(Math.round(inch * CM_PER_IN)) : '');
    } else {
      setWeight(isNaN(lb) ? '' : String(Math.round(lb * 10) / 10));
      setHeightFt(inch ? String(Math.floor(inch / 12)) : '');
      setHeightIn(inch ? String(Math.round(inch % 12)) : '');
    }
    u.setSystem(next);
  };

  const pickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true, aspect: [1, 1], quality: 0.6, base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setUploadingAvatar(true);
      const asset = result.assets[0];
      const path = `${user!.id}/avatar.jpg`;
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
      weight_lbs: u.toLb(weight), height_in: totalHeightIn,
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
    weight_lbs: u.toLb(weight) || profile.weight_lbs,
    height_in: totalHeightIn || profile.height_in,
    age: parseInt(age) || profile.age,
    sex, activity, goal, sport,
  });

  const targets = { calories: profile.calories, protein: profile.protein, carbs: profile.carbs, fat: profile.fat };

  // ── Sub-screens ────────────────────────────────────────────────────────────────
  if (subScreen === 'foods') return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <SubScreenHeader title="My Foods" onBack={() => setSubScreen(null)} />
      <FoodsScreen />
    </SafeAreaView>
  );
  if (subScreen === 'plan') return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <SubScreenHeader title="Meal Plan" onBack={() => setSubScreen(null)} />
      <MealPlanScreen targets={targets} profile={profile} />
    </SafeAreaView>
  );
  if (subScreen === 'minerals') return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <SubScreenHeader title="Nutrients" onBack={() => setSubScreen(null)} />
      <MineralsScreen profile={profile} />
    </SafeAreaView>
  );
  if (subScreen === 'notifs') return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <SubScreenHeader title="Notifications" onBack={() => setSubScreen(null)} />
      <NotificationsScreen />
    </SafeAreaView>
  );

  // ── Main profile view ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Me</Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Hero — avatar + name */}
        <View style={s.hero}>
          <TouchableOpacity style={s.avatarWrap} onPress={pickAvatar} activeOpacity={0.8}>
            {avatarUri
              ? <Image source={{ uri: avatarUri }} style={s.avatar} />
              : <View style={s.avatarPlaceholder}><Text style={s.avatarInitial}>{name?.[0]?.toUpperCase() || '?'}</Text></View>
            }
            {uploadingAvatar
              ? <View style={s.avatarOverlay}><ActivityIndicator color="#fff" size="small" /></View>
              : <View style={s.avatarOverlay}><Ionicons name="camera" size={14} color="#fff" /></View>
            }
          </TouchableOpacity>
          <Text style={s.heroName}>{name || 'Your Name'}</Text>
          <Text style={s.heroEmail}>{user?.email}</Text>
        </View>

        {/* Daily targets */}
        <View style={s.targetsCard}>
          <Text style={s.sectionLabel}>DAILY TARGETS</Text>
          <View style={s.targetsRow}>
            <View style={s.targetItem}>
              <Text style={s.targetVal}>{targets.calories}</Text>
              <Text style={s.targetLabel}>Cal</Text>
            </View>
            <View style={s.targetDivider} />
            <View style={s.targetItem}>
              <Text style={[s.targetVal, { color: MC.protein.color }]}>{targets.protein}g</Text>
              <Text style={s.targetLabel}>Protein</Text>
            </View>
            <View style={s.targetDivider} />
            <View style={s.targetItem}>
              <Text style={[s.targetVal, { color: MC.carbs.color }]}>{targets.carbs}g</Text>
              <Text style={s.targetLabel}>Carbs</Text>
            </View>
            <View style={s.targetDivider} />
            <View style={s.targetItem}>
              <Text style={[s.targetVal, { color: MC.fat.color }]}>{targets.fat}g</Text>
              <Text style={s.targetLabel}>Fat</Text>
            </View>
          </View>
        </View>

        {/* Quick links */}
        <View style={s.linksCard}>
          {([
            { key: 'foods',    icon: 'nutrition-outline',       label: 'My Foods',       sub: 'Custom food database' },
            { key: 'plan',     icon: 'calendar-outline',        label: 'Meal Plan',      sub: 'AI-generated meal plans' },
            { key: 'minerals', icon: 'flask-outline',           label: 'Nutrients',      sub: 'Vitamins & minerals today' },
            { key: 'notifs',   icon: 'notifications-outline',   label: 'Notifications',  sub: 'Reminders & alerts' },
          ] as const).map((item, i, arr) => (
            <TouchableOpacity key={item.key} style={[s.linkRow, i < arr.length - 1 && s.linkRowBorder]} onPress={() => setSubScreen(item.key)} activeOpacity={0.7}>
              <View style={s.linkIcon}>
                <Ionicons name={item.icon as any} size={18} color="#888" />
              </View>
              <View style={s.linkText}>
                <Text style={s.linkLabel}>{item.label}</Text>
                <Text style={s.linkSub}>{item.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#333" />
            </TouchableOpacity>
          ))}
        </View>

        {/* Personal info */}
        <Text style={s.sectionLabel}>PERSONAL</Text>
        <View style={s.formCard}>
          <View style={s.fieldRow}>
            <Text style={s.fieldLabel}>Name</Text>
            <TextInput style={s.fieldInput} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor="#444" />
          </View>
          <View style={s.fieldDivider} />
          <View style={s.fieldRow}>
            <Text style={s.fieldLabel}>Sex</Text>
            <View style={s.segmented}>
              {['male', 'female'].map(v => (
                <TouchableOpacity key={v} style={[s.segBtn, sex === v && s.segBtnActive]} onPress={() => setSex(v)}>
                  <Text style={[s.segBtnText, sex === v && s.segBtnTextActive]}>{v === 'male' ? 'Male' : 'Female'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={s.fieldDivider} />
          <View style={s.fieldRow}>
            <Text style={s.fieldLabel}>Age</Text>
            <TextInput style={s.fieldInput} value={age} onChangeText={setAge} placeholder="25" placeholderTextColor="#444" keyboardType="number-pad" />
          </View>
          <View style={s.fieldDivider} />
          <View style={s.fieldRow}>
            <Text style={s.fieldLabel}>Height</Text>
            {u.isMetric ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <TextInput style={[s.fieldInput, { width: 80 }]} value={heightCm} onChangeText={setHeightCm} placeholder="178" placeholderTextColor="#444" keyboardType="number-pad" />
                <Text style={s.fieldUnit}>cm</Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput style={[s.fieldInput, { width: 56 }]} value={heightFt} onChangeText={setHeightFt} placeholder="ft" placeholderTextColor="#444" keyboardType="number-pad" />
                <TextInput style={[s.fieldInput, { width: 56 }]} value={heightIn} onChangeText={setHeightIn} placeholder="in" placeholderTextColor="#444" keyboardType="number-pad" />
              </View>
            )}
          </View>
          <View style={s.fieldDivider} />
          <View style={s.fieldRow}>
            <Text style={s.fieldLabel}>Weight</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <TextInput style={[s.fieldInput, { width: 80 }]} value={weight} onChangeText={setWeight} placeholder={u.isMetric ? '78' : '172'} placeholderTextColor="#444" keyboardType="decimal-pad" />
              <Text style={s.fieldUnit}>{u.weightUnit}</Text>
            </View>
          </View>
          <View style={s.fieldDivider} />
          <View style={s.fieldRow}>
            <Text style={s.fieldLabel}>Units</Text>
            <View style={s.segmented}>
              {(['imperial', 'metric'] as const).map(v => (
                <TouchableOpacity key={v} style={[s.segBtn, u.system === v && s.segBtnActive]} onPress={() => changeUnits(v)}>
                  <Text style={[s.segBtnText, u.system === v && s.segBtnTextActive]}>{v === 'imperial' ? 'Imperial' : 'Metric'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Training */}
        <Text style={s.sectionLabel}>TRAINING</Text>
        <View style={s.formCard}>
          <Text style={s.inlineLabel}>Activity Level</Text>
          <View style={s.chipRow}>
            {ACTIVITY_OPTIONS.map(o => (
              <TouchableOpacity key={o.key} style={[s.chip, activity === o.key && s.chipActive]} onPress={() => setActivity(o.key)}>
                <Text style={[s.chipText, activity === o.key && s.chipTextActive]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.fieldDivider} />
          <Text style={[s.inlineLabel, { marginTop: 12 }]}>Goal</Text>
          <View style={s.chipRow}>
            {GOAL_OPTIONS.map(o => (
              <TouchableOpacity key={o.key} style={[s.chip, goal === o.key && s.chipActive]} onPress={() => setGoal(o.key)}>
                <Text style={[s.chipText, goal === o.key && s.chipTextActive]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.fieldDivider} />
          <Text style={[s.inlineLabel, { marginTop: 12 }]}>Sport</Text>
          <View style={s.sportGrid}>
            {SPORT_OPTIONS.map(o => {
              const active = sport === o.key;
              return (
                <TouchableOpacity key={o.key} style={[s.sportCell, active && s.sportCellActive]} onPress={() => setSport(o.key)} activeOpacity={0.7}>
                  <Text style={s.sportEmoji}>{o.emoji}</Text>
                  <Text style={[s.sportLabel, active && s.sportLabelActive]}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Custom macro goals */}
        <TouchableOpacity style={s.customGoalsRow} onPress={() => setCustomGoals(!customGoals)} activeOpacity={0.8}>
          <View>
            <Text style={s.customGoalsTitle}>Custom Macro Goals</Text>
            <Text style={s.customGoalsSub}>Override auto-calculated targets</Text>
          </View>
          <View style={[s.toggle, customGoals && s.toggleOn]}>
            <View style={[s.toggleThumb, customGoals && s.toggleThumbOn]} />
          </View>
        </TouchableOpacity>
        {customGoals && (
          <View style={s.formCard}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.inlineLabel}>Calories</Text>
                <TextInput style={s.standaloneInput} value={customCal} onChangeText={setCustomCal} keyboardType="number-pad" placeholder={String(autoTargets.calories)} placeholderTextColor="#444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.inlineLabel, { color: MC.protein.color }]}>Protein (g)</Text>
                <TextInput style={s.standaloneInput} value={customProtein} onChangeText={setCustomProtein} keyboardType="number-pad" placeholder={String(autoTargets.protein)} placeholderTextColor="#444" />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[s.inlineLabel, { color: MC.carbs.color }]}>Carbs (g)</Text>
                <TextInput style={s.standaloneInput} value={customCarbs} onChangeText={setCustomCarbs} keyboardType="number-pad" placeholder={String(autoTargets.carbs)} placeholderTextColor="#444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.inlineLabel, { color: MC.fat.color }]}>Fat (g)</Text>
                <TextInput style={s.standaloneInput} value={customFat} onChangeText={setCustomFat} keyboardType="number-pad" placeholder={String(autoTargets.fat)} placeholderTextColor="#444" />
              </View>
            </View>
          </View>
        )}

        {/* Save */}
        <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={loading} activeOpacity={0.8}>
          {loading ? <ActivityIndicator color="#000" /> : <Text style={s.saveBtnText}>{saved ? '✓ Saved!' : 'Save & Recalculate'}</Text>}
        </TouchableOpacity>

        {/* Sign out */}
        <TouchableOpacity style={s.signOutBtn} onPress={() => Alert.alert('Sign Out', 'Are you sure?', [{ text: 'Cancel' }, { text: 'Sign Out', style: 'destructive', onPress: signOut }])} activeOpacity={0.7}>
          <Text style={s.signOutText}>Sign Out</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1e1e1e' },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 60, gap: 8 },

  // Sub-screen header
  subHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#1e1e1e',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 60 },
  backLabel: { fontSize: 16, color: '#fff', fontWeight: '600' },
  subHeaderTitle: { fontSize: 17, fontWeight: '800', color: '#fff' },

  // Hero
  hero: { alignItems: 'center', paddingVertical: 8, marginBottom: 8 },
  avatarWrap: { width: 88, height: 88, borderRadius: 44, overflow: 'hidden', marginBottom: 12 },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 34, fontWeight: '900', color: '#fff' },
  avatarOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 26, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  heroName: { fontSize: 22, fontWeight: '900', color: '#fff', marginBottom: 3 },
  heroEmail: { fontSize: 13, color: '#444', fontWeight: '500' },

  // Targets card
  targetsCard: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 18, marginBottom: 4 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#444', letterSpacing: 1.5, marginTop: 8, marginBottom: 6 },
  targetsRow: { flexDirection: 'row', alignItems: 'center' },
  targetItem: { flex: 1, alignItems: 'center' },
  targetDivider: { width: 1, height: 32, backgroundColor: '#2a2a2a' },
  targetVal: { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  targetLabel: { fontSize: 10, color: '#555', fontWeight: '600', marginTop: 2 },

  // Quick links card
  linksCard: { backgroundColor: '#1a1a1a', borderRadius: 16, overflow: 'hidden', marginBottom: 4 },
  linkRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  linkRowBorder: { borderBottomWidth: 1, borderBottomColor: '#222' },
  linkIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center' },
  linkText: { flex: 1 },
  linkLabel: { fontSize: 15, fontWeight: '700', color: '#fff' },
  linkSub: { fontSize: 12, color: '#444', fontWeight: '500', marginTop: 1 },

  // Form card (grouped inputs)
  formCard: { backgroundColor: '#1a1a1a', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 4, marginBottom: 4 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  fieldDivider: { height: 1, backgroundColor: '#222' },
  fieldLabel: { fontSize: 15, fontWeight: '600', color: '#ccc' },
  fieldInput: { fontSize: 15, color: '#fff', textAlign: 'right', minWidth: 60 },
  fieldUnit: { fontSize: 13, color: '#444', fontWeight: '600' },
  inlineLabel: { fontSize: 12, fontWeight: '700', color: '#555', letterSpacing: 0.3, marginBottom: 10, marginTop: 4 },

  // Chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { backgroundColor: '#222', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { backgroundColor: '#fff' },
  chipText: { fontSize: 13, fontWeight: '700', color: '#555' },
  chipTextActive: { color: '#000' },

  // Sport grid
  sportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  sportCell: {
    width: '30%', flexGrow: 1,
    backgroundColor: '#222', borderRadius: 14,
    paddingVertical: 12, alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  sportCellActive: { backgroundColor: '#1a1a2e', borderColor: '#fff' },
  sportEmoji: { fontSize: 22 },
  sportLabel: { fontSize: 11, fontWeight: '700', color: '#555', textAlign: 'center' },
  sportLabelActive: { color: '#fff' },

  // Segmented (sex)
  segmented: { flexDirection: 'row', backgroundColor: '#222', borderRadius: 10, padding: 3, gap: 3 },
  segBtn: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 6 },
  segBtnActive: { backgroundColor: '#fff' },
  segBtnText: { fontSize: 13, fontWeight: '700', color: '#555' },
  segBtnTextActive: { color: '#000' },

  // Custom goals
  customGoalsRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16, marginTop: 4,
  },
  customGoalsTitle: { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 2 },
  customGoalsSub: { fontSize: 12, color: '#555', fontWeight: '500' },
  toggle: { width: 46, height: 26, borderRadius: 13, backgroundColor: '#333', padding: 2, justifyContent: 'center' },
  toggleOn: { backgroundColor: '#4ade80' },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignSelf: 'flex-start' },
  toggleThumbOn: { alignSelf: 'flex-end' },
  standaloneInput: { backgroundColor: '#222', borderRadius: 10, color: '#fff', padding: 12, fontSize: 15 },

  // Buttons
  saveBtn: { backgroundColor: '#fff', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },
  signOutBtn: { alignItems: 'center', paddingVertical: 14 },
  signOutText: { color: '#ff4f4f', fontSize: 15, fontWeight: '700' },
});
