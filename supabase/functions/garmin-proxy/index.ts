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

const GARMIN_REQUEST_TOKEN_URL = 'https://connectapi.garmin.com/oauth-service/oauth/request_token'
const GARMIN_ACCESS_TOKEN_URL = 'https://connectapi.garmin.com/oauth-service/oauth/access_token'
const GARMIN_AUTH_URL = 'https://connect.garmin.com/oauthConfirm'
const GARMIN_API = 'https://apis.garmin.com'
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

function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

// Build OAuth 1.0a Authorization header using Web Crypto API
async function buildOAuth1Header(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  tokenKey: string = '',
  tokenSecret: string = '',
  extraOAuthParams: Record<string, string> = {}
): Promise<string> {
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 32)
  const timestamp = Math.floor(Date.now() / 1000).toString()

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_version: '1.0',
    ...extraOAuthParams,
  }
  if (tokenKey) oauthParams.oauth_token = tokenKey

  const enc = (s: string) => encodeURIComponent(s)

  // Signature base string: sorted params
  const paramString = Object.keys(oauthParams)
    .sort()
    .map(k => `${enc(k)}=${enc(oauthParams[k])}`)
    .join('&')

  const baseString = `${method.toUpperCase()}&${enc(url)}&${enc(paramString)}`
  const signingKey = `${enc(consumerSecret)}&${enc(tokenSecret)}`

  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(baseString))
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))

  oauthParams.oauth_signature = signature

  const headerValue = Object.keys(oauthParams)
    .filter(k => k.startsWith('oauth_'))
    .map(k => `${enc(k)}="${enc(oauthParams[k])}"`)
    .join(', ')

  return `OAuth ${headerValue}`
}

async function garminFetch(userId: string, path: string, queryParams: Record<string, string> = {}): Promise<unknown> {
  const { data: row } = await supabaseAdmin
    .from('wearable_tokens')
    .select('access_token, refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'garmin')
    .single()
  if (!row) throw new Error('no_token')

  const consumerKey = Deno.env.get('GARMIN_CONSUMER_KEY')!
  const consumerSecret = Deno.env.get('GARMIN_CONSUMER_SECRET')!

  const qs = new URLSearchParams(queryParams).toString()
  const url = `${GARMIN_API}${path}${qs ? '?' + qs : ''}`

  const authHeader = await buildOAuth1Header(
    'GET', url, consumerKey, consumerSecret,
    row.access_token, row.refresh_token
  )

  const res = await fetch(url, { headers: { Authorization: authHeader } })
  if (!res.ok) throw new Error(`garmin_api_error_${res.status}`)
  return res.json()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('authorization') ?? ''
  const bearerToken = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(bearerToken)
  if (!user) return errorResponse(401, 'Unauthorized')

  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return errorResponse(400, 'Invalid JSON')
  }

  const consumerKey = Deno.env.get('GARMIN_CONSUMER_KEY')!
  const consumerSecret = Deno.env.get('GARMIN_CONSUMER_SECRET')!

  try {
    switch (body.action) {
      case 'request_token': {
        // Step 1 of OAuth1: get a request token from Garmin (oauth_callback in signed header)
        const authHeader = await buildOAuth1Header(
          'POST', GARMIN_REQUEST_TOKEN_URL, consumerKey, consumerSecret,
          '', '', { oauth_callback: REDIRECT_URI }
        )
        const res = await fetch(GARMIN_REQUEST_TOKEN_URL, {
          method: 'POST',
          headers: { Authorization: authHeader },
        })
        if (!res.ok) return errorResponse(502, `Garmin request_token failed: ${res.status}`)
        const text = await res.text()
        const params = Object.fromEntries(new URLSearchParams(text))
        return okResponse({
          authUrl: `${GARMIN_AUTH_URL}?oauth_token=${params.oauth_token}`,
          requestToken: params.oauth_token,
          requestTokenSecret: params.oauth_token_secret,
        })
      }

      case 'exchange_verifier': {
        // Step 2 of OAuth1: exchange request token + verifier for access token
        const { requestToken, requestTokenSecret, verifier } = body
        if (!requestToken || !requestTokenSecret || !verifier) {
          return errorResponse(400, 'Missing requestToken, requestTokenSecret, or verifier')
        }

        const authHeader = await buildOAuth1Header(
          'POST', GARMIN_ACCESS_TOKEN_URL, consumerKey, consumerSecret,
          requestToken, requestTokenSecret, { oauth_verifier: verifier }
        )
        const res = await fetch(GARMIN_ACCESS_TOKEN_URL, {
          method: 'POST',
          headers: { Authorization: authHeader },
        })
        if (!res.ok) return errorResponse(502, `Garmin access_token failed: ${res.status}`)
        const text = await res.text()
        const params = Object.fromEntries(new URLSearchParams(text))

        await supabaseAdmin.from('wearable_tokens').upsert({
          user_id: user.id,
          provider: 'garmin',
          access_token: params.oauth_token,
          refresh_token: params.oauth_token_secret, // OAuth1: secret stored here
          expires_at: null, // OAuth1 tokens don't expire
        }, { onConflict: 'user_id,provider' })

        return okResponse({})
      }

      case 'body_battery': {
        const today = todayStr()
        const data = await garminFetch(user.id, '/wellness-api/rest/bodyBattery', {
          startDate: today, endDate: today,
        }) as any[]
        const readings = Array.isArray(data) ? data : []
        const latest = readings[readings.length - 1]
        return okResponse({ bodyBattery: latest?.value ?? null })
      }

      case 'dailies': {
        const today = todayStr()
        const data = await garminFetch(user.id, '/wellness-api/rest/dailies', {
          startDate: today, endDate: today,
        }) as any
        const d = Array.isArray(data) ? data[0] : data?.dailies?.[0]
        return okResponse({
          stressLevel: d?.averageStressLevel ?? null,
          steps: d?.steps ?? null,
        })
      }

      case 'sleep': {
        const yesterday = yesterdayStr()
        const data = await garminFetch(user.id, '/wellness-api/rest/sleeps', {
          startDate: yesterday, endDate: yesterday,
        }) as any
        const s = Array.isArray(data) ? data[0] : data?.sleeps?.[0]
        return okResponse({
          sleepDurationSeconds: s?.durationInSeconds ?? null,
          sleepScore: s?.sleepScores?.overall?.value ?? null,
        })
      }

      default:
        return errorResponse(400, 'Unknown action')
    }
  } catch (err: any) {
    if (err.message === 'no_token') return okResponse(null)
    console.error('garmin-proxy error:', err)
    return errorResponse(500, err.message ?? 'Internal error')
  }
})
