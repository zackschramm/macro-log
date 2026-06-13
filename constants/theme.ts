// Centralized design tokens for Fuelog.
// One source of truth so every screen stays visually consistent and future
// tweaks (e.g. an accent-color change) happen in exactly one place.

export const colors = {
  // Surfaces — softer than pure black, with layered separation
  bg: '#16171a',          // app background
  bgElevated: '#1b1d21',  // raised areas (headers, tab bar)
  card: '#1e2024',        // standard card
  cardAlt: '#24272c',     // nested / input surfaces
  border: '#2a2d33',      // hairline borders between/around cards
  borderSubtle: '#23262b',

  // Text — readable contrast instead of near-invisible grays
  text: '#ffffff',        // primary
  textSecondary: '#9aa0ab', // labels, secondary copy
  textMuted: '#6b7280',   // hints, timestamps
  textFaint: '#4b5159',   // disabled / placeholders

  // Brand accent
  accent: '#4ade80',
  accentSoft: 'rgba(74,222,128,0.14)',
  accentText: '#04210f',  // text/icon on top of an accent button

  // Status
  danger: '#ff5a5a',
  dangerSoft: 'rgba(255,90,90,0.14)',
  warning: '#fbbf24',

  // Macro colors (kept in sync with constants/data MC)
  protein: '#4a9eff',
  carbs: '#fbbf24',
  fat: '#f472b6',

  // Generic
  white: '#ffffff',
  black: '#000000',
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
};

// Font weights — moved away from a wall of 900s toward a readable hierarchy
export const weight = {
  regular: '500' as const,
  medium: '600' as const,
  semibold: '700' as const,
  bold: '800' as const,
  heavy: '900' as const,
};

export const font = {
  // Large display numbers (calorie hero, etc.)
  display: { fontSize: 64, fontWeight: weight.heavy, color: colors.text, letterSpacing: -2 },
  // Screen title
  title: { fontSize: 26, fontWeight: weight.bold, color: colors.text, letterSpacing: -0.4 },
  // Card / section heading
  heading: { fontSize: 18, fontWeight: weight.bold, color: colors.text },
  // Body
  body: { fontSize: 15, fontWeight: weight.regular, color: colors.text },
  bodySecondary: { fontSize: 14, fontWeight: weight.regular, color: colors.textSecondary },
  // Uppercase section label
  label: { fontSize: 11, fontWeight: weight.semibold, color: colors.textSecondary, letterSpacing: 1.2 },
  // Small caption
  caption: { fontSize: 12, fontWeight: weight.medium, color: colors.textMuted },
};

export const theme = { colors, radius, spacing, weight, font };
export default theme;
