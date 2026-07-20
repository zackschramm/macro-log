import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'
const WHOOP_API = 'https://api.prod.whoop.com/developer'
// Must match the redirect_uri used in the authorize request (utils/wearables.ts
// WHOOP_REDIRECT_URI) — Whoop validates it again during code exchange.
const REDIRECT_URI = 'https://fuelog.app/wearable-callback/'

function okResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Converts a UTC timestamp + Whoop's timezone_offset ("-06:00") into the
// user's local calendar date (YYYY-MM-DD). Raw UTC dates shifted late-evening
// bedtimes and early-morning recoveries onto the wrong day.
function localDate(iso: string | null | undefined, tzOffset: string | null | undefined): string {
  if (!iso) return ''
  let offsetMs = 0
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(tzOffset ?? '')
  if (m) {
    offsetMs = (Number(m[2]) * 60 + Number(m[3])) * 60_000 * (m[1] === '-' ? -1 : 1)
  }
  return new Date(new Date(iso).getTime() + offsetMs).toISOString().split('T')[0]
}

// Whoop ROTATES refresh tokens: every refresh invalidates the old one. When
// several function instances refresh concurrently with the same stored token,
// only the first wins — the rest get invalid_grant (and Whoop may revoke the
// whole grant on reuse). So refresh is written to survive races: before and
// after attempting a refresh we re-read the row, and if another instance
// already saved a newer access token we use that instead of failing.
async function refreshWhoop(userId: string, staleAccessToken?: string | null): Promise<string | null> {
  const readRow = async () => {
    const { data } = await supabaseAdmin
      .from('wearable_tokens')
      .select('access_token, refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'whoop')
      .single()
    return data as { access_token: string | null; refresh_token: string | null } | null
  }

  let row = await readRow()
  if (!row?.refresh_token) return null
  // Another instance already refreshed while we were waiting on the API.
  if (staleAccessToken && row.access_token && row.access_token !== staleAccessToken) {
    return row.access_token
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
    client_id: Deno.env.get('WHOOP_CLIENT_ID')!,
    client_secret: Deno.env.get('WHOOP_CLIENT_SECRET')!,
  })
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  const tokens = await res.json()

  if (!tokens.access_token) {
    // Likely lost a refresh race — give the winner a moment to persist its
    // new tokens, then use those.
    await new Promise((r) => setTimeout(r, 1200))
    row = await readRow()
    if (row?.access_token && row.access_token !== staleAccessToken) return row.access_token
    return null
  }

  await supabaseAdmin.from('wearable_tokens').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? row.refresh_token,
    expires_at: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null,
  }).eq('user_id', userId).eq('provider', 'whoop')

  return tokens.access_token
}

