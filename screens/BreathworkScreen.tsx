import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, StyleSheet, Text, TouchableOpacity, View, SafeAreaView,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';

type PatternKey = 'box' | '478' | 'sigh';
type PhaseName = 'inhale' | 'hold' | 'exhale' | 'hold2' | 'sigh';

interface Phase {
  name: PhaseName;
  label: string;
  duration: number;
  targetScale: number; // 0 = small, 1 = large
}

const PATTERNS: Record<PatternKey, { label: string; description: string; phases: Phase[] }> = {
  box: {
    label: 'Box',
    description: '4-4-4-4',
    phases: [
      { name: 'inhale', label: 'Inhale', duration: 4, targetScale: 1 },
      { name: 'hold',   label: 'Hold',   duration: 4, targetScale: 1 },
      { name: 'exhale', label: 'Exhale', duration: 4, targetScale: 0 },
      { name: 'hold2',  label: 'Hold',   duration: 4, targetScale: 0 },
    ],
  },
  '478': {
    label: '4-7-8',
    description: '4-7-8',
    phases: [
      { name: 'inhale', label: 'Inhale', duration: 4,  targetScale: 1 },
      { name: 'hold',   label: 'Hold',   duration: 7,  targetScale: 1 },
      { name: 'exhale', label: 'Exhale', duration: 8,  targetScale: 0 },
    ],
  },
  sigh: {
    label: 'Physiological Sigh',
    description: '4-1-8',
    phases: [
      { name: 'inhale', label: 'Inhale',      duration: 4, targetScale: 1 },
      { name: 'sigh',   label: 'Sigh Inhale', duration: 1, targetScale: 1 },
      { name: 'exhale', label: 'Exhale',       duration: 8, targetScale: 0 },
    ],
  },
};

const SESSION_OPTIONS = [2, 5, 10];
const CIRCLE_SIZE = 180;
const RING_R = 90;
const RING_CIRC = 2 * Math.PI * RING_R;

