import * as WebBrowser from 'expo-web-browser'
import { Linking } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../constants/supabase'

// TODO: Fill in your Oura client ID after registering an OAuth app.
// These are public identifiers (not secrets) — safe to embed in the app bundle.
// Register redirect URI 'fuelog://wearable-callback' in each provider's developer console.
const WHOOP_CLIENT_ID = '8189d697-cb07-45d2-9a7e-7db61dd605c8'
// Public by design: this travels in the authorize URL, so it is visible to
// anyone who inspects the OAuth redirect. The client SECRET is the sensitive
// half and lives only in Supabase, where oura-proxy reads it server-side —
// it must never appear in this file, which ships inside the app bundle.
const OURA_CLIENT_ID = '6e6d3be4-0f7d-44b6-af6a-b7c4517f95fd'

const SUPABASE_URL = 'https://zbcxuffgmjuqarapfdwb.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpiY3h1ZmZnbWp1cWFyYXBmZHdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjQ4NjIsImV4cCI6MjA4NzQwMDg2Mn0.lUng1tY_aAuee_t8-E5MSUHdm2PF3HzsE41L-kzBmJE'
const REDIRECT_URI = 'fuelog://wearable-callback'
// Whoop uses an https redirect through fuelog.app instead of the custom
// scheme: registered in the Whoop dev dashboard 2026-07-19. The bridge page
// (fuelog-website/public/wearable-callback) forwards code+state into the app
// via fuelog://wearable-callback, and App.tsx's deep-link handler finishes
// the exchange. Immune to in-app-sheet/WebKit-beta scheme quirks.
const WHOOP_REDIRECT_URI = 'https://fuelog.app/wearable-callback/'

// If iOS backgrounds/relaunches the app while the ASWebAuthenticationSession is open,
// the OAuth redirect can come back through the app's normal deep-link path instead of
// resolving openAuthSessionAsync's promise — App.tsx's Linking handler uses this to know
// which provider's code it just received.
const PENDING_WEARABLE_KEY = 'fuelog_pending_wearable_provider'
// Whoop's OAuth server (Ory Hydra) hard-rejects any /oauth2/auth request whose `state`
// param is missing or under 8 characters — it redirects straight back to REDIRECT_URI
// with `error=invalid_state` before ever showing a login screen. Generated per attempt
// and checked against the value the redirect comes back with (basic CSRF protection).
const PENDING_WEARABLE_STATE_KEY = 'fuelog_pending_wearable_state'

function generateState(): string {
  let state = ''
  for (let i = 0; i < 24; i++) state += Math.floor(Math.random() * 36).toString(36)
  return state
}

export type Provider = 'whoop' | 'oura' | 'garmin'

export type WhoopData = {
  recoveryScore: number | null
  hrv: number | null
  restingHR: number | null
  spo2: number | null
  skinTemp: number | null
  sleepPerformance: number | null
  strain: number | null
  sleepHours: number | null
  sleepDeepHours: number | null
  sleepRemHours: number | null
  respiratoryRate: number | null
}

export type WhoopTrends = {
  hrvTrend: { date: string; value: number }[]
  rhrTrend: { date: string; value: number }[]
  sleepTrend: { date: string; value: number }[]
}

export type OuraData = {
  readinessScore: number | null
  sleepScore: number | null
  activityScore: number | null
  contributors: Record<string, number> | null
}

export type GarminData = {
  bodyBattery: number | null
  stressLevel: number | null
  steps: number | null
}

async function callProxy(functionName: string, body: object): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function getConnectedWearables(userId: string): Promise<Provider[]> {
  const { data } = await supabase
    .from('wearable_tokens')
    .select('provider')
    .eq('user_id', userId)
  return (data ?? []).map((r: any) => r.provider as Provider)
}

export async function disconnectWearable(provider: Provider): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase
    .from('wearable_tokens')
    .delete()
    .eq('user_id', user.id)
    .eq('provider', provider)
}

