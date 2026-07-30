import React, { useState, useRef, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  KeyboardAvoidingView, Platform, Linking, Modal, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callCoachAI } from '../utils/coachAI';
import { getSportProfile } from '../constants/sportProfiles';
import PaywallScreen from './PaywallScreen';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import SkeletonBox from '../components/SkeletonBox';
import { useAuth } from '../hooks/useAuth';
import { buildCoachContext } from '../utils/buildCoachContext';
import { logError } from '../utils/logError';
import { track, EVENTS } from '../utils/analytics';
import { requireAIAccess } from '../utils/proGate';
import { publishTodaySessions } from '../utils/sessionMapping';
import { toLocalDateString } from '../utils/dateUtils';
// useHealthKit directly, not useHealth — `getWorkoutHistory` exists only on
// the HealthKit hook, not the Health Connect one, so `useHealth()`'s union
// type doesn't expose it. WorkoutScreen does the same. Android therefore has
// no session history yet; the endurance briefing degrades to everything
// except today's training until Health Connect grows a workouts reader.
import { useHealthKit, STORAGE_PREFERRED_TRACKER, buildSourcePrefs } from '../hooks/useHealthKit';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  source?: 'local' | 'cloud';
}

interface YoutubeLink {
  title: string;
  url: string;
}

const HISTORY_KEY = 'fuelog_coach_history';
const MAX_HISTORY = 50;

const CHIP_SUGGESTIONS = [
  "How's my protein intake?",
  'What should I eat post-workout?',
  'Analyze my recovery trends',
  'Help me hit my macro goals',
];

function extractLinks(text: string): { clean: string; links: YoutubeLink[] } {
  const links: YoutubeLink[] = [];
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[2].includes('youtube.com') || match[2].includes('youtu.be')) {
      links.push({ title: match[1], url: match[2] });
    }
  }
  const clean = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '$1');
  return { clean, links };
}

function buildSystemPrompt(profile?: any): string {
  const sport = getSportProfile(profile?.sport);
  const goal = profile?.goal === 'lose' ? 'fat loss' : profile?.goal === 'gain' ? 'muscle gain' : 'maintenance';
  return `You are an expert personal trainer and strength coach AI assistant built into a fitness app called Fuelog.

ATHLETE PROFILE:
- Sport / Training style: ${sport.label}
- Goal: ${goal}
- Training focus: ${sport.trainingFocus}
- Key physical qualities to develop: ${sport.keyQualities.join(', ')}

${sport.coachingContext}

You help users with:
- Exercise form and technique specific to their sport and goals
- How to perform specific lifts and movements safely
- Training programming and periodisation advice
- Injury prevention relevant to their sport
- Sport-specific conditioning and performance questions

When explaining exercises, always cover: setup/starting position, execution, common mistakes, and key cues.

When relevant, include YouTube links to reputable coaches in markdown format like [Video Title](youtube_url). Use channels like Alan Thrall, Jeff Nippard, Renaissance Periodization, Athlean-X, or Starting Strength for reference videos. Only include real, well-known videos you're confident exist.

Keep responses concise but thorough. Use short paragraphs. Be encouraging and practical. Always tailor advice to the user's sport and goals.`;
}

