import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../constants/supabase';
import { useAuth } from '../hooks/useAuth';
import { MC } from '../constants/data';
import { callAI } from '../constants/ai';
import { parseMealPlanResponse, validateMealPlan, summarizeIssues, correctionFor } from '../utils/validateMealPlan';
import { logError } from '../utils/logError';
import { getSportProfile } from '../constants/sportProfiles';
import PaywallScreen from './PaywallScreen';
import GroceryListScreen from './GroceryListScreen';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import { toLocalDateString } from '../utils/dateUtils';
import { requireAIAccess } from '../utils/proGate';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

function getMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return toLocalDateString(d);
}

function todayStr() { return toLocalDateString(); }

interface MealItem {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving?: string;
}

interface DayPlan {
  day: string;
  meals: {
    meal: string;
    items: MealItem[];
    totals: { calories: number; protein: number; carbs: number; fat: number };
  }[];
  totals: { calories: number; protein: number; carbs: number; fat: number };
}

export default function MealPlanScreen({ targets, profile }: {
  targets: { calories: number; protein: number; carbs: number; fat: number };
  profile: any;
}) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { user } = useAuth();
  const [plan, setPlan] = useState<DayPlan[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [activeDay, setActiveDay] = useState(0);
  const [logModal, setLogModal] = useState<{ meal: string; items: MealItem[] } | null>(null);
  const [logging, setLogging] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [savedPlans, setSavedPlans] = useState<{ week_start: string; plan: DayPlan[] }[]>([]);
  const [showSavedPlans, setShowSavedPlans] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [showGrocery, setShowGrocery] = useState(false);
  // A generation can run ~35s per chunk plus one corrected retry. Until now the
  // only exit from that spinner was force-quitting the app — the single highest
  // -probability churn moment on a trial user's first plan, and a clean
  // Guideline 2.1 finding if a reviewer hits it on bad hotel wifi.
  //
  // A run TOKEN, not a boolean: the council confirmed that a shared
  // cancelled flag reset at the top of each run resurrects a cancelled run's
  // continuations — cancel, tap Generate again, and the OLD run's chunks (still
  // in flight, never aborted) pass the guards, overwrite the new run's plan,
  // and dismiss its spinner. Each run captures its own token; Cancel and every
  // new run bump the counter, so a stale run can never pass a guard again.
  const genRunRef = useRef(0);
  const weekStart = getMonday();

  const fetchExisting = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.from('meal_plans')
      .select('*').eq('user_id', user.id).eq('week_start', weekStart)
      .order('created_at', { ascending: false }).limit(1);
    console.log('fetchExisting:', JSON.stringify({ count: data?.length, error: error?.message, weekStart }));
    if (data?.[0]?.plan) setPlan(data[0].plan);

    const { data: allPlans } = await supabase.from('meal_plans')
      .select('week_start, plan')
      .eq('user_id', user.id)
      .order('week_start', { ascending: false })
      .limit(10);
    setSavedPlans((allPlans ?? []).filter((p: any) => p.week_start !== weekStart));

    setLoadingExisting(false);
  }, [user, weekStart]);

  useEffect(() => { fetchExisting(); }, [fetchExisting]);

  const generatePlan = async () => {
    const gate = await requireAIAccess('meal_plan');
    if (!gate.allowed) { setShowPaywall(true); return; }

    const myRun = ++genRunRef.current;
    const isStale = () => genRunRef.current !== myRun;
    setLoading(true);
    try {
      const { data: pantryFoods } = await supabase
        .from('user_foods').select('*').eq('user_id', user!.id);

      const pantryList = pantryFoods && pantryFoods.length > 0
        ? pantryFoods.map((f: any) => `${f.name} (${f.serving_size || 'per serving'}: ${f.calories}cal, P${f.protein}g, C${f.carbs}g, F${f.fat}g)`).join('\n')
        : 'No pantry foods — use common healthy foods';

      const sport = getSportProfile(profile?.sport);

      // NOTE: we deliberately do NOT subtract what the user has already eaten
      // today. This used to append a "you've already logged 1,240cal, plan the
      // remaining gap" instruction — which directly contradicted the validator,
      // since validateMealPlan checks EVERY one of the seven days against the
      // full daily target and treats a >25% miss as fatal. The model obeyed the
      // instruction, shrank the days, and the plan was then rejected for being
      // exactly what it was told to be. Both retries failed and the user got
      // "Could not generate a valid meal plan" (Sentry: MealPlan.invalid,
      // 7 fatal on build 153).
      //
      // A 7-day plan is a template. What you happened to eat this morning
      // belongs in a "what should I eat for the rest of today" flow, against
      // today's remaining macros — not smeared across next week.
      // Build once, shared by every chunk prompt. Pre-dividing the day into
      // per-meal calorie budgets is what fixed macro adherence in the Aug 24
      // harness: without it the model under-filled days by up to 35%.
      const mealBudgetLines = (() => {
        const b = Math.round(targets.calories * 0.25);
        const l = Math.round(targets.calories * 0.30);
        const d = Math.round(targets.calories * 0.30);
        const s = targets.calories - b - l - d;
        return `Meal calorie budgets EVERY day (each meal within 10% of its budget): Breakfast ${b}, Lunch ${l}, Dinner ${d}, Snack ${s}.
Protein per day: land between ${Math.round(targets.protein * 0.9)}g and ${Math.round(targets.protein * 1.1)}g — never below ${Math.round(targets.protein * 0.9)}g, never above ${Math.round(targets.protein * 1.1)}g; roughly ${Math.round(targets.protein / 4)}g per meal.`;
      })();

      const chunkPrompt = (days: string[]) => `Create a meal plan for these ${days.length} days ONLY: ${days.join(', ')} — as a JSON array with exactly ${days.length} objects. Daily targets: ${targets.calories}cal, ${targets.protein}g protein, ${targets.carbs}g carbs, ${targets.fat}g fat.
${mealBudgetLines}

ATHLETE CONTEXT:
- Sport: ${sport.label}
- Nutrition focus: ${sport.nutritionFocus}
- Meal timing guidance: ${sport.mealTiming}

Pantry: ${pantryList}
Fill gaps with: chicken, rice, eggs, oats, Greek yogurt, vegetables, whey protein.

RULES:
- Apply sport-specific nutrition principles: ${sport.nutritionFocus}
- Time meals appropriately: ${sport.mealTiming}
- Choose foods that support ${sport.trainingFocus}
- VARIETY: use at least 3 different dinner bases and 2 different breakfast bases across these days, and never repeat the same lunch or dinner main on consecutive days. Daily protein staples (Greek yogurt, whey, eggs, cottage cheese) MAY repeat — hitting the protein floor beats variety.
- Output ONLY a raw JSON array (no markdown). Each day: EXACTLY 4 meals named Breakfast, Lunch, Dinner, Snack. 1 to 3 items per meal, never more. Short names. Hit macro targets.

Format: [{"day":"${days[0]}","meals":[{"meal":"Breakfast","items":[{"name":"Oats","serving":"1 cup dry","calories":300,"protein":10,"carbs":54,"fat":6}],"totals":{"calories":300,"protein":10,"carbs":54,"fat":6}}],"totals":{"calories":${targets.calories},"protein":${targets.protein},"carbs":${targets.carbs},"fat":${targets.fat}}}]
Complete all ${days.length} days. Valid JSON only.`;

      // Three parallel chunks instead of one 7-day request. Measured against
      // the production proxy (Aug 24 night harness, seeded test account): a
      // single 7-day call ran 30-55s on either model — hard against the iOS
      // ~60s fetch ceiling, and 3/3 failures in the Aug 20 logs — while 3-way
      // chunks ran ~16-20s wall with tighter macro adherence. 'smart' (sonnet)
      // because haiku missed the vegetarian protein floor in 4/4 harness runs
      // and sonnet chunk latency is within ~2s of haiku's (time-to-first-token
      // dominates small outputs). Each chunk gets a 35s race and one corrected
      // retry (25s aborted routine daytime-load chunks: business-hours walls
      // measured 20-25s from a datacenter, so LTE would trip it), and one slow
      // chunk (a 98s proxy-side upstream retry was observed once) cannot sink
      // the whole plan.
      const CHUNK_DAYS: string[][] = [
        ['Monday', 'Tuesday', 'Wednesday'],
        ['Thursday', 'Friday'],
        ['Saturday', 'Sunday'],
      ];

      const genChunk = async (days: string[]): Promise<DayPlan[]> => {
        let correction = '';
        let summary = '';
        for (let attempt = 1; attempt <= 2; attempt++) {
          let rawText: string;
          try {
            rawText = await Promise.race([
              callAI([{ role: 'user', content: chunkPrompt(days) + correction }], undefined, 4096, 'cloud', 'smart'),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error('chunk timed out after 35s')), 35_000)),
            ]);
          } catch (e) {
            summary = (e as Error)?.message ?? 'chunk request failed';
            logError('MealPlan.chunk', e, { days: days.join(','), attempt });
            correction = '';
            continue;
          }
          const candidate = parseMealPlanResponse(rawText);
          if (!candidate) {
            summary = 'unparseable or truncated response';
            logError('MealPlan.parse', new Error(summary), { attempt, days: days.join(','), len: rawText.length });
            correction = '';
            continue;
          }
          const result = validateMealPlan(candidate, targets, { expectedDays: days.length });
          if (result.ok) {
            if (result.issues.length) {
              logError('MealPlan.warnings', new Error(summarizeIssues(result)), { attempt, days: days.join(',') });
            }
            return result.repaired as DayPlan[];
          }
          summary = summarizeIssues(result);
          logError('MealPlan.invalid', new Error(summary), { attempt, days: days.join(',') });
          correction = correctionFor(result);
        }
        throw new Error(`${days.join(', ')}: ${summary}`);
      };

      // All three in flight together; wall time = slowest chunk, not the sum.
      const chunkResults = await Promise.all(CHUNK_DAYS.map(genChunk));
      const combined = ([] as DayPlan[]).concat(...chunkResults);

      // Belt and braces on the stitched week: pure function, costs nothing,
      // and the saved plan passes the exact same 7-day gate as before.
      const finalResult = validateMealPlan(combined, targets);
      if (!finalResult.ok) {
        throw new Error(`Could not generate a valid meal plan (${summarizeIssues(finalResult)})`);
      }
      const parsed = finalResult.repaired as DayPlan[];

      // Cancelled or superseded mid-flight: the chunks still resolved, but this
      // run is no longer the one on screen. Don't save, don't render, don't
      // alert — just stand down.
      if (isStale()) return;

      const { error: saveError } = await supabase.from('meal_plans').upsert({
        user_id: user!.id,
        week_start: weekStart,
        plan: parsed,
      }, { onConflict: 'user_id,week_start' });
      console.log('Save result:', saveError?.message || 'success');

      setPlan(parsed);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 3000);
      // Refresh saved plans list (exclude current week)
      const { data: allPlans } = await supabase.from('meal_plans')
        .select('week_start, plan').eq('user_id', user!.id)
        .order('week_start', { ascending: false }).limit(10);
      setSavedPlans((allPlans ?? []).filter((p: any) => p.week_start !== weekStart));
    } catch (e) {
      // This catch used to console.error only. Every failure that wasn't a
      // validator rejection — a dead AI proxy, a network drop, a Supabase
      // write error — showed the user this alert and left no trace in Sentry,
      // so the only symptom reaching us was a one-star review.
      if (isStale()) return;
      logError('MealPlan.generate', e);
      Alert.alert('Error', 'Could not generate meal plan. Please try again.');
    } finally {
      // Only the run that owns the spinner may dismiss it — a cancelled run
      // settling late must not kill a newer run's loading state.
      if (!isStale()) setLoading(false);
    }
  };

  const logMeal = async () => {
    if (!logModal) return;
    setLogging(true);
    const date = todayStr();
    const entries = logModal.items.map((item: MealItem) => ({
      user_id: user!.id,
      date,
      meal: logModal.meal,
      food: item.name,
      qty: 1,
      calories: Math.round(item.calories),
      protein: Math.round(item.protein * 10) / 10,
      carbs: Math.round(item.carbs * 10) / 10,
      fat: Math.round(item.fat * 10) / 10,
    }));
    // Check the insert. "✓ Logged!" over a failed write meant an offline or
    // expired-session tap lost the meal with full success UX.
    const { error: insertError } = await supabase.from('macro_logs').insert(entries);
    setLogging(false);
    if (insertError) {
      logError('MealPlan.logMeal', insertError);
      Alert.alert('Not logged', 'Could not add this meal — check your connection and try again.');
      return;
    }
    setLogModal(null);
    Alert.alert('✓ Logged!', `${logModal.meal} added to today's log.`);
  };

  const dayPlan = plan?.[activeDay];

  if (loadingExisting) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.center}><ActivityIndicator color={colors.text} size="large" /></View>
      </SafeAreaView>
    );
  }

  if (showGrocery) {
    return <GroceryListScreen plan={plan} onBack={() => setShowGrocery(false)} />;
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
        <PaywallScreen
          onClose={() => setShowPaywall(false)}
          onUnlock={() => { setShowPaywall(false); generatePlan(); }}
        />
      </Modal>

      <View style={s.header}>
        <Text style={s.title}>Meal Plan</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {savedMsg && <Text style={s.savedMsg}>Saved ✓</Text>}
          {plan && (
            <TouchableOpacity style={s.groceryBtn} onPress={() => setShowGrocery(true)} activeOpacity={0.8}>
              <Ionicons name="cart-outline" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.genBtn} onPress={generatePlan} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.accentText} size="small" /> : <Text style={s.genBtnText}>Generate Week</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {!plan && !loading && (
        <View style={s.empty}>
          <Ionicons name="restaurant-outline" size={40} color={colors.textTertiary} />
          <Text style={s.emptyTitle}>No meal plan yet</Text>
          <Text style={s.emptySub}>Tap "Generate Week" and AI will build{'\n'}a full 7-day plan hitting your macros.</Text>
          <TouchableOpacity style={s.genBtnLarge} onPress={generatePlan} disabled={loading}>
            <Text style={s.genBtnLargeText}>Generate My Week</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && (
        <View style={s.center}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={s.loadingText}>Building your 7-day plan…{'\n'}This usually takes about 20 seconds.</Text>
          <TouchableOpacity
            style={s.cancelGenBtn}
            onPress={() => { genRunRef.current++; setLoading(false); }}
            accessibilityRole="button"
            accessibilityLabel="Cancel meal plan generation">
            <Text style={s.cancelGenText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {plan && !loading && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.dayPicker} contentContainerStyle={s.dayPickerContent}>
            {DAYS.map((day, i) => (
              <TouchableOpacity key={day} style={[s.dayChip, activeDay === i && s.dayChipActive]} onPress={() => setActiveDay(i)}>
                <Text style={[s.dayChipText, activeDay === i && s.dayChipTextActive]}>{day.slice(0, 3)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            {savedPlans.length > 0 && (
              <View style={s.savedPlansSection}>
                <TouchableOpacity style={s.savedPlansHeader} onPress={() => setShowSavedPlans(v => !v)}>
                  <Text style={s.savedPlansTitle}>Saved Plans</Text>
                  <Text style={s.savedPlansChevron}>{showSavedPlans ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                {showSavedPlans && savedPlans.map((sp) => {
                  const weekOf = new Date(sp.week_start + 'T12:00:00');
                  const label = weekOf.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  return (
                    <TouchableOpacity
                      key={sp.week_start}
                      style={s.savedPlanRow}
                      onPress={() => { setPlan(sp.plan); setActiveDay(0); }}
                    >
                      <Text style={s.savedPlanLabel}>Week of {label}</Text>
                      <Text style={s.savedPlanArrow}>›</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            {dayPlan && (
              <>
                <View style={s.dayTotals}>
                  <Text style={s.dayTotalsTitle}>{dayPlan.day}</Text>
                  <View style={s.macroRow}>
                    <View style={s.macroItem}>
                      <Text style={s.macroVal}>{Math.round(dayPlan.totals?.calories || 0)}</Text>
                      <Text style={s.macroLabel}>Cal</Text>
                    </View>
                    <View style={s.macroItem}>
                      <Text style={[s.macroVal, { color: MC.protein.color }]}>{Math.round(dayPlan.totals?.protein || 0)}g</Text>
                      <Text style={s.macroLabel}>Protein</Text>
                    </View>
                    <View style={s.macroItem}>
                      <Text style={[s.macroVal, { color: MC.carbs.color }]}>{Math.round(dayPlan.totals?.carbs || 0)}g</Text>
                      <Text style={s.macroLabel}>Carbs</Text>
                    </View>
                    <View style={s.macroItem}>
                      <Text style={[s.macroVal, { color: MC.fat.color }]}>{Math.round(dayPlan.totals?.fat || 0)}g</Text>
                      <Text style={s.macroLabel}>Fat</Text>
                    </View>
                  </View>
                  {(['calories', 'protein', 'carbs', 'fat'] as const).map(key => {
                    const val = dayPlan.totals?.[key] || 0;
                    const target = targets[key];
                    const pct = Math.min(100, Math.round(val / (target || 1) * 100));
                    const color = key === 'calories' ? colors.text : MC[key as keyof typeof MC]?.color || colors.text;
                    return (
                      <View key={key} style={s.targetBar}>
                        <View style={s.targetBarBg}>
                          <View style={[s.targetBarFill, { width: `${pct}%` as any, backgroundColor: color }]} />
                        </View>
                        <Text style={s.targetBarPct}>{pct}%</Text>
                      </View>
                    );
                  })}
                </View>

                {dayPlan.meals?.map((mealGroup, mi) => (
                  <View key={mi} style={s.mealCard}>
                    <View style={s.mealCardHeader}>
                      <Text style={s.mealName}>{mealGroup.meal}</Text>
                      <View style={s.mealMacros}>
                        <Text style={s.mealCal}>{Math.round(mealGroup.totals?.calories || 0)} cal</Text>
                        <Text style={[s.mealMacro, { color: MC.protein.color }]}>P{Math.round(mealGroup.totals?.protein || 0)}</Text>
                        <Text style={[s.mealMacro, { color: MC.carbs.color }]}>C{Math.round(mealGroup.totals?.carbs || 0)}</Text>
                        <Text style={[s.mealMacro, { color: MC.fat.color }]}>F{Math.round(mealGroup.totals?.fat || 0)}</Text>
                      </View>
                    </View>
                    {mealGroup.items?.map((item, ii) => (
                      <View key={ii} style={s.foodItem}>
                        <View style={s.foodItemInfo}>
                          <Text style={s.foodItemName}>{item.name}</Text>
                          {item.serving && <Text style={s.foodItemServing}>{item.serving}</Text>}
                        </View>
                        <Text style={s.foodItemCal}>{Math.round(item.calories)} cal</Text>
                      </View>
                    ))}
                    <TouchableOpacity style={s.logBtn} onPress={() => setLogModal({ meal: mealGroup.meal, items: mealGroup.items })}>
                      <Text style={s.logBtnText}>+ Log to Today</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </>
      )}

      <Modal visible={!!logModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLogModal(null)}>
        <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
          <View style={s.handle} />
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Log {logModal?.meal}</Text>
            <TouchableOpacity style={s.modalClose} onPress={() => setLogModal(null)}>
              <Text style={s.modalCloseText}>×</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1, paddingHorizontal: 20 }}>
            <Text style={s.modalSub}>These items will be added to today's log:</Text>
            {logModal?.items.map((item, i) => (
              <View key={i} style={s.modalItem}>
                <View style={{ flex: 1 }}>
                  <Text style={s.modalItemName}>{item.name}</Text>
                  {item.serving && <Text style={s.modalItemServing}>{item.serving}</Text>}
                </View>
                <View style={s.modalItemMacros}>
                  <Text style={s.modalItemCal}>{Math.round(item.calories)} cal</Text>
                  <Text style={[s.modalItemMacro, { color: MC.protein.color }]}>P{Math.round(item.protein)}g</Text>
                  <Text style={[s.modalItemMacro, { color: MC.carbs.color }]}>C{Math.round(item.carbs)}g</Text>
                  <Text style={[s.modalItemMacro, { color: MC.fat.color }]}>F{Math.round(item.fat)}g</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={{ padding: 20 }}>
            <TouchableOpacity style={s.confirmBtn} onPress={logMeal} disabled={logging}>
              {logging ? <ActivityIndicator color={colors.accentText} /> : <Text style={s.confirmBtnText}>Log to Today</Text>}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
    title: { fontSize: 28, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    genBtn: { backgroundColor: c.accent, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, minWidth: 44, alignItems: 'center' },
    genBtnText: { color: c.accentText, fontSize: 13, fontWeight: weight.heavy },
    groceryBtn: { backgroundColor: c.card, borderRadius: radius.pill, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
    groceryBtnText: { fontSize: 18 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
    emptyIcon: { fontSize: 56 },
    emptyTitle: { fontSize: 22, fontWeight: weight.heavy, color: c.text },
    emptySub: { fontSize: 14, color: c.textTertiary, textAlign: 'center', lineHeight: 22, fontWeight: weight.medium },
    genBtnLarge: { backgroundColor: c.accent, borderRadius: radius.card, paddingHorizontal: 24, paddingVertical: 16, marginTop: 12 },
    genBtnLargeText: { color: c.accentText, fontSize: 16, fontWeight: weight.heavy },
    cancelGenBtn: { marginTop: 20, paddingVertical: 10, paddingHorizontal: 24 },
    cancelGenText: { color: c.textSecondary, fontSize: 15, fontWeight: '600' },
    loadingText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', lineHeight: 24, fontWeight: weight.medium, marginTop: 12 },
    dayPicker: { maxHeight: 52, borderBottomWidth: 1, borderBottomColor: c.border },
    dayPickerContent: { paddingHorizontal: spacing.lg, paddingVertical: 10, gap: 8 },
    dayChip: { backgroundColor: c.card, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 6, borderWidth: 1, borderColor: c.border },
    dayChipActive: { backgroundColor: c.accent, borderColor: c.accent },
    dayChipText: { color: c.textTertiary, fontSize: 13, fontWeight: weight.bold },
    dayChipTextActive: { color: c.accentText },
    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: 40 },
    dayTotals: { backgroundColor: c.card, borderRadius: radius.card, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: c.border },
    dayTotalsTitle: { fontSize: 18, fontWeight: weight.heavy, color: c.text, marginBottom: 14, letterSpacing: -0.5 },
    macroRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
    macroItem: { alignItems: 'center' },
    macroVal: { fontSize: 20, fontWeight: weight.heavy, color: c.text },
    macroLabel: { fontSize: 10, color: c.textTertiary, fontWeight: weight.semibold, marginTop: 2 },
    targetBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    targetBarBg: { flex: 1, backgroundColor: c.border, borderRadius: 3, height: 3 },
    targetBarFill: { height: 3, borderRadius: 3 },
    targetBarPct: { fontSize: 10, color: c.textTertiary, fontWeight: weight.bold, width: 32, textAlign: 'right' },
    mealCard: { backgroundColor: c.card, borderRadius: radius.card, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    mealCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    mealName: { fontSize: 16, fontWeight: weight.heavy, color: c.text },
    mealMacros: { flexDirection: 'row', gap: 6 },
    mealCal: { fontSize: 11, color: c.textTertiary, fontWeight: weight.semibold },
    mealMacro: { fontSize: 11, fontWeight: weight.bold },
    foodItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border },
    foodItemInfo: { flex: 1 },
    foodItemName: { fontSize: 14, fontWeight: weight.semibold, color: c.text },
    foodItemServing: { fontSize: 11, color: c.textTertiary, fontWeight: weight.medium, marginTop: 2 },
    foodItemCal: { fontSize: 12, color: c.textTertiary, fontWeight: weight.semibold },
    logBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 10, alignItems: 'center', marginTop: 12 },
    logBtnText: { color: c.accentText, fontSize: 13, fontWeight: weight.bold },
    modalSafe: { flex: 1, backgroundColor: c.card },
    handle: { width: 36, height: 4, backgroundColor: c.border, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 20 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 8 },
    modalTitle: { fontSize: 22, fontWeight: weight.heavy, color: c.text },
    modalClose: { backgroundColor: c.cardAlt, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    modalCloseText: { color: c.textSecondary, fontSize: 20, lineHeight: 22 },
    modalSub: { fontSize: 13, color: c.textTertiary, fontWeight: weight.medium, marginBottom: 16 },
    modalItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.cardAlt, borderRadius: radius.md, padding: 12, marginBottom: 8 },
    modalItemName: { fontSize: 14, fontWeight: weight.bold, color: c.text, marginBottom: 2 },
    modalItemServing: { fontSize: 11, color: c.textTertiary, fontWeight: weight.medium },
    modalItemMacros: { alignItems: 'flex-end', gap: 2 },
    modalItemCal: { fontSize: 12, color: c.textTertiary, fontWeight: weight.semibold },
    modalItemMacro: { fontSize: 11, fontWeight: weight.bold },
    confirmBtn: { backgroundColor: c.accent, borderRadius: radius.md, padding: 16, alignItems: 'center' },
    confirmBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.heavy },
    savedMsg: { fontSize: 12, color: c.accent, fontWeight: weight.bold },
    savedPlansSection: { backgroundColor: c.card, borderRadius: radius.card, borderWidth: 1, borderColor: c.border, marginBottom: spacing.lg, overflow: 'hidden' },
    savedPlansHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg },
    savedPlansTitle: { fontSize: 13, fontWeight: weight.bold, color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },
    savedPlansChevron: { fontSize: 11, color: c.textTertiary },
    savedPlanRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.border },
    savedPlanLabel: { fontSize: 14, color: c.text, fontWeight: weight.medium },
    savedPlanArrow: { fontSize: 18, color: c.textTertiary },
  });
}