export async function connectWearable(provider: 'whoop' | 'oura'): Promise<boolean> {
  // Guard: Oura OAuth requires a real client ID registered at cloud.ouraring.com/oauth/applications
  if (provider === 'oura' && (!OURA_CLIENT_ID || OURA_CLIENT_ID.startsWith('<'))) {
    console.warn('[wearables] Oura client ID is not configured — skipping OAuth. '
      + 'Register an app at https://cloud.ouraring.com/oauth/applications and set OURA_CLIENT_ID.')
    return false
  }
  let authUrl: string
  const state = generateState()
  if (provider === 'whoop') {
    // `offline` is REQUIRED to receive a refresh_token. Without it Whoop returns
    // only a ~1-hour access token and no refresh token, so wearable_tokens gets
    // refresh_token = null, refreshWhoop() can never renew, and sync dies
    // permanently about an hour after connecting. That was the "Whoop won't
    // sync" bug — it always worked immediately after connecting, which is what
    // made it look intermittent rather than structural.
    const scopes = 'offline read:recovery read:cycles read:sleep read:workout read:profile'
    authUrl = `https://api.prod.whoop.com/oauth/oauth2/auth?client_id=${WHOOP_CLIENT_ID}&redirect_uri=${encodeURIComponent(WHOOP_REDIRECT_URI)}&scope=${encodeURIComponent(scopes)}&response_type=code&state=${state}`
  } else {
    const scopes = 'daily email personal'
    authUrl = `https://cloud.ouraring.com/oauth/authorize?client_id=${OURA_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scopes)}&response_type=code&state=${state}`
  }

  await AsyncStorage.setItem(PENDING_WEARABLE_KEY, provider)
  await AsyncStorage.setItem(PENDING_WEARABLE_STATE_KEY, state)
  // Open the OAuth flow in REAL Safari, not an in-app auth sheet.
  // Whoop's id.whoop.com login is a JS app that frequently fails to render
  // inside ASWebAuthenticationSession (blank endless spinner) and its CSRF
  // handling breaks under ephemeral sessions. The full browser is the only
  // environment it behaves in. Whoop redirects to fuelog://wearable-callback,
  // iOS reopens the app, and App.tsx's deep-link handler
  // (handleWearableRedirect below) finishes the token exchange.
  await Linking.openURL(authUrl)
  // Result is reported asynchronously via WEARABLE_CALLBACK_RESULT_KEY when
  // the redirect lands; returning true just means "flow launched".
  return true
}

// Key ProfileScreen polls on mount/foreground to surface the result of a wearable connect
// that completed via the fallback path below (its instance may have been backgrounded when
// the original connectWearable() promise was still pending).
export const WEARABLE_CALLBACK_RESULT_KEY = 'fuelog_wearable_callback_result'

// Fallback for when iOS routes the Whoop/Oura OAuth redirect through the app's normal
// deep-link path (Linking) rather than back into the in-flight openAuthSessionAsync call —
// this is what causes the auth flow to appear to "kick back to the main screen" and silently
// drop the connection. Called from App.tsx's global URL handler.
export async function handleWearableRedirect(url: string): Promise<void> {
  const provider = await AsyncStorage.getItem(PENDING_WEARABLE_KEY)
  if (provider !== 'whoop' && provider !== 'oura') return
  const expectedState = await AsyncStorage.getItem(PENDING_WEARABLE_STATE_KEY)
  await AsyncStorage.removeItem(PENDING_WEARABLE_KEY)
  await AsyncStorage.removeItem(PENDING_WEARABLE_STATE_KEY)

  const parsed = new URLSearchParams(url.split('?')[1] ?? '')
  if (parsed.get('error')) {
    console.log(`${provider} oauth error:`, parsed.get('error'), parsed.get('error_description'))
  }
  const code = parsed.get('code')
  if (!code || parsed.get('state') !== expectedState) {
    await AsyncStorage.setItem(WEARABLE_CALLBACK_RESULT_KEY, JSON.stringify({ provider, success: false }))
    return
  }

  const resp = await callProxy(`${provider}-proxy`, { action: 'exchange_code', code })
  // A fresh, successful connection clears any stale reauth flag.
  if (provider === 'whoop' && !resp.error) await setWhoopReauth(false)
  await AsyncStorage.setItem(WEARABLE_CALLBACK_RESULT_KEY, JSON.stringify({ provider, success: !resp.error }))
}

export async function connectGarmin(): Promise<boolean> {
  const tokenResp = await callProxy('garmin-proxy', { action: 'request_token' })
  if (!tokenResp.data?.authUrl) return false

  const { authUrl, requestToken, requestTokenSecret } = tokenResp.data
  const result = await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT_URI, {
    preferEphemeralSession: true,
  })
  if (result.type !== 'success') return false

  const parsed = new URLSearchParams(result.url.split('?')[1] ?? '')
  const verifier = parsed.get('oauth_verifier')
  if (!verifier) return false

  const exchangeResp = await callProxy('garmin-proxy', {
    action: 'exchange_verifier',
    requestToken,
    requestTokenSecret,
    verifier,
  })
  return !exchangeResp.error
}

export async function connectWearableForProvider(provider: Provider): Promise<boolean> {
  if (provider === 'garmin') return connectGarmin()
  return connectWearable(provider)
}

// One proxy call fetches everything Whoop-related (see whoop-proxy 'summary').
// Single-flight: getWhoopData and getWhoopTrends are called together by the
// Recovery screen — they share the same in-flight request so the app makes
// exactly ONE invocation. Firing several proxy calls in parallel used to race
// Whoop's rotating refresh tokens and permanently invalidate the connection.
let whoopSummaryInflight: Promise<any> | null = null
function fetchWhoopSummary(): Promise<any> {
  if (!whoopSummaryInflight) {
    whoopSummaryInflight = callProxy('whoop-proxy', { action: 'summary' })
      .finally(() => { setTimeout(() => { whoopSummaryInflight = null }, 3000) })
  }
  return whoopSummaryInflight
}

