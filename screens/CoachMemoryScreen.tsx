import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, TextInput, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  CoachMemory, MemoryKind, MEMORY_KIND_LABELS, MEMORY_KIND_ORDER, MEMORY_SOURCE_LABELS,
  getAllCoachMemories, editCoachMemory, forgetCoachMemory, forgetAllCoachMemories,
} from '../utils/coachMemory';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';
import AIImportModal from '../components/AIImportModal';

const KIND_ICONS: Record<MemoryKind, string> = {
  constraint: 'warning-outline',
  preference: 'heart-outline',
  pattern: 'analytics-outline',
  fact: 'trophy-outline',
  directive: 'chatbubble-ellipses-outline',
};

const KIND_BLURBS: Record<MemoryKind, string> = {
  constraint: 'Your Coach will never suggest anything that breaks these.',
  preference: 'Things you like and dislike.',
  pattern: 'Habits picked up from your logs — correct anything that’s wrong.',
  fact: 'Milestones and personal records worth remembering.',
  directive: 'Suggestions already made, so you don’t hear them twice.',
};

/**
 * "What Fuelog remembers about you" — every durable fact the Coach uses,
 * visible and editable. This screen isn't optional polish: users distrust
 * invisible inference, and letting them correct a wrong memory is the cheapest
 * accuracy mechanism there is.
 */
