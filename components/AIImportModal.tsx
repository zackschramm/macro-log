import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Modal, ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import {
  ImportedMemory, extractMemoriesFromText, saveImportedMemories, SUGGESTED_PROMPT,
} from '../utils/importCoachMemories';
import { MEMORY_KIND_LABELS } from '../utils/coachMemory';
import { requireAIAccess } from '../utils/proGate';
import { logError } from '../utils/logError';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';

type Phase = 'paste' | 'working' | 'review';

/**
 * "Bring your AI coach with you."
 *
 * Users who already coach with ChatGPT/Claude/Gemini don't want to start from
 * zero. There's no way to log into those accounts and pull history (no consumer
 * OAuth exposes it), so this is the honest version: they paste, we extract, they
 * review before anything is saved.
 *
 * The review step is deliberate — silently writing inferred facts about someone's
 * body into their profile is how apps lose trust.
 */
export default function AIImportModal({
  visible, onClose, onImported,
}: {
  visible: boolean;
  onClose: () => void;
  onImported?: (count: number) => void;
}) {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [phase, setPhase] = useState<Phase>('paste');
  const [text, setText] = useState('');
  const [found, setFound] = useState<ImportedMemory[]>([]);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setPhase('paste'); setText(''); setFound([]); setSkipped(new Set()); setSaving(false);
  };
  const close = () => { reset(); onClose(); };

  const copyPrompt = async () => {
    await Clipboard.setStringAsync(SUGGESTED_PROMPT);
    Alert.alert('Copied', 'Paste that into ChatGPT, Claude, or Gemini, then copy its answer back here.');
  };

  const analyze = async () => {
    if (text.trim().length < 20) {
      Alert.alert('Not enough to work with', 'Paste a bit more so there’s something to learn from.');
      return;
    }
    const gate = await requireAIAccess('memory_import');
    if (!gate.allowed) {
      Alert.alert('Upgrade to Pro', gate.message ?? 'This is a Pro feature.');
      return;
    }
    setPhase('working');
    try {
      const memories = await extractMemoriesFromText(text);
      if (memories.length === 0) {
        setPhase('paste');
        Alert.alert(
          'Nothing to import',
          'I couldn’t find fitness details in that text. Try pasting a summary of your training, injuries, or food preferences.'
        );
        return;
      }
      setFound(memories);
      setPhase('review');
    } catch (e) {
      logError('AIImportModal.analyze', e);
      setPhase('paste');
      Alert.alert('Something went wrong', 'Could not read that text. Please try again.');
    }
  };

  const confirm = async () => {
    const keep = found.filter((_, i) => !skipped.has(i));
    if (keep.length === 0) { close(); return; }
    setSaving(true);
    const n = await saveImportedMemories(keep);
    setSaving(false);
    onImported?.(n);
    close();
    Alert.alert(
      'Imported',
      `Your Coach now knows ${n} thing${n === 1 ? '' : 's'} about you. You can edit or remove any of it under Coach Memory.`
    );
  };

  const toggle = (i: number) => {
    setSkipped(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const keepCount = found.length - skipped.size;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView
        style={s.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.header}>
          <TouchableOpacity onPress={close} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={s.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>
            {phase === 'review' ? 'Review what I found' : 'Bring your AI coach'}
          </Text>
          <View style={{ width: 56 }} />
        </View>

        {phase === 'paste' && (
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <Text style={s.lead}>
              Already coaching with ChatGPT, Claude, or Gemini? Paste what it knows
              about you and Fuelog will pick up where it left off.
            </Text>

            <View style={s.tipCard}>
              <Text style={s.tipTitle}>Not sure what to paste?</Text>
              <Text style={s.tipBody}>Ask your AI this, then copy its answer:</Text>
              <Text style={s.tipPrompt}>“{SUGGESTED_PROMPT}”</Text>
              <TouchableOpacity
                style={s.copyBtn}
                onPress={copyPrompt}
                accessibilityRole="button"
                accessibilityLabel="Copy suggested prompt"
              >
                <Ionicons name="copy-outline" size={15} color={colors.accent} />
                <Text style={s.copyBtnText}>Copy prompt</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={s.input}
              value={text}
              onChangeText={setText}
              multiline
              placeholder="Paste here…"
              placeholderTextColor={colors.textTertiary}
              textAlignVertical="top"
              accessibilityLabel="Paste what your AI coach knows about you"
            />

            <Text style={s.privacy}>
              Only training-related details are kept. Everything else is discarded,
              and nothing is saved until you approve it on the next screen.
            </Text>

            <TouchableOpacity
              style={[s.primaryBtn, text.trim().length < 20 && s.primaryBtnDisabled]}
              onPress={analyze}
              disabled={text.trim().length < 20}
              accessibilityRole="button"
              accessibilityLabel="Continue"
              accessibilityState={{ disabled: text.trim().length < 20 }}
            >
              <Text style={s.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {phase === 'working' && (
          <View style={s.center}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={s.workingText}>Reading what your coach knows…</Text>
          </View>
        )}

        {phase === 'review' && (
          <>
            <ScrollView contentContainerStyle={s.body}>
              <Text style={s.lead}>
                Tap anything you’d rather not keep. Nothing is saved until you confirm.
              </Text>
              {found.map((m, i) => {
                const off = skipped.has(i);
                return (
                  <TouchableOpacity
                    key={i}
                    style={[s.row, off && s.rowOff]}
                    onPress={() => toggle(i)}
                    activeOpacity={0.75}
                    accessibilityRole="checkbox"
                    accessibilityLabel={m.content}
                    accessibilityState={{ checked: !off }}
                  >
                    <Ionicons
                      name={off ? 'ellipse-outline' : 'checkmark-circle'}
                      size={20}
                      color={off ? colors.textTertiary : colors.accent}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.rowText, off && s.rowTextOff]}>{m.content}</Text>
                      <Text style={s.rowKind}>{MEMORY_KIND_LABELS[m.kind]}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={s.footer}>
              <TouchableOpacity
                style={[s.primaryBtn, (keepCount === 0 || saving) && s.primaryBtnDisabled]}
                onPress={confirm}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel={keepCount === 0 ? 'Skip import' : `Save ${keepCount} memories`}
                accessibilityState={{ busy: saving }}
              >
                {saving
                  ? <ActivityIndicator color={colors.accentText} />
                  : <Text style={s.primaryBtnText}>
                      {keepCount === 0 ? 'Skip' : `Save ${keepCount} thing${keepCount === 1 ? '' : 's'}`}
                    </Text>}
              </TouchableOpacity>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
  },
  headerTitle: { color: c.text, fontSize: 16, fontWeight: weight.semibold },
  cancel: { color: c.textSecondary, fontSize: 15, width: 56 },

  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  lead: { color: c.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: spacing.lg },

  tipCard: {
    backgroundColor: c.card, borderRadius: radius.card, padding: spacing.md,
    borderWidth: 1, borderColor: c.border, marginBottom: spacing.lg,
  },
  tipTitle: { color: c.text, fontSize: 13, fontWeight: weight.semibold, marginBottom: 4 },
  tipBody: { color: c.textSecondary, fontSize: 12, marginBottom: spacing.sm },
  tipPrompt: {
    color: c.text, fontSize: 13, lineHeight: 19, fontStyle: 'italic',
    marginBottom: spacing.md,
  },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  copyBtnText: { color: c.accent, fontSize: 13, fontWeight: weight.semibold },

  input: {
    backgroundColor: c.bgSecondary, borderRadius: radius.card, padding: spacing.md,
    color: c.text, fontSize: 14, lineHeight: 20, minHeight: 200,
    borderWidth: 1, borderColor: c.border,
  },
  privacy: {
    color: c.textTertiary, fontSize: 11, lineHeight: 17,
    marginTop: spacing.sm, marginBottom: spacing.lg,
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  workingText: { color: c.textSecondary, fontSize: 14 },

  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: c.card, borderRadius: radius.card, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: c.border,
  },
  rowOff: { opacity: 0.45 },
  rowText: { color: c.text, fontSize: 14, lineHeight: 20 },
  rowTextOff: { textDecorationLine: 'line-through' },
  rowKind: { color: c.textTertiary, fontSize: 11, marginTop: 3 },

  footer: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
  },
  primaryBtn: {
    backgroundColor: c.accent, borderRadius: radius.card,
    paddingVertical: 15, alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: c.accentText, fontSize: 15, fontWeight: weight.bold },
});