/**
 * Set when Whoop's grant is dead and the user must reconnect (no refresh token,
 * revoked access, or a rotated-away token). Screens read this to show a
 * "Reconnect Whoop" prompt instead of an empty Recovery tab — the failure mode
 * that made the old bug invisible.
 */
export const WHOOP_REAUTH_KEY = 'fuelog_whoop_reauth_required'

export async function isWhoopReauthRequired(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(WHOOP_REAUTH_KEY)) === '1'
  } catch {
    return false
  }
}

async function setWhoopReauth(needed: boolean): Promise<void> {
  try {
    if (needed) await AsyncStorage.setItem(WHOOP_REAUTH_KEY, '1')
    else await AsyncStorage.removeItem(WHOOP_REAUTH_KEY)
  } catch { /* non-fatal */ }
}

export async function getWhoopData(userId: string): Promise<WhoopData | null> {
  try {
    const resp = await fetchWhoopSummary()
    if (resp.error) console.error('whoop summary fetch failed:', resp.error)
    // The proxy returns 200 + reauthRequired when the grant is unrecoverable.
    await setWhoopReauth(!!resp.reauthRequired)
    const r = resp.data?.recovery
    const sl = resp.data?.sleep
    if (!r) return null
    return {
      recoveryScore: r.recoveryScore ?? null,
      hrv: r.hrv ?? null,
      restingHR: r.restingHR ?? null,
      spo2: r.spo2 ?? null,
      skinTemp: r.skinTemp ?? null,
      sleepPerformance: r.sleepPerformance ?? null,
      strain: resp.data?.strain ?? null,
      sleepHours: sl?.totalSleepMs != null ? Math.round(sl.totalSleepMs / 36000) / 100 : null,
      sleepDeepHours: sl?.deepSleepMs != null ? Math.round(sl.deepSleepMs / 36000) / 100 : null,
      sleepRemHours: sl?.remSleepMs != null ? Math.round(sl.remSleepMs / 36000) / 100 : null,
      respiratoryRate: sl?.respiratoryRate ?? null,
    }
  } catch (err) {
    console.error('getWhoopData failed:', err)
    return null
  }
}

// 7-day HRV/RHR/sleep history for the Recovery screen's trend charts — keeps
// those charts Whoop-exclusive too so they don't silently blend back in
// HealthKit's per-source values when Whoop is the connected/authoritative source.
export async function getWhoopTrends(userId: string): Promise<WhoopTrends> {
  try {
    const resp = await fetchWhoopSummary()
    const recRecords: any[] = resp.data?.recoveryHistory ?? []
    const sleepRecords: any[] = resp.data?.sleepHistory ?? []
    const hrvTrend = recRecords
      .filter((r) => r.hrv != null && r.date)
      .map((r) => ({ date: r.date, value: r.hrv }))
      .sort((a, b) => a.date.localeCompare(b.date))
    const rhrTrend = recRecords
      .filter((r) => r.restingHR != null && r.date)
      .map((r) => ({ date: r.date, value: r.restingHR }))
      .sort((a, b) => a.date.localeCompare(b.date))
    const sleepTrend = sleepRecords
      .filter((r) => r.sleepHours != null && r.date)
      .map((r) => ({ date: r.date, value: r.sleepHours }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return { hrvTrend, rhrTrend, sleepTrend }
  } catch (err) {
    console.error('getWhoopTrends failed:', err)
    return { hrvTrend: [], rhrTrend: [], sleepTrend: [] }
  }
}

export async function getOuraData(userId: string): Promise<OuraData | null> {
  try {
    const [readinessResp, sleepResp, activityResp] = await Promise.all([
      callProxy('oura-proxy', { action: 'readiness' }),
      callProxy('oura-proxy', { action: 'sleep' }),
      callProxy('oura-proxy', { action: 'activity' }),
    ])
    const r = readinessResp.data
    const s = sleepResp.data
    const a = activityResp.data
    if (!r && !s && !a) return null
    return {
      readinessScore: r?.readinessScore ?? null,
      sleepScore: s?.sleepScore ?? null,
      activityScore: a?.activityScore ?? null,
      contributors: r?.contributors ?? null,
    }
  } catch {
    return null
  }
}

export async function getGarminData(userId: string): Promise<GarminData | null> {
  try {
    const [batteryResp, dailiesResp] = await Promise.all([
      callProxy('garmin-proxy', { action: 'body_battery' }),
      callProxy('garmin-proxy', { action: 'dailies' }),
    ])
    const b = batteryResp.data
    const d = dailiesResp.data
    if (!b && !d) return null
    return {
      bodyBattery: b?.bodyBattery ?? null,
      stressLevel: d?.stressLevel ?? null,
      steps: d?.steps ?? null,
    }
  } catch {
    return null
  }
}
