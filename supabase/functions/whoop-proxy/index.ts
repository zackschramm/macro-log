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
const REDIRECT_URI = 'fuelog://wearable-callback'

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

async function refreshWhoop(userId: string): Promise<string | null> {
  const { data: row } = await supabaseAdmin
    .from('wearable_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'whoop')
    .single()
  if (!row?.refresh_token) return null

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
  if (!tokens.access_token) return null

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
    token = await refreshWhoop(userId) ?? token
  }

  let res = await fetch(`${WHOOP_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 401) {
    const newToken = await refreshWhoop(userId)
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
        const data = await whoopFetch(user.id, '/v2/recovery?limit=1') as any
        const r = data?.records?.[0]
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
        const data = await whoopFetch(user.id, '/v2/activity/sleep?limit=1') as any
        const s = data?.records?.[0]
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
        const data = await whoopFetch(user.id, `/v2/recovery?limit=${limit}`) as any
        const records = (data?.records ?? []).map((r: any) => ({
          date: (r.created_at ?? '').split('T')[0],
          recoveryScore: r.score?.recovery_score ?? null,
          hrv: r.score?.hrv_rmssd_milli ?? null,
          restingHR: r.score?.resting_heart_rate ?? null,
        }))
        return okResponse({ records })
      }

      case 'sleep_history': {
        const limit = Math.min(Math.max(Number(body.limit) || 7, 1), 25)
        const data = await whoopFetch(user.id, `/v2/activity/sleep?limit=${limit}`) as any
        const records = (data?.records ?? []).map((s: any) => {
          const stage = s.score?.stage_summary
          const totalMs = stage
            ? (stage.total_light_sleep_time_milli ?? 0) +
              (stage.total_slow_wave_sleep_time_milli ?? 0) +
              (stage.total_rem_sleep_time_milli ?? 0)
            : null
          return {
            date: (s.start ?? s.created_at ?? '').split('T')[0],
            sleepHours: totalMs != null ? Math.round(totalMs / 36000) / 100 : null,
          }
        })
        return okResponse({ records })
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
