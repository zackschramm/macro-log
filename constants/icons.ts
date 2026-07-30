import type { Ionicons } from '@expo/vector-icons';

/**
 * Central icon vocabulary.
 *
 * Emoji were doing icon duty across the app — sport tiles, achievement badges,
 * feature lists, activity feed markers. They render inconsistently across iOS
 * versions, can't take the brand colour, ignore font scaling, and read as
 * unfinished next to a native app. Ionicons is already a dependency and is used
 * in nine screens, so it's the obvious replacement.
 *
 * Keep glyph choices here rather than inline so the same concept doesn't end up
 * with three different icons in three screens.
 *
 * NOTE: `→`, `←`, `✓`, `✗` are typography, not emoji, and are deliberately left
 * alone throughout the app.
 */
export type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Sport picker tiles. Keys match `profiles.sport`. */
export const SPORT_ICONS: Record<string, IconName> = {
  none:         'barbell-outline',
  running:      'walk-outline',
  cycling:      'bicycle-outline',
  swimming:     'water-outline',
  triathlon:    'medal-outline',
  tri_sprint:   'medal-outline',
  tri_olympic:  'medal-outline',
  tri_70_3:     'medal-outline',
  tri_ironman:  'medal-outline',
  crossfit:     'flame-outline',
  powerlifting: 'barbell-outline',
  bodybuilding: 'body-outline',
  hiking:       'trail-sign-outline',
  rowing:       'boat-outline',
  tennis:       'tennisball-outline',
  golf:         'golf-outline',
  yoga:         'leaf-outline',
  climbing:     'trending-up-outline',
  wrestling:    'shield-outline',
  basketball:   'basketball-outline',
  soccer:       'football-outline',
  football:     'american-football-outline',
  baseball:     'baseball-outline',
  hockey:       'snow-outline',
  volleyball:   'ellipse-outline',
  gymnastics:   'accessibility-outline',
};

export const sportIcon = (sport?: string | null): IconName =>
  (sport && SPORT_ICONS[sport]) || 'ellipse-outline';

/** Achievement badges. Keys match `ALL_BADGES[].id`. */
export const BADGE_ICONS: Record<string, IconName> = {
  first_step:   'restaurant-outline',
  consistent:   'flame-outline',
  on_fire:      'flame',
  legend:       'trophy-outline',
  iron:         'barbell-outline',
  century:      'ribbon-outline',
  early_bird:   'sunny-outline',
  night_owl:    'moon-outline',
  hydrated:     'water-outline',
  protein_pro:  'nutrition-outline',
  shredded:     'trending-down-outline',
  bulked:       'trending-up-outline',
  scanner:      'scan-outline',
  social:       'people-outline',
  explorer:     'compass-outline',
};

export const badgeIcon = (id?: string | null): IconName =>
  (id && BADGE_ICONS[id]) || 'ribbon-outline';

/** Activity-feed post types. */
export const POST_TYPE_ICONS: Record<string, IconName> = {
  progress_photo: 'camera-outline',
  workout:        'barbell-outline',
  macro:          'restaurant-outline',
  milestone:      'trophy-outline',
};

/** Pro feature list on the paywall. */
export const FEATURE_ICONS: Record<string, IconName> = {
  coaching:     'chatbubbles-outline',
  mealPlans:    'restaurant-outline',
  bloodwork:    'flask-outline',
  workoutFill:  'barbell-outline',
  inbody:       'body-outline',
  freeMessages: 'sparkles-outline',
};
