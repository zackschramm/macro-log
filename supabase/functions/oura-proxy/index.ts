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

const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token'
const OURA_API = 'https://api.ouraring.com'
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

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

async function refreshOura(userId: string): Promise<string | null> {
  const { data: row } = await supabaseAdmin
    .from('wearable_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'oura')
    .single()
  if (!row?.refresh_token) return null

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
    client_id: Deno.env.get('OURA_CLIENT_ID')!,
    client_secret: Deno.env.get('OURA_CLIENT_SECRET')!,
  })
  const res = await fetch(OURA_TOKEN_URL, {
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
  }).eq('user_id', userId).eq('provider', 'oura')

  return tokens.access_token
}

async function ouraFetch(userId: string, path: string): Promise<unknown> {
  const { data: row } = await supabaseAdmin
    .from('wearable_tokens')
    .select('access_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'oura')
    .single()
  if (!row) throw new Error('no_token')

  let token = row.access_token
  if (row.expires_at && new Date(row.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    token = await refreshOura(userId) ?? token
  }

  let res = await fetch(`${OURA_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 401) {
    const newToken = await refreshOura(userId)
    if (!newToken) throw new Error('token_refresh_failed')
    res = await fetch(`${OURA_API}${path}`, {
      headers: { Authorization: `Bearer ${newToken}` },
    })
  }

  if (!res.ok) throw new Error(`oura_api_error_${res.status}`)
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
          client_id: Deno.env.get('OURA_CLIENT_ID')!,
          client_secret: Deno.env.get('OURA_CLIENT_SECRET')!,
        })
        const res = await fetch(OURA_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
        })
        const tokens = await res.json()
        if (!tokens.access_token) return errorResponse(400, tokens.error ?? 'Token exchange failed')

        await supabaseAdmin.from('wearable_tokens').upsert({
          user_id: user.id,
          provider: 'oura',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? null,
          expires_at: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : null,
        }, { onConflict: 'user_id,provider' })

        return okResponse({})
      }

      case 'readiness': {
        const today = todayStr()
        const data = await ouraFetch(user.id, `/v2/usercollection/daily_readiness?start_date=${today}&end_date=${today}`) as any
        const r = data?.data?.[0]
        if (!r) return okResponse(null)
        return okResponse({
          readinessScore: r.score ?? null,
          contributors: r.contributors ?? null,
        })
      }

      case 'sleep': {
        const today = todayStr()
        const data = await ouraFetch(user.id, `/v2/usercollection/daily_sleep?start_date=${today}&end_date=${today}`) as any
        const s = data?.data?.[0]
        return okResponse({ sleepScore: s?.score ?? null })
      }

      case 'activity': {
        const today = todayStr()
        const data = await ouraFetch(user.id, `/v2/usercollection/daily_activity?start_date=${today}&end_date=${today}`) as any
        const a = data?.data?.[0]
        return okResponse({ activityScore: a?.score ?? null })
      }

      default:
        return errorResponse(400, 'Unknown action')
    }
  } catch (err: any) {
    if (err.message === 'no_token') return okResponse(null)
    console.error('oura-proxy error:', err)
    return errorResponse(500, err.message ?? 'Internal error')
  }
})