function TypingIndicator({ colors, s }: { colors: ThemeColors; s: ReturnType<typeof makeStyles> }) {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const CYCLE = 900;
    const makeLoop = (dot: Animated.Value, phase: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(phase),
          Animated.timing(dot, { toValue: 1.0, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          Animated.delay(CYCLE - 600 - phase),
        ])
      );
    const a1 = makeLoop(dot1, 0);
    const a2 = makeLoop(dot2, 150);
    const a3 = makeLoop(dot3, 300);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []);

  return (
    <View style={s.msgWrap}>
      <Text style={s.aiLabel}>FUELOG AI</Text>
      <View style={[s.bubble, s.bubbleAssistant]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 4 }}>
          {[dot1, dot2, dot3].map((dot, i) => (
            <Animated.View
              key={i}
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textSecondary, opacity: dot }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

export default function CoachScreen({ initialExercise, profile }: { initialExercise?: string; profile?: any }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const { user } = useAuth();
  const health = useHealthKit();

  const defaultGreeting: Message = {
    role: 'assistant',
    content: initialExercise
      ? `Hey! Let's talk about the **${initialExercise}**. I'll break down the form, key cues, and common mistakes. What would you like to know?`
      : `Hey! I'm your AI coach.\n\nAsk me anything — how to do a lift, form tips, what muscles an exercise targets, programming questions, or anything else fitness related.\n\nWhat's on your mind?`,
  };

  const [messages, setMessages] = useState<Message[]>([defaultGreeting]);
  const [input, setInput] = useState(initialExercise ? `How do I do the ${initialExercise} properly?` : '');
  const [loading, setLoading] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showChips, setShowChips] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(!initialExercise);
  const [coachContext, setCoachContext] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const pendingMessageRef = useRef<string | null>(null);
  const paywallMessageRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (initialExercise) {
      setTimeout(() => sendMessage(`How do I do the ${initialExercise} properly?`), 500);
      return;
    }
    (async () => {
      // Check if this session was opened by tapping a proactive notification
      try {
        const fromProactive = await AsyncStorage.getItem('fuelog_coach_from_proactive');
        if (fromProactive === '1') {
          await AsyncStorage.removeItem('fuelog_coach_from_proactive');
          const ctxRaw = await AsyncStorage.getItem('fuelog_proactive_notif_context');
          if (ctxRaw) {
            const { body } = JSON.parse(ctxRaw);
            setMessages([{ role: 'assistant', content: body }]);
            setHistoryLoading(false);
            return;
          }
        }
      } catch (e) { logError('CoachScreen.CoachScreen', e); }

      try {
        const historyStr = await AsyncStorage.getItem(HISTORY_KEY);

        let restored = 0;
        if (historyStr) {
          const parsed: Message[] = JSON.parse(historyStr);
          if (parsed.length > 0) { setMessages(parsed); restored = parsed.length; }
        }

        // Suggestion chips are for first-time users. This used to key off the
        // AsyncStorage message counter, which now lives server-side and is never
        // written here — so it would have read 0 forever and shown chips to
        // everyone. Conversation history is the better signal anyway.
        const hasChatted = restored > 1 || (restored === 1 && messages[0]?.role === 'user');
        if (!hasChatted) setShowChips(true);
      } catch (e) { logError('CoachScreen.CoachScreen', e); }
      setHistoryLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      // Refresh today's sessions BEFORE building the context.
      //
      // Targets are computed from completed training, so they're only right if
      // the wearable's numbers have landed first. Previously sessions were only
      // published when the Workout tab mounted — an athlete who rode, then went
      // straight to the Coach, got a briefing that thought they hadn't trained,
      // and therefore a rest-day carbohydrate target on a five-hour day.
      //
      // getWorkoutHistory only exists on the hook, so this has to happen in a
      // component. Fails soft: a stale or missing cache costs today's detail,
      // never the conversation.
      try {
        if (health.isAuthorized) {
          const tracker = await AsyncStorage.getItem(STORAGE_PREFERRED_TRACKER);
          // Bounded: a HealthKit read that never resolves would otherwise hang
          // this whole effect and the Coach would load with NO context at all —
          // trading a little session detail for the entire briefing. Native
          // HealthKit calls have no built-in timeout and iOS betas have hung
          // them before, so the race is not theoretical.
          const workouts = await Promise.race([
            health.getWorkoutHistory(2, buildSourcePrefs(tracker)),
            new Promise<[]>((res) => setTimeout(() => res([]), 4000)),
          ]);
          if (Array.isArray(workouts) && workouts.length) {
            await publishTodaySessions(workouts as any, toLocalDateString(new Date()));
          }
        }
      } catch (e) { logError('CoachScreen.refreshSessions', e); }

      buildCoachContext(user.id).then(setCoachContext).catch(() => {});
    })();
  }, [user?.id]);

  const saveHistory = (msgs: Message[]) => {
    const trimmed = msgs.slice(-MAX_HISTORY);
    AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed)).catch(() => {});
  };

  const clearHistory = () => {
    setMessages([defaultGreeting]);
    setShowChips(false);
    AsyncStorage.removeItem(HISTORY_KEY).catch(() => {});
  };

  const sendMessage = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText) return;

    track(EVENTS.COACH_MESSAGE_SENT);

    // Server-side gate: checks Pro, then consumes one free trial use.
    // Replaces the old AsyncStorage counter, which reset on reinstall.
    const gate = await requireAIAccess('coach');
    if (!gate.allowed) {
      pendingMessageRef.current = messageText;
      paywallMessageRef.current = gate.message ?? 'Upgrade to Pro for unlimited coaching.';
      setShowPaywall(true);
      return;
    }

    setShowChips(false);
    const userMsg: Message = { role: 'user', content: messageText };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    scrollRef.current?.scrollToEnd({ animated: true });

    try {
      const systemPrompt = coachContext
        ? `${coachContext}\n\n---\n\n${buildSystemPrompt(profile)}`
        : buildSystemPrompt(profile);
      const { text: reply, source } = await callCoachAI(
        newMessages.map(m => ({ role: m.role, content: m.content })),
        systemPrompt,
        1000
      );
      const finalMessages = [...newMessages, { role: 'assistant' as const, content: reply || 'Sorry, I could not get a response.', source }];
      setMessages(finalMessages);
      saveHistory(finalMessages);
    } catch {
      const errMessages = [...newMessages, { role: 'assistant' as const, content: 'Connection error — please try again.' }];
      setMessages(errMessages);
      saveHistory(errMessages);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const renderMessage = (msg: Message, i: number) => {
    const isUser = msg.role === 'user';
    const { clean, links } = extractLinks(msg.content);
    const parts = clean.split(/\*\*([^*]+)\*\*/g);

    return (
      <View key={i} style={[s.msgWrap, isUser && s.msgWrapUser]}>
        {!isUser && (
          <Text style={s.aiLabel}>
            FUELOG AI{msg.source === 'local' ? ' · LOCAL' : ''}
          </Text>
        )}
        <View style={[s.bubble, isUser ? s.bubbleUser : s.bubbleAssistant]}>
          <Text style={[s.bubbleText, isUser && s.bubbleTextUser]}>
            {parts.map((part, pi) =>
              pi % 2 === 1
                ? <Text key={pi} style={s.bold}>{part}</Text>
                : part
            )}
          </Text>
          {links.map((link, li) => (
            <TouchableOpacity key={li} style={s.ytLink} onPress={() => Linking.openURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(link.title)}`)}>
              <Text style={s.ytIcon}>▶</Text>
              <Text style={s.ytTitle} numberOfLines={1}>{link.title}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Modal visible={showPaywall} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
        <PaywallScreen
          onClose={() => setShowPaywall(false)}
          trialMessage={paywallMessageRef.current}
          onUnlock={() => {
            setShowPaywall(false);
            paywallMessageRef.current = undefined;
            const pending = pendingMessageRef.current;
            pendingMessageRef.current = null;
            if (pending) sendMessage(pending);
          }}
        />
      </Modal>

      <View style={s.header}>
        <View>
          <Text style={s.title}>AI Coach</Text>
          <Text style={s.subtitle}>Powered by AI</Text>
        </View>
        <TouchableOpacity
          style={s.clearBtn}
          onPress={clearHistory}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Clear conversation"
          accessibilityHint="Deletes your chat history with the Coach">
          <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.flex} keyboardVerticalOffset={0}>
        {historyLoading ? (
          <View style={s.historySkeleton}>
            <View style={s.msgWrap}>
              <SkeletonBox width="70%" height={52} borderRadius={radius.lg} />
            </View>
            <View style={[s.msgWrap, s.msgWrapUser]}>
              <SkeletonBox width="55%" height={36} borderRadius={radius.lg} />
            </View>
            <View style={s.msgWrap}>
              <SkeletonBox width="80%" height={68} borderRadius={radius.lg} />
            </View>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {messages.map(renderMessage)}
            {loading && <TypingIndicator colors={colors} s={s} />}
          </ScrollView>
        )}

        {showChips && !historyLoading && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipsScroll} contentContainerStyle={s.chipsContent}>
            {CHIP_SUGGESTIONS.map(chip => (
              <TouchableOpacity key={chip} style={s.chip} onPress={() => sendMessage(chip)} activeOpacity={0.7}>
                <Text style={s.chipText}>{chip}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask anything about training…"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() =>sendMessage()}
            accessibilityLabel="Message to your Coach"
          />
          <TouchableOpacity
            style={[s.sendBtn, (!input.trim() || loading) && s.sendBtnDisabled]}
            onPress={() => sendMessage()}
            disabled={!input.trim() || loading}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !input.trim() || loading, busy: loading }}>
            <Text style={[s.sendBtnText, (!input.trim() || loading) && s.sendBtnTextDisabled]}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    flex: { flex: 1 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border },
    title: { fontSize: 28, fontWeight: weight.heavy, color: c.text, letterSpacing: -0.5 },
    subtitle: { fontSize: 12, color: c.textTertiary, fontWeight: weight.semibold, marginTop: 2 },
    clearBtn: { backgroundColor: c.cardAlt, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    clearBtnText: { fontSize: 16 },
    historySkeleton: { flex: 1, padding: spacing.lg },
    scroll: { flex: 1 },
    scrollContent: { padding: spacing.lg, paddingBottom: spacing.sm },
    msgWrap: { marginBottom: 12, alignItems: 'flex-start' },
    msgWrapUser: { alignItems: 'flex-end' },
    aiLabel: { fontSize: 10, color: c.textTertiary, fontWeight: weight.semibold, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4, marginLeft: 2 },
    bubble: { maxWidth: '85%', borderRadius: radius.lg, padding: 14 },
    bubbleAssistant: { backgroundColor: c.card, borderBottomLeftRadius: 4 },
    bubbleUser: { backgroundColor: c.accentMuted, borderWidth: 1, borderColor: c.accent, borderBottomRightRadius: 4 },
    bubbleText: { fontSize: 15, color: c.text, lineHeight: 22 },
    bubbleTextUser: { color: c.text },
    bold: { fontWeight: weight.heavy },
    ytLink: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF0000', borderRadius: radius.sm, padding: 8, marginTop: 8, gap: 8 },
    ytIcon: { color: '#fff', fontSize: 12, fontWeight: weight.heavy },
    ytTitle: { color: '#fff', fontSize: 12, fontWeight: weight.bold, flex: 1 },
    chipsScroll: { flexGrow: 0, borderTopWidth: 1, borderTopColor: c.border },
    chipsContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: 8 },
    chip: { backgroundColor: c.card, borderRadius: radius.pill, borderWidth: 1, borderColor: c.accent, paddingHorizontal: 14, paddingVertical: 8 },
    chipText: { color: c.accent, fontSize: 13, fontWeight: weight.medium },
    inputRow: { flexDirection: 'row', padding: spacing.md, gap: 10, borderTopWidth: 1, borderTopColor: c.border, alignItems: 'flex-end' },
    input: { flex: 1, backgroundColor: c.card, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, color: c.text, paddingHorizontal: spacing.lg, paddingVertical: 12, fontSize: 15, maxHeight: 120 },
    sendBtn: { backgroundColor: c.accent, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    sendBtnDisabled: { backgroundColor: c.cardAlt },
    sendBtnText: { color: c.accentText, fontSize: 20, fontWeight: weight.heavy, lineHeight: 22 },
    sendBtnTextDisabled: { color: c.textTertiary },
  });
}
