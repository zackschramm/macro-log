// Trade a Sign in with Apple authorization code for a refresh token, and store
// it so delete-account can revoke it later (App Review Guideline 5.1.1(v)).
//
// Called fire-and-forget from AuthScreen right after a successful Apple
// sign-in. Failure here must never surface to the user — the sign-in already
// succeeded — but it is logged, because a user with no stored refresh token
// cannot have their Apple grant revoked at deletion time.
//
// Secrets required (Edge Function secrets):
//   APPLE_TEAM_ID      10-char team id
//   APPLE_KEY_ID       Key ID of the Sign in with Apple .p8 key
//   APPLE_PRIVATE_KEY  contents of the .p8 file (BEGIN/END PRIVATE KEY block)
//   APPLE_CLIENT_ID    the app's bundle id: com.zackschramm.macrolog
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are injected.)

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { makeClientSecret } from '../_shared/appleSecret.ts'

const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  // Caller must be a signed-in user; the token is stored under THEIR id only.
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: userErr } = await supabaseUser.auth.getUser()
  if (userErr || !user) return new Response('unauthorized', { status: 401 })

  let code = ''
  try {
    const body = await req.json()
    code = String(body?.authorization_code ?? '')
  } catch { /* fall through to the length check */ }
  if (!code || code.length > 2048) return new Response('bad request', { status: 400 })

  try {
    const clientSecret = await makeClientSecret()
    const resp = await fetch(APPLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: Deno.env.get('APPLE_CLIENT_ID')!,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    })
    if (!resp.ok) {
      console.error('apple token exchange failed', resp.status, await resp.text())
      return new Response(JSON.stringify({ stored: false }), { status: 200 })
    }
    const tokens = await resp.json()
    if (!tokens.refresh_token) return new Response(JSON.stringify({ stored: false }), { status: 200 })

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { error } = await admin.from('apple_refresh_tokens').upsert({
      user_id: user.id,
      refresh_token: tokens.refresh_token,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error
    return new Response(JSON.stringify({ stored: true }), { status: 200 })
  } catch (e) {
    console.error('apple-token-exchange', e)
    // 200 on purpose: the client fires and forgets; there is nothing for it to retry.
    return new Response(JSON.stringify({ stored: false }), { status: 200 })
  }
})
