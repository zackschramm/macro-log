import { useColorScheme } from 'react-native';

// Palette matched to fuelog.app website (tailwind.config.ts):
// background #08090B · surface #0F1113 · surface-2 #161819 · border #232527
// accent (lime) #C8FF3D · accent-dim #9FD62E · ink #F5F6F4 / #9A9D9F / #5F6264
export const darkColors = {
  bg:             '#08090B',
  bgSecondary:    '#0F1113',
  card:           '#161819',
  cardAlt:        '#1E2022',
  accent:         '#C8FF3D',
  accentMuted:    'rgba(200,255,61,0.12)',
  accentDim:      '#9FD62E',
  accentText:     '#08090B',
  text:           '#F5F6F4',
  textSecondary:  '#9A9D9F',
  textTertiary:   '#5F6264',
  border:         '#232527',
  borderStrong:   '#33363A',
  danger:         '#FF4444',
  dangerSoft:     'rgba(255,68,68,0.12)',
  warning:        '#F5A623',
  info:           '#4F9CFF',
  success:        '#C8FF3D',
  protein:        '#4F9CFF',
  carbs:          '#F5A623',
  fat:            '#F472B6',
  white:          '#FFFFFF',
  black:          '#000000',
} as const;

export const lightColors = {
  bg:             '#FAFAFA',
  bgSecondary:    '#FFFFFF',
  card:           '#F2F2F2',
  cardAlt:        '#E8E8E8',
  accent:         '#6B9E00',
  accentMuted:    'rgba(107,158,0,0.12)',
  accentDim:      '#557E00',
  accentText:     '#FFFFFF',
  text:           '#0D0D0D',
  textSecondary:  '#6B6B6B',
  textTertiary:   '#A8A8A8',
  border:         '#E5E5E5',
  borderStrong:   '#D0D0D0',
  danger:         '#FF4444',
  dangerSoft:     'rgba(255,68,68,0.10)',
  warning:        '#F5A623',
  info:           '#4F9CFF',
  success:        '#6B9E00',
  protein:        '#4F9CFF',
  carbs:          '#F5A623',
  fat:            '#F472B6',
  white:          '#FFFFFF',
  black:          '#000000',
} as const;

export type ThemeColors = typeof darkColors;

export const spacing = {
  xs:    4,
  sm:    8,
  md:    12,
  lg:    16,
  xl:    20,
  xxl:   24,
  xxxl:  32,
};

export const radius = {
  sm:   8,
  md:   12,
  card: 16,
  lg:   20,
  xl:   24,
  pill: 999,
};

export const weight = {
  regular:  '400' as const,
  medium:   '500' as const,
  semibold: '600' as const,
  bold:     '700' as const,
  heavy:    '800' as const,
};

export function useTheme() {
  const scheme = useColorScheme();
  const colors = (scheme === 'light' ? lightColors : darkColors) as ThemeColors;
  return { colors, spacing, radius, weight, isDark: scheme !== 'light' };
}

// Static dark colors — backwards compat for any module-level StyleSheet usage
export const colors = darkColors;
// Keep legacy aliases so existing screens compile before full migration
export const bgElevated = darkColors.bgSecondary;
