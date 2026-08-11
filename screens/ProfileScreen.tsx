import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, Image, Platform, Modal, AppState, Linking,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import AchievementBadges from '../components/AchievementBadges';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import * as ImagePicker from 'expo-image-picker';
import FoodsScreen from './FoodsScreen';
import MealPlanScreen from './MealPlanScreen';
import NotificationsScreen from './NotificationsScreen';
import MineralsScreen from './MineralsScreen';
import CoachMemoryScreen from './CoachMemoryScreen';
import RaceFuelScreen from './RaceFuelScreen';
import ReferralScreen from './ReferralScreen';
import { useAuth } from '../hooks/useAuth';
import { calculateTargets, MC } from '../constants/data';
import { capabilitiesFor } from '../constants/sportArchetypes';
import { daysUntilRace, phaseFromRaceDate, PHASE_LABEL } from '../utils/enduranceFueling';
import { sportIcon } from '../constants/icons';
import { useUnits, UnitSystem, KG_PER_LB, CM_PER_IN } from '../constants/units';
import { colors, radius, weight } from '../constants/theme';
import { useHealth, STORAGE_PREFERRED_TRACKER, STORAGE_HK_SOURCES, SOURCE_PREF_KEYS } from '../hooks/useHealth';
import { useRestTimer } from '../contexts/RestTimerContext';
import { WATER_GOAL_KEY, DEFAULT_WATER_GOAL } from '../components/WaterTracker';
import { getOllamaSettings, setOllamaSettings, pingOllama, DEFAULT_OLLAMA_ENDPOINT, DEFAULT_OLLAMA_MODEL } from '../constants/ollama';
import {
  getConnectedWearables, connectWearableForProvider, disconnectWearable,
  WEARABLE_CALLBACK_RESULT_KEY, type Provider,
} from '../utils/wearables';
import { toLocalDateString } from '../utils/dateUtils';
import { logError } from '../utils/logError';

const wearableLabel = (provider: Provider) =>
  provider === 'whoop' ? 'Whoop' : provider === 'oura' ? 'Oura Ring' : 'Garmin';

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
  { key: 'none',         label: 'General' },
  { key: 'running',      label: 'Running' },
  { key: 'cycling',      label: 'Cycling' },
  { key: 'triathlon',    label: 'Triathlon' },
  { key: 'swimming',     label: 'Swimming' },
  // NOTE: the four tri_* distance keys are not listed here. They are chosen in
  // the second-level picker that appears once Triathlon is selected, and are
  // what actually gets stored in profiles.sport.
  { key: 'crossfit',     label: 'CrossFit' },
  { key: 'powerlifting', label: 'Powerlifting' },
  { key: 'bodybuilding', label: 'Bodybuilding' },
  { key: 'hiking',       label: 'Hiking' },
  { key: 'rowing',       label: 'Rowing' },
  { key: 'tennis',       label: 'Tennis' },
  { key: 'golf',         label: 'Golf' },
  { key: 'yoga',         label: 'Yoga' },
  { key: 'climbing',     label: 'Climbing' },
  { key: 'wrestling',    label: 'Wrestling/MMA' },
];

/** Triathlon distances. The key stored in profiles.sport is the tri_* one. */
const TRI_DISTANCE_OPTIONS = [
  { key: 'tri_sprint',  label: 'Sprint',  detail: '750m · 20k · 5k' },
  { key: 'tri_olympic', label: 'Olympic', detail: '1.5k · 40k · 10k' },
  { key: 'tri_70_3',    label: '70.3',    detail: '1.9k · 90k · 21.1k' },
  { key: 'tri_ironman', label: 'Ironman', detail: '3.8k · 180k · 42.2k' },
];

const TRI_KEYS = new Set(['triathlon', ...TRI_DISTANCE_OPTIONS.map(o => o.key)]);

/**
 * Parse a numeric text field into something Postgres will accept.
 *
 * An empty string must become null, not 0 and not NaN — the columns are
 * nullable numerics with range checks, and '' or NaN is rejected outright.
 * Out-of-range values are almost always unit errors (lb typed as kg, ml as L)
 * and are dropped rather than saved and later propagated into a race plan.
 */
