/**
 * MusicControlWidget
 *
 * Compact collapsible music control widget for the workout screen.
 * Collapsed: a slim pill showing + current status (tap to expand).
 * Expanded: a panel with three tabs:
 *   1. Local File  — pick any audio file via expo-document-picker, play/pause via expo-av
 *   2. Apple Music — text search → deep-link to Apple Music app (or web fallback)
 *   3. Spotify     — text search → deep-link to Spotify app (or web fallback)
 *                    Full in-app Spotify playback requires OAuth; see TODO below.
 *
 * TODO (Spotify OAuth):
 *   1. Register your app at https://developer.spotify.com/dashboard
 *   2. Add the client ID to app.json > expo.extra.spotifyClientId
 *   3. Store the client secret in Supabase Edge Function secrets (SPOTIFY_CLIENT_SECRET)
 *   4. For full in-app control add `react-native-spotify-remote` (needs bare/dev-client workflow)
 *      OR use expo-auth-session with PKCE + Spotify Web API (works in managed workflow).
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Linking,
} from 'react-native';
import { useTheme, ThemeColors, spacing, radius, weight } from '../constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'local' | 'apple' | 'spotify';

export interface MusicControlWidgetProps {
  /** URI of the currently loaded local audio file (null = none picked). */
  hypeSongUri: string | null;
  /** Display name of the currently loaded local audio file. */
  hypeSongName: string | null;
  /** Whether local audio is actively playing. */
  isHypePlaying: boolean;
  /** Opens the document picker so the user can select a local audio file. */
  onPickSong: () => void;
  /** Toggles play/pause for the loaded local audio file. */
  onPlayPause: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MusicControlWidget({
  hypeSongUri,
  hypeSongName,
  isHypePlaying,
  onPickSong,
  onPlayPause,
}: MusicControlWidgetProps) {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('local');
  const [appleQuery, setAppleQuery] = useState('');
  const [spotifyQuery, setSpotifyQuery] = useState('');

  // ── Helpers ──────────────────────────────────────────────────────────────

  const openAppleMusic = async () => {
    const q = encodeURIComponent(appleQuery.trim() || 'workout hype playlist');
    const nativeUrl = `music://music.apple.com/search?term=${q}`;
    const webUrl    = `https://music.apple.com/search?term=${q}`;
    try {
      const ok = await Linking.canOpenURL(nativeUrl);
      await Linking.openURL(ok ? nativeUrl : webUrl);
    } catch {
      await Linking.openURL(webUrl);
    }
  };

  const openSpotify = async () => {
    const q = encodeURIComponent(spotifyQuery.trim() || 'workout hype playlist');
    const nativeUrl = `spotify://search/${q}`;
    const webUrl    = `https://open.spotify.com/search/${q}`;
    try {
      const ok = await Linking.canOpenURL(nativeUrl);
      await Linking.openURL(ok ? nativeUrl : webUrl);
    } catch {
      await Linking.openURL(webUrl);
    }
  };

  // ── Collapsed pill ────────────────────────────────────────────────────────

  if (!expanded) {
    const pillLabel = hypeSongName
      ? (isHypePlaying ? `▶ ${hypeSongName}` : hypeSongName)
      : 'Add music';

    return (
      <TouchableOpacity
        style={s.pill}
        onPress={() => setExpanded(true)}
        activeOpacity={0.75}
      >
        <Text style={s.pillIcon}>{isHypePlaying ? '▶' : ''}</Text>
        <Text style={s.pillLabel} numberOfLines={1}>{pillLabel}</Text>
        {isHypePlaying && (
          <TouchableOpacity
            onPress={onPlayPause}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={s.pillPause}>⏸</Text>
          </TouchableOpacity>
        )}
        <Text style={s.pillChevron}>›</Text>
      </TouchableOpacity>
    );
  }

  // ── Expanded panel ────────────────────────────────────────────────────────

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'local',   label: 'File' },
    { id: 'apple',   label: 'Apple Music' },
    { id: 'spotify', label: 'Spotify' },
  ];

  return (
    <View style={s.panel}>

      {/* Panel header */}
      <View style={s.panelHeader}>
        <Text style={s.panelTitle}>Music</Text>
        <TouchableOpacity
          onPress={() => setExpanded(false)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={s.closeBtn}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={s.tabRow}>
        {tabs.map(({ id, label }) => (
          <TouchableOpacity
            key={id}
            style={[s.tab, activeTab === id && s.tabActive]}
            onPress={() => setActiveTab(id)}
          >
            <Text style={[s.tabText, activeTab === id && s.tabTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Local File tab ──────────────────────────────────────────────── */}
      {activeTab === 'local' && (
        <View style={s.tabContent}>
          <TouchableOpacity style={s.pickBtn} onPress={onPickSong} activeOpacity={0.8}>
            <Text style={s.pickBtnText} numberOfLines={1}>
              {hypeSongName ? ` ${hypeSongName}` : ' Pick audio file'}
            </Text>
          </TouchableOpacity>

          {hypeSongUri ? (
            <TouchableOpacity
              style={[s.actionBtn, isHypePlaying && s.actionBtnPlaying]}
              onPress={onPlayPause}
              activeOpacity={0.8}
            >
              <Text style={s.actionBtnText}>
                {isHypePlaying ? '⏸  Pause' : '▶  Play'}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={s.hintText}>
              Pick a local MP3 or AAC file to play as your hype song.{'\n'}
              Tap the on any set to trigger it automatically.
            </Text>
          )}
        </View>
      )}

      {/* ── Apple Music tab ─────────────────────────────────────────────── */}
      {activeTab === 'apple' && (
        <View style={s.tabContent}>
          <TextInput
            style={s.searchInput}
            value={appleQuery}
            onChangeText={setAppleQuery}
            placeholder="Search playlist or song…"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
            onSubmitEditing={openAppleMusic}
            clearButtonMode="while-editing"
          />
          <TouchableOpacity style={s.actionBtn} onPress={openAppleMusic} activeOpacity={0.8}>
            <Text style={s.actionBtnText}>Open in Apple Music  →</Text>
          </TouchableOpacity>
          <Text style={s.hintText}>
            Searches Apple Music and hands off playback to the Apple Music app.
            System controls (lock screen, AirPods) will control it from there.
          </Text>
        </View>
      )}

      {/* ── Spotify tab ─────────────────────────────────────────────────── */}
      {activeTab === 'spotify' && (
        <View style={s.tabContent}>
          <TextInput
            style={s.searchInput}
            value={spotifyQuery}
            onChangeText={setSpotifyQuery}
            placeholder="Search playlist or song…"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
            onSubmitEditing={openSpotify}
            clearButtonMode="while-editing"
          />
          <TouchableOpacity
            style={[s.actionBtn, s.spotifyBtn]}
            onPress={openSpotify}
            activeOpacity={0.8}
          >
            <Text style={[s.actionBtnText, s.spotifyBtnText]}>Open in Spotify  →</Text>
          </TouchableOpacity>
          <Text style={s.hintText}>
            Opens Spotify search. Full in-app controls need OAuth setup — see
            the TODO comment at the top of MusicControlWidget.tsx for setup steps.
          </Text>
        </View>
      )}

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    // ── Collapsed pill
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.cardAlt,
      borderRadius: radius.pill,
      paddingHorizontal: 14,
      paddingVertical: 8,
      marginHorizontal: spacing.lg,
      marginTop: 6,
      marginBottom: 4,
      borderWidth: 1,
      borderColor: c.border,
      gap: 8,
    },
    pillIcon:    { fontSize: 14 },
    pillLabel:   { flex: 1, fontSize: 13, fontWeight: weight.semibold, color: c.textSecondary },
    pillPause:   { fontSize: 16, color: c.accent },
    pillChevron: { fontSize: 18, color: c.textTertiary },

    // ── Expanded panel
    panel: {
      marginHorizontal: spacing.lg,
      marginTop: 6,
      marginBottom: 4,
      backgroundColor: c.card,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
    },
    panelHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    panelTitle: { fontSize: 14, fontWeight: weight.heavy, color: c.text },
    closeBtn:   { fontSize: 16, color: c.textTertiary, paddingHorizontal: 2 },

    // ── Tabs
    tabRow: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    tab: {
      flex: 1,
      paddingVertical: 9,
      alignItems: 'center',
    },
    tabActive: {
      borderBottomWidth: 2,
      borderBottomColor: c.accent,
    },
    tabText:       { fontSize: 10, fontWeight: weight.bold, color: c.textTertiary },
    tabTextActive: { color: c.accent },

    // ── Tab content
    tabContent: {
      padding: 12,
      gap: 10,
    },
    pickBtn: {
      backgroundColor: c.cardAlt,
      borderRadius: radius.md,
      padding: 12,
      borderWidth: 1,
      borderColor: c.border,
    },
    pickBtnText: { fontSize: 13, fontWeight: weight.semibold, color: c.text },

    actionBtn: {
      backgroundColor: c.accentMuted,
      borderRadius: radius.md,
      padding: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.accent + '33',
    },
    actionBtnPlaying: {
      borderColor: c.accent + '66',
    },
    actionBtnText: { fontSize: 14, fontWeight: weight.heavy, color: c.accent },

    spotifyBtn:     { backgroundColor: '#1DB95422', borderColor: '#1DB95444' },
    spotifyBtnText: { color: '#1DB954' },

    searchInput: {
      backgroundColor: c.cardAlt,
      borderRadius: radius.md,
      color: c.text,
      padding: 11,
      fontSize: 14,
      borderWidth: 1,
      borderColor: c.border,
    },

    hintText: {
      fontSize: 11,
      color: c.textTertiary,
      fontWeight: weight.medium,
      lineHeight: 17,
    },
  });
}
