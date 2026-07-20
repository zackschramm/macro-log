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

const DEXCOM_TOKEN_URL = 'https://api.dexcom.com/v2/oauth2/token'
const DEXCOM_API = 'https://api.dexcom.com'
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

async function refreshDexcom(userId: string): Promise<string | null> {
  const { data: row } = await supabaseAdmin
    .from('wearable_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'dexcom')
    .single()
  if (!row?.refresh_token) return null

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
    client_id: Deno.env.get('DEXCOM_CLIENT_ID')!,
    client_secret: Deno.env.get('DEXCOM_CLIENT_SECRET')!,
    redirect_uri: REDIRECT_URI,
  })
  const res = await fetch(DEXCOM_TOKEN_URL, {
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
  }).eq('user_id', userId).eq('provider', 'dexcom')

  return tokens.access_token
}

async function dexcomFetch(userId: string, path: string): Promise<unknown> {
  const { data: row } = await supabaseAdmin
    .from('wearable_tokens')
    .select('access_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'dexcom')
    .single()
  if (!row) throw new Error('no_token')

  let token = row.access_token
  if (row.expires_at && new Date(row.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    token = await refreshDexcom(userId) ?? token
  }

  let res = await fetch(`${DEXCOM_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 401) {
    const newToken = await refreshDexcom(userId)
    if (!newToken) throw new Error('token_refresh_failed')
    res = await fetch(`${DEXCOM_API}${path}`, {
      headers: { Authorization: `Bearer ${newToken}` },
    })
  }

  if (!res.ok) throw new Error(`dexcom_api_error_${res.status}`)
  return res.json()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('authorization') ?? ''
  const bearerToken = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(bearerToken)
  if (!user) return errorResponse(401, 'Unauthorized')

  let body: { action: string; code?: string }
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
          client_id: Deno.env.get('DEXCOM_CLIENT_ID')!,
          client_secret: Deno.env.get('DEXCOM_CLIENT_SECRET')!,
        })
        const res = await fetch(DEXCOM_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
        })
        const tokens = await res.json()
        if (!tokens.access_token) return errorResponse(400, tokens.error ?? 'Token exchange failed')

        await supabaseAdmin.from('wearable_tokens').upsert({
          user_id: user.id,
          provider: 'dexcom',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? null,
          expires_at: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : null,
        }, { onConflict: 'user_id,provider' })

        return okResponse({})
      }

      case 'refresh': {
        const newToken = await refreshDexcom(user.id)
        if (!newToken) return errorResponse(400, 'Refresh failed')
        return okResponse({})
      }

      case 'readings': {
        const endDate = new Date()
        const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000)
        const startStr = startDate.toISOString().replace(/\.\d{3}Z$/, '')
        const endStr = endDate.toISOString().replace(/\.\d{3}Z$/, '')

        const data = await dexcomFetch(
          user.id,
          `/v3/users/self/egvs?startDate=${encodeURIComponent(startStr)}&endDate=${encodeURIComponent(endStr)}`
        ) as any

        const egvs: Array<{
          systemTime: string
          displayTime: string
          value: number
          trend: string
          trendRate: number
        }> = (data?.estimatedGlucoseValues ?? []).filter((r: any) => r.value != null)

        if (egvs.length === 0) return okResponse({ readings: [], stats: null })

        const values = egvs.map(r => r.value)
        const average = Math.round(values.reduce((s, v) => s + v, 0) / values.length)
        const high = Math.max(...values)
        const low = Math.min(...values)
        const inRange = values.filter(v => v >= 70 && v <= 180).length
        const aboveRange = values.filter(v => v > 180).length
        const belowRange = values.filter(v => v < 70).length
        const total = values.length
        const timeInRange = Math.round((inRange / total) * 100)
        const timeAboveRange = Math.round((aboveRange / total) * 100)
        const timeBelowRange = Math.round((belowRange / total) * 100)

        return okResponse({
          readings: egvs,
          stats: { average, timeInRange, timeAboveRange, timeBelowRange, high, low },
        })
      }

      default:
        return errorResponse(400, 'Unknown action')
    }
  } catch (err: any) {
    if (err.message === 'no_token') return okResponse(null)
    console.error('cgm-proxy error:', err)
    return errorResponse(500, err.message ?? 'Internal error')
  }
})