function intOrNull(v: string, lo: number, hi: number): number | null {
  const n = parseInt(String(v ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < lo || n > hi) return null;
  return n;
}
function floatOrNull(v: string, lo: number, hi: number): number | null {
  const n = parseFloat(String(v ?? '').trim());
  if (!Number.isFinite(n) || n < lo || n > hi) return null;
  return Math.round(n * 100) / 100;
}

const PHASE_OPTIONS = [
  { key: '',           label: 'Auto' },
  { key: 'off_season', label: 'Off-season' },
  { key: 'base',       label: 'Base' },
  { key: 'build',      label: 'Build' },
  { key: 'peak',       label: 'Peak' },
  { key: 'taper',      label: 'Taper' },
  { key: 'race_week',  label: 'Race week' },
];

/**
 * Non-exercise activity only. Kept deliberately distinct from the legacy
 * `activity` multiplier — combining that with per-session training energy
 * counts training twice, which for an Ironman athlete is worth ~1,000 kcal/day.
 */
const NEAT_OPTIONS = [
  { key: 'sedentary', label: 'Desk job',     detail: 'Mostly seated outside training' },
  { key: 'standing',  label: 'On my feet',   detail: 'Moving a good part of the day' },
  { key: 'manual',    label: 'Manual work',  detail: 'Physical job' },
];

const EXPERIENCE_OPTIONS = [
  { key: 'first_timer',  label: 'First timer',  detail: 'Conservative defaults, more explanation' },
  { key: 'experienced',  label: 'Experienced',  detail: 'Full detail, fewer guard rails' },
];

type SubScreen = 'foods' | 'plan' | 'minerals' | 'notifs' | 'referral' | 'memory' | 'racefuel';

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
  const health = useHealth();
  const u = useUnits();
  const restTimer = useRestTimer();
  const [preferredTracker, setPreferredTracker] = useState('auto');
  const [availableTrackers, setAvailableTrackers] = useState<string[]>([]);
  // Account deletion (App Store 5.1.1(v)). Typed confirmation, not a plain
  // alert — an accidental double-tap must not be able to destroy an account.
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE' || deleting) return;
    setDeleting(true);
    try {
      // invoke() attaches the session JWT and apikey itself, so the function
      // can trust the caller's identity from the verified token.
      const { error } = await supabase.functions.invoke('delete-account', {
        body: { confirm: 'DELETE' },
      });
      if (error) throw error;

      setShowDeleteAccount(false);
      setDeleteConfirm('');
      // The auth user no longer exists, so signOut is really just clearing
      // local session state and returning to the auth screen.
      await signOut();
    } catch (e) {
      logError('Profile.deleteAccount', e);
      Alert.alert(
        'Could not delete account',
        'Something went wrong and your account has NOT been deleted. Please try again, or email support@fuelog.app and we will remove it for you.',
      );
    } finally {
      setDeleting(false);
    }
  };
  const [hkSources, setHkSources] = useState<Record<string, string>>({});
  const [sourceSyncTimes, setSourceSyncTimes] = useState<Record<string, number>>({});
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
  // Endurance-only state. All optional — a lifter never sees any of it.
  const [raceDate, setRaceDate] = useState<string>(profile.race_date || '');
  const [trainingPhase, setTrainingPhase] = useState<string>(profile.training_phase || '');
  const [carbTolerance, setCarbTolerance] = useState<string>(
    profile.carb_tolerance_g_per_h != null ? String(profile.carb_tolerance_g_per_h) : ''
  );
  const [sweatRate, setSweatRate] = useState<string>(
    profile.sweat_rate_l_per_h != null ? String(profile.sweat_rate_l_per_h) : ''
  );
  const [neatLevel, setNeatLevel] = useState<string>(profile.neat_level || 'sedentary');
  const [experienceLevel, setExperienceLevel] = useState<string>(
    profile.experience_level || 'first_timer'
  );

  // Shown under the race-date field so the athlete can see what the date implies
  // before saving. Null when there's no date or it doesn't parse.
  const daysToRace = daysUntilRace(raceDate || null);
  const inferredPhase = phaseFromRaceDate(raceDate || null);
  const inferredPhaseLabel = inferredPhase ? PHASE_LABEL[inferredPhase] : null;
  const [loading, setLoading] = useState(false);
  const [customGoals, setCustomGoals] = useState(!!profile.custom_goals);
  const [customCal, setCustomCal] = useState(profile.custom_goals ? String(profile.calories || '') : '');
  const [customProtein, setCustomProtein] = useState(profile.custom_goals ? String(profile.protein || '') : '');
  const [customCarbs, setCustomCarbs] = useState(profile.custom_goals ? String(profile.carbs || '') : '');
  const [customFat, setCustomFat] = useState(profile.custom_goals ? String(profile.fat || '') : '');
  const [saved, setSaved] = useState(false);
  const [subScreen, setSubScreen] = useState<SubScreen | null>(null);

  // Periodization
  const pd = profile.periodization_settings;
  const [periodizationEnabled, setPeriodizationEnabled] = useState(!!(pd?.enabled));
  const [trainCal, setTrainCal] = useState(pd?.trainingDay?.calories ? String(pd.trainingDay.calories) : '');
  const [trainProtein, setTrainProtein] = useState(pd?.trainingDay?.protein ? String(pd.trainingDay.protein) : '');
  const [trainCarbs, setTrainCarbs] = useState(pd?.trainingDay?.carbs ? String(pd.trainingDay.carbs) : '');
  const [trainFat, setTrainFat] = useState(pd?.trainingDay?.fat ? String(pd.trainingDay.fat) : '');
  const [restCal, setRestCal] = useState(pd?.restDay?.calories ? String(pd.restDay.calories) : '');
  const [restProtein, setRestProtein] = useState(pd?.restDay?.protein ? String(pd.restDay.protein) : '');
  const [restCarbs, setRestCarbs] = useState(pd?.restDay?.carbs ? String(pd.restDay.carbs) : '');
  const [restFat, setRestFat] = useState(pd?.restDay?.fat ? String(pd.restDay.fat) : '');
  const [avatarUri, setAvatarUri] = useState(profile.avatar_url || null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [todayNutrients, setTodayNutrients] = useState<Record<string, number>>({});
  const [waterGoalCups, setWaterGoalCups] = useState(DEFAULT_WATER_GOAL);
  const [exporting, setExporting] = useState(false);
  // Latest measured body fat %, used to upgrade the BMR estimate from
  // Mifflin-St Jeor to Katch-McArdle and to anchor protein to lean mass.
  const [bodyFatPct, setBodyFatPct] = useState<number | null>(null);
  const [connectedWearables, setConnectedWearables] = useState<Provider[]>([]);
  const [wearableConnecting, setWearableConnecting] = useState<Provider | null>(null);
  const [dexcomConnected, setDexcomConnected] = useState(false);
  const [dexcomConnecting, setDexcomConnecting] = useState(false);
  const [cycleTrackingEnabled, setCycleTrackingEnabled] = useState(false);
  const [showCycleSetup, setShowCycleSetup] = useState(false);
  const [cycleSetupLastPeriod, setCycleSetupLastPeriod] = useState('');
  const [cycleSetupLength, setCycleSetupLength] = useState('28');

  // Local AI (Ollama)
  const [ollamaEnabled, setOllamaEnabled] = useState(false);
  const [ollamaEndpoint, setOllamaEndpoint] = useState(DEFAULT_OLLAMA_ENDPOINT);
  const [ollamaModel, setOllamaModel] = useState(DEFAULT_OLLAMA_MODEL);
  const [ollamaTestStatus, setOllamaTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  // Pull the most recent body-fat reading so targets can use Katch-McArdle.
  React.useEffect(() => {
    if (!user?.id) return;
    supabase.from('inbody_logs').select('body_fat_pct')
      .eq('user_id', user.id)
      .not('body_fat_pct', 'is', null)
      .order('measured_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setBodyFatPct(data?.body_fat_pct ?? null));
  }, [user?.id]);

  React.useEffect(() => {
    if (subScreen !== 'minerals' || !user?.id) return;
    (async () => {
      const today = toLocalDateString();
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

  // Load tracker prefs, per-metric source overrides, per-device sync times, and wearable connections.
  React.useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AsyncStorage.getItem(STORAGE_PREFERRED_TRACKER).then(val => { if (val) setPreferredTracker(val); });
    AsyncStorage.getItem(STORAGE_HK_SOURCES).then(val => { if (val) { try { setHkSources(JSON.parse(val)); } catch (e) { logError('ProfileScreen.ProfileScreen', e); } } });
    if (user?.id) {
      getConnectedWearables(user.id).then(setConnectedWearables);
      supabase.from('wearable_tokens').select('provider').eq('user_id', user.id).eq('provider', 'dexcom').maybeSingle()
        .then(({ data }) => setDexcomConnected(!!data));
      supabase.from('cycle_settings').select('tracking_enabled').eq('user_id', user.id).maybeSingle()
        .then(({ data }) => { if (data) setCycleTrackingEnabled(data.tracking_enabled ?? false); });
    }
    (async () => {
      if (!health.isAuthorized) return;
      const [sources, syncTimes] = await Promise.all([
        health.getAvailableSources(),
        health.getSourceSyncTimes(),
      ]);
      const names = new Set<string>();
      (Object.values(sources) as string[][]).forEach(list => list.forEach((n: string) => names.add(n)));
      setAvailableTrackers([...names].sort());
      setSourceSyncTimes(syncTimes);
    })();
  }, [health.isAuthorized]);

  // Picks up the result of a wearable connect that finished via App.tsx's deep-link
  // handler. Since OAuth now runs in real Safari (the in-app sheet couldn't render
  // Whoop's login), this fires on mount AND whenever the app returns to foreground —
  // i.e., the moment the user bounces back from Safari.
  React.useEffect(() => {
    if (!user?.id) return;
    const check = async () => {
      const raw = await AsyncStorage.getItem(WEARABLE_CALLBACK_RESULT_KEY);
      if (!raw) return;
      await AsyncStorage.removeItem(WEARABLE_CALLBACK_RESULT_KEY);
      try {
        const { provider, success } = JSON.parse(raw) as { provider: Provider; success: boolean };
        if (success) {
          setConnectedWearables(await getConnectedWearables(user.id));
          Alert.alert('Connected', `${wearableLabel(provider)} is now connected.`);
        } else {
          Alert.alert('Connection failed', `Couldn't connect to ${wearableLabel(provider)}. Please try again.`);
        }
      } catch (e) { logError('ProfileScreen.check', e); }
    };
    check();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        // Deep-link exchange may still be in flight when we foreground — check
        // now and once more a beat later.
        check();
        setTimeout(check, 2500);
      }
    });
    return () => sub.remove();
  }, [user?.id]);

  const setPreferredTrackerPref = async (value: string) => {
    setPreferredTracker(value);
    await AsyncStorage.setItem(STORAGE_PREFERRED_TRACKER, value);
  };

  const handleConnectWearable = async (provider: Provider) => {
    setWearableConnecting(provider);
    try {
      const success = await connectWearableForProvider(provider);
      if (success && user?.id) {
        setConnectedWearables(await getConnectedWearables(user.id));
      } else if (!success) {
        Alert.alert('Connection failed', `Couldn't connect to ${wearableLabel(provider)}. Please try again.`);
      }
    } catch (e) {
      console.log('wearable connect error:', e);
      Alert.alert('Connection failed', `Couldn't connect to ${wearableLabel(provider)}. Please try again.`);
    } finally {
      setWearableConnecting(null);
    }
  };

  const handleDisconnectWearable = (provider: Provider) => {
    const label = wearableLabel(provider);
    Alert.alert('Disconnect', `Remove ${label} connection?`, [
      { text: 'Cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          await disconnectWearable(provider);
          if (user?.id) setConnectedWearables(await getConnectedWearables(user.id));
        },
      },
    ]);
  };

  const DEXCOM_CLIENT_ID = 'YOUR_DEXCOM_CLIENT_ID';
  const DEXCOM_REDIRECT_URI = 'fuelog://wearable-callback';
  const DEXCOM_SUPABASE_URL = 'https://zbcxuffgmjuqarapfdwb.supabase.co';
  const DEXCOM_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQ4NjIsImV4cCI6MjA4NzQwMDg2Mn0.lUng1tY_aAuee_t8-E5MSUHdm2PF3HzsE41L-kzBmJE';

  const connectDexcom = async () => {
    setDexcomConnecting(true);
    try {
      const authUrl = `https://api.dexcom.com/v2/oauth2/login?client_id=${DEXCOM_CLIENT_ID}&redirect_uri=${encodeURIComponent(DEXCOM_REDIRECT_URI)}&scope=offline_access&response_type=code`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, DEXCOM_REDIRECT_URI);
      if (result.type !== 'success') return;
      const parsed = new URLSearchParams(result.url.split('?')[1] ?? '');
      const code = parsed.get('code');
      if (!code) return;
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${DEXCOM_SUPABASE_URL}/functions/v1/cgm-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
          apikey: DEXCOM_ANON_KEY,
        },
        body: JSON.stringify({ action: 'exchange_code', code }),
      });
      const data = await resp.json();
      if (!data.error) setDexcomConnected(true);
    } catch (e) {
      console.log('Dexcom connect error:', e);
    } finally {
      setDexcomConnecting(false);
    }
  };

  const disconnectDexcom = () => {
    Alert.alert('Disconnect', 'Remove Dexcom CGM connection?', [
      { text: 'Cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          if (!user?.id) return;
          await supabase.from('wearable_tokens').delete().eq('user_id', user.id).eq('provider', 'dexcom');
          setDexcomConnected(false);
        },
      },
    ]);
  };

  React.useEffect(() => {
    AsyncStorage.getItem(WATER_GOAL_KEY).then(val => {
      if (val) setWaterGoalCups(parseInt(val, 10) || DEFAULT_WATER_GOAL);
    });
  }, []);

  React.useEffect(() => {
    getOllamaSettings().then(s => {
      setOllamaEnabled(s.enabled);
      setOllamaEndpoint(s.endpoint);
      setOllamaModel(s.model);
    });
  }, []);

  const toggleOllamaEnabled = async () => {
    const next = !ollamaEnabled;
    setOllamaEnabled(next);
    setOllamaTestStatus('idle');
    await setOllamaSettings({ enabled: next });
  };

  const saveOllamaEndpoint = async (value: string) => {
    setOllamaEndpoint(value);
    setOllamaTestStatus('idle');
    await setOllamaSettings({ endpoint: value });
  };

  const saveOllamaModel = async (value: string) => {
    setOllamaModel(value);
    await setOllamaSettings({ model: value });
  };

  const testOllamaConnection = async () => {
    setOllamaTestStatus('testing');
    const ok = await pingOllama(ollamaEndpoint);
    setOllamaTestStatus(ok ? 'ok' : 'fail');
  };

  const changeWaterGoal = async (delta: number) => {
    const next = Math.min(16, Math.max(4, waterGoalCups + delta));
    setWaterGoalCups(next);
    await AsyncStorage.setItem(WATER_GOAL_KEY, String(next));
  };

  // Apple owns billing for in-app purchases, so there is no in-app screen that
  // could change or cancel a plan — that only happens in Apple ID settings.
  // App Review looks for this link, and without it users can't find where to
  // cancel. Same framing as the account-deletion warning further down.
  const openManageSubscription = async () => {
    try {
      await Linking.openURL('https://apps.apple.com/account/subscriptions');
    } catch (e) {
      logError('Profile.manageSubscription', e);
    }
  };

  const exportData = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const [macroRes, workoutRes, inbodyRes] = await Promise.all([
        supabase.from('macro_logs').select('date, meal, food, calories, protein, carbs, fat').eq('user_id', user.id).order('date'),
        supabase.from('workout_logs').select('date, exercise_name, sets').eq('user_id', user.id).eq('done', true).order('date'),
        supabase.from('inbody_logs').select('measured_at, body_fat_pct, skeletal_muscle_mass_lb, bmi, weight_lb').eq('user_id', user.id).order('measured_at'),
      ]);

      const esc = (v: any) => {
        const str = String(v ?? '');
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"` : str;
      };

      const macroCsv = [
        'date,meal_name,calories,protein_g,carbs_g,fat_g',
        ...(macroRes.data || []).map((r: any) =>
          `${r.date},${esc(r.food || r.meal)},${r.calories},${r.protein},${r.carbs},${r.fat}`
        ),
      ].join('\n');

      const workoutRows = ['date,exercise_name,set_number,reps,weight_lbs'];
      (workoutRes.data || []).forEach((r: any) => {
        (r.sets || []).forEach((set: any, i: number) => {
          workoutRows.push(`${r.date},${esc(r.exercise_name)},${i + 1},${set.reps ?? ''},${set.weight ?? ''}`);
        });
      });
      const workoutCsv = workoutRows.join('\n');

      const LB_TO_KG = 0.453592;
      const inbodyCsv = [
        'date,body_fat_pct,muscle_mass_kg,bmi,weight_kg',
        ...(inbodyRes.data || []).map((r: any) => {
          const date = r.measured_at ? toLocalDateString(new Date(r.measured_at)) : '';
          const musKg = r.skeletal_muscle_mass_lb ? (r.skeletal_muscle_mass_lb * LB_TO_KG).toFixed(2) : '';
          const wtKg = r.weight_lb ? (r.weight_lb * LB_TO_KG).toFixed(2) : '';
          return `${date},${r.body_fat_pct ?? ''},${musKg},${r.bmi ?? ''},${wtKg}`;
        }),
      ].join('\n');

      const combined = `MACRO LOG\n${macroCsv}\n\nWORKOUT LOG\n${workoutCsv}\n\nINBODY SCANS\n${inbodyCsv}`;
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = new File(Paths.cache, `fuelog_export_${ts}.txt`);
      await file.write(combined);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle: 'Export Fuelog Data' });
    } catch (e: any) {
      Alert.alert('Export Failed', e?.message || 'Could not export your data.');
    } finally {
      setExporting(false);
    }
  };

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
    // profileData is what gets written to the `profiles` row. body_fat_pct
    // lives in inbody_logs (no such column here), so it's kept separate and
    // only fed into the target math.
    const profileData = {
      weight_lbs: u.toLb(weight), height_in: totalHeightIn,
      // parseInt('') is NaN, which Postgres rejects / stores as null. Fall back
      // to the value already on the profile so saving an unrelated field can't
      // wipe the user's age.
      age: parseInt(age, 10) || profile.age || null,
      sex, activity, goal, sport,
      // Endurance fields. Empty string means "not set" and must become null —
      // Postgres rejects '' for date and numeric columns.
      race_date: raceDate.trim() || null,
      training_phase: trainingPhase || null,
      carb_tolerance_g_per_h: intOrNull(carbTolerance, 0, 200),
      sweat_rate_l_per_h: floatOrNull(sweatRate, 0, 4),
      neat_level: neatLevel || null,
      experience_level: experienceLevel || null,
    };
    const calcInput = { ...profileData, body_fat_pct: bodyFatPct };
    const auto = calculateTargets(calcInput);

    // calculateTargets returns all zeros when weight/height/age are incomplete.
    // Writing that would zero out the user's calorie and macro targets, so if
    // the math couldn't run we keep whatever they already had.
    const safeAuto = auto.calories > 0 ? auto : {
      calories: profile.calories ?? 0,
      protein: profile.protein ?? 0,
      carbs: profile.carbs ?? 0,
      fat: profile.fat ?? 0,
    };

    const targets = customGoals ? {
      calories: parseInt(customCal, 10) || safeAuto.calories,
      protein: parseInt(customProtein, 10) || safeAuto.protein,
      carbs: parseInt(customCarbs, 10) || safeAuto.carbs,
      fat: parseInt(customFat, 10) || safeAuto.fat,
    } : safeAuto;
    const periodization_settings = periodizationEnabled ? {
      enabled: true,
      trainingDay: {
        calories: parseInt(trainCal)    || 0,
        protein:  parseInt(trainProtein) || 0,
        carbs:    parseInt(trainCarbs)  || 0,
        fat:      parseInt(trainFat)    || 0,
      },
      restDay: {
        calories: parseInt(restCal)     || 0,
        protein:  parseInt(restProtein) || 0,
        carbs:    parseInt(restCarbs)   || 0,
        fat:      parseInt(restFat)     || 0,
      },
    } : null;
    const updated = { id: user!.id, name, ...profileData, ...targets, custom_goals: customGoals, periodization_settings, updated_at: new Date().toISOString() };
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
    body_fat_pct: bodyFatPct,
  });

  const handlePeriodizationToggle = () => {
    const next = !periodizationEnabled;
    setPeriodizationEnabled(next);
    if (next && !trainCal) {
      const base = {
        calories: profile.calories || autoTargets.calories,
        protein:  profile.protein  || autoTargets.protein,
        carbs:    profile.carbs    || autoTargets.carbs,
        fat:      profile.fat      || autoTargets.fat,
      };
      setTrainCal(String(base.calories + 200));
      setTrainProtein(String(base.protein));
      setTrainCarbs(String(base.carbs + 50));
      setTrainFat(String(base.fat));
      setRestCal(String(Math.max(0, base.calories - 150)));
      setRestProtein(String(base.protein));
      setRestCarbs(String(Math.max(0, base.carbs - 40)));
      setRestFat(String(base.fat));
    }
  };

  const targets = { calories: profile.calories, protein: profile.protein, carbs: profile.carbs, fat: profile.fat };

  const METRIC_LABELS: Record<string, string> = {
    hrv: 'HRV', rhr: 'Resting HR', sleep: 'Sleep',
    steps: 'Steps', activeCal: 'Active Calories', basalCal: 'Resting Calories (BMR)',
    bloodO2: 'Blood O₂', respRate: 'Respiratory Rate', vo2: 'VO₂ Max', workouts: 'Workouts',
  };

  const fmtSync = (ms: number | undefined): string => {
    if (!ms) return '';
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(ms).toLocaleDateString();
  };

  const pickSource = (metricKey: string) => {
    const opts = ['Auto', ...availableTrackers];
    Alert.alert(
      METRIC_LABELS[metricKey] ?? metricKey,
      'Choose preferred source',
      [
        ...opts.map(src => ({
          text: src === 'Auto' ? 'Auto (let system choose)' : src,
          onPress: async () => {
            const next = { ...hkSources };
            if (src === 'Auto') delete next[metricKey];
            else next[metricKey] = src;
            setHkSources(next);
            await AsyncStorage.setItem(STORAGE_HK_SOURCES, JSON.stringify(next));
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  };

  // ── Sub-screens ────────────────────────────────────────────────────────────────
  if (subScreen === 'referral') return (
    <ReferralScreen onBack={() => setSubScreen(null)} profile={profile} />
  );
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
  if (subScreen === 'memory') return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <SubScreenHeader title="Coach Memory" onBack={() => setSubScreen(null)} />
      <CoachMemoryScreen />
    </SafeAreaView>
  );
  if (subScreen === 'racefuel') return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <SubScreenHeader title="Race Fuel Plan" onBack={() => setSubScreen(null)} />
      <RaceFuelScreen profile={profile} />
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
          {/* Referral row — teal accent to stand out */}
          <TouchableOpacity style={[s.linkRow, s.linkRowBorder]} onPress={() => setSubScreen('referral')} activeOpacity={0.7}>
            <View style={[s.linkIcon, { backgroundColor: colors.accentMuted }]}>
              <Ionicons name="gift-outline" size={18} color={colors.accent} />
            </View>
            <View style={s.linkText}>
              <Text style={[s.linkLabel, { color: colors.accent }]}>Refer a Friend</Text>
              <Text style={s.linkSub}>Give 1 month free, get 1 month free</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.accent} />
          </TouchableOpacity>
          {/* The event-planner row, keyed off the athlete's capability record
              rather than a sport-name check. Five other event models exist in
              the taxonomy (meet, match, weigh-in, show, round) and each gets
              this same row when its planner is built — see EVENT_ROW in
              constants/sportArchetypes.ts. Only `race` has a destination today,
              so only `race` renders. Keyed off the live `sport` state so it
              appears the moment they pick one, not after a save. */}
          {capabilitiesFor(sport).eventModel === 'race' && (
            <TouchableOpacity style={[s.linkRow, s.linkRowBorder]} onPress={() => setSubScreen('racefuel')} activeOpacity={0.7}>
              <View style={[s.linkIcon, { backgroundColor: colors.accentMuted }]}>
                <Ionicons name="medal-outline" size={18} color={colors.accent} />
              </View>
              <View style={s.linkText}>
                <Text style={[s.linkLabel, { color: colors.accent }]}>Race Fuel Plan</Text>
                <Text style={s.linkSub}>Carbs, fluid & sodium leg by leg</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.accent} />
            </TouchableOpacity>
          )}
          {([
            { key: 'foods',    icon: 'nutrition-outline',       label: 'My Foods',       sub: 'Custom food database' },
            { key: 'plan',     icon: 'calendar-outline',        label: 'Meal Plan',      sub: 'AI-generated meal plans' },
            { key: 'minerals', icon: 'flask-outline',           label: 'Nutrients',      sub: 'Vitamins & minerals today' },
            { key: 'memory',   icon: 'sparkles-outline',        label: 'Coach Memory',   sub: 'What Fuelog remembers about you' },
            { key: 'notifs',   icon: 'notifications-outline',   label: 'Notifications',  sub: 'Reminders & alerts' },
          ] as const).map((item) => (
            <TouchableOpacity key={item.key} style={[s.linkRow, s.linkRowBorder]} onPress={() => setSubScreen(item.key)} activeOpacity={0.7}>
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
          {/* Leaves the app — see openManageSubscription for why this can't be
              an in-app screen. Last row, so no bottom border. */}
          <TouchableOpacity style={s.linkRow} onPress={openManageSubscription} activeOpacity={0.7}>
            <View style={s.linkIcon}>
              <Ionicons name="card-outline" size={18} color="#888" />
            </View>
            <View style={s.linkText}>
              <Text style={s.linkLabel}>Manage Subscription</Text>
              <Text style={s.linkSub}>Change or cancel in Apple ID settings</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#333" />
          </TouchableOpacity>
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

        {/* Hydration */}
        <Text style={s.sectionLabel}>HYDRATION</Text>
        <View style={s.formCard}>
          <View style={s.fieldRow}>
            <Text style={s.fieldLabel}>Daily Water Goal</Text>
            <View style={s.stepper}>
              <TouchableOpacity
                style={[s.stepBtn, waterGoalCups <= 4 && s.stepBtnDisabled]}
                onPress={() => changeWaterGoal(-1)}
                disabled={waterGoalCups <= 4}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={s.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={s.stepVal}>{waterGoalCups} cups</Text>
              <TouchableOpacity
                style={[s.stepBtn, waterGoalCups >= 16 && s.stepBtnDisabled]}
                onPress={() => changeWaterGoal(1)}
                disabled={waterGoalCups >= 16}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={s.stepBtnText}>+</Text>
              </TouchableOpacity>
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
              // Any tri_* distance keeps the Triathlon tile lit.
              const active = o.key === 'triathlon' ? TRI_KEYS.has(sport) : sport === o.key;
              return (
                <TouchableOpacity
                  key={o.key}
                  style={[s.sportCell, active && s.sportCellActive]}
                  onPress={() => setSport(o.key)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={o.label}>
                  <Ionicons
                    name={sportIcon(o.key)}
                    size={22}
                    color={active ? colors.accent : colors.textSecondary}
                  />
                  <Text style={[s.sportLabel, active && s.sportLabelActive]}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {TRI_KEYS.has(sport) && (
            <>
              <Text style={[s.inlineLabel, { marginTop: 16 }]}>Race distance</Text>
              <Text style={s.helpText}>
                These are genuinely different events nutritionally. A sprint is raced
                on the glycogen you already have; an Ironman is a ten-hour digestion problem.
              </Text>
              <View style={s.distanceCol}>
                {TRI_DISTANCE_OPTIONS.map(o => {
                  const active = sport === o.key;
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={[s.distanceRow, active && s.distanceRowActive]}
                      onPress={() => setSport(o.key)}
                      activeOpacity={0.7}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${o.label}, ${o.detail}`}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.distanceLabel, active && s.distanceLabelActive]}>{o.label}</Text>
                        <Text style={s.distanceDetail}>{o.detail}</Text>
                      </View>
                      {active && <Text style={s.distanceCheck}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* Race date drives the seasonal phase model and the carb-load
              window, both of which are endurance's. A lifter's block phases and
              a footballer's match week are derived differently and get their
              own fields when those models ship. */}
          {capabilitiesFor(sport).phaseModel === 'seasonal' && (
            <>
              <Text style={[s.inlineLabel, { marginTop: 16 }]}>Race date</Text>
              <Text style={s.helpText}>
                Sets your training phase and switches on the carb load automatically.
                Leave blank if you're not pointed at a race.
              </Text>
              <TextInput
                style={s.enduranceInput}
                value={raceDate}
                onChangeText={setRaceDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textTertiary}
                keyboardType="numbers-and-punctuation"
                accessibilityLabel="Race date"
              />
              {inferredPhaseLabel && (
                <Text style={s.helpText}>
                  {daysToRace !== null && daysToRace >= 0
                    ? `${daysToRace} days out — ${inferredPhaseLabel}`
                    : 'That date has passed.'}
                </Text>
              )}

              <Text style={[s.inlineLabel, { marginTop: 12 }]}>Training phase</Text>
              <View style={s.chipRow}>
                {PHASE_OPTIONS.map(o => (
                  <TouchableOpacity
                    key={o.key || 'auto'}
                    style={[s.chip, trainingPhase === o.key && s.chipActive]}
                    onPress={() => setTrainingPhase(o.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: trainingPhase === o.key }}>
                    <Text style={[s.chipText, trainingPhase === o.key && s.chipTextActive]}>
                      {o.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[s.inlineLabel, { marginTop: 12 }]}>Outside training, I'm…</Text>
              <Text style={s.helpText}>
                Your job and daily life only — training is counted separately from your
                logged sessions. Answering this as though it included training would
                double-count it.
              </Text>
              <View style={s.distanceCol}>
                {NEAT_OPTIONS.map(o => {
                  const active = neatLevel === o.key;
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={[s.distanceRow, active && s.distanceRowActive]}
                      onPress={() => setNeatLevel(o.key)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${o.label}, ${o.detail}`}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.distanceLabel, active && s.distanceLabelActive]}>{o.label}</Text>
                        <Text style={s.distanceDetail}>{o.detail}</Text>
                      </View>
                      {active && <Text style={s.distanceCheck}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[s.inlineLabel, { marginTop: 12 }]}>Experience</Text>
              <View style={s.distanceCol}>
                {EXPERIENCE_OPTIONS.map(o => {
                  const active = experienceLevel === o.key;
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={[s.distanceRow, active && s.distanceRowActive]}
                      onPress={() => setExperienceLevel(o.key)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${o.label}, ${o.detail}`}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.distanceLabel, active && s.distanceLabelActive]}>{o.label}</Text>
                        <Text style={s.distanceDetail}>{o.detail}</Text>
                      </View>
                      {active && <Text style={s.distanceCheck}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[s.inlineLabel, { marginTop: 12 }]}>Trained carb rate (g/hour)</Text>
              <Text style={s.helpText}>
                The highest rate you've actually practised in training. Race plans are
                capped at this — a rate you've trained beats one you've only read about.
              </Text>
              <TextInput
                style={s.enduranceInput}
                value={carbTolerance}
                onChangeText={setCarbTolerance}
                placeholder="e.g. 70"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
                accessibilityLabel="Trained carbohydrate rate in grams per hour"
              />

              <Text style={[s.inlineLabel, { marginTop: 12 }]}>Sweat rate (L/hour)</Text>
              <Text style={s.helpText}>
                Weigh yourself before and after a one-hour session, add whatever you drank.
                Individual rates vary more than any other number in a race plan.
              </Text>
              <TextInput
                style={s.enduranceInput}
                value={sweatRate}
                onChangeText={setSweatRate}
                placeholder="e.g. 1.1"
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
                accessibilityLabel="Sweat rate in litres per hour"
              />
            </>
          )}
          <View style={s.fieldDivider} />
          <Text style={[s.inlineLabel, { marginTop: 12 }]}>Rest Timer</Text>
          <View style={s.chipRow}>
            {[60, 90, 120, 180].map(sec => (
              <TouchableOpacity
                key={sec}
                style={[s.chip, restTimer.defaultSeconds === sec && s.chipActive]}
                onPress={() => restTimer.setDefaultSeconds(sec)}
              >
                <Text style={[s.chipText, restTimer.defaultSeconds === sec && s.chipTextActive]}>
                  {sec}s
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Health data source */}
        {Platform.OS === 'ios' && (
          <>
            <Text style={s.sectionLabel}>HEALTH DATA</Text>
            <View style={s.formCard}>
              <Text style={s.inlineLabel}>Preferred Fitness Tracker</Text>
              <View style={s.chipRow}>
                {(['auto', ...availableTrackers]).map(opt => {
                  const active = preferredTracker === opt;
                  const label = opt === 'auto' ? 'Automatic' : opt;
                  return (
                    <TouchableOpacity key={opt} style={[s.chip, active && s.chipActive]} onPress={() => setPreferredTrackerPref(opt)}>
                      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={s.healthNote}>
                {availableTrackers.length === 0
                  ? 'Open the Recovery tab once to connect Apple Health and detect your devices (Whoop, Apple Watch, etc.).'
                  : 'Global default for all metrics. Override individual metrics below. You can also override per-metric in Recovery → Customize.'}
              </Text>
              <Text style={s.healthNote}>
                Numbers may differ slightly from a tracker's own app — each device calculates calories, sleep stages, etc. with its own algorithm.
              </Text>
            </View>

            {availableTrackers.length > 0 && (
              <>
                <Text style={s.sectionLabel}>DATA SOURCES</Text>
                <View style={s.formCard}>
                  {SOURCE_PREF_KEYS.map((key, i) => {
                    const currentSource = hkSources[key];
                    const syncMs = currentSource ? sourceSyncTimes[currentSource] : undefined;
                    const syncLabel = fmtSync(syncMs);
                    return (
                      <React.Fragment key={key}>
                        {i > 0 && <View style={s.fieldDivider} />}
                        <TouchableOpacity style={s.sourceRow} onPress={() => pickSource(key)} activeOpacity={0.7}>
                          <View style={s.sourceRowLeft}>
                            <Text style={s.fieldLabel}>{METRIC_LABELS[key]}</Text>
                            {syncLabel ? <Text style={s.sourceSyncLabel}>Synced {syncLabel}</Text> : null}
                          </View>
                          <View style={s.sourceRowRight}>
                            <Text style={s.sourceValue}>{currentSource ?? 'Auto'}</Text>
                            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                          </View>
                        </TouchableOpacity>
                      </React.Fragment>
                    );
                  })}
                </View>
              </>
            )}

            <Text style={s.sectionLabel}>WEARABLES</Text>
            <View style={s.formCard}>
              {/* Garmin is deliberately absent. garmin-proxy is written and
                  ready, but Garmin's Connect Developer Program is not issuing
                  new credentials — their Health API page currently says only
                  "stay tuned for more updates on the program", and commercial
                  use carries a license fee on top of an approval review. A
                  button that cannot succeed is worse than no button, and a
                  reviewer tapping it is a Guideline 2.1 rejection.

                  Garmin owners are not cut off: Garmin Connect writes workouts,
                  heart rate and sleep into Apple Health, and we read HealthKit.
                  Restore this row the day credentials exist. */}
              {([
                { key: 'whoop' as Provider, label: 'Whoop' },
                { key: 'oura' as Provider, label: 'Oura Ring' },
              ]).map((w, i) => {
                const isConnected = connectedWearables.includes(w.key);
                const isConnecting = wearableConnecting === w.key;
                return (
                  <React.Fragment key={w.key}>
                    {i > 0 && <View style={s.fieldDivider} />}
                    <View style={s.sourceRow}>
                      <Text style={s.fieldLabel}>{w.label}</Text>
                      {isConnected ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#C8FF3D' }} />
                          <Text style={{ fontSize: 13, color: '#C8FF3D', fontWeight: '600' }}>Connected</Text>
                          <TouchableOpacity
                            onPress={() => handleDisconnectWearable(w.key)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="close-circle-outline" size={18} color={colors.textTertiary} />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          onPress={() => handleConnectWearable(w.key)}
                          disabled={isConnecting}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                        >
                          {isConnecting ? (
                            <ActivityIndicator size="small" color={colors.accent} />
                          ) : (
                            <>
                              <Text style={{ fontSize: 13, color: colors.accent, fontWeight: '600' }}>Connect</Text>
                              <Ionicons name="chevron-forward" size={14} color={colors.accent} />
                            </>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  </React.Fragment>
                );
              })}
              {/* Dexcom CGM row */}
              <View style={s.fieldDivider} />
              <View style={s.sourceRow}>
                <Text style={s.fieldLabel}>Dexcom CGM</Text>
                {dexcomConnected ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#C8FF3D' }} />
                    <Text style={{ fontSize: 13, color: '#C8FF3D', fontWeight: '600' }}>Connected</Text>
                    <TouchableOpacity onPress={disconnectDexcom} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle-outline" size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={connectDexcom}
                    disabled={dexcomConnecting}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  >
                    {dexcomConnecting ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <>
                        <Text style={{ fontSize: 13, color: colors.accent, fontWeight: '600' }}>Connect</Text>
                        <Ionicons name="chevron-forward" size={14} color={colors.accent} />
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Cycle Tracking */}
            <Text style={s.sectionLabel}>CYCLE TRACKING</Text>
            <TouchableOpacity
              style={s.customGoalsRow}
              onPress={() => {
                if (!cycleTrackingEnabled) {
                  setShowCycleSetup(true);
                } else {
                  setCycleTrackingEnabled(false);
                  if (user?.id) {
                    supabase.from('cycle_settings').upsert({ user_id: user.id, tracking_enabled: false }, { onConflict: 'user_id' });
                  }
                }
              }}
              activeOpacity={0.8}
            >
              <View>
                <Text style={s.customGoalsTitle}>Cycle Tracking</Text>
                <Text style={s.customGoalsSub}>Phase-aware training and nutrition insights</Text>
              </View>
              <View style={[s.toggle, cycleTrackingEnabled && s.toggleOn]}>
                <View style={[s.toggleThumb, cycleTrackingEnabled && s.toggleThumbOn]} />
              </View>
            </TouchableOpacity>
          </>
        )}

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

        {/* Nutrition Periodization */}
        <TouchableOpacity style={s.customGoalsRow} onPress={handlePeriodizationToggle} activeOpacity={0.8}>
          <View>
            <Text style={s.customGoalsTitle}>Nutrition Periodization</Text>
            <Text style={s.customGoalsSub}>Different targets for training vs. rest days</Text>
          </View>
          <View style={[s.toggle, periodizationEnabled && s.toggleOn]}>
            <View style={[s.toggleThumb, periodizationEnabled && s.toggleThumbOn]} />
          </View>
        </TouchableOpacity>
        {periodizationEnabled && (
          <View style={s.formCard}>
            <Text style={s.periodLabel}>TRAINING DAY</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.inlineLabel}>Calories</Text>
                <TextInput style={s.standaloneInput} value={trainCal} onChangeText={setTrainCal} keyboardType="number-pad" placeholderTextColor="#444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.inlineLabel, { color: MC.protein.color }]}>Protein (g)</Text>
                <TextInput style={s.standaloneInput} value={trainProtein} onChangeText={setTrainProtein} keyboardType="number-pad" placeholderTextColor="#444" />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[s.inlineLabel, { color: MC.carbs.color }]}>Carbs (g)</Text>
                <TextInput style={s.standaloneInput} value={trainCarbs} onChangeText={setTrainCarbs} keyboardType="number-pad" placeholderTextColor="#444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.inlineLabel, { color: MC.fat.color }]}>Fat (g)</Text>
                <TextInput style={s.standaloneInput} value={trainFat} onChangeText={setTrainFat} keyboardType="number-pad" placeholderTextColor="#444" />
              </View>
            </View>
            <View style={[s.fieldDivider, { marginTop: 16, marginBottom: 4 }]} />
            <Text style={[s.periodLabel, { marginTop: 12 }]}>REST DAY</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.inlineLabel}>Calories</Text>
                <TextInput style={s.standaloneInput} value={restCal} onChangeText={setRestCal} keyboardType="number-pad" placeholderTextColor="#444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.inlineLabel, { color: MC.protein.color }]}>Protein (g)</Text>
                <TextInput style={s.standaloneInput} value={restProtein} onChangeText={setRestProtein} keyboardType="number-pad" placeholderTextColor="#444" />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[s.inlineLabel, { color: MC.carbs.color }]}>Carbs (g)</Text>
                <TextInput style={s.standaloneInput} value={restCarbs} onChangeText={setRestCarbs} keyboardType="number-pad" placeholderTextColor="#444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.inlineLabel, { color: MC.fat.color }]}>Fat (g)</Text>
                <TextInput style={s.standaloneInput} value={restFat} onChangeText={setRestFat} keyboardType="number-pad" placeholderTextColor="#444" />
              </View>
            </View>
          </View>
        )}

        {/* AI Coach — local LLM */}
        <Text style={s.sectionLabel}>AI COACH</Text>
        <TouchableOpacity style={s.customGoalsRow} onPress={toggleOllamaEnabled} activeOpacity={0.8}>
          <View>
            <Text style={s.customGoalsTitle}>Use Local AI (Ollama)</Text>
            <Text style={s.customGoalsSub}>Prefer your own server; falls back to cloud AI automatically</Text>
          </View>
          <View style={[s.toggle, ollamaEnabled && s.toggleOn]}>
            <View style={[s.toggleThumb, ollamaEnabled && s.toggleThumbOn]} />
          </View>
        </TouchableOpacity>
        {ollamaEnabled && (
          <View style={s.formCard}>
            <Text style={s.inlineLabel}>Server Address</Text>
            <TextInput
              style={s.standaloneInput}
              value={ollamaEndpoint}
              onChangeText={saveOllamaEndpoint}
              placeholder={DEFAULT_OLLAMA_ENDPOINT}
              placeholderTextColor="#444"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <View style={s.fieldDivider} />
            <Text style={[s.inlineLabel, { marginTop: 12 }]}>Model</Text>
            <TextInput
              style={s.standaloneInput}
              value={ollamaModel}
              onChangeText={saveOllamaModel}
              placeholder={DEFAULT_OLLAMA_MODEL}
              placeholderTextColor="#444"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={s.ollamaTestBtn} onPress={testOllamaConnection} activeOpacity={0.8}>
              {ollamaTestStatus === 'testing'
                ? <ActivityIndicator color={colors.text} size="small" />
                : (
                  <Text style={s.ollamaTestBtnText}>
                    {ollamaTestStatus === 'ok' ? '✓ Connected'
                      : ollamaTestStatus === 'fail' ? '✕ Unreachable — check address'
                      : 'Test Connection'}
                  </Text>
                )}
            </TouchableOpacity>
          </View>
        )}

        {/* Privacy & Data */}
        <Text style={s.sectionLabel}>PRIVACY & DATA</Text>
        <TouchableOpacity style={s.exportBtn} onPress={exportData} disabled={exporting} activeOpacity={0.8}>
          {exporting
            ? <ActivityIndicator color={colors.text} size="small" />
            : <Text style={s.exportBtnText}>Export My Data</Text>}
        </TouchableOpacity>

        {/* Save */}
        <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={loading} activeOpacity={0.8}>
          {loading ? <ActivityIndicator color="#000" /> : <Text style={s.saveBtnText}>{saved ? '✓ Saved!' : 'Save & Recalculate'}</Text>}
        </TouchableOpacity>

        {/* Sign out */}
        <TouchableOpacity style={s.signOutBtn} onPress={() => Alert.alert('Sign Out', 'Are you sure?', [{ text: 'Cancel' }, { text: 'Sign Out', style: 'destructive', onPress: signOut }])} activeOpacity={0.7}>
          <Text style={s.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        {/* Achievements */}
        <Text style={[s.sectionLabel, { marginTop: 16 }]}>ACHIEVEMENTS</Text>
        <AchievementBadges profile={targets} />

        {/* Account deletion. Required by App Store Guideline 5.1.1(v): an app
            that lets you make an account has to let you delete it from inside
            the app. Deliberately placed at the very bottom, below everything
            else, and gated behind a typed confirmation — it is irreversible. */}
        <Text style={[s.sectionLabel, { marginTop: 28 }]}>ACCOUNT</Text>
        <TouchableOpacity
          style={s.deleteAccountBtn}
          onPress={() => setShowDeleteAccount(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Delete account permanently"
        >
          <Text style={s.deleteAccountText}>Delete Account</Text>
        </TouchableOpacity>
        <Text style={s.deleteAccountHint}>
          Permanently deletes your account and all your data. This cannot be undone.
        </Text>

      </ScrollView>

      {/* Delete Account confirmation */}
      <Modal
        visible={showDeleteAccount}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowDeleteAccount(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>Delete Account</Text>
            <TouchableOpacity onPress={() => { setShowDeleteAccount(false); setDeleteConfirm(''); }} disabled={deleting}>
              <Text style={{ fontSize: 16, color: colors.textSecondary }}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <Text style={{ fontSize: 15, color: colors.text, lineHeight: 22, marginBottom: 16 }}>
              This permanently deletes your Fuelog account and everything in it:
            </Text>
            <Text style={{ fontSize: 15, color: colors.textSecondary, lineHeight: 24, marginBottom: 16 }}>
              • Every food and workout you have logged{'\n'}
              • Weight history, measurements and InBody scans{'\n'}
              • Progress photos and blood work{'\n'}
              • Meal plans, recipes and saved foods{'\n'}
              • Connected wearables and your coach history
            </Text>
            <Text style={{ fontSize: 15, color: colors.danger, lineHeight: 22, marginBottom: 20, fontWeight: '600' }}>
              This cannot be undone. There is no way to recover the data afterwards.
            </Text>

            {/* Subscriptions live with Apple, not with us — deleting the account
                does not stop billing, and users reliably assume it does. */}
            <Text style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 21, marginBottom: 22 }}>
              If you have a Fuelog Pro subscription, deleting your account does not cancel it.
              Cancel it in your Apple ID subscription settings first, or you will keep being charged.
            </Text>

            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 }}>
              Type DELETE to confirm
            </Text>
            <TextInput
              value={deleteConfirm}
              onChangeText={setDeleteConfirm}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!deleting}
              placeholder="DELETE"
              placeholderTextColor={colors.textSecondary}
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                paddingHorizontal: 14, paddingVertical: 13, fontSize: 16,
                color: colors.text, backgroundColor: colors.card, marginBottom: 22,
              }}
              accessibilityLabel="Type DELETE to confirm account deletion"
            />

            <TouchableOpacity
              style={{
                backgroundColor: deleteConfirm === 'DELETE' ? colors.danger : colors.border,
                borderRadius: 999, paddingVertical: 16, alignItems: 'center',
              }}
              disabled={deleteConfirm !== 'DELETE' || deleting}
              onPress={handleDeleteAccount}
              activeOpacity={0.8}
            >
              {deleting
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Delete my account</Text>}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Cycle Tracking Setup Modal */}
      <Modal visible={showCycleSetup} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCycleSetup(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>Set Up Cycle Tracking</Text>
            <TouchableOpacity onPress={() => setShowCycleSetup(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            <Text style={{ fontSize: 14, color: colors.textTertiary, lineHeight: 22 }}>
              Enter your last period start date and average cycle length to enable phase-aware training and nutrition insights.
            </Text>
            <View style={s.formCard}>
              <Text style={s.inlineLabel}>Last Period Start (YYYY-MM-DD)</Text>
              <TextInput
                style={s.standaloneInput}
                value={cycleSetupLastPeriod}
                onChangeText={setCycleSetupLastPeriod}
                placeholder="e.g. 2026-06-01"
                placeholderTextColor="#444"
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
              />
              <View style={s.fieldDivider} />
              <Text style={[s.inlineLabel, { marginTop: 12 }]}>Average Cycle Length (days)</Text>
              <TextInput
                style={s.standaloneInput}
                value={cycleSetupLength}
                onChangeText={setCycleSetupLength}
                keyboardType="number-pad"
                placeholder="28"
                placeholderTextColor="#444"
              />
            </View>
            <Text style={{ fontSize: 12, color: colors.textTertiary, lineHeight: 18 }}>
              You can update these anytime. Cycle tracking is entirely private and stored only in your account.
            </Text>
            <TouchableOpacity
              style={s.saveBtn}
              onPress={async () => {
                if (!user?.id || !cycleSetupLastPeriod) return;
                const len = parseInt(cycleSetupLength, 10) || 28;
                await supabase.from('cycle_settings').upsert({
                  user_id: user.id,
                  tracking_enabled: true,
                  cycle_length_days: len,
                  period_length_days: 5,
                  last_period_start: cycleSetupLastPeriod,
                }, { onConflict: 'user_id' });
                setCycleTrackingEnabled(true);
                setShowCycleSetup(false);
              }}
              activeOpacity={0.8}
            >
              <Text style={s.saveBtnText}>Enable Cycle Tracking</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 28, fontWeight: weight.bold, color: colors.text, letterSpacing: -0.5 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 60, gap: 8 },

  // Sub-screen header
  subHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 60 },
  backLabel: { fontSize: 16, color: colors.text, fontWeight: weight.medium },
  subHeaderTitle: { fontSize: 17, fontWeight: weight.bold, color: colors.text },

  // Hero
  hero: { alignItems: 'center', paddingVertical: 8, marginBottom: 8 },
  avatarWrap: { width: 88, height: 88, borderRadius: 44, overflow: 'hidden', marginBottom: 12 },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 34, fontWeight: weight.heavy, color: colors.text },
  avatarOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 26, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  heroName: { fontSize: 22, fontWeight: weight.bold, color: colors.text, marginBottom: 3 },
  heroEmail: { fontSize: 13, color: colors.textTertiary, fontWeight: weight.regular },

  // Targets card
  targetsCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 18, marginBottom: 4, borderWidth: 1, borderColor: colors.border },
  sectionLabel: { fontSize: 11, fontWeight: weight.semibold, color: colors.textSecondary, letterSpacing: 1.5, marginTop: 8, marginBottom: 6 },
  targetsRow: { flexDirection: 'row', alignItems: 'center' },
  targetItem: { flex: 1, alignItems: 'center' },
  targetDivider: { width: 1, height: 32, backgroundColor: colors.border },
  targetVal: { fontSize: 20, fontWeight: weight.heavy, color: colors.text, letterSpacing: -0.5 },
  targetLabel: { fontSize: 10, color: colors.textTertiary, fontWeight: weight.medium, marginTop: 2 },

  // Quick links card
  linksCard: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden', marginBottom: 4, borderWidth: 1, borderColor: colors.border },
  linkRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  linkRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  linkIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  linkText: { flex: 1 },
  linkLabel: { fontSize: 15, fontWeight: weight.semibold, color: colors.text },
  linkSub: { fontSize: 12, color: colors.textTertiary, fontWeight: weight.regular, marginTop: 1 },

  // Form card (grouped inputs)
  formCard: { backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 4, marginBottom: 4, borderWidth: 1, borderColor: colors.border },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  fieldDivider: { height: 1, backgroundColor: colors.border },
  fieldLabel: { fontSize: 15, fontWeight: weight.medium, color: colors.text },
  fieldInput: { fontSize: 15, color: colors.text, textAlign: 'right', minWidth: 60 },
  fieldUnit: { fontSize: 13, color: colors.textTertiary, fontWeight: weight.medium },
  inlineLabel: { fontSize: 12, fontWeight: weight.semibold, color: colors.textSecondary, letterSpacing: 0.3, marginBottom: 10, marginTop: 4 },
  healthNote: { fontSize: 11, color: colors.textTertiary, fontWeight: weight.regular, lineHeight: 16, marginTop: 4, marginBottom: 8 },

  // Data Sources rows
  sourceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  sourceRowLeft: { flex: 1, paddingRight: 8 },
  sourceRowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sourceValue: { fontSize: 14, color: colors.textSecondary, fontWeight: weight.medium },
  sourceSyncLabel: { fontSize: 11, color: colors.textTertiary, fontWeight: weight.regular, marginTop: 2 },

  // Chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { backgroundColor: colors.cardAlt, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { backgroundColor: colors.accent },
  chipText: { fontSize: 13, fontWeight: weight.semibold, color: colors.textSecondary },
  chipTextActive: { color: colors.accentText },

  // Sport grid
  sportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  sportCell: {
    width: '30%', flexGrow: 1,
    backgroundColor: colors.cardAlt, borderRadius: radius.md,
    paddingVertical: 12, alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  sportCellActive: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  sportLabel: { fontSize: 11, fontWeight: weight.semibold, color: colors.textSecondary, textAlign: 'center' },
  sportLabelActive: { color: colors.text },
  helpText: {
    fontSize: 12, color: colors.textSecondary, lineHeight: 17,
    marginTop: 4, marginBottom: 8,
  },
  enduranceInput: {
    fontSize: 15, color: colors.text, backgroundColor: colors.card,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 4,
  },
  distanceCol: { gap: 8, marginBottom: 4 },
  distanceRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  distanceRowActive: { borderColor: colors.accent, backgroundColor: colors.accentMuted },
  distanceLabel: { fontSize: 15, fontWeight: weight.bold, color: colors.textSecondary },
  distanceLabelActive: { color: colors.text },
  distanceDetail: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  distanceCheck: { color: colors.accent, fontSize: 16, fontWeight: weight.heavy, marginLeft: 12 },

  // Segmented (sex)
  segmented: { flexDirection: 'row', backgroundColor: colors.cardAlt, borderRadius: radius.sm, padding: 3, gap: 3 },
  segBtn: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 6 },
  segBtnActive: { backgroundColor: colors.accent },
  segBtnText: { fontSize: 13, fontWeight: weight.semibold, color: colors.textSecondary },
  segBtnTextActive: { color: colors.accentText },

  // Custom goals
  customGoalsRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, marginTop: 4,
    borderWidth: 1, borderColor: colors.border,
  },
  customGoalsTitle: { fontSize: 15, fontWeight: weight.semibold, color: colors.text, marginBottom: 2 },
  customGoalsSub: { fontSize: 12, color: colors.textTertiary, fontWeight: weight.regular },
  toggle: { width: 46, height: 26, borderRadius: 13, backgroundColor: colors.cardAlt, padding: 2, justifyContent: 'center' },
  toggleOn: { backgroundColor: colors.accent },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white, alignSelf: 'flex-start' },
  toggleThumbOn: { alignSelf: 'flex-end' },
  standaloneInput: { backgroundColor: colors.cardAlt, borderRadius: radius.sm, color: colors.text, padding: 12, fontSize: 15 },
  ollamaTestBtn: { backgroundColor: colors.cardAlt, borderRadius: radius.sm, paddingVertical: 12, alignItems: 'center', marginTop: 14, marginBottom: 10 },
  ollamaTestBtnText: { color: colors.text, fontSize: 13, fontWeight: weight.semibold },
  periodLabel: { fontSize: 11, fontWeight: weight.semibold, color: colors.textSecondary, letterSpacing: 1.5, marginBottom: 8, marginTop: 4 },

  // Stepper
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  stepBtnDisabled: { opacity: 0.3 },
  stepBtnText: { fontSize: 20, color: colors.text, fontWeight: weight.bold, lineHeight: 24 },
  stepVal: { fontSize: 15, fontWeight: weight.semibold, color: colors.text, minWidth: 72, textAlign: 'center' },

  // Buttons
  exportBtn: { backgroundColor: colors.card, borderRadius: radius.md, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: colors.border, marginBottom: 4 },
  exportBtnText: { color: colors.text, fontSize: 15, fontWeight: weight.semibold },
  saveBtn: { backgroundColor: colors.accent, borderRadius: radius.md, padding: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: colors.accentText, fontSize: 15, fontWeight: weight.bold },
  signOutBtn: { alignItems: 'center', paddingVertical: 14 },
  signOutText: { color: colors.danger, fontSize: 15, fontWeight: weight.semibold },
  // Deliberately understated: an outlined row rather than a filled red button,
  // so it reads as available but not inviting. The commitment happens in the
  // typed confirmation, not here.
  deleteAccountBtn: {
    alignItems: 'center', paddingVertical: 14, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.danger, marginTop: 4,
  },
  deleteAccountText: { color: colors.danger, fontSize: 15, fontWeight: weight.semibold },
  deleteAccountHint: {
    color: colors.textSecondary, fontSize: 12.5, lineHeight: 18,
    textAlign: 'center', marginTop: 10, marginBottom: 8,
  },
});