async function whoopFetch(userId: string, path: string): Promise<unknown> {
  const { data: row } = await supabaseAdmin
    .from('wearable_tokens')
    .select('access_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'whoop')
    .single()
  if (!row) throw new Error('no_token')

  let token = row.access_token
  if (row.expires_at && new Date(row.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    token = await refreshWhoop(userId, row.access_token) ?? token
  }

  let res = await fetch(`${WHOOP_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 401) {
    const newToken = await refreshWhoop(userId, token)
    if (!newToken) throw new Error('token_refresh_failed')
    res = await fetch(`${WHOOP_API}${path}`, {
      headers: { Authorization: `Bearer ${newToken}` },
    })
  }

  if (!res.ok) throw new Error(`whoop_api_error_${res.status}`)
  return res.json()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('authorization') ?? ''
  const bearerToken = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(bearerToken)
  if (!user) return errorResponse(401, 'Unauthorized')

  let body: { action: string; code?: string; limit?: number }
  try {
    body = await req.json()
  } catch {
    return errorResponse(400, 'Invalid JSON')
  }

  try {
    switch (body.action) {
      case 'exchange_code': {
        if (!body.code) return errorResponse(400, 'Missing code')
        const params = new URLSearchParams({
          grant_type: 'authorization_code',
          code: body.code,
          redirect_uri: REDIRECT_URI,
          client_id: Deno.env.get('WHOOP_CLIENT_ID')!,
          client_secret: Deno.env.get('WHOOP_CLIENT_SECRET')!,
        })
        const res = await fetch(WHOOP_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
        })
        const tokens = await res.json()
        if (!tokens.access_token) return errorResponse(400, tokens.error_description ?? 'Token exchange failed')

        await supabaseAdmin.from('wearable_tokens').upsert({
          user_id: user.id,
          provider: 'whoop',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? null,
          expires_at: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : null,
        }, { onConflict: 'user_id,provider' })

        return okResponse({})
      }

      case 'recovery': {
        // Fetch a few records and take the newest SCORED one — right after a
        // sync Whoop returns score_state PENDING with no score, which used to
        // surface as blank/stale numbers in the app.
        const data = await whoopFetch(user.id, '/v2/recovery?limit=5') as any
        const r = (data?.records ?? []).find((x: any) => x.score_state === 'SCORED')
        if (!r) return okResponse(null)
        return okResponse({
          recoveryScore: r.score?.recovery_score ?? null,
          hrv: r.score?.hrv_rmssd_milli ?? null,
          restingHR: r.score?.resting_heart_rate ?? null,
          spo2: r.score?.spo2_percentage ?? null,
          skinTemp: r.score?.skin_temp_celsius ?? null,
          sleepPerformance: r.score?.sleep_performance_percentage ?? null,
        })
      }

      case 'strain': {
        const data = await whoopFetch(user.id, '/v2/cycle?limit=1') as any
        const c = data?.records?.[0]
        return okResponse({ strain: c?.score?.strain ?? null })
      }

      case 'sleep': {
        // Naps are separate sleep activities in Whoop's API — the newest
        // record after an afternoon nap is the nap, not last night's sleep.
        // Take the newest scored non-nap record instead.
        const data = await whoopFetch(user.id, '/v2/activity/sleep?limit=10') as any
        const s = (data?.records ?? []).find(
          (x: any) => x.nap === false && x.score_state === 'SCORED',
        )
        // Duration fields live under score.stage_summary, not directly on score.
        const stage = s?.score?.stage_summary
        const totalSleepMs = stage
          ? (stage.total_light_sleep_time_milli ?? 0) +
            (stage.total_slow_wave_sleep_time_milli ?? 0) +
            (stage.total_rem_sleep_time_milli ?? 0)
          : null
        return okResponse({
          sleepPerformance: s?.score?.sleep_performance_percentage ?? null,
          totalSleepMs,
          deepSleepMs: stage?.total_slow_wave_sleep_time_milli ?? null,
          remSleepMs: stage?.total_rem_sleep_time_milli ?? null,
          respiratoryRate: s?.score?.respiratory_rate ?? null,
        })
      }

      case 'recovery_history': {
        const limit = Math.min(Math.max(Number(body.limit) || 7, 1), 25)
        // Over-fetch so PENDING/unscored records don't shrink the window.
        const data = await whoopFetch(user.id, `/v2/recovery?limit=${Math.min(limit * 2, 25)}`) as any
        const records = (data?.records ?? [])
          .filter((r: any) => r.score_state === 'SCORED')
          .slice(0, limit)
          .map((r: any) => ({
            date: localDate(r.created_at, r.timezone_offset),
            recoveryScore: r.score?.recovery_score ?? null,
            hrv: r.score?.hrv_rmssd_milli ?? null,
            restingHR: r.score?.resting_heart_rate ?? null,
          }))
        return okResponse({ records })
      }

      case 'sleep_history': {
        const limit = Math.min(Math.max(Number(body.limit) || 7, 1), 25)
        // Over-fetch: naps and unscored records are filtered out below.
        const data = await whoopFetch(user.id, `/v2/activity/sleep?limit=${Math.min(limit * 3, 25)}`) as any
        const records = (data?.records ?? [])
          .filter((s: any) => s.nap === false && s.score_state === 'SCORED')
          .slice(0, limit)
          .map((s: any) => {
            const stage = s.score?.stage_summary
            const totalMs = stage
              ? (stage.total_light_sleep_time_milli ?? 0) +
                (stage.total_slow_wave_sleep_time_milli ?? 0) +
                (stage.total_rem_sleep_time_milli ?? 0)
              : null
            return {
              // Whoop credits sleep to the wake-up day; use the sleep END in
              // the user's local timezone (raw UTC start pushed late-evening
              // bedtimes onto the next calendar day).
              date: localDate(s.end ?? s.start ?? s.created_at, s.timezone_offset),
              sleepHours: totalMs != null ? Math.round(totalMs / 36000) / 100 : null,
            }
          })
        return okResponse({ records })
      }

      case 'summary': {
        // Everything the Recovery screen needs in ONE invocation. The three
        // Whoop API calls run sequentially, so at most one token refresh can
        // ever happen — this is the fix for refresh-token races caused by the
        // app firing recovery/strain/sleep/history calls in parallel.
        const recData = await whoopFetch(user.id, '/v2/recovery?limit=14') as any
        const cycleData = await whoopFetch(user.id, '/v2/cycle?limit=1') as any
        const sleepData = await whoopFetch(user.id, '/v2/activity/sleep?limit=25') as any

        const scoredRecs = (recData?.records ?? []).filter((r: any) => r.score_state === 'SCORED')
        const r = scoredRecs[0]
        const recovery = r ? {
          recoveryScore: r.score?.recovery_score ?? null,
          hrv: r.score?.hrv_rmssd_milli ?? null,
          restingHR: r.score?.resting_heart_rate ?? null,
          spo2: r.score?.spo2_percentage ?? null,
          skinTemp: r.score?.skin_temp_celsius ?? null,
          sleepPerformance: r.score?.sleep_performance_percentage ?? null,
        } : null

        const strain = cycleData?.records?.[0]?.score?.strain ?? null

        const scoredSleeps = (sleepData?.records ?? []).filter(
          (x: any) => x.nap === false && x.score_state === 'SCORED',
        )
        const s = scoredSleeps[0]
        const stage = s?.score?.stage_summary
        const totalSleepMs = stage
          ? (stage.total_light_sleep_time_milli ?? 0) +
            (stage.total_slow_wave_sleep_time_milli ?? 0) +
            (stage.total_rem_sleep_time_milli ?? 0)
          : null
        const sleep = s ? {
          sleepPerformance: s.score?.sleep_performance_percentage ?? null,
          totalSleepMs,
          deepSleepMs: stage?.total_slow_wave_sleep_time_milli ?? null,
          remSleepMs: stage?.total_rem_sleep_time_milli ?? null,
          respiratoryRate: s.score?.respiratory_rate ?? null,
        } : null

        const recoveryHistory = scoredRecs.slice(0, 7).map((x: any) => ({
          date: localDate(x.created_at, x.timezone_offset),
          recoveryScore: x.score?.recovery_score ?? null,
          hrv: x.score?.hrv_rmssd_milli ?? null,
          restingHR: x.score?.resting_heart_rate ?? null,
        }))
        const sleepHistory = scoredSleeps.slice(0, 7).map((x: any) => {
          const st = x.score?.stage_summary
          const ms = st
            ? (st.total_light_sleep_time_milli ?? 0) +
              (st.total_slow_wave_sleep_time_milli ?? 0) +
              (st.total_rem_sleep_time_milli ?? 0)
            : null
          return {
            date: localDate(x.end ?? x.start ?? x.created_at, x.timezone_offset),
            sleepHours: ms != null ? Math.round(ms / 36000) / 100 : null,
          }
        })

        return okResponse({ recovery, strain, sleep, recoveryHistory, sleepHistory })
      }

      default:
        return errorResponse(400, 'Unknown action')
    }
  } catch (err: any) {
    if (err.message === 'no_token') return okResponse(null)
    console.error('whoop-proxy error:', err)
    return errorResponse(500, err.message ?? 'Internal error')
  }
})
