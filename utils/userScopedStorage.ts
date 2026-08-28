/**
 * Device-local storage, scoped to the signed-in user.
 *
 * Every AsyncStorage key in this app used to be a fixed string, and `signOut`
 * (hooks/useAuth.tsx) clears none of them. On a shared device that meant the
 * next account to sign in inherited the previous one's coach transcript,
 * recovery snapshot, progress photos, recent foods and streak — a privacy
 * failure in its own right, and a guaranteed App Review finding once the
 * reviewer signs into the demo account on a device the developer has used.
 *
 * Namespacing the key is preferred over clearing on sign-out because there is
 * no central registry of keys to clear (60+ across 25 files), and because a
 * session can be replaced without signOut() ever running — token revocation
 * and the password-recovery setSession path both swap users silently. Scoping
 * the READ is correct on every one of those paths, and it also means switching
 * back to your own account restores your own data instead of finding it wiped.
 */
export const scopedKey = (base: string, userId: string | null | undefined): string | null =>
  userId ? `${base}_${userId}` : null;

/** Legacy un-namespaced key, kept only so migrations can read it once. */
export const legacyKey = (base: string): string => base;