export default function CoachMemoryScreen() {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [memories, setMemories] = useState<CoachMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CoachMemory | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [importVisible, setImportVisible] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMemories(await getAllCoachMemories());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = (m: CoachMemory) => {
    Alert.alert(
      'Forget this?',
      `“${m.content}”\n\nYour Coach will stop taking this into account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget', style: 'destructive',
          onPress: async () => {
            const ok = await forgetCoachMemory(m.id);
            if (ok) setMemories(prev => prev.filter(x => x.id !== m.id));
            else Alert.alert('Error', 'Could not remove that. Try again.');
          },
        },
      ]
    );
  };

  const handleForgetAll = () => {
    Alert.alert(
      'Forget everything?',
      'Your Coach will start over with no memory of your preferences, limits, or milestones. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget All', style: 'destructive',
          onPress: async () => {
            const ok = await forgetAllCoachMemories();
            if (ok) setMemories([]);
            else Alert.alert('Error', 'Could not clear memories. Try again.');
          },
        },
      ]
    );
  };

  const openEditor = (m: CoachMemory) => { setEditing(m); setDraft(m.content); };

  const saveEdit = async () => {
    if (!editing || !draft.trim()) return;
    setSaving(true);
    const ok = await editCoachMemory(editing.id, draft.trim());
    setSaving(false);
    if (!ok) { Alert.alert('Error', 'Could not save that change.'); return; }
    setMemories(prev => prev.map(m =>
      m.id === editing.id
        ? { ...m, content: draft.trim(), source: 'user_edited', confidence: 1 }
        : m
    ));
    setEditing(null);
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (memories.length === 0) {
    return (
      <ScrollView contentContainerStyle={s.emptyWrap}>
        <Ionicons name="sparkles-outline" size={40} color={colors.textSecondary} />
        <Text style={s.emptyTitle}>Nothing remembered yet</Text>
        <Text style={s.emptyBody}>
          As you talk with your Coach, it’ll remember the things that matter —
          injuries to work around, foods you avoid, records you hit. Everything
          it learns shows up here, and you can change or delete any of it.
        </Text>
        <TouchableOpacity
          style={s.importBtn}
          onPress={() => setImportVisible(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Import from another AI"
        >
          <Ionicons name="download-outline" size={16} color={colors.accentText} />
          <Text style={s.importBtnText}>Import from another AI</Text>
        </TouchableOpacity>
        <AIImportModal
          visible={importVisible}
          onClose={() => setImportVisible(false)}
          onImported={load}
        />
      </ScrollView>
    );
  }

  const grouped = MEMORY_KIND_ORDER
    .map(kind => ({ kind, items: memories.filter(m => m.kind === kind) }))
    .filter(g => g.items.length > 0);

  return (
    <>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.intro}>
          These are the things your Coach keeps in mind. Tap any to edit it, or
          use the × to make it forget.
        </Text>

        {grouped.map(({ kind, items }) => (
          <View key={kind} style={s.section}>
            <View style={s.sectionHead}>
              <Ionicons
                name={KIND_ICONS[kind] as any}
                size={15}
                color={kind === 'constraint' ? colors.danger : colors.accent}
              />
              <Text style={s.sectionTitle}>{MEMORY_KIND_LABELS[kind].toUpperCase()}</Text>
            </View>
            <Text style={s.sectionBlurb}>{KIND_BLURBS[kind]}</Text>

            <View style={s.card}>
              {items.map((m, i) => (
                <View key={m.id} style={[s.row, i < items.length - 1 && s.rowBorder]}>
                  <TouchableOpacity style={s.rowMain} onPress={() => openEditor(m)} activeOpacity={0.7}>
                    <Text style={s.rowText}>{m.content}</Text>
                    <Text style={s.rowMeta}>
                      {MEMORY_SOURCE_LABELS[m.source]}
                      {m.source === 'inferred' && m.confidence < 0.6 ? ' · not sure' : ''}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDelete(m)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={s.importRow}
          onPress={() => setImportVisible(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Import from another AI"
        >
          <Ionicons name="download-outline" size={16} color={colors.accent} />
          <Text style={s.importRowText}>Import from another AI</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.forgetAll} onPress={handleForgetAll} activeOpacity={0.7}>
          <Text style={s.forgetAllText}>Forget everything</Text>
        </TouchableOpacity>

        <Text style={s.footnote}>
          Memories stay on your account and are only used to personalise your
          Coach. They’re never shared or sold.
        </Text>
      </ScrollView>

      <AIImportModal
        visible={importVisible}
        onClose={() => setImportVisible(false)}
        onImported={load}
      />

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Edit memory</Text>
            <TextInput
              style={s.modalInput}
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              placeholder="What should your Coach remember?"
              placeholderTextColor={colors.textSecondary}
            />
            <View style={s.modalActions}>
              <TouchableOpacity onPress={() => setEditing(null)} style={s.modalBtn}>
                <Text style={s.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveEdit}
                style={[s.modalBtn, s.modalSave, (!draft.trim() || saving) && { opacity: 0.5 }]}
                disabled={!draft.trim() || saving}
              >
                <Text style={s.modalSaveText}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg },

  emptyWrap: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center',
    padding: spacing.xl, backgroundColor: colors.bg,
  },
  emptyTitle: {
    color: colors.text, fontSize: 17, fontWeight: weight.semibold,
    marginTop: spacing.md, marginBottom: spacing.sm,
  },
  emptyBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center' },

  section: { marginBottom: spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  sectionTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: weight.semibold, letterSpacing: 0.8 },
  sectionBlurb: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.sm, opacity: 0.75 },

  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowMain: { flex: 1 },
  rowText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  rowMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },

  importBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.accent, borderRadius: radius.pill,
    paddingVertical: 12, paddingHorizontal: spacing.lg, marginTop: spacing.lg,
  },
  importBtnText: { color: colors.accentText, fontSize: 14, fontWeight: weight.semibold },
  importRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: spacing.md, marginTop: spacing.sm,
  },
  importRowText: { color: colors.accent, fontSize: 14, fontWeight: weight.medium },
  forgetAll: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.sm },
  forgetAllText: { color: colors.danger, fontSize: 14, fontWeight: weight.medium },
  footnote: {
    color: colors.textSecondary, fontSize: 11, lineHeight: 17,
    textAlign: 'center', marginTop: spacing.sm, opacity: 0.7,
  },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  modalCard: {
    width: '100%', backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg, padding: spacing.lg,
  },
  modalTitle: {
    color: colors.text, fontSize: 16, fontWeight: weight.semibold, marginBottom: spacing.md,
  },
  modalInput: {
    color: colors.text, fontSize: 14, lineHeight: 20, minHeight: 80,
    backgroundColor: colors.bg, borderRadius: radius.md,
    padding: spacing.md, textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  modalBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  modalCancel: { color: colors.textSecondary, fontSize: 14 },
  modalSave: { backgroundColor: colors.accent },
  modalSaveText: { color: colors.bg, fontSize: 14, fontWeight: weight.semibold },
});
