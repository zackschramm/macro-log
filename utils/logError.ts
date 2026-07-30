/**
 * Crash reporting (Sentry) + a logger that can never make things worse.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  WHERE TO PASTE YOUR SENTRY DSN
 *
 *  1. Create a project at https://sentry.io (platform: React Native).
 *  2. Copy the DSN it gives you — it looks like
 *       https://abc123@o456.ingest.us.sentry.io/789
 *  3. Put it in EITHER place (env var wins):
 *
 *       a) .env  (local dev — .env is gitignored)
 *            EXPO_PUBLIC_SENTRY_DSN=https://abc123@o456.ingest.us.sentry.io/789
 *          …and for EAS builds:  eas env:create --name EXPO_PUBLIC_SENTRY_DSN
 *
 *       b) app.json → expo.extra.sentryDsn
 *            "extra": { "sentryDsn": "https://abc123@o456..." }
 *
 *  Until a DSN is present, everything here no-ops silently — the app behaves
 *  exactly as it did before, and logError() still console.warns in dev.
 *
 *  SOURCE MAPS: eas.json sets SENTRY_DISABLE_AUTO_UPLOAD=true in every build
 *  profile. The Sentry Expo plugin otherwise tries to upload source maps during
 *  the build and FAILS THE BUILD when no org/project is configured
 *  ("An organization ID or slug is required"). Crash reporting works fine
 *  without uploaded maps — you just get minified stack traces.
 *
 *  Once you have a Sentry project and want readable traces, remove that env var
 *  from eas.json and add:
 *      app.json → plugins: ["@sentry/react-native/expo", { "organization": "...", "project": "..." }]
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS FILE EXISTS
 * The codebase had ~34 empty `catch {}` blocks. They are deliberate — they keep
 * the UI working when an optional side-effect (a widget sync, a notification
 * schedule, a cache write) fails. But they were also invisible: a systematically
 * failing call looked identical to a healthy one. logError() makes them visible
 * WITHOUT changing control flow. It must therefore never throw, never await, and
 * never surface UI.
 */

import Constants from 'expo-constants';

/**
 * `@sentry/react-native` is loaded through require() rather than a static
 * import so this module still compiles and runs if the package isn't installed
 * yet (see the install note in package.json / the report). Typed as `any` for
 * the same reason.
 */
type SentryModule = any;

let sentryModule: SentryModule | undefined;
let sentryEnabled = false;
let initialized = false;

function loadSentry(): SentryModule | null {
  if (sentryModule !== undefined) return sentryModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sentryModule = require('@sentry/react-native');
  } catch {
    sentryModule = null;
  }
  return sentryModule;
}

/** DSN from env first, then expo `extra`. Empty string / placeholder = absent. */
export function getSentryDsn(): string | null {
  const fromEnv = process.env.EXPO_PUBLIC_SENTRY_DSN;
  const fromExtra = (Constants?.expoConfig?.extra as any)?.sentryDsn;
  const dsn = (fromEnv || fromExtra || '').trim();
  if (!dsn) return null;
  if (dsn.startsWith('YOUR_') || dsn.includes('YOUR_DSN')) return null;
  return dsn;
}

export function isErrorReportingEnabled(): boolean {
  return sentryEnabled;
}

/**
 * Call once, as early as possible (App.tsx does this at module load).
 * Safe to call repeatedly; safe to call with no DSN.
 */
export function initErrorReporting(): void {
  if (initialized) return;
  initialized = true;

  const dsn = getSentryDsn();
  if (!dsn) {
    if (__DEV__) {
      console.log('[sentry] no DSN configured — crash reporting disabled (see utils/logError.ts)');
    }
    return;
  }

  const S = loadSentry();
  if (!S?.init) {
    if (__DEV__) console.log('[sentry] @sentry/react-native not installed — crash reporting disabled');
    return;
  }

  try {
    S.init({
      dsn,
      // Dev builds would otherwise flood the quota with hot-reload noise.
      enabled: !__DEV__,
      environment: __DEV__ ? 'development' : 'production',
      // Health/nutrition data is sensitive — never attach PII by default.
      sendDefaultPii: false,
      tracesSampleRate: 0.2,
      attachStacktrace: true,
    });
    sentryEnabled = true;
  } catch (e) {
    if (__DEV__) console.warn('[sentry] init failed', e);
  }
}

/** Associates subsequent events with a user id (no email/name — see sendDefaultPii). */
export function setErrorUser(userId: string | null): void {
  try {
    if (!sentryEnabled) return;
    const S = loadSentry();
    S?.setUser?.(userId ? { id: userId } : null);
  } catch {
    /* never throw */
  }
}

/** Best-effort stringification of a non-Error throwable. */
function describe(err: unknown): string {
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/**
 * Report a swallowed error.
 *
 * @param scope  Stable, greppable identifier for the call site,
 *               e.g. 'notifications.schedule' or 'coach.loadHistory'.
 * @param err    Whatever was caught.
 * @param extra  Optional structured context (ids, counts — never PII).
 *
 * NEVER throws. Callers rely on that: this runs inside catch blocks whose whole
 * job is to not break the surrounding flow.
 */
export function logError(scope: string, err: unknown, extra?: Record<string, unknown>): void {
  try {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(`[${scope}]`, err, extra ?? '');
    }

    if (!sentryEnabled) return;
    const S = loadSentry();
    if (!S?.captureException) return;

    const error = err instanceof Error ? err : new Error(`${scope}: ${describe(err)}`);

    if (typeof S.withScope === 'function') {
      S.withScope((s: any) => {
        s.setTag?.('scope', scope);
        if (extra) {
          for (const [key, value] of Object.entries(extra)) s.setExtra?.(key, value);
        }
        S.captureException(error);
      });
    } else {
      S.captureException(error);
    }
  } catch {
    // Logging must never be the thing that breaks the app.
  }
}

export default logError;