export default function BreathworkScreen({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [patternKey, setPatternKey] = useState<PatternKey>('box');
  const [sessionMinutes, setSessionMinutes] = useState(5);
  const [running, setRunning] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [phaseSecondsLeft, setPhaseSecondsLeft] = useState(0);
  const [sessionSecondsLeft, setSessionSecondsLeft] = useState(0);

  const circleAnim = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseIndexRef = useRef(0);
  const sessionLeftRef = useRef(0);

  const pattern = PATTERNS[patternKey];
  const totalSessionSeconds = sessionMinutes * 60;

  const sessionProgress = sessionSecondsLeft > 0
    ? (totalSessionSeconds - sessionSecondsLeft) / totalSessionSeconds
    : 0;
  const ringOffset = RING_CIRC * (1 - sessionProgress);

  const animateToScale = useCallback((targetScale: number, duration: number) => {
    animRef.current?.stop();
    const anim = Animated.timing(circleAnim, {
      toValue: targetScale,
      duration: duration * 1000,
      useNativeDriver: true,
    });
    animRef.current = anim;
    anim.start();
  }, [circleAnim]);

  const runPhase = useCallback((pIdx: number) => {
    const phases = PATTERNS[patternKey].phases;
    const phase = phases[pIdx % phases.length];
    setPhaseIndex(pIdx % phases.length);
    setPhaseSecondsLeft(phase.duration);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateToScale(phase.targetScale, phase.duration);
  }, [patternKey, animateToScale]);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    animRef.current?.stop();
    circleAnim.setValue(0);
    setRunning(false);
    setPhaseIndex(0);
    setPhaseSecondsLeft(0);
    setSessionSecondsLeft(0);
    phaseIndexRef.current = 0;
    sessionLeftRef.current = 0;
  }, [circleAnim]);

  const start = useCallback(() => {
    const totalSecs = sessionMinutes * 60;
    const phases = PATTERNS[patternKey].phases;

    phaseIndexRef.current = 0;
    sessionLeftRef.current = totalSecs;

    setRunning(true);
    setSessionSecondsLeft(totalSecs);
    runPhase(0);

    let phaseSecsUsed = 0;
    let currentPhaseIdx = 0;
    let phaseDuration = phases[0].duration;

    intervalRef.current = setInterval(() => {
      sessionLeftRef.current -= 1;
      phaseSecsUsed += 1;

      setSessionSecondsLeft(sessionLeftRef.current);
      setPhaseSecondsLeft(phaseDuration - phaseSecsUsed);

      if (sessionLeftRef.current <= 0) {
        stop();
        return;
      }

      if (phaseSecsUsed >= phaseDuration) {
        phaseSecsUsed = 0;
        currentPhaseIdx = (currentPhaseIdx + 1) % phases.length;
        phaseDuration = phases[currentPhaseIdx].duration;
        runPhase(currentPhaseIdx);
      }
    }, 1000);
  }, [sessionMinutes, patternKey, runPhase, stop]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      animRef.current?.stop();
    };
  }, []);

  const circleScale = circleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.45],
  });

  const currentPhase = pattern.phases[phaseIndex];
  const phaseLabel = running ? currentPhase?.label ?? '' : 'Ready';

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => { stop(); onClose(); }}>
          <Text style={s.closeBtn}>Done</Text>
        </TouchableOpacity>
        <Text style={s.title}>Breathwork</Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={s.content}>

        {/* Pattern selector */}
        {!running && (
          <View style={s.patternRow}>
            {(Object.keys(PATTERNS) as PatternKey[]).map(key => (
              <TouchableOpacity
                key={key}
                style={[s.patternChip, patternKey === key && s.patternChipActive]}
                onPress={() => setPatternKey(key)}
              >
                <Text style={[s.patternChipText, patternKey === key && s.patternChipTextActive]}>
                  {PATTERNS[key].label}
                </Text>
                <Text style={[s.patternChipSub, patternKey === key && s.patternChipSubActive]}>
                  {PATTERNS[key].description}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Animated circle with progress ring */}
        <View style={s.circleWrap}>
          {/* Session progress ring */}
          <Svg
            width={CIRCLE_SIZE + 40}
            height={CIRCLE_SIZE + 40}
            style={{ position: 'absolute' }}
          >
            <Circle
              cx={(CIRCLE_SIZE + 40) / 2}
              cy={(CIRCLE_SIZE + 40) / 2}
              r={RING_R}
              fill="none"
              stroke={colors.border}
              strokeWidth={3}
            />
            <Circle
              cx={(CIRCLE_SIZE + 40) / 2}
              cy={(CIRCLE_SIZE + 40) / 2}
              r={RING_R}
              fill="none"
              stroke={colors.accent}
              strokeWidth={3}
              strokeDasharray={RING_CIRC}
              strokeDashoffset={ringOffset}
              strokeLinecap="round"
              rotation="-90"
              origin={`${(CIRCLE_SIZE + 40) / 2}, ${(CIRCLE_SIZE + 40) / 2}`}
            />
          </Svg>

          <Animated.View
            style={[
              s.breathCircle,
              { transform: [{ scale: circleScale }] },
            ]}
          />

          <View style={s.phaseTextWrap}>
            <Text style={s.phaseLabel}>{phaseLabel}</Text>
            {running && phaseSecondsLeft > 0 && (
              <Text style={s.phaseCount}>{phaseSecondsLeft}</Text>
            )}
          </View>
        </View>

        {/* Session info while running */}
        {running && (
          <Text style={s.sessionRemaining}>{fmtTime(sessionSecondsLeft)} remaining</Text>
        )}

        {/* Session length selector */}
        {!running && (
          <View style={s.sessionRow}>
            <Text style={s.sessionLabel}>Session Length</Text>
            <View style={s.sessionChips}>
              {SESSION_OPTIONS.map(mins => (
                <TouchableOpacity
                  key={mins}
                  style={[s.sessionChip, sessionMinutes === mins && s.sessionChipActive]}
                  onPress={() => setSessionMinutes(mins)}
                >
                  <Text style={[s.sessionChipText, sessionMinutes === mins && s.sessionChipTextActive]}>
                    {mins} min
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Start / Stop button */}
        <TouchableOpacity
          style={[s.actionBtn, running && s.actionBtnStop]}
          onPress={running ? stop : start}
          activeOpacity={0.8}
        >
          <Text style={s.actionBtnText}>{running ? 'Stop' : 'Start'}</Text>
        </TouchableOpacity>

      </View>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    closeBtn: { fontSize: 16, color: c.text, fontWeight: weight.semibold, width: 48 },
    title: { fontSize: 17, fontWeight: weight.heavy, color: c.text },
    content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: 24 },
    patternRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
    patternChip: {
      borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      alignItems: 'center',
    },
    patternChipActive: { backgroundColor: c.accentMuted, borderColor: c.accent },
    patternChipText: { fontSize: 13, fontWeight: weight.bold, color: c.textSecondary },
    patternChipTextActive: { color: c.accent },
    patternChipSub: { fontSize: 11, color: c.textTertiary, fontWeight: weight.medium, marginTop: 2 },
    patternChipSubActive: { color: c.accent },
    circleWrap: {
      width: CIRCLE_SIZE + 40,
      height: CIRCLE_SIZE + 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    breathCircle: {
      width: CIRCLE_SIZE,
      height: CIRCLE_SIZE,
      borderRadius: CIRCLE_SIZE / 2,
      backgroundColor: c.accentMuted,
      borderWidth: 2,
      borderColor: c.accent,
    },
    phaseTextWrap: {
      position: 'absolute',
      alignItems: 'center',
    },
    phaseLabel: { fontSize: 18, fontWeight: weight.heavy, color: c.accent, textAlign: 'center' },
    phaseCount: { fontSize: 36, fontWeight: weight.heavy, color: c.text, marginTop: 4 },
    sessionRemaining: { fontSize: 15, fontWeight: weight.semibold, color: c.textSecondary },
    sessionRow: { alignItems: 'center', gap: 10 },
    sessionLabel: { fontSize: 12, fontWeight: weight.bold, color: c.textTertiary, letterSpacing: 1, textTransform: 'uppercase' },
    sessionChips: { flexDirection: 'row', gap: 8 },
    sessionChip: {
      borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    },
    sessionChipActive: { backgroundColor: c.accent, borderColor: c.accent },
    sessionChipText: { fontSize: 13, fontWeight: weight.bold, color: c.textSecondary },
    sessionChipTextActive: { color: c.accentText },
    actionBtn: {
      backgroundColor: c.accent, borderRadius: radius.pill,
      paddingHorizontal: 48, paddingVertical: 16,
    },
    actionBtnStop: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    actionBtnText: { fontSize: 17, fontWeight: weight.heavy, color: c.accentText },
  });
}
