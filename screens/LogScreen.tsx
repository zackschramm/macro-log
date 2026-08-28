import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal, Animated, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { useHealthKit } from '../hooks/useHealthKit';
import MacroRing from '../components/MacroRing';
import WaterTracker from '../components/WaterTracker';
import AddFoodModal from '../components/AddFoodModal';
import FoodPhotoModal from './FoodPhotoScreen';
import VoiceLogModal from './VoiceLogScreen';
import CalorieBurnModal from '../components/CalorieBurnModal';
import { MEALS, MC } from '../constants/data';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { updateStreak, getDisplayStreak } from '../utils/streak';
import { checkAchievements, invalidateAchievementsCache } from '../utils/achievements';
import { generateWeeklyInsight, getMondayISODate } from '../utils/weeklyInsight';
import { scheduleWeeklyInsightNotification } from '../utils/notifications';
import { checkAndSendProactiveInsight } from '../utils/proactiveCoach';
import { useDynamicTargets } from '../hooks/useDynamicTargets';
import { syncWidgetData } from '../utils/widgetSync';
import { toLocalDateString } from '../utils/dateUtils';
import * as Haptics from 'expo-haptics';
import SkeletonBox from '../components/SkeletonBox';
import MicronutrientsScreen from './MicronutrientsScreen';
import { trackOnce, EVENTS } from '../utils/analytics';

const todayStr = () => toLocalDateString();
const r1 = (n: number) => Math.round(n * 10) / 10;
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

type MacroSet = { calories: number; protein: number; carbs: number; fat: number };
type PeriodizationSettings = { enabled: boolean; trainingDay: MacroSet; restDay: MacroSet };

export default function LogScreen({
  targets,
  profile,
  periodizationSettings,
  pendingSiriFood,
  onSiriFoodApplied,
}: {
  targets: MacroSet;
  profile?: any;
  periodizationSettings?: PeriodizationSettings | null;
  /** Food description handed off by the "Log <food> in Fuelog" Siri intent. */
  pendingSiriFood?: string;
  onSiriFoodApplied?: () => void;
}) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { user } = useAuth();
  const health = useHealthKit();
  const [logs, setLogs] = useState<any[]>([]);
  const [activeDate, setActiveDate] = useState(todayStr());
  const [addFoodMeal, setAddFoodMeal] = useState<string | null>(null);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [voiceInitialText, setVoiceInitialText] = useState<string | undefined>(undefined);
  const [isNewUser, setIsNewUser] = useState(false);
  const [logLoading, setLogLoading] = useState(true);
  const [streakCount, setStreakCount] = useState(0);
  const [streakLastDate, setStreakLastDate] = useState('');
  const [streakMilestone, setStreakMilestone] = useState<number | null>(null);
  const [showStreakDetail, setShowStreakDetail] = useState(false);
  const streakAnim = useRef(new Animated.Value(0)).current;
  const [hasWorkoutToday, setHasWorkoutToday] = useState(false);
  const [achievementToast, setAchievementToast] = useState<string | null>(null);
  const achievementAnim = useRef(new Animated.Value(0)).current;
  const [weeklyInsight, setWeeklyInsight] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [showBurnModal, setShowBurnModal] = useState(false);
  const [showMicros, setShowMicros] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('fuelog_onboarding_complete').then(ts => {
      if (ts && Date.now() - parseInt(ts, 10) < 7 * 24 * 60 * 60 * 1000) {
        setIsNewUser(true);
      }
    });
  }, []);

  const refreshStreak = useCallback(async () => {
    if (!user) return;
    const result = await updateStreak(user.id);
    setStreakCount(result.count);
    setStreakLastDate(result.lastDate);
    if (result.milestoneToShow != null) {
      setStreakMilestone(result.milestoneToShow);
      streakAnim.setValue(0);
      Animated.sequence([
        Animated.timing(streakAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.delay(2000),
        Animated.timing(streakAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(() => setStreakMilestone(null));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [user, streakAnim]);

  useEffect(() => { refreshStreak(); }, [refreshStreak]);

  useEffect(() => {
    if (!pendingSiriFood) return;
    setVoiceInitialText(pendingSiriFood);
    setShowVoiceModal(true);
    onSiriFoodApplied?.();
  }, [pendingSiriFood]);

  useEffect(() => {
    if (!user) return;
    checkAndSendProactiveInsight(user.id);
  }, [user?.id]);

  const { dynamicTargets, tdeeData, refresh: refreshTdee } = useDynamicTargets({
    userId: user?.id,
    profile,
    enabled: health.isAuthorized,
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const thisMonday = getMondayISODate();
      const dismissed = await AsyncStorage.getItem('fuelog_weekly_insight_dismissed');
      if (dismissed === thisMonday) return;

      const cachedDate = await AsyncStorage.getItem('fuelog_weekly_insight_date');
      const hasThisWeeksCache = cachedDate === thisMonday;
      const isMondayToday = new Date().getDay() === 1;
      if (!hasThisWeeksCache && !isMondayToday) return;

      setInsightLoading(true);
      const insight = await generateWeeklyInsight(user.id);
      setWeeklyInsight(insight);
      setInsightLoading(false);
      if (isMondayToday) await scheduleWeeklyInsightNotification();
    })();
  }, [user?.id]);

  const dismissInsight = async () => {
    await AsyncStorage.setItem('fuelog_weekly_insight_dismissed', getMondayISODate());
    setWeeklyInsight(null);
    setInsightLoading(false);
  };

  const fetchLogs = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('macro_logs')
      .select('*').eq('user_id', user.id).eq('date', activeDate).order('created_at');
    setLogs(data || []);
    setLogLoading(false);
  }, [user, activeDate]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Check whether a workout was logged on the active date (for periodization)
  useEffect(() => {
    if (!periodizationSettings?.enabled || !user) { setHasWorkoutToday(false); return; }
    supabase.from('workout_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('date', activeDate)
      .eq('done', true)
      .then(({ count }) => setHasWorkoutToday((count ?? 0) > 0));
  }, [user?.id, activeDate, periodizationSettings?.enabled]);

  const showAchievementToast = (name: string) => {
    setAchievementToast(name);
    achievementAnim.setValue(0);
    Animated.sequence([
      Animated.timing(achievementAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(achievementAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setAchievementToast(null));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const totals = logs.reduce(
    (a, e) => ({ calories: a.calories + e.calories, protein: a.protein + e.protein, carbs: a.carbs + e.carbs, fat: a.fat + e.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  // Target priority: periodization (explicit customization) → burn-driven
  // dynamic targets (today only, skipped for custom_goals users inside the
  // hook) → static profile targets
  const { effectiveTargets, dynamicActive } = (() => {
    if (periodizationSettings?.enabled) {
      const pd = hasWorkoutToday ? periodizationSettings.trainingDay : periodizationSettings.restDay;
      if (pd?.calories) return { effectiveTargets: pd, dynamicActive: false };
    }
    if (activeDate === todayStr() && dynamicTargets) {
      return { effectiveTargets: dynamicTargets, dynamicActive: true };
    }
    return { effectiveTargets: targets, dynamicActive: false };
  })();

  const displayCalTarget = effectiveTargets.calories;
  const calOver = totals.calories > displayCalTarget;
  const calRemain = displayCalTarget - Math.round(totals.calories);

  // Sync today's totals + effective targets to the WidgetKit shared container
  // after every log or target change, so the widget matches the app
  useEffect(() => {
    if (activeDate !== todayStr()) return;
    syncWidgetData(totals, effectiveTargets).catch(() => {});
  }, [logs, targets, dynamicTargets, periodizationSettings, hasWorkoutToday, activeDate]);

  // Color for live "Eaten" label: green = on target ±100, amber = 100–300 under, red = 300+ under or any over
  const burnEatenColor = (() => {
    if (!tdeeData?.goalCalories) return colors.text;
    const diff = tdeeData.goalCalories - Math.round(totals.calories);
    if (Math.abs(diff) <= 100) return colors.accent;
    if (diff > 100 && diff <= 300) return colors.warning;
    return colors.danger;
  })();

  const changeDate = (delta: number) => {
    const d = new Date(activeDate + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    const next = toLocalDateString(d);
    if (next <= todayStr()) setActiveDate(next);
  };

  const addOptimisticEntry = (entry: Record<string, any>): string => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setLogs(prev => [...prev, { ...entry, id: tempId }]);
    return tempId;
  };

  const confirmOptimisticEntry = (tempId: string, real: any) => {
    setLogs(prev => prev.map(e => (e.id === tempId ? real : e)));
  };

  const rollbackOptimisticEntry = (tempId: string, message?: string) => {
    setLogs(prev => prev.filter(e => e.id !== tempId));
    Alert.alert('Could not log food', message || 'Please check your connection and try again.');
  };

  const removeEntry = async (id: number | string) => {
    if (typeof id === 'string') { setLogs(prev => prev.filter(e => e.id !== id)); return; }
    const removed = logs.find(e => e.id === id);
    setLogs(prev => prev.filter(e => e.id !== id));
    const { error } = await supabase.from('macro_logs').delete().eq('id', id);
    if (error && removed) {
      setLogs(prev => [...prev, removed]);
      Alert.alert('Could not delete', 'Please check your connection and try again.');
    }
  };

  if (showMicros) {
    return <MicronutrientsScreen date={activeDate} onBack={() => setShowMicros(false)} />;
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <View style={s.headerRow}>
          <Text style={s.title}>Fuelog</Text>
          {getDisplayStreak(streakCount, streakLastDate) > 0 && (
            <TouchableOpacity onPress={() => setShowStreakDetail(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[s.streakBadge, getDisplayStreak(streakCount, streakLastDate) >= 7 ? s.streakTeal : s.streakAmber]}>
                {getDisplayStreak(streakCount, streakLastDate)}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={s.date}>{activeDate === todayStr() ? 'Today' : fmtDate(activeDate)}</Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Date nav */}
        <View style={s.dateNav}>
          <TouchableOpacity style={s.dateBtn} onPress={() => changeDate(-1)}>
            <Text style={s.dateArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={s.dateLabel}>{activeDate === todayStr() ? 'Today' : fmtDate(activeDate)}</Text>
          <TouchableOpacity style={[s.dateBtn, activeDate === todayStr() && s.dateBtnDisabled]}
            onPress={() => changeDate(1)} disabled={activeDate === todayStr()}>
            <Text style={s.dateArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Calorie hero */}
        <View style={s.hero}>
          <Text style={s.heroLabel}>CALORIES</Text>
          <Text style={[s.heroNum, calOver && s.heroOver]}>{Math.round(totals.calories)}</Text>
          <Text style={s.heroSub}>
            {calOver
              ? `${Math.abs(calRemain)} over your ${displayCalTarget} goal`
              : `${calRemain} remaining of ${displayCalTarget}`}
          </Text>
        </View>

        {/* Rings */}
        <View style={s.ringsWrap}>
          <View style={s.rings}>
            <MacroRing macroKey="protein" value={totals.protein} target={effectiveTargets.protein} label="Protein" />
            <MacroRing macroKey="carbs" value={totals.carbs} target={effectiveTargets.carbs} label="Carbs" />
            <MacroRing macroKey="fat" value={totals.fat} target={effectiveTargets.fat} label="Fat" />
          </View>
          {periodizationSettings?.enabled && (
            <Text style={s.periodLabel}>
              {hasWorkoutToday ? 'Training day targets' : 'Rest day targets'}
            </Text>
          )}
          {dynamicActive && (
            <TouchableOpacity onPress={() => setShowBurnModal(true)} activeOpacity={0.7} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={s.dynamicLabel}>Based on today's burn</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.microsBtn} onPress={() => setShowMicros(true)} activeOpacity={0.7}>
            <Text style={s.microsBtnText}>Micros →</Text>
          </TouchableOpacity>
        </View>

        {/* Burn & Eat strip — only when HealthKit TDEE data is available for today */}
        {activeDate === todayStr() && tdeeData?.tdee != null && (
          <TouchableOpacity style={s.burnStrip} onPress={() => setShowBurnModal(true)} activeOpacity={0.8}>
            <View style={s.burnCol}>
              <Text style={s.burnTopLabel}>Burned</Text>
              <Text style={s.burnMain}>{tdeeData.tdee.toLocaleString()} cal</Text>
              <Text style={s.burnSub}>Active: {(tdeeData.active ?? 0).toLocaleString()} cal</Text>
            </View>
            <View style={s.burnVertDivider} />
            <View style={s.burnCol}>
              <Text style={s.burnTopLabel}>Target</Text>
              <Text style={s.burnMain}>{(tdeeData.goalCalories ?? 0).toLocaleString()} cal</Text>
              <Text style={[s.burnSub, { color: burnEatenColor }]}>Eaten: {Math.round(totals.calories).toLocaleString()} cal</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Weekly Insight */}
        {(insightLoading || weeklyInsight) && (
          <View style={s.insightCard}>
            <View style={s.insightBorder} />
            <View style={s.insightContent}>
              <Text style={s.insightLabel}>WEEKLY INSIGHT</Text>
              {insightLoading ? (
                <>
                  <SkeletonBox width="100%" height={14} borderRadius={4} style={{ marginBottom: 6 }} />
                  <SkeletonBox width="85%" height={14} borderRadius={4} style={{ marginBottom: 6 }} />
                  <SkeletonBox width="60%" height={14} borderRadius={4} />
                </>
              ) : (
                <>
                  <Text style={s.insightText}>{weeklyInsight}</Text>
                  <TouchableOpacity onPress={dismissInsight} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={s.insightDismiss}>Dismiss</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}

        {/* Water tracker */}
        <WaterTracker />

        {/* Primary add-food button */}
        <TouchableOpacity style={s.addFoodBtn} onPress={() => setAddFoodMeal('')} activeOpacity={0.8}>
          <Text style={s.addFoodBtnText}>+ Log Food</Text>
        </TouchableOpacity>

        {/* AI logging shortcuts */}
        <View style={s.aiLogRow}>
          <TouchableOpacity style={s.aiLogBtn} onPress={() => setShowPhotoModal(true)} activeOpacity={0.8}>
            <Ionicons name="camera-outline" size={15} color={colors.accent} /><Text style={s.aiLogBtnText}>Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.aiLogBtn} onPress={() => setShowVoiceModal(true)} activeOpacity={0.8}>
            <Ionicons name="mic-outline" size={15} color={colors.accent} /><Text style={s.aiLogBtnText}>Voice</Text>
          </TouchableOpacity>
        </View>

        {/* Entries */}
        {logLoading ? MEALS.map(meal => (
          <View key={meal} style={{ marginBottom: 8 }}>
            <SkeletonBox width={80} height={11} borderRadius={4} style={{ marginBottom: 8 }} />
            <SkeletonBox width="100%" height={52} borderRadius={radius.md} style={{ marginBottom: 6 }} />
            <SkeletonBox width="85%" height={52} borderRadius={radius.md} />
          </View>
        )) : (
          <>
            {MEALS.map(meal => {
              const entries = logs.filter(e => e.meal === meal);
              if (!entries.length) {
                return (
                  <TouchableOpacity key={meal} style={s.mealSectionEmpty} onPress={() => setAddFoodMeal(meal)} activeOpacity={0.7}>
                    <Text style={s.mealHeaderEmpty}>{meal.toUpperCase()}</Text>
                    <Text style={s.mealAdd}>+ Add</Text>
                  </TouchableOpacity>
                );
              }
              return (
                <View key={meal} style={s.mealSection}>
                  <View style={s.mealHeaderRow}>
                    <Text style={s.mealHeader}>{meal.toUpperCase()}</Text>
                    <TouchableOpacity onPress={() => setAddFoodMeal(meal)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={s.mealAdd}>+ Add</Text>
                    </TouchableOpacity>
                  </View>
                  {entries.map(e => (
                    <View key={e.id} style={s.entry}>
                      <View style={s.entryInfo}>
                        <Text style={s.entryName}>{e.qty !== 1 ? `${e.qty}× ` : ''}{e.food}</Text>
                        <View style={s.entryMacros}>
                          <Text style={s.entryCal}>{e.calories} cal</Text>
                          <Text style={{ color: MC.protein.color, fontSize: 11, fontWeight: '600' }}>P {e.protein}g</Text>
                          <Text style={{ color: MC.carbs.color, fontSize: 11, fontWeight: '600' }}>C {e.carbs}g</Text>
                          <Text style={{ color: MC.fat.color, fontSize: 11, fontWeight: '600' }}>F {e.fat}g</Text>
                        </View>
                      </View>
                      <TouchableOpacity onPress={() => removeEntry(e.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Text style={s.del}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              );
            })}
            {logs.length === 0 && activeDate === todayStr() && isNewUser ? (
              <View style={s.empty}>
                <View style={s.plateIllustration}>
                  <View style={s.plateInner}>
                    <View style={s.forkHandle} />
                    <View style={s.forkTine} />
                    <View style={s.forkTine2} />
                  </View>
                </View>
                <Text style={[s.emptyTitle, { color: colors.accent }]}>Log your first meal</Text>
                <Text style={s.emptySub}>Tap the + button below to search foods or scan a barcode</Text>
              </View>
            ) : logs.length === 0 ? (
              <View style={s.empty}>
                <Ionicons name="restaurant-outline" size={40} color={colors.textTertiary} />
                <Text style={s.emptyTitle}>Nothing logged yet</Text>
                <Text style={s.emptySub}>Tap "+ Log Food" above to start tracking your day.</Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Streak detail modal */}
      <Modal visible={showStreakDetail} transparent animationType="fade" onRequestClose={() => setShowStreakDetail(false)}>
        <TouchableOpacity style={s.streakOverlay} activeOpacity={1} onPress={() => setShowStreakDetail(false)}>
          <View style={s.streakCard}>
            <Ionicons name="flame" size={26} color={colors.textTertiary} />
            <Text style={s.streakCardCount}>{getDisplayStreak(streakCount, streakLastDate)}-day streak!</Text>
            <Text style={s.streakCardSub}>Keep logging every day to keep it going.</Text>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Achievement unlocked overlay */}
      {achievementToast && (
        <Animated.View style={[s.achievementOverlay, { opacity: achievementAnim }]} pointerEvents="none">
          <View style={s.achievementCard}>
            <Ionicons name="trophy" size={22} color={colors.textTertiary} />
            <Text style={s.achievementLabel}>Achievement unlocked</Text>
            <Text style={s.achievementName}>{achievementToast}</Text>
          </View>
        </Animated.View>
      )}

      {/* Milestone celebration overlay */}
      <Modal visible={!!streakMilestone} transparent animationType="none" statusBarTranslucent>
        <Animated.View style={[s.milestoneOverlay, { opacity: streakAnim }]}>
          <View style={s.milestoneCard}>
            <Text style={s.milestoneEmoji}>
              {streakMilestone === 7 ? '7 DAYS' : streakMilestone === 30 ? '30 DAYS' : '100 DAYS'}
            </Text>
            <Text style={s.milestoneTitle}>
              {streakMilestone === 7 ? 'One week streak!' : streakMilestone === 30 ? '30-day streak! You\'re on fire.' : '100-day legend!'}
            </Text>
          </View>
        </Animated.View>
      </Modal>

      {tdeeData?.tdee != null && user && (
        <CalorieBurnModal
          visible={showBurnModal}
          onClose={() => setShowBurnModal(false)}
          userId={user.id}
          tdeeData={{ ...tdeeData, caloriesLogged: Math.round(totals.calories) }}
          onTargetUpdated={() => refreshTdee()}
        />
      )}

      <AddFoodModal
        visible={addFoodMeal !== null}
        date={activeDate}
        defaultMeal={addFoodMeal || undefined}
        onClose={() => setAddFoodMeal(null)}
        onOptimisticAdd={addOptimisticEntry}
        onLogFailed={(tempId, message) => rollbackOptimisticEntry(tempId, message)}
        onLogged={async (tempId, real) => {
          confirmOptimisticEntry(tempId, real);
          if (!user) return;
          // The core activation event: a user who never logs food never
          // activates, so this is the number to watch against signups.
          trackOnce(EVENTS.FIRST_FOOD_LOGGED);
          if (health.isAuthorized) refreshTdee();
          // The store-review prompt used to fire here, on the third log of the
          // week. Logging food is a chore — nobody is delighted at the moment
          // they finish keying in a chicken breast — so it was buying 1-star
          // reflexes. It now fires off a race fuel plan instead
          // (screens/RaceFuelScreen.tsx). The weekly count query went with it.
          await refreshStreak();
          await invalidateAchievementsCache(user.id);
          const result = await checkAchievements(user.id, effectiveTargets, { forceRefresh: true });
          if (result.newlyEarned.length > 0) showAchievementToast(result.newlyEarned[0].name);
        }}
      />

      <FoodPhotoModal
        visible={showPhotoModal}
        date={activeDate}
        onClose={() => setShowPhotoModal(false)}
        onLogged={async () => {
          await fetchLogs();
          if (!user) return;
          if (health.isAuthorized) refreshTdee();
          await refreshStreak();
          await invalidateAchievementsCache(user.id);
          const result = await checkAchievements(user.id, effectiveTargets, { forceRefresh: true });
          if (result.newlyEarned.length > 0) showAchievementToast(result.newlyEarned[0].name);
        }}
      />

      <VoiceLogModal
        visible={showVoiceModal}
        date={activeDate}
        initialText={voiceInitialText}
        onClose={() => { setShowVoiceModal(false); setVoiceInitialText(undefined); }}
        onLogged={async () => {
          await fetchLogs();
          if (!user) return;
          if (health.isAuthorized) refreshTdee();
          await refreshStreak();
          await invalidateAchievementsCache(user.id);
          const result = await checkAchievements(user.id, effectiveTargets, { forceRefresh: true });
          if (result.newlyEarned.length > 0) showAchievementToast(result.newlyEarned[0].name);
        }}
      />
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: 28, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    date: { fontSize: 13, color: c.textSecondary, fontWeight: weight.regular, marginTop: 2 },
    streakBadge: { fontSize: 18, fontWeight: weight.heavy },
    streakTeal: { color: c.accent },
    streakAmber: { color: '#F5A623' },
    streakOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
    streakCard: { backgroundColor: c.card, borderRadius: radius.card, padding: 28, alignItems: 'center', marginHorizontal: 32, gap: 8, borderWidth: 1, borderColor: c.border },
    streakCardEmoji: { fontSize: 48, marginBottom: 4 },
    streakCardCount: { fontSize: 22, fontWeight: weight.heavy, color: c.text },
    streakCardSub: { fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 18 },
    milestoneOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', alignItems: 'center', justifyContent: 'center' },
    milestoneCard: { backgroundColor: '#1A1A0A', borderRadius: radius.card, borderWidth: 2, borderColor: '#F5A623', paddingHorizontal: 40, paddingVertical: 32, alignItems: 'center', gap: 12, marginHorizontal: 32 },
    milestoneEmoji: { fontSize: 56 },
    milestoneTitle: { fontSize: 22, fontWeight: weight.heavy, color: '#F5A623', textAlign: 'center', lineHeight: 28 },
    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: 40 },
    dateNav: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
    dateBtn: { backgroundColor: c.card, borderRadius: radius.sm, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    dateBtnDisabled: { opacity: 0.25 },
    dateArrow: { color: c.text, fontSize: 22 },
    dateLabel: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: weight.medium, color: c.text },
    hero: { alignItems: 'center', marginBottom: 28 },
    heroLabel: { fontSize: 11, fontWeight: weight.semibold, color: c.textSecondary, letterSpacing: 2, marginBottom: 6 },
    heroNum: { fontSize: 72, fontWeight: weight.heavy, color: c.text, letterSpacing: -3, lineHeight: 80 },
    heroOver: { color: c.danger },
    heroSub: { fontSize: 13, color: c.textTertiary, marginTop: 6, fontWeight: weight.regular },
    rings: { flexDirection: 'row', gap: 10 },
    periodLabel: { textAlign: 'center', fontSize: 12, color: c.textSecondary, fontWeight: weight.medium, marginTop: 10 },
    dynamicLabel: { textAlign: 'center', fontSize: 12, color: c.accent, fontWeight: weight.medium, marginTop: 10 },
    ringsWrap: { marginBottom: 12 },
    microsBtn: { alignSelf: 'center', marginTop: 8, paddingVertical: 4, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
    microsBtnText: { fontSize: 12, color: c.textSecondary, fontWeight: weight.semibold },
    burnStrip: {
      flexDirection: 'row',
      backgroundColor: c.card,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: 20,
      overflow: 'hidden',
    },
    burnCol: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 14,
      gap: 2,
    },
    burnTopLabel: {
      fontSize: 11,
      color: c.textTertiary,
      fontWeight: weight.semibold,
      letterSpacing: 0.5,
    },
    burnMain: {
      fontSize: 16,
      fontWeight: weight.heavy,
      color: c.text,
      letterSpacing: -0.3,
    },
    burnSub: {
      fontSize: 11,
      color: c.textSecondary,
      fontWeight: weight.medium,
    },
    burnVertDivider: {
      width: 1,
      backgroundColor: c.border,
      marginVertical: 8,
    },
    achievementOverlay: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      alignItems: 'center', justifyContent: 'flex-start', paddingTop: 72,
    },
    achievementCard: {
      backgroundColor: c.card, borderRadius: radius.card, borderWidth: 2,
      borderColor: c.accent, paddingHorizontal: 28, paddingVertical: 16,
      alignItems: 'center', gap: 4, marginHorizontal: 32,
    },
    achievementEmoji: { fontSize: 28 },
    achievementLabel: { fontSize: 12, color: c.textSecondary, fontWeight: weight.medium },
    achievementName: { fontSize: 17, color: c.text, fontWeight: weight.heavy },
    insightCard: {
      flexDirection: 'row', backgroundColor: c.card, borderRadius: radius.card,
      marginBottom: spacing.xl, borderWidth: 1, borderColor: c.border, overflow: 'hidden',
    },
    insightBorder: { width: 4, backgroundColor: c.accent },
    insightContent: { flex: 1, padding: spacing.lg, gap: 8 },
    insightLabel: { fontSize: 11, fontWeight: weight.semibold, color: c.accent, letterSpacing: 1.5 },
    insightText: { fontSize: 14, color: c.text, lineHeight: 20, fontWeight: weight.regular },
    insightDismiss: { fontSize: 12, color: c.textTertiary, fontWeight: weight.semibold },
    addFoodBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 16, alignItems: 'center', marginBottom: 10 },
    addFoodBtnText: { color: c.accentText, fontWeight: weight.bold, fontSize: 15 },
    aiLogRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
    aiLogBtn: { flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.card },
    aiLogBtnText: { color: c.textSecondary, fontWeight: weight.semibold, fontSize: 14 },
    mealSection: { marginBottom: 8 },
    mealSectionEmpty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 4, opacity: 0.6 },
    mealHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
    mealHeader: { fontSize: 11, fontWeight: weight.semibold, color: c.textSecondary, letterSpacing: 1.5, paddingVertical: 10 },
    mealHeaderEmpty: { fontSize: 11, fontWeight: weight.semibold, color: c.textTertiary, letterSpacing: 1.5 },
    mealAdd: { color: c.accent, fontSize: 12, fontWeight: weight.semibold },
    entry: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: radius.md, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: c.border },
    entryInfo: { flex: 1 },
    entryName: { fontSize: 14, fontWeight: weight.medium, color: c.text, marginBottom: 3 },
    entryMacros: { flexDirection: 'row', gap: 8 },
    entryCal: { fontSize: 11, color: c.textSecondary, fontWeight: weight.medium },
    del: { color: c.textTertiary, fontSize: 22, paddingLeft: 12 },
    empty: { alignItems: 'center', paddingVertical: 48, gap: 8 },
    emptyIcon: { fontSize: 40 },
    emptyTitle: { fontSize: 17, fontWeight: weight.bold, color: c.text },
    emptySub: { fontSize: 13, color: c.textTertiary, textAlign: 'center', lineHeight: 20, fontWeight: weight.regular, paddingHorizontal: 32 },
    // First-day illustration
    plateIllustration: {
      width: 88, height: 88, borderRadius: 44,
      backgroundColor: c.accentMuted,
      borderWidth: 2, borderColor: c.accent,
      alignItems: 'center', justifyContent: 'center',
      marginBottom: 4,
    },
    plateInner: { alignItems: 'center', justifyContent: 'center', position: 'relative', width: 40, height: 52 },
    forkHandle: { position: 'absolute', bottom: 0, left: 18, width: 4, height: 32, borderRadius: 2, backgroundColor: c.accent },
    forkTine:  { position: 'absolute', top: 0, left: 10, width: 3,  height: 18, borderRadius: 1.5, backgroundColor: c.accent },
    forkTine2: { position: 'absolute', top: 0, left: 18, width: 3,  height: 18, borderRadius: 1.5, backgroundColor: c.accent },
  });
}
